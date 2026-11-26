// The consent ledger: knowledge gate, the tie rule, append checks and replay (PRD §5a, L-1 to L-5).
// State is derived, never stored (L-3). Nothing here takes a rule set: the rule set is applied when state is read.
import { validateEvent, type Catalog, type ConsentEvent, type EventError, type Result, type RuleSet, type SuppressionKind } from './schema';
import { toEpoch } from './time';

/** Events the ledger knew at `at`: `recorded_at <= at` (D-008). */
export function knownAt(events: readonly ConsentEvent[], at: string): ConsentEvent[] {
  const t = toEpoch(at);
  return events.filter((e) => toEpoch(e.recorded_at) <= t);
}

/** Events that had happened by `at`, whenever they were recorded (the hindsight view, PRD §5f). */
export function occurredBy(events: readonly ConsentEvent[], at: string): ConsentEvent[] {
  const t = toEpoch(at);
  return events.filter((e) => toEpoch(e.occurred_at) <= t);
}

/** The tie rule (PRD §5a step 1): later `occurred_at`, then later `recorded_at`, then greater `event_id`. */
export function compareEvents(a: ConsentEvent, b: ConsentEvent): number {
  return (
    toEpoch(a.occurred_at) - toEpoch(b.occurred_at) ||
    toEpoch(a.recorded_at) - toEpoch(b.recorded_at) ||
    (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0)
  );
}

export function latest(events: readonly ConsentEvent[]): ConsentEvent | null {
  let best: ConsentEvent | null = null;
  for (const e of events) if (!best || compareEvents(e, best) > 0) best = e;
  return best;
}

const sorted = (events: ConsentEvent[]) => [...events].sort(compareEvents);

/** Validates a candidate against the field rules and the existing ledger (AC-a1, L-5). */
export function checkAppend(existing: readonly ConsentEvent[], candidate: unknown, catalog: Catalog): Result<ConsentEvent, EventError> {
  const v = validateEvent(candidate, catalog);
  if (!v.ok) return v;
  if (existing.some((e) => e.event_id === v.value.event_id)) return { ok: false, error: 'DUPLICATE_EVENT_ID' };
  if (existing.some((e) => e.type === 'ERASURE_COMPLETED')) return { ok: false, error: 'CONTACT_ERASED' };
  return v;
}

/**
 * A contact's events, classified and sorted by the tie rule. Every field is a pure function of the event *set*, so a
 * replay of the same events in any order is deeply equal (L-4). The read functions below derive pair state from it.
 */
export type ContactState = {
  opt_ins: Record<string, ConsentEvent[]>; // key "channel|purpose"
  confirms: Record<string, ConsentEvent[]>; // key channel
  global_unsubscribes: ConsentEvent[];
  channel_opt_outs: Record<string, ConsentEvent[]>; // key channel
  purpose_opt_outs: Record<string, ConsentEvent[]>; // key "channel|purpose"
  suppression_adds: Record<string, ConsentEvent[]>; // key "channel|kind"
  suppression_clears: Record<string, ConsentEvent[]>; // key "channel|kind"
  frequency: Record<string, ConsentEvent | null>; // key channel: the latest FREQUENCY_SET
  facts: { region: ConsentEvent | null; utc_offset_minutes: ConsentEvent | null };
  erasure: { requested: ConsentEvent | null; completed: ConsentEvent | null };
};

const pairKey = (c: string, p: string) => `${c}|${p}`;

function push(m: Record<string, ConsentEvent[]>, k: string, e: ConsentEvent) {
  (m[k] ??= []).push(e);
}

