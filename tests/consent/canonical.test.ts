import { describe, expect, it } from 'vitest';
import { canonicalJson, fingerprint, sha256Hex } from '../../src/lib/consent/canonical';

describe('canonical JSON (PHASE-1-PLAN 1.4, AU-06, AC-f3)', () => {
  it('AU-06 known answer', () => {
    const s = canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 'é', y: -3 } });
    expect(s).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":-3,"z":"é"}}');
    expect(sha256Hex(s)).toBe('14a1892f6065261941f36fac5ca1109fd07e941f39ba553de2a189d9d0ea78bb');
  });
  it('sha256 of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('key order does not change the fingerprint; array order does', () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
  });
  it('refuses undefined, functions, non-finite and non-integer numbers', () => {
    for (const v of [undefined, { a: undefined }, () => 1, Number.NaN, Number.POSITIVE_INFINITY, 3 / 2, [1 / 3], new Map()]) expect(() => canonicalJson(v)).toThrow();
  });
});
