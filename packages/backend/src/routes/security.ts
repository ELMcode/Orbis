import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Device, DiscoveryCollector, DiscoveryEvent, DiscoveryState, SecurityPolicy, Site } from '@prisma/client';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError } from '../utils/errors.js';
import { assertCanAccessSite, getDescendantSiteIds, getVisibleSiteIds, siteFilter } from '../services/scope.js';

const policySchema = z.object({
  requireDeviceSite: z.boolean().optional(),
  requireDeviceOwner: z.boolean().optional(),
  riskyPorts: z.array(z.coerce.number().int().min(1).max(65_535)).max(64).optional(),
  criticalPorts: z.array(z.coerce.number().int().min(1).max(65_535)).max(64).optional(),
  weakSnmpCommunities: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  firmwareUnknownDays: z.coerce.number().int().min(1).max(365).optional(),
  warrantyWarningDays: z.coerce.number().int().min(1).max(3650).optional(),
  collectorTokenMaxAgeDays: z.coerce.number().int().min(1).max(3650).optional(),
});

type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type RiskStatus = 'OPEN' | 'ACKNOWLEDGED';
type RiskCategory =
  | 'RISKY_PORT'
  | 'UNKNOWN_DEVICE'
  | 'MISSING_SITE'
  | 'MISSING_OWNER'
  | 'FIRMWARE_UNKNOWN'
  | 'FIRMWARE_OBSOLETE'
  | 'WEAK_SNMP'
  | 'IP_CONFLICT'
  | 'MAC_CONFLICT'
  | 'COLLECTOR_SECRET';

type DeviceWithContext = Device & {
  site: Pick<Site, 'id' | 'name'> | null;
  discoveryStates: Pick<DiscoveryState, 'id' | 'lastPorts' | 'lastSeenAt' | 'status' | 'lastAddress'>[];
};

type RiskItem = {
  id: string;
  category: RiskCategory;
  severity: RiskSeverity;
  status: RiskStatus;
  title: string;
  description: string;
  remediation: string;
  site?: { id: string; name: string } | null;
  device?: { id: string; name: string; ip?: string | null; type?: string } | null;
  collector?: { id: string; name: string } | null;
  evidence: Record<string, unknown>;
  detectedAt: string;
};

