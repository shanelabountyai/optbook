// Identifier normalization and keyed tombstone hashes (PRD §5d, D-018, D-029).
// Identifiers never enter the ledger (L-2); this module only normalizes and hashes them for the caller.
import { createHmac } from 'node:crypto';

export type Normalized = { ok: true; value: string } | { ok: false; error: 'BAD_IDENTIFIER' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[1-9][0-9]{7,14}$/;

/** Trim and lowercase only; no provider-specific rewriting (D-029). */
export function normalizeEmail(raw: string): Normalized {
  const v = raw.trim().toLowerCase();
  return EMAIL.test(v) ? { ok: true, value: v } : { ok: false, error: 'BAD_IDENTIFIER' };
}

/** Removes spaces, hyphens, dots and parentheses; requires a `+` country prefix, 8 to 15 digits, never guessed. */
export function normalizePhone(raw: string): Normalized {
  const v = raw.trim().replace(/[\s\-.()]/g, '');
  return PHONE.test(v) ? { ok: true, value: v } : { ok: false, error: 'BAD_IDENTIFIER' };
}

export function normalizeIdentifier(channel: string, raw: string): Normalized {
  if (channel === 'email') return normalizeEmail(raw);
  if (channel === 'sms') return normalizePhone(raw);
  return { ok: false, error: 'BAD_IDENTIFIER' };
}

/** HMAC-SHA-256(key, channel + ":" + normalized), hex. */
export function identifierHash(key: string, channel: string, normalized: string): string {
  return createHmac('sha256', key).update(`${channel}:${normalized}`, 'utf8').digest('hex');
}
