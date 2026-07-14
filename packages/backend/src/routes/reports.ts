import { FastifyInstance } from 'fastify';
import { Prisma, ReportFormat, ReportFrequency, ReportType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { assertCanAccessSite, getVisibleSiteIds, scopedSiteFilter, siteFilter } from '../services/scope.js';
import { csv, simplePdf } from '../services/reports.js';
import { hasSmtpConfig, sendEmail } from '../services/email.js';
import { assertTenantQuota } from '../services/tenantLimits.js';

const exportQuerySchema = z.object({
  siteId: z.string().optional(),
  diagramId: z.string().optional(),
});

const scheduleSchema = z.object({
  name: z.string().trim().min(1, 'Le nom du rapport est obligatoire').max(120),
  type: z.nativeEnum(ReportType),
  format: z.nativeEnum(ReportFormat),
  frequency: z.nativeEnum(ReportFrequency).default('MONTHLY'),
  recipients: z.array(z.string().trim().email()).max(20).default([]),
  siteId: z.string().optional().nullable(),
  active: z.boolean().default(true),
  timezone: z.string().trim().min(1).max(80).default('Europe/Paris'),
  scheduledHour: z.number().int().min(0).max(23).default(8),
  scheduledMinute: z.number().int().min(0).max(59).default(0),
  scheduledWeekday: z.number().int().min(1).max(7).optional().nullable(),
  scheduledMonthDay: z.number().int().min(1).max(31).optional().nullable(),
  startAt: z.coerce.date().optional().nullable(),
});

export default async function reportsRoutes(app: FastifyInstance) {
  app.get('/exports/:filename', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const filename = z.string().parse((req.params as any).filename);
      const query = exportQuerySchema.parse(req.query);
      const visibleSiteIds = await visibleScope(req.user!.sub, organizationId, role, query.siteId);
      const artifact = await buildReportArtifact({
        organizationId,
        visibleSiteIds,
        siteId: query.siteId,
        diagramId: query.diagramId,
        filename,
      });
      return sendDownload(reply, artifact);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/schedules', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const visibleSiteIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const schedules = await prisma.reportSchedule.findMany({
        where: { organizationId, ...siteFilter(visibleSiteIds) },
        orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
        include: { site: { select: { id: true, name: true } } },
      });
      return reply.send({ schedules });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/schedules', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const body = scheduleSchema.parse(req.body);
      const visibleSiteIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleSiteIds);
      if (!body.siteId && visibleSiteIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      await assertTenantQuota(organizationId, 'reportSchedules');

      const schedule = await prisma.reportSchedule.create({
        data: {
          organizationId,
          name: body.name,
          type: body.type,
          format: body.format,
          frequency: body.frequency,
          recipients: body.recipients,
          siteId: body.siteId ?? null,
          active: body.active,
          timezone: body.timezone,
          scheduledHour: body.scheduledHour,
          scheduledMinute: body.scheduledMinute,
          scheduledWeekday: body.scheduledWeekday ?? defaultWeekday(body.startAt),
          scheduledMonthDay: body.scheduledMonthDay ?? defaultMonthDay(body.startAt),
          startAt: body.startAt ?? null,
          nextRunAt: body.active ? nextScheduledRun(body) : null,
        },
        include: { site: { select: { id: true, name: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'report.schedule.create', target: 'ReportSchedule', targetId: schedule.id, ip: req.ip });
      return reply.code(201).send({ schedule });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/schedules/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      const body = scheduleSchema.partial().parse(req.body);
      const visibleSiteIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const current = await assertScheduleAccess(id, organizationId, visibleSiteIds);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleSiteIds);
      if (body.siteId === null && visibleSiteIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      const merged = mergeSchedule(current, body);

      const schedule = await prisma.reportSchedule.update({
        where: { id },
        data: {
          ...body,
          siteId: body.siteId === undefined ? undefined : body.siteId,
          scheduledWeekday: body.scheduledWeekday === undefined ? undefined : body.scheduledWeekday,
          scheduledMonthDay: body.scheduledMonthDay === undefined ? undefined : body.scheduledMonthDay,
          startAt: body.startAt === undefined ? undefined : body.startAt,
          nextRunAt: merged.active ? nextScheduledRun(merged) : null,
        },
        include: { site: { select: { id: true, name: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'report.schedule.update', target: 'ReportSchedule', targetId: id, ip: req.ip });
      return reply.send({ schedule });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/schedules/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      const visibleSiteIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      await assertScheduleAccess(id, organizationId, visibleSiteIds);
      await prisma.reportSchedule.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'report.schedule.delete', target: 'ReportSchedule', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/schedules/:id/test', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      const visibleSiteIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const schedule = await prisma.reportSchedule.findFirst({
        where: { id, organizationId },
        include: { organization: { select: { name: true } }, site: { select: { name: true } } },
      });
      if (!schedule) throw new HttpError(404, 'Rapport planifié introuvable');
      if (schedule.siteId && visibleSiteIds !== null && !visibleSiteIds.includes(schedule.siteId)) throw new HttpError(403, 'Accès non autorisé à ce rapport');
      if (schedule.recipients.length === 0) throw new HttpError(400, 'Ajoutez au moins un destinataire avant de tester l’envoi');

      const artifact = await buildReportArtifact({
        organizationId,
        visibleSiteIds,
        siteId: schedule.siteId ?? undefined,
        filename: `${schedule.type.toLowerCase()}.${schedule.format.toLowerCase()}`,
      });
      await sendScheduleEmail(schedule, artifact, true);
      await audit({ userId: req.user!.sub, organizationId, action: 'report.schedule.test', target: 'ReportSchedule', targetId: id, ip: req.ip });
      return reply.send({
        success: true,
        delivered: hasSmtpConfig(),
        recipients: schedule.recipients,
        message: hasSmtpConfig()
          ? 'Email de test envoyé'
          : 'Email de test simulé : SMTP non configuré dans cet environnement',
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

export async function processDueReportSchedules(logger?: { error: (value: unknown, message?: string) => void }) {
  const schedules = await prisma.reportSchedule.findMany({
    where: { active: true, nextRunAt: { lte: new Date() }, recipients: { isEmpty: false } },
    take: 10,
    orderBy: { nextRunAt: 'asc' },
    include: { organization: { select: { name: true } }, site: { select: { name: true } } },
  });

  for (const schedule of schedules) {
    try {
      const artifact = await buildReportArtifact({
        organizationId: schedule.organizationId,
        visibleSiteIds: null,
        siteId: schedule.siteId ?? undefined,
        filename: `${schedule.type.toLowerCase()}.${schedule.format.toLowerCase()}`,
      });
      await sendScheduleEmail(schedule, artifact, false);
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { lastRunAt: new Date(), nextRunAt: nextScheduledRun(schedule, new Date(Date.now() + 60_000)) },
      });
    } catch (error) {
      logger?.error(error, 'Échec envoi rapport planifié');
      await prisma.reportSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: nextScheduledRun(schedule, new Date(Date.now() + 60_000)) },
      }).catch(() => undefined);
    }
  }
}

async function sendScheduleEmail(
  schedule: {
    name: string;
    type: ReportType;
    recipients: string[];
    organization: { name: string };
    site?: { name: string } | null;
  },
  artifact: ReportArtifact,
  test: boolean,
) {
  const scope = schedule.site?.name ? `Site : ${schedule.site.name}` : 'Tous les sites';
  if (test && !hasSmtpConfig()) {
    console.info(`[email:test] SMTP non configuré, simulation pour ${schedule.recipients.join(', ')} (${schedule.name})`);
    return;
  }

  await Promise.all(schedule.recipients.map((to) => sendEmail({
    to,
    subject: `[Orbis] ${test ? 'TEST - ' : ''}${schedule.name}`,
    text: [
      test ? 'Email de test de rapport planifié Orbis.' : `Rapport planifié : ${schedule.name}`,
      `Organisation : ${schedule.organization.name}`,
      scope,
      `Type : ${schedule.type}`,
      '',
      'Le rapport est joint à cet email.',
    ].join('\n'),
    attachments: [{
      filename: artifact.filename,
      content: artifact.body,
      contentType: artifact.contentType,
    }],
  })));
}

type ReportArtifact = {
  filename: string;
  contentType: string;
  body: string | Buffer;
};

async function buildReportArtifact(input: {
  organizationId: string;
  visibleSiteIds: string[] | null;
  filename: string;
  siteId?: string;
  diagramId?: string;
}): Promise<ReportArtifact> {
  const normalized = input.filename.toLowerCase();
  const [kind, extension] = normalized.split('.');
  if (!kind || !extension) throw new HttpError(404, 'Rapport introuvable');
  const siteScope = input.siteId ? await scopedSiteFilter(input.siteId, input.organizationId, input.visibleSiteIds) : null;
  const visibleSiteIds = siteScope?.siteId?.in ?? input.visibleSiteIds;

  if (extension === 'csv') {
    if (kind === 'inventory') return csvArtifact('inventaire', await inventoryRows(input.organizationId, visibleSiteIds));
    if (kind === 'ipam') return csvArtifact('ipam', await ipamRows(input.organizationId, visibleSiteIds));
    if (kind === 'changes') return csvArtifact('changements', await changesRows(input.organizationId, visibleSiteIds));
    if (kind === 'topology') return csvArtifact('topologie', await topologyRows(input.organizationId, visibleSiteIds, undefined, input.diagramId));
    if (kind === 'availability') return csvArtifact('disponibilite', await availabilityRows(input.organizationId, visibleSiteIds));
    if (kind === 'risks') return csvArtifact('risques', await risksRows(input.organizationId, visibleSiteIds));
    if (kind === 'capacity') return csvArtifact('capacite', await capacityRows(input.organizationId, visibleSiteIds));
  }

  if (extension === 'pdf') {
    if (kind === 'inventory') return pdfArtifact('inventaire', await inventoryPdf(input.organizationId, visibleSiteIds));
    if (kind === 'ipam') return pdfArtifact('ipam', rowsPdf('Rapport IPAM Orbis', await ipamRows(input.organizationId, visibleSiteIds)));
    if (kind === 'changes') return pdfArtifact('changements', rowsPdf('Rapport changements Orbis', await changesRows(input.organizationId, visibleSiteIds)));
    if (kind === 'topology') return pdfArtifact('topologie', await topologyPdf(input.organizationId, visibleSiteIds, undefined, input.diagramId));
    if (kind === 'availability') return pdfArtifact('disponibilite', await availabilityPdf(input.organizationId, visibleSiteIds));
    if (kind === 'risks') return pdfArtifact('risques', await risksPdf(input.organizationId, visibleSiteIds));
    if (kind === 'capacity') return pdfArtifact('capacite', await capacityPdf(input.organizationId, visibleSiteIds));
  }

  throw new HttpError(404, 'Rapport introuvable');
}

async function inventoryRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const devices = await prisma.device.findMany({
    where: scopedWhere(organizationId, visibleSiteIds, siteId),
    orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
    include: { site: { select: { name: true } } },
  });
  return devices.map((device) => ({
    nom: device.name,
    type: device.type,
    statut: device.status,
    site: device.site?.name ?? '',
    marque: device.brand ?? '',
    modele: device.model ?? '',
    serie: device.serial ?? '',
    ip: device.ip ?? '',
    mac: device.mac ?? '',
    vlan: device.vlan ?? '',
    responsable: device.owner ?? '',
    emplacement: device.location ?? '',
    tags: device.tags.join('|'),
    maj: device.updatedAt.toISOString(),
  }));
}

async function ipamRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const where = scopedWhere(organizationId, visibleSiteIds, siteId);
  const [vlans, prefixes, addresses] = await Promise.all([
    prisma.vlan.findMany({ where, orderBy: { vlanId: 'asc' }, include: { site: { select: { name: true } } } }),
    prisma.ipPrefix.findMany({ where, orderBy: { cidr: 'asc' }, include: { site: { select: { name: true } }, vlan: { select: { vlanId: true, name: true } } } }),
    prisma.ipAddress.findMany({ where, orderBy: { address: 'asc' }, include: { site: { select: { name: true } }, prefix: { select: { cidr: true } }, device: { select: { name: true } } } }),
  ]);
  return [
    ...vlans.map((vlan) => ({
      type: 'VLAN',
      site: vlan.site?.name ?? '',
      identifiant: String(vlan.vlanId),
      nom: vlan.name,
      statut: '',
      rattachement: '',
      description: vlan.description ?? '',
    })),
    ...prefixes.map((prefix) => ({
      type: 'PREFIX',
      site: prefix.site?.name ?? '',
      identifiant: prefix.cidr,
      nom: prefix.name ?? '',
      statut: '',
      rattachement: prefix.vlan ? `VLAN ${prefix.vlan.vlanId} - ${prefix.vlan.name}` : '',
      description: prefix.description ?? '',
    })),
    ...addresses.map((address) => ({
      type: 'IP',
      site: address.site?.name ?? '',
      identifiant: address.address,
      nom: address.dnsName ?? '',
      statut: address.status,
      rattachement: address.device?.name ?? address.prefix?.cidr ?? '',
      description: address.description ?? '',
    })),
  ];
}

