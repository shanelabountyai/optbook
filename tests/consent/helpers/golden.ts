// Golden-case runners shared by the tests and `npm run consent:eval`. They read fixtures/ (read-only) and return the
// actual value next to the expected one. Product code never imports this file and never reads an expected value.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { explain, exposure, makeProofRecord, verifyProof } from '../../../src/lib/consent/audit';
import { canonicalJson, sha256Hex } from '../../../src/lib/consent/canonical';
import { decide } from '../../../src/lib/consent/decide';
import { applyTaskEvent, planErasure, requestStatus, type Task } from '../../../src/lib/consent/erasure';
import { identifierHash, normalizeIdentifier } from '../../../src/lib/consent/identity';
import { DEFAULT_STATUS_VOCABULARY, planImport, type ImportMapping } from '../../../src/lib/consent/import';
import { factValue, knownAt, pairStatus, replay } from '../../../src/lib/consent/ledger';
import { diffPreferences, oneClickFromToken } from '../../../src/lib/consent/preferences';
import { selectRuleSet, validateConfig, validateFanoutPolicy } from '../../../src/lib/consent/ruleset';
import type { Config, ConsentEvent, EventDraft, FanoutPolicy } from '../../../src/lib/consent/schema';
import { issueToken, verifyToken } from '../../../src/lib/consent/tokens';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const FIXTURES = join(ROOT, 'fixtures');

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GoldenCase = { id: string; title: string; input: any; expected: any };
export type GoldenFile = { schema: string; cases: GoldenCase[]; [k: string]: any };
export type Outcome = { id: string; ok: boolean; actual: unknown; expected: unknown; summary: string };

export function loadGolden(name: string): GoldenFile {
  return JSON.parse(readFileSync(join(FIXTURES, 'golden', `${name}.json`), 'utf8'));
}

/** The ids each golden file must hold, exactly (fixtures/README.md). */
const range = (p: string, a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `${p}-${String(a + i).padStart(2, '0')}`);
export const EXPECTED_IDS: Record<string, string[]> = {
  decisions: range('WE', 1, 35),
  tokens: range('TK', 1, 9),
  preferences: [...range('PC', 1, 7), ...range('OC', 1, 4)],
  identity: range('ID', 1, 4),
  erasure: range('ER', 1, 9),
  import: range('IM', 1, 18),
  audit: range('AU', 1, 6),
};

/** The expected value states only what the PRD table states: compare those fields, and array lengths, exactly. */
export function subsetEqual(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => subsetEqual(actual[i], e));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([k, v]) => subsetEqual((actual as Record<string, unknown>)[k], v));
  }
  return isDeepStrictEqual(actual, expected);
}

const decisions = loadGolden('decisions');
const checked = validateConfig({ catalog: decisions.catalog, region_map: decisions.region_map, rule_sets: decisions.rule_sets });
if (!checked.ok) throw new Error(`golden config invalid: ${checked.error} at ${checked.field}`);
export const CONFIG: Config = checked.config;
const byId = new Map(decisions.cases.map((c) => [c.id, c]));
export function decisionCase(id: string): GoldenCase {
  const c = byId.get(id);
  if (!c) throw new Error(`no decision case ${id}`);
  return c;
}

const withIds = (drafts: EventDraft[], prefix: string): ConsentEvent[] => drafts.map((d, i) => ({ ...d, event_id: `${prefix}-d${i + 1}` }));

// ---- per file --------------------------------------------------------------------------------------------------------

export function runDecisions(): Outcome[] {
  return decisions.cases.map((c) => {
    const actual = decide(c.input, CONFIG);
    const ok = isDeepStrictEqual(actual, c.expected);
    return { id: c.id, ok, actual, expected: c.expected, summary: `${actual.outcome} [${actual.reasons.map((r) => r.code).join(',')}]` };
  });
}

export function runTokens(): Outcome[] {
  const f = loadGolden('tokens');
  return f.cases.map((c) => {
    const i = c.input;
    const actual =
      i.op === 'issue'
        ? { token: issueToken(i.payload, f.key) }
        : verifyToken(i.op === 'verify' ? i.token : issueToken(i.payload, f.key), i.keys, i.at);
    const summary = 'token' in actual ? 'issued' : `${actual.status} [${actual.allows.join(',')}]`;
    return { id: c.id, ok: subsetEqual(actual, c.expected), actual, expected: c.expected, summary };
  });
}

