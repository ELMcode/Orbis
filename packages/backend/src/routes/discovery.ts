import { FastifyInstance } from 'fastify';
import { DeviceType } from '@prisma/client';
import { Socket } from 'node:net';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { assertCanAccessSite, assertInOrg, getVisibleSiteIds } from '../services/scope.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { autoLayout, roleToRank, type TopologyRole } from '../services/autoLayout.js';

const discoverySchema = z.object({
  format: z.enum(['AUTO', 'LINKS_CSV', 'CDP', 'LLDP', 'ARP']).default('AUTO'),
  content: z.string().min(1, 'Collez une sortie de découverte ou un CSV').max(500_000),
  siteId: z.string().optional().nullable(),
  diagramId: z.string().optional().nullable(),
  diagramName: z.string().trim().max(120).optional().nullable(),
  localDevice: z.string().trim().max(120).optional().nullable(),
  applyMode: z.enum(['APPLY', 'PROPOSE']).default('APPLY'),
});

const DEFAULT_SCAN_PORTS = [22, 80, 443, 445, 3389, 8080, 8443, 9100];
const MAX_SCAN_HOSTS = 256;
const MAX_SCAN_PORTS = 12;
const SCAN_CONCURRENCY = 32;

const scanSchema = z.object({
  cidr: z.string().trim().min(7, 'CIDR requis, ex: 192.168.1.0/24').max(32),
  ports: z.array(z.coerce.number().int().min(1).max(65_535)).min(1).max(MAX_SCAN_PORTS).optional(),
  timeoutMs: z.coerce.number().int().min(200).max(5_000).default(900),
  siteId: z.string().optional().nullable(),
  diagramId: z.string().optional().nullable(),
  diagramName: z.string().trim().max(120).optional().nullable(),
});

type DiscoveryLink = {
  localDevice: string;
  localPort?: string | null;
  remoteDevice: string;
  remotePort?: string | null;
  protocol: 'CDP' | 'LLDP' | 'CSV';
  speed?: string | null;
  vlan?: string | null;
};

type DiscoveryArp = {
  address: string;
  mac?: string | null;
  interfaceLabel?: string | null;
};

type DeviceLite = { id: string; name: string; type: DeviceType; siteId: string | null };
type ScannedHost = { address: string; openPorts: number[]; device?: DeviceLite; created?: boolean };