async function changesRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const events = await prisma.discoveryEvent.findMany({
    where: scopedWhere(organizationId, visibleSiteIds, siteId),
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      site: { select: { name: true } },
      device: { select: { name: true, ip: true } },
      collector: { select: { name: true } },
    },
  });
  return events.map((event) => ({
    date: event.createdAt.toISOString(),
    severite: event.severity,
    type: event.type,
    titre: event.title,
    site: event.site?.name ?? '',
    equipement: event.device?.name ?? '',
    ip: event.device?.ip ?? '',
    collector: event.collector?.name ?? '',
    acquitte: event.acknowledgedAt ? event.acknowledgedAt.toISOString() : '',
  }));
}

async function topologyRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string, diagramId?: string) {
  const diagram = await prisma.diagram.findFirst({
    where: { organizationId, ...siteFilter(visibleSiteIds), ...(siteId ? { siteId } : {}), ...(diagramId ? { id: diagramId } : {}) },
    orderBy: { updatedAt: 'desc' },
    include: { site: { select: { name: true } } },
  });
  if (!diagram) return [];
  const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : [];
  const edges = Array.isArray(diagram.edges) ? diagram.edges : [];
  return [
    ...nodes.map((node: any) => ({
      type: 'NODE',
      schema: diagram.name,
      site: diagram.site?.name ?? '',
      source: node.id,
      cible: '',
      libelle: node.data?.label ?? '',
      meta: node.data?.type ?? node.type ?? '',
    })),
    ...edges.map((edge: any) => ({
      type: 'LINK',
      schema: diagram.name,
      site: diagram.site?.name ?? '',
      source: edge.source,
      cible: edge.target,
      libelle: edge.data?.label ?? edge.label ?? '',
      meta: edge.data?.speed ?? '',
    })),
  ];
}

