import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const notifications = await prisma.userNotification.findMany({ where: { organizationId, userId: req.user!.sub }, orderBy: { createdAt: 'desc' }, take: 50 });
      const unread = await prisma.userNotification.count({ where: { organizationId, userId: req.user!.sub, readAt: null } });
      return reply.send({ notifications, unread });
    } catch (err) { return handleError(reply, err); }
  });
  app.post('/:id/read', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!; const { id } = req.params as { id: string };
      const item = await prisma.userNotification.findFirst({ where: { id, organizationId, userId: req.user!.sub } });
      if (!item) throw new HttpError(404, 'Notification introuvable');
      return reply.send({ notification: await prisma.userNotification.update({ where: { id }, data: { readAt: new Date() } }) });
    } catch (err) { return handleError(reply, err); }
  });
  app.post('/read-all', { preHandler: [app.authenticate, app.requireOrg] }, async (req, reply) => {
    try { const { organizationId } = req.membership!; await prisma.userNotification.updateMany({ where: { organizationId, userId: req.user!.sub, readAt: null }, data: { readAt: new Date() } }); return reply.code(204).send(); } catch (err) { return handleError(reply, err); }
  });
}
