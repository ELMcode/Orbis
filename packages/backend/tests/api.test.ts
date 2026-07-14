import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://orbis:orbis@localhost:55432/orbis_test?schema=public';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-for-api-tests-please-ignore';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-api-tests-please-ignore';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '7d';
process.env.RATE_LIMIT_AUTH_MAX = '5';
process.env.RATE_LIMIT_API_MAX = '1000';
process.env.UPLOAD_DIR = './uploads-test';
process.env.INTEGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadDir = path.join(backendDir, 'uploads-test');

let app: FastifyInstance;
let buildServer: () => Promise<FastifyInstance>;
let prisma: any;

beforeAll(async () => {
  try {
    execFileSync('corepack', ['pnpm', 'exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      cwd: backendDir,
      env: process.env,
      stdio: 'pipe',
    });
  } catch (err) {
    throw new Error(
      `Base PostgreSQL de test indisponible ou schema non initialisable. DATABASE_URL=${process.env.DATABASE_URL}\n${String(err)}`,
    );
  }

  ({ prisma } = await import('../src/db/client.js'));
  ({ buildServer } = await import('../src/server.js'));
});

beforeEach(async () => {
  await resetDb();
  await fs.rm(uploadDir, { recursive: true, force: true });
  await fs.mkdir(uploadDir, { recursive: true });
  app = await buildServer();
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await fs.rm(uploadDir, { recursive: true, force: true });
  await prisma?.$disconnect();
});

describe('API auth', () => {
  it('inscrit un utilisateur et cree une organisation admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Alice Admin', email: 'alice@example.test', password: 'Password123!', organizationName: 'Alice Corp' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe('alice@example.test');
    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0].role).toBe('ADMIN');
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeUndefined();
    expect(res.headers['set-cookie']).toContain('orbis_refresh=');
    expect(res.headers['set-cookie']).toContain('HttpOnly');
  });

  it('connecte un utilisateur avec ses organisations', async () => {
    await createTenant('login');
    const session = await login('admin-login@example.test');

    expect(session.user.email).toBe('admin-login@example.test');
    expect(session.organizations[0].role).toBe('ADMIN');
  });

  it('refuse un mauvais mot de passe avec un message uniforme', async () => {
    await createTenant('badpass');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin-badpass@example.test', password: 'wrong' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().message).toBe('Identifiants invalides');
  });

  it('retourne le profil courant avec un token valide', async () => {
    await createTenant('me');
    const session = await login('admin-me@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(session.accessToken) });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('admin-me@example.test');
    expect(res.json().organizations).toHaveLength(1);
  });

  it('refuse le profil courant sans token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });

    expect(res.statusCode).toBe(401);
  });

  it('fait tourner les refresh tokens', async () => {
    await createTenant('refresh');
    const session = await login('admin-refresh@example.test');

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: session.refreshCookie },
    });
    expect(first.statusCode).toBe(200);

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: session.refreshCookie },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('invalide les refresh tokens au logout', async () => {
    await createTenant('logout');
    const session = await login('admin-logout@example.test');

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(session.accessToken) });
    expect(logout.statusCode).toBe(200);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: session.refreshCookie },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('invalide les refresh tokens au changement de mot de passe', async () => {
    await createTenant('password');
    const session = await login('admin-password@example.test');

    const changed = await app.inject({
      method: 'POST',
      url: '/api/profile/password',
      headers: bearer(session.accessToken),
      payload: { currentPassword: 'Password123!', newPassword: 'NewPassword123!' },
    });
    expect(changed.statusCode).toBe(200);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: session.refreshCookie },
    });
    expect(refresh.statusCode).toBe(401);
  });

  it('réinitialise un mot de passe par token à usage unique', async () => {
    const ctx = await createTenant('reset');
    const token = 'reset-token-long-enough-for-test';
    await prisma.passwordResetToken.create({
      data: {
        userId: ctx.admin.id,
        tokenHash: hashTestToken(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, password: 'ResetPassword123!' },
    });
    expect(reset.statusCode).toBe(200);

    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin-reset@example.test', password: 'Password123!' },
    });
    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin-reset@example.test', password: 'ResetPassword123!' },
    });
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/password/reset',
      payload: { token, password: 'AnotherPassword123!' },
    });

    expect(oldLogin.statusCode).toBe(401);
    expect(newLogin.statusCode).toBe(200);
    expect(reuse.statusCode).toBe(400);
  });

  it('répond de façon neutre à une demande de reset inconnue', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/password/forgot',
      payload: { email: 'unknown@example.test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });
});

