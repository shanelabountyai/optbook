import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { identifierHash, normalizeEmail, normalizePhone } from '../../src/lib/consent/identity';
import { issueToken, lifetimeFor, verifyToken } from '../../src/lib/consent/tokens';
import { loadGolden, runIdentity, runTokens } from './helpers/golden';

const KEY = 'test-only-key-not-a-secret';

describe('identity: golden ID-01 to ID-04 (AC-d1)', () => {
  it.each(runIdentity().map((o) => [o.id, o] as const))('%s', (_id, o) => expect(o.ok, JSON.stringify(o.actual)).toBe(true));
  it('the same address with different case and padding hashes equally; dots are not stripped', () => {
    const a = normalizeEmail(' Ada@Example.com');
    const b = normalizeEmail('ada@example.COM  ');
    expect(a.ok && b.ok && identifierHash(KEY, 'email', a.value) === identifierHash(KEY, 'email', b.value)).toBe(true);
    const c = normalizeEmail('a.b@example.com');
    const d = normalizeEmail('ab@example.com');
    expect(c.ok && d.ok && identifierHash(KEY, 'email', c.value) !== identifierHash(KEY, 'email', d.value)).toBe(true);
    expect(normalizeEmail('ada+tag@example.com')).toEqual({ ok: true, value: 'ada+tag@example.com' });
  });
  it('phone numbers need a + prefix and 8 to 15 digits, first not zero', () => {
    expect(normalizePhone('+1.555.010.0199')).toEqual({ ok: true, value: '+15550100199' });
    expect(normalizePhone('+0555010019').ok).toBe(false);
    expect(normalizePhone('+1234567').ok).toBe(false);
    expect(normalizePhone('+1234567890123456').ok).toBe(false);
  });
});

describe('tokens: golden TK-01 to TK-09 (AC-c1)', () => {
  it.each(runTokens().map((o) => [o.id, o] as const))('%s', (_id, o) => expect(o.actual).toMatchObject(o.expected as object));
  it('TK-01 byte for byte', () => {
    const c = loadGolden('tokens').cases[0]!;
    expect(issueToken(c.input.payload, KEY)).toBe(c.expected.token);
  });
  it('an expired token never allows anything but unsubscribe; a preferences token allows view and edit while valid', () => {
    const p = { v: 1 as const, kid: 'k1', org: 'org_demo', cid: 'c_0001', scope: 'preferences' as const, ch: 'email', pur: null, mid: 'm_1', iat: 1795186800, exp: 1795186800 + 2592000 };
    const t = issueToken(p, KEY);
    expect(verifyToken(t, { k1: KEY }, '2026-11-20T15:00:00Z')).toMatchObject({ status: 'VALID', allows: ['view', 'edit', 'unsubscribe'] });
    expect(verifyToken(t, { k1: KEY }, '2026-12-20T15:00:00Z')).toMatchObject({ status: 'EXPIRED', allows: ['unsubscribe'] });
  });
  it('a correctly signed payload that fails the schema is MALFORMED; junk is MALFORMED', () => {
    const body = Buffer.from(JSON.stringify({ kid: 'k1', v: 2 })).toString('base64url');
    const sig = createHmac('sha256', KEY).update(`v1.${body}`).digest('base64url');
    expect(verifyToken(`v1.${body}.${sig}`, { k1: KEY }, '2026-11-20T15:00:00Z').status).toBe('MALFORMED');
    for (const t of ['', 'v2.a.b', 'v1..x', 'v1.@@@.x', 'v1.a.b.c']) expect(verifyToken(t, { k1: KEY }, '2026-11-20T15:00:00Z').status).toBe('MALFORMED');
  });
  it('lifetimes come from the policy (data)', () => {
    const policy = loadGolden('tokens').policy;
    expect(lifetimeFor('unsubscribe', policy)).toBe(400 * 86400);
    expect(lifetimeFor('confirm', policy)).toBe(7 * 86400);
  });
});
