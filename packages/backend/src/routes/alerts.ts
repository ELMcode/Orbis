import { FastifyInstance } from 'fastify';
import { DiscoveryEventSeverity, DiscoveryEventType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { getVisibleSiteIds, scopedSiteFilter, siteFilter } from '../services/scope.js';
import { assertSafeOutboundUrl } from '../services/outboundUrl.js';

const settingsSchema = z.object({
  emailEnabled: z.boolean().default(false),
  emailRecipients: z.array(z.string().trim().email()).max(30).default([]),
  webhookEnabled: z.boolean().default(false),
  webhookUrl: z.string().trim().url().optional().nullable(),
  slackEnabled: z.boolean().default(false),
  slackWebhookUrl: z.string().trim().url().optional().nullable(),
  teamsEnabled: z.boolean().default(false),
  teamsWebhookUrl: z.string().trim().url().optional().nullable(),
  minSeverity: z.nativeEnum(DiscoveryEventSeverity).default('WARNING'),
  eventTypes: z.array(z.nativeEnum(DiscoveryEventType)).max(20).default([]),
  includeResolvedInfo: z.boolean().default(false),
}).refine((value) => !value.webhookEnabled || Boolean(value.webhookUrl), {
  message: 'Une URL webhook est requise si le canal webhook est activé',
  path: ['webhookUrl'],
}).refine((value) => !value.slackEnabled || Boolean(value.slackWebhookUrl), {
  message: 'Une URL Slack est requise si le canal Slack est activé',
  path: ['slackWebhookUrl'],
}).refine((value) => !value.teamsEnabled || Boolean(value.teamsWebhookUrl), {
  message: 'Une URL Teams est requise si le canal Teams est activé',
  path: ['teamsWebhookUrl'],
});

const listQuerySchema = z.object({
  status: z.enum(['open', 'acknowledged', 'all']).default('open'),
  severity: z.nativeEnum(DiscoveryEventSeverity).optional(),
  type: z.nativeEnum(DiscoveryEventType).optional(),
  siteId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export default async function alertsRoutes(app: FastifyInstance) {
  app.get('/', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const query = listQuerySchema.parse(req.query);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const scope = await scopedSiteFilter(query.siteId, organizationId, visibleIds);
      const where: Prisma.DiscoveryEventWhereInput = {
        organizationId,
        ...scope,
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status === 'open' ? { acknowledgedAt: null } : {}),
        ...(query.status === 'acknowledged' ? { acknowledgedAt: { not: null } } : {}),
      };

      const [alerts, counts] = await Promise.all([
        prisma.discoveryEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: query.limit,
          include: {
            collector: { select: { id: true, name: true } },
            site: { select: { id: true, name: true } },
            device: { select: { id: true, name: true, type: true, ip: true } },
            acknowledgedBy: { select: { id: true, name: true, email: true } },
            deliveries: { orderBy: { createdAt: 'desc' }, take: 5 },
          },
        }),
        prisma.discoveryEvent.groupBy({
          by: ['severity'],
          where: { organizationId, ...scope, acknowledgedAt: null },
          _count: true,
        }),
      ]);

      return reply.send({
        alerts,
        counts: {
          open: counts.reduce((sum, row) => sum + row._count, 0),
          critical: counts.find((row) => row.severity === 'CRITICAL')?._count ?? 0,
          warning: counts.find((row) => row.severity === 'WARNING')?._count ?? 0,
          info: counts.find((row) => row.severity === 'INFO')?._count ?? 0,
        },
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/settings', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const settings = await getOrCreateSettings(organizationId);
      return reply.send({ settings });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.put('/settings', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = settingsSchema.parse(req.body);
      await Promise.all([
        body.webhookUrl ? assertSafeOutboundUrl(body.webhookUrl) : undefined,
        body.slackWebhookUrl ? assertSafeOutboundUrl(body.slackWebhookUrl) : undefined,
        body.teamsWebhookUrl ? assertSafeOutboundUrl(body.teamsWebhookUrl) : undefined,
      ]);
      const settings = await prisma.alertSettings.upsert({
        where: { organizationId },
        create: {
          organizationId,
          emailEnabled: body.emailEnabled,
          emailRecipients: body.emailRecipients,
          webhookEnabled: body.webhookEnabled,
          webhookUrl: body.webhookUrl,
          slackEnabled: body.slackEnabled,
          slackWebhookUrl: body.slackWebhookUrl,
          teamsEnabled: body.teamsEnabled,
          teamsWebhookUrl: body.teamsWebhookUrl,
          minSeverity: body.minSeverity,
          eventTypes: body.eventTypes,
          includeResolvedInfo: body.includeResolvedInfo,
        },
        update: {
          emailEnabled: body.emailEnabled,
          emailRecipients: body.emailRecipients,
          webhookEnabled: body.webhookEnabled,
          webhookUrl: body.webhookUrl,
          slackEnabled: body.slackEnabled,
          slackWebhookUrl: body.slackWebhookUrl,
          teamsEnabled: body.teamsEnabled,
          teamsWebhookUrl: body.teamsWebhookUrl,
          minSeverity: body.minSeverity,
          eventTypes: body.eventTypes,
          includeResolvedInfo: body.includeResolvedInfo,
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'alerts.settings.update', target: 'AlertSettings', targetId: settings.id, ip: req.ip });
      return reply.send({ settings });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/:id/acknowledge', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const id = z.string().parse((req.params as any).id);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const current = await prisma.discoveryEvent.findFirst({
        where: { id, organizationId, ...siteFilter(visibleIds) },
      });
      if (!current) throw new HttpError(404, 'Alerte introuvable');

      const alert = await prisma.discoveryEvent.update({
        where: { id },
        data: { acknowledgedAt: current.acknowledgedAt ?? new Date(), acknowledgedById: current.acknowledgedById ?? req.user!.sub },
        include: {
          collector: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
          device: { select: { id: true, name: true, type: true, ip: true } },
          acknowledgedBy: { select: { id: true, name: true, email: true } },
          deliveries: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'alerts.acknowledge', target: 'DiscoveryEvent', targetId: id, ip: req.ip });
      return reply.send({ alert });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

async function getOrCreateSettings(organizationId: string) {
  return prisma.alertSettings.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}