async function availabilityRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const policy = await prisma.monitoringPolicy.findUnique({ where: { organizationId } });
  const samples = await prisma.availabilitySample.findMany({
    where: { ...scopedWhere(organizationId, visibleSiteIds, siteId), checkedAt: { gte: since } },
    include: { device: { select: { name: true, ip: true, status: true } }, site: { select: { name: true } } },
    orderBy: { checkedAt: 'desc' },
    take: 5000,
  });
  const byDevice = new Map<string, typeof samples>();
  for (const sample of samples) byDevice.set(sample.deviceId, [...(byDevice.get(sample.deviceId) ?? []), sample]);
  return [...byDevice.values()].map((rows) => {
    const up = rows.filter((sample) => sample.status === 'ONLINE').length;
    const availability = rows.length === 0 ? 100 : Math.round((up / rows.length) * 10_000) / 100;
    const latencies = rows.map((sample) => sample.latencyMs).filter((value): value is number => typeof value === 'number');
    return {
      equipement: rows[0].device.name,
      site: rows[0].site?.name ?? '',
      ip: rows[0].device.ip ?? '',
      disponibilite_30j: `${availability}%`,
      cible_slo: `${policy?.availabilityTargetPct ?? 99}%`,
      slo_respecte: availability >= (policy?.availabilityTargetPct ?? 99) ? 'oui' : 'non',
      latence_moyenne_ms: latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : '',
      dernier_statut: rows[0].device.status,
      dernier_check: rows[0].checkedAt.toISOString(),
    };
  });
}

