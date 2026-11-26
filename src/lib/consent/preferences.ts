// The preference center as functions (PRD §5c): the view, the submission → events diff, and one-click unsubscribe.
// Nothing here writes; it returns drafts for the caller to append.
import { knownAt, pairStatus, pairView, replay, factValue, type ContactState } from './ledger';
import { selectRuleSet } from './ruleset';
import { isConsentable, marketingPurposes, type Catalog, type Config, type ConsentEvent, type EventDraft, type RuleSet, type TokenPayload } from './schema';
import { verifyToken, type TokenStatus } from './tokens';

export type PairStatus = 'on' | 'pending' | 'off';
export type PreferenceView = {
  channels: Record<string, { offered: boolean; purposes: Record<string, PairStatus>; frequency: string }>;
  /** Transactional messages are shown as always on and cannot be toggled. */
  transactional: 'always_on';
  global_unsubscribe: boolean;
};

export type Submission = {
  purposes?: Record<string, Record<string, boolean>>;
  frequency?: Record<string, string>;
  global_unsubscribe?: boolean;
};

export type PreferenceError = 'PURPOSE_NOT_CONSENTABLE' | 'UNKNOWN_PURPOSE' | 'UNKNOWN_CHANNEL' | 'NO_IDENTIFIER' | 'BAD_FIELD:choice';

export const DEFAULT_FREQUENCY = 'standard';

function currentFrequency(s: ContactState, channel: string): string {
  return s.frequency[channel]?.choice ?? DEFAULT_FREQUENCY;
}

/** True when a global unsubscribe stands for every marketing pair on the given channels. */
function globalStandsEverywhere(s: ContactState, catalog: Catalog, channels: readonly string[]): boolean {
  return channels.every((c) => marketingPurposes(catalog).every((p) => pairView(s, c, p).global !== null));
}

export function preferenceView(s: ContactState, ruleSet: RuleSet, catalog: Catalog, identifierChannels: readonly string[]): PreferenceView {
  const channels: PreferenceView['channels'] = {};
  for (const c of catalog.channels) {
    const purposes: Record<string, PairStatus> = {};
    for (const p of marketingPurposes(catalog)) purposes[p] = pairStatus(s, ruleSet, c, p);
    channels[c] = { offered: identifierChannels.includes(c), purposes, frequency: currentFrequency(s, c) };
  }
  return { channels, transactional: 'always_on', global_unsubscribe: globalStandsEverywhere(s, catalog, catalog.channels) };
}

function draft(type: EventDraft['type'], channel: string | null, purpose: string | null, at: string, token: TokenPayload, method: EventDraft['method'], extra: Partial<EventDraft> = {}): EventDraft {
  return {
    type,
    channel,
    purpose,
    occurred_at: at,
    recorded_at: at,
    source: 'preference_center',
    method,
    evidence_ref: `token/${token.scope}/${token.mid}/${token.iat}`,
    actor: { kind: 'contact' },
    verified_channel: token.ch,
    ...extra,
  };
}

/**
 * PRD §5c rules 1–6. Returns only the drafts needed to get from the current state to the submitted one. A pair not
 * mentioned in the submission is left alone. All drafts share `occurred_at = recorded_at = at`.
 */