export function replay(events: readonly ConsentEvent[]): ContactState {
  const s: ContactState = {
    opt_ins: {},
    confirms: {},
    global_unsubscribes: [],
    channel_opt_outs: {},
    purpose_opt_outs: {},
    suppression_adds: {},
    suppression_clears: {},
    frequency: {},
    facts: { region: null, utc_offset_minutes: null },
    erasure: { requested: null, completed: null },
  };
  const freq: Record<string, ConsentEvent[]> = {};
  const region: ConsentEvent[] = [];
  const offset: ConsentEvent[] = [];
  const requested: ConsentEvent[] = [];
  const completed: ConsentEvent[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'OPT_IN':
        push(s.opt_ins, pairKey(e.channel!, e.purpose!), e);
        break;
      case 'OPT_IN_CONFIRM':
        push(s.confirms, e.channel!, e);
        break;
      case 'OPT_OUT':
        if (e.purpose === null) push(s.channel_opt_outs, e.channel!, e);
        else push(s.purpose_opt_outs, pairKey(e.channel!, e.purpose), e);
        break;
      case 'GLOBAL_UNSUBSCRIBE':
        s.global_unsubscribes.push(e);
        break;
      case 'FREQUENCY_SET':
        push(freq, e.channel!, e);
        break;
      case 'SUPPRESSION_ADD':
        push(s.suppression_adds, pairKey(e.channel!, e.kind!), e);
        break;
      case 'SUPPRESSION_CLEAR':
        push(s.suppression_clears, pairKey(e.channel!, e.kind!), e);
        break;
      case 'ERASURE_REQUESTED':
        requested.push(e);
        break;
      case 'ERASURE_COMPLETED':
        completed.push(e);
        break;
      case 'FACT_SET':
        (e.fact === 'region' ? region : offset).push(e);
        break;
    }
  }
  for (const m of [s.opt_ins, s.confirms, s.channel_opt_outs, s.purpose_opt_outs, s.suppression_adds, s.suppression_clears]) {
    for (const k of Object.keys(m)) m[k] = sorted(m[k]!);
  }
  s.global_unsubscribes = sorted(s.global_unsubscribes);
  for (const [c, list] of Object.entries(freq)) s.frequency[c] = latest(list);
  s.facts = { region: latest(region), utc_offset_minutes: latest(offset) };
  s.erasure = { requested: latest(requested), completed: latest(completed) };
  return s;
}

export type PairView = {
  last_in: ConsentEvent | null;
  /** The latest standing event of each restrictive scope (PRD §5a steps 2–3), or null when none stands. */
  global: ConsentEvent | null;
  channel: ConsentEvent | null;
  purpose: ConsentEvent | null;
  /** The latest OPT_IN_CONFIRM that confirms `last_in` (PRD §5a step 4, D-032), or null. */
  confirm: ConsentEvent | null;
};

export function pairView(s: ContactState, channel: string, purpose: string): PairView {
  const lastIn = latest(s.opt_ins[pairKey(channel, purpose)] ?? []);
  const stands = (list: readonly ConsentEvent[]) =>
    latest(lastIn ? list.filter((e) => toEpoch(e.occurred_at) >= toEpoch(lastIn.occurred_at)) : list);
  const confirm = lastIn
    ? latest(
        (s.confirms[channel] ?? []).filter(
          (e) =>
            (e.purpose === null || e.purpose === purpose) &&
            toEpoch(e.occurred_at) >= toEpoch(lastIn.occurred_at) &&
            toEpoch(e.recorded_at) >= toEpoch(lastIn.recorded_at),
        ),
      )
    : null;
  return {
    last_in: lastIn,
    global: stands(s.global_unsubscribes),
    channel: stands(s.channel_opt_outs[channel] ?? []),
    purpose: stands(s.purpose_opt_outs[pairKey(channel, purpose)] ?? []),
    confirm,
  };
}

/** True when `last_in` is self-confirming under the rule set or a qualifying confirmation exists. */
export function isConfirmed(view: PairView, ruleSet: RuleSet, channel: string): boolean {
  if (!view.last_in) return false;
  const self = ruleSet.double_opt_in.self_confirming_methods.includes(view.last_in.method) && view.last_in.verified_channel === channel;
  return self || view.confirm !== null;
}

/** PRD §5a step 5: the latest ADD with no CLEAR of the same channel and kind strictly later, or null. */
export function suppressionInForce(s: ContactState, channel: string, kind: SuppressionKind): ConsentEvent | null {
  const clears = s.suppression_clears[pairKey(channel, kind)] ?? [];
  const inForce = (s.suppression_adds[pairKey(channel, kind)] ?? []).filter(
    (a) => !clears.some((c) => toEpoch(c.occurred_at) > toEpoch(a.occurred_at)),
  );
  return latest(inForce);
}

export function factValue<T extends 'region' | 'utc_offset_minutes'>(s: ContactState, fact: T): (T extends 'region' ? string : number) | null {
  const e = s.facts[fact];
  return e ? (e.value as T extends 'region' ? string : number) : null;
}

/**
 * on | pending | off for a pair under a rule set: on iff none of reasons 5 to 9 applies; pending iff
 * PENDING_DOUBLE_OPT_IN is the only one of them (PHASE-1-PLAN 1.7).
 */
export function pairStatus(s: ContactState, ruleSet: RuleSet, channel: string, purpose: string): 'on' | 'pending' | 'off' {
  const v = pairView(s, channel, purpose);
  if (v.global || v.channel || v.purpose) return 'off';
  if (ruleSet.lawful_basis[purpose] !== 'consent') return 'on';
  if (!v.last_in) return 'off';
  if (ruleSet.double_opt_in.required_channels.includes(channel) && !isConfirmed(v, ruleSet, channel)) return 'pending';
  return 'on';
}
