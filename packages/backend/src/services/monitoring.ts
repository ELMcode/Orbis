import { DiscoveryEventSeverity, Prisma } from '@prisma/client';
import { prisma } from '../db/client.js';

export interface MonitoringSeenDevice {
  deviceId: string;
  deviceName: string;
  siteId: string | null;
  address: string;
  latencyMs?: number | null;
  ports: number[];
}

export async function getOrCreateMonitoringPolicy(organizationId: string) {
  return prisma.monitoringPolicy.upsert({
    where: { organizationId },
    create: { organizationId },
    update: {},
  });
}

export async function recordAvailabilitySamples(input: {
  organizationId: string;
  collectorId: string;
  runId: string;
  checkedAt: Date;
  seen: MonitoringSeenDevice[];
  down: Array<{ deviceId: string; siteId: string | null }>;
}) {
  const data: Prisma.AvailabilitySampleCreateManyInput[] = [
    ...input.seen.map((item) => ({
      organizationId: input.organizationId,
      collectorId: input.collectorId,
      runId: input.runId,
      siteId: item.siteId,
      deviceId: item.deviceId,
      status: 'ONLINE' as const,
      latencyMs: item.latencyMs ?? null,
      checkedAt: input.checkedAt,
    })),
    ...input.down.map((item) => ({
      organizationId: input.organizationId,
      collectorId: input.collectorId,
      runId: input.runId,
      siteId: item.siteId,
      deviceId: item.deviceId,
      status: 'DOWN' as const,
      latencyMs: null,
      checkedAt: input.checkedAt,
    })),
  ];
  if (data.length > 0) {
    await prisma.availabilitySample.createMany({ data });
  }
}

