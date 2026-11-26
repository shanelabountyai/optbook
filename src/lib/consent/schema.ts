// Data shapes for the engines (PRD §4.2–§4.5) and append-time event validation (PRD §4.4, AC-a1, AC-a4).
import { z } from 'zod';
import { isTimestamp, toEpoch } from './time';

// ---- closed vocabularies ------------------------------------------------------------------------------------------

export const EVENT_TYPES = [
  'OPT_IN',
  'OPT_IN_CONFIRM',
  'OPT_OUT',
  'GLOBAL_UNSUBSCRIBE',
  'FREQUENCY_SET',
  'SUPPRESSION_ADD',
  'SUPPRESSION_CLEAR',
  'ERASURE_REQUESTED',
  'ERASURE_COMPLETED',
  'FACT_SET',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const METHODS = ['form', 'import', 'preference_center', 'api', 'double_opt_in_confirm', 'one_click', 'system'] as const;
export type Method = (typeof METHODS)[number];

export const ACTOR_KINDS = ['contact', 'user', 'system', 'import'] as const;
export const SUPPRESSION_KINDS = ['hard_bounce', 'complaint'] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];
export const FACTS = ['region', 'utc_offset_minutes'] as const;

/** PRD §5b.1: the closed set of reasons, in report order. The single source of that order. */
export const REASON_ORDER = [
  'NO_RULE_SET_IN_FORCE',
  'ERASURE_IN_PROGRESS',
  'ERASED_SUPPRESSED',
  'SUPPRESSED_COMPLAINT',
  'SUPPRESSED_BOUNCE',
  'GLOBAL_UNSUBSCRIBE',
  'CHANNEL_OPT_OUT',
  'PURPOSE_OPT_OUT',
  'NO_CONSENT',
  'PENDING_DOUBLE_OPT_IN',
  'TIMEZONE_UNKNOWN',
  'QUIET_HOURS',
  'FREQUENCY_CAP',
  'TRANSACTIONAL_EXEMPTION',
] as const;
export type ReasonCode = (typeof REASON_ORDER)[number];

/** PRD §5b.5: never exempted, whatever the rule-set data says (CLAUDE.md non-negotiable 7). */
export const NEVER_EXEMPT: readonly ReasonCode[] = ['ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE'];
/** Reasons a rule set may list as exemptible at all (NO_RULE_SET_IN_FORCE and TRANSACTIONAL_EXEMPTION never can be). */
export const EXEMPTIBLE: readonly ReasonCode[] = [
  'GLOBAL_UNSUBSCRIBE',
  'CHANNEL_OPT_OUT',
  'PURPOSE_OPT_OUT',
  'NO_CONSENT',
  'PENDING_DOUBLE_OPT_IN',
  'TIMEZONE_UNKNOWN',
  'QUIET_HOURS',
  'FREQUENCY_CAP',
];

// ---- config -------------------------------------------------------------------------------------------------------

const int = z.number().int();
const ts = z.string().refine(isTimestamp, 'BAD_TIMESTAMP');

