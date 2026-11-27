// Canonical JSON (keys sorted by code unit, no whitespace) and SHA-256 fingerprints (PRD §5f, AC-f3).
import { createHash } from 'node:crypto';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export class CanonicalError extends Error {}

export function canonicalJson(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || !Number.isInteger(v)) throw new CanonicalError(`not an integer: ${v}`);
    return JSON.stringify(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x)).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Object.getPrototypeOf(o) !== Object.prototype && Object.getPrototypeOf(o) !== null) {
      throw new CanonicalError('not a plain object');
    }
    const keys = Object.keys(o).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
  }
  throw new CanonicalError(`not JSON: ${typeof v}`);
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function fingerprint(v: unknown): string {
  return sha256Hex(canonicalJson(v));
}