async function risksRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const events = await prisma.discoveryEvent.findMany({
    where: { ...scopedWhere(organizationId, visibleSiteIds, siteId), severity: { in: ['CRITICAL', 'WARNING'] }, acknowledgedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { site: { select: { name: true } }, device: { select: { name: true, ip: true } } },
  });
  return events.map((event) => ({
    date: event.createdAt.toISOString(),
    severite: event.severity,
    type: event.type,
    titre: event.title,
    site: event.site?.name ?? '',
    equipement: event.device?.name ?? '',
    ip: event.device?.ip ?? '',
  }));
}

async function capacityRows(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const [racks, prefixes, vlans] = await Promise.all([
    prisma.rack.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), include: { site: { select: { name: true } }, _count: { select: { slots: true } } }, orderBy: { name: 'asc' } }),
    prisma.ipPrefix.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), include: { site: { select: { name: true } }, _count: { select: { addresses: true } } }, orderBy: { cidr: 'asc' } }),
    prisma.vlan.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), include: { site: { select: { name: true } }, _count: { select: { prefixes: true } } }, orderBy: { vlanId: 'asc' } }),
  ]);
  return [
    ...racks.map((rack) => ({ type: 'RACK', site: rack.site?.name ?? '', nom: rack.name, capacite: `${rack.totalUnits}U`, utilise: rack._count.slots })),
    ...prefixes.map((prefix) => ({ type: 'PREFIX', site: prefix.site?.name ?? '', nom: prefix.cidr, capacite: '', utilise: prefix._count.addresses })),
    ...vlans.map((vlan) => ({ type: 'VLAN', site: vlan.site?.name ?? '', nom: `VLAN ${vlan.vlanId} - ${vlan.name}`, capacite: '', utilise: vlan._count.prefixes })),
  ];
}