export function runIdentity(): Outcome[] {
  const f = loadGolden('identity');
  return f.cases.map((c) => {
    const results = (c.input.raw as string[]).map((raw) => {
      const n = normalizeIdentifier(c.input.channel, raw);
      return n.ok ? { normalized: n.value, hash: identifierHash(f.key, c.input.channel, n.value) } : { error: n.error };
    });
    // A case with several inputs expects the same result for each.
    const ok = results.every((r) => isDeepStrictEqual(r, c.expected));
    return { id: c.id, ok, actual: results.length === 1 ? results[0] : results, expected: c.expected, summary: String(results[0]!.error ?? results[0]!.normalized) };
  });
}

export function runPreferences(): Outcome[] {
  const f = loadGolden('preferences');
  const results = new Map<string, EventDraft[]>();
  return f.cases.map((c) => {
    const i = c.input;
    let events: ConsentEvent[] = [...decisionCase(i.start_case).input.events];
    if (i.after_case) events = [...events, ...withIds(results.get(i.after_case) ?? [], i.after_case)];
    let actual: Record<string, unknown>;
    if (i.op === 'one_click') {
      const r = oneClickFromToken(i.token, i.keys, events, CONFIG, i.at);
      actual = { status: r.status, drafts: r.drafts };
      results.set(c.id, r.drafts);
    } else {
      const s = replay(knownAt(events, i.at));
      const sel = selectRuleSet(CONFIG, factValue(s, 'region'), i.at);
      if (!sel.ok) throw new Error('no rule set');
      const r = diffPreferences({ state: s, ruleSet: sel.ruleSet, catalog: CONFIG.catalog, identifierChannels: i.identifier_channels, submission: i.submission, token: i.token_payload, at: i.at });
      const drafts = r.ok ? r.drafts : [];
      actual = r.ok ? { drafts } : { error: r.error, drafts };
      if (c.expected.after) {
        const after = replay([...events, ...withIds(drafts, c.id)]);
        actual.after = (c.expected.after as { channel: string; purpose: string }[]).map((p) => ({ ...p, status: pairStatus(after, sel.ruleSet, p.channel, p.purpose) }));
      }
    }
    const drafts = actual.drafts as EventDraft[];
    return { id: c.id, ok: subsetEqual(actual, c.expected), actual, expected: c.expected, summary: `${actual.error ?? actual.status ?? 'ok'} [${drafts.map((d) => `${d.type}(${d.channel ?? '*'},${d.purpose ?? '*'})`).join(',')}]` };
  });
}

export function erasureSetup() {
  const f = loadGolden('erasure');
  const policyCheck = validateFanoutPolicy(f.policy);
  if (!policyCheck.ok) throw new Error('bad policy');
  const policy: FanoutPolicy = policyCheck.policy;
  const planned = planErasure({
    events: decisionCase(f.start_case).input.events,
    config: CONFIG,
    registry: f.registry,
    identifiers: f.identifiers,
    key: { kid: 't1', secret: f.key },
    request: { request_id: f.request.request_id, at: f.request.at },
    actor: { kind: 'user' },
  });
  if (!planned.ok) throw new Error(planned.error);
  return { f, policy, plan: planned.plan };
}

export function runErasure(): Outcome[] {
  const { f, policy, plan } = erasureSetup();
  const request = { request_id: f.request.request_id, due_at: plan.due_at };
  const run = (events: { system: string; type: 'ATTEMPT' | 'ACK' | 'NACK' | 'REQUEUE'; at: string }[]) => {
    const tasks = new Map<string, Task>(plan.tasks.map((t) => [t.system, t]));
    let last = 'none';
    for (const e of events) {
      const r = applyTaskEvent(tasks.get(e.system)!, { type: e.type, at: e.at, actor: { kind: 'user' } }, policy);
      tasks.set(e.system, r.task);
      last = r.ok ? (r.changed ? 'changed' : 'unchanged') : r.error;
    }
    return { tasks: [...tasks.values()], last };
  };
  return f.cases.map((c) => {
    const i = c.input;
    let actual: Record<string, unknown>;
    if (i.op === 'plan') {
      actual = { due_at: plan.due_at, event_drafts: [plan.eventDraft.type], tombstones: plan.tombstones.length, tasks: Object.fromEntries(plan.tasks.map((t) => [t.system, t.state])) };
    } else if (i.op === 'status_series') {
      const { tasks } = run(i.events);
      const st = (i.status_at as string[]).map((at) => requestStatus(request, tasks, at, policy));
      actual = { at_risk: st.map((s) => s.at_risk), overdue: st.map((s) => s.overdue) };
    } else {
      const { tasks, last } = run(i.events);
      const st = requestStatus(request, tasks, i.status_at, policy);
      const system = c.expected.task?.system;
      actual = {
        state: st.state,
        completed_at: st.completed_at,
        completed_late: st.completed_late,
        event_drafts: st.eventDraft ? [st.eventDraft.type] : [],
        last_result: last,
        ...(system ? { task: st.tasks.find((t) => t.system === system) } : {}),
      };
    }
    const summary = String(actual.state ?? (actual.task as Task | undefined)?.state ?? (i.op === 'plan' ? `${plan.tasks.length} tasks` : 'series'));
    return { id: c.id, ok: subsetEqual(actual, c.expected), actual, expected: c.expected, summary };
  });
}

