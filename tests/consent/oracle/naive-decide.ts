/*
 * Naive oracle for the send-eligibility decision (PRD §5b), written independently
 * of src/lib/consent/ from PRD §4.2-4.5, §5a, §5b, §6, GOLDEN-DECISIONS.md rules
 * and DECISIONS.md D-008/009/011/012/013/016/031/032. Deliberately slow and literal:
 * every question re-scans the raw event list; no shared replay state; no imports.
 *
 * Judgment calls where the spec is silent or ambiguous:
 *  J1  "Standing" for a SUPPRESSION_ADD = an ADD of that channel+kind with no CLEAR of
 *      the same channel+kind with strictly later occurred_at. The detail event_id is
 *      the standing ADD with the latest occurred_at (tie rule). A CLEAR at the same
 *      second as an ADD does not clear it (restrictive wins ties, by analogy with D-009).
 *  J2  ERASURE_IN_PROGRESS detail = latest ERASURE_REQUESTED by the tie rule.
 *  J3  ERASED_SUPPRESSED detail: if an ERASURE_COMPLETED is known, {event_id} of the
 *      latest one (tie rule), even when tombstone_match is also true; if only the
 *      tombstone matched, {} (nothing in the ledger to point at; WE-29).
 *  J4  GLOBAL_UNSUBSCRIBE / CHANNEL_OPT_OUT / PURPOSE_OPT_OUT are evaluated for every
 *      purpose, including transactional (last_in never exists for a non-consentable
 *      purpose, so any restrictive event stands); exemption then removes listed ones.
 *  J5  Quiet hours: if the offset is missing and on_unknown_timezone is not "deny",
 *      neither TIMEZONE_UNKNOWN nor QUIET_HOURS is raised (local time is unknowable).
 *  J6  next_allowed_at = the first local instant equal to `end` strictly after local
 *      `at` (at is inside the window, so local != end); converted back with the same offset.
 *  J7  Contact frequency cap: latest FREQUENCY_SET on the message's channel (tie rule);
 *      a choice whose catalog value is null ("standard") or unknown gives no cap.
 *      Rule-set cap absent for the channel gives no rule-set cap. A send whose purpose
 *      is not in the catalog is not counted (not known to be marketing-class).
 *  J8  basis.confirm_event_id is not separately gated on lawful_basis = consent (the
 *      GOLDEN rule only names allow + required channel + qualifying confirm). Since a
 *      qualifying confirm needs a last_in, it can be filled under notice_and_opt_out
 *      when an opt-in and a confirm exist and the outcome is allow.
 *  J9  The confirm event for basis is the latest qualifying OPT_IN_CONFIRM (tie rule),
 *      whether purpose-specific or purpose-null; it is reported even when last_in was
 *      also self-confirming.
 *  J10 Facts: latest FACT_SET for that `fact` name by the tie rule; a region value not
 *      in region_map.map uses the default. lawful_basis missing for the purpose -> null.
 *  J11 Rule-set version: among versions of the selected id with effective_from <= at,
 *      latest effective_from; equal effective_from (refused at load per AC-b7) would
 *      fall back to the higher version number.
 *  J12 Timestamps are compared as epoch seconds computed with an integer civil-date
 *      algorithm, never as strings.
 */

type Ev = {
  event_id: string; type: string; channel: string | null; purpose: string | null;
  occurred_at: string; recorded_at: string; method: string;
  verified_channel: string | null; kind?: string; choice?: string; fact?: string;
  value?: string | number;
};
type Send = { channel: string; purpose: string; sent_at: string };
type Input = {
  at: string; message: { channel: string; purpose: string };
  events: Ev[]; recent_sends: Send[]; tombstone_match: boolean;
};
type RuleSet = {
  id: string; version: number; effective_from: string;
  lawful_basis: Record<string, string>;
  double_opt_in: { required_channels: string[]; self_confirming_methods: string[] };
  quiet_hours: { channels: string[]; start: string; end: string; on_unknown_timezone: string };
  frequency: { window_days: number; max_marketing_sends: Record<string, number> };
  transactional_exempt_from: Record<string, string[]>;
};
type Config = {
  catalog: {
    purposes: Record<string, { class: string }>;
    frequency_choices: Record<string, { max: number; window_days: number } | null>;
  };
  region_map: { map: Record<string, string>; default: string };
  rule_sets: RuleSet[];
};
type Reason = { code: string; detail: Record<string, unknown> };
type Decision = {
  outcome: 'allow' | 'deny'; reasons: Reason[];
  rule_set: { id: string; version: number } | null;
  basis: { lawful_basis: string | null; opt_in_event_id: string | null; confirm_event_id: string | null };
};