export function diffPreferences(args: {
  state: ContactState;
  ruleSet: RuleSet;
  catalog: Catalog;
  identifierChannels: readonly string[];
  submission: Submission;
  token: TokenPayload;
  at: string;
}): { ok: true; drafts: EventDraft[] } | { ok: false; error: PreferenceError } {
  const { state: s, ruleSet, catalog, identifierChannels, submission, token, at } = args;
  const purposeOrder = Object.keys(catalog.purposes);
  const keyed: { c: number; p: number; d: EventDraft }[] = [];

  for (const [c, pairs] of Object.entries(submission.purposes ?? {})) {
    if (!catalog.channels.includes(c)) return { ok: false, error: 'UNKNOWN_CHANNEL' };
    for (const p of Object.keys(pairs)) {
      if (!(p in catalog.purposes)) return { ok: false, error: 'UNKNOWN_PURPOSE' };
      if (!isConsentable(catalog, p)) return { ok: false, error: 'PURPOSE_NOT_CONSENTABLE' };
    }
  }
  for (const [c, choice] of Object.entries(submission.frequency ?? {})) {
    if (!catalog.channels.includes(c)) return { ok: false, error: 'UNKNOWN_CHANNEL' };
    if (!Object.hasOwn(catalog.frequency_choices, choice)) return { ok: false, error: 'BAD_FIELD:choice' };
  }

  for (const [c, pairs] of Object.entries(submission.purposes ?? {})) {
    for (const [p, want] of Object.entries(pairs)) {
      const status = pairStatus(s, ruleSet, c, p);
      let d: EventDraft | null = null;
      if (want && (status === 'off' || (status === 'pending' && token.ch === c))) d = draft('OPT_IN', c, p, at, token, 'preference_center');
      if (!want && status !== 'off') d = draft('OPT_OUT', c, p, at, token, 'preference_center');
      if (d) keyed.push({ c: catalog.channels.indexOf(c), p: purposeOrder.indexOf(p), d });
    }
  }
  for (const [c, choice] of Object.entries(submission.frequency ?? {})) {
    if (choice !== currentFrequency(s, c)) {
      keyed.push({ c: catalog.channels.indexOf(c), p: purposeOrder.length, d: draft('FREQUENCY_SET', c, null, at, token, 'preference_center', { choice }) });
    }
  }
  keyed.sort((a, b) => a.c - b.c || a.p - b.p);
  let drafts = keyed.map((k) => k.d);
  // rule 4 first: with the global box ticked every permissive change is dropped, so it cannot block the unsubscribe
  if (submission.global_unsubscribe) drafts = drafts.filter((d) => d.type !== 'OPT_IN');

  if (drafts.some((d) => d.channel !== null && !identifierChannels.includes(d.channel))) return { ok: false, error: 'NO_IDENTIFIER' };

  if (submission.global_unsubscribe) {
    if (!globalStandsEverywhere(s, catalog, catalog.channels)) drafts.unshift(draft('GLOBAL_UNSUBSCRIBE', null, null, at, token, 'preference_center'));
  }
  return { ok: true, drafts };
}

/**
 * One-click unsubscribe (`POST`). Scope comes from the rule set (D-021). Idempotent: nothing is emitted when the
 * contact is already opted out at that scope.
 */
export function oneClick(s: ContactState, ruleSet: RuleSet | null, catalog: Catalog, token: TokenPayload, at: string): EventDraft[] {
  const ch = token.ch;
  const marketing = marketingPurposes(catalog);
  // No rule set in force, or a purpose scope with no purpose on the token: the channel scope (an opt-out is never dropped).
  const configured = ruleSet?.one_click.scope ?? 'channel';
  const scope = configured === 'purpose' && !token.pur ? 'channel' : configured;
  if (scope === 'global') {
    return globalStandsEverywhere(s, catalog, catalog.channels) ? [] : [draft('GLOBAL_UNSUBSCRIBE', null, null, at, token, 'one_click')];
  }
  if (scope === 'purpose') {
    const v = pairView(s, ch, token.pur!);
    return v.global || v.channel || v.purpose ? [] : [draft('OPT_OUT', ch, token.pur!, at, token, 'one_click')];
  }
  const covered = marketing.every((p) => {
    const v = pairView(s, ch, p);
    return v.global !== null || v.channel !== null;
  });
  return covered ? [] : [draft('OPT_OUT', ch, null, at, token, 'one_click')];
}

/** Verify a token, then one-click. A token that does not allow `unsubscribe` emits nothing. */
export function oneClickFromToken(
  token: string,
  keys: Readonly<Record<string, string>>,
  events: readonly ConsentEvent[],
  config: Config,
  at: string,
): { status: TokenStatus; drafts: EventDraft[] } {
  const v = verifyToken(token, keys, at);
  if (!v.payload || !v.allows.includes('unsubscribe')) return { status: v.status, drafts: [] };
  const s = replay(knownAt(events, at));
  const sel = selectRuleSet(config, factValue(s, 'region'), at);
  return { status: v.status, drafts: oneClick(s, sel.ok ? sel.ruleSet : null, config.catalog, v.payload, at) };
}
