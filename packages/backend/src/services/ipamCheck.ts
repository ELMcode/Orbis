/**
 * IPAM prefix overlap / containment detection.
 *
 * Uses `ipaddr.js` to compare IPv4 and IPv6 CIDR ranges numerically (BigInt),
 * which correctly handles both containment (a /24 inside a /16) and partial
 * overlaps (a /23 straddling the boundary of a /24).
 */
import ipaddr from 'ipaddr.js';

/** A CIDR that already exists in the target org+site+vrf scope. */
export interface ExistingPrefix {
  cidr: string;
  id?: string;
  name?: string | null;
}

/** How `newCidr` relates to an existing CIDR it overlaps. */
export type OverlapType = 'subnet' | 'supernet' | 'overlap';

export interface PrefixOverlap {
  cidr: string;
  type: OverlapType;
  id?: string;
  name?: string | null;
}

export interface PrefixOverlapResult {
  /** `true` when the new CIDR does not conflict with any existing CIDR. */
  isValid: boolean;
  /** Every existing CIDR that overlaps the new CIDR (empty when valid). */
  overlaps: PrefixOverlap[];
}

interface NumericRange {
  bits: number;
  start: bigint;
  end: bigint;
}

/** Parse a CIDR into a numeric [start, end] range, or null when invalid. */
function cidrRange(cidr: string): NumericRange | null {
  try {
    const [address, prefixText, ...rest] = cidr.trim().split('/');
    if (rest.length || !address || prefixText === undefined || !/^\d+$/.test(prefixText)) return null;
    const parsed = ipaddr.parse(address);
    const bytes = parsed.toByteArray();
    const bits = bytes.length * 8;
    const prefix = Number(prefixText);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
    const value = bytes.reduce((result, byte) => (result << 8n) | BigInt(byte), 0n);
    const hostBits = BigInt(bits - prefix);
    const mask = prefix === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << hostBits;
    const start = value & mask;
    return { bits, start, end: start | ((1n << hostBits) - 1n) };
  } catch {
    return null;
  }
}

/**
 * Classify the relationship between a new CIDR and a single existing CIDR.
 * Returns `null` when the two ranges do not overlap at all.
 */
export function classifyOverlap(newCidr: string, existingCidr: string): OverlapType | null {
  const a = cidrRange(newCidr);
  const b = cidrRange(existingCidr);
  if (!a || !b || a.bits !== b.bits) return null;
  // No overlap if one range ends before the other starts.
  if (a.end < b.start || b.end < a.start) return null;
  // `newCidr` is fully contained by the existing CIDR (new is a subnet).
  if (a.start >= b.start && a.end <= b.end) return 'subnet';
  // The existing CIDR is fully contained by `newCidr` (new is a supernet).
  if (b.start >= a.start && b.end <= a.end) return 'supernet';
  // Partial overlap (neither contains the other).
  return 'overlap';
}

/**
 * Check a candidate CIDR against a set of existing prefixes.
 *
 * @param newCidr The CIDR being created/updated.
 * @param existing CIDRs already present in the same org+site+vrf scope.
 * @returns `{ isValid, overlaps }` — `isValid` is `false` when any overlap
 *          (subnet, supernet or partial) is detected.
 */
export function checkPrefixOverlap(
  newCidr: string,
  existing: readonly ExistingPrefix[],
): PrefixOverlapResult {
  const overlaps: PrefixOverlap[] = [];
  for (const item of existing) {
    const type = classifyOverlap(newCidr, item.cidr);
    if (type) {
      overlaps.push({ cidr: item.cidr, type, id: item.id, name: item.name });
    }
  }
  return { isValid: overlaps.length === 0, overlaps };
}

/** Human-readable French label for an overlap type (used in API messages). */
export function overlapTypeLabel(type: OverlapType): string {
  switch (type) {
    case 'subnet':
      return 'sous-réseau';
    case 'supernet':
      return 'super-réseau';
    case 'overlap':
      return 'chevauchement';
  }
}

export default { checkPrefixOverlap, classifyOverlap, overlapTypeLabel };
