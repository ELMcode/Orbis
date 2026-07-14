import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwtLib from 'jsonwebtoken';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { MembershipRole } from '@prisma/client';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { assertTenantQuota } from '../services/tenantLimits.js';
import { paginationMeta, parsePagination } from '../utils/pagination.js';
import { setRefreshCookie } from './auth.js';
import { createOpaqueToken, hashToken } from '../utils/token.js';

const updateMemberSchema = z.object({
  role: z.nativeEnum(MembershipRole).optional(),
  permissions: z
    .array(z.string().regex(/^[a-z-]+:(write|admin)$/))
    .max(30)
    .optional(),
  status: z.enum(['ACTIVE', 'INVITED']).optional(),
});

const inviteSchema = z.object({
  email: z.string().email().max(120),
  role: z.nativeEnum(MembershipRole).default('VIEWER'),
  permissions: z
    .array(z.string().regex(/^[a-z-]+:(write|admin)$/))
    .max(30)
    .default([]),
});

const updateProfileSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  avatarUrl: z.string().url().optional().nullable(),
});

export default async function usersRoutes(app: FastifyInstance) {
  app.get(
    '/mentionable',
    {
      preHandler: [app.authenticate, app.requireOrg],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const memberships = await prisma.membership.findMany({
          where: { organizationId, status: 'ACTIVE', user: { active: true } },
          orderBy: { user: { name: 'asc' } },
          select: { userId: true, user: { select: { name: true, email: true, avatarUrl: true } } },
        });
        return reply.send({
          members: memberships.map((membership) => ({
            id: membership.userId,
            name: membership.user.name,
            email: membership.user.email,
            avatarUrl: membership.user.avatarUrl,
          })),
        });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Active organization members (admin) ─────────────────
  app.get(
    '/',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const pagination = parsePagination(req.query);
        const where = { organizationId };
        const [memberships, total] = await Promise.all([
          prisma.membership.findMany({
            where,
            orderBy: { joinedAt: 'asc' },
            skip: pagination.skip,
            take: pagination.take,
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  avatarUrl: true,
                  active: true,
                  createdAt: true,
                },
              },
            },
          }),
          prisma.membership.count({ where }),
        ]);
        const members = memberships.map((m) => ({
          id: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          role: m.role,
          status: m.status,
          avatarUrl: m.user.avatarUrl,
          active: m.user.active,
          joinedAt: m.joinedAt,
          permissions: m.permissions,
        }));
        return reply.send({ members, pagination: paginationMeta(pagination, total) });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Invite a member by email ────────────────────────────
  app.post(
    '/invite',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const body = inviteSchema.parse(req.body);
        const email = body.email.toLowerCase();
        await assertTenantQuota(organizationId, 'members');

        // If the user already exists, create the membership directly.
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
          const already = await prisma.membership.findUnique({
            where: { userId_organizationId: { userId: existing.id, organizationId } },
          });
          if (already) throw new HttpError(409, 'Cet utilisateur est déjà membre');

          const membership = await prisma.membership.create({
            data: {
              userId: existing.id,
              organizationId,
              role: body.role,
              permissions: body.permissions,
              status: 'ACTIVE',
            },
          });
          await audit({
            userId: req.user!.sub,
            organizationId,
            action: 'member.invite',
            target: 'User',
            targetId: existing.id,
            meta: { role: body.role, permissions: body.permissions },
            ip: req.ip,
          });
          return reply.code(201).send({ membership });
        }

        // Never persist or return the raw token in the API response.
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        const invitationToken = createOpaqueToken(32);
        const invitation = await prisma.invitation.create({
          data: {
            organizationId,
            email,
            role: body.role,
            permissions: body.permissions,
            tokenHash: hashToken(invitationToken),
            expiresAt,
          },
        });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'member.invite',
          target: 'Invitation',
          targetId: invitation.id,
          meta: { email, role: body.role, permissions: body.permissions },
          ip: req.ip,
        });
        return reply.code(201).send({
          invitation: {
            id: invitation.id,
            email: invitation.email,
            role: invitation.role,
            permissions: invitation.permissions,
            expiresAt: invitation.expiresAt,
            createdAt: invitation.createdAt,
          },
        });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Update a member's role/status ───────────────────────
  app.patch(
    '/:memberId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { memberId } = req.params as { memberId: string };
        const body = updateMemberSchema.parse(req.body);

        const membership = await prisma.membership.findFirst({
          where: { id: memberId, organizationId },
        });
        if (!membership) throw new HttpError(404, 'Membre introuvable');

        // Prevent the last admin from demoting themselves.
        if (membership.role === 'ADMIN' && body.role !== undefined && body.role !== 'ADMIN') {
          const adminCount = await prisma.membership.count({
            where: { organizationId, role: 'ADMIN', status: 'ACTIVE' },
          });
          if (adminCount <= 1)
            throw new HttpError(
              400,
              "Impossible : c'est le dernier administrateur de l'organisation",
            );
        }

        const updated = await prisma.membership.update({
          where: { id: memberId },
          data: {
            ...(body.role !== undefined ? { role: body.role } : {}),
            ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
          },
        });
        // Invalidate sessions when the member is disabled.
        if (body.status && body.status !== 'ACTIVE') {
          await prisma.auditToken.deleteMany({ where: { userId: membership.userId } });
        }
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'member.update',
          target: 'Membership',
          targetId: memberId,
          meta: body,
          ip: req.ip,
        });
        return reply.send({ membership: updated });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Remove a member from the organization ───────────────
  app.delete(
    '/:memberId',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { memberId } = req.params as { memberId: string };

        const membership = await prisma.membership.findFirst({
          where: { id: memberId, organizationId },
        });
        if (!membership) throw new HttpError(404, 'Membre introuvable');
        if (membership.userId === req.user!.sub)
          throw new HttpError(400, 'Vous ne pouvez pas vous retirer vous-même');
        if (membership.role === 'ADMIN') {
          const adminCount = await prisma.membership.count({
            where: { organizationId, role: 'ADMIN', status: 'ACTIVE' },
          });
          if (adminCount <= 1)
            throw new HttpError(400, "Impossible : c'est le dernier administrateur");
        }

        await prisma.membership.delete({ where: { id: memberId } });
        await prisma.auditToken.deleteMany({ where: { userId: membership.userId } });
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'member.remove',
          target: 'Membership',
          targetId: memberId,
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // ─── Member site assignments ─────────────────────────────
  app.get(
    '/:memberId/sites',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { memberId } = req.params as { memberId: string };
        const membership = await prisma.membership.findFirst({
          where: { id: memberId, organizationId },
          include: {
            siteScopes: { include: { site: { select: { id: true, name: true, parentId: true } } } },
          },
        });
        if (!membership) throw new HttpError(404, 'Membre introuvable');
        return reply.send({
          sites: membership.siteScopes.map((s) => s.site),
          siteIds: membership.siteScopes.map((s) => s.siteId),
        });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.put(
    '/:memberId/sites',
    {
      preHandler: [app.authenticate, app.requireOrg, app.requireRole('ADMIN')],
    },
    async (req, reply) => {
      try {
        const { organizationId } = req.membership!;
        const { memberId } = req.params as { memberId: string };
        const body = z.object({ siteIds: z.array(z.string()) }).parse(req.body);

        const membership = await prisma.membership.findFirst({
          where: { id: memberId, organizationId },
        });
        if (!membership) throw new HttpError(404, 'Membre introuvable');

        // Verify that the sites belong to the organization.
        const valid = await prisma.site.findMany({
          where: { id: { in: body.siteIds }, organizationId },
          select: { id: true },
        });
        await prisma.userSite.deleteMany({ where: { membershipId: memberId } });
        if (valid.length > 0) {
          await prisma.userSite.createMany({
            data: valid.map((s) => ({ membershipId: memberId, siteId: s.id })),
            skipDuplicates: true,
          });
        }
        await audit({
          userId: req.user!.sub,
          organizationId,
          action: 'member.scopes.update',
          target: 'Membership',
          targetId: memberId,
          meta: { siteIds: body.siteIds },
          ip: req.ip,
        });
        return reply.send({ success: true, siteIds: body.siteIds });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}

// Separate route for the global user profile, outside an organization.
// Registered directly in server.ts under /api/profile.
export async function profileRoutes(app: FastifyInstance) {
  app.get('/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.sub },
        select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
      });
      if (!user) throw new HttpError(404, 'Utilisateur introuvable');
      return reply.send({ user });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch('/profile', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const body = updateProfileSchema.parse(req.body);
      const user = await prisma.user.update({
        where: { id: req.user!.sub },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        },
        select: { id: true, name: true, email: true, avatarUrl: true },
      });
      return reply.send({ user });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Change the password and invalidate all sessions.
  app.post('/profile/password', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const { currentPassword, newPassword } = z
        .object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8).max(128),
        })
        .parse(req.body);

      const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
      if (!user) throw new HttpError(404, 'Utilisateur introuvable');
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) throw new HttpError(401, 'Mot de passe actuel incorrect');

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
      // Immediately invalidate all sessions and refresh tokens.
      await prisma.auditToken.deleteMany({ where: { userId: user.id } });
      await audit({ userId: user.id, action: 'user.password.change', ip: req.ip });

      // Issue a new token pair to keep the user signed in.
      const accessToken = app.jwt.sign({ sub: user.id, email: user.email, name: user.name });
      const refreshToken = jwtLib.sign(
        { sub: user.id, email: user.email, name: user.name },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshTtl, jwtid: randomUUID() } as jwtLib.SignOptions,
      );
      await prisma.auditToken.create({
        data: {
          userId: user.id,
          tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
          expiresAt: new Date(Date.now() + msFromTtl(config.jwt.refreshTtl)),
        },
      });
      setRefreshCookie(reply, refreshToken);
      return reply.send({ accessToken });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

function msFromTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  const mul = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mul;
}
