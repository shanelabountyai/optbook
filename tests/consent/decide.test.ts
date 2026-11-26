import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { REASON_ORDER, decide, type DecisionInput } from '../../src/lib/consent/decide';
import type { ConsentEvent } from '../../src/lib/consent/schema';
import { CONFIG, decisionCase, loadGolden } from './helpers/golden';
import { naiveDecide } from './oracle/naive-decide';
import { ORACLE_CASES, SEED, genInputs, prng } from './oracle/generator';

const cases = loadGolden('decisions').cases;
const inputs = genInputs();

describe('decide: golden (AC-b1)', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(decide(c.input, CONFIG)).toStrictEqual(c.expected);
  });
  it('WE-01 before any rule-set version: NO_RULE_SET_IN_FORCE alone, rule_set null', () => {
    const d = decide({ ...decisionCase('WE-01').input, at: '2025-12-31T23:59:59Z' }, CONFIG);
    expect(d).toEqual({ outcome: 'deny', reasons: [{ code: 'NO_RULE_SET_IN_FORCE', detail: {} }], rule_set: null, basis: { lawful_basis: null, opt_in_event_id: null, confirm_event_id: null } });
  });
  it('REASON_ORDER is the closed set of PRD §5b.1, in order', () => {
    expect(REASON_ORDER).toEqual(['NO_RULE_SET_IN_FORCE', 'ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE', 'GLOBAL_UNSUBSCRIBE', 'CHANNEL_OPT_OUT', 'PURPOSE_OPT_OUT', 'NO_CONSENT', 'PENDING_DOUBLE_OPT_IN', 'TIMEZONE_UNKNOWN', 'QUIET_HOURS', 'FREQUENCY_CAP', 'TRANSACTIONAL_EXEMPTION']);
  });
});

describe('decide: oracle (AC-b6)', () => {
  it(`agrees with the naive implementation on ${ORACLE_CASES} seeded cases, and every reason code occurs`, () => {
    const outcomes: Record<string, number> = {};
    const reasons: Record<string, number> = Object.fromEntries(REASON_ORDER.map((c) => [c, 0]));
    const diffs: string[] = [];
    for (const [n, input] of inputs.entries()) {
      const a = decide(input, CONFIG);
      const b = naiveDecide(input as never, CONFIG as never);
      if (!isDeepStrictEqual(a, b)) diffs.push(`#${n}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      outcomes[a.outcome] = (outcomes[a.outcome] ?? 0) + 1;
      for (const r of a.reasons) reasons[r.code]! += 1;
    }
    console.log(`oracle: ${inputs.length - diffs.length}/${inputs.length} agree; outcomes ${JSON.stringify(outcomes)}; reasons ${JSON.stringify(reasons)}`);
    expect(diffs.slice(0, 3)).toEqual([]);
    expect(inputs.length).toBe(2000);
    for (const c of REASON_ORDER) expect(reasons[c], c).toBeGreaterThan(0);
  });
});

const restrictive = (input: DecisionInput, r: ReturnType<typeof prng>): ConsentEvent => {
  const base = { event_id: 'zz-added', occurred_at: input.at, recorded_at: input.at, source: 'prop', evidence_ref: null, verified_channel: null, actor: { kind: 'contact' as const } };
  const ch = input.message.channel;
  switch (r.int(5)) {
    case 0:
      return { ...base, type: 'OPT_OUT', channel: ch, purpose: null, method: 'preference_center' };
    case 1:
      return { ...base, type: 'OPT_OUT', channel: r.pick(['email', 'sms']), purpose: r.pick(['newsletter', 'product_updates', 'promotional']), method: 'preference_center' };
    case 2:
      return { ...base, type: 'GLOBAL_UNSUBSCRIBE', channel: null, purpose: null, method: 'preference_center' };
    case 3:
      return { ...base, type: 'SUPPRESSION_ADD', channel: ch, purpose: null, method: 'api', kind: r.pick(['hard_bounce', 'complaint'] as const) };
    default:
      return { ...base, type: 'ERASURE_REQUESTED', channel: null, purpose: null, method: 'api', actor: { kind: 'user' } };
  }
};

describe('decide: properties', () => {
  it('AC-b3: shuffling events or recent_sends never changes the output', () => {
    const r = prng(SEED + 10);
    for (const input of inputs) {
      const d = decide(input, CONFIG);
      expect(decide({ ...input, events: r.shuffle(input.events), recent_sends: r.shuffle(input.recent_sends) }, CONFIG)).toEqual(d);
    }
  });
  it('AC-b4: adding one restrictive event at `at` never turns deny into allow', () => {
    const r = prng(SEED + 11);
    let denies = 0;
    for (const input of inputs) {
      if (decide(input, CONFIG).outcome !== 'deny') continue;
      denies += 1;
      expect(decide({ ...input, events: [...input.events, restrictive(input, r)] }, CONFIG).outcome).toBe('deny');
    }
    expect(denies).toBeGreaterThan(1000);
  });
  it('AC-b4 (strong form): adding a restrictive event to an allow never removes a deny reason that was present', () => {
    const r = prng(SEED + 12);
    for (const input of inputs) {
      const before = decide(input, CONFIG).reasons.map((x) => x.code).filter((c) => c !== 'TRANSACTIONAL_EXEMPTION' && c !== 'PENDING_DOUBLE_OPT_IN');
      const after = decide({ ...input, events: [...input.events, restrictive(input, r)] }, CONFIG);
      const codes = new Set<string>([...after.reasons.map((x) => x.code), ...((after.reasons.find((x) => x.code === 'TRANSACTIONAL_EXEMPTION')?.detail as { exempted?: string[] })?.exempted ?? [])]);
      for (const c of before) expect(codes.has(c), c).toBe(true);
    }
  });
  it('AC-b5: adding any event with recorded_at > at never changes the output', () => {
    const r = prng(SEED + 13);
    for (const input of inputs) {
      const d = decide(input, CONFIG);
      const extra = genInputs(1, SEED + r.int(100000))[0]!.events.map((e, i) => ({ ...e, event_id: `late-${i}`, recorded_at: '2027-01-01T00:00:00Z' }));
      expect(decide({ ...input, events: [...input.events, ...extra] }, CONFIG)).toEqual(d);
    }
  });
  it('a transactional message is never allowed when a never-exempt reason applies', () => {
    let seen = 0;
    for (const input of inputs) {
      const t = { ...input, message: { ...input.message, purpose: 'transactional' } };
      const d = decide(t, CONFIG);
      const exempted = (d.reasons.find((x) => x.code === 'TRANSACTIONAL_EXEMPTION')?.detail as { exempted?: string[] })?.exempted ?? [];
      for (const c of ['ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE']) expect(exempted).not.toContain(c);
      if (d.reasons.some((x) => ['ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE'].includes(x.code))) {
        seen += 1;
        expect(d.outcome).toBe('deny');
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
  it('reasons are always reported in REASON_ORDER with no duplicates', () => {
    for (const input of inputs) {
      const idx = decide(input, CONFIG).reasons.map((x) => REASON_ORDER.indexOf(x.code));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
      expect(new Set(idx).size).toBe(idx.length);
    }
  });
});
