import { createHash, randomBytes } from 'node:crypto';

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createPrefixedToken(prefix: string, bytes = 32): string {
  return `${prefix}_${createOpaqueToken(bytes)}`;
}
