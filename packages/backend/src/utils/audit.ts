import { prisma } from '../db/client.js';

export async function audit(opts: {
  userId?: string | null;
  organizationId?: string | null;
  action: string;
  target?: string;
  targetId?: string;
  meta?: unknown;
  ip?: string;
}) {
  const data = {
    userId: opts.userId ?? null,
    organizationId: opts.organizationId ?? null,
    action: opts.action,
    target: opts.target,
    targetId: opts.targetId,
    meta: (opts.meta as any) ?? undefined,
    ip: opts.ip,
  };

  // Audit writes are asynchronous relative to business mutations.
  // A bounded retry count prevents losing records during a transient database
  // outage without turning an already-committed mutation into a false HTTP failure.
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.auditLog.create({ data });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  console.error('[audit] échec persistant', { action: opts.action, organizationId: opts.organizationId, error: lastError });
}
