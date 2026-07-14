import { FastifyInstance } from 'fastify';
import { DeviceType, DiscoveryCollectorRole, Prisma } from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { assertCanAccessSite, getVisibleSiteIds, scopedSiteFilter, siteFilter } from '../services/scope.js';
import { notifyDiscoveryEvents } from '../services/alerts.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { autoLayout, roleToRank, type TopologyRole } from '../services/autoLayout.js';
import { lookupVendorByMac } from '../services/ouiDb.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';
import {
  activeMaintenanceWindows,
  buildLatencyEvents,
  healthyLatencyDeviceIds,
  inMaintenance,
  pruneMonitoringData,
  recordAvailabilitySamples,
  resolveHealthyLatencyIncidents,
  upsertMonitoringIncidents,
} from '../services/monitoring.js';

const DEFAULT_COLLECTOR_PORTS = [22, 80, 443, 445, 3389, 8080, 8443, 9100];

const createCollectorSchema = z.object({
  name: z.string().trim().min(2, 'Nom du collector requis').max(120),
  siteId: z.string().optional().nullable(),
  defaultCidrs: z.array(z.string().trim().min(7).max(32)).max(20).default([]),
  defaultPorts: z.array(z.coerce.number().int().min(1).max(65_535)).max(32).default(DEFAULT_COLLECTOR_PORTS),
  autoDiagram: z.boolean().default(true),
  role: z.nativeEnum(DiscoveryCollectorRole).default('PRIMARY'),
  priority: z.coerce.number().int().min(1).max(10_000).default(100),
  failoverAfterMinutes: z.coerce.number().int().min(1).max(1440).default(15),
  tokenRotationDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  tokenExpiresAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2_000).optional().nullable(),
});

const updateCollectorSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  siteId: z.string().optional().nullable(),
  defaultCidrs: z.array(z.string().trim().min(7).max(32)).max(20).optional(),
  defaultPorts: z.array(z.coerce.number().int().min(1).max(65_535)).max(32).optional(),
  autoDiagram: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'REVOKED']).optional(),
  role: z.nativeEnum(DiscoveryCollectorRole).optional(),
  priority: z.coerce.number().int().min(1).max(10_000).optional(),
  failoverAfterMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  tokenRotationDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  tokenExpiresAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(2_000).optional().nullable(),
});

const rotateTokenSchema = z.object({
  tokenRotationDays: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  tokenExpiresAt: z.coerce.date().optional().nullable(),
});

const downloadFileSchema = z.object({
  file: z.string().regex(/^[A-Za-z0-9._-]+$/, 'Nom de fichier invalide'),
});

const ingestSchema = z.object({
  run: z.object({
    status: z.enum(['SUCCESS', 'PARTIAL', 'FAILED']).default('SUCCESS'),
    startedAt: z.string().datetime().optional().nullable(),
    finishedAt: z.string().datetime().optional().nullable(),
    version: z.string().max(80).optional().nullable(),
    cidrs: z.array(z.string()).max(50).default([]),
    ports: z.array(z.number().int().min(1).max(65_535)).max(128).default([]),
  }),
  hosts: z.array(z.object({
    address: z.string().ip({ version: 'v4' }),
    hostname: z.string().trim().max(255).optional().nullable(),
    sysName: z.string().trim().max(255).optional().nullable(),
    sysDescr: z.string().trim().max(2_000).optional().nullable(),
    sysObjectId: z.string().trim().max(255).optional().nullable(),
    uptime: z.number().nonnegative().optional().nullable(),
    model: z.string().trim().max(120).optional().nullable(),
    serial: z.string().trim().max(120).optional().nullable(),
    mac: z.string().trim().max(40).optional().nullable(),
    vendor: z.string().trim().max(120).optional().nullable(),
    openPorts: z.array(z.number().int().min(1).max(65_535)).max(128).default([]),
    interfaces: z.array(z.object({
      index: z.number().int().positive(),
      name: z.string().trim().max(120).optional().nullable(),
      description: z.string().trim().max(255).optional().nullable(),
      alias: z.string().trim().max(255).optional().nullable(),
      mac: z.string().trim().max(40).optional().nullable(),
      adminStatus: z.number().int().optional().nullable(),
      operStatus: z.number().int().optional().nullable(),
      speed: z.number().nonnegative().optional().nullable(),
    })).max(2_000).default([]),
    routeEntries: z.array(z.object({
      destination: z.string().ip({ version: 'v4' }),
      mask: z.string().ip({ version: 'v4' }).optional().nullable(),
      nextHop: z.string().ip({ version: 'v4' }).optional().nullable(),
      interfaceIndex: z.number().int().positive().optional().nullable(),
    })).max(20_000).default([]),
    serviceBanners: z.array(z.object({
      port: z.number().int().min(1).max(65_535),
      service: z.string().trim().max(80).optional().nullable(),
      product: z.string().trim().max(160).optional().nullable(),
      banner: z.string().trim().max(500).optional().nullable(),
    })).max(512).default([]),
    cloud: z.object({
      provider: z.enum(['AWS', 'AZURE', 'GCP']),
      account: z.string().trim().max(160).optional().nullable(),
      region: z.string().trim().max(120).optional().nullable(),
      resourceId: z.string().trim().min(1).max(300),
      resourceType: z.string().trim().max(120).optional().nullable(),
      privateIp: z.string().ip({ version: 'v4' }).optional().nullable(),
      publicIp: z.string().ip({ version: 'v4' }).optional().nullable(),
      tags: z.record(z.string()).optional(),
    }).optional().nullable(),
    virtual: z.object({
      platform: z.enum(['VMWARE', 'PROXMOX', 'HYPER_V']),
      cluster: z.string().trim().max(160).optional().nullable(),
      host: z.string().trim().max(160).optional().nullable(),
      vmId: z.string().trim().min(1).max(300),
      guestOs: z.string().trim().max(160).optional().nullable(),
      powerState: z.string().trim().max(80).optional().nullable(),
      ip: z.string().ip({ version: 'v4' }).optional().nullable(),
    }).optional().nullable(),
    arpEntries: z.array(z.object({
      address: z.string().ip({ version: 'v4' }),
      mac: z.string().trim().max(40),
      interfaceIndex: z.number().int().positive().optional().nullable(),
    })).max(10_000).default([]),
    macTable: z.array(z.object({
      mac: z.string().trim().max(40),
      interfaceIndex: z.number().int().positive().optional().nullable(),
      bridgePort: z.number().int().positive().optional().nullable(),
      vlan: z.number().int().min(1).max(4094).optional().nullable(),
    })).max(20_000).default([]),
    vlans: z.array(z.object({
      vlanId: z.number().int().min(1).max(4094),
      name: z.string().trim().max(120).optional().nullable(),
    })).max(4096).default([]),
    confidence: z.number().int().min(0).max(100).optional().nullable(),
    sources: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    latencyMs: z.number().nonnegative().max(60_000).optional().nullable(),
    source: z.enum(['TCP', 'ICMP', 'ARP', 'SNMP', 'MANUAL', 'CLOUD', 'VIRTUAL']).default('TCP'),
  })).max(2_000).default([]),
  links: z.array(z.object({
    localDevice: z.string().trim().min(1).max(120),
    localPort: z.string().trim().max(120).optional().nullable(),
    remoteDevice: z.string().trim().min(1).max(120),
    remotePort: z.string().trim().max(120).optional().nullable(),
    protocol: z.enum(['CDP', 'LLDP', 'SNMP', 'MANUAL']).default('LLDP'),
    speed: z.string().trim().max(40).optional().nullable(),
    vlan: z.string().trim().max(80).optional().nullable(),
    confidence: z.number().int().min(0).max(100).optional().nullable(),
  })).max(5_000).default([]),
});

