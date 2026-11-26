import { describe, expect, it } from 'vitest';
import { checkAppend, knownAt, pairStatus, replay } from '../../src/lib/consent/ledger';
import { selectRuleSet } from '../../src/lib/consent/ruleset';
import type { ConsentEvent } from '../../src/lib/consent/schema';
import { CONFIG, loadGolden } from './helpers/golden';
import { SEED, genInputs, prng } from './oracle/generator';

const cases = loadGolden('decisions').cases;

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

describe('ledger replay (PHASE-1-PLAN 1.7, AC-a2, L-4)', () => {
  it('for each of the 35 cases, listed, reversed and 20 seeded shuffles replay to deeply equal state', () => {
    const r = prng(SEED);
    for (const c of cases) {
      const known = knownAt(c.input.events, c.input.at);
      const base = replay(known);
      expect(replay([...known].reverse()), c.id).toEqual(base);
      for (let i = 0; i < 20; i += 1) expect(replay(r.shuffle(known)), c.id).toEqual(base);
    }
  });
  it('replay determinism on 2,000 generated ledgers, 5 shuffles each', () => {
    const r = prng(SEED + 1);
    for (const input of genInputs()) {
      const base = replay(input.events);
      for (let i = 0; i < 5; i += 1) expect(replay(r.shuffle(input.events))).toEqual(base);
    }
  });
  it('pairStatus agrees with the expected reasons for every marketing-class case', () => {
    let n = 0;
    for (const c of cases) {
      const { channel, purpose } = c.input.message;
      if (CONFIG.catalog.purposes[purpose]?.class !== 'marketing') continue;
      const s = replay(knownAt(c.input.events, c.input.at));
      const fact = s.facts.region?.value as string | undefined;
      const sel = selectRuleSet(CONFIG, fact ?? null, c.input.at);
      if (!sel.ok) throw new Error('no rule set');
      const codes: string[] = c.expected.reasons.map((x: { code: string }) => x.code);
      const consentCodes = codes.filter((x) => ['GLOBAL_UNSUBSCRIBE', 'CHANNEL_OPT_OUT', 'PURPOSE_OPT_OUT', 'NO_CONSENT', 'PENDING_DOUBLE_OPT_IN'].includes(x));
      const want = consentCodes.length === 0 ? 'on' : consentCodes.length === 1 && consentCodes[0] === 'PENDING_DOUBLE_OPT_IN' ? 'pending' : 'off';
      expect(pairStatus(s, sel.ruleSet, channel, purpose), c.id).toBe(want);
      n += 1;
    }
    expect(n).toBeGreaterThanOrEqual(28);
  });
});

describe('append-only (L-1, L-5) and checkAppend (AC-a1)', () => {
  const e1 = cases[0]!.input.events as ConsentEvent[];
  it('refuses a duplicate event id and any event after ERASURE_COMPLETED', () => {
    expect(checkAppend(e1, { ...e1[2]! }, CONFIG.catalog)).toEqual({ ok: false, error: 'DUPLICATE_EVENT_ID' });
    const erased: ConsentEvent = { event_id: 'z1', type: 'ERASURE_COMPLETED', channel: null, purpose: null, occurred_at: '2026-11-25T00:00:00Z', recorded_at: '2026-11-25T00:00:00Z', source: 'erasure', method: 'system', evidence_ref: null, actor: { kind: 'system' }, verified_channel: null };
    expect(checkAppend([...e1, erased], { ...e1[2]!, event_id: 'z2' }, CONFIG.catalog)).toEqual({ ok: false, error: 'CONTACT_ERASED' });
    expect(checkAppend(e1, { ...e1[2]!, event_id: 'z3' }, CONFIG.catalog).ok).toBe(true);
  });
  it('no engine function mutates the ledger it is given (deep-frozen inputs, 2,000 generated ledgers)', () => {
    for (const input of genInputs(2000, SEED + 2)) {
      const frozen = deepFreeze(structuredClone(input.events));
      const before = JSON.stringify(frozen);
      replay(frozen);
      knownAt(frozen, input.at);
      checkAppend(frozen, frozen[0] ?? {}, CONFIG.catalog);
      expect(JSON.stringify(frozen)).toBe(before);
    }
  });
  it('appending an event only adds to the classified state: every event list of the smaller replay survives in the larger', () => {
    const r = prng(SEED + 3);
    const lists = (st: ReturnType<typeof replay>) =>
      [st.global_unsubscribes, ...[st.opt_ins, st.confirms, st.channel_opt_outs, st.purpose_opt_outs, st.suppression_adds, st.suppression_clears].flatMap((m) => Object.values(m))].flat().map((e) => e.event_id);
    let checked = 0;
    for (const input of genInputs(500, SEED + 3)) {
      if (!input.events.length) continue;
      const k = r.int(input.events.length);
      const smaller = lists(replay(input.events.filter((_, i) => i !== k)));
      const larger = new Set(lists(replay(input.events)));
      for (const id of smaller) expect(larger.has(id)).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(400);
  });
});
