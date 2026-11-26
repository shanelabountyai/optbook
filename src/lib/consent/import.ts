// Consent-history import (PRD §5e): a CSV reader and a pure preview planner. Restrictive rows are easy to accept;
// permissive rows must prove themselves; an import never turns a "no" into a "yes" (D-022, non-negotiable 6).
import { fingerprint } from './canonical';
import { identifierHash, normalizeIdentifier } from './identity';
import { factValue, knownAt, occurredBy, pairStatus, pairView, replay } from './ledger';
import { selectRuleSet } from './ruleset';
import { isConsentable, type Config, type ConsentEvent, type EventDraft, type SuppressionKind } from './schema';
import { dateOnlyToTimestamp, isCivilDate, isTimestamp, toEpoch } from './time';

// ---- CSV ----------------------------------------------------------------------------------------------------------

export type CsvRow = { row: number; cells: string[] };
export type CsvResult = { ok: true; header: string[]; rows: CsvRow[] } | { ok: false; error: 'BAD_COLUMN_COUNT' | 'UNTERMINATED_QUOTE' | 'EMPTY_FILE'; row: number };

/**
 * RFC 4180-style reader (AC-e5): quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF, a UTF-8
 * byte-order mark, a missing trailing newline. Row numbers count data rows from 1. A row with the wrong number of
 * columns fails the whole file with its row number; a completely empty line is skipped.
 */
export function parseCsv(text: string): CsvResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: { cells: string[]; blank: boolean }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let touched = false;
  let i = 0;
  const endRecord = () => {
    cells.push(cell);
    records.push({ cells, blank: !touched && cells.length === 1 && cell === '' });
    cells = [];
    cell = '';
    touched = false;
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
      touched = true;
      i += 1;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
      touched = true;
      i += 1;
    } else if (ch === '\r' && src[i + 1] === '\n') {
      endRecord();
      i += 2;
    } else if (ch === '\n' || ch === '\r') {
      endRecord();
      i += 1;
    } else {
      cell += ch;
      touched = true;
      i += 1;
    }
  }
  if (quoted) return { ok: false, error: 'UNTERMINATED_QUOTE', row: Math.max(records.filter((r) => !r.blank).length, 1) };
  if (touched || cell !== '' || cells.length) endRecord();
  const kept = records.filter((r) => !r.blank);
  if (!kept.length) return { ok: false, error: 'EMPTY_FILE', row: 0 };
  const header = kept[0]!.cells.map((h) => h.trim());
  const rows: CsvRow[] = [];
  for (const [k, r] of kept.slice(1).entries()) {
    if (r.cells.length !== header.length) return { ok: false, error: 'BAD_COLUMN_COUNT', row: k + 1 };
    rows.push({ row: k + 1, cells: r.cells });
  }
  return { ok: true, header, rows };
}

// ---- vocabulary and mapping (data) ---------------------------------------------------------------------------------

export type StatusVocabulary = { permissive: string[]; restrictive: string[]; suppression: Record<SuppressionKind, string[]> };

/** PRD §5e rule 1. Data, matched after trimming and lowercasing; anything else is UNKNOWN_STATUS. */
export const DEFAULT_STATUS_VOCABULARY: StatusVocabulary = {
  permissive: ['subscribed', 'opted in', 'opt-in', 'optin', 'yes', 'y', 'true', '1', 'active', 'pending', 'unconfirmed'],
  restrictive: ['unsubscribed', 'opted out', 'opt-out', 'optout', 'no', 'n', 'false', '0', 'removed'],
  suppression: { hard_bounce: ['bounced', 'hard bounce'], complaint: ['complained', 'spam', 'abuse'] },
};

type Source = { constant: string } | { column: string };
export type ImportMapping = {
  identifier: string;
  channel: Source;
  purpose: Source;
  status: string;
  date: string;
  confirmation_date?: string;
  date_format: 'iso' | 'mdy' | 'dmy';
  source_label: string;
};

export const IMPORT_OUTCOMES = ['APPEND', 'APPEND_NO_EFFECT', 'DUPLICATE', 'HOLD_REVIEW', 'SKIP_ERASED', 'REJECT'] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];
export type RejectReason =
  | 'MISSING_IDENTIFIER'
  | 'BAD_IDENTIFIER'
  | 'UNKNOWN_CHANNEL'
  | 'UNKNOWN_PURPOSE'
  | 'PURPOSE_NOT_CONSENTABLE'
  | 'UNKNOWN_STATUS'
  | 'BAD_DATE'
  | 'FUTURE_DATE'
  | 'MISSING_DATE_OPT_IN'
  | 'ERASED_IDENTIFIER';
