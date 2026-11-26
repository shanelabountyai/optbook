import { describe, expect, it } from 'vitest';
import { validateEvent, type ConsentEvent } from '../../src/lib/consent/schema';
import { CONFIG, loadGolden } from './helpers/golden';

const cat = CONFIG.catalog;
const optIn: ConsentEvent = {
  event_id: 'x1', type: 'OPT_IN', channel: 'email', purpose: 'newsletter', occurred_at: '2026-03-01T10:00:00Z', recorded_at: '2026-03-01T10:00:00Z',
  source: 'web_form', method: 'form', evidence_ref: 'ev/1', actor: { kind: 'contact' }, verified_channel: null,
};
const err = (e: object) => {
  const r = validateEvent(e, cat);
  return r.ok ? 'OK' : r.error;
};

describe('validateEvent (PHASE-1-PLAN 1.5, AC-a1, AC-a4)', () => {
  it('every event in decisions.json validates', () => {
    const events = loadGolden('decisions').cases.flatMap((c) => c.input.events);
    expect(events.length).toBeGreaterThan(100);
    for (const e of events) expect(err(e), e.event_id).toBe('OK');
  });
  it('refuses one event per error code', () => {
    expect(err({ ...optIn, channel: 'push' })).toBe('UNKNOWN_CHANNEL');
    expect(err({ ...optIn, purpose: 'surveys' })).toBe('UNKNOWN_PURPOSE');
    expect(err({ ...optIn, purpose: 'transactional' })).toBe('PURPOSE_NOT_CONSENTABLE');
    expect(err({ ...optIn, evidence_ref: null })).toBe('MISSING_FIELD:evidence_ref');
    expect(err({ ...optIn, channel: null })).toBe('MISSING_FIELD:channel');
    expect(err({ ...optIn, type: 'GLOBAL_UNSUBSCRIBE', purpose: null })).toBe('BAD_FIELD:channel');
    expect(err({ ...optIn, type: 'SUPPRESSION_ADD', purpose: null, kind: 'soft_bounce' })).toBe('BAD_FIELD:kind');
    expect(err({ ...optIn, type: 'FREQUENCY_SET', purpose: null, choice: 'daily' })).toBe('BAD_FIELD:choice');
    expect(err({ ...optIn, type: 'FACT_SET', channel: null, purpose: null, fact: 'zone', value: 'x' })).toBe('BAD_FIELD:fact');
    expect(err({ ...optIn, type: 'FACT_SET', channel: null, purpose: null, fact: 'utc_offset_minutes', value: 900 })).toBe('BAD_FIELD:value');
    expect(err({ ...optIn, type: 'SUPPRESSION_CLEAR', purpose: null, kind: 'hard_bounce', actor: { kind: 'system' } })).toBe('BAD_FIELD:actor');
    expect(err({ ...optIn, kind: 'complaint' })).toBe('BAD_FIELD:kind');
    expect(err({ ...optIn, occurred_at: '2026-03-01 10:00:00' })).toBe('BAD_TIMESTAMP');
    expect(err({ ...optIn, occurred_at: '2026-03-01T10:00:01Z' })).toBe('OCCURRED_AFTER_RECORDED');
    expect(err({ ...optIn, type: 'OPT_IN_CONFIRM', purpose: null, method: 'form' })).toBe('METHOD_NOT_ALLOWED');
    expect(err({ ...optIn, type: 'SUPPRESSION_CLEAR', purpose: null, kind: 'complaint', actor: { kind: 'user' } })).toBe('COMPLAINT_NOT_CLEARABLE');
    expect(err({ ...optIn, type: 'NOT_A_TYPE' })).toBe('BAD_FIELD:type');
  });
  it('refuses an identifier in any string field (L-2)', () => {
    expect(err({ ...optIn, source: 'ada@example.com' })).toBe('BAD_FIELD:source');
    expect(err({ ...optIn, evidence_ref: 'call +15550100199' })).toBe('BAD_FIELD:evidence_ref');
    expect(err({ ...optIn, actor: { kind: 'user', id: 'ops@example.com' } })).toBe('BAD_FIELD:actor');
    expect(err({ ...optIn, event_id: 'a@b.co' })).toBe('BAD_FIELD:event_id');
  });
});