export default async function discoveryRoutes(app: FastifyInstance) {
  app.post('/import', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = discoverySchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const siteId = body.siteId ?? null;

      if (siteId) await assertCanAccessSite(siteId, organizationId, visibleIds);
      if (!siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');

      if (body.diagramId) {
        const diagram = await assertInOrg<{ siteId: string | null }>('diagram', body.diagramId, organizationId);
        if (diagram.siteId && visibleIds !== null && !visibleIds.includes(diagram.siteId)) {
          throw new HttpError(403, 'Accès non autorisé à ce schéma');
        }
      }

      const parsed = parseDiscovery(body.content, body.format, body.localDevice ?? undefined);
      if (parsed.links.length === 0 && parsed.arp.length === 0) {
        throw new HttpError(400, 'Aucune donnée exploitable détectée. Essayez CSV, CDP détaillé, LLDP ou ARP.');
      }

      if (body.applyMode === 'PROPOSE') {
        const proposal = await prisma.discoveryProposal.create({ data: {
          organizationId, siteId, createdById: req.user!.sub, source: `IMPORT_${body.format}`,
          summary: { links: parsed.links.length, arp: parsed.arp.length },
          payload: { siteId, diagramId: body.diagramId ?? null, diagramName: body.diagramName || null, links: parsed.links, arp: parsed.arp },
        }});
        await audit({ userId: req.user!.sub, organizationId, action: 'discovery.proposal.create', target: 'DiscoveryProposal', targetId: proposal.id, ip: req.ip });
        return reply.code(202).send({ proposal, pendingApproval: true });
      }
      const result = await applyDiscovery({
        organizationId,
        userId: req.user!.sub,
        siteId,
        diagramId: body.diagramId ?? null,
        diagramName: body.diagramName || null,
        links: parsed.links,
        arp: parsed.arp,
      });

      await audit({
        userId: req.user!.sub,
        organizationId,
        action: 'discovery.import',
        target: 'Discovery',
        ip: req.ip,
        meta: {
          format: body.format,
          links: parsed.links.length,
          arp: parsed.arp.length,
          devicesCreated: result.devicesCreated,
          ipAddressesCreated: result.ipAddressesCreated,
          diagramId: result.diagram?.id,
        },
      });

      return reply.code(201).send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/proposals', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const status = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).parse(req.query).status;
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const proposals = await prisma.discoveryProposal.findMany({ where: { organizationId, ...(status ? { status } : {}), ...(visibleIds === null ? {} : { siteId: { in: visibleIds } }) }, orderBy: { createdAt: 'desc' }, take: 100, include: { createdBy: { select: { id: true, name: true, email: true } }, reviewedBy: { select: { id: true, name: true, email: true } }, site: { select: { id: true, name: true } } } });
      return reply.send({ proposals });
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/proposals/:id/review', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(2000).optional() }).parse(req.body);
      const proposal = await prisma.discoveryProposal.findFirst({ where: { id, organizationId } });
      if (!proposal) throw new HttpError(404, 'Proposition introuvable');
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      if (proposal.siteId && visibleIds !== null && !visibleIds.includes(proposal.siteId)) throw new HttpError(403, 'Accès non autorisé à cette proposition');
      if (proposal.status !== 'PENDING') throw new HttpError(409, 'Cette proposition a déjà été traitée');
      let result: unknown = undefined;
      if (body.decision === 'APPROVE') {
        const payload = proposal.payload as any;
        result = await applyDiscovery({ organizationId, userId: req.user!.sub, siteId: payload.siteId ?? null, diagramId: payload.diagramId ?? null, diagramName: payload.diagramName ?? null, links: payload.links ?? [], arp: payload.arp ?? [] });
      }
      const updated = await prisma.discoveryProposal.update({ where: { id }, data: { status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewedById: req.user!.sub, reviewedAt: new Date(), reviewNote: body.note ?? null } });
      await audit({ userId: req.user!.sub, organizationId, action: `discovery.proposal.${body.decision.toLowerCase()}`, target: 'DiscoveryProposal', targetId: id, ip: req.ip });
      return reply.send({ proposal: updated, result });
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/scan', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = scanSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const siteId = body.siteId ?? null;

      if (siteId) await assertCanAccessSite(siteId, organizationId, visibleIds);
      if (!siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');

      if (body.diagramId) {
        const diagram = await assertInOrg<{ siteId: string | null }>('diagram', body.diagramId, organizationId);
        if (diagram.siteId && visibleIds !== null && !visibleIds.includes(diagram.siteId)) {
          throw new HttpError(403, 'Accès non autorisé à ce schéma');
        }
      }

      const hosts = expandCidr(body.cidr);
      const ports = normalizeScanPorts(body.ports ?? DEFAULT_SCAN_PORTS);
      const scannedHosts = await scanHosts(hosts, ports, body.timeoutMs);
      const result = await applyScanDiscovery({
        organizationId,
        userId: req.user!.sub,
        siteId,
        diagramId: body.diagramId ?? null,
        diagramName: body.diagramName || null,
        hostsScanned: hosts.length,
        scannedHosts,
      });

      await audit({
        userId: req.user!.sub,
        organizationId,
        action: 'discovery.scan',
        target: 'Discovery',
        ip: req.ip,
        meta: {
          cidr: body.cidr,
          ports,
          hostsScanned: hosts.length,
          hostsUp: scannedHosts.length,
          devicesCreated: result.devicesCreated,
          ipAddressesCreated: result.ipAddressesCreated,
          diagramId: result.diagram?.id,
        },
      });

      return reply.code(201).send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

function parseDiscovery(content: string, format: string, localDevice?: string): { links: DiscoveryLink[]; arp: DiscoveryArp[] } {
  const normalizedFormat = format === 'AUTO' ? detectFormat(content) : format;
  if (normalizedFormat === 'ARP') return { links: [], arp: parseArp(content) };
  if (normalizedFormat === 'LINKS_CSV') return { links: parseLinksCsv(content), arp: [] };
  if (normalizedFormat === 'CDP') return { links: parseCdp(content, localDevice), arp: [] };
  if (normalizedFormat === 'LLDP') return { links: parseLldp(content, localDevice), arp: [] };
  return { links: [], arp: [] };
}

function detectFormat(content: string): 'LINKS_CSV' | 'CDP' | 'LLDP' | 'ARP' {
  const lower = content.toLowerCase();
  if (lower.includes('device id') && lower.includes('port id')) return 'CDP';
  if (lower.includes('local intf') || lower.includes('system name') || lower.includes('lldp')) return 'LLDP';
  if (lower.includes('protocol') && lower.includes('address') && lower.includes('hardware')) return 'ARP';
  if (lower.includes('localdevice') || lower.includes('remote_device') || lower.includes('remotedevice')) return 'LINKS_CSV';
  if (/(\d{1,3}\.){3}\d{1,3}\s+([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i.test(content)) return 'ARP';
  return 'LINKS_CSV';
}

function parseLinksCsv(content: string): DiscoveryLink[] {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const links: DiscoveryLink[] = [];

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? '']));
    const localDevice = row.localdevice || row.source || row.sourcedevice;
    const remoteDevice = row.remotedevice || row.target || row.targetdevice || row.neighbor;
    if (!localDevice || !remoteDevice) continue;
    links.push({
      localDevice,
      localPort: row.localport || row.sourceport || null,
      remoteDevice,
      remotePort: row.remoteport || row.targetport || null,
      protocol: 'CSV',
      speed: row.speed || null,
      vlan: row.vlan || null,
    });
  }

  return dedupeLinks(links);
}

function parseCdp(content: string, localDevice?: string): DiscoveryLink[] {
  const links: DiscoveryLink[] = [];
  const local = localDevice?.trim();

  const detailedBlocks = content.split(/\n(?=Device ID:)/i);
  for (const block of detailedBlocks) {
    const remote = matchLine(block, /Device ID:\s*(.+)/i);
    const localPort = matchLine(block, /Interface:\s*([^,]+),/i);
    const remotePort = matchLine(block, /Port ID \(outgoing port\):\s*(.+)/i);
    if (local && remote) {
      links.push({ localDevice: local, localPort, remoteDevice: cleanDeviceName(remote), remotePort, protocol: 'CDP' });
    }
  }

  if (links.length > 0) return dedupeLinks(links);
  if (!local) return [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /device id|capability|platform|---/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 4) {
      links.push({
        localDevice: local,
        remoteDevice: cleanDeviceName(parts[0]),
        localPort: parts[1],
        remotePort: parts[parts.length - 1],
        protocol: 'CDP',
      });
    }
  }

  return dedupeLinks(links);
}

function parseLldp(content: string, localDevice?: string): DiscoveryLink[] {
  const links: DiscoveryLink[] = [];
  const local = localDevice?.trim();

  const detailedBlocks = content.split(/\n(?=Chassis id:|Local Intf:|Local Interface:)/i);
  for (const block of detailedBlocks) {
    const remote = matchLine(block, /System Name:\s*(.+)/i) ?? matchLine(block, /Chassis id:\s*(.+)/i);
    const localPort = matchLine(block, /Local (?:Intf|Interface):\s*(.+)/i);
    const remotePort = matchLine(block, /Port id:\s*(.+)/i);
    if (local && remote && localPort) {
      links.push({ localDevice: local, localPort, remoteDevice: cleanDeviceName(remote), remotePort, protocol: 'LLDP' });
    }
  }

  if (links.length > 0) return dedupeLinks(links);
  if (!local) return [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /device id|local intf|hold|capability|port id|---/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      links.push({
        localDevice: local,
        remoteDevice: cleanDeviceName(parts[0]),
        localPort: parts[1],
        remotePort: parts[parts.length - 1],
        protocol: 'LLDP',
      });
    }
  }

  return dedupeLinks(links);
}

