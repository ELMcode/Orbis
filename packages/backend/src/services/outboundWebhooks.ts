import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { assertSafeOutboundUrl } from './outboundUrl.js';
import { decryptCredential, encryptCredential } from './credentialVault.js';

export const OUTBOUND_WEBHOOK_EVENTS = [
  'device.created',
  'device.updated',
  'device.deleted',
  'site.created',
  'site.updated',
  'site.deleted',
  'discovery.event',
  'integration.test',
] as const;

export type OutboundWebhookEvent = typeof OUTBOUND_WEBHOOK_EVENTS[number];

export function createWebhookSecret() {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

export function encryptWebhookSecret(secret: string): string {
  return encryptCredential({ secret });
}

function decryptWebhookSecret(value: string): string {
  // Migration compatibility: legacy secrets are re-encrypted on next use.
  // New secrets are encrypted when they are created.
  if (value.startsWith('whsec_')) return value;
  const decoded = decryptCredential(value).secret;
  if (typeof decoded !== 'string' || decoded.length < 32) {
    throw new Error('Secret webhook chiffré invalide');
  }
  return decoded;
}

export async function dispatchOutboundWebhook(
  organizationId: string,
  eventType: OutboundWebhookEvent,
  data: Record<string, unknown>,
) {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      organizationId,
      status: 'ACTIVE',
      OR: [{ events: { isEmpty: true } }, { events: { has: eventType } }],
    },
  });
  if (endpoints.length === 0) return;

  await Promise.all(endpoints.map((endpoint) => deliverToEndpoint(endpoint, eventType, data)));
}

export async function testOutboundWebhook(endpointId: string, organizationId: string) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: { id: endpointId, organizationId },
  });
  if (!endpoint) return null;
  return deliverToEndpoint(endpoint, 'integration.test', {
    message: 'Test webhook Orbis',
    endpointId,
  });
}

export function normalizeWebhookEvents(events: string[] | undefined): OutboundWebhookEvent[] {
  const requested = events ?? [];
  const unknown = requested.filter((event) => !OUTBOUND_WEBHOOK_EVENTS.includes(event as OutboundWebhookEvent));
  if (unknown.length > 0) {
    throw new Error(`Événements webhook inconnus : ${unknown.join(', ')}`);
  }
  return [...new Set(requested)] as OutboundWebhookEvent[];
}

async function deliverToEndpoint(
  endpoint: {
    id: string;
    organizationId: string;
    url: string;
    secret: string;
  },
  eventType: OutboundWebhookEvent,
  data: Record<string, unknown>,
) {
  const payload = {
    id: `evt_${randomBytes(12).toString('hex')}`,
    source: 'orbis',
    type: eventType,
    organizationId: endpoint.organizationId,
    createdAt: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);
  const secret = decryptWebhookSecret(endpoint.secret);
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  if (endpoint.secret.startsWith('whsec_')) {
    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { secret: encryptWebhookSecret(secret) },
    });
  }
  const delivery = await prisma.webhookDelivery.create({
    data: {
      organizationId: endpoint.organizationId,
      endpointId: endpoint.id,
      eventType,
      payload: payload as Prisma.InputJsonValue,
      status: 'PENDING',
    },
  });

  try {
    const response = await fetch(await assertSafeOutboundUrl(endpoint.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Orbis-Webhooks/1.0',
        'X-Orbis-Event': eventType,
        'X-Orbis-Delivery': delivery.id,
        'X-Orbis-Signature': `sha256=${signature}`,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sentAt = new Date();
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', statusCode: response.status, deliveredAt: sentAt },
      }),
      prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastSuccessAt: sentAt },
      }),
    ]);
    return { id: delivery.id, status: 'SENT' as const };
  } catch (err) {
    const failedAt = new Date();
    await prisma.$transaction([
      prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', error: errorMessage(err), deliveredAt: failedAt },
      }),
      prisma.webhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastFailureAt: failedAt },
      }),
    ]);
    return { id: delivery.id, status: 'FAILED' as const };
  }
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Erreur inconnue';
}