export const CatalogSchema = z.object({
  channels: z.array(z.string().min(1)).min(1),
  purposes: z.record(z.string(), z.object({ class: z.enum(['marketing', 'transactional']) })),
  frequency_choices: z.record(z.string(), z.union([z.null(), z.object({ max: int.min(1), window_days: int.min(1) })])),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const RegionMapSchema = z.object({ map: z.record(z.string(), z.string()), default: z.string() });
export type RegionMap = z.infer<typeof RegionMapSchema>;

export const RuleSetSchema = z.object({
  id: z.string().min(1),
  version: int.min(1),
  effective_from: ts,
  label: z.string(),
  legal_review: z.boolean(),
  lawful_basis: z.record(z.string(), z.enum(['consent', 'notice_and_opt_out', 'contract'])),
  double_opt_in: z.object({ required_channels: z.array(z.string()), self_confirming_methods: z.array(z.enum(METHODS)) }),
  quiet_hours: z.object({
    channels: z.array(z.string()),
    start: z.string(),
    end: z.string(),
    on_unknown_timezone: z.enum(['deny', 'allow']),
  }),
  frequency: z.object({ window_days: int.min(1), max_marketing_sends: z.record(z.string(), int.min(0)) }),
  transactional_exempt_from: z.record(z.string(), z.array(z.enum(REASON_ORDER))),
  erasure: z.object({ sla_days: int.min(1) }),
  one_click: z.object({ scope: z.enum(['channel', 'purpose', 'global']) }),
});
export type RuleSet = z.infer<typeof RuleSetSchema>;
export type LawfulBasis = RuleSet['lawful_basis'][string];

export const ConfigSchema = z.object({ catalog: CatalogSchema, region_map: RegionMapSchema, rule_sets: z.array(RuleSetSchema).min(1) });
export type Config = z.infer<typeof ConfigSchema>;

export const FanoutPolicySchema = z.object({
  ack_timeout_seconds: int.min(1),
  backoff_seconds: z.array(int.min(1)).min(1),
  max_attempts: int.min(1),
  warn_days: int.min(0),
});
export type FanoutPolicy = z.infer<typeof FanoutPolicySchema>;

export const TOKEN_SCOPES = ['preferences', 'unsubscribe', 'confirm'] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const TokenPayloadSchema = z.object({
  v: z.literal(1),
  kid: z.string().min(1),
  org: z.string().min(1),
  cid: z.string().min(1),
  scope: z.enum(TOKEN_SCOPES),
  ch: z.string().min(1),
  pur: z.string().min(1).nullable().optional(),
  mid: z.string().min(1),
  iat: int.min(0),
  exp: int.min(0),
});
export type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export const SendSchema = z.object({ channel: z.string(), purpose: z.string(), sent_at: ts });
export type Send = z.infer<typeof SendSchema>;

// ---- events -------------------------------------------------------------------------------------------------------

export type Actor = { kind: (typeof ACTOR_KINDS)[number]; id?: string };

/** A ledger event. `contact_id` is optional here: the engines take one contact's events at a time (D-042). */
export type ConsentEvent = {
  event_id: string;
  contact_id?: string;
  type: EventType;
  channel: string | null;
  purpose: string | null;
  occurred_at: string;
  recorded_at: string;
  source: string;
  method: Method;
  evidence_ref: string | null;
  actor: Actor;
  verified_channel: string | null;
  kind?: SuppressionKind | null;
  choice?: string | null;
  fact?: (typeof FACTS)[number] | null;
  value?: string | number | null;
};

/** An event without its ids, as an engine proposes it; the caller assigns `event_id` and `contact_id`. */
export type EventDraft = Omit<ConsentEvent, 'event_id' | 'contact_id'>;

export type EventError =
  | 'UNKNOWN_CHANNEL'
  | 'UNKNOWN_PURPOSE'
  | 'PURPOSE_NOT_CONSENTABLE'
  | `MISSING_FIELD:${string}`
  | `BAD_FIELD:${string}`
  | 'BAD_TIMESTAMP'
  | 'OCCURRED_AFTER_RECORDED'
  | 'DUPLICATE_EVENT_ID'
  | 'METHOD_NOT_ALLOWED'
  | 'COMPLAINT_NOT_CLEARABLE'
  | 'CONTACT_ERASED';

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** L-2: an email address or an international phone number anywhere in a string field. */
export const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
export const PHONE_LIKE = /\+[1-9][0-9]{7,14}/;

export function isConsentable(catalog: Catalog, purpose: string): boolean {
  return catalog.purposes[purpose]?.class === 'marketing';
}

export function isMarketing(catalog: Catalog, purpose: string): boolean {
  return catalog.purposes[purpose]?.class === 'marketing';
}

export function marketingPurposes(catalog: Catalog): string[] {
  return Object.keys(catalog.purposes).filter((p) => isMarketing(catalog, p));
}

const present = (v: unknown) => v !== undefined && v !== null;

function identifierField(e: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(e)) {
    if (typeof v === 'string' && (EMAIL_LIKE.test(v) || PHONE_LIKE.test(v))) return k;
    if (k === 'actor' && v && typeof v === 'object') {
      const id = (v as Record<string, unknown>).id;
      if (typeof id === 'string' && (EMAIL_LIKE.test(id) || PHONE_LIKE.test(id))) return 'actor';
    }
  }
  return null;
}

/** Validates one event against the per-type field table of PRD §4.4. Needs no ledger and no clock. */
export function validateEvent(input: unknown, catalog: Catalog): Result<ConsentEvent, EventError> {
  const fail = (error: EventError) => ({ ok: false as const, error });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('BAD_FIELD:event');
  const e = input as Record<string, unknown>;

  for (const f of ['event_id', 'source'] as const) {
    if (!present(e[f])) return fail(`MISSING_FIELD:${f}`);
    if (typeof e[f] !== 'string' || e[f] === '') return fail(`BAD_FIELD:${f}`);
  }
  if (present(e.contact_id) && typeof e.contact_id !== 'string') return fail('BAD_FIELD:contact_id');
  if (!present(e.type)) return fail('MISSING_FIELD:type');
  if (!EVENT_TYPES.includes(e.type as EventType)) return fail('BAD_FIELD:type');
  if (!present(e.method)) return fail('MISSING_FIELD:method');
  if (!METHODS.includes(e.method as Method)) return fail('BAD_FIELD:method');
  if (!present(e.actor)) return fail('MISSING_FIELD:actor');
  const actor = e.actor as Record<string, unknown>;
  if (typeof actor !== 'object' || !ACTOR_KINDS.includes(actor.kind as Actor['kind'])) return fail('BAD_FIELD:actor');
  if (present(actor.id) && typeof actor.id !== 'string') return fail('BAD_FIELD:actor');
  if (present(e.evidence_ref) && typeof e.evidence_ref !== 'string') return fail('BAD_FIELD:evidence_ref');

  const idField = identifierField(e);
  if (idField) return fail(`BAD_FIELD:${idField}`);

  if (!isTimestamp(e.occurred_at) || !isTimestamp(e.recorded_at)) return fail('BAD_TIMESTAMP');
  if (toEpoch(e.occurred_at) > toEpoch(e.recorded_at)) return fail('OCCURRED_AFTER_RECORDED');

  if (present(e.verified_channel) && !catalog.channels.includes(e.verified_channel as string)) return fail('UNKNOWN_CHANNEL');

  const type = e.type as EventType;
  const needsChannel = ['OPT_IN', 'OPT_IN_CONFIRM', 'OPT_OUT', 'FREQUENCY_SET', 'SUPPRESSION_ADD', 'SUPPRESSION_CLEAR'].includes(type);
  if (needsChannel) {
    if (!present(e.channel)) return fail('MISSING_FIELD:channel');
    if (typeof e.channel !== 'string' || !catalog.channels.includes(e.channel)) return fail('UNKNOWN_CHANNEL');
  } else if (present(e.channel)) return fail('BAD_FIELD:channel');

  const purposeRule: 'required' | 'optional' | 'null' =
    type === 'OPT_IN' ? 'required' : type === 'OPT_IN_CONFIRM' || type === 'OPT_OUT' ? 'optional' : 'null';
  if (purposeRule === 'null' && present(e.purpose)) return fail('BAD_FIELD:purpose');
  if (purposeRule === 'required' && !present(e.purpose)) return fail('MISSING_FIELD:purpose');
  if (present(e.purpose)) {
    if (typeof e.purpose !== 'string' || !(e.purpose in catalog.purposes)) return fail('UNKNOWN_PURPOSE');
    if (!isConsentable(catalog, e.purpose)) return fail('PURPOSE_NOT_CONSENTABLE');
  }

  // type-specific fields are refused on every other type
  const own: Record<string, EventType[]> = {
    kind: ['SUPPRESSION_ADD', 'SUPPRESSION_CLEAR'],
    choice: ['FREQUENCY_SET'],
    fact: ['FACT_SET'],
    value: ['FACT_SET'],
  };
  for (const [f, types] of Object.entries(own)) if (present(e[f]) && !types.includes(type)) return fail(`BAD_FIELD:${f}`);

  switch (type) {
    case 'OPT_IN':
      if (!present(e.evidence_ref)) return fail('MISSING_FIELD:evidence_ref');
      break;
    case 'OPT_IN_CONFIRM':
      if (e.method !== 'double_opt_in_confirm' && e.method !== 'import') return fail('METHOD_NOT_ALLOWED');
      break;
    case 'FREQUENCY_SET':
      if (!present(e.choice)) return fail('MISSING_FIELD:choice');
      if (typeof e.choice !== 'string' || !(e.choice in catalog.frequency_choices)) return fail('BAD_FIELD:choice');
      break;
    case 'SUPPRESSION_ADD':
      if (!present(e.kind)) return fail('MISSING_FIELD:kind');
      if (!SUPPRESSION_KINDS.includes(e.kind as SuppressionKind)) return fail('BAD_FIELD:kind');
      break;
    case 'SUPPRESSION_CLEAR':
      if (!present(e.kind)) return fail('MISSING_FIELD:kind');
      if (e.kind === 'complaint') return fail('COMPLAINT_NOT_CLEARABLE');
      if (e.kind !== 'hard_bounce') return fail('BAD_FIELD:kind');
      if (actor.kind !== 'user') return fail('BAD_FIELD:actor');
      if (!present(e.evidence_ref)) return fail('MISSING_FIELD:evidence_ref');
      break;
    case 'FACT_SET':
      if (!present(e.fact)) return fail('MISSING_FIELD:fact');
      if (!FACTS.includes(e.fact as (typeof FACTS)[number])) return fail('BAD_FIELD:fact');
      if (!present(e.value)) return fail('MISSING_FIELD:value');
      if (e.fact === 'region' && (typeof e.value !== 'string' || e.value === '')) return fail('BAD_FIELD:value');
      if (e.fact === 'utc_offset_minutes' && !(Number.isInteger(e.value) && (e.value as number) >= -720 && (e.value as number) <= 840)) {
        return fail('BAD_FIELD:value');
      }
      break;
    default:
      break;
  }
  return { ok: true, value: e as unknown as ConsentEvent };
}