function parseArp(content: string): DiscoveryArp[] {
  const rows: DiscoveryArp[] = [];
  for (const line of content.split(/\r?\n/)) {
    const ip = line.match(/(?:\d{1,3}\.){3}\d{1,3}/)?.[0];
    const mac =
      line.match(/(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i)?.[0] ??
      line.match(/[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}/i)?.[0] ??
      null;
    if (!ip) continue;
    const parts = line.trim().split(/\s+/);
    rows.push({ address: ip, mac: normalizeMac(mac), interfaceLabel: parts[parts.length - 1] ?? null });
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.address)) return false;
    seen.add(row.address);
    return true;
  });
}

async function applyDiscovery({
  organizationId,
  userId,
  siteId,
  diagramId,
  diagramName,
  links,
  arp,
}: {
  organizationId: string;
  userId: string;
  siteId: string | null;
  diagramId: string | null;
  diagramName: string | null;
  links: DiscoveryLink[];
  arp: DiscoveryArp[];
}) {
  const knownDevices = await prisma.device.findMany({
    where: { organizationId },
    select: { id: true, name: true, type: true, siteId: true },
  });
  const devicesByName = new Map<string, DeviceLite[]>();
  for (const device of knownDevices) {
    const key = normalizeDeviceKey(device.name);
    devicesByName.set(key, [...(devicesByName.get(key) ?? []), device]);
  }

  let devicesCreated = 0;
  let devicesMatched = 0;
  const touchedDevices = new Map<string, DeviceLite>();

  for (const link of links) {
    const local = await getOrCreateDevice(link.localDevice, siteId, organizationId, userId, devicesByName);
    const remote = await getOrCreateDevice(link.remoteDevice, siteId, organizationId, userId, devicesByName);
    if (local.created) devicesCreated += 1;
    else devicesMatched += 1;
    if (remote.created) devicesCreated += 1;
    else devicesMatched += 1;
    touchedDevices.set(local.device.id, local.device);
    touchedDevices.set(remote.device.id, remote.device);
  }

  let ipAddressesCreated = 0;
  let ipAddressesMatched = 0;
  for (const row of arp) {
    const existing = await prisma.ipAddress.findFirst({ where: { organizationId, siteId, address: row.address }, select: { id: true } });
    if (existing) {
      ipAddressesMatched += 1;
      continue;
    }
    await assertTenantQuota(organizationId, 'ipAddresses');
    await assertTenantQuota(organizationId, 'ipAddresses');
    await prisma.ipAddress.create({
      data: {
        organizationId,
        siteId,
        address: row.address,
        status: 'ASSIGNED',
        interfaceLabel: row.interfaceLabel,
        description: row.mac ? `MAC ${row.mac}` : null,
      },
    });
    ipAddressesCreated += 1;
  }

  const shouldUpdateDiagram = Boolean(diagramId || diagramName);
  const diagram = shouldUpdateDiagram && links.length > 0
    ? await upsertDiscoveryDiagram({
      organizationId,
      userId,
      siteId,
      diagramId,
      diagramName,
      devices: [...touchedDevices.values()],
      links,
      devicesByName,
    })
    : null;

  return {
    devicesCreated,
    devicesMatched,
    linksDiscovered: links.length,
    ipAddressesCreated,
    ipAddressesMatched,
    diagram,
  };
}

