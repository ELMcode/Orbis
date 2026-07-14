import { FastifyInstance } from 'fastify';
import { IpAddressStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import {
  assertCanAccessDevice,
  assertCanAccessSite,
  getVisibleSiteIds,
  scopedSiteFilter,
} from '../services/scope.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { checkPrefixOverlap, overlapTypeLabel } from '../services/ipamCheck.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';

const cidrSchema = z.string().trim().min(3).max(64).regex(/^([0-9a-f:.]+)\/\d{1,3}$/i, 'CIDR invalide');
const ipSchema = z.string().trim().min(3).max(64).regex(/^[0-9a-f:.]+$/i, 'Adresse IP invalide');

const vlanSchema = z.object({
  vlanId: z.number().int().min(1).max(4094),
  name: z.string().trim().min(1, 'Le nom du VLAN est obligatoire').max(120),
  siteId: z.string().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

const vrfRouteTargetSchema = z.object({
  rt: z.string().trim().min(1, "Le route target est obligatoire").max(120),
  direction: z.enum(['IMPORT', 'EXPORT']),
});

const vrfSchema = z.object({
  name: z.string().trim().min(1, 'Le nom de la VRF est obligatoire').max(120),
  rd: z.string().trim().max(120).optional().nullable(),
  siteId: z.string().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  routeTargets: z.array(vrfRouteTargetSchema).optional(),
});

const prefixSchema = z.object({
  cidr: cidrSchema,
  name: z.string().trim().max(120).optional().nullable(),
  siteId: z.string().optional().nullable(),
  vlanId: z.string().optional().nullable(),
  vrfId: z.string().optional().nullable(),
  gateway: ipSchema.optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

const addressSchema = z.object({
  address: ipSchema,
  status: z.nativeEnum(IpAddressStatus).optional(),
  siteId: z.string().optional().nullable(),
  prefixId: z.string().optional().nullable(),
  deviceId: z.string().optional().nullable(),
  dnsName: z.string().trim().max(255).optional().nullable(),
  interfaceLabel: z.string().trim().max(120).optional().nullable(),
  reservedBy: z.string().trim().max(120).optional().nullable(),
  reservationExpiresAt: z.coerce.date().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
});

/** Shared VRF include shape: site, prefixes count, and route targets (import/export RT). */
const VRF_INCLUDE = {
  site: { select: { id: true, name: true } },
  _count: { select: { prefixes: true } },
  routeTargets: { orderBy: [{ direction: 'asc' }, { rt: 'asc' }] },
} satisfies Prisma.VrfInclude;

type RouteTargetInput = z.infer<typeof vrfRouteTargetSchema>;

/** De-duplicate route targets by (rt, direction) to respect the unique constraint. */
function dedupeRouteTargets(items: RouteTargetInput[]): RouteTargetInput[] {
  const seen = new Set<string>();
  const out: RouteTargetInput[] = [];
  for (const item of items) {
    const key = `${item.direction}:${item.rt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export default async function ipamRoutes(app: FastifyInstance) {
  app.get('/vrfs', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as { siteId?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const where: any = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      const [vrfs, total] = await Promise.all([
        prisma.vrf.findMany({
          where,
          orderBy: [{ name: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
          include: VRF_INCLUDE,
        }),
        prisma.vrf.count({ where }),
      ]);
      return reply.send({ vrfs, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/vrfs', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = vrfSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (!body.siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      const { routeTargets, ...scalarFields } = body;
      const vrf = await prisma.vrf.create({
        data: {
          ...scalarFields,
          siteId: body.siteId ?? null,
          organizationId,
          ...(routeTargets ? { routeTargets: { create: dedupeRouteTargets(routeTargets) } } : {}),
        },
        include: VRF_INCLUDE,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.vrf.create', target: 'Vrf', targetId: vrf.id, ip: req.ip });
      return reply.code(201).send({ vrf });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/vrfs/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = vrfSchema.partial().parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertVrfAccess(id, organizationId, visibleIds);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      const { routeTargets, ...scalarFields } = body;
      // When `routeTargets` is provided, replace the whole set (full RT management).
      if (routeTargets) {
        await prisma.vrfRouteTarget.deleteMany({ where: { vrfId: id } });
      }
      const vrf = await prisma.vrf.update({
        where: { id },
        data: {
          ...scalarFields,
          ...(routeTargets ? { routeTargets: { create: dedupeRouteTargets(routeTargets) } } : {}),
        },
        include: VRF_INCLUDE,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.vrf.update', target: 'Vrf', targetId: id, ip: req.ip });
      return reply.send({ vrf });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/vrfs/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertVrfAccess(id, organizationId, visibleIds);
      await prisma.vrf.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.vrf.delete', target: 'Vrf', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/vlans', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as { siteId?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const where: any = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      const [vlans, total] = await Promise.all([
        prisma.vlan.findMany({
          where,
          orderBy: [{ vlanId: 'asc' }, { name: 'asc' }],
          skip: pagination.skip,
          take: pagination.take,
          include: {
            site: { select: { id: true, name: true } },
            _count: { select: { prefixes: true } },
          },
        }),
        prisma.vlan.count({ where }),
      ]);
      return reply.send({ vlans, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/vlans', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = vlanSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (!body.siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');

      const vlan = await prisma.vlan.create({
        data: { ...body, siteId: body.siteId ?? null, organizationId },
        include: { site: { select: { id: true, name: true } }, _count: { select: { prefixes: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.vlan.create', target: 'Vlan', targetId: vlan.id, ip: req.ip });
      return reply.code(201).send({ vlan });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/vlans/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = vlanSchema.partial().parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertVlanAccess(id, organizationId, visibleIds);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);

      const vlan = await prisma.vlan.update({
        where: { id },
        data: body,
        include: { site: { select: { id: true, name: true } }, _count: { select: { prefixes: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.vlan.update', target: 'Vlan', targetId: id, ip: req.ip });
      return reply.send({ vlan });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/vlans/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertVlanAccess(id, organizationId, visibleIds);
      await prisma.vlan.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.vlan.delete', target: 'Vlan', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/prefixes', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as { siteId?: string; vlanId?: string; vrfId?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const where: any = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      if (q.vlanId) where.vlanId = q.vlanId;
      if (q.vrfId) where.vrfId = q.vrfId;
      const [prefixes, total] = await Promise.all([
        prisma.ipPrefix.findMany({
          where,
          orderBy: { cidr: 'asc' },
          skip: pagination.skip,
          take: pagination.take,
          include: {
            site: { select: { id: true, name: true } },
            vlan: { select: { id: true, vlanId: true, name: true } },
            vrf: { select: { id: true, name: true, rd: true, routeTargets: { orderBy: { direction: 'asc' } } } },
            _count: { select: { addresses: true } },
          },
        }),
        prisma.ipPrefix.count({ where }),
      ]);
      return reply.send({ prefixes, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/prefixes', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = prefixSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (!body.siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      if (body.vlanId) await assertVlanAccess(body.vlanId, organizationId, visibleIds);
      if (body.vrfId) await assertVrfAccess(body.vrfId, organizationId, visibleIds);

      // Overlap / containment detection against prefixes in the same org+site+vrf.
      const siteId = body.siteId ?? null;
      const vrfId = body.vrfId ?? null;
      const siblings = await prisma.ipPrefix.findMany({
        where: { organizationId, siteId, vrfId },
        select: { id: true, cidr: true, name: true },
      });
      const overlap = checkPrefixOverlap(body.cidr, siblings);
      if (!overlap.isValid) {
        const first = overlap.overlaps[0];
        const detail = first.name ? `${first.cidr} (${first.name})` : first.cidr;
        throw new HttpError(409, `Le préfixe ${body.cidr} chevauche le préfixe existant ${detail} (${overlapTypeLabel(first.type)})`);
      }

      const prefix = await prisma.ipPrefix.create({
        data: { ...body, siteId: body.siteId ?? null, vlanId: body.vlanId ?? null, vrfId: body.vrfId ?? null, organizationId },
        include: {
          site: { select: { id: true, name: true } },
          vlan: { select: { id: true, vlanId: true, name: true } },
          vrf: { select: { id: true, name: true, rd: true, routeTargets: { orderBy: { direction: 'asc' } } } },
          _count: { select: { addresses: true } },
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.prefix.create', target: 'IpPrefix', targetId: prefix.id, ip: req.ip });
      return reply.code(201).send({ prefix });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/prefixes/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = prefixSchema.partial().parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const existingPrefix = await assertPrefixAccess(id, organizationId, visibleIds);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (body.vlanId) await assertVlanAccess(body.vlanId, organizationId, visibleIds);
      if (body.vrfId) await assertVrfAccess(body.vrfId, organizationId, visibleIds);

      // Overlap / containment detection when the CIDR or its scope changes.
      if (body.cidr !== undefined || body.siteId !== undefined || body.vrfId !== undefined) {
        const targetCidr = body.cidr ?? '';
        const scopeSiteId = body.siteId !== undefined ? (body.siteId ?? null) : existingPrefix.siteId;
        const scopeVrfId = body.vrfId !== undefined ? (body.vrfId ?? null) : (existingPrefix.vrfId ?? null);
        if (targetCidr) {
          const siblings = await prisma.ipPrefix.findMany({
            where: { organizationId, siteId: scopeSiteId, vrfId: scopeVrfId, NOT: { id } },
            select: { id: true, cidr: true, name: true },
          });
          const overlap = checkPrefixOverlap(targetCidr, siblings);
          if (!overlap.isValid) {
            const first = overlap.overlaps[0];
            const detail = first.name ? `${first.cidr} (${first.name})` : first.cidr;
            throw new HttpError(409, `Le préfixe ${targetCidr} chevauche le préfixe existant ${detail} (${overlapTypeLabel(first.type)})`);
          }
        }
      }

      const prefix = await prisma.ipPrefix.update({
        where: { id },
        data: body,
        include: {
          site: { select: { id: true, name: true } },
          vlan: { select: { id: true, vlanId: true, name: true } },
          vrf: { select: { id: true, name: true, rd: true, routeTargets: { orderBy: { direction: 'asc' } } } },
          _count: { select: { addresses: true } },
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.prefix.update', target: 'IpPrefix', targetId: id, ip: req.ip });
      return reply.send({ prefix });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/prefixes/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertPrefixAccess(id, organizationId, visibleIds);
      await prisma.ipPrefix.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.prefix.delete', target: 'IpPrefix', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/addresses', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = req.query as { siteId?: string; prefixId?: string; status?: IpAddressStatus; search?: string };
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const where: any = { organizationId, ...(await scopedSiteFilter(q.siteId, organizationId, visibleIds)) };
      if (q.prefixId) where.prefixId = q.prefixId;
      if (q.status) where.status = q.status;
      if (q.search) {
        where.OR = [
          { address: { contains: q.search, mode: 'insensitive' } },
          { dnsName: { contains: q.search, mode: 'insensitive' } },
          { interfaceLabel: { contains: q.search, mode: 'insensitive' } },
        ];
      }
      const [addresses, total] = await Promise.all([
        prisma.ipAddress.findMany({
          where,
          orderBy: { address: 'asc' },
          skip: pagination.skip,
          take: pagination.take,
          include: {
            site: { select: { id: true, name: true } },
            prefix: { select: { id: true, cidr: true, name: true, vrf: { select: { id: true, name: true, rd: true } } } },
            device: { select: { id: true, name: true, type: true } },
          },
        }),
        prisma.ipAddress.count({ where }),
      ]);
      return reply.send({ addresses, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/addresses', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = addressSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      let siteId = body.siteId ?? null;
      if (body.prefixId) {
        const prefix = await assertPrefixAccess(body.prefixId, organizationId, visibleIds);
        siteId ??= prefix.siteId;
      }
      if (siteId) await assertCanAccessSite(siteId, organizationId, visibleIds);
      if (!siteId && visibleIds !== null) throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
      if (body.deviceId) await assertCanAccessDevice(body.deviceId, organizationId, visibleIds);
      await assertTenantQuota(organizationId, 'ipAddresses');

      // Duplicate detection: the same address already assigned in this org+site.
      const duplicate = await prisma.ipAddress.findFirst({
        where: { organizationId, siteId, address: body.address },
        select: { id: true, deviceId: true, interfaceLabel: true },
      });
      if (duplicate) {
        const onDevice = duplicate.deviceId && duplicate.deviceId !== body.deviceId;
        throw new HttpError(
          409,
          onDevice
            ? `L'adresse ${body.address} est déjà attribuée à un autre équipement dans ce site`
            : `L'adresse ${body.address} est déjà attribuée dans ce site`,
        );
      }

      const address = await prisma.ipAddress.create({
        data: {
          ...body,
          organizationId,
          siteId,
          prefixId: body.prefixId ?? null,
          deviceId: body.deviceId ?? null,
          status: body.status ?? 'UNKNOWN',
        },
        include: {
          site: { select: { id: true, name: true } },
          prefix: { select: { id: true, cidr: true, name: true, vrf: { select: { id: true, name: true, rd: true } } } },
          device: { select: { id: true, name: true, type: true } },
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.address.create', target: 'IpAddress', targetId: address.id, ip: req.ip });
      return reply.code(201).send({ address });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/addresses/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = addressSchema.partial().parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const existing = await assertAddressAccess(id, organizationId, visibleIds);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (body.prefixId) await assertPrefixAccess(body.prefixId, organizationId, visibleIds);
      if (body.deviceId) await assertCanAccessDevice(body.deviceId, organizationId, visibleIds);

      const targetAddress = body.address ?? existing.address;
      const targetSiteId = body.siteId !== undefined ? body.siteId : existing.siteId;
      const duplicate = await prisma.ipAddress.findFirst({
        where: { organizationId, siteId: targetSiteId, address: targetAddress, NOT: { id } },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(409, `L'adresse ${targetAddress} est déjà attribuée dans ce site`);
      }

      const address = await prisma.ipAddress.update({
        where: { id },
        data: body,
        include: {
          site: { select: { id: true, name: true } },
          prefix: { select: { id: true, cidr: true, name: true, vrf: { select: { id: true, name: true, rd: true } } } },
          device: { select: { id: true, name: true, type: true } },
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.address.update', target: 'IpAddress', targetId: id, ip: req.ip });
      return reply.send({ address });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/addresses/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertAddressAccess(id, organizationId, visibleIds);
      await prisma.ipAddress.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'ipam.address.delete', target: 'IpAddress', targetId: id, ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

async function assertVrfAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const vrf = await prisma.vrf.findUnique({ where: { id }, select: { id: true, organizationId: true, siteId: true } });
  if (!vrf || vrf.organizationId !== organizationId) throw new HttpError(404, 'VRF introuvable');
  if (visibleSiteIds !== null && (!vrf.siteId || !visibleSiteIds.includes(vrf.siteId))) {
    throw new HttpError(403, 'Accès non autorisé à cette VRF');
  }
  return vrf;
}

async function assertVlanAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const vlan = await prisma.vlan.findUnique({ where: { id }, select: { id: true, organizationId: true, siteId: true } });
  if (!vlan || vlan.organizationId !== organizationId) throw new HttpError(404, 'VLAN introuvable');
  if (visibleSiteIds !== null && (!vlan.siteId || !visibleSiteIds.includes(vlan.siteId))) {
    throw new HttpError(403, 'Accès non autorisé à ce VLAN');
  }
  return vlan;
}

async function assertPrefixAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const prefix = await prisma.ipPrefix.findUnique({ where: { id }, select: { id: true, organizationId: true, siteId: true, vrfId: true } });
  if (!prefix || prefix.organizationId !== organizationId) throw new HttpError(404, 'Préfixe introuvable');
  if (visibleSiteIds !== null && (!prefix.siteId || !visibleSiteIds.includes(prefix.siteId))) {
    throw new HttpError(403, 'Accès non autorisé à ce préfixe');
  }
  return prefix;
}

async function assertAddressAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const address = await prisma.ipAddress.findUnique({ where: { id }, select: { id: true, organizationId: true, siteId: true, address: true } });
  if (!address || address.organizationId !== organizationId) throw new HttpError(404, 'Adresse IP introuvable');
  if (visibleSiteIds !== null && (!address.siteId || !visibleSiteIds.includes(address.siteId))) {
    throw new HttpError(403, 'Accès non autorisé à cette adresse IP');
  }
  return address;
}
