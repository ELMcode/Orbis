import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { config } from '../config.js';
import { HttpError } from '../utils/errors.js';

const BLOCKED_RANGES = new Set([
  'unspecified',
  'broadcast',
  'multicast',
  'linkLocal',
  'loopback',
  'private',
  'uniqueLocal',
  'carrierGradeNat',
  'reserved',
]);

/** Validates an outbound HTTP target and prevents private-network SSRF in SaaS mode. */
export async function assertSafeOutboundUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'URL sortante invalide');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new HttpError(400, 'Seules les URL HTTP(S) sont autorisées');
  }
  if (url.username || url.password) {
    throw new HttpError(400, 'Les identifiants dans une URL sortante ne sont pas autorisés');
  }
  if (config.isProd && url.protocol !== 'https:') {
    throw new HttpError(400, 'Les URL sortantes doivent utiliser HTTPS en production');
  }
  if (config.integrations.allowPrivateOutboundUrls) return url;

  const addresses = await resolveAddresses(url.hostname);
  if (addresses.some(isPrivateOrReservedAddress)) {
    throw new HttpError(400, 'Les URL sortantes vers des réseaux privés ou réservés sont interdites');
  }
  return url;
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  if (ipaddr.isValid(hostname)) return [hostname];
  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    if (records.length === 0) throw new Error('empty DNS answer');
    return records.map((record) => record.address);
  } catch {
    throw new HttpError(400, 'Impossible de résoudre le nom de domaine de l’URL sortante');
  }
}

function isPrivateOrReservedAddress(address: string) {
  try {
    return BLOCKED_RANGES.has(ipaddr.process(address).range());
  } catch {
    return true;
  }
}