describe('API contexte organisation', () => {
  it('refuse une route business sans x-organization-id', async () => {
    await createTenant('noorg');
    const session = await login('admin-noorg@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/sites', headers: bearer(session.accessToken) });

    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('En-tête x-organization-id requis');
  });

  it('accepte une organisation dont l utilisateur est membre', async () => {
    const ctx = await createTenant('validorg');
    const session = await login('admin-validorg@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/sites', headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(200);
  });

  it('refuse une organisation dont l utilisateur n est pas membre', async () => {
    const a = await createTenant('orga');
    const b = await createTenant('orgb');
    const session = await login('admin-orga@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/sites', headers: authHeaders(session.accessToken, b.org.id) });

    expect(a.org.id).not.toBe(b.org.id);
    expect(res.statusCode).toBe(403);
  });

  it('liste les organisations accessibles dans /auth/organizations', async () => {
    await createTenant('orglist');
    const session = await login('admin-orglist@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/auth/organizations', headers: bearer(session.accessToken) });

    expect(res.statusCode).toBe(200);
    expect(res.json().organizations[0].slug).toBe('org-orglist');
  });

  it('planifie puis annule la suppression différée d une organisation', async () => {
    const ctx = await createTenant('tenant-deletion');
    const session = await login('admin-tenant-deletion@example.test');

    const scheduled = await app.inject({
      method: 'DELETE',
      url: `/api/auth/organizations/${ctx.org.id}`,
      headers: bearer(session.accessToken),
      payload: { confirmation: ctx.org.name },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json().graceDays).toBe(30);

    const hidden = await app.inject({ method: 'GET', url: '/api/auth/organizations', headers: bearer(session.accessToken) });
    expect(hidden.json().organizations).toHaveLength(0);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/auth/organizations/${ctx.org.id}/cancel-deletion`,
      headers: bearer(session.accessToken),
    });
    expect(cancelled.statusCode).toBe(200);

    const restored = await app.inject({ method: 'GET', url: '/api/auth/organizations', headers: bearer(session.accessToken) });
    expect(restored.json().organizations).toHaveLength(1);
  });
});

describe('API SSO', () => {
  it('expose l etat de configuration SSO', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sso/config' });

    expect(res.statusCode).toBe(200);
    expect(res.json().providers).toContain('authkit');
    expect(res.json().configured).toBe(false);
  });

  it('refuse le demarrage SSO quand WorkOS n est pas configure', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sso/workos/start',
      payload: { provider: 'authkit' },
    });

    expect(res.statusCode).toBe(501);
  });
});

describe('API isolation cross-tenant', () => {
  it('ne liste pas les equipements d une autre organisation', async () => {
    const ctx = await createTenant('isola');
    await createTenant('isolb');
    const session = await login('admin-isola@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/devices', headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(200);
    expect(names(res.json().devices)).toContain('Device-isola-FR');
    expect(names(res.json().devices)).not.toContain('Device-isolb-FR');
  });

  it('masque le detail d un equipement d une autre organisation en 404', async () => {
    const a = await createTenant('detaila');
    const b = await createTenant('detailb');
    const session = await login('admin-detaila@example.test');

    const res = await app.inject({ method: 'GET', url: `/api/devices/${b.deviceFr.id}`, headers: authHeaders(session.accessToken, a.org.id) });

    expect(res.statusCode).toBe(404);
  });

  it('bloque la suppression cross-tenant en 404', async () => {
    const a = await createTenant('deletea');
    const b = await createTenant('deleteb');
    const session = await login('admin-deletea@example.test');

    const res = await app.inject({ method: 'DELETE', url: `/api/devices/${b.deviceFr.id}`, headers: authHeaders(session.accessToken, a.org.id) });

    expect(res.statusCode).toBe(404);
    await expect(prisma.device.findUnique({ where: { id: b.deviceFr.id } })).resolves.toBeTruthy();
  });
});

describe('API commentaires entites', () => {
  it('commente, liste et resout un equipement', async () => {
    const ctx = await createTenant('comments');
    const session = await login('admin-comments@example.test');
    const headers = authHeaders(session.accessToken, ctx.org.id);

    const create = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers,
      payload: { targetType: 'DEVICE', targetId: ctx.deviceFr.id, body: 'Vérifier la double alimentation au prochain passage.' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().comment.body).toContain('double alimentation');

    const list = await app.inject({
      method: 'GET',
      url: `/api/comments?targetType=DEVICE&targetId=${ctx.deviceFr.id}`,
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().comments).toHaveLength(1);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/comments/${create.json().comment.id}`,
      headers,
      payload: { resolved: true },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().comment.resolved).toBe(true);
  });

  it('refuse un commentaire sur une adresse IP hors tenant', async () => {
    const a = await createTenant('commenta');
    const b = await createTenant('commentb');
    const session = await login('admin-commenta@example.test');
    const otherAddress = await prisma.ipAddress.create({
      data: { organizationId: b.org.id, siteId: b.france.id, address: '10.88.0.10', status: 'ASSIGNED' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/comments',
      headers: authHeaders(session.accessToken, a.org.id),
      payload: { targetType: 'IP_ADDRESS', targetId: otherAddress.id, body: 'Tentative cross-tenant' },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('API scoping site et IDOR intra-org', () => {
  it('limite un editeur scope France a ses equipements visibles', async () => {
    const ctx = await createTenant('scopefr');
    const session = await login('editor-scopefr@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/devices', headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(200);
    expect(names(res.json().devices)).toContain('Device-scopefr-FR');
    expect(names(res.json().devices)).not.toContain('Device-scopefr-BE');
  });

  it('refuse le detail d un device hors perimetre site', async () => {
    const ctx = await createTenant('detailbe');
    const session = await login('editor-detailbe@example.test');

    const res = await app.inject({ method: 'GET', url: `/api/devices/${ctx.deviceBe.id}`, headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(403);
  });

  it('refuse la suppression d un device hors perimetre site', async () => {
    const ctx = await createTenant('idorbe');
    const session = await login('editor-idorbe@example.test');

    const res = await app.inject({ method: 'DELETE', url: `/api/devices/${ctx.deviceBe.id}`, headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(403);
  });

  it('laisse un admin sans scope voir tous les sites de son organisation', async () => {
    const ctx = await createTenant('adminscope');
    const session = await login('admin-adminscope@example.test');

    const res = await app.inject({ method: 'GET', url: '/api/devices', headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(200);
    expect(names(res.json().devices)).toEqual(expect.arrayContaining(['Device-adminscope-FR', 'Device-adminscope-BE']));
  });

  it('autorise un editeur a creer dans son perimetre', async () => {
    const ctx = await createTenant('createfr');
    const session = await login('editor-createfr@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Created-FR', type: 'SWITCH', siteId: ctx.france.id },
    });

    expect(res.statusCode).toBe(201);
  });

  it('refuse a un editeur de creer hors perimetre', async () => {
    const ctx = await createTenant('createbe');
    const session = await login('editor-createbe@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Created-BE', type: 'SWITCH', siteId: ctx.belgique.id },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('API imports et conflits', () => {
  it('importe des equipements depuis un CSV', async () => {
    const ctx = await createTenant('import');
    const session = await login('admin-import@example.test');
    const csv = Buffer.from(`name,type,status,site,ip\nImported switch,SWITCH,ONLINE,${ctx.france.name},10.0.0.10\n`);
    const part = multipart('devices.csv', 'text/csv', csv);

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices/import',
      headers: { ...authHeaders(session.accessToken, ctx.org.id), ...part.headers },
      payload: part.payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().created).toBe(1);
    await expect(prisma.device.findFirst({ where: { name: 'Imported switch', organizationId: ctx.org.id } })).resolves.toBeTruthy();
  });

  it('refuse une sauvegarde de diagramme avec une version périmée', async () => {
    const ctx = await createTenant('conflict');
    const session = await login('admin-conflict@example.test');
    const diagram = await prisma.diagram.create({
      data: { organizationId: ctx.org.id, name: 'Conflict', siteId: ctx.france.id, nodes: [], edges: [] },
    });

    const first = await app.inject({
      method: 'PUT',
      url: `/api/diagrams/${diagram.id}`,
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { nodes: [{ id: 'a' }], edges: [], expectedVersion: diagram.version },
    });
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/diagrams/${diagram.id}`,
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { nodes: [{ id: 'b' }], edges: [], expectedVersion: diagram.version },
    });

    expect(first.statusCode).toBe(200);
    expect(stale.statusCode).toBe(409);
  });
});

describe('API RBAC', () => {
  it('refuse la creation de device a un viewer', async () => {
    const ctx = await createTenant('viewercreate');
    const session = await login('viewer-viewercreate@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Denied', type: 'SWITCH', siteId: ctx.france.id },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe('Permissions insuffisantes');
  });

  it('refuse la suppression de device a un viewer', async () => {
    const ctx = await createTenant('viewerdelete');
    const session = await login('viewer-viewerdelete@example.test');

    const res = await app.inject({ method: 'DELETE', url: `/api/devices/${ctx.deviceFr.id}`, headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(403);
  });

  it('autorise la creation de device a un editor', async () => {
    const ctx = await createTenant('editorcreate');
    const session = await login('editor-editorcreate@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Editor-created', type: 'SERVER', siteId: ctx.france.id },
    });

    expect(res.statusCode).toBe(201);
  });

  it('applique les permissions module explicites sur les membres non-admin', async () => {
    const ctx = await createTenant('moduleperms');
    await prisma.membership.update({ where: { id: ctx.editorMembership.id }, data: { permissions: ['ipam:write'] } });
    await prisma.membership.update({ where: { id: ctx.viewerMembership.id }, data: { permissions: ['inventory:write'] } });
    const editorSession = await login('editor-moduleperms@example.test');
    const viewerSession = await login('viewer-moduleperms@example.test');

    const editorDevice = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(editorSession.accessToken, ctx.org.id),
      payload: { name: 'Editor denied by module', type: 'SERVER', siteId: ctx.france.id },
    });
    const editorVrf = await app.inject({
      method: 'POST',
      url: '/api/ipam/vrfs',
      headers: authHeaders(editorSession.accessToken, ctx.org.id),
      payload: { name: 'VRF module scoped', rd: '65000:42', siteId: ctx.france.id },
    });
    const viewerDevice = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(viewerSession.accessToken, ctx.org.id),
      payload: { name: 'Viewer allowed by permission', type: 'SWITCH', siteId: ctx.france.id },
    });
    const viewerVrf = await app.inject({
      method: 'POST',
      url: '/api/ipam/vrfs',
      headers: authHeaders(viewerSession.accessToken, ctx.org.id),
      payload: { name: 'Viewer VRF denied' },
    });

    expect(editorDevice.statusCode).toBe(403);
    expect(editorDevice.json().message).toContain('inventory:write');
    expect(editorVrf.statusCode).toBe(201);
    expect(viewerDevice.statusCode).toBe(201);
    expect(viewerVrf.statusCode).toBe(403);
  });

  it('autorise la suppression de device a un admin', async () => {
    const ctx = await createTenant('admindelete');
    const session = await login('admin-admindelete@example.test');

    const res = await app.inject({ method: 'DELETE', url: `/api/devices/${ctx.deviceFr.id}`, headers: authHeaders(session.accessToken, ctx.org.id) });

    expect(res.statusCode).toBe(200);
    await expect(prisma.device.findUnique({ where: { id: ctx.deviceFr.id } })).resolves.toBeNull();
  });
});

describe('API quotas et limites tenant', () => {
  it('bloque la creation quand le quota du plan est atteint', async () => {
    const ctx = await createTenant('quota');
    await prisma.organization.update({ where: { id: ctx.org.id }, data: { plan: 'FREE' } });
    await prisma.device.createMany({
      data: Array.from({ length: 48 }, (_, index) => ({
        organizationId: ctx.org.id,
        siteId: ctx.france.id,
        name: `Quota-device-${index}`,
        type: 'SERVER',
        status: 'ONLINE',
      })),
    });
    const session = await login('admin-quota@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/devices',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Too much', type: 'SERVER', siteId: ctx.france.id },
    });

    expect(res.statusCode).toBe(402);
    expect(res.json().message).toBe('Quota du plan atteint');
    expect(res.json().details.resource).toBe('devices');
  });

  it('applique une limite de requetes par tenant', async () => {
    const ctx = await createTenant('tenantlimit');
    await prisma.organization.update({ where: { id: ctx.org.id }, data: { plan: 'FREE' } });
    const session = await login('admin-tenantlimit@example.test');
    const headers = authHeaders(session.accessToken, ctx.org.id);

    let last = await app.inject({ method: 'GET', url: '/api/sites', headers });
    for (let i = 0; i < 120; i += 1) {
      last = await app.inject({ method: 'GET', url: '/api/sites', headers });
      if (last.statusCode === 429) break;
    }

    expect(last.statusCode).toBe(429);
    expect(last.json().message).toBe('Limite de requêtes du tenant atteinte');
    expect(last.json().details.plan).toBe('FREE');
  });
});

describe('API source of truth avancée', () => {
  it('gère dépendances applicatives, contrats, champs, tags, vues et cycle de vie', async () => {
    const ctx = await createTenant('source');
    const session = await login('admin-source@example.test');
    const headers = authHeaders(session.accessToken, ctx.org.id);

    const dependency = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/dependencies',
      headers,
      payload: {
        name: 'Portail client vers PostgreSQL',
        dependencyType: 'DATABASE',
        criticality: 'CRITICAL',
        sourceDeviceId: ctx.deviceFr.id,
        targetDeviceId: ctx.deviceBe.id,
        protocol: 'TLS',
        port: 5432,
        owner: 'DSI',
        tags: ['production', 'erp'],
        customFields: { rto: '2h' },
      },
    });
    expect(dependency.statusCode).toBe(201);
    expect(dependency.json().dependency.sourceDevice.name).toBe(ctx.deviceFr.name);

    const contract = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/contracts',
      headers,
      payload: {
        name: 'Support constructeur switch coeur',
        type: 'SUPPORT',
        vendor: 'Cisco',
        deviceId: ctx.deviceFr.id,
        seatsTotal: 50,
        seatsUsed: 12,
        endDate: '2027-06-30',
      },
    });
    expect(contract.statusCode).toBe(201);
    expect(contract.json().contract.device.name).toBe(ctx.deviceFr.name);

    const invalidContract = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/contracts',
      headers,
      payload: { name: 'Licence invalide', seatsTotal: 2, seatsUsed: 3 },
    });
    expect(invalidContract.statusCode).toBe(400);

    const field = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/custom-fields',
      headers,
      payload: {
        target: 'DEVICE',
        key: 'business_owner',
        label: 'Responsable métier',
        type: 'TEXT',
        required: false,
      },
    });
    expect(field.statusCode).toBe(201);

    const tag = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/tags',
      headers,
      payload: { name: 'production', color: '#16a34a' },
    });
    expect(tag.statusCode).toBe(201);

    const view = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/saved-views',
      headers,
      payload: { name: 'Actifs critiques', target: 'DEVICES', filters: { criticality: 'CRITICAL' }, columns: ['name', 'site', 'owner'] },
    });
    expect(view.statusCode).toBe(201);

    const lifecycle = await app.inject({
      method: 'PUT',
      url: `/api/devices/${ctx.deviceFr.id}`,
      headers,
      payload: {
        lifecycleStatus: 'REPLACEMENT_DUE',
        assetTag: 'ELM-SW-001',
        supportEnd: '2026-12-31',
        replacementDue: '2026-10-31',
        customFields: { business_owner: 'Finance' },
      },
    });
    expect(lifecycle.statusCode).toBe(200);
    expect(lifecycle.json().device.lifecycleStatus).toBe('REPLACEMENT_DUE');
    expect(lifecycle.json().device.customFields.business_owner).toBe('Finance');

    const listed = await app.inject({ method: 'GET', url: '/api/source-of-truth/dependencies', headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().dependencies).toHaveLength(1);
  });

  it('isole les dépendances et contrats entre tenants et respecte le périmètre site', async () => {
    const ctx = await createTenant('sourceidor');
    const other = await createTenant('sourceother');
    const adminSession = await login('admin-sourceidor@example.test');
    const editorSession = await login('editor-sourceidor@example.test');
    const headers = authHeaders(adminSession.accessToken, ctx.org.id);
    const editorHeaders = authHeaders(editorSession.accessToken, ctx.org.id);

    const crossDependency = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/dependencies',
      headers,
      payload: {
        name: 'Cross tenant',
        sourceDeviceId: ctx.deviceFr.id,
        targetDeviceId: other.deviceFr.id,
      },
    });
    expect(crossDependency.statusCode).toBe(404);

    const visibleDependency = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/dependencies',
      headers,
      payload: {
        name: 'Visible depuis France',
        sourceDeviceId: ctx.deviceFr.id,
        targetDeviceId: ctx.deviceFr.id,
      },
    });
    expect(visibleDependency.statusCode).toBe(201);

    const hiddenDependency = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/dependencies',
      headers,
      payload: {
        name: 'Belgique seulement',
        sourceDeviceId: ctx.deviceBe.id,
        targetDeviceId: ctx.deviceBe.id,
      },
    });
    expect(hiddenDependency.statusCode).toBe(201);

    const editorList = await app.inject({ method: 'GET', url: '/api/source-of-truth/dependencies', headers: editorHeaders });
    expect(editorList.statusCode).toBe(200);
    expect(names(editorList.json().dependencies)).toEqual(['Visible depuis France']);

    const editorCannotCreateHiddenContract = await app.inject({
      method: 'POST',
      url: '/api/source-of-truth/contracts',
      headers: editorHeaders,
      payload: {
        name: 'Support hors périmètre',
        deviceId: ctx.deviceBe.id,
      },
    });
    expect(editorCannotCreateHiddenContract.statusCode).toBe(403);
  });
});

describe('API uploads et rate limiting', () => {
  it('refuse un PNG dont les magic bytes ne correspondent pas', async () => {
    const ctx = await createTenant('badpng');
    const session = await login('admin-badpng@example.test');
    const part = multipart('fake.png', 'image/png', Buffer.from('not a png'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/devices/${ctx.deviceFr.id}/images`,
      headers: { ...authHeaders(session.accessToken, ctx.org.id), ...part.headers },
      payload: part.payload,
    });

    expect(res.statusCode).toBe(415);
  });

  it('accepte un vrai PNG minimal', async () => {
    const ctx = await createTenant('goodpng');
    const session = await login('admin-goodpng@example.test');
    const part = multipart('ok.png', 'image/png', minimalPng());

    const res = await app.inject({
      method: 'POST',
      url: `/api/devices/${ctx.deviceFr.id}/images`,
      headers: { ...authHeaders(session.accessToken, ctx.org.id), ...part.headers },
      payload: part.payload,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().image.path).toMatch(/^images\/.+\.png$/);
  });

  it('sert les medias uniquement avec authentification et organisation autorisee', async () => {
    const ctx = await createTenant('mediaget');
    const other = await createTenant('mediaother');
    const session = await login('admin-mediaget@example.test');
    const otherSession = await login('admin-mediaother@example.test');
    const part = multipart('ok.png', 'image/png', minimalPng());

    const uploaded = await app.inject({
      method: 'POST',
      url: `/api/devices/${ctx.deviceFr.id}/images`,
      headers: { ...authHeaders(session.accessToken, ctx.org.id), ...part.headers },
      payload: part.payload,
    });
    const mediaPath = uploaded.json().image.path;

    const allowed = await app.inject({
      method: 'GET',
      url: `/api/media/file/${mediaPath}`,
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    const anonymous = await app.inject({ method: 'GET', url: `/api/media/file/${mediaPath}` });
    const crossTenant = await app.inject({
      method: 'GET',
      url: `/api/media/file/${mediaPath}`,
      headers: authHeaders(otherSession.accessToken, other.org.id),
    });

    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['content-type']).toContain('image/png');
    expect(anonymous.statusCode).toBe(401);
    expect(crossTenant.statusCode).toBe(404);
  });

  it('rate limite les tentatives de login', async () => {
    await createTenant('ratelimit');
    const attempts = [];
    for (let i = 0; i < 6; i += 1) {
      attempts.push(await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'admin-ratelimit@example.test', password: 'wrong' },
      }));
    }

    expect(attempts.slice(0, 5).every((r) => r.statusCode === 401)).toBe(true);
    expect(attempts[5].statusCode).toBe(429);
  });
});

describe('API discovery', () => {
  const linksCsv = 'localDevice,localPort,remoteDevice,remotePort,protocol,speed,vlan\nSW-DISC-01,Gi1/0/1,FW-DISC-01,port1,CSV,10G,10';

  it('importe une découverte sans créer ni modifier de schéma quand aucun schéma n est choisi', async () => {
    const ctx = await createTenant('discoverynodiagram');
    const session = await login('admin-discoverynodiagram@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/import',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        format: 'LINKS_CSV',
        content: linksCsv,
        siteId: ctx.france.id,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().devicesCreated).toBe(2);
    expect(res.json().linksDiscovered).toBe(1);
    expect(res.json().diagram).toBeNull();
    await expect(prisma.diagram.count({ where: { organizationId: ctx.org.id } })).resolves.toBe(0);
  });

  it('crée un schéma seulement quand un nom de schéma est demandé', async () => {
    const ctx = await createTenant('discoverydiagram');
    const session = await login('admin-discoverydiagram@example.test');

    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/import',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        format: 'LINKS_CSV',
        content: linksCsv,
        siteId: ctx.france.id,
        diagramName: 'Découverte contrôlée',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().diagram?.name).toBe('Découverte contrôlée');
    await expect(prisma.diagram.count({ where: { organizationId: ctx.org.id } })).resolves.toBe(1);
  });
});

describe('API collectors', () => {
  it('ingère routes, passerelles, bannières services, cloud et virtualisation', async () => {
    const ctx = await createTenant('collectordiscoveryplus');
    const session = await login('admin-collectordiscoveryplus@example.test');
    const created = await app.inject({
      method: 'POST',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Collector enrichi', siteId: ctx.france.id, autoDiagram: false },
    });
    expect(created.statusCode).toBe(201);
    const { collector, token } = created.json();

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: { status: 'SUCCESS', cidrs: ['10.10.0.0/24'], ports: [22, 443] },
        hosts: [
          {
            address: '10.10.0.10',
            hostname: 'edge-router-01',
            openPorts: [22, 443],
            interfaces: [{ index: 1, name: 'ge-0/0/0', operStatus: 1, speed: 1000000000 }],
            routeEntries: [{ destination: '0.0.0.0', mask: '0.0.0.0', nextHop: '10.10.0.1', interfaceIndex: 1 }],
            serviceBanners: [{ port: 22, service: 'ssh', product: 'OpenSSH_9.6', banner: 'SSH-2.0-OpenSSH_9.6' }],
            arpEntries: [],
            macTable: [],
            vlans: [],
            confidence: 88,
            sources: ['TCP_BANNER', 'SNMPv3'],
            source: 'SNMP',
          },
          {
            address: '10.10.0.20',
            hostname: 'aws-app-01',
            openPorts: [],
            interfaces: [],
            routeEntries: [],
            serviceBanners: [],
            arpEntries: [],
            macTable: [],
            vlans: [],
            cloud: { provider: 'AWS', account: '123456789012', region: 'eu-west-3', resourceId: 'i-abc123', resourceType: 'ec2' },
            confidence: 90,
            sources: ['CLOUD_AWS'],
            source: 'CLOUD',
          },
          {
            address: '10.10.0.30',
            hostname: 'vm-finance-01',
            openPorts: [],
            interfaces: [],
            routeEntries: [],
            serviceBanners: [],
            arpEntries: [],
            macTable: [],
            vlans: [],
            virtual: { platform: 'VMWARE', cluster: 'prod-cluster', host: 'esxi-01', vmId: 'vm-42', guestOs: 'Ubuntu Linux', powerState: 'poweredOn', ip: '10.10.0.30' },
            confidence: 92,
            sources: ['VIRTUAL_VMWARE'],
            source: 'VIRTUAL',
          },
        ],
        links: [],
      },
    });

    expect(ingest.statusCode).toBe(202);
    expect(ingest.json().summary.routesSeen).toBe(1);
    expect(ingest.json().summary.gatewaysSeen).toBe(1);
    expect(ingest.json().summary.serviceBannersSeen).toBe(1);
    expect(ingest.json().summary.cloudResources).toBe(1);
    expect(ingest.json().summary.virtualResources).toBe(1);

    const router = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, name: 'edge-router-01' } });
    const cloud = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, name: 'aws-app-01' } });
    const vm = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, name: 'vm-finance-01' } });
    expect(router.type).toBe('ROUTER');
    expect((router.customFields as any).discovery.gateways).toContain('10.10.0.1');
    expect((router.customFields as any).discovery.serviceBanners[0].service).toBe('ssh');
    expect(cloud.type).toBe('CLOUD');
    expect((cloud.customFields as any).discovery.cloud.provider).toBe('AWS');
    expect(vm.type).toBe('VM');
    expect((vm.customFields as any).discovery.virtual.platform).toBe('VMWARE');
  });

  it('gère rotation planifiée des tokens et failover multi-collector par site', async () => {
    const ctx = await createTenant('collectorha');
    const session = await login('admin-collectorha@example.test');
    const createPrimary = await app.inject({
      method: 'POST',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        name: 'Paris primary',
        siteId: ctx.france.id,
        defaultCidrs: ['10.42.0.0/24'],
        role: 'PRIMARY',
        priority: 10,
        failoverAfterMinutes: 5,
        tokenRotationDays: 30,
      },
    });
    expect(createPrimary.statusCode).toBe(201);
    const primary = createPrimary.json().collector;
    expect(primary.tokenRotationDays).toBe(30);
    expect(primary.nextTokenRotationAt).toBeTruthy();

    const createSecondary = await app.inject({
      method: 'POST',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        name: 'Paris secondary',
        siteId: ctx.france.id,
        defaultCidrs: ['10.42.0.0/24'],
        role: 'SECONDARY',
        priority: 20,
        failoverAfterMinutes: 5,
      },
    });
    expect(createSecondary.statusCode).toBe(201);
    const secondary = createSecondary.json().collector;

    await prisma.discoveryCollector.update({
      where: { id: primary.id },
      data: { lastSeenAt: new Date(Date.now() - 10 * 60_000), tokenExpiresAt: new Date(Date.now() - 1000), nextTokenRotationAt: new Date(Date.now() - 1000) },
    });
    await prisma.discoveryCollector.update({
      where: { id: secondary.id },
      data: { lastSeenAt: new Date(), tokenExpiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000) },
    });

    const expiredIngest = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${createPrimary.json().token}`, 'x-collector-id': primary.id },
      payload: { run: { status: 'SUCCESS' }, hosts: [], links: [] },
    });
    expect(expiredIngest.statusCode).toBe(401);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(listed.statusCode).toBe(200);
    const listedPrimary = listed.json().collectors.find((collector: any) => collector.id === primary.id);
    const listedSecondary = listed.json().collectors.find((collector: any) => collector.id === secondary.id);
    expect(listedPrimary.failoverState).toBe('STALE_PRIMARY');
    expect(listedPrimary.tokenRotationDue).toBe(true);
    expect(listedSecondary.failoverState).toBe('READY');
    expect(listedSecondary.tokenExpiresSoon).toBe(true);

    const rotated = await app.inject({
      method: 'POST',
      url: `/api/collectors/${primary.id}/rotate-token`,
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { tokenRotationDays: 45 },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().token).toMatch(/^isc_/);
    expect(rotated.json().collector.tokenRotationDays).toBe(45);
    expect(rotated.json().collector.tokenExpiresAt).toBeTruthy();

    const acceptedIngest = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${rotated.json().token}`, 'x-collector-id': primary.id },
      payload: { run: { status: 'SUCCESS' }, hosts: [], links: [] },
    });
    expect(acceptedIngest.statusCode).toBe(202);
  });

  it('respecte le choix de ne pas générer de schéma automatique pour un collector', async () => {
    const ctx = await createTenant('collectornodiagram');
    const session = await login('admin-collectornodiagram@example.test');

    const created = await app.inject({
      method: 'POST',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        name: 'Collector sans schéma',
        siteId: ctx.france.id,
        defaultCidrs: ['192.168.60.0/24'],
        defaultPorts: [22],
        autoDiagram: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const { collector, token } = created.json();

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          version: 'test',
          cidrs: ['192.168.60.0/24'],
          ports: [22],
        },
        hosts: [{
          address: '192.168.60.10',
          hostname: 'srv-no-diagram-01',
          openPorts: [22],
          source: 'TCP',
        }],
        links: [],
      },
    });

    expect(ingest.statusCode).toBe(202);
    await expect(prisma.device.count({ where: { organizationId: ctx.org.id, name: 'srv-no-diagram-01' } })).resolves.toBe(1);
    await expect(prisma.diagram.count({ where: { organizationId: ctx.org.id } })).resolves.toBe(0);
  });

  it('crée un collector et ingère une découverte authentifiée par token', async () => {
    const ctx = await createTenant('collector');
    const session = await login('admin-collector@example.test');
    const slackSink = await startJsonSink();
    const teamsSink = await startJsonSink();

    const created = await app.inject({
      method: 'POST',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        name: 'Collector test',
        siteId: ctx.france.id,
        defaultCidrs: ['192.168.50.0/24'],
        defaultPorts: [22, 443],
      },
    });
    expect(created.statusCode).toBe(201);
    const { collector, token } = created.json();
    expect(token).toMatch(/^isc_/);

    const settings = await app.inject({
      method: 'PUT',
      url: '/api/alerts/settings',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        emailEnabled: false,
        emailRecipients: [],
        webhookEnabled: true,
        webhookUrl: 'http://127.0.0.1:9/orbis-alerts',
        slackEnabled: true,
        slackWebhookUrl: slackSink.url,
        teamsEnabled: true,
        teamsWebhookUrl: teamsSink.url,
        minSeverity: 'WARNING',
        eventTypes: ['DEVICE_DOWN'],
        includeResolvedInfo: false,
      },
    });
    expect(settings.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { 'x-collector-id': collector.id },
      payload: { run: {}, hosts: [] },
    });
    expect(denied.statusCode).toBe(401);

    const logPush = await app.inject({
      method: 'POST',
      url: '/api/collector/logs',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        level: 'DIAGNOSTIC',
        message: 'Diagnostic collector',
        version: '1.1.0',
        meta: { api: { ok: true }, arp: { ok: true, entries: 2 } },
      },
    });
    expect(logPush.statusCode).toBe(202);

    const ingest = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          version: 'test',
          cidrs: ['192.168.50.0/24'],
          ports: [22, 443],
        },
        hosts: [{
          address: '192.168.50.10',
          hostname: 'srv-app-01',
          sysName: 'srv-app-01',
          sysDescr: 'Linux server model RX100',
          mac: '00:11:22:33:44:55',
          openPorts: [22, 443],
          interfaces: [{ index: 1, name: 'eth0', description: 'Ethernet0', operStatus: 1 }],
          source: 'TCP',
        }, {
          address: '192.168.50.1',
          sysName: 'sw-core-01',
          sysDescr: 'Cisco IOS Software C9300',
          openPorts: [22],
          interfaces: [{ index: 1, name: 'Gi1/0/1', description: 'GigabitEthernet1/0/1', operStatus: 1 }],
          arpEntries: [{ address: '192.168.50.20', mac: '00:50:56:aa:bb:cc', interfaceIndex: 1 }],
          macTable: [{ mac: '00:11:22:33:44:55', interfaceIndex: 1, bridgePort: 10, vlan: 20 }],
          vlans: [{ vlanId: 20, name: 'SERVERS' }],
          confidence: 90,
          sources: ['SNMP'],
          source: 'SNMP',
        }],
        links: [{
          localDevice: 'sw-core-01',
          localPort: 'Gi1/0/1',
          remoteDevice: 'srv-app-01',
          remotePort: 'eth0',
          protocol: 'LLDP',
          speed: '1G',
        }, {
          localDevice: 'sw-core-01',
          localPort: 'Gi1/0/2',
          remoteDevice: 'srv-app-01',
          remotePort: 'eth1',
          protocol: 'CDP',
          speed: '1G',
          confidence: 95,
        }],
      },
    });
    expect(ingest.statusCode).toBe(202);
    expect(ingest.json().summary.devicesCreated).toBe(3);
    expect(ingest.json().summary.ipAddressesCreated).toBe(3);
    expect(ingest.json().summary.snmpHosts).toBe(2);
    expect(ingest.json().summary.arpEntries).toBe(1);
    expect(ingest.json().summary.macEntries).toBe(1);
    expect(ingest.json().summary.vlansSeen).toBe(1);
    expect(ingest.json().summary.cdpLinks).toBe(1);
    expect(ingest.json().summary.lldpLinks).toBe(1);
    expect(ingest.json().summary.eventsCreated).toBe(3);
    expect(ingest.json().summary.newDevices).toBe(3);

    const secondRun = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          version: 'test',
          cidrs: ['192.168.50.0/24'],
          ports: [22, 443],
        },
        hosts: [{
          address: '192.168.50.1',
          sysName: 'sw-core-01',
          sysDescr: 'Cisco IOS Software C9300',
          openPorts: [22],
          interfaces: [{ index: 1, name: 'Gi1/0/1', description: 'GigabitEthernet1/0/1', operStatus: 1 }],
          source: 'SNMP',
        }],
        links: [],
      },
    });
    expect(secondRun.statusCode).toBe(202);
    expect(secondRun.json().summary.downDevices).toBe(2);

    const device = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, ip: '192.168.50.10' } });
    const sw = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, name: 'sw-core-01' } });
    const arpOnly = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, ip: '192.168.50.20' } });
    const ip = await prisma.ipAddress.findFirst({ where: { organizationId: ctx.org.id, address: '192.168.50.10' } });
    const run = await prisma.discoveryRun.findFirst({ where: { collectorId: collector.id } });
    const diagram = await prisma.diagram.findFirst({ where: { organizationId: ctx.org.id, siteId: ctx.france.id, name: 'Découverte automatique' } });
    const downEvent = await prisma.discoveryEvent.findFirst({ where: { collectorId: collector.id, type: 'DEVICE_DOWN' } });
    const webhookDelivery = await prisma.alertDelivery.findFirst({ where: { organizationId: ctx.org.id, channel: 'WEBHOOK' } });
    const slackDelivery = await prisma.alertDelivery.findFirst({ where: { organizationId: ctx.org.id, channel: 'SLACK' } });
    const teamsDelivery = await prisma.alertDelivery.findFirst({ where: { organizationId: ctx.org.id, channel: 'TEAMS' } });
    const collectorLog = await prisma.discoveryCollectorLog.findFirst({ where: { collectorId: collector.id, level: 'DIAGNOSTIC' } });

    expect(device?.name).toBe('srv-app-01');
    expect(device?.siteId).toBe(ctx.france.id);
    expect(device?.status).toBe('OFFLINE');
    expect(sw?.type).toBe('SWITCH');
    expect(arpOnly?.status).toBe('OFFLINE');
    expect(ip?.deviceId).toBe(device?.id);
    expect(run?.status).toBe('SUCCESS');
    expect(downEvent?.severity).toBe('CRITICAL');
    expect(webhookDelivery?.status).toBe('FAILED');
    expect(slackDelivery?.status).toBe('SENT');
    expect(teamsDelivery?.status).toBe('SENT');
    expect(slackSink.received[0].body.text).toContain('[Orbis] CRITICAL');
    expect(teamsSink.received[0].body.title).toContain('CRITICAL');
    expect(collectorLog?.message).toBe('Diagnostic collector');
    expect((diagram?.edges as any[])?.map((edge) => edge.data?.label).sort()).toEqual(['CDP', 'LLDP']);

    const alerts = await app.inject({
      method: 'GET',
      url: '/api/alerts?status=open',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(alerts.statusCode).toBe(200);
    expect(alerts.json().counts.critical).toBeGreaterThanOrEqual(1);

    const ack = await app.inject({
      method: 'POST',
      url: `/api/alerts/${downEvent!.id}/acknowledge`,
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().alert.acknowledgedAt).toBeTruthy();
    await slackSink.close();
    await teamsSink.close();
  });
});

