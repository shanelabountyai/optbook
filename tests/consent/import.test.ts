import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { identifierHash } from '../../src/lib/consent/identity';
import { DEFAULT_STATUS_VOCABULARY, parseCsv, planImport, type ImportMapping } from '../../src/lib/consent/import';
import { pairStatus, pairView, replay } from '../../src/lib/consent/ledger';
import { selectRuleSet } from '../../src/lib/consent/ruleset';
import type { ConsentEvent } from '../../src/lib/consent/schema';
import { CONFIG, ROOT, importSetup, runImport } from './helpers/golden';
import { SEED, genEvent, prng } from './oracle/generator';

describe('import: golden IM-01 to IM-18 and the summary (AC-e1)', () => {
  it.each(runImport().map((o) => [o.id, o] as const))('%s', (_id, o) => expect(o.ok, JSON.stringify(o.actual)).toBe(true));
});

const csvText = readFileSync(join(ROOT, 'fixtures/import/im-sample.csv'), 'utf8');
const [header, ...lines] = csvText.trimEnd().split('\n');

describe('import: order independence (AC-e2)', () => {
  const key = (rows: { cells: string[]; outcome: string; reason?: string; notes: string[]; drafts: object[] }[]) =>
    rows.map((x) => JSON.stringify([x.cells, x.outcome, x.reason ?? null, x.notes, x.drafts.map((d) => ({ ...d, evidence_ref: undefined }))])).sort();
  const plan = (text: string) => {
    const r = planImport(importSetup(text).args);
    if (!r.ok) throw new Error(r.error);
    return r.plan;
  };
  const base = plan(csvText);
  it('reversed and 20 seeded shuffles give the same multiset of (row content, outcome, reason, notes, drafts)', () => {
    const r = prng(SEED + 40);
    const orders = [[...lines].reverse(), ...Array.from({ length: 20 }, () => r.shuffle(lines))];
    for (const o of orders) {
      const p = plan(`${header}\n${o.join('\n')}\n`);
      expect(key(p.rows)).toEqual(key(base.rows));
      expect(p.summary).toEqual(base.summary);
    }
  });
  it('which of two identical rows is the DUPLICATE follows row number', () => {
    const p = plan(`${header}\nzed@example.com,newsletter,unsubscribed,2026-05-01,\nzed@example.com,newsletter,unsubscribed,2026-05-01,\n`);
    expect(p.rows.map((x) => x.outcome)).toEqual(['APPEND', 'DUPLICATE']);
  });
  it('planning is pure: the ledgers it was given are unchanged and the fingerprint is stable', () => {
    const { args } = importSetup(csvText);
    const before = JSON.stringify(args.ledgers);
    const a = planImport(args);
    const b = planImport(args);
    expect(JSON.stringify(args.ledgers)).toBe(before);
    expect(a.ok && b.ok && a.plan.ledger_fingerprint === b.plan.ledger_fingerprint).toBe(true);
  });
});

