import fp from 'fastify-plugin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MembershipRole, Plan } from '@prisma/client';
import { prisma } from '../db/client.js';
import { HttpError, sendError } from '../utils/errors.js';
import { enforceTenantRateLimit } from '../services/tenantLimits.js';

export interface JwtUserPayload {
  sub: string; // userId
  email: string;
  name: string;
}

export interface RequestContext {
  user?: JwtUserPayload;
  membership?: {
    organizationId: string;
    role: MembershipRole;
    permissions: string[];
    plan: Plan;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Load the organization context from the x-organization-id header. */
    requireOrg: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: MembershipRole[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    // Organization context, populated by app.requireOrg.
    membership?: {
      organizationId: string;
      role: MembershipRole;
      permissions: string[];
      plan: Plan;
    };
  }
}

  // @fastify/jwt defines req.user; narrow its type through FastifyJWT.
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtUserPayload;
    user: JwtUserPayload;
  }
}

async function authPlugin(app: FastifyInstance) {
  // ─── authenticate: verify the JWT and attach req.user ─────
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const user = await prisma.user.findUnique({
        where: { id: req.user.sub },
        select: { id: true, email: true, name: true, active: true },
      });
      if (!user || !user.active) {
        return sendError(reply, 401, 'Compte désactivé ou introuvable');
      }
      req.user = { sub: user.id, email: user.email, name: user.name };
    } catch {
      return sendError(reply, 401, 'Authentification requise');
    }
  });

  // ─── requireOrg: load the membership from the header ──────
  app.decorate('requireOrg', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      return sendError(reply, 401, 'Authentification requise');
    }
    const orgId = req.headers['x-organization-id'] as string | undefined;
    if (!orgId) {
      return sendError(reply, 400, 'En-tête x-organization-id requis');
    }
    const membership = await prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: req.user.sub, organizationId: orgId },
      },
      select: {
        organizationId: true,
        role: true,
        permissions: true,
        status: true,
        organization: { select: { plan: true } },
      },
    });
    if (!membership || membership.status !== 'ACTIVE') {
      return sendError(reply, 403, 'Accès non autorisé à cette organisation');
    }
    try {
      enforceTenantRateLimit(membership.organizationId, membership.organization.plan);
    } catch (err) {
      if (err instanceof HttpError)
        return sendError(reply, err.statusCode, err.message, err.details);
      throw err;
    }
    req.membership = {
      organizationId: membership.organizationId,
      role: membership.role,
      permissions: membership.permissions,
      plan: membership.organization.plan,
    };
  });

  // ─── requireRole: verify the membership role ──────────────
  app.decorate(
    'requireRole',
    (...roles: MembershipRole[]) =>
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (!req.membership) {
          return sendError(reply, 400, "Contexte d'organisation requis");
        }
        if (req.membership.role === 'ADMIN') return;

        const permission = permissionForRequest(req);
        if (permission && req.membership.permissions.includes(permission)) return;

        const hasExplicitPermissions = req.membership.permissions.length > 0;
        if (!hasExplicitPermissions && roles.includes(req.membership.role)) return;

        if (!roles.includes(req.membership.role)) {
          return sendError(reply, 403, 'Permissions insuffisantes');
        }
        if (hasExplicitPermissions) {
          return sendError(
            reply,
            403,
            permission
              ? `Permission module requise : ${permission}`
              : 'Permissions module insuffisantes',
          );
        }
      },
  );
}

function permissionForRequest(req: FastifyRequest) {
  const rawUrl = req.url.split('?')[0] ?? '';
  const path = rawUrl.replace(/^\/api\//, '').split('/')[0] ?? '';
  const method = req.method.toUpperCase();

  if (path === 'users') return 'users:admin';
  if (path === 'billing') return 'billing:admin';
  if (path === 'security') return 'security:admin';
  if (path === 'integrations' || path === 'sso') return 'integrations:admin';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (path === 'alerts')
    return rawUrl.includes('/acknowledge') ? 'monitoring:write' : 'alerts:admin';
  if (path === 'monitoring') return 'monitoring:write';
  if (path === 'reports') return 'reports:write';
  if (path === 'discovery' || path === 'collectors' || path === 'collector')
    return 'discovery:write';
  if (path === 'diagrams') return 'topology:write';
  if (path === 'ipam') return 'ipam:write';
  if (path === 'dcim' || path === 'racks') return 'dcim:write';
  if (path === 'source-of-truth') return 'source-of-truth:write';
  if (path === 'comments') return 'comments:write';
  if (path === 'media' || path === 'devices' || path === 'sites' || path === 'ports')
    return 'inventory:write';
  return null;
}

export default fp(authPlugin, { name: 'auth' });