describe('API monitoring exploitation', () => {
  it('enregistre latence/historique, ouvre et résout les incidents, respecte les maintenances', async () => {
    const ctx = await createTenant('monitoring');
    const session = await login('admin-monitoring@example.test');
    const created = await app.inject({
      method: 'POST',
      url: '/api/collectors',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        name: 'Collector monitoring',
        siteId: ctx.france.id,
        defaultCidrs: ['10.10.0.0/24'],
      },
    });
    expect(created.statusCode).toBe(201);
    const { collector, token } = created.json();

    const policy = await app.inject({
      method: 'PUT',
      url: '/api/monitoring/policy',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        availabilityTargetPct: 99.5,
        latencyWarningMs: 100,
        latencyCriticalMs: 200,
        latencyAlertsEnabled: true,
        measurementRetentionDays: 30,
        incidentAutoResolve: true,
      },
    });
    expect(policy.statusCode).toBe(200);

    const slowRun = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          cidrs: ['10.10.0.0/24'],
          ports: [443],
        },
        hosts: [{
          address: '10.10.0.10',
          hostname: 'latency-app-01',
          openPorts: [443],
          latencyMs: 320,
          source: 'TCP',
        }],
        links: [],
      },
    });
    expect(slowRun.statusCode).toBe(202);

    const device = await prisma.device.findFirst({ where: { organizationId: ctx.org.id, ip: '10.10.0.10' } });
    expect(device?.status).toBe('ONLINE');

    const availability = await app.inject({
      method: 'GET',
      url: '/api/monitoring/availability?days=30',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(availability.statusCode).toBe(200);
    expect(availability.json().summary.latencyAvgMs).toBe(320);
    expect(availability.json().summary.availabilityPct).toBe(100);

    const latencyEvent = await prisma.discoveryEvent.findFirst({ where: { organizationId: ctx.org.id, type: 'LATENCY_HIGH' } });
    expect(latencyEvent?.severity).toBe('CRITICAL');
    expect(await prisma.discoveryEvent.count({ where: { organizationId: ctx.org.id, type: 'LATENCY_HIGH' } })).toBe(1);

    const repeatedSlowRun = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          cidrs: ['10.10.0.0/24'],
          ports: [443],
        },
        hosts: [{
          address: '10.10.0.10',
          hostname: 'latency-app-01',
          openPorts: [443],
          latencyMs: 340,
          source: 'TCP',
        }],
        links: [],
      },
    });
    expect(repeatedSlowRun.statusCode).toBe(202);
    expect(await prisma.discoveryEvent.count({ where: { organizationId: ctx.org.id, type: 'LATENCY_HIGH' } })).toBe(1);

    let incidents = await app.inject({
      method: 'GET',
      url: '/api/monitoring/incidents?status=OPEN',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(incidents.statusCode).toBe(200);
    expect(incidents.json().incidents.some((incident: any) => incident.source === 'LATENCY_HIGH')).toBe(true);

    const healthyRun = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          cidrs: ['10.10.0.0/24'],
          ports: [443],
        },
        hosts: [{
          address: '10.10.0.10',
          hostname: 'latency-app-01',
          openPorts: [443],
          latencyMs: 20,
          source: 'TCP',
        }],
        links: [],
      },
    });
    expect(healthyRun.statusCode).toBe(202);
    const resolvedLatencyIncident = await prisma.incident.findFirst({ where: { organizationId: ctx.org.id, source: 'LATENCY_HIGH' } });
    expect(resolvedLatencyIncident?.status).toBe('RESOLVED');

    const maintenance = await app.inject({
      method: 'POST',
      url: '/api/monitoring/maintenance',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        title: 'Patch réseau',
        deviceId: device!.id,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(maintenance.statusCode).toBe(201);

    const maintenanceRun = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: {
          status: 'SUCCESS',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          cidrs: ['10.10.0.0/24'],
          ports: [443],
        },
        hosts: [],
        links: [],
      },
    });
    expect(maintenanceRun.statusCode).toBe(202);
    const maintainedDevice = await prisma.device.findUnique({ where: { id: device!.id } });
    expect(maintainedDevice?.status).toBe('MAINTENANCE');
    incidents = await app.inject({
      method: 'GET',
      url: '/api/monitoring/incidents?status=OPEN',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(incidents.json().incidents).toHaveLength(0);

    await app.inject({
      method: 'PUT',
      url: '/api/monitoring/policy',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        availabilityTargetPct: 99.5,
        latencyWarningMs: 100,
        latencyCriticalMs: 200,
        latencyAlertsEnabled: false,
        measurementRetentionDays: 1,
        incidentAutoResolve: true,
      },
    });
    const oldRun = await prisma.discoveryRun.create({
      data: {
        organizationId: ctx.org.id,
        collectorId: collector.id,
        siteId: ctx.france.id,
        status: 'SUCCESS',
        summary: {},
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.availabilitySample.create({
      data: {
        organizationId: ctx.org.id,
        collectorId: collector.id,
        runId: oldRun.id,
        siteId: ctx.france.id,
        deviceId: device!.id,
        status: 'ONLINE',
        checkedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      },
    });

    const retentionRun = await app.inject({
      method: 'POST',
      url: '/api/collector/ingest',
      headers: { authorization: `Bearer ${token}`, 'x-collector-id': collector.id },
      payload: {
        run: { status: 'SUCCESS', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), cidrs: [], ports: [443] },
        hosts: [{ address: '10.10.0.10', hostname: 'latency-app-01', openPorts: [443], latencyMs: 15, source: 'TCP' }],
        links: [],
      },
    });
    expect(retentionRun.statusCode).toBe(202);
    await expect(prisma.discoveryRun.findUnique({ where: { id: oldRun.id } })).resolves.toBeNull();
    await expect(prisma.availabilitySample.findFirst({ where: { runId: oldRun.id } })).resolves.toBeNull();
  });
});