const NEVER_EXEMPT = ['ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE'];

// --- integer time ---
function num(s: string, a: number, b: number): number {
  let n = 0;
  for (let i = a; i < b; i++) n = n * 10 + (s.charCodeAt(i) - 48);
  return n;
}
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m > 2 ? m - 3 : m + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function toSec(ts: string): number {
  const days = daysFromCivil(num(ts, 0, 4), num(ts, 5, 7), num(ts, 8, 10));
  return days * 86400 + num(ts, 11, 13) * 3600 + num(ts, 14, 16) * 60 + num(ts, 17, 19);
}
function pad(n: number, w: number): string {
  let s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}
function fromSec(t: number): string {
  const days = Math.floor(t / 86400);
  const sod = t - days * 86400;
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return pad(y, 4) + '-' + pad(m, 2) + '-' + pad(d, 2) + 'T' + pad(Math.floor(sod / 3600), 2) + ':' +
    pad(Math.floor((sod % 3600) / 60), 2) + ':' + pad(sod % 60, 2) + 'Z';
}
function hhmm(s: string): number {
  return num(s, 0, 2) * 3600 + num(s, 3, 5) * 60;
}

// --- event helpers (each call rescans) ---
/** true if a is "later" than b by the tie rule: occurred_at, then recorded_at, then event_id */
function later(a: Ev, b: Ev): boolean {
  const ao = toSec(a.occurred_at), bo = toSec(b.occurred_at);
  if (ao !== bo) return ao > bo;
  const ar = toSec(a.recorded_at), br = toSec(b.recorded_at);
  if (ar !== br) return ar > br;
  return a.event_id > b.event_id;
}
function latest(list: Ev[]): Ev | null {
  let best: Ev | null = null;
  for (const e of list) if (best === null || later(e, best)) best = e;
  return best;
}
function known(input: Input): Ev[] {
  const at = toSec(input.at);
  const out: Ev[] = [];
  for (const e of input.events) if (toSec(e.recorded_at) <= at) out.push(e);
  return out;
}
function lastIn(input: Input, c: string, p: string): Ev | null {
  const l: Ev[] = [];
  for (const e of known(input)) if (e.type === 'OPT_IN' && e.channel === c && e.purpose === p) l.push(e);
  return latest(l);
}
/** latest standing restrictive event of a scope; scope: 'global' | 'channel' | 'purpose' */
function standing(input: Input, c: string, p: string, scope: string): Ev | null {
  const li = lastIn(input, c, p);
  const l: Ev[] = [];
  for (const e of known(input)) {
    let match = false;
    if (scope === 'global') match = e.type === 'GLOBAL_UNSUBSCRIBE';
    if (scope === 'channel') match = e.type === 'OPT_OUT' && e.channel === c && e.purpose === null;
    if (scope === 'purpose') match = e.type === 'OPT_OUT' && e.channel === c && e.purpose === p;
    if (!match) continue;
    if (li === null || toSec(e.occurred_at) >= toSec(li.occurred_at)) l.push(e);
  }
  return latest(l);
}
function qualifyingConfirm(input: Input, c: string, p: string): Ev | null {
  const li = lastIn(input, c, p);
  if (li === null) return null;
  const l: Ev[] = [];
  for (const e of known(input)) {
    if (e.type !== 'OPT_IN_CONFIRM' || e.channel !== c) continue;
    if (e.purpose !== null && e.purpose !== p) continue;
    if (toSec(e.occurred_at) >= toSec(li.occurred_at) && toSec(e.recorded_at) >= toSec(li.recorded_at)) l.push(e);
  }
  return latest(l);
}
function isConfirmed(input: Input, c: string, p: string, rs: RuleSet): boolean {
  const li = lastIn(input, c, p);
  if (li === null) return false;
  if (rs.double_opt_in.self_confirming_methods.indexOf(li.method) >= 0 && li.verified_channel === c) return true;
  return qualifyingConfirm(input, c, p) !== null;
}
function suppression(input: Input, c: string, kind: string): Ev | null {
  const ks = known(input);
  const l: Ev[] = [];
  for (const a of ks) {
    if (a.type !== 'SUPPRESSION_ADD' || a.channel !== c || a.kind !== kind) continue;
    let cleared = false;
    for (const x of ks) {
      if (x.type === 'SUPPRESSION_CLEAR' && x.channel === c && x.kind === kind &&
        toSec(x.occurred_at) > toSec(a.occurred_at)) cleared = true;
    }
    if (!cleared) l.push(a);
  }
  return latest(l);
}
function ofType(input: Input, t: string): Ev | null {
  const l: Ev[] = [];
  for (const e of known(input)) if (e.type === t) l.push(e);
  return latest(l);
}
function fact(input: Input, name: string): Ev | null {
  const l: Ev[] = [];
  for (const e of known(input)) if (e.type === 'FACT_SET' && e.fact === name) l.push(e);
  return latest(l);
}
function freqChoice(input: Input, c: string): Ev | null {
  const l: Ev[] = [];
  for (const e of known(input)) if (e.type === 'FREQUENCY_SET' && e.channel === c) l.push(e);
  return latest(l);
}
function countSends(input: Input, config: Config, c: string, windowDays: number): number {
  const at = toSec(input.at);
  let n = 0;
  for (const s of input.recent_sends) {
    const pc = config.catalog.purposes[s.purpose];
    if (s.channel !== c || !pc || pc.class !== 'marketing') continue;
    const t = toSec(s.sent_at);
    if (at - windowDays * 86400 < t && t <= at) n++;
  }
  return n;
}
function ev(e: Ev): Record<string, unknown> {
  return { event_id: e.event_id };
}

