import { MembershipRole } from '@prisma/client';
import { prisma } from '../db/client.js';
import { HttpError } from '../utils/errors.js';

/**
 * Multi-tenant scoping.
 *
 * Two isolation dimensions:
 *  1. organizationId isolates tenants: users from organization A never see
 *     organization B data, even when they know the IDs.
 *  2. UserSite restricts a member to assigned sites and their descendants.
 *     An ADMIN without UserSite assignments can see the entire organization.
 */

/**
 * Calculate the set of site IDs visible to a member in their organization.
 *
 * Rules:
 *  - ADMIN without UserSite assignments sees every site (null = no site filter).
 *  - ADMIN/EDITOR/VIEWER with assignments see assigned sites and descendants.
 *  - Without any assignment, the member sees no sites (empty array).
 *
 * Return `null` when no site filter should be applied.
 */
export async function getVisibleSiteIds(
  userId: string,
  organizationId: string,
  role: MembershipRole,
): Promise<string[] | null> {
  // Load the membership to access UserSite assignments.
  const membership = await prisma.membership.findUnique({
    where: {
      userId_organizationId: { userId, organizationId },
    },
    select: {
      id: true,
      siteScopes: { select: { siteId: true } },
    },
  });

  if (!membership) return [];

  // ADMIN without explicit assignments can access every site in the org.
  if (role === 'ADMIN' && membership.siteScopes.length === 0) {
    return null;
  }

  const directIds = membership.siteScopes.map((s) => s.siteId);
  if (directIds.length === 0) return [];

  // Resolve descendants recursively, always within the same organization.
  const allSites = await prisma.site.findMany({
    where: { organizationId },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string, string[]>();
  for (const s of allSites) {
    if (s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s.id);
      childrenOf.set(s.parentId, arr);
    }
  }

  const visible = new Set<string>(directIds);
  const stack = [...directIds];
  while (stack.length) {
    const current = stack.pop()!;
    for (const k of childrenOf.get(current) ?? []) {
      if (!visible.has(k)) {
        visible.add(k);
        stack.push(k);
      }
    }
  }
  return [...visible];
}

/** Return a site and all of its descendants recursively within the same org. */
export async function getDescendantSiteIds(
  siteId: string,
  organizationId: string,
): Promise<string[]> {
  const allSites = await prisma.site.findMany({
    where: { organizationId },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string, string[]>();
  for (const s of allSites) {
    if (s.parentId) {
      const arr = childrenOf.get(s.parentId) ?? [];
      arr.push(s.id);
      childrenOf.set(s.parentId, arr);
    }
  }
  const result = new Set<string>([siteId]);
  const stack = [siteId];
  while (stack.length) {
    const current = stack.pop()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return [...result];
}

/**
 * Prisma `where` clause for filtering by visible sites.
 * Combine it with the organizationId filter.
 */
export function siteFilter(siteIds: string[] | null): { siteId?: { in: string[] } } {
  if (siteIds === null) return {};
  if (siteIds.length === 0) return { siteId: { in: ['__none__'] } }; // Force zero results.
  return { siteId: { in: siteIds } };
}

/**
 * Calculate the site filter for a list endpoint.
 *
 * Product rule:
 * - without a selected site: the user's visible scope; global objects remain
 *   visible for a global admin.
 * - with a selected site: the selected site and descendants only; global
 *   objects without a site are excluded.
 */
export async function scopedSiteFilter(
  requestedSiteId: string | undefined,
  organizationId: string,
  visibleSiteIds: string[] | null,
): Promise<{ siteId?: { in: string[] } }> {
  if (!requestedSiteId) return siteFilter(visibleSiteIds);
  await assertCanAccessSite(requestedSiteId, organizationId, visibleSiteIds);
  const descendants = await getDescendantSiteIds(requestedSiteId, organizationId);
  const scoped =
    visibleSiteIds === null ? descendants : descendants.filter((id) => visibleSiteIds.includes(id));
  return siteFilter(scoped);
}

// ─────────────────────────────────────────────────────────────
// IDOR guards (critical access-control boundary).
// ─────────────────────────────────────────────────────────────

type OrgScopedModel =
  'site' | 'diagram' | 'device' | 'rack' | 'port' | 'deviceImage' | 'attachment' | 'rackSlot';

/**
 * Load an entity and verify that it belongs to the active organization.
 * Throw 404 when missing or outside the organization to avoid information leaks.
 */
export async function assertInOrg<T>(
  model: OrgScopedModel,
  id: string,
  organizationId: string,
): Promise<T> {
  const record = await loadForOrgCheck(model, id);
  if (!record || record.organizationId !== organizationId) {
    throw new HttpError(404, 'Ressource introuvable');
  }
  return record as T;
}

/**
 * Verify that a device and its child entities (ports, images, attachments)
 * belong to the active organization and, when siteId is set, to a visible site.
 */
export async function assertCanAccessDevice(
  deviceId: string,
  organizationId: string,
  visibleSiteIds: string[] | null,
): Promise<void> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true, organizationId: true, siteId: true },
  });
  if (!device || device.organizationId !== organizationId) {
    throw new HttpError(404, 'Équipement introuvable');
  }
  // When the user is site-scoped and the device has a site, verify visibility.
  if (visibleSiteIds !== null && device.siteId && !visibleSiteIds.includes(device.siteId)) {
    throw new HttpError(403, 'Accès non autorisé à cet équipement');
  }
}

/** Verify access to a site itself or through an assigned ancestor. */
export async function assertCanAccessSite(
  siteId: string,
  organizationId: string,
  visibleSiteIds: string[] | null,
): Promise<void> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, organizationId: true },
  });
  if (!site || site.organizationId !== organizationId) {
    throw new HttpError(404, 'Site introuvable');
  }
  if (visibleSiteIds !== null && !visibleSiteIds.includes(siteId)) {
    throw new HttpError(403, 'Accès non autorisé à ce site');
  }
}

// Internal helper: load organizationId and siteId when relevant.
async function loadForOrgCheck(
  model: OrgScopedModel,
  id: string,
): Promise<{ organizationId: string } | null> {
  switch (model) {
    case 'site':
      return prisma.site.findUnique({ where: { id }, select: { organizationId: true } });
    case 'diagram':
      return prisma.diagram.findUnique({ where: { id }, select: { organizationId: true } });
    case 'device':
      return prisma.device.findUnique({ where: { id }, select: { organizationId: true } });
    case 'rack':
      return prisma.rack.findUnique({ where: { id }, select: { organizationId: true } });
    case 'port': {
      const port = await prisma.port.findUnique({
        where: { id },
        select: { device: { select: { organizationId: true } } },
      });
      return port?.device ?? null;
    }
    case 'deviceImage': {
      const img = await prisma.deviceImage.findUnique({
        where: { id },
        select: { device: { select: { organizationId: true } } },
      });
      return img?.device ?? null;
    }
    case 'attachment': {
      const att = await prisma.attachment.findUnique({
        where: { id },
        select: { device: { select: { organizationId: true } } },
      });
      return att?.device ?? null;
    }
    case 'rackSlot': {
      const slot = await prisma.rackSlot.findUnique({
        where: { id },
        select: { rack: { select: { organizationId: true } } },
      });
      return slot?.rack ?? null;
    }
  }
}
