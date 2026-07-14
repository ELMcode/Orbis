import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { PortType } from '@prisma/client';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { assertCanAccessDevice, assertInOrg, getVisibleSiteIds } from '../services/scope.js';

const portFields = {
  label: z.string().min(1).max(40),
  portType: z.nativeEnum(PortType).optional(),
  speed: z.string().max(20).optional().nullable(),
  connectedPortId: z.string().optional().nullable(),
  vlan: z.string().max(120).optional().nullable(),
  description: z.string().max(280).optional().nullable(),
};
const createSchema = z.object(portFields);
const updateSchema = z.object(portFields).partial();

export default async function portsRoutes(app: FastifyInstance) {
  // List all ports for a device.
  app.get(
    '/devices/:id/ports',
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

        // Read-side IDOR guard: verify device access before listing its ports.
        await assertCanAccessDevice(id, organizationId, visibleIds);

        const ports = await prisma.port.findMany({
          where: { deviceId: id },
          orderBy: { label: 'asc' },
        });
        return reply.send({ ports });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post(
    '/devices/:id/ports',
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

        await assertCanAccessDevice(id, organizationId, visibleIds);

        const body = createSchema.parse(req.body);
        const port = await prisma.port.create({ data: { ...body, deviceId: id } as any });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'port.create',
          target: 'Device',
          targetId: id,
          ip: req.ip,
        });
        return reply.code(201).send({ port });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.patch(
    '/ports/:portId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { portId } = req.params as { portId: string };
        const body = updateSchema.parse(req.body);

        await assertInOrg('port', portId, organizationId);

        // Bidirectional connection: when connecting to another port, verify its
        // organization and update the other side as well.
        if (body.connectedPortId !== undefined && body.connectedPortId) {
          await assertInOrg('port', body.connectedPortId, organizationId);
          const other = await prisma.port.findUnique({ where: { id: body.connectedPortId } });
          if (!other) throw new HttpError(404, 'Port cible introuvable');
          // Avoid loops.
          if (other.connectedPortId && other.connectedPortId !== portId) {
            // Disconnect the previous link.
            await prisma.port.update({
              where: { id: other.connectedPortId },
              data: { connectedPortId: null },
            });
          }
          await prisma.port.update({
            where: { id: body.connectedPortId },
            data: { connectedPortId: portId },
          });
        }

        const port = await prisma.port.update({ where: { id: portId }, data: body as any });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'port.update',
          target: 'Port',
          targetId: portId,
          ip: req.ip,
        });
        return reply.send({ port });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.delete(
    '/ports/:portId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { portId } = req.params as { portId: string };
        await assertInOrg('port', portId, organizationId);

        const port = await prisma.port.findUnique({ where: { id: portId } });
        if (port?.connectedPortId) {
          await prisma.port.update({
            where: { id: port.connectedPortId },
            data: { connectedPortId: null },
          });
        }
        await prisma.port.delete({ where: { id: portId } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'port.delete',
          target: 'Port',
          targetId: portId,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}
