import { FastifyInstance, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import jwtLib from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { MembershipRole } from '@prisma/client';
import { handleError, HttpError } from '../utils/errors.js';
import { audit } from '../utils/audit.js';
import { slugify } from '../utils/slug.js';
import { JwtUserPayload } from '../plugins/auth.js';
import { sendPasswordResetEmail } from '../services/email.js';
import { createOpaqueToken, hashToken } from '../utils/token.js';

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(120),
  password: z.string().min(8).max(128),
  // Optional name for the personal organization to create.
  organizationName: z.string().min(2).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(1).max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(120),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(128),
});

const organizationDeletionSchema = z.object({
  confirmation: z.string().min(1).max(120),
});

const authRateLimit = {
  config: {
    rateLimit: { max: config.rateLimit.authMax, timeWindow: config.rateLimit.authWindow },
  },
};

export default async function authRoutes(app: FastifyInstance) {
  // ─── Registration ─────────────────────────────────────────
  // Create a global user and a personal organization where they are ADMIN.
  app.post('/auth/register', authRateLimit, async (req, reply) => {
    try {
      const body = registerSchema.parse(req.body);

      const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (existing) throw new HttpError(409, 'Un compte existe déjà avec cet email');

      const passwordHash = await bcrypt.hash(body.password, 12);
      const user = await prisma.user.create({
        data: { name: body.name, email: body.email.toLowerCase(), passwordHash },
      });

      // Create a personal organization with a unique name/email-based slug.
      const orgBase = body.organizationName ?? `${body.name}`;
      const slug = await uniqueSlug(orgBase);
      const organization = await prisma.organization.create({
        data: {
          name: orgBase,
          slug,
          plan: 'FREE',
        },
      });

      // ADMIN membership.
      await prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      });

      await audit({
        userId: user.id,
        organizationId: organization.id,
        action: 'user.register',
        ip: req.ip,
      });

      const tokens = await issueTokens(app, user.id, user.email, user.name);
      const organizations = await listUserOrganizations(user.id);
      setRefreshCookie(reply, tokens.refreshToken);

      return reply.code(201).send({
        user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
        organizations,
        accessToken: tokens.accessToken,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Login ───────────────────────────────────────────────
  app.post('/auth/login', authRateLimit, async (req, reply) => {
    try {
      const body = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      // Use a uniform message to prevent user enumeration.
      if (!user) throw new HttpError(401, 'Identifiants invalides');
      if (!user.active) throw new HttpError(401, 'Identifiants invalides');

      const ok = await bcrypt.compare(body.password, user.passwordHash);
      if (!ok) throw new HttpError(401, 'Identifiants invalides');

      const tokens = await issueTokens(app, user.id, user.email, user.name);
      const organizations = await listUserOrganizations(user.id);
      setRefreshCookie(reply, tokens.refreshToken);

      await audit({ userId: user.id, action: 'user.login', ip: req.ip });

      return reply.send({
        user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
        organizations,
        accessToken: tokens.accessToken,
      });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Password reset request ──────────────────────────────
  app.post('/auth/password/forgot', authRateLimit, async (req, reply) => {
    try {
      const body = forgotPasswordSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

      if (user?.active) {
        const token = createOpaqueToken();
        const expiresAt = new Date(Date.now() + config.email.resetTokenTtlMinutes * 60_000);
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: hashToken(token),
            expiresAt,
          },
        });
        await prisma.passwordResetToken.deleteMany({
          where: {
            userId: user.id,
            OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
          },
        });

        const resetUrl = `${config.appUrl.replace(/\/$/, '')}/reset-password#token=${encodeURIComponent(token)}`;
        await sendPasswordResetEmail(user.email, resetUrl);
        await audit({ userId: user.id, action: 'user.password.reset.request', ip: req.ip });
      }

      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Token-based password reset ──────────────────────────
  app.post('/auth/password/reset', authRateLimit, async (req, reply) => {
    try {
      const body = resetPasswordSchema.parse(req.body);
      const tokenHash = hashToken(body.token);
      const reset = await prisma.passwordResetToken.findUnique({
        where: { tokenHash },
        include: { user: true },
      });

      if (!reset || reset.usedAt || reset.expiresAt < new Date() || !reset.user.active) {
        throw new HttpError(400, 'Lien de réinitialisation invalide ou expiré');
      }

      const passwordHash = await bcrypt.hash(body.password, 12);
      await prisma.$transaction([
        prisma.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
        prisma.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
        prisma.passwordResetToken.updateMany({
          where: { userId: reset.userId, id: { not: reset.id }, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.auditToken.deleteMany({ where: { userId: reset.userId } }),
      ]);

      await audit({ userId: reset.userId, action: 'user.password.reset.complete', ip: req.ip });
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Refresh ─────────────────────────────────────────────
  app.post('/auth/refresh', authRateLimit, async (req, reply) => {
    try {
      const refreshToken = req.cookies.orbis_refresh;
      if (!refreshToken) throw new HttpError(400, 'refreshToken requis');

      const payload = jwtLib.verify(refreshToken, config.jwt.refreshSecret) as {
        sub: string;
        email: string;
        name: string;
      };

      const tokenHash = hashToken(refreshToken);
      const stored = await prisma.auditToken.findUnique({ where: { tokenHash } });
      if (!stored || stored.expiresAt < new Date()) {
        throw new HttpError(401, 'Session expirée');
      }
      // Rotate the refresh token and invalidate the previous one.
      await prisma.auditToken.delete({ where: { id: stored.id } });

      const tokens = await issueTokens(app, payload.sub, payload.email, payload.name);
      setRefreshCookie(reply, tokens.refreshToken);
      return reply.send({ accessToken: tokens.accessToken });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Logout (revoke all refresh tokens) ──────────────────
  app.post('/auth/logout', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      await prisma.auditToken.deleteMany({ where: { userId: req.user!.sub } });
      await audit({ userId: req.user!.sub, action: 'user.logout', ip: req.ip });
      clearRefreshCookie(reply);
      return reply.send({ success: true });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Current profile and organizations ───────────────────
  app.get('/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.sub },
        select: { id: true, name: true, email: true, avatarUrl: true, createdAt: true },
      });
      if (!user) throw new HttpError(404, 'Utilisateur introuvable');
      const organizations = await listUserOrganizations(user.id);
      return reply.send({ user, organizations });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ─── Change active organization ──────────────────────────
  // The x-organization-id header carries the context; this route is optional
  // and validates access before the frontend switches context.
  app.get('/auth/organizations', { preHandler: app.authenticate }, async (req, reply) => {
    const organizations = await listUserOrganizations(req.user!.sub);
    return reply.send({ organizations });
  });

  app.delete('/auth/organizations/:id', { preHandler: app.authenticate }, async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const { confirmation } = organizationDeletionSchema.parse(req.body);
      const membership = await prisma.membership.findFirst({
        where: { userId: req.user!.sub, organizationId: id, role: 'ADMIN', status: 'ACTIVE' },
        include: { organization: { select: { id: true, name: true, scheduledDeletionAt: true } } },
      });
      if (!membership) throw new HttpError(404, 'Organisation introuvable');
      if (confirmation !== membership.organization.name) {
        throw new HttpError(
          400,
          'Saisissez exactement le nom de l’organisation pour confirmer la suppression',
        );
      }
      if (membership.organization.scheduledDeletionAt) {
        return reply.send({
          scheduledDeletionAt: membership.organization.scheduledDeletionAt,
          alreadyScheduled: true,
        });
      }
      const deletionRequestedAt = new Date();
      const scheduledDeletionAt = new Date(
        deletionRequestedAt.getTime() + config.tenant.deletionGraceDays * 86_400_000,
      );
      await prisma.organization.update({
        where: { id },
        data: { deletionRequestedAt, scheduledDeletionAt },
      });
      await audit({
        userId: req.user!.sub,
        organizationId: id,
        action: 'organization.deletion.requested',
        ip: req.ip,
        meta: { scheduledDeletionAt },
      });
      return reply.send({ scheduledDeletionAt, graceDays: config.tenant.deletionGraceDays });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post(
    '/auth/organizations/:id/cancel-deletion',
    { preHandler: app.authenticate },
    async (req, reply) => {
      try {
        const { id } = req.params as { id: string };
        const membership = await prisma.membership.findFirst({
          where: { userId: req.user!.sub, organizationId: id, role: 'ADMIN', status: 'ACTIVE' },
        });
        if (!membership) throw new HttpError(404, 'Organisation introuvable');
        await prisma.organization.update({
          where: { id },
          data: { deletionRequestedAt: null, scheduledDeletionAt: null },
        });
        await audit({
          userId: req.user!.sub,
          organizationId: id,
          action: 'organization.deletion.cancelled',
          ip: req.ip,
        });
        return reply.send({ success: true });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );
}

// ─── Helpers ───────────────────────────────────────────────

interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  permissions: string[];
}

async function listUserOrganizations(userId: string): Promise<OrgSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: 'ACTIVE', organization: { scheduledDeletionAt: null } },
    select: {
      role: true,
      permissions: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
  });
  return memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
    permissions: m.permissions,
  }));
}

async function uniqueSlug(base: string): Promise<string> {
  const root = slugify(base).slice(0, 40) || 'org';
  let slug = root;
  let n = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) {
    slug = `${root}-${n++}`;
  }
  return slug;
}

// Issue an access/refresh pair and store the refresh token hash.
export async function issueTokens(
  app: FastifyInstance,
  userId: string,
  email: string,
  name: string,
) {
  const payload: JwtUserPayload = { sub: userId, email, name };

  const accessToken = app.jwt.sign(payload);
  const refreshToken = jwtLib.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshTtl,
    jwtid: randomUUID(),
  } as jwtLib.SignOptions);

  const expiresAt = new Date(Date.now() + msFromTtl(config.jwt.refreshTtl));
  await prisma.auditToken.create({
    data: { userId, tokenHash: hashToken(refreshToken), expiresAt },
  });

  return { accessToken, refreshToken };
}

export function setRefreshCookie(reply: FastifyReply, refreshToken: string) {
  reply.setCookie('orbis_refresh', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(config.appUrl).protocol === 'https:',
    path: '/api/auth',
    maxAge: Math.floor(msFromTtl(config.jwt.refreshTtl) / 1000),
  });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie('orbis_refresh', { path: '/api/auth' });
}

function msFromTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 7 * 24 * 3600 * 1000;
  const n = Number(m[1]);
  const unit = m[2];
  const mul = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mul;
}
