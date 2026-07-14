import './tracing.js';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import staticPlugin from '@fastify/static';
import multipart from '@fastify/multipart';
import cookie from '@fastify/cookie';
import path from 'node:path';
import { config } from './config.js';
import { prisma } from './db/client.js';
import { handleError } from './utils/errors.js';
import { ensureUploadDir } from './services/upload.js';
import { observeRequest, renderHttpMetrics } from './services/metrics.js';
import { purgeExpiredOrganizations } from './services/tenantDeletion.js';
import authPlugin from './plugins/auth.js';
import authRoutes from './routes/auth.js';
import usersRoutes, { profileRoutes } from './routes/users.js';
import sitesRoutes from './routes/sites.js';
import diagramsRoutes from './routes/diagrams.js';
import devicesRoutes from './routes/devices.js';
import portsRoutes from './routes/ports.js';
import mediaRoutes from './routes/media.js';
import racksRoutes from './routes/racks.js';
import billingRoutes from './routes/billing.js';
import ssoRoutes from './routes/sso.js';
import ipamRoutes from './routes/ipam.js';
import dcimRoutes from './routes/dcim.js';
import discoveryRoutes from './routes/discovery.js';
import commentsRoutes from './routes/comments.js';
import collectorsRoutes, { collectorIngestRoutes } from './routes/collectors.js';
import alertsRoutes from './routes/alerts.js';
import reportsRoutes, { processDueReportSchedules } from './routes/reports.js';
import securityRoutes from './routes/security.js';
import integrationsRoutes from './routes/integrations.js';
import publicApiRoutes, { publicApiDocsRoutes } from './routes/publicApi.js';
import monitoringRoutes from './routes/monitoring.js';
import sourceOfTruthRoutes from './routes/sourceOfTruth.js';
import notificationRoutes from './routes/notifications.js';

