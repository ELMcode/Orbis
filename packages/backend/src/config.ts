import dotenv from 'dotenv';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';

if (isProd && process.env.SEED_ON_START === 'true') {
  throw new Error('[CONFIG] SEED_ON_START=true est interdit en production. Les données de démonstration ne doivent jamais être injectées au démarrage.');
}

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variable d'environnement manquante : ${key}`);
  }
  return value;
}

/**
 * JWT secret: production rejects missing, short (<32), or public placeholder
 * secrets. Development allows a fallback for convenience.
 */
function resolveJwtSecret(key: string, fallback: string): string {
  const value = process.env[key];
  if (!value) {
    if (isProd) {
      throw new Error(
        `[CONFIG] ${key} est requis en production. Générez un secret aléatoire d'au moins 32 caractères.`,
      );
    }
    return fallback;
  }
  if (value.length < 32) {
    if (isProd) {
      throw new Error(`[CONFIG] ${key} doit faire au moins 32 caractères (actuel: ${value.length}).`);
    }
    console.warn(`[CONFIG] ${key} est court (${value.length} chars) - insecure en prod.`);
  }
  const PLACEHOLDERS = [
    'dev-access-secret-change-me-please-32chars',
    'dev-refresh-secret-change-me-please-32chars',
    'change-me-access-secret-please-use-a-long-random-string',
    'change-me-refresh-secret-please-use-a-long-random-string',
  ];
  if (isProd && PLACEHOLDERS.includes(value)) {
    throw new Error(
      `[CONFIG] ${key} utilise un placeholder public connu. Générez un vrai secret aléatoire.`,
    );
  }
  return value;
}

/** Parse a comma-separated list with a fallback. */
function csvList(key: string, fallback: string[]): string[] {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
const corsOrigins = isProd
  ? csvList('CORS_ORIGINS', [appUrl]).filter(Boolean)
  : csvList('CORS_ORIGINS', [appUrl, 'http://localhost:5173', 'http://127.0.0.1:5173']);

if (isProd && corsOrigins.length === 0) {
  throw new Error('[CONFIG] CORS_ORIGINS ou APP_URL est requis en production.');
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 4000),
  appUrl,

  databaseUrl: required('DATABASE_URL', 'postgresql://orbis:orbis@localhost:5432/orbis'),

  jwt: {
    accessSecret: resolveJwtSecret('JWT_ACCESS_SECRET', 'dev-access-secret-change-me-please-32chars'),
    refreshSecret: resolveJwtSecret('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me-please-32chars'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },

  upload: {
    dir: process.env.UPLOAD_DIR ?? './uploads',
    maxBytes: (Number(process.env.MAX_UPLOAD_MB ?? 20)) * 1024 * 1024,
  },

  email: {
    from: process.env.EMAIL_FROM ?? 'Orbis <noreply@orbis.local>',
    smtpHost: process.env.SMTP_HOST,
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpSecure: process.env.SMTP_SECURE === 'true',
    smtpUser: process.env.SMTP_USER,
    smtpPass: process.env.SMTP_PASS,
    resetTokenTtlMinutes: Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30),
  },

  cors: {
    origins: corsOrigins,
  },

  rateLimit: {
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 10), // per minute/IP
    authWindow: '1 minute',
    apiMax: Number(process.env.RATE_LIMIT_API_MAX ?? 300), // per minute/user
    apiWindow: '1 minute',
  },

  metrics: {
    token: process.env.METRICS_TOKEN,
  },

  tenant: {
    deletionGraceDays: Math.max(1, Number(process.env.TENANT_DELETION_GRACE_DAYS ?? 30)),
  },

  billing: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripePriceId: process.env.STRIPE_PRICE_ID,
    successUrl: process.env.STRIPE_SUCCESS_URL ?? `${process.env.APP_URL ?? 'http://localhost:5173'}/settings?billing=success`,
    cancelUrl: process.env.STRIPE_CANCEL_URL ?? `${process.env.APP_URL ?? 'http://localhost:5173'}/settings?billing=cancel`,
  },

  sso: {
    workosApiKey: process.env.WORKOS_API_KEY,
    workosClientId: process.env.WORKOS_CLIENT_ID,
    workosRedirectUri: process.env.WORKOS_REDIRECT_URI ?? `${process.env.APP_URL ?? 'http://localhost:5173'}/api/sso/workos/callback`,
  },

  integrations: {
    encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
    // In SaaS, prevent a webhook from reaching the platform's internal network.
    // Development and on-premise environments can explicitly allow internal targets.
    allowPrivateOutboundUrls: process.env.ALLOW_PRIVATE_OUTBOUND_URLS === 'true' || !isProd,
  },

  // Enable only behind a trusted reverse proxy. Otherwise a direct client can
  // forge X-Forwarded-* and bypass IP checks.
  trustProxy: process.env.TRUST_PROXY === 'true',
} as const;
