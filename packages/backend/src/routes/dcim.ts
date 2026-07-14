import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { assertCanAccessDevice, assertCanAccessSite, getVisibleSiteIds, scopedSiteFilter } from '../services/scope.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';

const providerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().max(120).optional().nullable(),
  contactEmail: z.string().trim().email().optional().nullable(),
  supportPhone: z.string().trim().max(80).optional().nullable(),
  portalUrl: z.string().trim().url().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const circuitSchema = z.object({
  name: z.string().trim().min(1).max(120),
  siteId: z.string().optional().nullable(),
  providerId: z.string().optional().nullable(),
  circuitId: z.string().trim().max(120).optional().nullable(),
  type: z.string().trim().max(80).optional().nullable(),
  status: z.string().trim().min(1).max(40).default('ACTIVE'),
  bandwidthMbps: z.coerce.number().int().positive().max(10_000_000).optional().nullable(),
  demarcation: z.string().trim().max(255).optional().nullable(),
  installDate: z.coerce.date().optional().nullable(),
  renewalDate: z.coerce.date().optional().nullable(),
  monthlyCost: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const patchPanelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  siteId: z.string().optional().nullable(),
  rackId: z.string().optional().nullable(),
  portsCount: z.coerce.number().int().min(1).max(288).default(24),
  description: z.string().trim().max(2000).optional().nullable(),
});

