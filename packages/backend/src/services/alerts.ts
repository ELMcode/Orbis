import { AlertChannel, DiscoveryEventSeverity, DiscoveryEventType, Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';
import { sendEmail } from './email.js';
import { dispatchOutboundWebhook } from './outboundWebhooks.js';
import { assertSafeOutboundUrl } from './outboundUrl.js';

type DiscoveryEventInput = Prisma.DiscoveryEventCreateManyInput;

const SEVERITY_WEIGHT: Record<DiscoveryEventSeverity, number> = {
  INFO: 1,
  WARNING: 2,
  CRITICAL: 3,
};

export async function notifyDiscoveryEvents(events: DiscoveryEventInput[]) {
  if (events.length === 0) return;

  const byOrganization = new Map<string, DiscoveryEventInput[]>();
  for (const event of events) {
    byOrganization.set(event.organizationId, [...(byOrganization.get(event.organizationId) ?? []), event]);
  }

  for (const [organizationId, orgEvents] of byOrganization) {
    const settings = await prisma.alertSettings.findUnique({ where: { organizationId } });
    const alertCandidates = settings ? orgEvents.filter((event) => shouldNotify(event, settings)) : [];
    const lookupEvents = orgEvents.length > 0 ? orgEvents : alertCandidates;

    const persisted = await prisma.discoveryEvent.findMany({
      where: {
        organizationId,
        createdAt: { gte: new Date(Date.now() - 60_000) },
        type: { in: lookupEvents.map((event) => event.type as DiscoveryEventType) },
        title: { in: lookupEvents.map((event) => event.title) },
      },
      include: {
        collector: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        device: { select: { id: true, name: true, type: true, ip: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: lookupEvents.length,
    });

    for (const event of persisted) {
      await dispatchOutboundWebhook(organizationId, 'discovery.event', {
        eventId: event.id,
        type: event.type,
        severity: event.severity,
        title: event.title,
        message: event.message,
        site: event.site,
        device: event.device,
        collector: event.collector,
        createdAt: event.createdAt,
      });
      const shouldAlert = settings && alertCandidates.some((candidate) => candidate.title === event.title && candidate.type === event.type);
      if (shouldAlert && settings.emailEnabled) {
        const recipients = settings.emailRecipients.length > 0
          ? settings.emailRecipients
          : await adminEmails(organizationId);
        await deliverEmail(event, recipients);
      }
      if (shouldAlert && settings.webhookEnabled && settings.webhookUrl) {
        await deliverWebhook(event, settings.webhookUrl);
      }
      if (shouldAlert && settings.slackEnabled && settings.slackWebhookUrl) {
        await deliverSlack(event, settings.slackWebhookUrl);
      }
      if (shouldAlert && settings.teamsEnabled && settings.teamsWebhookUrl) {
        await deliverTeams(event, settings.teamsWebhookUrl);
      }
    }
  }
}

function shouldNotify(event: DiscoveryEventInput, settings: {
  minSeverity: DiscoveryEventSeverity;
  eventTypes: DiscoveryEventType[];
  includeResolvedInfo: boolean;
}) {
  const severity = event.severity ?? 'INFO';
  if (!settings.includeResolvedInfo && severity === 'INFO') return false;
  if (SEVERITY_WEIGHT[severity] < SEVERITY_WEIGHT[settings.minSeverity]) return false;
  if (settings.eventTypes.length > 0 && !settings.eventTypes.includes(event.type as DiscoveryEventType)) return false;
  return true;
}

async function adminEmails(organizationId: string) {
  const admins = await prisma.membership.findMany({
    where: { organizationId, role: 'ADMIN', status: 'ACTIVE', user: { active: true } },
    include: { user: { select: { email: true } } },
  });
  return admins.map((membership) => membership.user.email);
}

async function deliverEmail(event: AlertEvent, recipients: string[]) {
  const targets = uniqueEmails(recipients);
  if (targets.length === 0) {
    await createDelivery(event, 'EMAIL', 'SKIPPED', null, 'Aucun destinataire');
    return;
  }

  for (const target of targets) {
    try {
      await sendEmail({
        to: target,
        subject: `[Orbis] ${event.severity} - ${event.title}`,
        text: alertText(event),
        html: alertHtml(event),
      });
      await createDelivery(event, 'EMAIL', 'SENT', target);
    } catch (err) {
      await createDelivery(event, 'EMAIL', 'FAILED', target, errorMessage(err));
    }
  }
}

async function deliverWebhook(event: AlertEvent, webhookUrl: string) {
  try {
    const response = await fetch(await assertSafeOutboundUrl(webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'orbis',
        eventId: event.id,
        type: event.type,
        severity: event.severity,
        title: event.title,
        message: event.message,
        site: event.site,
        device: event.device,
        collector: event.collector,
        createdAt: event.createdAt,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await createDelivery(event, 'WEBHOOK', 'SENT', webhookUrl);
  } catch (err) {
    await createDelivery(event, 'WEBHOOK', 'FAILED', webhookUrl, errorMessage(err));
  }
}

async function deliverSlack(event: AlertEvent, webhookUrl: string) {
  try {
    const response = await fetch(await assertSafeOutboundUrl(webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `[Orbis] ${event.severity} - ${event.title}`,
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: `${event.severity} - ${event.title}`.slice(0, 150) },
          },
          {
            type: 'section',
            fields: alertFields(event).map((field) => ({
              type: 'mrkdwn',
              text: `*${field.label}:*\n${field.value}`,
            })),
          },
        ],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await createDelivery(event, 'SLACK', 'SENT', webhookUrl);
  } catch (err) {
    await createDelivery(event, 'SLACK', 'FAILED', webhookUrl, errorMessage(err));
  }
}

async function deliverTeams(event: AlertEvent, webhookUrl: string) {
  try {
    const response = await fetch(await assertSafeOutboundUrl(webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: `[Orbis] ${event.severity} - ${event.title}`,
        themeColor: event.severity === 'CRITICAL' ? 'D92D20' : event.severity === 'WARNING' ? 'F79009' : '1570EF',
        title: `${event.severity} - ${event.title}`,
        text: event.message ?? 'Alerte Orbis',
        sections: [{
          facts: alertFields(event).map((field) => ({ name: field.label, value: field.value })),
        }],
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await createDelivery(event, 'TEAMS', 'SENT', webhookUrl);
  } catch (err) {
    await createDelivery(event, 'TEAMS', 'FAILED', webhookUrl, errorMessage(err));
  }
}

async function createDelivery(
  event: AlertEvent,
  channel: AlertChannel,
  status: 'SENT' | 'FAILED' | 'SKIPPED',
  target?: string | null,
  error?: string,
) {
  await prisma.alertDelivery.create({
    data: {
      organizationId: event.organizationId,
      eventId: event.id,
      channel,
      status,
      target,
      error,
      sentAt: status === 'SENT' ? new Date() : null,
    },
  });
}

function alertText(event: AlertEvent) {
  return [
    `${event.severity} - ${event.title}`,
    event.message ?? '',
    event.site ? `Site : ${event.site.name}` : null,
    event.device ? `Équipement : ${event.device.name}${event.device.ip ? ` (${event.device.ip})` : ''}` : null,
    event.collector ? `Collector : ${event.collector.name}` : null,
    `Date : ${event.createdAt.toISOString()}`,
  ].filter(Boolean).join('\n');
}

function alertFields(event: AlertEvent) {
  return [
    { label: 'Type', value: event.type },
    { label: 'Message', value: event.message ?? '-' },
    event.site ? { label: 'Site', value: event.site.name } : null,
    event.device ? { label: 'Équipement', value: `${event.device.name}${event.device.ip ? ` (${event.device.ip})` : ''}` } : null,
    event.collector ? { label: 'Collector', value: event.collector.name } : null,
    { label: 'Date', value: event.createdAt.toISOString() },
  ].filter((field): field is { label: string; value: string } => Boolean(field));
}

function alertHtml(event: AlertEvent) {
  return `
    <h2>${escapeHtml(event.severity)} - ${escapeHtml(event.title)}</h2>
    ${event.message ? `<p>${escapeHtml(event.message)}</p>` : ''}
    <ul>
      ${event.site ? `<li><strong>Site :</strong> ${escapeHtml(event.site.name)}</li>` : ''}
      ${event.device ? `<li><strong>Équipement :</strong> ${escapeHtml(event.device.name)}${event.device.ip ? ` (${escapeHtml(event.device.ip)})` : ''}</li>` : ''}
      ${event.collector ? `<li><strong>Collector :</strong> ${escapeHtml(event.collector.name)}</li>` : ''}
      <li><strong>Date :</strong> ${escapeHtml(event.createdAt.toISOString())}</li>
    </ul>
  `;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uniqueEmails(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500);
}

type AlertEvent = Prisma.DiscoveryEventGetPayload<{
  include: {
    collector: { select: { id: true; name: true } };
    site: { select: { id: true; name: true } };
    device: { select: { id: true; name: true; type: true; ip: true } };
  };
}>;