export function naiveDecide(input: Input, config: Config): Decision {
  const c = input.message.channel, p = input.message.purpose, at = toSec(input.at);
  const regionEv = fact(input, 'region');
  const region = regionEv === null ? null : String(regionEv.value);
  const rsId = region !== null && config.region_map.map[region] !== undefined
    ? config.region_map.map[region] : config.region_map.default;
  let rs: RuleSet | null = null;
  for (const r of config.rule_sets) {
    if (r.id !== rsId || toSec(r.effective_from) > at) continue;
    if (rs === null || toSec(r.effective_from) > toSec(rs.effective_from) ||
      (toSec(r.effective_from) === toSec(rs.effective_from) && r.version > rs.version)) rs = r;
  }
  if (rs === null) {
    return {
      outcome: 'deny', reasons: [{ code: 'NO_RULE_SET_IN_FORCE', detail: {} }], rule_set: null,
      basis: { lawful_basis: null, opt_in_event_id: null, confirm_event_id: null },
    };
  }
  const basis = rs.lawful_basis[p] !== undefined ? rs.lawful_basis[p] : null;
  const reasons: Reason[] = [];

  // 1, 2 erasure
  const req = ofType(input, 'ERASURE_REQUESTED'), done = ofType(input, 'ERASURE_COMPLETED');
  if (req !== null && done === null) reasons.push({ code: 'ERASURE_IN_PROGRESS', detail: ev(req) });
  if (done !== null) reasons.push({ code: 'ERASED_SUPPRESSED', detail: ev(done) });
  else if (input.tombstone_match) reasons.push({ code: 'ERASED_SUPPRESSED', detail: {} });
  // 3, 4 suppressions
  const comp = suppression(input, c, 'complaint');
  if (comp !== null) reasons.push({ code: 'SUPPRESSED_COMPLAINT', detail: ev(comp) });
  const bounce = suppression(input, c, 'hard_bounce');
  if (bounce !== null) reasons.push({ code: 'SUPPRESSED_BOUNCE', detail: ev(bounce) });
  // 5-7 restrictive scopes
  const g = standing(input, c, p, 'global');
  if (g !== null) reasons.push({ code: 'GLOBAL_UNSUBSCRIBE', detail: ev(g) });
  const ch = standing(input, c, p, 'channel');
  if (ch !== null) reasons.push({ code: 'CHANNEL_OPT_OUT', detail: ev(ch) });
  const pu = standing(input, c, p, 'purpose');
  if (pu !== null) reasons.push({ code: 'PURPOSE_OPT_OUT', detail: ev(pu) });
  // 8, 9 consent
  const li = lastIn(input, c, p);
  if (basis === 'consent' && li === null) reasons.push({ code: 'NO_CONSENT', detail: {} });
  if (basis === 'consent' && li !== null && g === null && ch === null && pu === null &&
    rs.double_opt_in.required_channels.indexOf(c) >= 0 && !isConfirmed(input, c, p, rs)) {
    reasons.push({ code: 'PENDING_DOUBLE_OPT_IN', detail: ev(li) });
  }
  // 10, 11 quiet hours
  if (rs.quiet_hours.channels.indexOf(c) >= 0) {
    const offEv = fact(input, 'utc_offset_minutes');
    if (offEv === null) {
      if (rs.quiet_hours.on_unknown_timezone === 'deny') reasons.push({ code: 'TIMEZONE_UNKNOWN', detail: {} });
    } else {
      const off = Number(offEv.value) * 60;
      const local = at + off;
      const sod = ((local % 86400) + 86400) % 86400;
      const s = hhmm(rs.quiet_hours.start), e = hhmm(rs.quiet_hours.end);
      const inside = s > e ? (sod >= s || sod < e) : (s <= sod && sod < e);
      if (inside) {
        let next = local - sod + e;
        if (next <= local) next += 86400;
        reasons.push({ code: 'QUIET_HOURS', detail: { next_allowed_at: fromSec(next - off) } });
      }
    }
  }
  // 12 frequency
  const caps: Record<string, unknown>[] = [];
  const rmax = rs.frequency.max_marketing_sends[c];
  if (rmax !== undefined) {
    const n = countSends(input, config, c, rs.frequency.window_days);
    if (n >= rmax) caps.push({ cap_source: 'rule_set', max: rmax, window_days: rs.frequency.window_days, count: n });
  }
  const fc = freqChoice(input, c);
  const choice = fc !== null && fc.choice !== undefined ? config.catalog.frequency_choices[fc.choice] : null;
  if (choice) {
    const n = countSends(input, config, c, choice.window_days);
    if (n >= choice.max) caps.push({ cap_source: 'contact', max: choice.max, window_days: choice.window_days, count: n });
  }
  if (caps.length > 0) reasons.push({ code: 'FREQUENCY_CAP', detail: { caps } });

  // 13 transactional exemption
  let final = reasons;
  const pc = config.catalog.purposes[p];
  if (pc && pc.class === 'transactional') {
    const list = rs.transactional_exempt_from[c] || [];
    const kept: Reason[] = [], exempted: string[] = [];
    for (const r of reasons) {
      if (list.indexOf(r.code) >= 0 && NEVER_EXEMPT.indexOf(r.code) < 0) exempted.push(r.code);
      else kept.push(r);
    }
    if (exempted.length > 0) kept.push({ code: 'TRANSACTIONAL_EXEMPTION', detail: { exempted } });
    final = kept;
  }
  let deny = false;
  for (const r of final) if (r.code !== 'TRANSACTIONAL_EXEMPTION') deny = true;
  const allow = !deny;
  const conf = qualifyingConfirm(input, c, p);
  return {
    outcome: allow ? 'allow' : 'deny',
    reasons: final,
    rule_set: { id: rs.id, version: rs.version },
    basis: {
      lawful_basis: basis,
      opt_in_event_id: allow && basis === 'consent' && li !== null ? li.event_id : null,
      confirm_event_id: allow && rs.double_opt_in.required_channels.indexOf(c) >= 0 && conf !== null
        ? conf.event_id : null,
    },
  };
}
