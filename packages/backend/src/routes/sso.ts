import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { timingSafeEqual } from 'node:crypto';
import { WorkOS } from '@workos-inc/node';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma } from '../db/client.js';
import { issueTokens, setRefreshCookie } from './auth.js';
import { audit } from '../utils/audit.js';
import { createOpaqueToken } from '../utils/token.js';
import { handleError, HttpError } from '../utils/errors.js';

const startSchema = z.object({
  provider: z.enum(['GoogleOAuth', 'MicrosoftOAuth', 'OktaSAML', 'authkit']).default('authkit'),
  organization: z.string().optional(),
});

export default async function ssoRoutes(app: FastifyInstance) {
  app.get('/config', async (_req, reply) => {
    return reply.send({
      configured: Boolean(config.sso.workosClientId && config.sso.workosApiKey),
      clientConfigured: Boolean(config.sso.workosClientId),
      callbackConfigured: Boolean(config.sso.workosApiKey),
      redirectUri: config.sso.workosRedirectUri,
      providers: ['GoogleOAuth', 'MicrosoftOAuth', 'OktaSAML', 'authkit'],
    });
  });

  app.post('/workos/start', async (req, reply) => {
    try {
      if (!config.sso.workosClientId || !config.sso.workosApiKey) throw new HttpError(501, 'WorkOS n’est pas configuré');
      const body = startSchema.parse(req.body ?? {});
      const state = createOpaqueToken(32);
      reply.setCookie('orbis_sso_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: new URL(config.appUrl).protocol === 'https:',
        path: '/api/sso',
        maxAge: 10 * 60,
      });
      const url = new URL('https://api.workos.com/user_management/authorize');
      url.searchParams.set('client_id', config.sso.workosClientId);
      url.searchParams.set('redirect_uri', config.sso.workosRedirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('provider', body.provider);
      url.searchParams.set('state', state);
      if (body.organization) url.searchParams.set('organization', body.organization);
      return reply.send({ url: url.toString() });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/workos/callback', async (req, reply) => {
    try {
      if (!config.sso.workosClientId || !config.sso.workosApiKey) throw new HttpError(501, 'WorkOS n’est pas configuré');
      const query = z.object({
        code: z.string().min(1),
        state: z.string().min(32).max(256),
      }).parse(req.query);
      const expectedState = req.cookies.orbis_sso_state;
      reply.clearCookie('orbis_sso_state', { path: '/api/sso' });
      if (!expectedState || !safeEqual(expectedState, query.state)) {
        throw new HttpError(400, 'Retour SSO invalide. Relancez la connexion.');
      }

      const workos = new WorkOS(config.sso.workosApiKey);
      const auth = await workos.userManagement.authenticateWithCode({
        clientId: config.sso.workosClientId,
        code: query.code,
      });
      const ssoUser = auth.user;
      const email = ssoUser.email.toLowerCase();
      const fullName = [ssoUser.firstName, ssoUser.lastName].filter(Boolean).join(' ');
      const name = ssoUser.name ?? (fullName || email);
      const user = await prisma.user.upsert({
        where: { email },
        update: {
          name,
          avatarUrl: ssoUser.profilePictureUrl,
          active: true,
        },
        create: {
          email,
          name,
          avatarUrl: ssoUser.profilePictureUrl,
          active: true,
          passwordHash: await bcrypt.hash(createOpaqueToken(32), 12),
        },
      });
      const organization = await ensureSsoOrganization(user.id, email, auth.organizationId);
      const tokens = await issueTokens(app, user.id, user.email, user.name);
      await audit({
        userId: user.id,
        organizationId: organization.id,
        action: 'user.sso.login',
        target: 'User',
        targetId: user.id,
        ip: req.ip,
        meta: { provider: auth.authenticationMethod ?? 'SSO', workosOrganizationId: auth.organizationId ?? null },
      });
      setRefreshCookie(reply, tokens.refreshToken);

      const redirect = new URL('/sso/callback', config.appUrl);
      redirect.hash = new URLSearchParams({
        accessToken: tokens.accessToken,
        organizationId: organization.id,
      }).toString();
      return reply.redirect(redirect.toString(), 302);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ensureSsoOrganization(userId: string, email: string, workosOrganizationId?: string) {
  const existingMembership = await prisma.membership.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { organization: true },
    orderBy: { joinedAt: 'asc' },
  });
  if (existingMembership) return existingMembership.organization;

  const domain = email.split('@')[1] || 'sso.local';
  const name = domainName(domain);
  const slug = slugify(domain.replace(/\./g, '-')).slice(0, 48) || 'sso-org';
  let organization = await prisma.organization.findUnique({ where: { slug } });
  const firstDomainUser = !organization;
  if (!organization) {
    organization = await prisma.organization.create({
      data: {
      name,
      slug,
      plan: 'ENTERPRISE',
      },
    });
  }
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId, organizationId: organization.id } },
    update: { status: 'ACTIVE' },
    create: { userId, organizationId: organization.id, role: firstDomainUser ? 'ADMIN' : 'VIEWER', status: 'ACTIVE' },
  });
  if (workosOrganizationId) {
    await prisma.auditLog.create({
      data: {
        userId,
        organizationId: organization.id,
        action: 'sso.organization.link',
        target: 'Organization',
        targetId: organization.id,
        meta: { workosOrganizationId },
      },
    });
  }
  return organization;
}

function domainName(domain: string) {
  return domain
    .split('.')
    .filter(Boolean)
    .slice(0, -1)
    .join(' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Organisation SSO';
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
