// Regression tests for the independent review's findings (PR body, "Reviewer findings").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { explain, exposure, makeProofRecord, verifyProof } from '../../src/lib/consent/audit';
import { checkMessage, decide } from '../../src/lib/consent/decide';
import { planImport } from '../../src/lib/consent/import';
import { identifierHash } from '../../src/lib/consent/identity';
import { pairStatus, replay } from '../../src/lib/consent/ledger';
import { diffPreferences } from '../../src/lib/consent/preferences';
import { selectRuleSet } from '../../src/lib/consent/ruleset';
import type { Config, ConsentEvent } from '../../src/lib/consent/schema';
import { CONFIG, ROOT, decisionCase, importSetup } from './helpers/golden';

const ev = (over: Partial<ConsentEvent> & Pick<ConsentEvent, 'event_id' | 'type' | 'occurred_at'>): ConsentEvent => ({
  channel: null, purpose: null, recorded_at: over.occurred_at, source: 'test', method: 'api', evidence_ref: null, actor: { kind: 'contact' }, verified_channel: null, ...over,
});

describe('review regressions', () => {
  it('R1: a stored proof still matches after later events are appended to the ledger', () => {
    const c = decisionCase('WE-05');
    const rec = makeProofRecord(c.input, decide(c.input, CONFIG));
    const later = [...c.input.events, ev({ event_id: 'late-1', type: 'OPT_OUT', channel: 'sms', occurred_at: '2026-11-25T00:00:00Z', method: 'preference_center' })];
    expect(verifyProof(rec, later, CONFIG)).toBe('MATCH');
  });
  it('R3: a message with an unknown channel or purpose is refused, never allowed', () => {
    expect(checkMessage({ channel: 'email', purpose: 'bogus' }, CONFIG)).toBe('UNKNOWN_PURPOSE');
    expect(checkMessage({ channel: 'push', purpose: 'transactional' }, CONFIG)).toBe('UNKNOWN_CHANNEL');
    const input = decisionCase('WE-04').input;
    expect(() => decide({ ...input, message: { channel: 'email', purpose: 'bogus' } }, CONFIG)).toThrow(/UNKNOWN_PURPOSE/);
  });
  it('R4: an imported confirmation confirms only its own row\'s pair, not another pending pair', () => {
    const KEY = 'test-only-key-not-a-secret';
    const pending = ev({ event_id: 'p1', type: 'OPT_IN', channel: 'email', purpose: 'promotional', occurred_at: '2026-09-01T00:00:00Z', method: 'form', evidence_ref: 'ev/p1' });
    const { args } = importSetup('email,topic,status,date,confirmed\nze@example.com,newsletter,subscribed,2026-10-05,2026-10-06\n');
    const h = identifierHash(KEY, 'email', 'ze@example.com');
    const r = planImport({ ...args, ledgers: { [h]: { contact_id: 'c_ze', events: [pending] } } });
    if (!r.ok) throw new Error();
    const after = replay([pending, ...r.plan.rows[0]!.drafts.map((d, i) => ({ ...d, event_id: `n${i}` }))]);
    const rs = selectRuleSet(CONFIG, null, args.import_time);
    if (!rs.ok) throw new Error();
    expect(pairStatus(after, rs.ruleSet, 'email', 'promotional')).toBe('pending');
    expect(pairStatus(after, rs.ruleSet, 'email', 'newsletter')).toBe('on');
    expect(r.plan.rows[0]!.drafts[1]).toMatchObject({ type: 'OPT_IN_CONFIRM', purpose: 'newsletter', method: 'import' });
  });
  it('R5: exposure lists only the late events behind the hindsight reasons', () => {
    const events = [...decisionCase('WE-27').input.events, ev({ event_id: 'late-sms', type: 'OPT_OUT', channel: 'sms', occurred_at: '2026-11-12T00:00:00Z', recorded_at: '2026-11-22T00:00:00Z', method: 'api' })];
    const x = exposure(events, [{ channel: 'email', purpose: 'newsletter', sent_at: '2026-11-20T15:00:00Z' }], CONFIG);
    expect(x.map((e) => e.late_events.map((l) => l.event_id))).toEqual([['WE-27-e5']]);
  });
  it('R10: exposure decides each send against strictly earlier sends only (a send is never counted against itself)', () => {
    const sends = ['2026-11-14T16:00:00Z', '2026-11-17T09:00:00Z', '2026-11-20T15:00:00Z'].map((t) => ({ channel: 'email', purpose: 'newsletter', sent_at: t }));
    const x = exposure(decisionCase('WE-27').input.events, sends, CONFIG);
    expect(x.map((e) => e.hindsight_reasons)).toEqual([['PURPOSE_OPT_OUT'], ['PURPOSE_OPT_OUT'], ['PURPOSE_OPT_OUT']]);
  });
  it('R6: the explain trace carries the facts used, with their events', () => {
    expect(explain(decisionCase('WE-13').input, CONFIG, 'as_known').trace.facts).toEqual({ region: { value: 'R-NORTH', event_id: 'WE-13-e1' }, utc_offset_minutes: { value: -360, event_id: 'WE-13-e2' } });
  });
  it('R7: NO_IDENTIFIER cannot block a global unsubscribe', () => {
    const s = replay(decisionCase('WE-01').input.events);
    const rs = selectRuleSet(CONFIG, 'R-NORTH', '2026-11-21T10:00:00Z');
    if (!rs.ok) throw new Error();
    const tok = { v: 1 as const, kid: 'k1', org: 'o', cid: 'c', scope: 'preferences' as const, ch: 'email', pur: null, mid: 'm', iat: 1, exp: 2 };
    const r = diffPreferences({ state: s, ruleSet: rs.ruleSet, catalog: CONFIG.catalog, identifierChannels: ['email'], submission: { global_unsubscribe: true, purposes: { sms: { promotional: true } } }, token: tok, at: '2026-11-21T10:00:00Z' });
    expect(r.ok && r.drafts.map((d) => d.type)).toEqual(['GLOBAL_UNSUBSCRIBE']);
  });
  it('R9: never-exempt reasons stay even when an (unvalidated) config lists them as exempt', () => {
    const bad = structuredClone(CONFIG) as Config;
    for (const rs of bad.rule_sets) for (const ch of ['email', 'sms']) rs.transactional_exempt_from[ch]!.push('ERASURE_IN_PROGRESS', 'ERASED_SUPPRESSED', 'SUPPRESSED_COMPLAINT', 'SUPPRESSED_BOUNCE');
    for (const id of ['WE-23', 'WE-26']) {
      const d = decide(decisionCase(id).input, bad);
      expect(d.outcome, id).toBe('deny');
      expect(d.reasons[0]!.code).toBe(decisionCase(id).expected.reasons[0].code);
    }
    const t = decide({ ...decisionCase('WE-24').input, message: { channel: 'email', purpose: 'transactional' } }, bad);
    expect(t.reasons.map((r) => r.code)).toEqual(['SUPPRESSED_BOUNCE']);
  });
  it('R10: a backdated opt-in does not borrow a confirmation recorded before the ledger knew of it (PRD §5a step 4)', () => {
    const events = [
      ...decisionCase('WE-04').input.events,
      ev({ event_id: 'c1', type: 'OPT_IN_CONFIRM', channel: 'email', occurred_at: '2026-03-01T10:05:00Z', method: 'double_opt_in_confirm' }),
      ev({ event_id: 'i1', type: 'OPT_IN', channel: 'email', purpose: 'promotional', occurred_at: '2026-03-01T10:00:00Z', recorded_at: '2026-11-01T00:00:00Z', method: 'import', evidence_ref: 'import/b#row1' }),
    ];
    const d = decide({ ...decisionCase('WE-04').input, events }, CONFIG);
    expect(d.reasons.map((r) => r.code)).toEqual(['PENDING_DOUBLE_OPT_IN']);
  });
  it('R10: the signature comparison is the constant-time one (AC-c2, checked in the source)', () => {
    const src = readFileSync(join(ROOT, 'src/lib/consent/tokens.ts'), 'utf8');
    expect(src).toMatch(/return timingSafeEqual\(x, y\);/);
    expect(src).toMatch(/!sameSignature\(sig, sign\(/);
    expect(src).not.toMatch(/sig\s*[!=]==/);
  });
});