async function inventoryPdf(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const rows = await inventoryRows(organizationId, visibleSiteIds, siteId);
  const byStatus = groupCount(rows, 'statut');
  const byType = groupCount(rows, 'type');
  return simplePdf('Rapport inventaire Orbis', [
    { heading: 'Synthèse', lines: [`Équipements : ${rows.length}`, ...formatGroup('Statuts', byStatus), ...formatGroup('Types', byType)] },
    { heading: 'Équipements', lines: rows.slice(0, 120).map((row) => `${row.nom} | ${row.type} | ${row.statut} | ${row.site} | ${row.ip}`) },
  ]);
}

function rowsPdf(title: string, rows: Array<Record<string, unknown>>) {
  return simplePdf(title, [
    { heading: 'Synthèse', lines: [`Lignes : ${rows.length}`] },
    { heading: 'Données', lines: rows.slice(0, 160).map((row) => Object.values(row).map((value) => String(value ?? '')).join(' | ')) },
  ]);
}

async function topologyPdf(organizationId: string, visibleSiteIds: string[] | null, siteId?: string, diagramId?: string) {
  const where: Prisma.DiagramWhereInput = { organizationId, ...siteFilter(visibleSiteIds), ...(siteId ? { siteId } : {}), ...(diagramId ? { id: diagramId } : {}) };
  const diagram = await prisma.diagram.findFirst({ where, orderBy: { updatedAt: 'desc' }, include: { site: { select: { name: true } } } });
  if (!diagram) throw new HttpError(404, 'Schéma introuvable');
  const nodes = Array.isArray(diagram.nodes) ? diagram.nodes : [];
  const edges = Array.isArray(diagram.edges) ? diagram.edges : [];
  return simplePdf('Rapport topologie Orbis', [
    { heading: 'Schéma', lines: [`Nom : ${diagram.name}`, `Site : ${diagram.site?.name ?? 'Tous sites'}`, `Version : ${diagram.version}`, `Nœuds : ${nodes.length}`, `Liens : ${edges.length}`] },
    { heading: 'Nœuds', lines: nodes.slice(0, 120).map((node: any) => `${node.data?.label ?? node.id} | ${node.data?.type ?? node.type ?? ''}`) },
    { heading: 'Liens', lines: edges.slice(0, 120).map((edge: any) => `${edge.source} -> ${edge.target} | ${edge.data?.label ?? edge.label ?? ''}`) },
  ]);
}