async function applyScanDiscovery({
  organizationId,
  userId,
  siteId,
  diagramId,
  diagramName,
  hostsScanned,
  scannedHosts,
}: {
  organizationId: string;
  userId: string;
  siteId: string | null;
  diagramId: string | null;
  diagramName: string | null;
  hostsScanned: number;
  scannedHosts: ScannedHost[];
}) {
  const knownDevices = await prisma.device.findMany({
    where: { organizationId },
    select: { id: true, name: true, type: true, siteId: true },
  });
  const devicesByName = new Map<string, DeviceLite[]>();
  for (const device of knownDevices) {
    const key = normalizeDeviceKey(device.name);
    devicesByName.set(key, [...(devicesByName.get(key) ?? []), device]);
  }

  let devicesCreated = 0;
  let devicesMatched = 0;
  let ipAddressesCreated = 0;
  let ipAddressesMatched = 0;
  const touchedDevices = new Map<string, DeviceLite>();

  for (const host of scannedHosts) {
    const match = await getOrCreateScannedDevice(host, siteId, organizationId, userId, devicesByName);
    host.device = match.device;
    host.created = match.created;
    if (match.created) devicesCreated += 1;
    else devicesMatched += 1;
    touchedDevices.set(match.device.id, match.device);

    const existingIp = await prisma.ipAddress.findFirst({
      where: { organizationId, siteId, address: host.address },
      select: { id: true, deviceId: true },
    });
    if (existingIp) {
      ipAddressesMatched += 1;
      if (!existingIp.deviceId) {
        await prisma.ipAddress.update({ where: { id: existingIp.id }, data: { deviceId: match.device.id, status: 'ASSIGNED' } });
      }
      continue;
    }

    await prisma.ipAddress.create({
      data: {
        organizationId,
        siteId,
        deviceId: match.device.id,
        address: host.address,
        status: 'ASSIGNED',
        interfaceLabel: 'scan',
        description: `Ports ouverts: ${host.openPorts.join(', ')}`,
      },
    });
    ipAddressesCreated += 1;
  }

  const shouldUpdateDiagram = Boolean(diagramId || diagramName);
  const diagram = shouldUpdateDiagram && touchedDevices.size > 0
    ? await upsertDiscoveryDiagram({
      organizationId,
      userId,
      siteId,
      diagramId,
      diagramName,
      devices: [...touchedDevices.values()],
      links: [],
      devicesByName,
    })
    : null;

  return {
    devicesCreated,
    devicesMatched,
    linksDiscovered: 0,
    ipAddressesCreated,
    ipAddressesMatched,
    hostsScanned,
    hostsUp: scannedHosts.length,
    openPorts: scannedHosts.map((host) => ({
      address: host.address,
      ports: host.openPorts,
      deviceId: host.device?.id ?? null,
      deviceName: host.device?.name ?? host.address,
      created: host.created ?? false,
    })),
    diagram,
  };
}