export async function buildLatencyEvents(input: {
  organizationId: string;
  collectorId: string;
  runId: string;
  siteId: string | null;
  seen: MonitoringSeenDevice[];
}): Promise<Prisma.DiscoveryEventCreateManyInput[]> {
  const policy = await getOrCreateMonitoringPolicy(input.organizationId);
  if (!policy.latencyAlertsEnabled) return [];
  const windows = await activeMaintenanceWindows(input.organizationId, new Date());
  const deviceIds = input.seen.map((item) => item.deviceId);
  const activeLatencyIncidents = deviceIds.length > 0
    ? await prisma.incident.findMany({
      where: {
        organizationId: input.organizationId,
        deviceId: { in: deviceIds },
        source: 'LATENCY_HIGH',
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      select: { deviceId: true, severity: true },
    })
    : [];
  const activeSeverityByDevice = new Map(
    activeLatencyIncidents
      .filter((incident) => incident.deviceId)
      .map((incident) => [incident.deviceId as string, incident.severity]),
  );
  const events: Prisma.DiscoveryEventCreateManyInput[] = [];

  for (const item of input.seen) {
    if (item.latencyMs == null) continue;
    if (inMaintenance(item.deviceId, item.siteId, windows)) continue;
    const severity = latencySeverity(item.latencyMs, policy.latencyWarningMs, policy.latencyCriticalMs);
    if (!severity) continue;
    const activeSeverity = activeSeverityByDevice.get(item.deviceId);
    if (activeSeverity && severityRank(activeSeverity) >= severityRank(severity)) continue;
    events.push({
      organizationId: input.organizationId,
      collectorId: input.collectorId,
      runId: input.runId,
      siteId: item.siteId ?? input.siteId,
      deviceId: item.deviceId,
      type: 'LATENCY_HIGH',
      severity,
      title: `Latence élevée : ${item.deviceName}`,
      message: `${item.deviceName} répond en ${Math.round(item.latencyMs)} ms.`,
      meta: {
        address: item.address,
        latencyMs: item.latencyMs,
        latencyWarningMs: policy.latencyWarningMs,
        latencyCriticalMs: policy.latencyCriticalMs,
      },
    });
  }
  return events;
}

export async function upsertMonitoringIncidents(input: {
  organizationId: string;
  events: Prisma.DiscoveryEventCreateManyInput[];
}) {
  const policy = await getOrCreateMonitoringPolicy(input.organizationId);
  if (input.events.length === 0) return;
  const now = new Date();

  for (const event of input.events) {
    if (!['DEVICE_DOWN', 'LATENCY_HIGH'].includes(String(event.type))) continue;
    if (isMaintenanceEvent(event.meta as unknown)) continue;
    const title = String(event.title);
    const existing = await prisma.incident.findFirst({
      where: {
        organizationId: input.organizationId,
        deviceId: event.deviceId ?? null,
        source: String(event.type),
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    });
    if (existing) {
      await prisma.incident.update({
        where: { id: existing.id },
        data: {
          severity: event.severity as DiscoveryEventSeverity,
          title,
          siteId: event.siteId ?? existing.siteId,
          lastEventAt: now,
        },
      });
    } else {
      await prisma.incident.create({
        data: {
          organizationId: input.organizationId,
          siteId: event.siteId ?? null,
          deviceId: event.deviceId ?? null,
          title,
          severity: event.severity as DiscoveryEventSeverity,
          source: String(event.type),
          lastEventAt: now,
        },
      });
    }
  }

  if (policy.incidentAutoResolve) {
    const reappearedIds = input.events
      .filter((event) => event.type === 'DEVICE_REAPPEARED' && event.deviceId)
      .map((event) => event.deviceId as string);
    if (reappearedIds.length > 0) {
      await prisma.incident.updateMany({
        where: {
          organizationId: input.organizationId,
          deviceId: { in: reappearedIds },
          source: 'DEVICE_DOWN',
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        data: { status: 'RESOLVED', resolvedAt: now, lastEventAt: now },
      });
    }
  }
}

export async function resolveHealthyLatencyIncidents(input: {
  organizationId: string;
  healthyDeviceIds: string[];
}) {
  if (input.healthyDeviceIds.length === 0) return;
  const now = new Date();
  await prisma.incident.updateMany({
    where: {
      organizationId: input.organizationId,
      deviceId: { in: input.healthyDeviceIds },
      source: 'LATENCY_HIGH',
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
    data: { status: 'RESOLVED', resolvedAt: now, lastEventAt: now },
  });
}

export async function healthyLatencyDeviceIds(
  organizationId: string,
  seen: MonitoringSeenDevice[],
): Promise<string[]> {
  const policy = await getOrCreateMonitoringPolicy(organizationId);
  if (!policy.latencyAlertsEnabled) return seen.map((item) => item.deviceId);
  return seen
    .filter((item) => item.latencyMs == null || !latencySeverity(item.latencyMs, policy.latencyWarningMs, policy.latencyCriticalMs))
    .map((item) => item.deviceId);
}

export async function pruneMonitoringData(organizationId: string) {
  const policy = await getOrCreateMonitoringPolicy(organizationId);
  const cutoff = new Date(Date.now() - policy.measurementRetentionDays * 24 * 60 * 60 * 1000);
  await prisma.$transaction([
    prisma.availabilitySample.deleteMany({ where: { organizationId, checkedAt: { lt: cutoff } } }),
    prisma.discoveryRun.deleteMany({ where: { organizationId, createdAt: { lt: cutoff } } }),
  ]);
}

export async function activeMaintenanceWindows(organizationId: string, at: Date) {
  return prisma.maintenanceWindow.findMany({
    where: {
      organizationId,
      startsAt: { lte: at },
      endsAt: { gte: at },
    },
    select: { id: true, siteId: true, deviceId: true },
  });
}

export function inMaintenance(
  deviceId: string,
  siteId: string | null,
  windows: Array<{ siteId: string | null; deviceId: string | null }>,
) {
  return windows.some((window) => (
    window.deviceId === deviceId || (window.siteId !== null && window.siteId === siteId)
  ));
}

export function latencySeverity(
  latencyMs: number,
  warningMs: number,
  criticalMs: number,
): DiscoveryEventSeverity | null {
  if (latencyMs >= criticalMs) return 'CRITICAL';
  if (latencyMs >= warningMs) return 'WARNING';
  return null;
}

function severityRank(severity: DiscoveryEventSeverity) {
  if (severity === 'CRITICAL') return 3;
  if (severity === 'WARNING') return 2;
  return 1;
}

function isMaintenanceEvent(meta: unknown) {
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta) && Boolean((meta as any).maintenance);
}