async function availabilityPdf(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const [devices, runs, rows, incidents] = await Promise.all([
    prisma.device.groupBy({ by: ['status'], where: scopedWhere(organizationId, visibleSiteIds, siteId), _count: true }),
    prisma.discoveryRun.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), orderBy: { createdAt: 'desc' }, take: 20, include: { collector: { select: { name: true } }, site: { select: { name: true } } } }),
    availabilityRows(organizationId, visibleSiteIds, siteId),
    prisma.incident.findMany({ where: { ...scopedWhere(organizationId, visibleSiteIds, siteId), status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, orderBy: { lastEventAt: 'desc' }, take: 20, include: { device: { select: { name: true } }, site: { select: { name: true } } } }),
  ]);
  return simplePdf('Rapport disponibilité Orbis', [
    { heading: 'Statuts équipements', lines: devices.map((row) => `${row.status} : ${row._count}`) },
    { heading: 'SLO disponibilité 30 jours', lines: rows.map((row) => `${row.equipement} | ${row.site} | ${row.disponibilite_30j} | SLO ${row.slo_respecte} | latence ${row.latence_moyenne_ms || 'n/a'} ms`) },
    { heading: 'Incidents ouverts', lines: incidents.map((incident) => `${incident.severity} | ${incident.title} | ${incident.device?.name ?? ''} | ${incident.site?.name ?? ''}`) },
    { heading: 'Derniers runs collector', lines: runs.map((run) => `${run.createdAt.toISOString()} | ${run.collector.name} | ${run.site?.name ?? ''} | ${run.status}`) },
  ]);
}

async function risksPdf(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const [events, devices] = await Promise.all([
    prisma.discoveryEvent.findMany({ where: { ...scopedWhere(organizationId, visibleSiteIds, siteId), severity: { in: ['CRITICAL', 'WARNING'] }, acknowledgedAt: null }, orderBy: { createdAt: 'desc' }, take: 80, include: { site: { select: { name: true } } } }),
    prisma.device.findMany({ where: { ...scopedWhere(organizationId, visibleSiteIds, siteId), status: { in: ['OFFLINE', 'WARNING'] } }, orderBy: { updatedAt: 'desc' }, take: 80, include: { site: { select: { name: true } } } }),
  ]);
  return simplePdf('Rapport risques Orbis', [
    { heading: 'Alertes ouvertes', lines: events.map((event) => `${event.severity} | ${event.title} | ${event.site?.name ?? ''}`) },
    { heading: 'Équipements à surveiller', lines: devices.map((device) => `${device.status} | ${device.name} | ${device.site?.name ?? ''} | ${device.ip ?? ''}`) },
  ]);
}

async function capacityPdf(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  const [racks, prefixes, vlans] = await Promise.all([
    prisma.rack.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), include: { site: { select: { name: true } }, _count: { select: { slots: true } } }, orderBy: { name: 'asc' } }),
    prisma.ipPrefix.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), include: { site: { select: { name: true } }, _count: { select: { addresses: true } } }, orderBy: { cidr: 'asc' } }),
    prisma.vlan.findMany({ where: scopedWhere(organizationId, visibleSiteIds, siteId), include: { site: { select: { name: true } }, _count: { select: { prefixes: true } } }, orderBy: { vlanId: 'asc' } }),
  ]);
  return simplePdf('Rapport capacité Orbis', [
    { heading: 'Baies', lines: racks.map((rack) => `${rack.name} | ${rack.site?.name ?? ''} | ${rack._count.slots} équipements | ${rack.totalUnits}U`) },
    { heading: 'Préfixes IP', lines: prefixes.map((prefix) => `${prefix.cidr} | ${prefix.site?.name ?? ''} | ${prefix._count.addresses} adresses`) },
    { heading: 'VLANs', lines: vlans.map((vlan) => `VLAN ${vlan.vlanId} | ${vlan.name} | ${vlan.site?.name ?? ''} | ${vlan._count.prefixes} préfixes`) },
  ]);
}

async function visibleScope(userId: string, organizationId: string, role: any, siteId?: string) {
  const visibleSiteIds = await getVisibleSiteIds(userId, organizationId, role);
  if (siteId) await assertCanAccessSite(siteId, organizationId, visibleSiteIds);
  return visibleSiteIds;
}

async function assertScheduleAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const schedule = await prisma.reportSchedule.findFirst({ where: { id, organizationId } });
  if (!schedule) throw new HttpError(404, 'Rapport planifié introuvable');
  if (schedule.siteId && visibleSiteIds !== null && !visibleSiteIds.includes(schedule.siteId)) throw new HttpError(403, 'Accès non autorisé à ce rapport');
  return schedule;
}

function scopedWhere(organizationId: string, visibleSiteIds: string[] | null, siteId?: string) {
  return { organizationId, ...(siteId ? { siteId } : siteFilter(visibleSiteIds)) };
}

