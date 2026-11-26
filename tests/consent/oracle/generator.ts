// Seeded generator of random decision inputs for the oracle comparison and the properties (PHASE-1-PLAN 1.8).
// Timestamps come from a small set so that ties are common; recorded_at is sometimes later than occurred_at.
import type { ConsentEvent, Send } from '../../../src/lib/consent/schema';
import type { DecisionInput } from '../../../src/lib/consent/decide';

export const SEED = 20261126;

/** mulberry32: a small integer PRNG. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % 1000000007;
  };
  const int = (n: number) => next() % n;
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (pctOf100: number) => int(100) < pctOf100;
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };
  return { int, pick, chance, shuffle };
}
export type Rng = ReturnType<typeof prng>;

const CHANNELS = ['email', 'sms'] as const;
const MARKETING = ['newsletter', 'product_updates', 'promotional'] as const;
const EVENT_TIMES = [
  '2025-11-01T00:00:00Z',
  '2026-03-01T10:00:00Z',
  '2026-03-01T10:05:00Z',
  '2026-06-10T09:00:00Z',
  '2026-08-01T12:00:00Z',
  '2026-11-18T09:00:00Z',
  '2026-11-20T13:30:00Z',
  '2026-11-20T15:00:00Z',
  '2026-11-21T08:00:00Z',
];
export const DECISION_TIMES = [
  '2025-12-31T23:59:59Z',
  '2026-11-20T13:30:00Z',
  '2026-11-20T14:00:00Z',
  '2026-11-20T15:00:00Z',
  '2026-11-21T03:00:00Z',
  '2026-11-21T03:30:00Z',
  '2026-12-02T15:00:00Z',
];
const SEND_TIMES = ['2026-11-13T15:00:00Z', '2026-11-14T16:00:00Z', '2026-11-17T09:00:00Z', '2026-11-19T09:00:00Z', '2026-11-20T13:00:00Z', '2026-11-28T09:00:00Z', '2026-11-30T09:00:00Z', '2026-12-01T09:00:00Z'];

export function genEvent(r: Rng, id: string, times = EVENT_TIMES): ConsentEvent {
  const occ = r.pick(times);
  const later = times.filter((t) => t >= occ);
  const rec = r.chance(75) ? occ : r.pick(later);
  const base = { event_id: id, occurred_at: occ, recorded_at: rec, source: 'gen', evidence_ref: null as string | null, verified_channel: null as string | null, actor: { kind: 'contact' as const } };
  const ch = r.pick(CHANNELS);
  const roll = r.int(100);
  if (roll < 28) {
    const method = r.pick(['form', 'preference_center', 'import'] as const);
    return { ...base, type: 'OPT_IN', channel: ch, purpose: r.pick(MARKETING), method, evidence_ref: `ev/${id}`, verified_channel: r.pick([null, 'email', 'sms']) };
  }
  if (roll < 44) return { ...base, type: 'OPT_IN_CONFIRM', channel: ch, purpose: r.chance(70) ? null : r.pick(MARKETING), method: r.pick(['double_opt_in_confirm', 'import'] as const) };
  if (roll < 58) return { ...base, type: 'OPT_OUT', channel: ch, purpose: r.chance(50) ? null : r.pick(MARKETING), method: 'preference_center' };
  if (roll < 64) return { ...base, type: 'GLOBAL_UNSUBSCRIBE', channel: null, purpose: null, method: 'preference_center' };
  if (roll < 70) return { ...base, type: 'FREQUENCY_SET', channel: ch, purpose: null, method: 'preference_center', choice: r.pick(['standard', 'weekly', 'monthly']) };
  if (roll < 78) return { ...base, type: 'SUPPRESSION_ADD', channel: ch, purpose: null, method: 'api', actor: { kind: 'system' }, kind: r.pick(['hard_bounce', 'complaint'] as const) };
  if (roll < 83) return { ...base, type: 'SUPPRESSION_CLEAR', channel: ch, purpose: null, method: 'api', actor: { kind: 'user' }, evidence_ref: `ev/${id}`, kind: 'hard_bounce' };
  if (roll < 87) return { ...base, type: 'ERASURE_REQUESTED', channel: null, purpose: null, method: 'api', actor: { kind: 'user' } };
  if (roll < 89) return { ...base, type: 'ERASURE_COMPLETED', channel: null, purpose: null, method: 'system', actor: { kind: 'system' } };
  if (roll < 95) return { ...base, type: 'FACT_SET', channel: null, purpose: null, method: 'api', actor: { kind: 'system' }, fact: 'region', value: r.pick(['R-NORTH', 'R-SOUTH', 'R-UNKNOWN']) };
  return { ...base, type: 'FACT_SET', channel: null, purpose: null, method: 'api', actor: { kind: 'system' }, fact: 'utc_offset_minutes', value: r.pick([-360, 60, 0, 330, -720, 840]) };
}

export function genInput(r: Rng, n: number): DecisionInput {
  const events: ConsentEvent[] = [];
  // Most contacts carry their two facts, as the worked examples do.
  if (r.chance(70)) events.push({ event_id: `g${n}-r`, type: 'FACT_SET', channel: null, purpose: null, occurred_at: '2026-01-05T00:00:00Z', recorded_at: '2026-01-05T00:00:00Z', source: 'gen', method: 'api', evidence_ref: null, actor: { kind: 'system' }, verified_channel: null, fact: 'region', value: r.pick(['R-NORTH', 'R-SOUTH']) });
  if (r.chance(75)) events.push({ event_id: `g${n}-o`, type: 'FACT_SET', channel: null, purpose: null, occurred_at: '2026-01-05T00:00:00Z', recorded_at: '2026-01-05T00:00:00Z', source: 'gen', method: 'api', evidence_ref: null, actor: { kind: 'system' }, verified_channel: null, fact: 'utc_offset_minutes', value: r.pick([-360, 60]) });
  const k = r.int(13);
  for (let i = 0; i < k; i += 1) events.push(genEvent(r, `g${n}-e${String(i).padStart(2, '0')}`));
  const sends: Send[] = [];
  const m = r.int(6);
  for (let i = 0; i < m; i += 1) sends.push({ channel: r.pick(CHANNELS), purpose: r.pick([...MARKETING, 'transactional']), sent_at: r.pick(SEND_TIMES) });
  const channel = r.pick(CHANNELS);
  const purpose = r.chance(20) ? 'transactional' : r.pick(MARKETING);
  return { at: r.pick(DECISION_TIMES), message: { channel, purpose }, events, recent_sends: sends, tombstone_match: r.chance(8) };
}

export const ORACLE_CASES = 2000;

export function genInputs(count = ORACLE_CASES, seed = SEED): DecisionInput[] {
  const r = prng(seed);
  return Array.from({ length: count }, (_, n) => genInput(r, n));
}