export default async function securityRoutes(app: FastifyInstance) {
  app.get('/policy', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const policy = await getPolicy(req.membership!.organizationId);
      return reply.send({ policy });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/policy', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const organizationId = req.membership!.organizationId;
      const body = policySchema.parse(req.body);
      const policy = await prisma.securityPolicy.upsert({
        where: { organizationId },
        create: { organizationId, ...body },
        update: body,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'security.policy.update', target: 'SecurityPolicy', targetId: policy.id, ip: req.ip });
      return reply.send({ policy });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/summary', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const context = await buildSecurityContext(req);
      const risks = await buildRisks(context);
      return reply.send({ ...summarizeRisks(risks), risks });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/risks.csv', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const context = await buildSecurityContext(req);
      const risks = await buildRisks(context);
      await audit({ userId: req.user!.sub, organizationId: context.organizationId, action: 'security.risks.export', target: 'SecurityRisk', ip: req.ip });
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="orbis-risques.csv"')
        .send(toCsv([
          ['Sévérité', 'Catégorie', 'Titre', 'Site', 'Équipement', 'Preuve', 'Correction'],
          ...risks.map((risk) => [
            risk.severity,
            risk.category,
            risk.title,
            risk.site?.name ?? '',
            risk.device?.name ?? risk.collector?.name ?? '',
            JSON.stringify(risk.evidence),
            risk.remediation,
          ]),
        ]));
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/audit', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(200).default(80),
        action: z.string().trim().max(120).optional(),
        target: z.string().trim().max(120).optional(),
      }).parse(req.query);
      const logs = await prisma.auditLog.findMany({
        where: {
          organizationId,
          ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
          ...(query.target ? { target: { contains: query.target, mode: 'insensitive' } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      return reply.send({ logs });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/audit.csv', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const logs = await prisma.auditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 1_000,
        include: { user: { select: { name: true, email: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'security.audit.export', target: 'AuditLog', ip: req.ip });
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', 'attachment; filename="orbis-audit.csv"')
        .send(toCsv([
          ['Date', 'Utilisateur', 'Email', 'Action', 'Cible', 'Cible ID', 'IP', 'Métadonnées'],
          ...logs.map((log) => [
            log.createdAt.toISOString(),
            log.user?.name ?? '',
            log.user?.email ?? '',
            log.action,
            log.target ?? '',
            log.targetId ?? '',
            log.ip ?? '',
            JSON.stringify(log.meta ?? {}),
          ]),
        ]));
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

async function buildSecurityContext(req: any) {
  const { organizationId, role } = req.membership!;
  const query = z.object({ siteId: z.string().optional() }).parse(req.query);
  const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
  let scopedSiteIds = visibleIds;
  if (query.siteId) {
    await assertCanAccessSite(query.siteId, organizationId, visibleIds);
    const descendants = await getDescendantSiteIds(query.siteId, organizationId);
    scopedSiteIds = visibleIds === null ? descendants : descendants.filter((id) => visibleIds.includes(id));
  }
  return {
    organizationId,
    scopedSiteIds,
    policy: await getPolicy(organizationId),
  };
}

async function getPolicy(organizationId: string) {
  return prisma.securityPolicy.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

async function buildRisks(context: { organizationId: string; scopedSiteIds: string[] | null; policy: SecurityPolicy }) {
  const [devices, collectors, events, logs] = await Promise.all([
    prisma.device.findMany({
      where: { organizationId: context.organizationId, ...siteFilter(context.scopedSiteIds) },
      include: {
        site: { select: { id: true, name: true } },
        discoveryStates: {
          orderBy: { lastSeenAt: 'desc' },
          take: 1,
          select: { id: true, lastPorts: true, lastSeenAt: true, status: true, lastAddress: true },
        },
      },
    }),
    prisma.discoveryCollector.findMany({
      where: { organizationId: context.organizationId, ...siteFilter(context.scopedSiteIds) },
      include: { site: { select: { id: true, name: true } } },
    }),
    prisma.discoveryEvent.findMany({
      where: {
        organizationId: context.organizationId,
        ...siteFilter(context.scopedSiteIds),
        type: { in: ['IP_CONFLICT', 'MAC_CONFLICT'] },
        acknowledgedAt: null,
      },
      include: { site: { select: { id: true, name: true } }, device: { select: { id: true, name: true, ip: true, type: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
    prisma.discoveryCollectorLog.findMany({
      where: { organizationId: context.organizationId, ...collectorSiteLogFilter(context.scopedSiteIds) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { collector: { select: { id: true, name: true, site: { select: { id: true, name: true } } } } },
    }),
  ]);

  return [
    ...deviceRisks(devices, context.policy),
    ...collectorRisks(collectors, logs, context.policy),
    ...conflictRisks(events),
  ].sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.detectedAt.localeCompare(a.detectedAt));
}

function deviceRisks(devices: DeviceWithContext[], policy: SecurityPolicy): RiskItem[] {
  const risks: RiskItem[] = [];
  const now = Date.now();
  for (const device of devices) {
    const latest = device.discoveryStates[0];
    const ports = latest?.lastPorts ?? [];
    for (const port of ports) {
      if (!policy.riskyPorts.includes(port) && !policy.criticalPorts.includes(port)) continue;
      const severity: RiskSeverity = policy.criticalPorts.includes(port) ? 'CRITICAL' : 'HIGH';
      risks.push(risk({
        id: `port:${device.id}:${port}`,
        category: 'RISKY_PORT',
        severity,
        title: `${portLabel(port)} exposé sur ${device.name}`,
        description: `Le port ${port} a été détecté ouvert lors de la dernière découverte.`,
        remediation: portRemediation(port),
        device,
        evidence: { port, address: latest?.lastAddress ?? device.ip, lastSeenAt: latest?.lastSeenAt },
        detectedAt: latest?.lastSeenAt ?? device.updatedAt,
      }));
    }
    if (policy.requireDeviceSite && !device.siteId) {
      risks.push(risk({
        id: `site:${device.id}`,
        category: 'MISSING_SITE',
        severity: 'MEDIUM',
        title: `${device.name} n'est rattaché à aucun site`,
        description: 'Un équipement hors site est difficile à gouverner, filtrer et auditer.',
        remediation: 'Rattacher l’équipement au bon site ou périmètre.',
        device,
        evidence: { siteId: null },
        detectedAt: device.updatedAt,
      }));
    }
    if (policy.requireDeviceOwner && !device.owner) {
      risks.push(risk({
        id: `owner:${device.id}`,
        category: 'MISSING_OWNER',
        severity: 'LOW',
        title: `${device.name} n'a pas de propriétaire`,
        description: 'Aucun responsable métier/technique n’est renseigné pour cet équipement.',
        remediation: 'Renseigner le propriétaire ou l’équipe responsable.',
        device,
        evidence: { owner: null },
        detectedAt: device.updatedAt,
      }));
    }
    if (isUnknownDevice(device)) {
      risks.push(risk({
        id: `unknown:${device.id}`,
        category: 'UNKNOWN_DEVICE',
        severity: 'HIGH',
        title: `Équipement inconnu : ${device.name}`,
        description: 'L’équipement est découvert mais insuffisamment identifié.',
        remediation: 'Qualifier le type, le modèle, le rôle et confirmer son rattachement.',
        device,
        evidence: { type: device.type, brand: device.brand, model: device.model, tags: device.tags },
        detectedAt: device.updatedAt,
      }));
    }
    if (!device.model && !device.notes?.includes('SNMP:')) {
      risks.push(risk({
        id: `firmware-unknown:${device.id}`,
        category: 'FIRMWARE_UNKNOWN',
        severity: 'MEDIUM',
        title: `Firmware/OS inconnu sur ${device.name}`,
        description: 'Le système ou firmware n’est pas documenté dans la source of truth.',
        remediation: 'Enrichir via SNMP/collector ou renseigner manuellement le modèle, OS/firmware et version.',
        device,
        evidence: { model: device.model, notes: Boolean(device.notes) },
        detectedAt: device.updatedAt,
      }));
    }
    if (device.warrantyEnd && device.warrantyEnd.getTime() < now) {
      risks.push(risk({
        id: `support-expired:${device.id}`,
        category: 'FIRMWARE_OBSOLETE',
        severity: 'HIGH',
        title: `Support ou garantie expiré : ${device.name}`,
        description: 'La date de garantie/support est dépassée, ce qui augmente le risque d’obsolescence.',
        remediation: 'Planifier remplacement, renouvellement support ou validation de maintien en condition.',
        device,
        evidence: { warrantyEnd: device.warrantyEnd.toISOString() },
        detectedAt: device.warrantyEnd,
      }));
    }
  }
  return risks;
}

function collectorRisks(
  collectors: (DiscoveryCollector & { site: Pick<Site, 'id' | 'name'> | null })[],
  logs: Array<{ meta: any; createdAt: Date; collector: { id: string; name: string; site: Pick<Site, 'id' | 'name'> | null } }>,
  policy: SecurityPolicy,
): RiskItem[] {
  const risks: RiskItem[] = [];
  const maxAgeMs = policy.collectorTokenMaxAgeDays * 24 * 60 * 60 * 1000;
  for (const collector of collectors) {
    if (Date.now() - collector.tokenLastRotatedAt.getTime() > maxAgeMs) {
      risks.push({
        id: `collector-token-age:${collector.id}`,
        category: 'COLLECTOR_SECRET',
        severity: 'HIGH',
        status: 'OPEN',
        title: `Token collector ancien : ${collector.name}`,
        description: `Le token n’a pas été renouvelé depuis plus de ${policy.collectorTokenMaxAgeDays} jours.`,
        remediation: 'Régénérer le token collector et redéployer le fichier collector.env.',
        site: collector.site,
        collector: { id: collector.id, name: collector.name },
        evidence: { tokenLastRotatedAt: collector.tokenLastRotatedAt.toISOString(), tokenExpiresAt: collector.tokenExpiresAt?.toISOString() ?? null },
        detectedAt: collector.tokenLastRotatedAt.toISOString(),
      });
    }
    if (collector.tokenExpiresAt && collector.tokenExpiresAt.getTime() < Date.now()) {
      risks.push({
        id: `collector-token-expired:${collector.id}`,
        category: 'COLLECTOR_SECRET',
        severity: 'CRITICAL',
        status: 'OPEN',
        title: `Token collector expiré : ${collector.name}`,
        description: 'Le collector ne devrait plus pouvoir ingérer de données avec ce token.',
        remediation: 'Régénérer un token et vérifier que l’ancien est révoqué côté déploiement.',
        site: collector.site,
        collector: { id: collector.id, name: collector.name },
        evidence: { tokenExpiresAt: collector.tokenExpiresAt.toISOString() },
        detectedAt: collector.tokenExpiresAt.toISOString(),
      });
    }
  }
  for (const log of logs) {
    if (!log.meta?.snmp?.v2cConfigured || log.meta?.snmp?.v3Configured) continue;
    risks.push({
      id: `snmp-v2c:${log.collector.id}`,
      category: 'WEAK_SNMP',
      severity: 'MEDIUM',
      status: 'OPEN',
      title: `SNMP v2c sans v3 sur ${log.collector.name}`,
      description: 'Le diagnostic collector indique SNMP v2c configuré sans SNMPv3. Les communautés ne sont jamais remontées au serveur.',
      remediation: 'Basculer vers SNMPv3 authPriv quand les équipements le supportent et retirer les communautés faibles.',
      site: log.collector.site,
      collector: { id: log.collector.id, name: log.collector.name },
      evidence: { weakCommunityNamesPolicy: policy.weakSnmpCommunities, diagnosticAt: log.createdAt.toISOString() },
      detectedAt: log.createdAt.toISOString(),
    });
  }
  return dedupeRisks(risks);
}

function conflictRisks(events: (DiscoveryEvent & { site: Pick<Site, 'id' | 'name'> | null; device: { id: string; name: string; ip: string | null; type: string } | null })[]): RiskItem[] {
  return events.map((event) => ({
    id: `event:${event.id}`,
    category: event.type === 'IP_CONFLICT' ? 'IP_CONFLICT' : 'MAC_CONFLICT',
    severity: event.type === 'IP_CONFLICT' ? 'CRITICAL' : 'HIGH',
    status: 'OPEN',
    title: event.title,
    description: event.message ?? 'Conflit détecté par la découverte.',
    remediation: event.type === 'IP_CONFLICT'
      ? 'Identifier les hôtes concernés, corriger DHCP/IP statiques, puis relancer une découverte.'
      : 'Vérifier doublons, virtualisation, bonding ou usurpation MAC.',
    site: event.site,
    device: event.device,
    evidence: (event.meta as Record<string, unknown>) ?? {},
    detectedAt: event.createdAt.toISOString(),
  }));
}

function summarizeRisks(risks: RiskItem[]) {
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  const byCategory: Record<string, number> = {};
  for (const risk of risks) {
    bySeverity[risk.severity.toLowerCase() as keyof typeof bySeverity] += 1;
    byCategory[risk.category] = (byCategory[risk.category] ?? 0) + 1;
  }
  const score = Math.max(0, 100 - risks.reduce((sum, risk) => sum + severityWeight(risk.severity), 0));
  return { score, counts: { total: risks.length, ...bySeverity }, byCategory };
}

function risk(input: Omit<RiskItem, 'status' | 'site' | 'device' | 'detectedAt'> & { device: DeviceWithContext; detectedAt: Date }) {
  return {
    ...input,
    status: 'OPEN' as const,
    site: input.device.site,
    device: { id: input.device.id, name: input.device.name, ip: input.device.ip, type: input.device.type },
    detectedAt: input.detectedAt.toISOString(),
  };
}

function isUnknownDevice(device: DeviceWithContext) {
  return device.type === 'OTHER' || (device.tags.includes('discovered') && !device.brand && !device.model && !device.serial);
}

function severityWeight(severity: RiskSeverity) {
  return severity === 'CRITICAL' ? 12 : severity === 'HIGH' ? 7 : severity === 'MEDIUM' ? 4 : 1;
}

function portLabel(port: number) {
  const labels: Record<number, string> = {
    21: 'FTP',
    23: 'Telnet',
    25: 'SMTP',
    53: 'DNS',
    110: 'POP3',
    143: 'IMAP',
    161: 'SNMP',
    389: 'LDAP',
    445: 'SMB',
    1433: 'SQL Server',
    1521: 'Oracle',
    3306: 'MySQL',
    3389: 'RDP',
    5432: 'PostgreSQL',
    5900: 'VNC',
    6379: 'Redis',
    9200: 'Elasticsearch',
    9300: 'Elasticsearch transport',
    11211: 'Memcached',
    27017: 'MongoDB',
  };
  return labels[port] ? `${labels[port]} (${port})` : `Port ${port}`;
}

function portRemediation(port: number) {
  if ([23, 21].includes(port)) return 'Désactiver le service en clair et utiliser SSH/SFTP avec contrôle d’accès.';
  if ([3389, 5900].includes(port)) return 'Restreindre à un VPN/bastion, MFA et règles firewall strictes.';
  if ([445, 389].includes(port)) return 'Limiter au réseau d’administration et vérifier durcissement/patching.';
  if ([3306, 5432, 1433, 1521, 6379, 9200, 9300, 11211, 27017].includes(port)) return 'Ne pas exposer les bases hors sous-réseau applicatif, ajouter ACL et authentification forte.';
  if (port === 161) return 'Préférer SNMPv3 authPriv, filtrer par IP collector et retirer les communautés faibles.';
  return 'Valider la nécessité du service, filtrer par pare-feu et documenter le propriétaire.';
}

function dedupeRisks(risks: RiskItem[]) {
  return [...new Map(risks.map((risk) => [risk.id, risk])).values()];
}

function collectorSiteLogFilter(siteIds: string[] | null) {
  return siteIds === null ? {} : { collector: { siteId: { in: siteIds } } };
}

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map((cell) => {
    const raw = String(cell ?? '');
    const value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(';')).join('\n');
}