describe('API pagination et performance inventaire', () => {
  it('borne les listes principales et renvoie une metadonnee de pagination', async () => {
    const ctx = await createTenant('pagination');
    const session = await login('admin-pagination@example.test');

    await prisma.device.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        organizationId: ctx.org.id,
        siteId: ctx.france.id,
        name: `Device ${String(index).padStart(2, '0')}`,
        ip: `10.20.0.${index + 1}`,
      })),
    });

    const firstPage = await app.inject({
      method: 'GET',
      url: '/api/devices?page=1&pageSize=5',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().devices).toHaveLength(5);
    expect(firstPage.json().pagination).toMatchObject({
      page: 1,
      pageSize: 5,
      total: 14,
      pageCount: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });

    const secondPage = await app.inject({
      method: 'GET',
      url: '/api/devices?page=2&pageSize=5',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(secondPage.statusCode).toBe(200);
    expect(secondPage.json().devices).toHaveLength(5);
    expect(secondPage.json().devices[0].name).toBe('Device 05');

    const capped = await app.inject({
      method: 'GET',
      url: '/api/devices?pageSize=500',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(capped.statusCode).toBe(400);
  });
});

describe('API rapports', () => {
  it('exporte inventaire/IPAM/changements et gere les rapports planifies', async () => {
    const ctx = await createTenant('reports');
    const session = await login('admin-reports@example.test');
    await prisma.vlan.create({ data: { organizationId: ctx.org.id, siteId: ctx.france.id, vlanId: 20, name: 'SERVERS' } });
    const collector = await prisma.discoveryCollector.create({
      data: {
        organizationId: ctx.org.id,
        siteId: ctx.france.id,
        name: 'Collector reports',
        tokenHash: hashTestToken('collector-report-token'),
      },
    });
    await prisma.discoveryEvent.create({
      data: {
        organizationId: ctx.org.id,
        collectorId: collector.id,
        siteId: ctx.france.id,
        deviceId: ctx.deviceFr.id,
        type: 'NEW_DEVICE',
        severity: 'INFO',
        title: 'Nouvel équipement détecté',
      },
    });
    await prisma.diagram.create({
      data: {
        organizationId: ctx.org.id,
        siteId: ctx.france.id,
        name: 'Topo reports',
        nodes: [{ id: 'a', data: { label: 'Switch core', type: 'SWITCH' } }],
        edges: [],
      },
    });

    const inventory = await app.inject({
      method: 'GET',
      url: '/api/reports/exports/inventory.csv',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    const ipam = await app.inject({
      method: 'GET',
      url: '/api/reports/exports/ipam.csv',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    const changes = await app.inject({
      method: 'GET',
      url: '/api/reports/exports/changes.csv',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    const pdf = await app.inject({
      method: 'GET',
      url: '/api/reports/exports/inventory.pdf',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    const topology = await app.inject({
      method: 'GET',
      url: '/api/reports/exports/topology.pdf',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });

    expect(inventory.statusCode).toBe(200);
    expect(inventory.headers['content-type']).toContain('text/csv');
    expect(inventory.body).toContain('Device-reports-FR');
    expect(ipam.statusCode).toBe(200);
    expect(ipam.body).toContain('SERVERS');
    expect(changes.statusCode).toBe(200);
    expect(changes.body).toContain('NEW_DEVICE');
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(topology.statusCode).toBe(200);

    const created = await app.inject({
      method: 'POST',
      url: '/api/reports/schedules',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        name: 'Mensuel inventaire',
        type: 'INVENTORY',
        format: 'PDF',
        frequency: 'MONTHLY',
        recipients: ['ops@example.test'],
        siteId: ctx.france.id,
        active: true,
        timezone: 'Europe/Paris',
        scheduledHour: 9,
        scheduledMinute: 30,
        scheduledMonthDay: 15,
        startAt: '2030-01-15T08:30:00.000Z',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().schedule.nextRunAt).toBeTruthy();
    expect(created.json().schedule.nextRunAt).toBe('2030-01-15T08:30:00.000Z');
    expect(created.json().schedule.scheduledHour).toBe(9);
    expect(created.json().schedule.scheduledMinute).toBe(30);
    expect(created.json().schedule.scheduledMonthDay).toBe(15);

    const listed = await app.inject({
      method: 'GET',
      url: '/api/reports/schedules',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().schedules).toHaveLength(1);

    const testSend = await app.inject({
      method: 'POST',
      url: `/api/reports/schedules/${created.json().schedule.id}/test`,
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(testSend.statusCode).toBe(200);
    expect(testSend.json().success).toBe(true);
    expect(testSend.json().delivered).toBe(false);
    expect(testSend.json().message).toContain('simulé');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/reports/schedules/${created.json().schedule.id}`,
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { active: false, frequency: 'WEEKLY', scheduledWeekday: 2 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().schedule.active).toBe(false);
    expect(patched.json().schedule.nextRunAt).toBeNull();
    expect(patched.json().schedule.frequency).toBe('WEEKLY');
    expect(patched.json().schedule.scheduledWeekday).toBe(2);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/reports/schedules/${created.json().schedule.id}`,
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(removed.statusCode).toBe(200);
  });

  it('ne fuit pas les exports entre organisations', async () => {
    const a = await createTenant('reportsa');
    await createTenant('reportsb');
    const session = await login('admin-reportsa@example.test');

    const res = await app.inject({
      method: 'GET',
      url: '/api/reports/exports/inventory.csv',
      headers: authHeaders(session.accessToken, a.org.id),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Device-reportsa-FR');
    expect(res.body).not.toContain('Device-reportsb-FR');
  });
});

describe('API publique et webhooks sortants', () => {
  it('expose une documentation OpenAPI et une API publique paginée par clé dédiée', async () => {
    const ctx = await createTenant('publicapi');
    const other = await createTenant('publicapi-other');
    const session = await login('admin-publicapi@example.test');

    const docs = await app.inject({ method: 'GET', url: '/api/docs/openapi.json' });
    expect(docs.statusCode).toBe(200);
    expect(docs.json().paths['/devices']).toBeTruthy();

    const created = await app.inject({
      method: 'POST',
      url: '/api/integrations/api-keys',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'CMDB', scopes: ['read:inventory'] },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().token).toMatch(/^isk_/);

    const devices = await app.inject({
      method: 'GET',
      url: '/api/public/v1/devices?limit=1',
      headers: bearer(created.json().token),
    });
    expect(devices.statusCode).toBe(200);
    expect(devices.json().devices).toHaveLength(1);
    expect(devices.json().devices[0].name).toContain('publicapi');
    expect(devices.body).not.toContain(other.deviceFr.name);
    expect(devices.json().pagination.nextCursor).toBeTruthy();

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/public/v1/ipam/addresses',
      headers: bearer(created.json().token),
    });
    expect(forbidden.statusCode).toBe(403);

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/integrations/api-keys/${created.json().key.id}/revoke`,
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(revoked.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/public/v1/devices',
      headers: bearer(created.json().token),
    });
    expect(denied.statusCode).toBe(401);
  });

  it('envoie un webhook sortant signé sur mutation équipement et journalise la livraison', async () => {
    const ctx = await createTenant('webhookout');
    const session = await login('admin-webhookout@example.test');
    const received: Array<{ signature: string | undefined; event: string | undefined; body: any }> = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        received.push({
          signature: req.headers['x-orbis-signature'] as string | undefined,
          event: req.headers['x-orbis-event'] as string | undefined,
          body: JSON.parse(raw),
        });
        res.writeHead(204);
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const endpoint = await app.inject({
        method: 'POST',
        url: '/api/integrations/webhooks',
        headers: authHeaders(session.accessToken, ctx.org.id),
        payload: {
          name: 'SIEM',
          url: `http://127.0.0.1:${port}/hook`,
          events: ['device.created'],
        },
      });
      expect(endpoint.statusCode).toBe(201);
      expect(endpoint.json().secret).toMatch(/^whsec_/);

      const device = await app.inject({
        method: 'POST',
        url: '/api/devices',
        headers: authHeaders(session.accessToken, ctx.org.id),
        payload: { name: 'Webhook Device', siteId: ctx.france.id, type: 'SERVER' },
      });
      expect(device.statusCode).toBe(201);
      expect(received).toHaveLength(1);
      expect(received[0].event).toBe('device.created');
      expect(received[0].signature).toMatch(/^sha256=/);
      expect(received[0].body.type).toBe('device.created');
      expect(received[0].body.data.device.name).toBe('Webhook Device');

      const delivery = await prisma.webhookDelivery.findFirst({
        where: { organizationId: ctx.org.id, eventType: 'device.created' },
      });
      expect(delivery?.status).toBe('SENT');
      expect(delivery?.statusCode).toBe(204);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('API securite et conformite', () => {
  it('calcule les risques, configure la policy et exporte risques/audit', async () => {
    const ctx = await createTenant('security');
    const session = await login('admin-security@example.test');
    const collector = await prisma.discoveryCollector.create({
      data: {
        organizationId: ctx.org.id,
        siteId: ctx.france.id,
        name: 'Collector security',
        tokenHash: hashTestToken('collector-security-token'),
        tokenLastRotatedAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    });
    await prisma.discoveryState.create({
      data: {
        organizationId: ctx.org.id,
        collectorId: collector.id,
        siteId: ctx.france.id,
        deviceId: ctx.deviceFr.id,
        status: 'ONLINE',
        lastAddress: '10.10.0.10',
        lastPorts: [22, 3389, 445],
      },
    });
    await prisma.discoveryEvent.create({
      data: {
        organizationId: ctx.org.id,
        collectorId: collector.id,
        siteId: ctx.france.id,
        deviceId: ctx.deviceFr.id,
        type: 'IP_CONFLICT',
        severity: 'CRITICAL',
        title: 'Conflit IP détecté',
        meta: { address: '10.10.0.10' },
      },
    });
    await prisma.device.create({
      data: {
        organizationId: ctx.org.id,
        name: 'Unknown appliance',
        type: 'OTHER',
        status: 'ONLINE',
        ip: '10.10.0.50',
        tags: ['discovered'],
      },
    });

    const summary = await app.inject({
      method: 'GET',
      url: '/api/security/summary',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().counts.critical).toBeGreaterThanOrEqual(2);
    expect(summary.json().risks.some((risk: any) => risk.category === 'RISKY_PORT' && risk.evidence.port === 3389)).toBe(true);
    expect(summary.json().risks.some((risk: any) => risk.category === 'MISSING_SITE')).toBe(true);
    expect(summary.json().risks.some((risk: any) => risk.category === 'COLLECTOR_SECRET')).toBe(true);

    const policy = await app.inject({
      method: 'PATCH',
      url: '/api/security/policy',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { requireDeviceOwner: false, criticalPorts: [3389] },
    });
    expect(policy.statusCode).toBe(200);
    expect(policy.json().policy.requireDeviceOwner).toBe(false);
    expect(policy.json().policy.criticalPorts).toEqual([3389]);

    const risksCsv = await app.inject({
      method: 'GET',
      url: '/api/security/risks.csv',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(risksCsv.statusCode).toBe(200);
    expect(risksCsv.body).toContain('RISKY_PORT');
    expect(risksCsv.body).toContain('3389');

    const auditLog = await app.inject({
      method: 'GET',
      url: '/api/security/audit?action=security',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(auditLog.statusCode).toBe(200);
    expect(auditLog.json().logs.some((log: any) => log.action === 'security.policy.update')).toBe(true);

    const auditCsv = await app.inject({
      method: 'GET',
      url: '/api/security/audit.csv',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(auditCsv.statusCode).toBe(200);
    expect(auditCsv.body).toContain('security.policy.update');
  });

  it('ne fuit pas les risques entre organisations', async () => {
    const a = await createTenant('securitya');
    await createTenant('securityb');
    const session = await login('admin-securitya@example.test');
    await prisma.device.create({
      data: { organizationId: a.org.id, name: 'Security-A orphan', type: 'OTHER', status: 'ONLINE', tags: ['discovered'] },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/security/summary',
      headers: authHeaders(session.accessToken, a.org.id),
    });

    expect(res.statusCode).toBe(200);
    const titles = res.json().risks.map((risk: any) => risk.title).join('\n');
    expect(titles).toContain('Security-A orphan');
    expect(titles).not.toContain('Device-securityb');
  });
});

describe('API IPAM avance et DCIM', () => {
  it('applique le perimetre descendant : parent voit enfants, enfant ne voit pas parent', async () => {
    const ctx = await createTenant('hierarchy');
    const session = await login('admin-hierarchy@example.test');
    const child = await prisma.site.create({
      data: { organizationId: ctx.org.id, name: 'Bruxelles DR', parentId: ctx.belgique.id, createdById: ctx.admin.id },
    });
    const parentDevice = await prisma.device.create({
      data: { organizationId: ctx.org.id, name: 'BE-parent-device', type: 'ROUTER', status: 'ONLINE', siteId: ctx.belgique.id },
    });
    const childDevice = await prisma.device.create({
      data: { organizationId: ctx.org.id, name: 'BE-child-device', type: 'SERVER', status: 'ONLINE', siteId: child.id },
    });
    await prisma.rack.create({ data: { organizationId: ctx.org.id, name: 'BE-parent-rack', siteId: ctx.belgique.id } });
    await prisma.rack.create({ data: { organizationId: ctx.org.id, name: 'BE-child-rack', siteId: child.id } });
    await prisma.diagram.create({ data: { organizationId: ctx.org.id, name: 'BE-parent-diagram', siteId: ctx.belgique.id, nodes: [], edges: [] } });
    await prisma.diagram.create({ data: { organizationId: ctx.org.id, name: 'BE-child-diagram', siteId: child.id, nodes: [], edges: [] } });
    await prisma.vlan.create({ data: { organizationId: ctx.org.id, siteId: ctx.belgique.id, vlanId: 100, name: 'BE parent VLAN' } });
    await prisma.vlan.create({ data: { organizationId: ctx.org.id, siteId: child.id, vlanId: 110, name: 'BE child VLAN' } });
    const provider = await prisma.provider.create({ data: { organizationId: ctx.org.id, name: 'Global Carrier' } });
    const parentCircuit = await prisma.circuit.create({ data: { organizationId: ctx.org.id, siteId: ctx.belgique.id, providerId: provider.id, name: 'BE parent circuit' } });
    const childCircuit = await prisma.circuit.create({ data: { organizationId: ctx.org.id, siteId: child.id, providerId: provider.id, name: 'BE child circuit' } });
    await prisma.cable.create({ data: { organizationId: ctx.org.id, circuitId: childCircuit.id, label: 'BE child cable', bDeviceId: childDevice.id } });
    await prisma.cable.create({ data: { organizationId: ctx.org.id, circuitId: parentCircuit.id, label: 'BE parent cable', bDeviceId: parentDevice.id } });
    const collector = await prisma.discoveryCollector.create({
      data: { organizationId: ctx.org.id, siteId: child.id, name: 'Child collector', tokenHash: hashTestToken('collector-child') },
    });
    await prisma.discoveryEvent.create({
      data: {
        organizationId: ctx.org.id,
        collectorId: collector.id,
        siteId: child.id,
        deviceId: childDevice.id,
        type: 'NEW_DEVICE',
        severity: 'WARNING',
        title: 'Child alert',
      },
    });

    const headers = authHeaders(session.accessToken, ctx.org.id);
    const get = (url: string) => app.inject({ method: 'GET', url, headers });
    const parentQs = `siteId=${ctx.belgique.id}`;
    const childQs = `siteId=${child.id}`;

    const parentDevices = await get(`/api/devices?${parentQs}`);
    expect(parentDevices.statusCode).toBe(200);
    expect(names(parentDevices.json().devices)).toEqual(expect.arrayContaining(['BE-parent-device', 'BE-child-device']));

    const childDevices = await get(`/api/devices?${childQs}`);
    expect(childDevices.statusCode).toBe(200);
    expect(names(childDevices.json().devices)).toContain('BE-child-device');
    expect(names(childDevices.json().devices)).not.toContain('BE-parent-device');

    expect(names((await get(`/api/racks?${parentQs}`)).json().racks)).toEqual(expect.arrayContaining(['BE-parent-rack', 'BE-child-rack']));
    expect(names((await get(`/api/racks?${childQs}`)).json().racks)).toEqual(['BE-child-rack']);
    expect(names((await get(`/api/diagrams?${parentQs}`)).json().diagrams)).toEqual(expect.arrayContaining(['BE-parent-diagram', 'BE-child-diagram']));
    expect(names((await get(`/api/diagrams?${childQs}`)).json().diagrams)).toEqual(['BE-child-diagram']);
    expect(names((await get(`/api/ipam/vlans?${parentQs}`)).json().vlans)).toEqual(expect.arrayContaining(['BE parent VLAN', 'BE child VLAN']));
    expect(names((await get(`/api/ipam/vlans?${childQs}`)).json().vlans)).toEqual(['BE child VLAN']);
    expect(names((await get(`/api/dcim/circuits?${parentQs}`)).json().circuits)).toEqual(expect.arrayContaining(['BE parent circuit', 'BE child circuit']));
    expect(names((await get(`/api/dcim/circuits?${childQs}`)).json().circuits)).toEqual(['BE child circuit']);
    expect(labels((await get(`/api/dcim/cables?${parentQs}`)).json().cables)).toEqual(expect.arrayContaining(['BE parent cable', 'BE child cable']));
    expect(labels((await get(`/api/dcim/cables?${childQs}`)).json().cables)).toEqual(['BE child cable']);
    expect(names((await get('/api/dcim/providers')).json().providers)).toContain('Global Carrier');
    expect((await get(`/api/alerts?status=all&${parentQs}`)).json().alerts.map((alert: any) => alert.title)).toContain('Child alert');

    const report = await get(`/api/reports/exports/inventory.csv?${parentQs}`);
    expect(report.statusCode).toBe(200);
    expect(report.body).toContain('BE-parent-device');
    expect(report.body).toContain('BE-child-device');
  });

  it('gere VRF, reservations IP, operateurs, circuits, patch panels et cables', async () => {
    const ctx = await createTenant('dcim');
    const session = await login('admin-dcim@example.test');

    const vrf = await app.inject({
      method: 'POST',
      url: '/api/ipam/vrfs',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'PROD', rd: '65000:10', siteId: ctx.france.id },
    });
    expect(vrf.statusCode).toBe(201);

    const prefix = await app.inject({
      method: 'POST',
      url: '/api/ipam/prefixes',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { cidr: '10.50.0.0/24', name: 'Prod LAN', siteId: ctx.france.id, vrfId: vrf.json().vrf.id },
    });
    expect(prefix.statusCode).toBe(201);
    expect(prefix.json().prefix.vrf.name).toBe('PROD');

    const address = await app.inject({
      method: 'POST',
      url: '/api/ipam/addresses',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        address: '10.50.0.10',
        prefixId: prefix.json().prefix.id,
        status: 'RESERVED',
        reservedBy: 'Projet ERP',
        reservationExpiresAt: '2030-01-01T00:00:00.000Z',
      },
    });
    expect(address.statusCode).toBe(201);
    expect(address.json().address.reservedBy).toBe('Projet ERP');

    const secondAddress = await app.inject({
      method: 'POST',
      url: '/api/ipam/addresses',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { address: '10.50.0.11', prefixId: prefix.json().prefix.id, status: 'ASSIGNED' },
    });
    expect(secondAddress.statusCode).toBe(201);

    // The conflict guard must apply to edits as well as creates.
    const duplicateOnUpdate = await app.inject({
      method: 'PATCH',
      url: `/api/ipam/addresses/${address.json().address.id}`,
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { address: '10.50.0.11' },
    });
    expect(duplicateOnUpdate.statusCode).toBe(409);

    const provider = await app.inject({
      method: 'POST',
      url: '/api/dcim/providers',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Carrier Test', contactEmail: 'noc@example.test' },
    });
    expect(provider.statusCode).toBe(201);

    const circuit = await app.inject({
      method: 'POST',
      url: '/api/dcim/circuits',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'Fibre Paris', siteId: ctx.france.id, providerId: provider.json().provider.id, circuitId: 'CID-001', bandwidthMbps: 1000 },
    });
    expect(circuit.statusCode).toBe(201);
    expect(circuit.json().circuit.provider.name).toBe('Carrier Test');

    const rack = await prisma.rack.create({ data: { organizationId: ctx.org.id, siteId: ctx.france.id, name: 'Rack DCIM' } });
    const panel = await app.inject({
      method: 'POST',
      url: '/api/dcim/patch-panels',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: { name: 'PP-A01', siteId: ctx.france.id, rackId: rack.id, portsCount: 48 },
    });
    expect(panel.statusCode).toBe(201);
    expect(panel.json().patchPanel.portsCount).toBe(48);

    const cable = await app.inject({
      method: 'POST',
      url: '/api/dcim/cables',
      headers: authHeaders(session.accessToken, ctx.org.id),
      payload: {
        label: 'FO-001',
        circuitId: circuit.json().circuit.id,
        cableType: 'FIBER',
        aPatchPanelId: panel.json().patchPanel.id,
        aPatchPort: '01',
        bDeviceId: ctx.deviceFr.id,
        bPortLabel: 'Te1/1/1',
      },
    });
    expect(cable.statusCode).toBe(201);
    expect(cable.json().cable.circuit.name).toBe('Fibre Paris');
    expect(cable.json().cable.bDevice.name).toBe(ctx.deviceFr.name);

    const list = await app.inject({
      method: 'GET',
      url: '/api/dcim/circuits',
      headers: authHeaders(session.accessToken, ctx.org.id),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().circuits).toHaveLength(1);
  });

  it('respecte le cloisonnement tenant sur DCIM', async () => {
    const a = await createTenant('dcima');
    const b = await createTenant('dcimb');
    const session = await login('admin-dcima@example.test');
    await prisma.provider.create({ data: { organizationId: b.org.id, name: 'Hidden Carrier' } });
    await prisma.provider.create({ data: { organizationId: a.org.id, name: 'Visible Carrier' } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/dcim/providers',
      headers: authHeaders(session.accessToken, a.org.id),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Visible Carrier');
    expect(res.body).not.toContain('Hidden Carrier');
  });
});

async function startJsonSink() {
  const received: Array<{ headers: Record<string, string | string[] | undefined>; body: any }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  server.unref();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/hook`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function resetDb() {
  await prisma.userSite.deleteMany();
  await prisma.auditToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookEndpoint.deleteMany();
  await prisma.publicApiKey.deleteMany();
  await prisma.availabilitySample.deleteMany();
  await prisma.incident.deleteMany();
  await prisma.maintenanceWindow.deleteMany();
  await prisma.monitoringPolicy.deleteMany();
  await prisma.entityComment.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.deviceImage.deleteMany();
  await prisma.port.deleteMany();
  await prisma.cable.deleteMany();
  await prisma.patchPanel.deleteMany();
  await prisma.circuit.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.rackSlot.deleteMany();
  await prisma.rack.deleteMany();
  await prisma.diagramVersion.deleteMany();
  await prisma.diagram.deleteMany();
  await prisma.alertDelivery.deleteMany();
  await prisma.discoveryCollectorLog.deleteMany();
  await prisma.discoveryEvent.deleteMany();
  await prisma.discoveryState.deleteMany();
  await prisma.discoveryRun.deleteMany();
  await prisma.discoveryCollector.deleteMany();
  await prisma.alertSettings.deleteMany();
  await prisma.reportSchedule.deleteMany();
  await prisma.securityPolicy.deleteMany();
  await prisma.savedView.deleteMany();
  await prisma.tagDefinition.deleteMany();
  await prisma.customFieldDefinition.deleteMany();
  await prisma.assetContract.deleteMany();
  await prisma.applicationDependency.deleteMany();
  await prisma.ipAddress.deleteMany();
  await prisma.ipPrefix.deleteMany();
  await prisma.vrf.deleteMany();
  await prisma.vlan.deleteMany();
  await prisma.device.deleteMany();
  await prisma.site.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
}

function hashTestToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function createTenant(suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `Org ${suffix}`, slug: `org-${suffix}`, plan: 'PRO' },
  });
  const admin = await createUser(`admin-${suffix}@example.test`, 'Admin Test');
  const editor = await createUser(`editor-${suffix}@example.test`, 'Editor Test');
  const viewer = await createUser(`viewer-${suffix}@example.test`, 'Viewer Test');

  const adminMembership = await prisma.membership.create({
    data: { userId: admin.id, organizationId: org.id, role: 'ADMIN', status: 'ACTIVE' },
  });
  const editorMembership = await prisma.membership.create({
    data: { userId: editor.id, organizationId: org.id, role: 'EDITOR', status: 'ACTIVE' },
  });
  const viewerMembership = await prisma.membership.create({
    data: { userId: viewer.id, organizationId: org.id, role: 'VIEWER', status: 'ACTIVE' },
  });

  const france = await prisma.site.create({
    data: { organizationId: org.id, name: `France-${suffix}`, createdById: admin.id },
  });
  const belgique = await prisma.site.create({
    data: { organizationId: org.id, name: `Belgique-${suffix}`, createdById: admin.id },
  });
  await prisma.userSite.create({ data: { membershipId: editorMembership.id, siteId: france.id } });
  await prisma.userSite.create({ data: { membershipId: viewerMembership.id, siteId: france.id } });

  const deviceFr = await prisma.device.create({
    data: { organizationId: org.id, name: `Device-${suffix}-FR`, type: 'SWITCH', status: 'ONLINE', siteId: france.id, editedById: admin.id },
  });
  const deviceBe = await prisma.device.create({
    data: { organizationId: org.id, name: `Device-${suffix}-BE`, type: 'SERVER', status: 'ONLINE', siteId: belgique.id, editedById: admin.id },
  });

  return {
    org,
    admin,
    editor,
    viewer,
    adminMembership,
    editorMembership,
    viewerMembership,
    france,
    belgique,
    deviceFr,
    deviceBe,
  };
}

async function createUser(email: string, name: string) {
  return prisma.user.create({
    data: {
      email,
      name,
      passwordHash: await bcrypt.hash('Password123!', 12),
    },
  });
}

async function login(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: 'Password123!' },
  });
  expect(res.statusCode).toBe(200);
  return { ...res.json(), refreshCookie: refreshCookie(res.headers['set-cookie']) };
}

function refreshCookie(setCookie: string | string[] | undefined) {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(value).toContain('orbis_refresh=');
  return value!.split(';', 1)[0];
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function authHeaders(token: string, orgId: string) {
  return { ...bearer(token), 'x-organization-id': orgId };
}

function names(rows: Array<{ name: string }>) {
  return rows.map((row) => row.name).sort();
}

function labels(rows: Array<{ label: string }>) {
  return rows.map((row) => row.label).sort();
}

function multipart(filename: string, mimeType: string, content: Buffer) {
  const boundary = `----orbis-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([head, content, tail]),
  };
}

function minimalPng() {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89,
  ]);
}

describe('Discovery approval and collaboration', () => {
  it('stores a discovery proposal until an admin approves it', async () => {
    const tenant = await createTenant('proposal');
    const session = await login(tenant.admin.email);
    const created = await app.inject({ method: 'POST', url: '/api/discovery/import', headers: authHeaders(session.accessToken, tenant.org.id), payload: {
      format: 'LINKS_CSV', applyMode: 'PROPOSE', siteId: tenant.france.id,
      content: 'localDevice,remoteDevice\nCORE-PROPOSAL,EDGE-PROPOSAL',
    } });
    expect(created.statusCode).toBe(202);
    const proposalId = created.json().proposal.id;
    expect(await prisma.device.count({ where: { organizationId: tenant.org.id, name: 'CORE-PROPOSAL' } })).toBe(0);
    const reviewed = await app.inject({ method: 'POST', url: `/api/discovery/proposals/${proposalId}/review`, headers: authHeaders(session.accessToken, tenant.org.id), payload: { decision: 'APPROVE' } });
    expect(reviewed.statusCode).toBe(200);
    expect(await prisma.device.count({ where: { organizationId: tenant.org.id, name: 'CORE-PROPOSAL' } })).toBe(1);
  });

  it('creates a notification for a mentioned member only', async () => {
    const tenant = await createTenant('mention');
    const session = await login(tenant.admin.email);
    const response = await app.inject({ method: 'POST', url: '/api/comments', headers: authHeaders(session.accessToken, tenant.org.id), payload: { targetType: 'DEVICE', targetId: tenant.deviceFr.id, body: `À vérifier avec @${tenant.editor.email.split('@')[0]}` } });
    expect(response.statusCode).toBe(201);
    const notifications = await prisma.userNotification.findMany({ where: { organizationId: tenant.org.id, userId: tenant.editor.id } });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('MENTION');
  });
});