async function getOrCreateDevice(
  name: string,
  siteId: string | null,
  organizationId: string,
  userId: string,
  devicesByName: Map<string, DeviceLite[]>,
): Promise<{ device: DeviceLite; created: boolean }> {
  const cleanName = cleanDeviceName(name);
  const key = normalizeDeviceKey(cleanName);
  const candidates = devicesByName.get(key) ?? [];
  const exact = candidates.find((device) => device.siteId === siteId) ?? candidates.find((device) => !device.siteId) ?? candidates[0];
  if (exact) return { device: exact, created: false };
  await assertTenantQuota(organizationId, 'devices');

  const device = await prisma.device.create({
    data: {
      organizationId,
      siteId,
      name: cleanName,
      type: inferDeviceType(cleanName),
      status: 'UNKNOWN',
      editedById: userId,
      tags: ['discovered'],
    },
    select: { id: true, name: true, type: true, siteId: true },
  });
  devicesByName.set(key, [device]);
  return { device, created: true };
}

async function getOrCreateScannedDevice(
  host: ScannedHost,
  siteId: string | null,
  organizationId: string,
  userId: string,
  devicesByName: Map<string, DeviceLite[]>,
): Promise<{ device: DeviceLite; created: boolean }> {
  const key = normalizeDeviceKey(host.address);
  const candidates = devicesByName.get(key) ?? [];
  const exact = candidates.find((device) => device.siteId === siteId) ?? candidates.find((device) => !device.siteId) ?? candidates[0];
  if (exact) return { device: exact, created: false };
  await assertTenantQuota(organizationId, 'devices');

  const device = await prisma.device.create({
    data: {
      organizationId,
      siteId,
      name: host.address,
      type: inferDeviceTypeFromPorts(host.openPorts),
      status: 'ONLINE',
      ip: host.address,
      editedById: userId,
      tags: ['discovered', 'scan'],
      notes: `Découvert par scan TCP. Ports ouverts: ${host.openPorts.join(', ')}`,
    },
    select: { id: true, name: true, type: true, siteId: true },
  });
  devicesByName.set(key, [device]);
  return { device, created: true };
}

