// Audit and proof (PRD §5f): a decision as known and in hindsight, the late-opt-out exposure report, and
// recomputation of a stored decision.
import { canonicalJson, fingerprint } from './canonical';
import { decide, evaluate, type Decision, type DecisionInput } from './decide';
import { compareEvents, knownAt, occurredBy } from './ledger';
import type { Config, ConsentEvent, Send } from './schema';
import { toEpoch } from './time';

export type Mode = 'as_known' | 'hindsight';
export type LateEvent = { event_id: string; occurred_at: string; recorded_at: string };

export type Trace = {
  mode: Mode;
  at: string;
  rule_set: Decision['rule_set'];
  /** The event behind each reason, where a reason points at one. */
  reasons: { code: string; event_id: string | null }[];
  basis: Decision['basis'];
  /** Events used by this view, by id, in ledger order. */
  used_event_ids: string[];
  /** Events that had occurred by `at` but were recorded after it: not yet known at `at`. */
  not_yet_known: string[];
};

function lateAt(events: readonly ConsentEvent[], at: string): ConsentEvent[] {
  const t = toEpoch(at);
  return [...events].filter((e) => toEpoch(e.occurred_at) <= t && toEpoch(e.recorded_at) > t).sort(compareEvents);
}

/**
 * "As known" uses events recorded by `at` and equals `decide`; "hindsight" uses every event that had occurred by
 * `at`, whenever it was recorded.
 */
export function explain(input: DecisionInput, config: Config, mode: Mode): { decision: Decision; trace: Trace } {
  const used = mode === 'as_known' ? knownAt(input.events, input.at) : occurredBy(input.events, input.at);
  const decision = mode === 'as_known' ? decide(input, config) : evaluate({ ...input, events: used }, config);
  return {
    decision,
    trace: {
      mode,
      at: input.at,
      rule_set: decision.rule_set,
      reasons: decision.reasons.map((r) => ({ code: r.code, event_id: 'event_id' in r.detail ? r.detail.event_id : null })),
      basis: decision.basis,
      used_event_ids: [...used].sort(compareEvents).map((e) => e.event_id),
      not_yet_known: lateAt(input.events, input.at).map((e) => e.event_id),
    },
  };
}

export type Exposure = { send: Send; hindsight_reasons: string[]; late_events: LateEvent[] };

/**
 * The late-opt-out report: sends allowed on what was known that would have been denied on what was true. Each send
 * is decided at its `sent_at` against the other sends strictly earlier (never against itself, D-037).
 */
export function exposure(events: readonly ConsentEvent[], sends: readonly Send[], config: Config): Exposure[] {
  const out: Exposure[] = [];
  const ordered = [...sends].sort((a, b) => toEpoch(a.sent_at) - toEpoch(b.sent_at));
  for (const send of ordered) {
    const prior = sends.filter((x) => toEpoch(x.sent_at) < toEpoch(send.sent_at));
    const input: DecisionInput = { at: send.sent_at, message: { channel: send.channel, purpose: send.purpose }, events, recent_sends: prior, tombstone_match: false };
    const known = decide(input, config);
    const hind = evaluate({ ...input, events: occurredBy(events, send.sent_at) }, config);
    if (known.outcome === 'allow' && hind.outcome === 'deny') {
      out.push({
        send,
        hindsight_reasons: hind.reasons.map((r) => r.code),
        late_events: lateAt(events, send.sent_at).map((e) => ({ event_id: e.event_id, occurred_at: e.occurred_at, recorded_at: e.recorded_at })),
      });
    }
  }
  return out;
}

export type ProofInputs = Omit<DecisionInput, 'events'>;
export type ProofRecord = { inputs: ProofInputs; fingerprint: string } & Decision;

/** SHA-256 of the canonical JSON of the full decision input, with events and sends in a fixed order. */
export function proofFingerprint(input: DecisionInput): string {
  const events = [...input.events].sort((a, b) => (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));
  const sends = [...input.recent_sends].sort((a, b) => {
    const x = canonicalJson(a);
    const y = canonicalJson(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return fingerprint({ at: input.at, message: input.message, events, recent_sends: sends, tombstone_match: input.tombstone_match });
}

/** What Phase 2 stores for every decision made for a mock send. */
export function makeProofRecord(input: DecisionInput, decision: Decision): ProofRecord {
  const inputs: ProofInputs = { at: input.at, message: input.message, recent_sends: input.recent_sends, tombstone_match: input.tombstone_match };
  return { inputs, fingerprint: proofFingerprint(input), ...decision };
}

const PROOF_FIELDS = ['outcome', 'reasons', 'rule_set', 'basis', 'fingerprint'] as const;

/** Recomputes a stored decision from its inputs and the ledger. */
export function verifyProof(record: ProofRecord, events: readonly ConsentEvent[], config: Config): 'MATCH' | { mismatch: string[] } {
  const input: DecisionInput = { ...record.inputs, events };
  const fresh = makeProofRecord(input, decide(input, config));
  const mismatch = PROOF_FIELDS.filter((f) => canonicalJson(fresh[f]) !== canonicalJson(record[f]));
  return mismatch.length ? { mismatch: [...mismatch] } : 'MATCH';
}
