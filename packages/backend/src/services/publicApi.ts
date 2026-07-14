import { prisma } from '../db/client.js';
import { HttpError } from '../utils/errors.js';
import { hashToken } from '../utils/token.js';

export const PUBLIC_API_SCOPES = [
  'read:inventory',
  'read:ipam',
  'read:events',
] as const;

export type PublicApiScope = typeof PUBLIC_API_SCOPES[number];

export interface PublicApiContext {
  organizationId: string;
  keyId: string;
  scopes: string[];
}

export async function authenticatePublicApiKey(authorization: string | undefined): Promise<PublicApiContext> {
  const token = parseBearer(authorization);
  if (!token || !token.startsWith('isk_')) {
    throw new HttpError(401, 'Clé API publique requise');
  }

  const tokenHash = hashToken(token);
  const apiKey = await prisma.publicApiKey.findUnique({
    where: { tokenHash },
    select: { id: true, organizationId: true, scopes: true, status: true, expiresAt: true },
  });
  if (!apiKey || apiKey.status !== 'ACTIVE') {
    throw new HttpError(401, 'Clé API invalide ou révoquée');
  }
  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
    throw new HttpError(401, 'Clé API expirée');
  }

  await prisma.publicApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return { organizationId: apiKey.organizationId, keyId: apiKey.id, scopes: apiKey.scopes };
}

export function requirePublicScope(context: PublicApiContext, scope: PublicApiScope) {
  if (!context.scopes.includes(scope)) {
    throw new HttpError(403, `Portée API manquante : ${scope}`);
  }
}

export function normalizeScopes(scopes: string[] | undefined): PublicApiScope[] {
  const requested = scopes && scopes.length > 0 ? scopes : [...PUBLIC_API_SCOPES];
  const unknown = requested.filter((scope) => !PUBLIC_API_SCOPES.includes(scope as PublicApiScope));
  if (unknown.length > 0) {
    throw new HttpError(400, `Portées API inconnues : ${unknown.join(', ')}`);
  }
  return [...new Set(requested)] as PublicApiScope[];
}

function parseBearer(header: string | undefined) {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}
