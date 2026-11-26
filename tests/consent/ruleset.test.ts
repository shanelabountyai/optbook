import { describe, expect, it } from 'vitest';
import { selectRuleSet, validateConfig, validateFanoutPolicy } from '../../src/lib/consent/ruleset';
import { CONFIG, loadGolden } from './helpers/golden';

const raw = () => {
  const d = loadGolden('decisions');
  return structuredClone({ catalog: d.catalog, region_map: d.region_map, rule_sets: d.rule_sets });
};
const sel = (region: string | null, at: string) => {
  const s = selectRuleSet(CONFIG, region, at);
  return s.ok ? `${s.ruleSet.id} v${s.ruleSet.version}` : s.error;
};

describe('rule sets (PHASE-1-PLAN 1.6, AC-b7)', () => {
  it('the config in decisions.json validates', () => expect(validateConfig(raw()).ok).toBe(true));
  it('selects versions by effective_from and regions through the map', () => {
    expect(sel('R-NORTH', '2026-11-30T23:59:59Z')).toBe('RS-STRICT v1');
    expect(sel('R-NORTH', '2026-12-01T00:00:00Z')).toBe('RS-STRICT v2');
    expect(sel('R-SOUTH', '2026-12-05T00:00:00Z')).toBe('RS-BASELINE v1');
    expect(sel(null, '2026-11-20T15:00:00Z')).toBe('RS-STRICT v1');
    expect(sel('R-UNKNOWN', '2026-11-20T15:00:00Z')).toBe('RS-STRICT v1');
    expect(sel('constructor', '2026-11-20T15:00:00Z')).toBe('RS-STRICT v1');
    expect(sel('R-NORTH', '2025-12-31T23:59:59Z')).toBe('NO_RULE_SET_IN_FORCE');
  });
  it('refuses a never-exempt reason under transactional_exempt_from, with the field', () => {
    for (const r of ['ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE']) {
      const c = raw();
      c.rule_sets[0].transactional_exempt_from.email.push(r);
      expect(validateConfig(c)).toEqual({ ok: false, error: 'NEVER_EXEMPT_REASON', field: 'rule_sets[0].transactional_exempt_from.email' });
    }
  });
  it('refuses two versions of one id with the same effective_from', () => {
    const c = raw();
    c.rule_sets[1].effective_from = c.rule_sets[0].effective_from;
    expect(validateConfig(c)).toEqual({ ok: false, error: 'DUPLICATE_EFFECTIVE_FROM', field: 'rule_sets[1].effective_from' });
  });
  it('refuses an unknown channel or purpose, and start = end quiet hours', () => {
    let c = raw();
    c.rule_sets[2].quiet_hours.channels.push('push');
    expect(validateConfig(c)).toMatchObject({ ok: false, error: 'UNKNOWN_CHANNEL', field: 'rule_sets[2].quiet_hours.channels' });
    c = raw();
    c.rule_sets[0].lawful_basis.surveys = 'consent';
    expect(validateConfig(c)).toMatchObject({ ok: false, error: 'UNKNOWN_PURPOSE', field: 'rule_sets[0].lawful_basis.surveys' });
    c = raw();
    c.rule_sets[0].quiet_hours.end = c.rule_sets[0].quiet_hours.start;
    expect(validateConfig(c)).toMatchObject({ ok: false, field: 'rule_sets[0].quiet_hours.end' });
    c = raw();
    c.rule_sets[0].frequency.window_days = 3 / 2;
    expect(validateConfig(c)).toMatchObject({ ok: false, field: 'rule_sets[0].frequency.window_days' });
    c = raw();
    c.region_map.default = 'RS-NONE';
    expect(validateConfig(c)).toMatchObject({ ok: false, field: 'region_map.default' });
  });
  it('a fan-out policy needs max_attempts = backoff_seconds.length + 1', () => {
    const p = loadGolden('erasure').policy;
    expect(validateFanoutPolicy(p).ok).toBe(true);
    expect(validateFanoutPolicy({ ...p, max_attempts: 5 })).toMatchObject({ ok: false, field: 'max_attempts' });
  });
});
