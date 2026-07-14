import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import {
  assertCanAccessDevice,
  assertCanAccessSite,
  assertInOrg,
  getVisibleSiteIds,
  scopedSiteFilter,
} from '../services/scope.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';

const createRackSchema = z.object({
  name: z.string().min(1).max(120),
  siteId: z.string().optional().nullable(),
  totalUnits: z.number().int().min(1).max(60).default(42),
  description: z.string().max(2000).optional().nullable(),
});
const updateRackSchema = createRackSchema.partial();

const slotSchema = z.object({
  deviceId: z.string(),
  startUnit: z.number().int().min(1),
  units: z.number().int().min(1).max(20).default(1),
});

export default async function racksRoutes(app: FastifyInstance) {
  app.get(
    '/',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { siteId } = req.query as { siteId?: string };
        const pagination = parsePagination(req.query);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );
        const where = {
          organizationId,
          ...(await scopedSiteFilter(siteId, organizationId, visibleIds)),
        };
        const [racks, total] = await Promise.all([
          prisma.rack.findMany({
            where,
            orderBy: { name: 'asc' },
            skip: pagination.skip,
            take: pagination.take,
            include: {
              site: { select: { id: true, name: true } },
              _count: { select: { slots: true } },
            },
          }),
          prisma.rack.count({ where }),
        ]);
        return reply.send({ racks, pagination: paginationMeta(pagination, total) });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.get(
    '/:id',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        const rack = await prisma.rack.findFirst({
          where: { id, organizationId },
          include: {
            site: true,
            slots: { include: { device: true }, orderBy: { startUnit: 'asc' } },
          },
        });
        if (!rack) throw new HttpError(404, 'Baie introuvable');

        if (visibleIds !== null && rack.siteId && !visibleIds.includes(rack.siteId)) {
          throw new HttpError(403, 'Accès non autorisé à cette baie');
        }
        return reply.send({ rack });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post(
    '/',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const body = createRackSchema.parse(req.body);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );
        if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
        if (!body.siteId && visibleIds !== null)
          throw new HttpError(403, 'Un site est requis pour un utilisateur restreint');
        const rack = await prisma.rack.create({
          data: {
            name: body.name,
            siteId: body.siteId ?? null,
            totalUnits: body.totalUnits,
            description: body.description ?? null,
            organizationId,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'rack.create',
          target: 'Rack',
          targetId: rack.id,
          ip: req.ip,
        });
        return reply.code(201).send({ rack });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const body = updateRackSchema.parse(req.body);
        await assertInOrg('rack', id, organizationId);

        const rack = await prisma.rack.update({ where: { id }, data: body });
        return reply.send({ rack });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/:id',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        await assertInOrg('rack', id, organizationId);

        await prisma.rack.delete({ where: { id } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'rack.delete',
          target: 'Rack',
          targetId: id,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Slots ───────────────────────────────────────────────
  app.post(
    '/:id/slots',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const body = slotSchema.parse(req.body);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        const rack = await prisma.rack.findFirst({
          where: { id, organizationId },
          select: { siteId: true, totalUnits: true },
        });
        if (!rack) throw new HttpError(404, 'Baie introuvable');
        if (body.startUnit + body.units - 1 > rack.totalUnits) {
          throw new HttpError(400, 'Position hors baie');
        }
        // Verify access to the device being inserted.
        await assertCanAccessDevice(body.deviceId, organizationId, visibleIds);

        // The slot creates the RackSlot-to-Device relation; only synchronize the site.
        const slot = await prisma.rackSlot.create({
          data: {
            rackId: id,
            deviceId: body.deviceId,
            startUnit: body.startUnit,
            units: body.units,
          },
        });
        await prisma.device.update({ where: { id: body.deviceId }, data: { siteId: rack.siteId } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'rack.slot',
          target: 'Rack',
          targetId: id,
          ip: req.ip,
          meta: body,
        });
        return reply.code(201).send({ slot });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/slots/:slotId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { slotId } = req.params as { slotId: string };
        await assertInOrg('rackSlot', slotId, organizationId);

        await prisma.rackSlot.delete({ where: { id: slotId } });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