export function importSetup(csvText?: string) {
  const f = loadGolden('import');
  const csv = csvText ?? readFileSync(join(ROOT, f.csv), 'utf8');
  const ledgers: Record<string, { contact_id: string; events: ConsentEvent[] }> = {};
  for (const k of f.contacts) {
    const n = normalizeIdentifier(k.channel, k.identifier);
    if (!n.ok) throw new Error('bad fixture identifier');
    ledgers[identifierHash(f.key, k.channel, n.value)] = { contact_id: k.contact_id, events: k.events };
  }
  const tombstones = new Set<string>(
    f.tombstoned.map((t: { channel: string; identifier: string }) => {
      const n = normalizeIdentifier(t.channel, t.identifier);
      if (!n.ok) throw new Error('bad fixture identifier');
      return identifierHash(f.key, t.channel, n.value);
    }),
  );
  const args = { csv, mapping: f.mapping as ImportMapping, vocabulary: DEFAULT_STATUS_VOCABULARY, ledgers, tombstones, key: f.key, config: CONFIG, batch_id: f.batch_id, import_time: f.import_time };
  return { f, args };
}

export function runImport(): Outcome[] {
  const { f, args } = importSetup();
  const r = planImport(args);
  if (!r.ok) throw new Error(`import failed: ${r.error} row ${r.row}`);
  const rows = r.plan.rows;
  const out: Outcome[] = f.cases.map((c) => {
    const actual = { rows: (c.input.rows as number[]).map((n) => rows.find((x) => x.row === n)) };
    const summary = actual.rows.map((x) => `${x?.outcome}${x?.reason ? `/${x.reason}` : ''}`).join(' + ');
    return { id: c.id, ok: subsetEqual(actual, c.expected), actual, expected: c.expected, summary };
  });
  out.push({ id: 'IM-summary', ok: isDeepStrictEqual(r.plan.summary, f.summary) && rows.length === 19, actual: r.plan.summary, expected: f.summary, summary: `${rows.length} rows` });
  return out;
}

export function runAudit(): Outcome[] {
  const f = loadGolden('audit');
  return f.cases.map((c) => {
    const i = c.input;
    let actual: Record<string, unknown>;
    if (i.op === 'explain') {
      const { decision, trace } = explain(decisionCase(i.case).input, CONFIG, i.mode);
      actual = { outcome: decision.outcome, reason_codes: decision.reasons.map((r) => r.code), not_yet_known: trace.not_yet_known };
    } else if (i.op === 'exposure') {
      actual = { exposures: exposure(decisionCase(i.case).input.events, i.sends, CONFIG) };
    } else if (i.op === 'verify_proof') {
      const wc = decisionCase(i.case);
      const record = { ...makeProofRecord(wc.input, wc.expected), ...i.override };
      const r = verifyProof(record, wc.input.events, CONFIG);
      actual = r === 'MATCH' ? { result: 'MATCH' } : { result: 'MISMATCH', fields: r.mismatch };
    } else {
      const s = canonicalJson(i.value);
      actual = { canonical: s, sha256: sha256Hex(s) };
    }
    return { id: c.id, ok: subsetEqual(actual, c.expected), actual, expected: c.expected, summary: String(actual.outcome ?? actual.result ?? (actual.exposures ? `${(actual.exposures as unknown[]).length} exposure(s)` : 'canonical')) };
  });
}

export const RUNNERS: [string, () => Outcome[]][] = [
  ['decisions', runDecisions],
  ['tokens', runTokens],
  ['preferences', runPreferences],
  ['identity', runIdentity],
  ['erasure', runErasure],
  ['import', runImport],
  ['audit', runAudit],
];
