import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { assertCanAccessSite, getVisibleSiteIds } from '../services/scope.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { dispatchOutboundWebhook } from '../services/outboundWebhooks.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Le nom du site est obligatoire').max(120),
  description: z.string().max(2000).optional().nullable(),
  parentId: z.string().optional().nullable(),
  location: z.string().max(200).optional().nullable(),
});

const updateSchema = createSchema.partial();

export default async function sitesRoutes(app: FastifyInstance) {
  // ─── Visible hierarchy ───────────────────────────────────
  app.get(
    '/',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const pagination = parsePagination(req.query);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        const where = {
          organizationId,
          ...(visibleIds === null ? {} : { id: { in: visibleIds } }),
        };
        const [sites, total] = await Promise.all([
          prisma.site.findMany({
            where,
            orderBy: { name: 'asc' },
            skip: pagination.skip,
            take: pagination.take,
            include: { _count: { select: { diagrams: true, devices: true, children: true } } },
          }),
          prisma.site.count({ where }),
        ]);
        return reply.send({ sites, pagination: paginationMeta(pagination, total) });
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

        const site = await prisma.site.findFirst({
          where: { id, organizationId },
          include: {
            parent: true,
            _count: { select: { diagrams: true, devices: true, racks: true } },
          },
        });
        if (!site) throw new HttpError(404, 'Site introuvable');
        if (visibleIds !== null && !visibleIds.includes(id)) {
          throw new HttpError(403, 'Accès non autorisé à ce site');
        }
        return reply.send({ site });
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
        const body = createSchema.parse(req.body);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );

        if (body.parentId) {
          await assertCanAccessSite(body.parentId, organizationId, visibleIds);
        }
        await assertTenantQuota(organizationId, 'sites');
        const site = await prisma.site.create({
          data: {
            name: body.name,
            description: body.description,
            parentId: body.parentId ?? null,
            location: body.location,
            organizationId,
            createdById: req.user!.sub,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'site.create',
          target: 'Site',
          targetId: site.id,
          ip: req.ip,
        });
        await dispatchOutboundWebhook(organizationId, 'site.created', { site });
        return reply.code(201).send({ site });
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
        const body = updateSchema.parse(req.body);
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );
        await assertCanAccessSite(id, organizationId, visibleIds);

        const site = await prisma.site.update({ where: { id }, data: body });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'site.update',
          target: 'Site',
          targetId: id,
          ip: req.ip,
        });
        await dispatchOutboundWebhook(organizationId, 'site.updated', { site });
        return reply.send({ site });
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
        const visibleIds = await getVisibleSiteIds(
          req.user!.sub,
          organizationId,
          req.membership!.role,
        );
        await assertCanAccessSite(id, organizationId, visibleIds);

        const site = await prisma.site.delete({ where: { id } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'site.delete',
          target: 'Site',
          targetId: id,
          ip: req.ip,
        });
        await dispatchOutboundWebhook(organizationId, 'site.deleted', { site });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
