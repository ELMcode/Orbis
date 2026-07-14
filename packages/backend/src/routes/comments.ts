import { FastifyInstance } from 'fastify';
import { EntityCommentTarget } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { assertCanAccessDevice, getVisibleSiteIds } from '../services/scope.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';
import { notifyMentions } from '../services/mentions.js';

const targetSchema = z.nativeEnum(EntityCommentTarget);
const bodySchema = z.object({
  targetType: targetSchema,
  targetId: z.string().min(1),
  body: z.string().trim().min(1, 'Le commentaire est obligatoire').max(5000),
});
const updateSchema = z.object({
  body: z.string().trim().min(1).max(5000).optional(),
  resolved: z.boolean().optional(),
});

export default async function commentsRoutes(app: FastifyInstance) {
  app.get('/', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const q = z.object({ targetType: targetSchema, targetId: z.string().min(1) }).parse(req.query);
      const pagination = parsePagination(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertTargetAccess(q.targetType, q.targetId, organizationId, visibleIds);

      const where = { organizationId, ...targetWhere(q.targetType, q.targetId) };
      const [comments, total] = await Promise.all([
        prisma.entityComment.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: pagination.skip,
          take: pagination.take,
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.entityComment.count({ where }),
      ]);
      return reply.send({ comments, pagination: paginationMeta(pagination, total) });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = bodySchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      await assertTargetAccess(body.targetType, body.targetId, organizationId, visibleIds);

      const comment = await prisma.entityComment.create({
        data: {
          organizationId,
          userId: req.user!.sub,
          targetType: body.targetType,
          body: body.body,
          ...targetData(body.targetType, body.targetId),
        },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await notifyMentions({ organizationId, authorId: req.user!.sub, body: body.body, target: body.targetType, targetId: body.targetId });
      await audit({
        userId: req.user!.sub,
        organizationId,
        action: 'comment.create',
        target: body.targetType,
        targetId: body.targetId,
        ip: req.ip,
      });
      return reply.code(201).send({ comment });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = updateSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const existing = await loadCommentForAccess(id, organizationId, visibleIds);

      const comment = await prisma.entityComment.update({
        where: { id },
        data: body,
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      await audit({
        userId: req.user!.sub,
        organizationId,
        action: 'comment.update',
        target: existing.targetType,
        targetId: targetIdFromComment(existing),
        ip: req.ip,
      });
      return reply.send({ comment });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, req.membership!.role);
      const existing = await loadCommentForAccess(id, organizationId, visibleIds);
      await prisma.entityComment.delete({ where: { id } });
      await audit({
        userId: req.user!.sub,
        organizationId,
        action: 'comment.delete',
        target: existing.targetType,
        targetId: targetIdFromComment(existing),
        ip: req.ip,
      });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

function targetWhere(targetType: EntityCommentTarget, targetId: string) {
  switch (targetType) {
    case 'DEVICE':
      return { deviceId: targetId };
    case 'IP_PREFIX':
      return { ipPrefixId: targetId };
    case 'IP_ADDRESS':
      return { ipAddressId: targetId };
  }
}

function targetData(targetType: EntityCommentTarget, targetId: string) {
  switch (targetType) {
    case 'DEVICE':
      return { deviceId: targetId };
    case 'IP_PREFIX':
      return { ipPrefixId: targetId };
    case 'IP_ADDRESS':
      return { ipAddressId: targetId };
  }
}

async function assertTargetAccess(
  targetType: EntityCommentTarget,
  targetId: string,
  organizationId: string,
  visibleSiteIds: string[] | null,
) {
  if (targetType === 'DEVICE') {
    await assertCanAccessDevice(targetId, organizationId, visibleSiteIds);
    return;
  }
  if (targetType === 'IP_PREFIX') {
    const prefix = await prisma.ipPrefix.findUnique({
      where: { id: targetId },
      select: { id: true, organizationId: true, siteId: true },
    });
    if (!prefix || prefix.organizationId !== organizationId) throw new HttpError(404, 'Préfixe introuvable');
    if (visibleSiteIds !== null && (!prefix.siteId || !visibleSiteIds.includes(prefix.siteId))) {
      throw new HttpError(403, 'Accès non autorisé à ce préfixe');
    }
    return;
  }
  const address = await prisma.ipAddress.findUnique({
    where: { id: targetId },
    select: { id: true, organizationId: true, siteId: true },
  });
  if (!address || address.organizationId !== organizationId) throw new HttpError(404, 'Adresse IP introuvable');
  if (visibleSiteIds !== null && (!address.siteId || !visibleSiteIds.includes(address.siteId))) {
    throw new HttpError(403, 'Accès non autorisé à cette adresse IP');
  }
}

async function loadCommentForAccess(id: string, organizationId: string, visibleSiteIds: string[] | null) {
  const comment = await prisma.entityComment.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      targetType: true,
      deviceId: true,
      ipPrefixId: true,
      ipAddressId: true,
    },
  });
  if (!comment || comment.organizationId !== organizationId) throw new HttpError(404, 'Commentaire introuvable');
  await assertTargetAccess(comment.targetType, targetIdFromComment(comment), organizationId, visibleSiteIds);
  return comment;
}

function targetIdFromComment(comment: {
  targetType: EntityCommentTarget;
  deviceId: string | null;
  ipPrefixId: string | null;
  ipAddressId: string | null;
}) {
  if (comment.targetType === 'DEVICE' && comment.deviceId) return comment.deviceId;
  if (comment.targetType === 'IP_PREFIX' && comment.ipPrefixId) return comment.ipPrefixId;
  if (comment.targetType === 'IP_ADDRESS' && comment.ipAddressId) return comment.ipAddressId;
  throw new HttpError(400, 'Commentaire incohérent');
}
