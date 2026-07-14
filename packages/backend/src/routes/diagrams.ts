import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import {
  assertCanAccessSite,
  assertInOrg,
  getVisibleSiteIds,
  scopedSiteFilter,
} from '../services/scope.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';
import { notifyMentions } from '../services/mentions.js';

const MAX_HISTORY = 30;

const createSchema = z.object({
  name: z.string().min(1).max(120),
  siteId: z.string().optional().nullable(),
  nodes: z.any().default([]),
  edges: z.any().default([]),
  viewport: z.any().optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  siteId: z.string().optional().nullable(),
  nodes: z.any().optional(),
  edges: z.any().optional(),
  viewport: z.any().optional().nullable(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

const commentSchema = z.object({
  body: z.string().trim().min(1, 'Le commentaire est obligatoire').max(2000),
  x: z.number().optional().nullable(),
  y: z.number().optional().nullable(),
});

const commentUpdateSchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
  resolved: z.boolean().optional(),
});

export default async function diagramsRoutes(app: FastifyInstance) {
  // ─── List (scope-filtered) ───────────────────────────────
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

        const [diagrams, total] = await Promise.all([
          prisma.diagram.findMany({
            where,
            orderBy: { updatedAt: 'desc' },
            skip: pagination.skip,
            take: pagination.take,
            include: {
              site: { select: { id: true, name: true } },
              _count: { select: { history: true } },
            },
          }),
          prisma.diagram.count({ where }),
        ]);
        return reply.send({ diagrams, pagination: paginationMeta(pagination, total) });
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

        const diagram = await prisma.diagram.findFirst({
          where: { id, organizationId },
          include: { site: true },
        });
        if (!diagram) throw new HttpError(404, 'Diagramme introuvable');

        // Verify site scope when the user is restricted.
        if (diagram.siteId && visibleIds !== null && !visibleIds.includes(diagram.siteId)) {
          throw new HttpError(403, 'Accès non autorisé à ce diagramme');
        }

        return reply.send({ diagram });
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

        if (body.siteId) {
          await assertCanAccessSite(body.siteId, organizationId, visibleIds);
        }
        await assertTenantQuota(organizationId, 'diagrams');

        const diagram = await prisma.diagram.create({
          data: {
            name: body.name,
            siteId: body.siteId ?? null,
            nodes: body.nodes,
            edges: body.edges,
            viewport: body.viewport ?? null,
            organizationId,
            createdById: req.user!.sub,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.create',
          target: 'Diagram',
          targetId: diagram.id,
          ip: req.ip,
        });
        return reply.code(201).send({ diagram });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Update (with history snapshot) ─────────────────────
  app.put(
    '/:id',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const body = updateSchema.parse(req.body);

        await assertInOrg('diagram', id, organizationId);
        const current = await prisma.diagram.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, 'Diagramme introuvable');
        if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) {
          throw new HttpError(
            409,
            'Le schéma a été modifié par une autre session. Rechargez avant de sauvegarder.',
          );
        }

        // Snapshot the previous state for history, capped at MAX_HISTORY.
        const data: any = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.siteId !== undefined) data.siteId = body.siteId;
        if (body.nodes !== undefined) data.nodes = body.nodes;
        if (body.edges !== undefined) data.edges = body.edges;
        if (body.viewport !== undefined) data.viewport = body.viewport;
        data.version = current.version + 1;

        await prisma.diagramVersion.create({
          data: { diagramId: id, nodes: current.nodes as any, edges: current.edges as any },
        });
        // Remove older versions.
        const oldVersions = await prisma.diagramVersion.findMany({
          where: { diagramId: id },
          orderBy: { createdAt: 'desc' },
          skip: MAX_HISTORY,
          select: { id: true },
        });
        if (oldVersions.length) {
          await prisma.diagramVersion.deleteMany({
            where: { id: { in: oldVersions.map((v) => v.id) } },
          });
        }

        const diagram = await prisma.diagram.update({ where: { id }, data });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.update',
          target: 'Diagram',
          targetId: id,
          ip: req.ip,
        });
        return reply.send({ diagram });
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
        await assertInOrg('diagram', id, organizationId);

        await prisma.diagram.delete({ where: { id } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.delete',
          target: 'Diagram',
          targetId: id,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── History and restore ─────────────────────────────────
  app.get(
    '/:id/history',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        await assertInOrg('diagram', id, organizationId);

        const history = await prisma.diagramVersion.findMany({
          where: { diagramId: id },
          orderBy: { createdAt: 'desc' },
          take: MAX_HISTORY,
        });
        return reply.send({ history });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post(
    '/:id/restore/:versionId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id, versionId } = req.params as { id: string; versionId: string };
        await assertInOrg('diagram', id, organizationId);

        const version = await prisma.diagramVersion.findFirst({
          where: { id: versionId, diagramId: id },
        });
        if (!version) throw new HttpError(404, 'Version introuvable');

        const current = await prisma.diagram.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, 'Diagramme introuvable');

        await prisma.diagramVersion.create({
          data: { diagramId: id, nodes: current.nodes as any, edges: current.edges as any },
        });

        const diagram = await prisma.diagram.update({
          where: { id },
          data: {
            nodes: version.nodes as any,
            edges: version.edges as any,
            version: current.version + 1,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.restore',
          target: 'Diagram',
          targetId: id,
          ip: req.ip,
          meta: { versionId },
        });
        return reply.send({ diagram });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.get(
    '/:id/comments',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        await assertCanAccessDiagram(id, organizationId, req.user!.sub, req.membership!.role);

        const comments = await prisma.diagramComment.findMany({
          where: { diagramId: id, organizationId },
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        return reply.send({ comments });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post(
    '/:id/comments',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id } = req.params as { id: string };
        const body = commentSchema.parse(req.body);
        await assertCanAccessDiagram(id, organizationId, req.user!.sub, req.membership!.role);

        const comment = await prisma.diagramComment.create({
          data: {
            organizationId,
            diagramId: id,
            userId: req.user!.sub,
            body: body.body,
            x: body.x ?? null,
            y: body.y ?? null,
          },
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        await notifyMentions({
          organizationId,
          authorId: req.user!.sub,
          body: body.body,
          target: 'DIAGRAM',
          targetId: id,
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.comment.create',
          target: 'DiagramComment',
          targetId: comment.id,
          ip: req.ip,
        });
        return reply.code(201).send({ comment });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.patch(
    '/:id/comments/:commentId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id, commentId } = req.params as { id: string; commentId: string };
        const body = commentUpdateSchema.parse(req.body);
        await assertCanAccessDiagram(id, organizationId, req.user!.sub, req.membership!.role);

        const existing = await prisma.diagramComment.findUnique({ where: { id: commentId } });
        if (!existing || existing.diagramId !== id || existing.organizationId !== organizationId) {
          throw new HttpError(404, 'Commentaire introuvable');
        }
        const comment = await prisma.diagramComment.update({
          where: { id: commentId },
          data: body,
          include: { user: { select: { id: true, name: true, email: true } } },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.comment.update',
          target: 'DiagramComment',
          targetId: commentId,
          ip: req.ip,
        });
        return reply.send({ comment });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/:id/comments/:commentId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { id, commentId } = req.params as { id: string; commentId: string };
        await assertCanAccessDiagram(id, organizationId, req.user!.sub, req.membership!.role);

        const comment = await prisma.diagramComment.findUnique({ where: { id: commentId } });
        if (!comment || comment.diagramId !== id || comment.organizationId !== organizationId) {
          throw new HttpError(404, 'Commentaire introuvable');
        }
        await prisma.diagramComment.delete({ where: { id: commentId } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'diagram.comment.delete',
          target: 'DiagramComment',
          targetId: commentId,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}

async function assertCanAccessDiagram(
  id: string,
  organizationId: string,
  userId: string,
  role: any,
) {
  const visibleIds = await getVisibleSiteIds(userId, organizationId, role);
  const diagram = await prisma.diagram.findFirst({
    where: { id, organizationId },
    select: { siteId: true },
  });
  if (!diagram) throw new HttpError(404, 'Diagramme introuvable');
  if (diagram.siteId && visibleIds !== null && !visibleIds.includes(diagram.siteId)) {
    throw new HttpError(403, 'Accès non autorisé à ce diagramme');
  }
}
