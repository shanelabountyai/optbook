import { describe, expect, it } from 'vitest';
import { EXPECTED_IDS, loadGolden, subsetEqual } from './helpers/golden';

describe('golden fixtures (PHASE-1-PLAN 1.2)', () => {
  it.each(Object.entries(EXPECTED_IDS))('%s holds exactly the listed case ids', (name, ids) => {
    expect(loadGolden(name).cases.map((c) => c.id)).toEqual(ids);
  });
  it('subsetEqual compares stated fields and array lengths exactly', () => {
    expect(subsetEqual({ a: 1, b: 2 }, { a: 1 })).toBe(true);
    expect(subsetEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(subsetEqual([{ a: 1 }, { a: 2 }], [{ a: 1 }])).toBe(false);
    expect(subsetEqual(undefined, [])).toBe(false);
    expect(subsetEqual({ a: null }, { a: null })).toBe(true);
    expect(subsetEqual({}, { a: null })).toBe(false);
  });
});