export type ImportNote = 'CONTACT_CREATED' | 'DATE_DEFAULTED' | 'DATE_ONLY' | 'PURPOSE_WIDENED' | 'WILL_BE_PENDING_DOUBLE_OPT_IN';
const NOTE_ORDER: ImportNote[] = ['CONTACT_CREATED', 'DATE_DEFAULTED', 'DATE_ONLY', 'PURPOSE_WIDENED', 'WILL_BE_PENDING_DOUBLE_OPT_IN'];

export type PlannedRow = {
  row: number;
  cells: string[];
  outcome: ImportOutcome;
  reason?: RejectReason;
  notes: ImportNote[];
  /** The contact the row belongs to, by identifier hash; `contact_id` is null for a contact the import creates. */
  contact?: { identifier_hash: string; contact_id: string | null };
  drafts: EventDraft[];
};

export type ImportPlan = { rows: PlannedRow[]; summary: Record<ImportOutcome, number>; ledger_fingerprint: string };

type Parsed = { ts: string; dateOnly: boolean } | 'blank' | 'bad';

function parseDate(cell: string, format: ImportMapping['date_format']): Parsed {
  const v = cell.trim();
  if (v === '') return 'blank';
  if (format === 'iso') {
    if (isTimestamp(v)) return { ts: v, dateOnly: false };
    return isCivilDate(v) ? { ts: v, dateOnly: true } : 'bad';
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  if (!m) return 'bad';
  const [a, b, y] = [m[1]!, m[2]!, m[3]!];
  const iso = format === 'mdy' ? `${y}-${a}-${b}` : `${y}-${b}-${a}`;
  return isCivilDate(iso) ? { ts: iso, dateOnly: true } : 'bad';
}

type Kind = 'permissive' | 'restrictive' | 'suppression';
type Candidate = {
  row: number;
  cells: string[];
  hash: string;
  channel: string;
  purpose: string | null;
  kind: Kind;
  suppression?: SuppressionKind;
  occurred_at: string;
  confirm_at: string | null;
  notes: Set<ImportNote>;
};

/**
 * Plans an import (PRD §5e rules 1–13). Pure: it writes nothing and returns, per row, one outcome, a reason for a
 * rejection, notes, and the event drafts a commit would append, plus the fingerprint of the ledger it was computed
 * against.
 */
export function planImport(args: {
  csv: string;
  mapping: ImportMapping;
  vocabulary: StatusVocabulary;
  /** The affected contacts' ledgers, keyed by identifier hash. */
  ledgers: Readonly<Record<string, { contact_id: string; events: readonly ConsentEvent[] }>>;
  /** Hashes of active erasure tombstones. */
  tombstones: ReadonlySet<string>;
  key: string;
  config: Config;
  batch_id: string;
  import_time: string;
}): { ok: true; plan: ImportPlan } | { ok: false; error: string; row: number } {
  const { mapping, config, import_time: now } = args;
  const csv = parseCsv(args.csv);
  if (!csv.ok) return csv;
  const col = (name: string) => csv.header.indexOf(name);
  const missingColumn = [mapping.identifier, mapping.status, mapping.date, mapping.confirmation_date, 'column' in mapping.channel ? mapping.channel.column : undefined, 'column' in mapping.purpose ? mapping.purpose.column : undefined]
    .filter((c): c is string => c !== undefined)
    .find((c) => col(c) < 0);
  if (missingColumn !== undefined) return { ok: false, error: `MISSING_COLUMN:${missingColumn}`, row: 0 };
  const get = (cells: string[], name: string | undefined) => (name === undefined ? '' : (cells[col(name)] ?? ''));
  const pick = (cells: string[], s: Source) => ('constant' in s ? s.constant : get(cells, s.column));
  const nowT = toEpoch(now);

  const done: PlannedRow[] = [];
  const candidates: Candidate[] = [];
  const reject = (r: CsvRow, reason: RejectReason) => done.push({ row: r.row, cells: r.cells, outcome: 'REJECT', reason, notes: [], drafts: [] });

  for (const r of csv.rows) {
    const rawId = get(r.cells, mapping.identifier);
    if (rawId.trim() === '') {
      reject(r, 'MISSING_IDENTIFIER');
      continue;
    }
    const channel = pick(r.cells, mapping.channel).trim().toLowerCase();
    if (!config.catalog.channels.includes(channel)) {
      reject(r, 'UNKNOWN_CHANNEL');
      continue;
    }
    const id = normalizeIdentifier(channel, rawId);
    if (!id.ok) {
      reject(r, 'BAD_IDENTIFIER');
      continue;
    }
    const status = get(r.cells, mapping.status).trim().toLowerCase();
    const v = args.vocabulary;
    let kind: Kind;
    let suppression: SuppressionKind | undefined;
    if (v.permissive.includes(status)) kind = 'permissive';
    else if (v.restrictive.includes(status)) kind = 'restrictive';
    else if (v.suppression.hard_bounce.includes(status)) [kind, suppression] = ['suppression', 'hard_bounce'];
    else if (v.suppression.complaint.includes(status)) [kind, suppression] = ['suppression', 'complaint'];
    else {
      reject(r, 'UNKNOWN_STATUS');
      continue;
    }
    const notes = new Set<ImportNote>();
    let purpose: string | null = null;
    if (kind !== 'suppression') {
      const p = pick(r.cells, mapping.purpose).trim().toLowerCase();
      const known = Object.hasOwn(config.catalog.purposes, p);
      if (known && !isConsentable(config.catalog, p)) {
        reject(r, 'PURPOSE_NOT_CONSENTABLE');
        continue;
      }
      if (known) purpose = p;
      else if (kind === 'permissive') {
        reject(r, 'UNKNOWN_PURPOSE');
        continue;
      } else notes.add('PURPOSE_WIDENED'); // rule 4: a restrictive row with a blank or unknown purpose opts out of the channel
    }
    const date = parseDate(get(r.cells, mapping.date), mapping.date_format);
    let occurred: string;
    let confirmAt: string | null = null;
    if (kind === 'permissive') {
      if (date === 'blank') {
        reject(r, 'MISSING_DATE_OPT_IN');
        continue;
      }
      if (date === 'bad') {
        reject(r, 'BAD_DATE');
        continue;
      }
      occurred = date.dateOnly ? dateOnlyToTimestamp(date.ts, 'start')! : date.ts;
      if (toEpoch(occurred) > nowT) {
        reject(r, 'FUTURE_DATE');
        continue;
      }
      if (date.dateOnly) notes.add('DATE_ONLY');
      if (mapping.confirmation_date !== undefined) {
        const c = parseDate(get(r.cells, mapping.confirmation_date), mapping.date_format);
        if (c === 'bad') {
          reject(r, 'BAD_DATE');
          continue;
        }
        if (c !== 'blank') {
          confirmAt = c.dateOnly ? dateOnlyToTimestamp(c.ts, 'start')! : c.ts;
          if (toEpoch(confirmAt) > nowT) {
            reject(r, 'FUTURE_DATE');
            continue;
          }
        }
      }
    } else if (date === 'blank' || date === 'bad' || toEpoch(date.dateOnly ? dateOnlyToTimestamp(date.ts, 'start')! : date.ts) > nowT) {
      occurred = now; // rule 4: a restrictive or suppression row is never dropped for a bad date
      notes.add('DATE_DEFAULTED');
    } else {
      const t = date.dateOnly ? dateOnlyToTimestamp(date.ts, 'end')! : date.ts;
      occurred = toEpoch(t) > nowT ? now : t; // rule 3: end of the day, never later than the import time
      if (date.dateOnly) notes.add('DATE_ONLY');
    }
    const hash = identifierHash(args.key, channel, id.value);
    if (args.tombstones.has(hash)) {
      if (kind === 'permissive') reject(r, 'ERASED_IDENTIFIER');
      else done.push({ row: r.row, cells: r.cells, outcome: 'SKIP_ERASED', notes: [], drafts: [] });
      continue;
    }
    candidates.push({ row: r.row, cells: r.cells, hash, channel, purpose, kind, suppression, occurred_at: occurred, confirm_at: confirmAt, notes });
  }

  // Rule 9: ledger order (occurred_at, restrictive last on ties), then content, then row number, so the plan does not
  // depend on how the file was sorted (AC-e2).
  const contentKey = (c: Candidate) => `${c.channel}|${c.purpose ?? ''}|${c.kind}|${c.suppression ?? ''}`;
  candidates.sort(
    (a, b) =>
      toEpoch(a.occurred_at) - toEpoch(b.occurred_at) ||
      (a.kind === 'permissive' ? 0 : 1) - (b.kind === 'permissive' ? 0 : 1) ||
      (contentKey(a) < contentKey(b) ? -1 : contentKey(a) > contentKey(b) ? 1 : 0) ||
      a.row - b.row,
  );

  const existing = (hash: string) => knownAt(args.ledgers[hash]?.events ?? [], now);
  const working = new Map<string, ConsentEvent[]>();
  const workingFor = (hash: string) => {
    if (!working.has(hash)) working.set(hash, [...existing(hash)]);
    return working.get(hash)!;
  };
  const sig = (contact: string, type: string, channel: string | null, purpose: string | null, kind: string | null | undefined, occurred: string) =>
    `${contact}|${type}|${channel}|${purpose ?? ''}|${kind ?? ''}|${toEpoch(occurred)}`;
  const seenInFile = new Set<string>();
  const created = new Set<string>();
  const accepted: { planned: PlannedRow; cand: Candidate; ids: string[] }[] = [];
  let seq = 0;

  for (const c of candidates) {
    const type = c.kind === 'permissive' ? 'OPT_IN' : c.kind === 'restrictive' ? 'OPT_OUT' : 'SUPPRESSION_ADD';
    const purpose = c.kind === 'suppression' ? null : c.purpose;
    const s = sig(c.hash, type, c.channel, purpose, c.suppression, c.occurred_at);
    const inLedger = existing(c.hash).some((e) => sig(c.hash, e.type, e.channel, e.purpose, e.kind, e.occurred_at) === s);
    const contact = { identifier_hash: c.hash, contact_id: args.ledgers[c.hash]?.contact_id ?? null };
    if (inLedger || seenInFile.has(s)) {
      seenInFile.add(s);
      done.push({ row: c.row, cells: c.cells, outcome: 'DUPLICATE', notes: [], contact, drafts: [] });
      continue;
    }
    seenInFile.add(s);
    const events = workingFor(c.hash);
    if (c.kind === 'permissive') {
      // Rule 5, checked first: at the row's own date, does the ledger (plus accepted rows) already say no?
      const v = pairView(replay(occurredBy(events, c.occurred_at)), c.channel, purpose!);
      if (v.global || v.channel || v.purpose) {
        done.push({ row: c.row, cells: c.cells, outcome: 'HOLD_REVIEW', notes: [], contact, drafts: [] });
        continue;
      }
    }
    const base = {
      channel: c.channel,
      recorded_at: now,
      source: mapping.source_label,
      method: 'import' as const,
      evidence_ref: `import/${args.batch_id}#row${c.row}`,
      actor: { kind: 'import' as const, id: args.batch_id },
      verified_channel: null,
    };
    const drafts: EventDraft[] = [{ ...base, type, purpose, occurred_at: c.occurred_at, ...(c.suppression ? { kind: c.suppression } : {}) }];
    if (c.kind === 'permissive' && c.confirm_at) drafts.push({ ...base, type: 'OPT_IN_CONFIRM', purpose: null, occurred_at: c.confirm_at });
    const ids = drafts.map(() => `planned:${args.batch_id}:${(seq += 1)}`);
    drafts.forEach((d, k) => events.push({ ...d, event_id: ids[k]! }));
    if (!args.ledgers[c.hash] && !created.has(c.hash)) {
      created.add(c.hash);
      c.notes.add('CONTACT_CREATED');
    }
    const planned: PlannedRow = { row: c.row, cells: c.cells, outcome: 'APPEND', notes: [], contact, drafts };
    accepted.push({ planned, cand: c, ids });
    done.push(planned);
  }

  // Effect of each accepted permissive row against the final ledger (rules 1 note, 12): with and without it.
  for (const { planned, cand, ids } of accepted) {
    if (cand.kind === 'permissive') {
      const all = working.get(cand.hash)!;
      const s = replay(all);
      const sel = selectRuleSet(config, factValue(s, 'region'), now);
      if (sel.ok) {
        const withIt = pairStatus(s, sel.ruleSet, cand.channel, cand.purpose!);
        const without = pairStatus(replay(all.filter((e) => !ids.includes(e.event_id))), sel.ruleSet, cand.channel, cand.purpose!);
        if (withIt === without) planned.outcome = 'APPEND_NO_EFFECT';
        else if (withIt === 'pending') cand.notes.add('WILL_BE_PENDING_DOUBLE_OPT_IN');
      }
    }
    planned.notes = NOTE_ORDER.filter((n) => cand.notes.has(n));
  }

  done.sort((a, b) => a.row - b.row);
  const summary = Object.fromEntries(IMPORT_OUTCOMES.map((o) => [o, done.filter((r) => r.outcome === o).length])) as Record<ImportOutcome, number>;
  const ledger = Object.keys(args.ledgers)
    .sort()
    .map((h) => ({ hash: h, contact_id: args.ledgers[h]!.contact_id, event_ids: args.ledgers[h]!.events.map((e) => e.event_id).sort() }));
  return { ok: true, plan: { rows: done, summary, ledger_fingerprint: fingerprint({ ledger, tombstones: [...args.tombstones].sort() }) } };
}
