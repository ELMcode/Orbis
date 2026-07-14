import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

function key(): Buffer {
  const value = config.integrations.encryptionKey;
  if (!value) throw new HttpError(503, 'Le coffre d’identifiants n’est pas configuré');
  const raw = Buffer.from(value, 'base64');
  if (raw.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY doit contenir 32 octets encodés en base64');
  return raw;
}

export function encryptCredential(value: Record<string, unknown>): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptCredential(value: string): Record<string, unknown> {
  const raw = Buffer.from(value, 'base64');
  if (raw.length < 29) throw new Error('Identifiant chiffré invalide');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}