function csvArtifact(name: string, rows: Array<Record<string, unknown>>): ReportArtifact {
  return {
    filename: `orbis-${name}-${dateStamp()}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: `\ufeff${csv(rows)}\n`,
  };
}

function pdfArtifact(name: string, body: Buffer): ReportArtifact {
  return {
    filename: `orbis-${name}-${dateStamp()}.pdf`,
    contentType: 'application/pdf',
    body,
  };
}

function sendDownload(reply: any, artifact: ReportArtifact) {
  return reply
    .header('Content-Type', artifact.contentType)
    .header('Content-Disposition', `attachment; filename="${artifact.filename}"`)
    .send(artifact.body);
}

type ScheduleTiming = {
  frequency: ReportFrequency;
  timezone?: string;
  scheduledHour?: number;
  scheduledMinute?: number;
  scheduledWeekday?: number | null;
  scheduledMonthDay?: number | null;
  startAt?: Date | string | null;
  active?: boolean;
};

function nextScheduledRun(schedule: ScheduleTiming, from = new Date()) {
  const startAt = schedule.startAt ? new Date(schedule.startAt) : null;
  if (startAt && startAt.getTime() > from.getTime()) return startAt;

  const timezone = schedule.timezone || 'Europe/Paris';
  const hour = schedule.scheduledHour ?? 8;
  const minute = schedule.scheduledMinute ?? 0;
  const now = zonedParts(from, timezone);
  const monthDay = clampMonthDay(schedule.scheduledMonthDay ?? now.day);

  if (schedule.frequency === 'WEEKLY') {
    const weekday = schedule.scheduledWeekday ?? now.weekday;
    for (let offset = 0; offset <= 14; offset += 1) {
      const candidateBase = new Date(Date.UTC(now.year, now.month - 1, now.day + offset, 12, 0, 0));
      const parts = zonedParts(candidateBase, timezone);
      if (parts.weekday !== weekday) continue;
      const candidate = zonedTimeToUtc(parts.year, parts.month, parts.day, hour, minute, timezone);
      if (candidate.getTime() > from.getTime()) return candidate;
    }
  }

  const step = schedule.frequency === 'QUARTERLY' ? 3 : 1;
  for (let offset = 0; offset <= 24; offset += step) {
    const targetMonthIndex = now.month - 1 + offset;
    const year = now.year + Math.floor(targetMonthIndex / 12);
    const month = (targetMonthIndex % 12) + 1;
    const day = Math.min(monthDay, daysInMonth(year, month));
    const candidate = zonedTimeToUtc(year, month, day, hour, minute, timezone);
    if (candidate.getTime() > from.getTime()) return candidate;
  }

  return new Date(from.getTime() + 24 * 60 * 60_000);
}

function mergeSchedule(current: any, patch: Partial<ScheduleTiming>) {
  return {
    frequency: patch.frequency ?? current.frequency,
    timezone: patch.timezone ?? current.timezone,
    scheduledHour: patch.scheduledHour ?? current.scheduledHour,
    scheduledMinute: patch.scheduledMinute ?? current.scheduledMinute,
    scheduledWeekday: patch.scheduledWeekday === undefined ? current.scheduledWeekday : patch.scheduledWeekday,
    scheduledMonthDay: patch.scheduledMonthDay === undefined ? current.scheduledMonthDay : patch.scheduledMonthDay,
    startAt: patch.startAt === undefined ? current.startAt : patch.startAt,
    active: patch.active ?? current.active,
  };
}

function defaultWeekday(startAt?: Date | null) {
  if (!startAt) return 1;
  const day = startAt.getDay();
  return day === 0 ? 7 : day;
}

function defaultMonthDay(startAt?: Date | null) {
  return startAt?.getDate() ?? 1;
}

function clampMonthDay(value: number) {
  return Math.max(1, Math.min(31, value));
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(value('year')),
    month: Number(value('month')),
    day: Number(value('day')),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
    weekday: weekdayMap[value('weekday')] ?? 1,
  };
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const parts = zonedParts(new Date(utcGuess), timezone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return new Date(utcGuess - (zonedAsUtc - utcGuess));
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function groupCount(rows: Array<Record<string, unknown>>, key: string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(String(row[key] ?? 'N/A'), (counts.get(String(row[key] ?? 'N/A')) ?? 0) + 1);
  return counts;
}

function formatGroup(label: string, counts: Map<string, number>) {
  return [`${label} :`, ...[...counts.entries()].map(([key, value]) => `- ${key} : ${value}`)];
}