async function upsertDiscoveryDiagram({
  organizationId,
  userId,
  siteId,
  diagramId,
  diagramName,
  devices,
  links,
  devicesByName,
}: {
  organizationId: string;
  userId: string;
  siteId: string | null;
  diagramId: string | null;
  diagramName: string | null;
  devices: DeviceLite[];
  links: DiscoveryLink[];
  devicesByName: Map<string, DeviceLite[]>;
}) {
  const existing = diagramId
    ? await prisma.diagram.findFirst({ where: { id: diagramId, organizationId } })
    : null;
  const nodes = existing ? ([...(existing.nodes as any[])] as any[]) : [];
  const edges = existing ? ([...(existing.edges as any[])] as any[]) : [];
  const existingNodeByDevice = new Map<string, any>();
  for (const node of nodes) {
    const deviceId = node?.data?.deviceId;
    if (deviceId) existingNodeByDevice.set(deviceId, node);
  }

  const ordered = layoutDevices(devices);
  const deviceIdLinks = linksToDeviceIds(links, devicesByName, siteId);
  const layout = autoLayout(devices, deviceIdLinks);
  for (const device of ordered) {
    if (existingNodeByDevice.has(device.id)) continue;
    const role = layout.roles.get(device.id);
    const position = layout.positions.get(device.id) ?? { x: 0, y: 0 };
    const node = {
      id: `disc-${device.id}`,
      type: 'device',
      position,
      data: {
        label: device.name,
        deviceType: device.type,
        status: 'UNKNOWN',
        deviceId: device.id,
        autoLayout: true,
        topologyRank: role ? roleToRank(role) : 4,
      },
    };
    nodes.push(node);
    existingNodeByDevice.set(device.id, node);
  }

  const existingEdges = new Set(edges.map((edge) => topologyEdgeKey(edge.source, edge.target, edge.data?.localPort, edge.data?.remotePort)));
  for (const link of links) {
    const local = resolveDevice(link.localDevice, devicesByName, siteId);
    const remote = resolveDevice(link.remoteDevice, devicesByName, siteId);
    if (!local || !remote) continue;
    const sourceNode = existingNodeByDevice.get(local.id);
    const targetNode = existingNodeByDevice.get(remote.id);
    if (!sourceNode || !targetNode) continue;
    const key = topologyEdgeKey(sourceNode.id, targetNode.id, link.localPort, link.remotePort);
    if (existingEdges.has(key)) continue;
    edges.push({
      id: `disc-e-${sourceNode.id}-${targetNode.id}-${edges.length}`,
      source: sourceNode.id,
      target: targetNode.id,
      type: 'cable',
      data: {
        cableType: link.protocol === 'LLDP' || link.protocol === 'CDP' ? 'ETHERNET' : 'OTHER',
        speed: link.speed || '1G',
        label: link.protocol,
        protocol: link.protocol,
        vlan: link.vlan || undefined,
        localPort: link.localPort || undefined,
        remotePort: link.remotePort || undefined,
        discovered: true,
        validationStatus: 'PENDING',
        layer: link.protocol === 'CDP' || link.protocol === 'LLDP' ? 'L2 neighbor' : 'L2/L3',
      },
    });
    existingEdges.add(key);
  }

  applyHierarchicalLayout(nodes, layout);

  if (existing) {
    const diagram = await prisma.diagram.update({
      where: { id: existing.id },
      data: { nodes, edges, version: existing.version + 1 },
      include: { site: { select: { id: true, name: true } } },
    });
    await prisma.diagramVersion.create({ data: { diagramId: existing.id, nodes: existing.nodes as any, edges: existing.edges as any, message: 'Avant découverte réseau' } });
    return diagram;
  }

  await assertTenantQuota(organizationId, 'diagrams');
  return prisma.diagram.create({
    data: {
      organizationId,
      siteId,
      createdById: userId,
      name: diagramName || `Découverte réseau ${new Date().toLocaleDateString('fr-FR')}`,
      nodes,
      edges,
      viewport: { x: 80, y: 80, zoom: 0.85 },
    },
    include: { site: { select: { id: true, name: true } } },
  });
}

