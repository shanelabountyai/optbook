// The send-eligibility decision (PRD §5b). Pure: "now" is `at`; every reason is evaluated; none short-circuits.
import { factValue, isConfirmed, knownAt, pairView, replay, suppressionInForce } from './ledger';
import { selectRuleSet } from './ruleset';
import {
  NEVER_EXEMPT,
  REASON_ORDER,
  isMarketing,
  type Config,
  type ConsentEvent,
  type LawfulBasis,
  type ReasonCode,
  type Send,
} from './schema';
import { SECONDS_PER_DAY, localSecondsOfDay, parseHm, toEpoch, fromEpoch } from './time';

export { REASON_ORDER };

export type Cap = { cap_source: 'rule_set' | 'contact'; max: number; window_days: number; count: number };
export type ReasonDetail =
  | Record<string, never>
  | { event_id: string }
  | { next_allowed_at: string }
  | { caps: Cap[] }
  | { exempted: ReasonCode[] };
export type Reason = { code: ReasonCode; detail: ReasonDetail };

export type DecisionInput = {
  at: string;
  message: { channel: string; purpose: string };
  events: readonly ConsentEvent[];
  recent_sends: readonly Send[];
  tombstone_match: boolean;
};

export type Decision = {
  outcome: 'allow' | 'deny';
  reasons: Reason[];
  rule_set: { id: string; version: number } | null;
  basis: { lawful_basis: LawfulBasis | null; opt_in_event_id: string | null; confirm_event_id: string | null };
};

/**
 * A message must name a catalog channel and a catalog purpose. There is no reason code for a malformed message
 * (D-047): callers check with this first, and `decide` treats a bad message as a programming error.
 */
export function checkMessage(message: { channel: string; purpose: string }, config: Config): 'UNKNOWN_CHANNEL' | 'UNKNOWN_PURPOSE' | null {
  if (!config.catalog.channels.includes(message.channel)) return 'UNKNOWN_CHANNEL';
  if (!Object.hasOwn(config.catalog.purposes, message.purpose)) return 'UNKNOWN_PURPOSE';
  return null;
}

const NULL_BASIS = { lawful_basis: null, opt_in_event_id: null, confirm_event_id: null };

/** PRD §5b. Only events known at `at` (recorded_at <= at) are used (D-008, AC-b5). */
export function decide(input: DecisionInput, config: Config): Decision {
  return evaluate({ ...input, events: knownAt(input.events, input.at) }, config);
}

/**
 * The decision over exactly the events given, with no knowledge gate. `decide` applies the gate; the hindsight view
 * (audit.ts) passes every event that had occurred by `at` instead.
 */