async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // API tests share one PostgreSQL schema and create many short-lived
      // servers. Suppressing request logs there keeps CI readable without
      // weakening development or production observability.
      level: config.nodeEnv === 'test' ? 'silent' : config.isProd ? 'info' : 'debug',
      transport:
        config.isProd || config.nodeEnv === 'test'
          ? undefined
          : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    },
    bodyLimit: config.upload.maxBytes * 2,
      trustProxy: config.trustProxy, // Ensure req.ip is correct behind a reverse proxy.
  });

  // ─── Rate limiting global ────────────────────────────────
  await app.register(rateLimit, {
    max: config.rateLimit.apiMax,
    timeWindow: config.rateLimit.apiWindow,
    // Authentication routes have a stricter limit defined below.
    keyGenerator: (req) => {
      // Use the identified user when available, otherwise the IP (anonymous abuse protection).
      return req.headers.authorization
        ? `user:${(req.user as any)?.sub ?? req.ip}`
        : `ip:${req.ip}`;
    },
  });

  // ─── Plugins globaux ─────────────────────────────────────
  await app.register(cors, {
    origin: config.cors.origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);

  await app.register(multipart, {
    limits: { fileSize: config.upload.maxBytes },
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (config.isProd && !req.url.startsWith('/api/media/file/')) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
      );
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  // ─── JWT access (refresh is handled directly through jsonwebtoken) ─
  await app.register(jwt, {
    secret: config.jwt.accessSecret,
    sign: { expiresIn: config.jwt.accessTtl },
  });

  await app.register(authPlugin);

  app.addHook('onResponse', async (req, reply) => {
    if (req.url !== '/metrics') observeRequest(req.method, reply.statusCode, reply.elapsedTime);
  });

  // ─── Health & readiness ──────────────────────────────────
  app.get('/health', async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
    } catch {
      return { status: 'degraded', database: 'unreachable' };
    }
  });

  app.get('/ready', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return reply.send({ status: 'ready' });
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  app.get('/metrics', async (req, reply) => {
    if (config.isProd && !config.metrics.token) {
      return reply.code(404).send({ error: true, message: 'Introuvable' });
    }
    if (config.metrics.token) {
      const header = req.headers.authorization ?? '';
      if (header !== `Bearer ${config.metrics.token}`) {
        return reply.code(401).send({ error: true, message: 'Non autorisé' });
      }
    }

    const memory = process.memoryUsage();
    let dbUp = 1;
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbUp = 0;
    }

    const lines = [
      '# HELP orbis_up Application health status.',
      '# TYPE orbis_up gauge',
      'orbis_up 1',
      '# HELP orbis_db_up Database connectivity status.',
      '# TYPE orbis_db_up gauge',
      `orbis_db_up ${dbUp}`,
      '# HELP orbis_process_uptime_seconds Node.js process uptime.',
      '# TYPE orbis_process_uptime_seconds gauge',
      `orbis_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      '# HELP orbis_process_memory_bytes Node.js process memory usage.',
      '# TYPE orbis_process_memory_bytes gauge',
      `orbis_process_memory_bytes{type="rss"} ${memory.rss}`,
      `orbis_process_memory_bytes{type="heapUsed"} ${memory.heapUsed}`,
      `orbis_process_memory_bytes{type="heapTotal"} ${memory.heapTotal}`,
      ...renderHttpMetrics(),
    ];

    return reply.type('text/plain; version=0.0.4').send(`${lines.join('\n')}\n`);
  });

  app.get('/api', async () => ({
    name: 'Orbis API',
    version: '1.0.0',
    docs: '/health',
  }));

  // ─── Routes ──────────────────────────────────────────────
  // Auth : rate limit strict (anti brute-force)
  await app.register(authRoutes, {
    prefix: '/api',
    config: {
      rateLimit: { max: config.rateLimit.authMax, timeWindow: config.rateLimit.authWindow },
    },
  });

  // Global profile (outside an organization).
  await app.register(profileRoutes, { prefix: '/api' });

  // Business routes (require x-organization-id).
  await app.register(usersRoutes, { prefix: '/api/users' });
  await app.register(sitesRoutes, { prefix: '/api/sites' });
  await app.register(diagramsRoutes, { prefix: '/api/diagrams' });
  await app.register(devicesRoutes, { prefix: '/api/devices' });
  await app.register(portsRoutes, { prefix: '/api' });
  await app.register(mediaRoutes, { prefix: '/api' });
  await app.register(racksRoutes, { prefix: '/api/racks' });
  await app.register(ipamRoutes, { prefix: '/api/ipam' });
  await app.register(dcimRoutes, { prefix: '/api/dcim' });
  await app.register(discoveryRoutes, { prefix: '/api/discovery' });
  await app.register(commentsRoutes, { prefix: '/api/comments' });
  await app.register(collectorsRoutes, { prefix: '/api/collectors' });
  await app.register(collectorIngestRoutes, { prefix: '/api/collector' });
  await app.register(alertsRoutes, { prefix: '/api/alerts' });
  await app.register(reportsRoutes, { prefix: '/api/reports' });
  await app.register(securityRoutes, { prefix: '/api/security' });
  await app.register(monitoringRoutes, { prefix: '/api/monitoring' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(ssoRoutes, { prefix: '/api/sso' });
  await app.register(integrationsRoutes, { prefix: '/api/integrations' });
  await app.register(publicApiRoutes, { prefix: '/api/public' });
  await app.register(publicApiDocsRoutes, { prefix: '/api/docs' });
  await app.register(sourceOfTruthRoutes, { prefix: '/api/source-of-truth' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });

  if (process.env.NODE_ENV !== 'test') {
    const timer = setInterval(() => {
      processDueReportSchedules(app.log).catch((error) =>
        app.log.error(error, 'Échec scheduler rapports'),
      );
    }, 60_000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));

    const tenantDeletionTimer = setInterval(
      () => {
        purgeExpiredOrganizations()
          .then((count) => {
            if (count > 0) app.log.info({ count }, 'tenants purged after deletion grace period');
          })
          .catch((error) => app.log.error(error, 'tenant deletion purge failed'));
      },
      60 * 60 * 1000,
    );
    tenantDeletionTimer.unref();
    app.addHook('onClose', async () => clearInterval(tenantDeletionTimer));
  }

  // ─── Servir les uploads en PROD uniquement via le build statique du frontend ──
  // NOTE : les uploads ne sont PLUS servis publiquement.
  // An authenticated GET /api/media/file/:path serves them after access checks.
  // In development, Vite proxies /uploads to the backend; keep static serving for local development.
  if (!config.isProd) {
    await app.register(staticPlugin, {
      root: path.resolve(process.cwd(), config.upload.dir),
      prefix: '/uploads/',
      decorateReply: false,
    });
  }

  // ─── Serve the built frontend in production ──────────────
  if (config.isProd) {
    const frontendDist = path.resolve(process.cwd(), 'public');
    try {
      await app.register(staticPlugin, {
        root: frontendDist,
        prefix: '/',
        wildcard: false,
      });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) {
          return reply.code(404).send({ error: true, message: 'Introuvable' });
        }
        return reply.sendFile('index.html');
      });
    } catch {
      app.log.warn('Dossier "public/" introuvable — frontend non servi par le backend');
    }
  }

  // ─── Global error handling ───────────────────────────────
  app.setErrorHandler((err, _req, reply) => {
    const error = err as { statusCode?: number; validation?: unknown };
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: true,
        statusCode: 429,
        message: 'Trop de requêtes. Réessayez dans un instant.',
      });
    }
    if (error.validation) {
      return reply
        .code(400)
        .send({
          error: true,
          statusCode: 400,
          message: 'Validation échouée',
          details: error.validation,
        });
    }
    return handleError(reply, err);
  });

  return app;
}

async function start() {
  try {
    await ensureUploadDir();
    const app = await buildServer();
    await app.listen({ port: config.port, host: config.host });
    app.log.info(`Orbis API demarree sur http://${config.host}:${config.port}`);
  } catch (err) {
    console.error('Échec au démarrage', err);
    process.exit(1);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  start();
}

export { buildServer, start };