describe('import: CSV reader (AC-e5)', () => {
  it('quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, BOM, no trailing newline', () => {
    const r = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n1,2,3');
    expect(r).toEqual({ ok: true, header: ['a', 'b', 'c'], rows: [{ row: 1, cells: ['x, y', 'say "hi"', 'line1\nline2'] }, { row: 2, cells: ['1', '2', '3'] }] });
    expect(parseCsv('a,b\n1,2\n')).toEqual(parseCsv('a,b\r\n1,2'));
    expect(parseCsv('a,b\n,\n')).toEqual({ ok: true, header: ['a', 'b'], rows: [{ row: 1, cells: ['', ''] }] });
  });
  it('a row with the wrong number of columns is rejected by row number, not shifted', () => {
    expect(parseCsv('a,b,c\n1,2,3\n1,2\n4,5,6\n')).toEqual({ ok: false, error: 'BAD_COLUMN_COUNT', row: 2 });
    expect(parseCsv('a,b\n1,2,3\n')).toEqual({ ok: false, error: 'BAD_COLUMN_COUNT', row: 1 });
    expect(parseCsv('a,b\n"1,2\n')).toMatchObject({ ok: false, error: 'UNTERMINATED_QUOTE' });
  });
  it('dates are parsed only in the declared format', () => {
    const { args } = importSetup(`email,topic,status,date,confirmed\nq@example.com,newsletter,yes,03/04/2025,\nq@example.com,newsletter,yes,2025-03-04,\n`);
    const mdy = planImport({ ...args, mapping: { ...args.mapping, date_format: 'mdy' } as ImportMapping });
    const dmy = planImport({ ...args, mapping: { ...args.mapping, date_format: 'dmy' } as ImportMapping });
    if (!mdy.ok || !dmy.ok) throw new Error();
    expect(mdy.plan.rows[0]!.drafts[0]!.occurred_at).toBe('2025-03-04T00:00:00Z');
    expect(dmy.plan.rows[0]!.drafts[0]!.occurred_at).toBe('2025-04-03T00:00:00Z');
    expect(mdy.plan.rows[1]).toMatchObject({ outcome: 'REJECT', reason: 'BAD_DATE' });
  });
});

describe('import: an import never turns a no into a yes (AC-e3)', () => {
  it('for generated ledgers and permissive-heavy files, no pair that is "no" before is "on" after', () => {
    const r = prng(SEED + 41);
    const KEY = 'test-only-key-not-a-secret';
    const statuses = ['subscribed', 'subscribed', 'yes', 'pending', 'unsubscribed', 'bounced'];
    const dates = ['2025-12-01', '2026-03-01', '2026-06-10', '2026-08-01', '2026-11-18', '2026-11-20', '2026-06-10T09:00:00Z', ''];
    let noBefore = 0;
    const now = '2026-11-20T15:00:00Z';
    for (let n = 0; n < 300; n += 1) {
      const addresses = ['p1@example.com', 'p2@example.com', 'p3@example.com'];
      const ledgers: Record<string, { contact_id: string; events: ConsentEvent[] }> = {};
      for (const [i, a] of addresses.entries()) {
        const events = Array.from({ length: r.int(8) }, (_, k) => genEvent(r, `L${n}-${i}-${k}`)).filter((e) => e.recorded_at <= now && e.type !== 'ERASURE_COMPLETED' && e.type !== 'ERASURE_REQUESTED');
        ledgers[identifierHash(KEY, 'email', a)] = { contact_id: `c${i}`, events };
      }
      const rows = Array.from({ length: 1 + r.int(10) }, () => [r.pick(addresses), r.pick(['newsletter', 'product_updates', 'promotional']), r.pick(statuses), r.pick(dates), r.chance(30) ? r.pick(dates) : ''].join(','));
      const { args } = importSetup(`email,topic,status,date,confirmed\n${rows.join('\n')}\n`);
      const res = planImport({ ...args, ledgers, tombstones: new Set(), vocabulary: DEFAULT_STATUS_VOCABULARY, import_time: now });
      if (!res.ok) throw new Error(res.error);
      for (const [h, l] of Object.entries(ledgers)) {
        const before = replay(l.events);
        const drafts = res.plan.rows.filter((x) => x.contact?.identifier_hash === h).flatMap((x) => x.drafts);
        const after = replay([...l.events, ...drafts.map((d, i) => ({ ...d, event_id: `new${i}` }))]);
        const sel = selectRuleSet(CONFIG, (before.facts.region?.value as string) ?? null, now);
        if (!sel.ok) throw new Error();
        for (const ch of ['email', 'sms']) {
          for (const p of ['newsletter', 'product_updates', 'promotional']) {
            const v = pairView(before, ch, p);
            if (v.global || v.channel || v.purpose) {
              noBefore += 1;
              expect(pairStatus(after, sel.ruleSet, ch, p)).not.toBe('on');
            }
          }
        }
      }
    }
    expect(noBefore).toBeGreaterThan(200);
  });
});