const collectorLogSchema = z.object({
  level: z.enum(['INFO', 'WARNING', 'ERROR', 'DIAGNOSTIC']).default('INFO'),
  message: z.string().trim().min(1).max(500),
  meta: z.any().optional().nullable(),
  version: z.string().trim().max(80).optional().nullable(),
});

type HostPayload = z.infer<typeof ingestSchema>['hosts'][number];
type LinkPayload = z.infer<typeof ingestSchema>['links'][number];
type DeviceLite = { id: string; name: string; type: DeviceType; siteId: string | null; customFields?: Prisma.JsonValue | null };
type SeenDevice = { device: DeviceLite; host: HostPayload; created: boolean; updated: boolean };

export default async function collectorsRoutes(app: FastifyInstance) {
  app.get('/downloads', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (_req, reply) => {
    try {
      const root = await resolveCollectorDownloadsRoot();
      const manifestPath = path.join(root, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const files = await Promise.all((manifest.files ?? []).map(async (item: any) => {
        const filePath = path.join(root, item.file);
        const info = await stat(filePath);
        return { ...item, size: info.size, updatedAt: info.mtime.toISOString() };
      }));
      return reply.send({ version: manifest.version, files });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/downloads/:file', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { file } = downloadFileSchema.parse(req.params);
      const root = await resolveCollectorDownloadsRoot();
      const files = await readdir(root);
      if (!files.includes(file)) throw new HttpError(404, 'Artefact collector introuvable');
      const filePath = path.join(root, file);
      const info = await stat(filePath);
      return reply
        .header('Content-Type', contentTypeFor(file))
        .header('Content-Length', String(info.size))
        .header('Content-Disposition', `attachment; filename="${file}"`)
        .send(createReadStream(filePath));
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const q = req.query as { siteId?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const where = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      const [collectors, total] = await Promise.all([
        prisma.discoveryCollector.findMany({
          where,
          orderBy: [{ status: 'asc' }, { priority: 'asc' }, { updatedAt: 'desc' }],
          skip: pagination.skip,
          take: pagination.take,
          include: {
            site: { select: { id: true, name: true } },
            runs: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: { id: true, status: true, summary: true, createdAt: true, startedAt: true, finishedAt: true },
            },
            states: {
              orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
              take: 8,
              include: { device: { select: { id: true, name: true, type: true, status: true, ip: true } } },
            },
            events: {
              orderBy: { createdAt: 'desc' },
              take: 10,
              include: { device: { select: { id: true, name: true, type: true, ip: true } } },
            },
            logs: {
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: { id: true, level: true, message: true, meta: true, createdAt: true },
            },
          },
        }),
        prisma.discoveryCollector.count({ where }),
      ]);
      const groups = buildCollectorFailoverGroups(collectors);
      const enriched = collectors.map((collector) => ({
        ...collector,
        tokenRotationDue: isTokenRotationDue(collector),
        tokenExpiresSoon: isTokenExpiringSoon(collector.tokenExpiresAt),
        failoverState: groups.get(groupKey(collector.siteId))?.find((item) => item.id === collector.id)?.failoverState ?? 'UNAVAILABLE',
      }));
      return reply.send({ collectors: enriched, failoverGroups: [...groups.values()], pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const body = createCollectorSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const siteId = body.siteId ?? null;
      if (siteId) await assertCanAccessSite(siteId, organizationId, visibleIds);
      if (!siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      await assertTenantQuota(organizationId, 'collectors');

      const token = createCollectorToken();
      const collector = await prisma.discoveryCollector.create({
        data: {
          organizationId,
          siteId,
          name: body.name,
          tokenHash: hashToken(token),
          tokenLastRotatedAt: new Date(),
          tokenExpiresAt: body.tokenExpiresAt ?? calculateTokenExpiresAt(body.tokenRotationDays ?? null),
          tokenRotationDays: body.tokenRotationDays ?? null,
          nextTokenRotationAt: calculateNextTokenRotation(body.tokenRotationDays ?? null),
          role: body.role,
          priority: body.priority,
          failoverAfterMinutes: body.failoverAfterMinutes,
          defaultCidrs: body.defaultCidrs,
          defaultPorts: uniqueNumbers(body.defaultPorts),
          autoDiagram: body.autoDiagram,
          notes: body.notes,
        },
        include: { site: { select: { id: true, name: true } } },
      });

      await audit({
        userId: req.user!.sub,
        organizationId,
        action: 'collector.create',
        target: 'DiscoveryCollector',
        targetId: collector.id,
        ip: req.ip,
      });

      return reply.code(201).send({ collector, token });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const id = z.string().parse((req.params as any).id);
      const { organizationId, role } = req.membership!;
      const body = updateCollectorSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const current = await getCollectorForUser(id, organizationId, visibleIds);
      const siteId = body.siteId === undefined ? current.siteId : body.siteId;
      if (siteId) await assertCanAccessSite(siteId, organizationId, visibleIds);
      if (!siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');

      const collector = await prisma.discoveryCollector.update({
        where: { id },
        data: {
          name: body.name,
          siteId,
          defaultCidrs: body.defaultCidrs,
          defaultPorts: body.defaultPorts ? uniqueNumbers(body.defaultPorts) : undefined,
          autoDiagram: body.autoDiagram,
          status: body.status,
          role: body.role,
          priority: body.priority,
          failoverAfterMinutes: body.failoverAfterMinutes,
          tokenRotationDays: body.tokenRotationDays,
          tokenExpiresAt: body.tokenExpiresAt,
          nextTokenRotationAt: body.tokenRotationDays === undefined
            ? undefined
            : calculateNextTokenRotation(body.tokenRotationDays),
          notes: body.notes,
        },
        include: { site: { select: { id: true, name: true } } },
      });

      await audit({ userId: req.user!.sub, organizationId, action: 'collector.update', target: 'DiscoveryCollector', targetId: id, ip: req.ip });
      return reply.send({ collector });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/:id/rotate-token', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const id = z.string().parse((req.params as any).id);
      const body = rotateTokenSchema.parse(req.body ?? {});
      const { organizationId, role } = req.membership!;
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const current = await getCollectorForUser(id, organizationId, visibleIds);
      const token = createCollectorToken();
      const tokenRotationDays = body.tokenRotationDays !== undefined ? body.tokenRotationDays : current.tokenRotationDays;
      const collector = await prisma.discoveryCollector.update({
        where: { id },
        data: {
          tokenHash: hashToken(token),
          tokenLastRotatedAt: new Date(),
          tokenRotationDays,
          tokenExpiresAt: body.tokenExpiresAt ?? calculateTokenExpiresAt(tokenRotationDays),
          nextTokenRotationAt: calculateNextTokenRotation(tokenRotationDays),
          status: 'ACTIVE',
        },
        include: { site: { select: { id: true, name: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'collector.rotate_token', target: 'DiscoveryCollector', targetId: id, ip: req.ip });
      return reply.send({ collector, token });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const id = z.string().parse((req.params as any).id);
      const { organizationId, role } = req.membership!;
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      await getCollectorForUser(id, organizationId, visibleIds);
      await prisma.discoveryCollector.update({ where: { id }, data: { status: 'REVOKED' } });
      await audit({ userId: req.user!.sub, organizationId, action: 'collector.revoke', target: 'DiscoveryCollector', targetId: id, ip: req.ip });
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

async function resolveCollectorDownloadsRoot() {
  const candidates = [
    path.resolve(process.cwd(), 'collector-downloads/releases'),
    path.resolve(process.cwd(), '../../deploy/releases'),
    path.resolve(process.cwd(), 'deploy/releases'),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, 'manifest.json'));
      return candidate;
    } catch {
      // try next
    }
  }
  throw new HttpError(404, 'Aucun artefact collector publié');
}

function contentTypeFor(file: string) {
  if (file.endsWith('.zip')) return 'application/zip';
  if (file.endsWith('.tar.gz')) return 'application/gzip';
  if (file.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (file.endsWith('.msi')) return 'application/octet-stream';
  return 'application/octet-stream';
}

export async function collectorIngestRoutes(app: FastifyInstance) {
  app.post('/logs', async (req, reply) => {
    try {
      const collector = await authenticateCollector(req.headers);
      const body = collectorLogSchema.parse(req.body);
      await prisma.discoveryCollectorLog.create({
        data: {
          organizationId: collector.organizationId,
          collectorId: collector.id,
          level: body.level,
          message: body.message,
          meta: body.meta ?? undefined,
        },
      });
      await pruneCollectorLogs(collector.id);
      if (body.version) {
        await prisma.discoveryCollector.update({
          where: { id: collector.id },
          data: { lastSeenAt: new Date(), lastIp: req.ip, version: body.version },
        });
      }
      return reply.code(202).send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/ingest', async (req, reply) => {
    try {
      const collector = await authenticateCollector(req.headers);

      const body = ingestSchema.parse(req.body);
      const result = await ingestDiscoveryPayload({
        organizationId: collector.organizationId,
        collectorId: collector.id,
        siteId: collector.siteId,
        autoDiagram: collector.autoDiagram,
        payload: body,
      });

      await prisma.discoveryCollector.update({
        where: { id: collector.id },
        data: {
          lastSeenAt: new Date(),
          lastIp: req.ip,
          version: body.run.version ?? undefined,
          lastSummary: result.summary,
        },
      });

      return reply.code(202).send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

async function authenticateCollector(headers: Record<string, any>) {
  const collectorId = headers['x-collector-id'];
  const auth = headers.authorization ?? '';
  const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
  if (typeof collectorId !== 'string' || !token) throw new HttpError(401, 'Collector non authentifié');

  const collector = await prisma.discoveryCollector.findUnique({
    where: { id: collectorId },
    select: { id: true, organizationId: true, siteId: true, tokenHash: true, tokenExpiresAt: true, status: true, autoDiagram: true },
  });
  if (!collector || collector.status !== 'ACTIVE' || !verifyToken(token, collector.tokenHash)) {
    throw new HttpError(401, 'Collector non authentifié');
  }
  if (collector.tokenExpiresAt && collector.tokenExpiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, 'Collector non authentifié');
  }
  return collector;
}

async function pruneCollectorLogs(collectorId: string) {
  const oldLogs = await prisma.discoveryCollectorLog.findMany({
    where: { collectorId },
    orderBy: { createdAt: 'desc' },
    skip: 200,
    select: { id: true },
  });
  if (oldLogs.length > 0) {
    await prisma.discoveryCollectorLog.deleteMany({ where: { id: { in: oldLogs.map((log) => log.id) } } });
  }
}

async function ingestDiscoveryPayload({
  organizationId,
  collectorId,
  siteId,
  autoDiagram,
  payload,
}: {
  organizationId: string;
  collectorId: string;
  siteId: string | null;
  autoDiagram: boolean;
  payload: z.infer<typeof ingestSchema>;
}) {
  const hosts = enrichHostsFromArp(payload.hosts, payload.run.cidrs);
  const knownDevices = await prisma.device.findMany({
    where: { organizationId },
    select: { id: true, name: true, type: true, siteId: true, ip: true, mac: true, customFields: true },
  });
  const devicesByKey = new Map<string, DeviceLite>();
  for (const device of knownDevices) {
    devicesByKey.set(`name:${normalizeKey(device.name)}`, device);
    if (device.ip) devicesByKey.set(`ip:${device.ip}`, device);
    if (device.mac) devicesByKey.set(`mac:${normalizeMac(device.mac)}`, device);
  }

  let devicesCreated = 0;
  let devicesUpdated = 0;
  let devicesMatched = 0;
  let ipAddressesCreated = 0;
  let ipAddressesMatched = 0;
  let ipConflicts = 0;
  const touchedDevices = new Map<string, DeviceLite>();
  const seenDevices = new Map<string, SeenDevice>();

  for (const host of hosts) {
    const match = await upsertHostDevice(host, organizationId, siteId, devicesByKey);
    if (match.created) devicesCreated += 1;
    else if (match.updated) devicesUpdated += 1;
    else devicesMatched += 1;
    touchedDevices.set(match.device.id, match.device);
    seenDevices.set(match.device.id, { ...match, host });

    const ip = await prisma.ipAddress.findFirst({ where: { organizationId, siteId, address: host.address }, select: { id: true, deviceId: true } });
    if (ip) {
      ipAddressesMatched += 1;
      if (ip.deviceId && ip.deviceId !== match.device.id) ipConflicts += 1;
      await prisma.ipAddress.update({
        where: { id: ip.id },
        data: {
          deviceId: ip.deviceId ?? match.device.id,
          status: 'ASSIGNED',
          dnsName: host.hostname ?? undefined,
          description: buildHostDescription(host),
        },
      });
    } else {
      await assertTenantQuota(organizationId, 'ipAddresses');
      await prisma.ipAddress.create({
        data: {
          organizationId,
          siteId,
          deviceId: match.device.id,
          address: host.address,
          status: 'ASSIGNED',
          dnsName: host.hostname,
          interfaceLabel: host.source.toLowerCase(),
          description: buildHostDescription(host),
        },
      });
      ipAddressesCreated += 1;
    }
  }

  const summary = {
    hostsSeen: hosts.length,
    snmpHosts: hosts.filter((host) => host.sysName || host.sysDescr || host.interfaces.length > 0).length,
    linksSeen: payload.links.length,
    cdpLinks: payload.links.filter((link) => link.protocol === 'CDP').length,
    lldpLinks: payload.links.filter((link) => link.protocol === 'LLDP').length,
    arpEntries: hosts.reduce((sum, host) => sum + host.arpEntries.length, 0),
    macEntries: hosts.reduce((sum, host) => sum + host.macTable.length, 0),
    vlansSeen: uniqueNumbers(hosts.flatMap((host) => host.vlans.map((vlan) => vlan.vlanId))).length,
    routesSeen: hosts.reduce((sum, host) => sum + host.routeEntries.length, 0),
    gatewaysSeen: uniqueStrings(hosts.flatMap((host) => host.routeEntries.map((route) => route.nextHop).filter((value): value is string => Boolean(value)))).length,
    serviceBannersSeen: hosts.reduce((sum, host) => sum + host.serviceBanners.length, 0),
    cloudResources: hosts.filter((host) => host.cloud).length,
    virtualResources: hosts.filter((host) => host.virtual).length,
    confidenceAverage: averageConfidence(hosts),
    ipConflicts,
    devicesCreated,
    devicesUpdated,
    devicesMatched,
    ipAddressesCreated,
    ipAddressesMatched,
    cidrs: payload.run.cidrs,
    ports: payload.run.ports,
  };
  const topologyLinks = dedupeTopologyLinks([
    ...payload.links,
    ...inferLinksFromMacTables(seenDevices),
  ]);
  summary.linksSeen = topologyLinks.length;

  const run = await prisma.discoveryRun.create({
    data: {
      organizationId,
      collectorId,
      siteId,
      status: payload.run.status,
      startedAt: payload.run.startedAt ? new Date(payload.run.startedAt) : null,
      finishedAt: payload.run.finishedAt ? new Date(payload.run.finishedAt) : null,
      summary,
      raw: {
        hosts: hosts.slice(0, 500),
        links: payload.links.slice(0, 1000),
      },
    },
  });
  const conflicts = await createDiscoveryConflictEvents({
    organizationId,
    collectorId,
    siteId,
    runId: run.id,
    hosts,
    ipConflicts: summary.ipConflicts,
  });

  const changes = await updateDiscoveryStates({
    organizationId,
    collectorId,
    siteId,
    runId: run.id,
    cidrs: payload.run.cidrs,
    seenDevices: [...seenDevices.values()],
  });
  const finalSummary = {
    ...summary,
    eventsCreated: changes.eventsCreated + conflicts.eventsCreated,
    ipConflicts: conflicts.ipConflicts,
    macConflicts: conflicts.macConflicts,
    newDevices: changes.newDevices,
    downDevices: changes.downDevices,
    reappearedDevices: changes.reappearedDevices,
    portChanges: changes.portChanges,
    ipChanges: changes.ipChanges,
  };
  await prisma.discoveryRun.update({ where: { id: run.id }, data: { summary: finalSummary } });
  await pruneMonitoringData(organizationId);

  if (autoDiagram && (payload.links.length > 0 || touchedDevices.size > 0)) {
    await upsertCollectorDiagram({
      organizationId,
      siteId,
      devices: [...touchedDevices.values()],
      links: topologyLinks,
      devicesByKey,
    });
  }

  return { runId: run.id, summary: finalSummary };
}

function enrichHostsFromArp(hosts: HostPayload[], cidrs: string[]): HostPayload[] {
  const byAddress = new Map(hosts.map((host) => [host.address, host]));
  for (const source of hosts) {
    for (const entry of source.arpEntries) {
      if (byAddress.has(entry.address)) continue;
      if (!addressInCidrs(entry.address, cidrs)) continue;
      byAddress.set(entry.address, {
        address: entry.address,
        hostname: null,
        sysName: null,
        sysDescr: null,
        sysObjectId: null,
        uptime: null,
        model: null,
        serial: null,
        mac: normalizeMac(entry.mac),
        vendor: inferVendorFromMac(entry.mac),
        openPorts: [],
        interfaces: [],
        routeEntries: [],
        serviceBanners: [],
        cloud: null,
        virtual: null,
        arpEntries: [],
        macTable: [],
        vlans: [],
        confidence: 55,
        sources: ['SNMP_ARP'],
        latencyMs: null,
        source: 'ARP',
      });
    }
  }
  return [...byAddress.values()];
}

function inferLinksFromMacTables(seenDevices: Map<string, SeenDevice>): LinkPayload[] {
  const hostByDeviceId = new Map([...seenDevices.values()].map((item) => [item.device.id, item.host]));
  const deviceByMac = new Map<string, SeenDevice>();
  for (const item of seenDevices.values()) {
    if (item.host.mac) deviceByMac.set(normalizeMac(item.host.mac), item);
  }

  const links: LinkPayload[] = [];
  for (const item of seenDevices.values()) {
    if (item.device.type !== 'SWITCH' && item.device.type !== 'ROUTER' && item.device.type !== 'FIREWALL') continue;
    for (const entry of item.host.macTable) {
      const remote = deviceByMac.get(normalizeMac(entry.mac));
      if (!remote || remote.device.id === item.device.id) continue;
      const localPort = resolveInterfaceName(item.host, entry.interfaceIndex);
      const remoteHost = hostByDeviceId.get(remote.device.id);
      links.push({
        localDevice: item.device.name,
        localPort,
        remoteDevice: remote.device.name,
        remotePort: remoteHost ? resolveInterfaceName(remoteHost, undefined) : null,
        protocol: 'SNMP',
        speed: inferInterfaceSpeed(item.host, entry.interfaceIndex),
        vlan: entry.vlan ? String(entry.vlan) : null,
        confidence: 65,
      });
    }
  }
  return links;
}

function resolveInterfaceName(host: HostPayload, index?: number | null): string | null {
  const match = index ? host.interfaces.find((item) => item.index === index) : host.interfaces[0];
  return match?.name ?? match?.description ?? null;
}

function inferInterfaceSpeed(host: HostPayload, index?: number | null): string | null {
  const match = index ? host.interfaces.find((item) => item.index === index) : null;
  if (!match?.speed) return null;
  if (match.speed >= 100_000_000_000) return '100G';
  if (match.speed >= 40_000_000_000) return '40G';
  if (match.speed >= 25_000_000_000) return '25G';
  if (match.speed >= 10_000_000_000) return '10G';
  if (match.speed >= 1_000_000_000) return '1G';
  if (match.speed >= 100_000_000) return '100M';
  return `${match.speed}`;
}

function dedupeTopologyLinks(links: LinkPayload[]): LinkPayload[] {
  const byKey = new Map<string, LinkPayload>();
  for (const link of links) {
    const key = topologyLinkKey(link);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, link);
      continue;
    }
    byKey.set(key, mergeTopologyLinks(existing, link));
  }
  return [...byKey.values()];
}

function topologyLinkKey(link: LinkPayload): string {
  const a = `${normalizeKey(link.localDevice)}:${normalizePort(link.localPort)}`;
  const b = `${normalizeKey(link.remoteDevice)}:${normalizePort(link.remotePort)}`;
  return [a, b].sort().join('<->');
}

function normalizePort(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '');
}

function mergeTopologyLinks(left: LinkPayload, right: LinkPayload): LinkPayload {
  const protocols = uniqueStrings([left.protocol, right.protocol]);
  const best = (right.confidence ?? 0) > (left.confidence ?? 0) ? right : left;
  return {
    ...best,
    protocol: protocols.includes('LLDP') ? 'LLDP' : protocols.includes('CDP') ? 'CDP' : best.protocol,
    speed: best.speed ?? left.speed ?? right.speed,
    vlan: best.vlan ?? left.vlan ?? right.vlan,
    confidence: Math.max(left.confidence ?? 0, right.confidence ?? 0) || undefined,
  };
}

async function createDiscoveryConflictEvents({
  organizationId,
  collectorId,
  siteId,
  runId,
  hosts,
  ipConflicts,
}: {
  organizationId: string;
  collectorId: string;
  siteId: string | null;
  runId: string;
  hosts: HostPayload[];
  ipConflicts: number;
}) {
  const events: Prisma.DiscoveryEventCreateManyInput[] = [];
  const byMac = new Map<string, HostPayload[]>();
  for (const host of hosts) {
    if (!host.mac) continue;
    const mac = normalizeMac(host.mac);
    byMac.set(mac, [...(byMac.get(mac) ?? []), host]);
  }
  let macConflicts = 0;
  for (const [mac, macHosts] of byMac) {
    const addresses = uniqueStrings(macHosts.map((host) => host.address));
    if (addresses.length <= 1) continue;
    macConflicts += 1;
    events.push(buildDiscoveryEvent({
      organizationId,
      collectorId,
      runId,
      siteId,
      type: 'MAC_CONFLICT',
      severity: 'WARNING',
      title: `MAC vue sur plusieurs IP : ${mac}`,
      message: `La même adresse MAC est associée à ${addresses.join(', ')}.`,
      meta: { mac, addresses },
    }));
  }
  if (ipConflicts > 0) {
    events.push(buildDiscoveryEvent({
      organizationId,
      collectorId,
      runId,
      siteId,
      type: 'IP_CONFLICT',
      severity: 'CRITICAL',
      title: 'Conflit IP détecté',
      message: `${ipConflicts} adresse(s) IP étaient déjà associées à un autre équipement.`,
      meta: { ipConflicts },
    }));
  }
  if (events.length > 0) {
    await prisma.discoveryEvent.createMany({ data: events });
    await notifyDiscoveryEvents(events);
  }
  return { eventsCreated: events.length, ipConflicts, macConflicts };
}

async function updateDiscoveryStates({
  organizationId,
  collectorId,
  siteId,
  runId,
  cidrs,
  seenDevices,
}: {
  organizationId: string;
  collectorId: string;
  siteId: string | null;
  runId: string;
  cidrs: string[];
  seenDevices: SeenDevice[];
}) {
  const now = new Date();
  const seenIds = new Set(seenDevices.map((item) => item.device.id));
  const events: Prisma.DiscoveryEventCreateManyInput[] = [];
  let newDevices = 0;
  let reappearedDevices = 0;
  let downDevices = 0;
  let portChanges = 0;
  let ipChanges = 0;
  const maintenanceWindows = await activeMaintenanceWindows(organizationId, now);
  const downSamples: Array<{ deviceId: string; siteId: string | null }> = [];
  const monitoringSeen = seenDevices.map((item) => ({
    deviceId: item.device.id,
    deviceName: item.device.name,
    siteId: item.device.siteId ?? siteId,
    address: item.host.address,
    latencyMs: item.host.latencyMs ?? null,
    ports: uniqueNumbers(item.host.openPorts),
  }));

  for (const item of seenDevices) {
    const ports = uniqueNumbers(item.host.openPorts);
    const fingerprint = buildDiscoveryFingerprint(item.host);
    const existing = await prisma.discoveryState.findUnique({
      where: { collectorId_deviceId: { collectorId, deviceId: item.device.id } },
    });

    if (!existing) {
      newDevices += 1;
      events.push(buildDiscoveryEvent({
        organizationId,
        collectorId,
        runId,
        siteId,
        deviceId: item.device.id,
        type: 'NEW_DEVICE',
        severity: 'INFO',
        title: `Nouvel équipement détecté : ${item.device.name}`,
        message: `${item.device.name} a été vu pour la première fois par ce collector.`,
        meta: { address: item.host.address, ports },
      }));
    } else {
      if (existing.status === 'DOWN') {
        reappearedDevices += 1;
        events.push(buildDiscoveryEvent({
          organizationId,
          collectorId,
          runId,
          siteId,
          deviceId: item.device.id,
          type: 'DEVICE_REAPPEARED',
          severity: 'INFO',
          title: `Équipement revenu : ${item.device.name}`,
          message: `${item.device.name} répond à nouveau à la découverte.`,
          meta: { address: item.host.address, previousAddress: existing.lastAddress, ports },
        }));
      }

      if (existing.lastAddress && existing.lastAddress !== item.host.address) {
        ipChanges += 1;
        events.push(buildDiscoveryEvent({
          organizationId,
          collectorId,
          runId,
          siteId,
          deviceId: item.device.id,
          type: 'IP_CHANGED',
          severity: 'WARNING',
          title: `Adresse IP changée : ${item.device.name}`,
          message: `${item.device.name} est passé de ${existing.lastAddress} à ${item.host.address}.`,
          meta: { address: item.host.address, previousAddress: existing.lastAddress },
        }));
      }

      if (!sameNumbers(existing.lastPorts, ports)) {
        portChanges += 1;
        events.push(buildDiscoveryEvent({
          organizationId,
          collectorId,
          runId,
          siteId,
          deviceId: item.device.id,
          type: 'PORTS_CHANGED',
          severity: 'WARNING',
          title: `Ports modifiés : ${item.device.name}`,
          message: `Ports précédents: ${existing.lastPorts.join(', ') || 'aucun'} ; nouveaux: ${ports.join(', ') || 'aucun'}.`,
          meta: { ports, previousPorts: existing.lastPorts },
        }));
      }
    }

    await prisma.discoveryState.upsert({
      where: { collectorId_deviceId: { collectorId, deviceId: item.device.id } },
      create: {
        organizationId,
        collectorId,
        siteId,
        deviceId: item.device.id,
        status: 'ONLINE',
        firstSeenAt: now,
        lastSeenAt: now,
        lastAddress: item.host.address,
        lastHostname: item.host.sysName ?? item.host.hostname ?? item.device.name,
        lastPorts: ports,
        lastFingerprint: fingerprint,
        missCount: 0,
      },
      update: {
        siteId,
        status: 'ONLINE',
        lastSeenAt: now,
        lastAddress: item.host.address,
        lastHostname: item.host.sysName ?? item.host.hostname ?? item.device.name,
        lastPorts: ports,
        lastFingerprint: fingerprint,
        missCount: 0,
      },
    });
  }

  const previousStates = await prisma.discoveryState.findMany({
    where: {
      organizationId,
      collectorId,
      siteId,
      status: { not: 'DOWN' },
      deviceId: { notIn: [...seenIds] },
    },
    include: { device: { select: { id: true, name: true } } },
  });

  for (const state of previousStates) {
    if (!state.lastAddress || !addressInCidrs(state.lastAddress, cidrs)) continue;
    const suppressAlert = inMaintenance(state.deviceId, state.siteId, maintenanceWindows);
    if (!suppressAlert) {
      downDevices += 1;
      downSamples.push({ deviceId: state.deviceId, siteId: state.siteId });
    }
    events.push(buildDiscoveryEvent({
      organizationId,
      collectorId,
      runId,
      siteId,
      deviceId: state.deviceId,
      type: 'DEVICE_DOWN',
      severity: suppressAlert ? 'INFO' : 'CRITICAL',
      title: `Équipement non revu : ${state.device.name}`,
      message: suppressAlert
        ? `${state.device.name} est dans une fenêtre de maintenance active.`
        : `${state.device.name} n'a pas été revu dans la dernière découverte.`,
      meta: { address: state.lastAddress, previousPorts: state.lastPorts, maintenance: suppressAlert },
    }));
    await prisma.discoveryState.update({
      where: { id: state.id },
      data: { status: 'DOWN', missCount: state.missCount + 1 },
    });
    await prisma.device.update({
      where: { id: state.deviceId },
      data: { status: suppressAlert ? 'MAINTENANCE' : 'OFFLINE' },
    });
  }

  events.push(...await buildLatencyEvents({ organizationId, collectorId, runId, siteId, seen: monitoringSeen }));
  await resolveHealthyLatencyIncidents({
    organizationId,
    healthyDeviceIds: await healthyLatencyDeviceIds(organizationId, monitoringSeen),
  });
  await recordAvailabilitySamples({
    organizationId,
    collectorId,
    runId,
    checkedAt: now,
    seen: monitoringSeen,
    down: downSamples,
  });

  if (events.length > 0) {
    await prisma.discoveryEvent.createMany({ data: events });
    await upsertMonitoringIncidents({ organizationId, events });
    await notifyDiscoveryEvents(events);
  }

  return {
    eventsCreated: events.length,
    newDevices,
    downDevices,
    reappearedDevices,
    portChanges,
    ipChanges,
  };
}

async function upsertHostDevice(
  host: HostPayload,
  organizationId: string,
  siteId: string | null,
  devicesByKey: Map<string, DeviceLite>,
): Promise<{ device: DeviceLite; created: boolean; updated: boolean }> {
  const hostname = cleanName(host.sysName || host.hostname || host.address);
  const mac = host.mac ? normalizeMac(host.mac) : null;
  const existing =
    devicesByKey.get(`ip:${host.address}`) ??
    (mac ? devicesByKey.get(`mac:${mac}`) : undefined) ??
    devicesByKey.get(`name:${normalizeKey(hostname)}`);

  const type = inferDeviceType(host);
  if (existing) {
    const updated = await prisma.device.update({
      where: { id: existing.id },
      data: {
        siteId: existing.siteId ?? siteId,
        ip: host.address,
        mac: mac || undefined,
        type: existing.type === 'OTHER' || existing.type === 'CLOUD' || existing.type === 'VM' ? type : undefined,
        status: 'ONLINE',
        brand: host.vendor ?? inferVendor(host.sysDescr) ?? undefined,
        model: host.model ?? inferModel(host.sysDescr) ?? undefined,
        serial: host.serial ?? undefined,
        notes: buildHostDescription(host),
        customFields: mergeDiscoveryCustomFields(existing.customFields, host),
        tags: { set: mergeTags(['discovered', 'collector'], await getDeviceTags(existing.id)) },
      },
      select: { id: true, name: true, type: true, siteId: true, customFields: true },
    });
    addDeviceKeys(devicesByKey, updated, host.address, mac, hostname);
    return { device: updated, created: false, updated: true };
  }

  await assertTenantQuota(organizationId, 'devices');
  const device = await prisma.device.create({
    data: {
      organizationId,
      siteId,
      name: hostname,
      type,
      status: 'ONLINE',
      ip: host.address,
      mac,
      brand: host.vendor,
      model: host.model ?? inferModel(host.sysDescr),
      serial: host.serial,
      notes: buildHostDescription(host),
      customFields: mergeDiscoveryCustomFields(null, host),
      tags: ['discovered', 'collector'],
    },
    select: { id: true, name: true, type: true, siteId: true, customFields: true },
  });
  addDeviceKeys(devicesByKey, device, host.address, mac, hostname);
  return { device, created: true, updated: false };
}

async function upsertCollectorDiagram({
  organizationId,
  siteId,
  devices,
  links,
  devicesByKey,
}: {
  organizationId: string;
  siteId: string | null;
  devices: DeviceLite[];
  links: LinkPayload[];
  devicesByKey: Map<string, DeviceLite>;
}) {
  const diagramName = 'Découverte automatique';
  const existing = await prisma.diagram.findFirst({ where: { organizationId, siteId, name: diagramName } });
  const nodes = existing ? ([...(existing.nodes as any[])] as any[]) : [];
  const edges = existing ? ([...(existing.edges as any[])] as any[]) : [];
  const nodeByDeviceId = new Map<string, any>();
  for (const node of nodes) {
    const deviceId = node?.data?.deviceId;
    if (deviceId) nodeByDeviceId.set(deviceId, node);
  }

  const ordered = layoutCollectorDevices(devices);
  const deviceIdLinks = linksToDeviceIds(links, devicesByKey);
  const layoutDevices = devices.map((device) => ({
    id: device.id,
    type: device.type,
    name: device.name,
    portCount: devicePortCount(device),
  }));
  const layout = autoLayout(layoutDevices, deviceIdLinks);
  for (const device of ordered) {
    if (nodeByDeviceId.has(device.id)) continue;
    const role = layout.roles.get(device.id);
    const position = layout.positions.get(device.id) ?? { x: 0, y: 0 };
    const node = {
      id: `collector-${device.id}`,
      type: 'device',
      position,
      data: { label: device.name, deviceType: device.type, status: 'ONLINE', deviceId: device.id, autoLayout: true, topologyRank: role ? roleToRank(role) : 4 },
    };
    nodes.push(node);
    nodeByDeviceId.set(device.id, node);
  }

  const existingEdges = new Set(edges.map((edge) => topologyEdgeKey(edge.source, edge.target, edge.data?.localPort, edge.data?.remotePort)));
  for (const link of links) {
    const local = resolveDevice(link.localDevice, devicesByKey, siteId);
    const remote = resolveDevice(link.remoteDevice, devicesByKey, siteId);
    if (!local || !remote) continue;
    const source = nodeByDeviceId.get(local.id);
    const target = nodeByDeviceId.get(remote.id);
    if (!source || !target) continue;
    const key = topologyEdgeKey(source.id, target.id, link.localPort, link.remotePort);
    if (existingEdges.has(key)) continue;
    edges.push({
      id: `collector-e-${source.id}-${target.id}-${edges.length}`,
      source: source.id,
      target: target.id,
      type: 'cable',
      data: {
        cableType: 'ETHERNET',
        speed: link.speed || '1G',
        label: link.protocol,
        protocol: link.protocol,
        vlan: link.vlan || undefined,
        localPort: link.localPort || undefined,
        remotePort: link.remotePort || undefined,
        confidence: link.confidence ?? undefined,
        discovered: true,
        validationStatus: 'PENDING',
        layer: link.protocol === 'SNMP' ? 'L2 inferred' : 'L2 neighbor',
      },
    });
    existingEdges.add(key);
  }

  applyHierarchicalLayout(nodes, layout);

  if (existing) {
    await prisma.diagramVersion.create({ data: { diagramId: existing.id, nodes: existing.nodes as any, edges: existing.edges as any, message: 'Avant collector' } });
    await prisma.diagram.update({ where: { id: existing.id }, data: { nodes, edges, version: existing.version + 1 } });
  } else if (nodes.length > 0) {
    await assertTenantQuota(organizationId, 'diagrams');
    await prisma.diagram.create({
      data: {
        organizationId,
        siteId,
        name: diagramName,
        nodes,
        edges,
        viewport: { x: 80, y: 80, zoom: 0.85 },
      },
    });
  }
}

/**
 * Resolve a collector link (which carries device names / IPs / MACs) into a
 * pair of device ids so it can feed the shared dagre layout.
 */
function linksToDeviceIds(links: LinkPayload[], devicesByKey: Map<string, DeviceLite>) {
  const resolved: { source: string; target: string; protocol?: string | null }[] = [];
  for (const link of links) {
    const local = resolveDevice(link.localDevice, devicesByKey, null);
    const remote = resolveDevice(link.remoteDevice, devicesByKey, null);
    if (!local || !remote) continue;
    resolved.push({ source: local.id, target: remote.id, protocol: link.protocol });
  }
  return resolved;
}

/**
 * Extract a port count for a device from its discovery metadata, if present.
 * Collectors stash structured data under `customFields`; we look for a numeric
 * port/interface count to help the topology classifier.
 */
function devicePortCount(device: DeviceLite): number | null {
  const fields = device.customFields;
  if (!fields || typeof fields !== 'object') return null;
  const record = fields as Record<string, unknown>;
  const candidate = record.portCount ?? record.ports ?? record.interfaceCount ?? record.physicalPorts;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  if (typeof candidate === 'string') {
    const parsed = Number.parseInt(candidate, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function layoutCollectorDevices(devices: DeviceLite[]): DeviceLite[] {
  // Ordering is now driven by dagre; keep a stable name-sorted order so node
  // creation / dedup is deterministic across runs.
  return [...devices].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Apply a precomputed dagre hierarchical layout to all auto-layout nodes.
 * The layout (positions + roles) is computed once by the caller so the
 * betweenness/heuristic work is not repeated per node.
 */
function applyHierarchicalLayout(
  nodes: any[],
  layout: { positions: Map<string, { x: number; y: number }>; roles: Map<string, TopologyRole> },
) {
  for (const node of nodes) {
    const deviceId = node?.data?.deviceId;
    if (node?.data?.positionLocked) continue;
    if (node?.data?.autoLayout !== true) continue;
    const pos = layout.positions.get(deviceId);
    const role = layout.roles.get(deviceId);
    if (!pos || !role) continue;
    node.position = pos;
    node.data = { ...node.data, topologyRank: roleToRank(role) };
  }
}

function topologyEdgeKey(source: string, target: string, localPort?: string | null, remotePort?: string | null): string {
  const a = `${source}:${normalizePort(localPort)}`;
  const b = `${target}:${normalizePort(remotePort)}`;
  return [a, b].sort().join('<->');
}

async function getCollectorForUser(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const collector = await prisma.discoveryCollector.findFirst({
    where: { id, organizationId, ...siteFilter(visibleSiteIds) },
    select: { id: true, siteId: true, tokenRotationDays: true },
  });
  if (!collector) throw new HttpError(404, 'Collector introuvable');
  return collector;
}

function calculateNextTokenRotation(days?: number | null): Date | null {
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function calculateTokenExpiresAt(days?: number | null): Date | null {
  if (!days) return null;
  return calculateNextTokenRotation(days);
}

function isTokenRotationDue(collector: { nextTokenRotationAt?: Date | null; tokenExpiresAt?: Date | null }) {
  const next = collector.nextTokenRotationAt ?? collector.tokenExpiresAt;
  return Boolean(next && next.getTime() <= Date.now());
}

function isTokenExpiringSoon(expiresAt?: Date | null) {
  if (!expiresAt) return false;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return expiresAt.getTime() > Date.now() && expiresAt.getTime() <= Date.now() + sevenDays;
}

function groupKey(siteId?: string | null) {
  return siteId ?? 'organization';
}

type CollectorForFailover = {
  id: string;
  name: string;
  siteId: string | null;
  status: string;
  role: DiscoveryCollectorRole;
  priority: number;
  failoverAfterMinutes: number;
  lastSeenAt: Date | null;
};

function buildCollectorFailoverGroups(collectors: CollectorForFailover[]) {
  const grouped = new Map<string, CollectorForFailover[]>();
  for (const collector of collectors) {
    const key = groupKey(collector.siteId);
    grouped.set(key, [...(grouped.get(key) ?? []), collector]);
  }

  const result = new Map<string, Array<CollectorForFailover & { failoverState: string; stale: boolean }>>();
  for (const [key, items] of grouped) {
    const ordered = [...items].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    const active = ordered.filter((collector) => collector.status === 'ACTIVE');
    const primary = active[0];
    result.set(key, ordered.map((collector) => {
      const stale = isCollectorStale(collector);
      let failoverState = 'UNAVAILABLE';
      if (collector.status === 'ACTIVE' && collector.id === primary?.id) failoverState = stale ? 'STALE_PRIMARY' : 'PRIMARY';
      if (collector.status === 'ACTIVE' && collector.id !== primary?.id) failoverState = primary && isCollectorStale(primary) ? 'READY' : 'STANDBY';
      return { ...collector, stale, failoverState };
    }));
  }
  return result;
}

function isCollectorStale(collector: Pick<CollectorForFailover, 'lastSeenAt' | 'failoverAfterMinutes'>) {
  if (!collector.lastSeenAt) return true;
  return collector.lastSeenAt.getTime() < Date.now() - collector.failoverAfterMinutes * 60 * 1000;
}

function createCollectorToken(): string {
  return `isc_${randomBytes(32).toString('base64url')}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function verifyToken(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function averageConfidence(hosts: HostPayload[]): number {
  const values = hosts.map((host) => host.confidence).filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function cleanName(value: string): string {
  return value.trim().replace(/\.$/, '').slice(0, 120) || 'Équipement découvert';
}

function normalizeKey(value: string): string {
  return cleanName(value).toLowerCase();
}

function normalizeMac(value: string): string {
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '');
  return hex.length === 12 ? hex.match(/.{1,2}/g)!.join(':') : value.toLowerCase();
}

function addDeviceKeys(devicesByKey: Map<string, DeviceLite>, device: DeviceLite, ip?: string | null, mac?: string | null, hostname?: string | null) {
  devicesByKey.set(`name:${normalizeKey(device.name)}`, device);
  if (hostname) devicesByKey.set(`name:${normalizeKey(hostname)}`, device);
  if (ip) devicesByKey.set(`ip:${ip}`, device);
  if (mac) devicesByKey.set(`mac:${normalizeMac(mac)}`, device);
}

function resolveDevice(value: string, devicesByKey: Map<string, DeviceLite>, siteId: string | null): DeviceLite | null {
  const candidates = [
    devicesByKey.get(`name:${normalizeKey(value)}`),
    devicesByKey.get(`ip:${value}`),
    devicesByKey.get(`mac:${normalizeMac(value)}`),
  ].filter(Boolean) as DeviceLite[];
  return candidates.find((device) => device.siteId === siteId) ?? candidates[0] ?? null;
}

async function getDeviceTags(id: string): Promise<string[]> {
  return (await prisma.device.findUnique({ where: { id }, select: { tags: true } }))?.tags ?? [];
}

function mergeTags(current: string[], existing: string[]): string[] {
  return [...new Set([...existing, ...current])].slice(0, 20);
}

function buildHostDescription(host: HostPayload): string {
  const parts = [
    'Découvert par collector local.',
    host.hostname ? `Hostname: ${host.hostname}` : null,
    host.sysName && host.sysName !== host.hostname ? `SNMP name: ${host.sysName}` : null,
    host.sysDescr ? `SNMP: ${host.sysDescr.slice(0, 500)}` : null,
    host.model ? `Modèle: ${host.model}` : null,
    host.serial ? `Série: ${host.serial}` : null,
    host.sysObjectId ? `OID: ${host.sysObjectId}` : null,
    host.uptime != null ? `Uptime SNMP: ${Math.round(host.uptime / 100)} s` : null,
    host.mac ? `MAC: ${normalizeMac(host.mac)}` : null,
    host.vendor ? `Vendor: ${host.vendor}` : null,
    host.interfaces.length ? `Interfaces SNMP: ${host.interfaces.length}` : null,
    host.routeEntries.length ? `Routes/gateways: ${host.routeEntries.length}` : null,
    host.serviceBanners.length ? `Services identifiés: ${host.serviceBanners.map((banner) => banner.service ? `${banner.port}/${banner.service}` : String(banner.port)).slice(0, 20).join(', ')}` : null,
    host.cloud ? `Cloud: ${host.cloud.provider} ${host.cloud.region ?? ''} ${host.cloud.resourceId}`.trim() : null,
    host.virtual ? `Virtualisation: ${host.virtual.platform} ${host.virtual.cluster ?? ''} ${host.virtual.vmId}`.trim() : null,
    host.arpEntries.length ? `Entrées ARP SNMP: ${host.arpEntries.length}` : null,
    host.macTable.length ? `Entrées MAC/bridge: ${host.macTable.length}` : null,
    host.vlans.length ? `VLANs vus: ${host.vlans.map((vlan) => vlan.name ? `${vlan.vlanId} ${vlan.name}` : String(vlan.vlanId)).slice(0, 20).join(', ')}` : null,
    host.openPorts.length ? `Ports ouverts: ${host.openPorts.join(', ')}` : null,
    host.sources.length ? `Sources: ${host.sources.join(', ')}` : null,
    host.confidence != null ? `Confiance découverte: ${host.confidence}/100` : null,
    host.latencyMs != null ? `Latence: ${Math.round(host.latencyMs)} ms` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

function inferDeviceType(host: HostPayload): DeviceType {
  const name = `${host.sysName ?? ''} ${host.hostname ?? ''} ${host.vendor ?? ''} ${host.sysDescr ?? ''}`.toLowerCase();
  const ports = host.openPorts;
  if (host.cloud) return 'CLOUD';
  if (host.virtual) return 'VM';
  if (/esxi|hyper-v|proxmox|vcenter|hypervisor/.test(name)) return 'HYPERVISOR';
  if (/forti|palo|firewall|checkpoint|sophos|watchguard/.test(name)) return 'FIREWALL';
  if (/router|gateway|edgeos|ios-xe|junos/.test(name) || host.routeEntries.some((route) => route.destination === '0.0.0.0')) return 'ROUTER';
  if (/cisco|aruba|juniper|switch|catalyst|procurve/.test(name)) return 'SWITCH';
  if (/ubiquiti|unifi|access point|ap-/.test(name)) return 'ACCESS_POINT';
  if (/printer|xerox|ricoh|brother|hp laser/.test(name) || ports.includes(9100) || ports.includes(515) || ports.includes(631)) return 'PRINTER';
  if (/camera|axis|hikvision|dahua/.test(name)) return 'CAMERA';
  if (/nas|synology|qnap|storage/.test(name)) return 'NAS';
  if (ports.includes(3389)) return 'WORKSTATION';
  if (ports.some((port) => [22, 80, 443, 445, 5432, 3306, 8080, 8443].includes(port))) return 'SERVER';
  return 'OTHER';
}

function mergeDiscoveryCustomFields(current: Prisma.JsonValue | null | undefined, host: HostPayload): Prisma.InputJsonValue {
  const base = isPlainObject(current) ? current : {};
  return {
    ...base,
    discovery: {
      ...(isPlainObject((base as any).discovery) ? (base as any).discovery : {}),
      sources: uniqueStrings(host.sources),
      confidence: host.confidence ?? null,
      routeEntries: host.routeEntries.slice(0, 200),
      gateways: uniqueStrings(host.routeEntries.map((route) => route.nextHop).filter((value): value is string => Boolean(value))).slice(0, 50),
      serviceBanners: host.serviceBanners.slice(0, 64),
      cloud: host.cloud ?? null,
      virtual: host.virtual ?? null,
      lastSeenAt: new Date().toISOString(),
    },
  } as Prisma.InputJsonValue;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function inferVendor(value?: string | null): string | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.includes('cisco')) return 'Cisco';
  if (lower.includes('juniper')) return 'Juniper';
  if (lower.includes('aruba') || lower.includes('procurve')) return 'HPE Aruba';
  if (lower.includes('ubiquiti') || lower.includes('unifi')) return 'Ubiquiti';
  if (lower.includes('fortinet')) return 'Fortinet';
  if (lower.includes('palo alto')) return 'Palo Alto';
  if (lower.includes('mikrotik')) return 'MikroTik';
  if (lower.includes('synology')) return 'Synology';
  return null;
}

function inferVendorFromMac(value?: string | null): string | null {
  if (!value) return null;
  // Primary lookup against the embedded ~2000-entry IEEE OUI database.
  const dbHit = lookupVendorByMac(value);
  if (dbHit) return dbHit;
  // Fallback to a small curated set of historically-common prefixes not covered
  // by the embedded database (kept for backward compatibility).
  const oui = normalizeMac(value).split(':').slice(0, 3).join(':');
  const fallbackVendors: Record<string, string> = {
    '00:1b:54': 'Cisco',
    '00:1c:58': 'Cisco',
    '00:23:04': 'Cisco',
    '00:24:6c': 'Cisco',
    '00:50:56': 'VMware',
    '00:0c:29': 'VMware',
    '00:05:69': 'VMware',
    '3c:52:82': 'HPE Aruba',
    'b4:5d:50': 'HPE Aruba',
    'fc:ec:da': 'Ubiquiti',
    '24:a4:3c': 'Ubiquiti',
    '00:09:0f': 'Fortinet',
    '70:4c:a5': 'Fortinet',
    '00:1b:17': 'Palo Alto',
  };
  return fallbackVendors[oui] ?? null;
}

function inferModel(value?: string | null): string | null {
  if (!value) return null;
  const cisco = value.match(/(?:Cisco IOS Software, )?([^,\n]+(?:C\d{3,5}|ISR\d{3,4}|ASR\d{3,4})[^,\n]*)/i)?.[1];
  if (cisco) return cisco.trim().slice(0, 120);
  const generic = value.match(/(?:model|product|hardware)[:\s]+([A-Za-z0-9._ -]{3,80})/i)?.[1];
  return generic?.trim().slice(0, 120) ?? null;
}

function buildDiscoveryEvent(data: Prisma.DiscoveryEventCreateManyInput): Prisma.DiscoveryEventCreateManyInput {
  return data;
}

function buildDiscoveryFingerprint(host: HostPayload): string {
  return createHash('sha1').update(JSON.stringify({
    address: host.address,
    hostname: host.hostname,
    sysName: host.sysName,
    mac: host.mac ? normalizeMac(host.mac) : null,
    ports: uniqueNumbers(host.openPorts),
    sources: uniqueStrings(host.sources),
    confidence: host.confidence ?? null,
    routes: host.routeEntries.slice(0, 200),
    serviceBanners: host.serviceBanners.slice(0, 64),
    cloud: host.cloud ?? null,
    virtual: host.virtual ?? null,
    interfaces: host.interfaces.map((item) => ({
      index: item.index,
      name: item.name,
      operStatus: item.operStatus,
      speed: item.speed,
    })),
    arp: host.arpEntries.map((entry) => ({ address: entry.address, mac: normalizeMac(entry.mac) })).slice(0, 200),
    vlans: host.vlans.map((vlan) => vlan.vlanId).sort((a, b) => a - b),
  })).digest('hex');
}

function sameNumbers(a: number[], b: number[]): boolean {
  const left = uniqueNumbers(a);
  const right = uniqueNumbers(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function addressInCidrs(address: string, cidrs: string[]): boolean {
  if (cidrs.length === 0) return true;
  const value = ipv4ToInt(address);
  return cidrs.some((cidr) => {
    const match = cidr.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d|[12]\d|3[0-2])$/);
    if (!match) return false;
    const base = ipv4ToInt(match[1]);
    const prefix = Number(match[2]);
    const blockSize = 2 ** (32 - prefix);
    const mask = prefix === 0 ? 0 : (0xffffffff - blockSize + 1) >>> 0;
    const network = (base & mask) >>> 0;
    const broadcast = (network + blockSize - 1) >>> 0;
    return value >= network && value <= broadcast;
  });
}

function ipv4ToInt(ip: string): number {
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return 0;
  return octets.reduce((acc, octet) => acc * 256 + octet, 0) >>> 0;
}
