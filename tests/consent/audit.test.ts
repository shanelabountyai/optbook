import { describe, expect, it } from 'vitest';
import { explain, makeProofRecord, verifyProof } from '../../src/lib/consent/audit';
import { decide } from '../../src/lib/consent/decide';
import { CONFIG, loadGolden, runAudit } from './helpers/golden';
import { genInputs } from './oracle/generator';

describe('audit: golden AU-01 to AU-06 (AC-f1)', () => {
  it.each(runAudit().map((o) => [o.id, o] as const))('%s', (_id, o) => expect(o.ok, JSON.stringify(o.actual)).toBe(true));
});

describe('audit: properties', () => {
  it('AC-f2: explain(..., "as_known").decision equals decide(...) for all 35 worked examples', () => {
    for (const c of loadGolden('decisions').cases) expect(explain(c.input, CONFIG, 'as_known').decision).toEqual(decide(c.input, CONFIG));
  });
  it('the same holds on 2,000 generated inputs, and every stored record verifies as MATCH', () => {
    for (const input of genInputs()) {
      const d = decide(input, CONFIG);
      expect(explain(input, CONFIG, 'as_known').decision).toEqual(d);
      expect(verifyProof(makeProofRecord(input, d), input.events, CONFIG)).toBe('MATCH');
    }
  });
  it('verifyProof reports a changed ledger as a fingerprint mismatch', () => {
    const c = loadGolden('decisions').cases[4]!;
    const rec = makeProofRecord(c.input, decide(c.input, CONFIG));
    expect(verifyProof(rec, c.input.events.slice(0, -1), CONFIG)).toEqual({ mismatch: ['outcome', 'reasons', 'basis', 'fingerprint'] });
  });
});
