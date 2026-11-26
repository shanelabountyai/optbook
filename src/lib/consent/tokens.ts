// Stateless HMAC-signed tokens (PRD §5c, D-020): `v1.<payload>.<signature>`, both base64url.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from './canonical';
import { TokenPayloadSchema, type TokenPayload, type TokenScope } from './schema';
import { toEpoch } from './time';

export type TokenStatus = 'VALID' | 'EXPIRED' | 'NOT_YET_VALID' | 'BAD_SIGNATURE' | 'MALFORMED';
export type TokenAction = 'view' | 'edit' | 'unsubscribe' | 'confirm';
export type Verified = { status: TokenStatus; payload?: TokenPayload; allows: TokenAction[] };

export type TokenPolicy = { lifetime_seconds: Record<TokenScope, number> };

const ALLOWS_VALID: Record<TokenScope, TokenAction[]> = {
  preferences: ['view', 'edit', 'unsubscribe'],
  unsubscribe: ['unsubscribe'],
  confirm: ['confirm'],
};
/** An expired but correctly signed token honours an unsubscribe and nothing else (D-020). */
const ALLOWS_EXPIRED: Record<TokenScope, TokenAction[]> = {
  preferences: ['unsubscribe'],
  unsubscribe: ['unsubscribe'],
  confirm: [],
};

const b64url = (b: Buffer) => b.toString('base64url');

function sign(signingInput: string, key: string): string {
  return b64url(createHmac('sha256', key).update(signingInput, 'utf8').digest());
}

export function lifetimeFor(scope: TokenScope, policy: TokenPolicy): number {
  return policy.lifetime_seconds[scope];
}

export function issueToken(payload: TokenPayload, key: string): string {
  const body = b64url(Buffer.from(canonicalJson(payload), 'utf8'));
  const signingInput = `v1.${body}`;
  return `${signingInput}.${sign(signingInput, key)}`;
}

/** Constant-time comparison of two signature strings (AC-c2). Compares the text, so padding bits count. */
function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) {
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

/**
 * Verifies a token at `at` against a key map `{ kid: key }`. An unknown `kid` is reported as BAD_SIGNATURE, not
 * distinguished from a wrong key (TK-07).
 */
export function verifyToken(token: string, keys: Readonly<Record<string, string>>, at: string): Verified {
  const malformed: Verified = { status: 'MALFORMED', allows: [] };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return malformed;
  const [, body, sig] = parts as [string, string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return malformed;
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return malformed;
  }
  const kid = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).kid : undefined;
  const key = typeof kid === 'string' && Object.hasOwn(keys, kid) ? keys[kid] : undefined;
  if (key === undefined || !sameSignature(sig, sign(`v1.${body}`, key))) return { status: 'BAD_SIGNATURE', allows: [] };
  const parsed = TokenPayloadSchema.safeParse(raw);
  if (!parsed.success) return malformed;
  const payload = parsed.data;
  const t = toEpoch(at);
  if (t < payload.iat) return { status: 'NOT_YET_VALID', payload, allows: [] };
  if (t >= payload.exp) return { status: 'EXPIRED', payload, allows: [...ALLOWS_EXPIRED[payload.scope]] };
  return { status: 'VALID', payload, allows: [...ALLOWS_VALID[payload.scope]] };
}
