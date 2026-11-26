import { describe, expect, it } from 'vitest';
import { addSeconds, dateOnlyToTimestamp, fromEpoch, isTimestamp, localSecondsOfDay, parseHm, toEpoch } from '../../src/lib/consent/time';

describe('time (PHASE-1-PLAN 1.3)', () => {
  it('round-trips a fixed list of timestamps', () => {
    for (const s of ['1970-01-01T00:00:00Z', '2024-02-29T23:59:59Z', '2026-11-20T15:00:00Z', '2100-03-01T00:00:00Z', '2000-02-29T12:00:00Z']) {
      expect(isTimestamp(s)).toBe(true);
      expect(fromEpoch(toEpoch(s))).toBe(s);
    }
    expect(toEpoch('2026-11-20T15:00:00Z')).toBe(1795186800);
    expect(toEpoch('1970-01-01T00:00:00Z')).toBe(0);
  });
  it('round-trips every day from 1970 to 2101 (integer civil arithmetic)', () => {
    for (let d = 0; d < 48000; d += 1) expect(toEpoch(fromEpoch(d * 86400 + 3661))).toBe(d * 86400 + 3661);
  });
  it('refuses anything but YYYY-MM-DDTHH:MM:SSZ with a real calendar date', () => {
    for (const s of ['2026-02-30T00:00:00Z', '2026-11-20T15:00:00+00:00', '2026-11-20 15:00:00', '2026-11-20T15:00:00.000Z', '2026-11-20t15:00:00z', '2100-02-29T00:00:00Z', '2026-11-20T24:00:00Z', '2026-13-01T00:00:00Z', ''])
      expect(isTimestamp(s)).toBe(false);
    expect(isTimestamp('2024-02-29T00:00:00Z')).toBe(true);
    expect(() => toEpoch('2026-02-30T00:00:00Z')).toThrow();
  });
  it('computes local seconds of day with negative and positive offsets across midnight', () => {
    expect(localSecondsOfDay('2026-11-21T03:30:00Z', -360)).toBe(77400);
    expect(localSecondsOfDay('2026-11-20T14:00:00Z', -360)).toBe(28800);
    expect(localSecondsOfDay('2026-11-20T23:30:00Z', 60)).toBe(1800);
    expect(localSecondsOfDay('2026-11-20T00:10:00Z', -720)).toBe(43800);
    expect(localSecondsOfDay('2026-11-20T23:00:00Z', 840)).toBe(46800);
  });
  it('parses HH:MM and places date-only values at the start or end of the day', () => {
    expect(parseHm('21:00')).toBe(1260);
    expect(parseHm('08:00')).toBe(480);
    expect(parseHm('24:00')).toBeNull();
    expect(dateOnlyToTimestamp('2026-08-08', 'start')).toBe('2026-08-08T00:00:00Z');
    expect(dateOnlyToTimestamp('2026-08-08', 'end')).toBe('2026-08-08T23:59:59Z');
    expect(dateOnlyToTimestamp('2026-02-30', 'end')).toBeNull();
    expect(addSeconds('2026-11-01T00:00:00Z', 30 * 86400)).toBe('2026-12-01T00:00:00Z');
  });
});