function resolveDevice(name: string, devicesByName: Map<string, DeviceLite[]>, siteId: string | null): DeviceLite | null {
  const candidates = devicesByName.get(normalizeDeviceKey(cleanDeviceName(name))) ?? [];
  return candidates.find((device) => device.siteId === siteId) ?? candidates[0] ?? null;
}

function layoutDevices(devices: DeviceLite[]): DeviceLite[] {
  // Ordering is now driven by dagre, but we keep a stable name-sorted order so
  // that node creation / dedup is deterministic across runs.
  return [...devices].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a discovery link (which carries device names) into a pair of device
 * ids so it can feed the shared dagre layout.
 */
function linksToDeviceIds(links: DiscoveryLink[], devicesByName: Map<string, DeviceLite[]>, siteId: string | null) {
  const resolved: { source: string; target: string; protocol?: string | null }[] = [];
  for (const link of links) {
    const local = resolveDevice(link.localDevice, devicesByName, siteId);
    const remote = resolveDevice(link.remoteDevice, devicesByName, siteId);
    if (!local || !remote) continue;
    resolved.push({ source: local.id, target: remote.id, protocol: link.protocol });
  }
  return resolved;
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

function normalizePort(value?: string | null): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '');
}

function splitCsvLine(line: string): string[] {
  const separator = line.includes(';') ? ';' : ',';
  return line.split(separator).map((value) => value.replace(/^"|"$/g, ''));
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchLine(block: string, regex: RegExp): string | null {
  return block.match(regex)?.[1]?.trim() ?? null;
}

function cleanDeviceName(value: string): string {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value.trim())) return value.trim();
  return value.trim().replace(/\s+\(.+\)$/g, '').replace(/\..*$/, '').slice(0, 120) || 'Équipement découvert';
}

function normalizeDeviceKey(value: string): string {
  return cleanDeviceName(value).toLowerCase();
}

function normalizeMac(value: string | null): string | null {
  if (!value) return null;
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length !== 12) return value;
  return hex.match(/.{1,2}/g)!.join(':');
}

