import { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { handleError } from '../utils/errors.js';
import { authenticatePublicApiKey, requirePublicScope } from '../services/publicApi.js';

const MAX_LIMIT = 200;

export default async function publicApiRoutes(app: FastifyInstance) {
  app.get('/v1/sites', async (req, reply) => {
    try {
      const context = await authenticatePublicApiKey(req.headers.authorization);
      requirePublicScope(context, 'read:inventory');
      const { limit, cursor } = pagination(req.query);
      const sites = await prisma.site.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          description: true,
          parentId: true,
          location: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return reply.send(page('sites', sites, limit));
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/v1/devices', async (req, reply) => {
    try {
      const context = await authenticatePublicApiKey(req.headers.authorization);
      requirePublicScope(context, 'read:inventory');
      const { limit, cursor } = pagination(req.query);
      const devices = await prisma.device.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          siteId: true,
          brand: true,
          model: true,
          serial: true,
          ip: true,
          mac: true,
          owner: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return reply.send(page('devices', devices, limit));
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/v1/ipam/prefixes', async (req, reply) => {
    try {
      const context = await authenticatePublicApiKey(req.headers.authorization);
      requirePublicScope(context, 'read:ipam');
      const { limit, cursor } = pagination(req.query);
      const prefixes = await prisma.ipPrefix.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          siteId: true,
          vlanId: true,
          vrfId: true,
          cidr: true,
          name: true,
          gateway: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return reply.send(page('prefixes', prefixes, limit));
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/v1/ipam/addresses', async (req, reply) => {
    try {
      const context = await authenticatePublicApiKey(req.headers.authorization);
      requirePublicScope(context, 'read:ipam');
      const { limit, cursor } = pagination(req.query);
      const addresses = await prisma.ipAddress.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          siteId: true,
          prefixId: true,
          deviceId: true,
          address: true,
          status: true,
          dnsName: true,
          interfaceLabel: true,
          reservedBy: true,
          reservationExpiresAt: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return reply.send(page('addresses', addresses, limit));
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get('/v1/events', async (req, reply) => {
    try {
      const context = await authenticatePublicApiKey(req.headers.authorization);
      requirePublicScope(context, 'read:events');
      const { limit, cursor } = pagination(req.query);
      const events = await prisma.discoveryEvent.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          collectorId: true,
          runId: true,
          siteId: true,
          deviceId: true,
          type: true,
          severity: true,
          title: true,
          message: true,
          meta: true,
          acknowledgedAt: true,
          createdAt: true,
        },
      });
      return reply.send(page('events', events, limit));
    } catch (err) {
      return handleError(reply, err);
    }
  });
}

export async function publicApiDocsRoutes(app: FastifyInstance) {
  app.get('/openapi.json', async () => openApiDocument());
  app.get('/', async (_req, reply) => {
    return reply.type('text/html').send(apiDocsHtml());
  });
}

function pagination(query: unknown) {
  const q = query as Record<string, string | undefined>;
  const parsed = Number.parseInt(q.limit ?? '100', 10);
  const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), MAX_LIMIT) : 100;
  const cursor = q.cursor || undefined;
  return { limit, cursor };
}

function page<T extends { id: string }>(key: string, rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    [key]: data,
    pagination: {
      limit,
      nextCursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

function openApiDocument() {
  const bearer = [{ bearerAuth: [] }];
  return {
    openapi: '3.0.3',
    info: {
      title: 'Orbis Public API',
      version: '1.0.0',
      description: 'API publique versionnée pour l’inventaire, l’IPAM et les événements opérationnels Orbis.',
    },
    servers: [{ url: '/api/public/v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'isk' },
      },
    },
    paths: {
      '/sites': { get: operation('Liste les sites', 'read:inventory', bearer) },
      '/devices': { get: operation('Liste les équipements', 'read:inventory', bearer) },
      '/ipam/prefixes': { get: operation('Liste les préfixes IPAM', 'read:ipam', bearer) },
      '/ipam/addresses': { get: operation('Liste les adresses IPAM', 'read:ipam', bearer) },
      '/events': { get: operation('Liste les événements de découverte', 'read:events', bearer) },
    },
  };
}

function operation(summary: string, scope: string, security: Array<Record<string, never[]>>) {
  return {
    summary,
    security,
    parameters: [
      { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 100 } },
      { name: 'cursor', in: 'query', schema: { type: 'string' } },
    ],
    responses: {
      '200': { description: 'Résultat paginé' },
      '401': { description: 'Clé API manquante, invalide ou expirée' },
      '403': { description: `Portée requise : ${scope}` },
    },
  };
}

function apiDocsHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Orbis API publique</title>
  <style>
    body{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f8fafc;color:#0f172a}
    main{max-width:980px;margin:0 auto;padding:48px 24px}
    h1{font-size:32px;margin:0 0 8px} h2{margin-top:32px}
    .panel{background:white;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-top:18px}
    code,pre{font-family:"SFMono-Regular",Consolas,monospace;background:#0f172a;color:#e2e8f0;border-radius:6px}
    code{padding:2px 6px} pre{padding:16px;overflow:auto}
    a{color:#2563eb}
    table{width:100%;border-collapse:collapse} td,th{border-bottom:1px solid #e2e8f0;padding:10px;text-align:left}
  </style>
</head>
<body>
<main>
  <h1>Orbis API publique</h1>
  <p>API versionnée pour connecter inventaire, IPAM et événements à vos outils internes.</p>
  <div class="panel">
    <h2>Authentification</h2>
    <p>Créez une clé dans <strong>Paramètres → Intégrations</strong>, puis envoyez-la en bearer token.</p>
    <pre>curl -H "Authorization: Bearer isk_xxx" https://votre-instance/api/public/v1/devices</pre>
  </div>
  <div class="panel">
    <h2>Endpoints</h2>
    <table>
      <tr><th>Endpoint</th><th>Scope</th></tr>
      <tr><td><code>GET /api/public/v1/sites</code></td><td><code>read:inventory</code></td></tr>
      <tr><td><code>GET /api/public/v1/devices</code></td><td><code>read:inventory</code></td></tr>
      <tr><td><code>GET /api/public/v1/ipam/prefixes</code></td><td><code>read:ipam</code></td></tr>
      <tr><td><code>GET /api/public/v1/ipam/addresses</code></td><td><code>read:ipam</code></td></tr>
      <tr><td><code>GET /api/public/v1/events</code></td><td><code>read:events</code></td></tr>
    </table>
    <p>Chaque liste accepte <code>limit</code> et <code>cursor</code>. Spécification complète : <a href="/api/docs/openapi.json">OpenAPI JSON</a>.</p>
  </div>
  <div class="panel">
    <h2>Webhooks sortants</h2>
    <p>Les livraisons sont signées avec <code>X-Orbis-Signature: sha256=...</code> via HMAC-SHA256 sur le corps JSON.</p>
  </div>
</main>
</body>
</html>`;
}
