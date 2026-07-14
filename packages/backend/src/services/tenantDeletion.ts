import { prisma } from '../db/client.js';

/** Permanently deletes tenants whose contractual grace period has elapsed. */
export async function purgeExpiredOrganizations() {
  const result = await prisma.organization.deleteMany({
    where: { scheduledDeletionAt: { lte: new Date() } },
  });
  return result.count;
}