function inferDeviceType(name: string): DeviceType {
  const lower = name.toLowerCase();
  if (/fw|firewall|forti|palo|asa|checkpoint/.test(lower)) return 'FIREWALL';
  if (/router|rtr|rt-/.test(lower)) return 'ROUTER';
  if (/ap|wifi|wlc|controller/.test(lower)) return 'ACCESS_POINT';
  if (/srv|server|esx|hyper|vmhost/.test(lower)) return 'SERVER';
  if (/nas|san|storage/.test(lower)) return 'NAS';
  if (/phone|voip/.test(lower)) return 'PHONE';
  if (/cam|camera/.test(lower)) return 'CAMERA';
  return 'SWITCH';
}

function inferDeviceTypeFromPorts(ports: number[]): DeviceType {
  if (ports.includes(9100)) return 'PRINTER';
  if (ports.includes(3389)) return 'WORKSTATION';
  if (ports.some((port) => [22, 80, 443, 445, 8080, 8443].includes(port))) return 'SERVER';
  return 'OTHER';
}

function normalizeScanPorts(ports: number[]): number[] {
  const unique = [...new Set(ports)].sort((a, b) => a - b);
  if (unique.length === 0) throw new HttpError(400, 'Au moins un port TCP est requis pour le scan');
  if (unique.length > MAX_SCAN_PORTS) throw new HttpError(400, `Scan limité à ${MAX_SCAN_PORTS} ports TCP par exécution`);
  return unique;
}

function expandCidr(cidr: string): string[] {
  const match = cidr.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d|[12]\d|3[0-2])$/);
  if (!match) throw new HttpError(400, 'CIDR invalide. Exemple attendu: 192.168.1.0/24');

  const base = ipv4ToInt(match[1]);
  const prefix = Number(match[2]);
  const blockSize = 2 ** (32 - prefix);
  const mask = prefix === 0 ? 0 : (0xffffffff - blockSize + 1) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network + blockSize - 1) >>> 0;

  if (!isPrivateOrLoopback(network) || !isPrivateOrLoopback(broadcast)) {
    throw new HttpError(400, 'Le scan automatique est limité aux plages privées ou loopback');
  }

  const first = prefix <= 30 ? network + 1 : network;
  const last = prefix <= 30 ? broadcast - 1 : broadcast;
  const totalHosts = last >= first ? last - first + 1 : 0;
  if (totalHosts <= 0) throw new HttpError(400, 'Aucun hôte exploitable dans ce CIDR');
  if (totalHosts > MAX_SCAN_HOSTS) throw new HttpError(400, `Scan limité à ${MAX_SCAN_HOSTS} hôtes. Choisissez un CIDR plus petit.`);

  const hosts: string[] = [];
  for (let value = first; value <= last; value += 1) hosts.push(intToIpv4(value));
  return hosts;
}

function ipv4ToInt(ip: string): number {
  const octets = ip.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    throw new HttpError(400, 'Adresse IPv4 invalide');
  }
  return octets.reduce((acc, octet) => acc * 256 + octet, 0) >>> 0;
}

function intToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join('.');
}

function isPrivateOrLoopback(value: number): boolean {
  const first = (value >>> 24) & 255;
  const second = (value >>> 16) & 255;
  return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

async function scanHosts(hosts: string[], ports: number[], timeoutMs: number): Promise<ScannedHost[]> {
  const results = await mapLimit(hosts, SCAN_CONCURRENCY, async (host) => {
    const checks = await Promise.all(ports.map(async (port) => ({ port, open: await probeTcp(host, port, timeoutMs) })));
    const openPorts = checks.filter((check) => check.open).map((check) => check.port);
    return openPorts.length > 0 ? { address: host, openPorts } : null;
  });
  return results.filter((result): result is ScannedHost => result !== null);
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function dedupeLinks(links: DiscoveryLink[]): DiscoveryLink[] {
  const seen = new Set<string>();
  return links.filter((link) => {
    const a = `${normalizeDeviceKey(link.localDevice)}:${link.localPort ?? ''}`;
    const b = `${normalizeDeviceKey(link.remoteDevice)}:${link.remotePort ?? ''}`;
    const key = [a, b].sort().join('<->');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
