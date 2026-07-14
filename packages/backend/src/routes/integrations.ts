import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { createPrefixedToken, hashToken } from '../utils/token.js';
import { normalizeScopes, PUBLIC_API_SCOPES } from '../services/publicApi.js';
import {
  createWebhookSecret,
  normalizeWebhookEvents,
  OUTBOUND_WEBHOOK_EVENTS,
  testOutboundWebhook,
  encryptWebhookSecret,
} from '../services/outboundWebhooks.js';
import { encryptCredential } from '../services/credentialVault.js';
import { assertSafeOutboundUrl } from '../services/outboundUrl.js';

const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string()).optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});

const webhookCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().url(),
  events: z.array(z.string()).optional(),
});

const webhookUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().url().optional(),
  events: z.array(z.string()).optional(),
  status: z.enum(['ACTIVE', 'PAUSED']).optional(),
});

const credentialSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(['AWS', 'AZURE', 'GCP', 'VSPHERE', 'PROXMOX', 'HYPERV']),
  secret: z.record(z.string(), z.string().max(10_000)).refine((value) => Object.keys(value).length > 0, 'Au moins un identifiant est requis'),
  metadata: z.record(z.string(), z.string().max(500)).optional(),
});

export default async function integrationsRoutes(app: FastifyInstance) {
  app.get('/credentials', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const credentials = await prisma.integrationCredential.findMany({
        where: { organizationId }, orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, provider: true, metadata: true, createdAt: true, updatedAt: true },
      });
      return reply.send({ credentials, configured: Boolean(process.env.INTEGRATION_ENCRYPTION_KEY) });
    } catch (err) { return handleError(reply, err); }
  });

  app.post('/credentials', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = credentialSchema.parse(req.body);
      const credential = await prisma.integrationCredential.create({
        data: { organizationId, name: body.name, provider: body.provider, encryptedData: encryptCredential(body.secret), metadata: body.metadata },
        select: { id: true, name: true, provider: true, metadata: true, createdAt: true, updatedAt: true },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.credential.create', target: 'IntegrationCredential', targetId: credential.id, ip: req.ip });
      return reply.code(201).send({ credential });
    } catch (err) { return handleError(reply, err); }
  });

  app.delete('/credentials/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const credential = await prisma.integrationCredential.findFirst({ where: { id, organizationId } });
      if (!credential) throw new HttpError(404, 'Identifiant introuvable');
      await prisma.integrationCredential.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.credential.delete', target: 'IntegrationCredential', targetId: id, ip: req.ip });
      return reply.code(204).send();
    } catch (err) { return handleError(reply, err); }
  });
  app.get('/catalog', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (_req, reply) => {
    return reply.send({
      publicApi: {
        baseUrl: '/api/public/v1',
        docs: '/api/docs',
        openapi: '/api/docs/openapi.json',
        scopes: PUBLIC_API_SCOPES,
      },
      webhooks: {
        events: OUTBOUND_WEBHOOK_EVENTS,
        signatureHeader: 'X-Orbis-Signature',
        legacySignatureHeader: 'X-Orbis-Signature',
      },
    });
  });

  app.get('/api-keys', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const keys = await prisma.publicApiKey.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          tokenPrefix: true,
          scopes: true,
          status: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });
      return reply.send({ keys, scopes: PUBLIC_API_SCOPES });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/api-keys', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = apiKeyCreateSchema.parse(req.body);
      const scopes = normalizeScopes(body.scopes);
      const token = createPrefixedToken('isk');
      const tokenPrefix = token.slice(0, 12);
      const key = await prisma.publicApiKey.create({
        data: {
          organizationId,
          name: body.name,
          tokenPrefix,
          tokenHash: hashToken(token),
          scopes,
          expiresAt: body.expiresAt ?? null,
        },
        select: {
          id: true,
          name: true,
          tokenPrefix: true,
          scopes: true,
          status: true,
          expiresAt: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.api_key.create', target: 'PublicApiKey', targetId: key.id, ip: req.ip });
      return reply.code(201).send({ key, token });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/api-keys/:id/revoke', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const key = await prisma.publicApiKey.findFirst({ where: { id, organizationId } });
      if (!key) throw new HttpError(404, 'Clé API introuvable');
      const updated = await prisma.publicApiKey.update({
        where: { id },
        data: { status: 'REVOKED' },
        select: { id: true, name: true, tokenPrefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.api_key.revoke', target: 'PublicApiKey', targetId: id, ip: req.ip });
      return reply.send({ key: updated });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/webhooks', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const endpoints = await prisma.webhookEndpoint.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          url: true,
          events: true,
          status: true,
          lastSuccessAt: true,
          lastFailureAt: true,
          createdAt: true,
          _count: { select: { deliveries: true } },
        },
      });
      return reply.send({ endpoints, events: OUTBOUND_WEBHOOK_EVENTS });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/webhooks', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = webhookCreateSchema.parse(req.body);
      await assertSafeOutboundUrl(body.url);
      const events = normalizeEventsOrThrow(body.events);
      const secret = createWebhookSecret();
      const endpoint = await prisma.webhookEndpoint.create({
        data: { organizationId, name: body.name, url: body.url, events, secret: encryptWebhookSecret(secret) },
        select: {
          id: true,
          name: true,
          url: true,
          events: true,
          status: true,
          lastSuccessAt: true,
          lastFailureAt: true,
          createdAt: true,
        },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.webhook.create', target: 'WebhookEndpoint', targetId: endpoint.id, ip: req.ip });
      return reply.code(201).send({ endpoint, secret });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/webhooks/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const body = webhookUpdateSchema.parse(req.body);
      if (body.url) await assertSafeOutboundUrl(body.url);
      const current = await prisma.webhookEndpoint.findFirst({ where: { id, organizationId } });
      if (!current) throw new HttpError(404, 'Webhook introuvable');
      const endpoint = await prisma.webhookEndpoint.update({
        where: { id },
        data: {
          ...body,
          events: body.events ? normalizeEventsOrThrow(body.events) : undefined,
        },
        select: { id: true, name: true, url: true, events: true, status: true, lastSuccessAt: true, lastFailureAt: true, createdAt: true },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.webhook.update', target: 'WebhookEndpoint', targetId: id, ip: req.ip });
      return reply.send({ endpoint });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/webhooks/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const current = await prisma.webhookEndpoint.findFirst({ where: { id, organizationId } });
      if (!current) throw new HttpError(404, 'Webhook introuvable');
      await prisma.webhookEndpoint.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.webhook.delete', target: 'WebhookEndpoint', targetId: id, ip: req.ip });
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/webhooks/:id/test', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const result = await testOutboundWebhook(id, organizationId);
      if (!result) throw new HttpError(404, 'Webhook introuvable');
      await audit({ userId: req.user!.sub, organizationId, action: 'integration.webhook.test', target: 'WebhookEndpoint', targetId: id, ip: req.ip });
      return reply.send({ delivery: result });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/webhooks/:id/deliveries', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const { id } = req.params as { id: string };
      const endpoint = await prisma.webhookEndpoint.findFirst({ where: { id, organizationId } });
      if (!endpoint) throw new HttpError(404, 'Webhook introuvable');
      const deliveries = await prisma.webhookDelivery.findMany({
        where: { endpointId: id, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          eventType: true,
          status: true,
          statusCode: true,
          error: true,
          deliveredAt: true,
          createdAt: true,
        },
      });
      return reply.send({ deliveries });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

function normalizeEventsOrThrow(events: string[] | undefined) {
  try {
    return normalizeWebhookEvents(events);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : 'Événements webhook invalides');
  }
}
