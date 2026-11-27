// UTC timestamps as `YYYY-MM-DDTHH:MM:SSZ` strings, integer seconds, no clock (PRD §4.3, D-007).
// Civil-date arithmetic is the days-from-civil algorithm, integers only.

const TS = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const SECONDS_PER_DAY = 86400;

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

function validCivil(y: number, m: number, d: number): boolean {
  return y >= 1970 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

export function isTimestamp(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = TS.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return validCivil(y, mo, d) && h <= 23 && mi <= 59 && se <= 59;
}

/** Epoch seconds. Throws on a non-timestamp: callers validate first, so a throw here is a bug. */
export function toEpoch(s: string): number {
  if (!isTimestamp(s)) throw new Error(`not a timestamp: ${s}`);
  const [y, mo, d, h, mi, se] = TS.exec(s)!.slice(1).map(Number) as [number, number, number, number, number, number];
  return daysFromCivil(y, mo, d) * SECONDS_PER_DAY + h * 3600 + mi * 60 + se;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function fromEpoch(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`not an epoch second: ${n}`);
  const days = Math.floor(n / SECONDS_PER_DAY);
  const sod = n - days * SECONDS_PER_DAY;
  const [y, m, d] = civilFromDays(days);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}T${pad(Math.floor(sod / 3600))}:${pad(Math.floor((sod % 3600) / 60))}:${pad(sod % 60)}Z`;
}

export function addSeconds(s: string, n: number): string {
  return fromEpoch(toEpoch(s) + n);
}

/** Integer comparison of two timestamps: negative, zero or positive. */
export function cmpTs(a: string, b: string): number {
  return toEpoch(a) - toEpoch(b);
}

export function localSecondsOfDay(s: string, offsetMinutes: number): number {
  const t = toEpoch(s) + offsetMinutes * 60;
  return ((t % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
}

/** "21:00" -> 1260 minutes; null when malformed. */
export function parseHm(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

export function isCivilDate(s: string): boolean {
  const m = DAY.exec(s);
  if (!m) return false;
  return validCivil(Number(m[1]), Number(m[2]), Number(m[3]));
}

/** A date without a time, placed at the start (00:00:00Z) or the end (23:59:59Z) of the day (PRD §5e rule 3). */
export function dateOnlyToTimestamp(dateString: string, where: 'start' | 'end'): string | null {
  if (!isCivilDate(dateString)) return null;
  return `${dateString}T${where === 'start' ? '00:00:00' : '23:59:59'}Z`;
}
