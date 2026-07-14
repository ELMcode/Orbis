import { Plan } from '@prisma/client';
import { prisma } from '../db/client.js';
import { HttpError } from '../utils/errors.js';

export type QuotaResource =
  | 'members'
  | 'sites'
  | 'devices'
  | 'diagrams'
  | 'collectors'
  | 'reportSchedules'
  | 'ipAddresses';

type PlanQuota = Record<QuotaResource, number | null> & {
  requestsPerMinute: number | null;
};

const PLAN_QUOTAS: Record<Plan, PlanQuota> = {
  FREE: {
    requestsPerMinute: 120,
    members: 3,
    sites: 5,
    devices: 50,
    diagrams: 10,
    collectors: 1,
    reportSchedules: 2,
    ipAddresses: 256,
  },
  PRO: {
    requestsPerMinute: 1200,
    members: 25,
    sites: 100,
    devices: 5000,
    diagrams: 500,
    collectors: 20,
    reportSchedules: 50,
    ipAddresses: 100_000,
  },
  ENTERPRISE: {
    requestsPerMinute: null,
    members: null,
    sites: null,
    devices: null,
    diagrams: null,
    collectors: null,
    reportSchedules: null,
    ipAddresses: null,
  },
};

const tenantBuckets = new Map<string, { windowStart: number; count: number }>();

export function enforceTenantRateLimit(organizationId: string, plan: Plan) {
  const max = PLAN_QUOTAS[plan].requestsPerMinute;
  if (max === null) return;

  const now = Date.now();
  const minute = 60_000;
  const current = tenantBuckets.get(organizationId);
  if (!current || now - current.windowStart >= minute) {
    tenantBuckets.set(organizationId, { windowStart: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((minute - (now - current.windowStart)) / 1000));
    throw new HttpError(429, 'Limite de requêtes du tenant atteinte', {
      plan,
      limit: max,
      retryAfterSeconds,
    });
  }
}

export async function assertTenantQuota(organizationId: string, resource: QuotaResource, increment = 1) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { plan: true },
  });
  if (!organization) throw new HttpError(404, 'Organisation introuvable');
  const limit = PLAN_QUOTAS[organization.plan][resource];
  if (limit === null) return;

  const current = await countResource(organizationId, resource);
  if (current + increment > limit) {
    throw new HttpError(402, 'Quota du plan atteint', {
      plan: organization.plan,
      resource,
      limit,
      current,
      requested: increment,
    });
  }
}

export function planQuotas(plan: Plan) {
  return PLAN_QUOTAS[plan];
}

async function countResource(organizationId: string, resource: QuotaResource) {
  switch (resource) {
    case 'members':
      return prisma.membership.count({ where: { organizationId, status: 'ACTIVE' } });
    case 'sites':
      return prisma.site.count({ where: { organizationId } });
    case 'devices':
      return prisma.device.count({ where: { organizationId } });
    case 'diagrams':
      return prisma.diagram.count({ where: { organizationId } });
    case 'collectors':
      return prisma.discoveryCollector.count({ where: { organizationId, status: { not: 'REVOKED' } } });
    case 'reportSchedules':
      return prisma.reportSchedule.count({ where: { organizationId } });
    case 'ipAddresses':
      return prisma.ipAddress.count({ where: { organizationId } });
  }
}
