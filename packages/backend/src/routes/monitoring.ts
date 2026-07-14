import { FastifyInstance } from 'fastify';
import { DiscoveryEventSeverity, IncidentStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { audit } from '../utils/audit.js';
import { handleError, HttpError } from '../utils/errors.js';
import { assertCanAccessDevice, assertCanAccessSite, getVisibleSiteIds, scopedSiteFilter, siteFilter } from '../services/scope.js';
import { getOrCreateMonitoringPolicy } from '../services/monitoring.js';

const policySchema = z.object({
  availabilityTargetPct: z.coerce.number().min(0).max(100),
  latencyWarningMs: z.coerce.number().int().min(1).max(60_000),
  latencyCriticalMs: z.coerce.number().int().min(1).max(60_000),
  latencyAlertsEnabled: z.boolean().default(true),
  measurementRetentionDays: z.coerce.number().int().min(1).max(3650),
  incidentAutoResolve: z.boolean(),
}).refine((value) => value.latencyCriticalMs >= value.latencyWarningMs, {
  message: 'Le seuil critique doit être supérieur ou égal au seuil warning',
  path: ['latencyCriticalMs'],
});

const maintenanceSchema = z.object({
  title: z.string().trim().min(1).max(160),
  siteId: z.string().optional().nullable(),
  deviceId: z.string().optional().nullable(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  notes: z.string().trim().max(2000).optional().nullable(),
}).refine((value) => value.endsAt > value.startsAt, {
  message: 'La date de fin doit être après le début',
  path: ['endsAt'],
});

const incidentPatchSchema = z.object({
  status: z.nativeEnum(IncidentStatus),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export default async function monitoringRoutes(app: FastifyInstance) {
  app.get('/policy', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const policy = await getOrCreateMonitoringPolicy(req.membership!.organizationId);
      return reply.send({ policy });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.put('/policy', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
  }, async (req, reply) => {
    try {
      const { organizationId } = req.membership!;
      const body = policySchema.parse(req.body);
      const policy = await prisma.monitoringPolicy.upsert({
        where: { organizationId },
        create: { organizationId, ...body },
        update: body,
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'monitoring.policy.update', target: 'MonitoringPolicy', targetId: policy.id, ip: req.ip });
      return reply.send({ policy });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/availability', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const q = req.query as { siteId?: string; deviceId?: string; days?: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const scope = await scopedSiteFilter(q.siteId, organizationId, visibleIds);
      if (q.deviceId) await assertCanAccessDevice(q.deviceId, organizationId, visibleIds);
      const days = Math.min(Math.max(Number.parseInt(q.days ?? '30', 10) || 30, 1), 365);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const policy = await getOrCreateMonitoringPolicy(organizationId);
      const where: Prisma.AvailabilitySampleWhereInput = {
        organizationId,
        checkedAt: { gte: since },
        ...scope,
        ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      };
      const samples = await prisma.availabilitySample.findMany({
        where,
        orderBy: { checkedAt: 'desc' },
        take: 5000,
        include: { device: { select: { id: true, name: true, type: true, ip: true } }, site: { select: { id: true, name: true } } },
      });
      return reply.send({
        summary: availabilitySummary(samples, policy.availabilityTargetPct, days),
        devices: availabilityByDevice(samples, policy.availabilityTargetPct),
        samples: samples.slice(0, 500),
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/maintenance', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const windows = await prisma.maintenanceWindow.findMany({
        where: { organizationId, ...siteFilter(visibleIds) },
        orderBy: { startsAt: 'desc' },
        take: 100,
        include: { site: { select: { id: true, name: true } }, device: { select: { id: true, name: true, type: true, ip: true } } },
      });
      return reply.send({ windows });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post('/maintenance', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const body = maintenanceSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      if (body.siteId) await assertCanAccessSite(body.siteId, organizationId, visibleIds);
      if (body.deviceId) await assertCanAccessDevice(body.deviceId, organizationId, visibleIds);
      if (!body.siteId && !body.deviceId && visibleIds !== null) throw new HttpError(403, 'Un site ou un équipement est requis pour un utilisateur restreint');
      const window = await prisma.maintenanceWindow.create({
        data: { ...body, organizationId },
        include: { site: { select: { id: true, name: true } }, device: { select: { id: true, name: true, type: true, ip: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'monitoring.maintenance.create', target: 'MaintenanceWindow', targetId: window.id, ip: req.ip });
      return reply.code(201).send({ window });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.delete('/maintenance/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const { id } = req.params as { id: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const current = await prisma.maintenanceWindow.findFirst({ where: { id, organizationId } });
      if (!current) throw new HttpError(404, 'Fenêtre de maintenance introuvable');
      if (current.siteId) await assertCanAccessSite(current.siteId, organizationId, visibleIds);
      if (current.deviceId) await assertCanAccessDevice(current.deviceId, organizationId, visibleIds);
      await prisma.maintenanceWindow.delete({ where: { id } });
      await audit({ userId: req.user!.sub, organizationId, action: 'monitoring.maintenance.delete', target: 'MaintenanceWindow', targetId: id, ip: req.ip });
      return reply.code(204).send();
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/incidents', {
    preHandler: [app.authenticate, app.requireOrg],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const q = req.query as { status?: IncidentStatus; severity?: DiscoveryEventSeverity; siteId?: string };
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const scope = await scopedSiteFilter(q.siteId, organizationId, visibleIds);
      const incidents = await prisma.incident.findMany({
        where: {
          organizationId,
          ...scope,
          ...(q.status ? { status: q.status } : {}),
          ...(q.severity ? { severity: q.severity } : {}),
        },
        orderBy: [{ status: 'asc' }, { lastEventAt: 'desc' }],
        take: 200,
        include: { site: { select: { id: true, name: true } }, device: { select: { id: true, name: true, type: true, ip: true } } },
      });
      return reply.send({ incidents });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/incidents/:id', {
    preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN', 'EDITOR')],
  }, async (req, reply) => {
    try {
      const { organizationId, role } = req.membership!;
      const { id } = req.params as { id: string };
      const body = incidentPatchSchema.parse(req.body);
      const visibleIds = await getVisibleSiteIds(req.user!.sub, organizationId, role);
      const current = await prisma.incident.findFirst({ where: { id, organizationId, ...siteFilter(visibleIds) } });
      if (!current) throw new HttpError(404, 'Incident introuvable');
      const now = new Date();
      const incident = await prisma.incident.update({
        where: { id },
        data: {
          status: body.status,
          notes: body.notes,
          acknowledgedAt: body.status === 'ACKNOWLEDGED' ? (current.acknowledgedAt ?? now) : current.acknowledgedAt,
          resolvedAt: body.status === 'RESOLVED' ? (current.resolvedAt ?? now) : null,
        },
        include: { site: { select: { id: true, name: true } }, device: { select: { id: true, name: true, type: true, ip: true } } },
      });
      await audit({ userId: req.user!.sub, organizationId, action: 'monitoring.incident.update', target: 'Incident', targetId: id, ip: req.ip, meta: body });
      return reply.send({ incident });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

function availabilitySummary(samples: Array<{ status: string; latencyMs: number | null }>, target: number, days: number) {
  const total = samples.length;
  const up = samples.filter((sample) => sample.status === 'ONLINE').length;
  const down = samples.filter((sample) => sample.status === 'DOWN').length;
  const availabilityPct = total === 0 ? 100 : round((up / total) * 100);
  const latencies = samples.map((sample) => sample.latencyMs).filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
  return {
    days,
    total,
    up,
    down,
    availabilityPct,
    targetPct: target,
    targetMet: availabilityPct >= target,
    latencyAvgMs: latencies.length ? round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null,
    latencyP95Ms: percentile(latencies, 95),
  };
}

function availabilityByDevice(samples: Array<{
  deviceId: string;
  status: string;
  latencyMs: number | null;
  device: { id: string; name: string; type: string; ip: string | null };
  site: { id: string; name: string } | null;
}>, target: number) {
  const byDevice = new Map<string, typeof samples>();
  for (const sample of samples) {
    byDevice.set(sample.deviceId, [...(byDevice.get(sample.deviceId) ?? []), sample]);
  }
  return [...byDevice.values()].map((rows) => ({
    device: rows[0].device,
    site: rows[0].site,
    summary: availabilitySummary(rows, target, 0),
  })).sort((a, b) => a.summary.availabilityPct - b.summary.availabilityPct);
}

function percentile(values: number[], pct: number) {
  if (values.length === 0) return null;
  const index = Math.min(values.length - 1, Math.ceil((pct / 100) * values.length) - 1);
  return round(values[index]);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