export function evaluate(input: DecisionInput, config: Config): Decision {
  const { at, message } = input;
  const { channel, purpose } = message;
  const bad = checkMessage(message, config);
  if (bad) throw new Error(`decide: ${bad}: callers check messages with checkMessage first (D-047)`);
  const s = replay(input.events);
  const sel = selectRuleSet(config, factValue(s, 'region'), at);
  if (!sel.ok) return { outcome: 'deny', reasons: [{ code: 'NO_RULE_SET_IN_FORCE', detail: {} }], rule_set: null, basis: NULL_BASIS };
  const rs = sel.ruleSet;
  const basis = rs.lawful_basis[purpose] ?? null;
  const found = new Map<ReasonCode, ReasonDetail>();
  const ev = (e: ConsentEvent) => ({ event_id: e.event_id });

  // 1, 2: erasure
  if (s.erasure.requested && !s.erasure.completed) found.set('ERASURE_IN_PROGRESS', ev(s.erasure.requested));
  if (s.erasure.completed) found.set('ERASED_SUPPRESSED', ev(s.erasure.completed));
  else if (input.tombstone_match) found.set('ERASED_SUPPRESSED', {});

  // 3, 4: suppressions on the channel
  const complaint = suppressionInForce(s, channel, 'complaint');
  if (complaint) found.set('SUPPRESSED_COMPLAINT', ev(complaint));
  const bounce = suppressionInForce(s, channel, 'hard_bounce');
  if (bounce) found.set('SUPPRESSED_BOUNCE', ev(bounce));

  // 5–9: standing restrictive events and consent
  const v = pairView(s, channel, purpose);
  if (v.global) found.set('GLOBAL_UNSUBSCRIBE', ev(v.global));
  if (v.channel) found.set('CHANNEL_OPT_OUT', ev(v.channel));
  if (v.purpose) found.set('PURPOSE_OPT_OUT', ev(v.purpose));
  const confirmationRequired = rs.double_opt_in.required_channels.includes(channel);
  if (basis === 'consent') {
    if (!v.last_in) found.set('NO_CONSENT', {});
    else if (!v.global && !v.channel && !v.purpose && confirmationRequired && !isConfirmed(v, rs, channel)) {
      found.set('PENDING_DOUBLE_OPT_IN', ev(v.last_in));
    }
  }

  // 10, 11: quiet hours (PRD §5b.2)
  if (rs.quiet_hours.channels.includes(channel)) {
    const offset = factValue(s, 'utc_offset_minutes');
    if (offset === null) {
      if (rs.quiet_hours.on_unknown_timezone === 'deny') found.set('TIMEZONE_UNKNOWN', {});
    } else {
      const start = parseHm(rs.quiet_hours.start)! * 60;
      const end = parseHm(rs.quiet_hours.end)! * 60;
      const local = localSecondsOfDay(at, offset);
      const inside = start > end ? local >= start || local < end : local >= start && local < end;
      if (inside) {
        const wait = local < end ? end - local : SECONDS_PER_DAY - local + end;
        found.set('QUIET_HOURS', { next_allowed_at: fromEpoch(toEpoch(at) + wait) });
      }
    }
  }

  // 12: frequency (PRD §5b.3, D-016)
  const caps: Cap[] = [];
  const count = (windowDays: number) => {
    const t = toEpoch(at);
    const w = windowDays * SECONDS_PER_DAY;
    return input.recent_sends.filter((x) => {
      const st = toEpoch(x.sent_at);
      return x.channel === channel && isMarketing(config.catalog, x.purpose) && t - w < st && st <= t;
    }).length;
  };
  const rsMax = rs.frequency.max_marketing_sends[channel];
  if (rsMax !== undefined) {
    const n = count(rs.frequency.window_days);
    if (n >= rsMax) caps.push({ cap_source: 'rule_set', max: rsMax, window_days: rs.frequency.window_days, count: n });
  }
  const choiceEvent = s.frequency[channel];
  const choice = choiceEvent ? config.catalog.frequency_choices[choiceEvent.choice!] : null;
  if (choice) {
    const n = count(choice.window_days);
    if (n >= choice.max) caps.push({ cap_source: 'contact', max: choice.max, window_days: choice.window_days, count: n });
  }
  if (caps.length) found.set('FREQUENCY_CAP', { caps });

  // 13: transactional exemptions (PRD §5b.5)
  let reasons: Reason[] = REASON_ORDER.filter((c) => found.has(c)).map((code) => ({ code, detail: found.get(code)! }));
  if (config.catalog.purposes[purpose]?.class === 'transactional') {
    const exemptable = (rs.transactional_exempt_from[channel] ?? []).filter((c) => !NEVER_EXEMPT.includes(c));
    const exempted = reasons.filter((r) => exemptable.includes(r.code)).map((r) => r.code);
    if (exempted.length) {
      reasons = reasons.filter((r) => !exempted.includes(r.code));
      reasons.push({ code: 'TRANSACTIONAL_EXEMPTION', detail: { exempted } });
    }
  }

  const outcome = reasons.some((r) => r.code !== 'TRANSACTIONAL_EXEMPTION') ? 'deny' : 'allow';
  const allow = outcome === 'allow';
  return {
    outcome,
    reasons,
    rule_set: { id: rs.id, version: rs.version },
    basis: {
      lawful_basis: basis,
      opt_in_event_id: allow && basis === 'consent' && v.last_in ? v.last_in.event_id : null,
      confirm_event_id: allow && confirmationRequired && v.confirm ? v.confirm.event_id : null,
    },
  };
}