const cableSchema = z.object({
  label: z.string().trim().min(1).max(120),
  circuitId: z.string().optional().nullable(),
  cableType: z.string().trim().min(1).max(40).default('COPPER'),
  status: z.string().trim().min(1).max(40).default('CONNECTED'),
  lengthMeters: z.coerce.number().nonnegative().optional().nullable(),
  aDeviceId: z.string().optional().nullable(),
  aPortLabel: z.string().trim().max(120).optional().nullable(),
  aPatchPanelId: z.string().optional().nullable(),
  aPatchPort: z.string().trim().max(120).optional().nullable(),
  bDeviceId: z.string().optional().nullable(),
  bPortLabel: z.string().trim().max(120).optional().nullable(),
  bPatchPanelId: z.string().optional().nullable(),
  bPatchPort: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export default async function dcimRoutes(app: FastifyInstance) {
  app.get('/providers', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const pagination = parsePagination(req.query);
      const where = { organizationId };
      const [providers, total] = await Promise.all([
        prisma.provider.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: pagination.skip,
          take: pagination.take,
          include: { _count: { select: { circuits: true } } },
        }),
        prisma.provider.count({ where }),
      ]);
      return reply.send({ providers, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/providers', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = providerSchema.parse(req.body);
      const provider = await prisma.provider.create({ data: { ...body, organizationId } });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.provider.create', target: 'Provider', targetId: provider.id, ip: req.ip });
      return reply.code(201).send({ provider });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/providers/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      await assertProviderAccess(id, organizationId);
      const provider = await prisma.provider.update({ where: { id }, data: providerSchema.partial().parse(req.body) });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.provider.update', target: 'Provider', targetId: id, ip: req.ip });
      return reply.send({ provider });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/providers/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      await assertProviderAccess(id, organizationId);
      await prisma.provider.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.provider.delete', target: 'Provider', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/circuits', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const q = req.query as { siteId?: string; providerId?: string; status?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const where: any = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      if (q.providerId) where.providerId = q.providerId;
      if (q.status) where.status = q.status;
      const [circuits, total] = await Promise.all([
        prisma.circuit.findMany({
          where,
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
          include: { site: { select: { id: true, name: true } }, provider: { select: { id: true, name: true } }, _count: { select: { cables: true } } },
        }),
        prisma.circuit.count({ where }),
      ]);
      return reply.send({ circuits, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/circuits', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const body = circuitSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (!body.siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      if (body.providerId) await assertProviderAccess(body.providerId, organizationId);
      const circuit = await prisma.circuit.create({
        data: { ...body, siteId: body.siteId ?? null, providerId: body.providerId ?? null, organizationId },
        include: { site: { select: { id: true, name: true } }, provider: { select: { id: true, name: true } }, _count: { select: { cables: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.circuit.create', target: 'Circuit', targetId: circuit.id, ip: req.ip });
      return reply.code(201).send({ circuit });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/circuits/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => updateScoped(req, reply, 'circuit', circuitSchema.partial(), 'dcim.circuit.update'));
  app.delete('/circuits/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => deleteScoped(req, reply, 'circuit', 'dcim.circuit.delete'));

  app.get('/patch-panels', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const q = req.query as { siteId?: string; rackId?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const where: any = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      if (q.rackId) where.rackId = q.rackId;
      const [patchPanels, total] = await Promise.all([
        prisma.patchPanel.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: pagination.skip,
          take: pagination.take,
          include: { site: { select: { id: true, name: true } }, rack: { select: { id: true, name: true } } },
        }),
        prisma.patchPanel.count({ where }),
      ]);
      return reply.send({ patchPanels, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/patch-panels', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const body = patchPanelSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (!body.siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      if (body.rackId) await assertRackAccess(body.rackId, organizationId, visibleIds);
      const patchPanel = await prisma.patchPanel.create({
        data: { ...body, siteId: body.siteId ?? null, rackId: body.rackId ?? null, organizationId },
        include: { site: { select: { id: true, name: true } }, rack: { select: { id: true, name: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.patch_panel.create', target: 'PatchPanel', targetId: patchPanel.id, ip: req.ip });
      return reply.code(201).send({ patchPanel });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/patch-panels/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => updateScoped(req, reply, 'patchPanel', patchPanelSchema.partial(), 'dcim.patch_panel.update'));
  app.delete('/patch-panels/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => deleteScoped(req, reply, 'patchPanel', 'dcim.patch_panel.delete'));

  app.get('/cables', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const q = req.query as { siteId?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const where = { organizationId, ...(await cableScopeFilter(q.siteId, organizationId, visibleIds)) };
      const [cables, total] = await Promise.all([
        prisma.cable.findMany({
          where,
          orderBy: { label: 'asc' },
          skip: pagination.skip,
          take: pagination.take,
          include: cableInclude,
        }),
        prisma.cable.count({ where }),
      ]);
      return reply.send({ cables, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/cables', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const body = cableSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      await assertCableRefs(body, organizationId, visibleIds);
      const cable = await prisma.cable.create({
        data: { ...body, organizationId },
        include: cableInclude,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.cable.create', target: 'Cable', targetId: cable.id, ip: req.ip });
      return reply.code(201).send({ cable });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/cables/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      await assertCableAccess(id, organizationId);
      const body = cableSchema.partial().parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      await assertCableRefs(body, organizationId, visibleIds);
      const cable = await prisma.cable.update({ where: { id }, data: body, include: cableInclude });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.cable.update', target: 'Cable', targetId: id, ip: req.ip });
      return reply.send({ cable });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/cables/:id', { preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      await assertCableAccess(id, organizationId);
      await prisma.cable.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'dcim.cable.delete', target: 'Cable', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

const cableInclude = {
  circuit: { select: { id: true, name: true, circuitId: true } },
  aDevice: { select: { id: true, name: true, type: true, ip: true } },
  bDevice: { select: { id: true, name: true, type: true, ip: true } },
  aPatchPanel: { select: { id: true, name: true } },
  bPatchPanel: { select: { id: true, name: true } },
} as const;

async function updateScoped(req: any, reply: any, model: 'circuit' | 'patchPanel', schema: z.ZodTypeAny, action: string) {
  try {
    const { organizationId, role } = req.membership!;
    const id = z.string().parse((req.params as any).id);
    const body = schema.parse(req.body);
    const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
    if (model === 'circuit') {
      await assertCircuitAccess(id, organizationId, visibleIds);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (body.providerId) await assertProviderAccess(body.providerId, organizationId);
      const circuit = await prisma.circuit.update({ where: { id }, data: body, include: { site: { select: { id: true, name: true } }, provider: { select: { id: true, name: true } }, _count: { select: { cables: true } } } });
      await audit({ userId: req.user!.sub, organizationId, action, target: 'Circuit', targetId: id, ip: req.ip });
      return reply.send({ circuit });
    }
    await assertPatchPanelAccess(id, organizationId, visibleIds);
    if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
    if (body.rackId) await assertRackAccess(body.rackId, organizationId, visibleIds);
    const patchPanel = await prisma.patchPanel.update({ where: { id }, data: body, include: { site: { select: { id: true, name: true } }, rack: { select: { id: true, name: true } } } });
    await audit({ userId: req.user!.sub, organizationId, action, target: 'PatchPanel', targetId: id, ip: req.ip });
    return reply.send({ patchPanel });
  } catch (err) {
    return handleError(reply, err);
  }
}

async function deleteScoped(req: any, reply: any, model: 'circuit' | 'patchPanel', action: string) {
  try {
    const { organizationId, role } = req.membership!;
    const id = z.string().parse((req.params as any).id);
    const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
    if (model === 'circuit') {
      await assertCircuitAccess(id, organizationId, visibleIds);
      await prisma.circuit.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action, target: 'Circuit', targetId: id, ip: req.ip });
    } else {
      await assertPatchPanelAccess(id, organizationId, visibleIds);
      await prisma.patchPanel.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action, target: 'PatchPanel', targetId: id, ip: req.ip });
    }
    return reply.send({ success: true });
  } catch (err) {
    return handleError(reply, err);
  }
}

async function assertProviderAccess(id: string, organizationId: string) {
  const provider = await prisma.provider.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!provider) throw new HttpError(404, 'Opérateur introuvable');
}

async function assertCircuitAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const circuit = await prisma.circuit.findFirst({ where: { id, organizationId }, select: { id: true, siteId: true } });
  if (!circuit) throw new HttpError(404, 'Circuit introuvable');
  if (visibleSiteIds !== null && (!circuit.siteId || !visibleSiteIds.includes(circuit.siteId))) throw new HttpError(403, 'Accès non autorisé à ce circuit');
}

async function assertPatchPanelAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const patchPanel = await prisma.patchPanel.findFirst({ where: { id, organizationId }, select: { id: true, siteId: true } });
  if (!patchPanel) throw new HttpError(404, 'Patch panel introuvable');
  if (visibleSiteIds !== null && (!patchPanel.siteId || !visibleSiteIds.includes(patchPanel.siteId))) throw new HttpError(403, 'Accès non autorisé à ce patch panel');
}

async function assertRackAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const rack = await prisma.rack.findFirst({ where: { id, organizationId }, select: { id: true, siteId: true } });
  if (!rack) throw new HttpError(404, 'Baie introuvable');
  if (visibleSiteIds !== null && (!rack.siteId || !visibleSiteIds.includes(rack.siteId))) throw new HttpError(403, 'Accès non autorisé à cette baie');
}

async function assertCableAccess(id: string, organizationId: string) {
  const cable = await prisma.cable.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!cable) throw new HttpError(404, 'Câble introuvable');
}

async function assertCableRefs(body: Partial<z.infer<typeof cableSchema>>, organizationId: string, visibleSiteIds: string[] | null) {
  if (body.circuitId) await assertCircuitAccess(body.circuitId, organizationId, visibleSiteIds);
  if (body.aDeviceId) await assertCanAccessDevice(body.aDeviceId, organizationId, visibleSiteIds);
  if (body.bDeviceId) await assertCanAccessDevice(body.bDeviceId, organizationId, visibleSiteIds);
  if (body.aPatchPanelId) await assertPatchPanelAccess(body.aPatchPanelId, organizationId, visibleSiteIds);
  if (body.bPatchPanelId) await assertPatchPanelAccess(body.bPatchPanelId, organizationId, visibleSiteIds);
}

async function cableScopeFilter(requestedSiteId: string | undefined, organizationId: string, visibleSiteIds: string[] | null) {
  const filter = await scopedSiteFilter(requestedSiteId, organizationId, visibleSiteIds);
  const ids = filter.siteId?.in;
  if (!ids) return {};
  return {
    OR: [
      { circuit: { siteId: { in: ids } } },
      { aDevice: { siteId: { in: ids } } },
      { bDevice: { siteId: { in: ids } } },
      { aPatchPanel: { siteId: { in: ids } } },
      { bPatchPanel: { siteId: { in: ids } } },
    ],
  };
}
