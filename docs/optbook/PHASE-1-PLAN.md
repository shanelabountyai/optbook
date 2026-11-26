# Phase 1 — Pure engines

Goal: every rule in PRD §4 to §5f exists as a pure TypeScript function under `src/lib/consent/`, and every worked example in the PRD is a passing test. **No database writes, no Prisma model, no migration, no route, no UI, no new dependency.** Input is `fixtures/` loaded read-only by tests; output is green tests and the `consent:eval` table.

Read first: `CLAUDE.md`, `docs/optbook/DECISIONS.md`, `docs/optbook/PRD.md` §4 to §6 and §10, `docs/optbook/GOLDEN-DECISIONS.md`, `fixtures/README.md`. Branch `phase-1` from `phase-0` (from `main` if Phase 0 has been merged). If there is no `package.json` on the branch you would cut from, Phase 0 has not happened: stop and say so.

## Ground rules for this phase

- `src/lib/consent/**` may import only: files in the same directory, `zod`, and `node:crypto` (`createHmac`, `createHash`, `timingSafeEqual` only).
- Forbidden under `src/lib/consent/**`, enforced by `consent:lint`. As import specifiers: anything other than a relative path, `zod` or `node:crypto`. As whole-word identifiers (`\bDate\b`, so `next_allowed_at` and `dueDate`-style names do not trip it): `Date`, `Math.random`, `process`, `fetch`, `setTimeout`, `setInterval`. And floating-point literals.
- Every function takes "now" and all configuration as arguments. Nothing is read from module scope except constants.
- Errors that a caller can cause are returned as values with a code from the PRD, not thrown. A throw means a bug.
- Tests live in `tests/consent/` (the template's vitest config already includes `tests/**/*.test.ts`). They need no database. The naive oracle and the seeded generator live in `tests/consent/oracle/` and are never imported by product code.
- Write the failing test first. Never edit an expected value to pass.

## Order of work

`1.1 scaffold → 1.2 fixtures → time → canonical → schema → ruleset → ledger → decide (+ oracle, properties) → identity → tokens → preferences → erasure → import → audit → 1.15 eval and gate`.

- [ ] **1.1 Scaffold.** Add scripts to `package.json`: `test:consent` (`vitest run tests/consent`), `consent:lint` (`tsx scripts/consent-lint.ts`), `consent:eval` (`tsx scripts/consent-eval.ts`), `fixtures:check` (`tsx scripts/fixtures-check.ts`). The script names must not match `scripts/foundation-*.ts` (template-owned). `consent:eval` prints `0 cases` and exits 0 until 1.15. *Acceptance:* all four commands run; `foundation:drift` still clean.
- [ ] **1.2 Fixtures.** Extract `fixtures/golden/decisions.json` with the command in `GOLDEN-DECISIONS.md`; the SHA-256 must match the one stated there. Write `fixtures/import/im-sample.csv` from the block in `fixtures/README.md`. Transcribe the other tables to `fixtures/golden/{tokens,preferences,identity,erasure,import,audit}.json` in the shape given in `fixtures/README.md`. An `expected` value holds only what the PRD table states (outcome, codes, notes, event types, scopes, timestamps, counts); a field the table does not state is not asserted. These files are your transcription, so commit them in their own commit, before any engine code, and do not touch them afterwards without a `D-` row: that is what makes "never edit an expected value" checkable for them. **Commit the fixtures before any test reads them.** *Acceptance:* `fixtures:check` passes on a clean checkout; a test asserts each file's case ids are exactly those listed in `fixtures/README.md`.

## Modules

Each entry: what goes in, what comes out, what must always hold, and the tests that must exist. "Golden" means every listed case passes with full equality on the expected value.

### 1.3 `time.ts`

- **In:** timestamp strings; integer seconds; `utc_offset_minutes`.
- **Out:** `isTimestamp(s)`, `toEpoch(s) -> integer seconds`, `fromEpoch(n) -> string`, `addSeconds(s, n)`, `localSecondsOfDay(s, offsetMinutes)`, `parseHm("21:00") -> minutes`, `dateOnlyToTimestamp(dateString, "start" | "end")`.
- **Invariants:** only `YYYY-MM-DDTHH:MM:SSZ` is a timestamp (no offsets, no fractions, no lowercase); real calendar dates only (no 02-30; leap years by the Gregorian rule); `fromEpoch(toEpoch(s)) = s`; civil-date arithmetic is integer-only and uses no `Date`.
- **Tests:** round trip over a fixed list including `1970-01-01T00:00:00Z`, `2024-02-29T23:59:59Z`, `2026-11-20T15:00:00Z` (= 1795186800), `2100-03-01T00:00:00Z`; rejects `2026-02-30T00:00:00Z`, `2026-11-20T15:00:00+00:00`, `2026-11-20 15:00:00`, `2026-11-20T15:00:00.000Z`; `localSecondsOfDay("2026-11-21T03:30:00Z", -360)` = 77400 (21:30); negative and positive offsets across midnight.

### 1.4 `canonical.ts`

- **In:** JSON-compatible values. **Out:** `canonicalJson(v) -> string`, `sha256Hex(s)`, `fingerprint(v) = sha256Hex(canonicalJson(v))`.
- **Invariants:** object keys sorted by code unit; arrays keep order; no whitespace; strings as `JSON.stringify` writes them; refuses `undefined`, functions, non-finite and non-integer numbers.
- **Tests:** AU-06 (known answer); `sha256Hex("")` = `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`; key order does not change the fingerprint; each refusal.

### 1.5 `schema.ts`

- **In:** unknown values. **Out:** zod schemas and inferred types for `Catalog`, `ConsentEvent`, `Send`, `RegionMap`, `RuleSet`, `FanoutPolicy`, `TokenPayload`; `validateEvent(e, catalog) -> ok | { error }` with the codes of PRD AC-a1 that do not need the existing ledger.
- **Invariants:** the per-type field table of PRD §4.4; enums are closed; no string field of an event matches an email or phone pattern (L-2).
- **Tests:** every event in `decisions.json` validates; one refused event per error code; an event carrying `ada@example.com` in `source` is refused.

### 1.6 `ruleset.ts`

- **In:** rule sets, region map, a region (or null), a time. **Out:** `validateConfig(config) -> ok | { error, field }`; `selectRuleSet(config, region, at) -> RuleSet`.
- **Invariants:** a version is selected by the latest `effective_from <= at`; unknown or null region gives the map's default; a rule set listing a never-exempt reason under `transactional_exempt_from` is refused; two versions of one id with the same `effective_from` are refused; `at` earlier than every version of the selected id returns `NO_RULE_SET_IN_FORCE` (the decision then denies with that single reason, PRD §5b.1 code 0).
- **Tests:** the config in `decisions.json` validates; `R-NORTH` at 2026-11-30 gives v1 and at 2026-12-01T00:00:00Z gives v2; `R-SOUTH` gives `RS-BASELINE`; `null` and `"R-UNKNOWN"` give `RS-STRICT`; each refusal in PRD AC-b7.

### 1.7 `ledger.ts`

- **In:** a contact's events; a time. **Out:** `knownAt(events, at)`; `latest(events)` (the tie rule of PRD §5a step 1); `checkAppend(existing, candidate, catalog) -> ok | { error }` (adds `DUPLICATE_EVENT_ID`, `CONTACT_ERASED`); `replay(events) -> ContactState` (per pair: `last_in`, standing restrictive events by scope, confirming event; per channel: suppressions, frequency choice; facts; erasure status); `pairStatus(state, ruleSet, channel, purpose) -> on | pending | off`.
- **Invariants:** L-1 to L-5; `replay` is independent of input order; `replay` does not take a rule set (state is facts; the rule set is applied when reading it).
- **Tests:** for each of the 35 cases, `replay` of the known events in listed order, reversed, and in 20 shuffles from seed `20261126` gives deeply equal state; for the cases whose message purpose is marketing-class, `pairStatus` agrees with the expected reasons (on iff none of codes 5 to 9; pending iff `PENDING_DOUBLE_OPT_IN` is the only one of them); `checkAppend` refusals.

### 1.8 `decide.ts`

- **In / out:** PRD §5b signature. `REASON_ORDER` is exported and is the single source of the order.
- **Invariants:** PRD §5b.1 to §5b.5; AC-b2 to AC-b5; all reasons evaluated, none short-circuited; `basis` and reason `detail` as described in `GOLDEN-DECISIONS.md`.
- **Tests:**
  - Golden: WE-01 to WE-35, full deep equality on `expected`.
  - Unit: WE-01's input at `2025-12-31T23:59:59Z` gives `deny` with the single reason `NO_RULE_SET_IN_FORCE` and `rule_set: null`.
  - Oracle (AC-b6): `tests/consent/oracle/naive-decide.ts` is a second implementation written straight from PRD §5a and §5b with plain loops over the raw event list. It must not import `ledger.ts` or `decide.ts`. A generator seeded with `20261126` (a small integer PRNG in the test file) builds 2,000 inputs: 0 to 12 events over both channels and all purposes, timestamps drawn from a small set so that ties are common, `recorded_at` sometimes later than `occurred_at`, 0 to 5 sends, both regions and none, offsets including null. Engine and oracle must agree on all 2,000. Print the count of cases per outcome and per reason code; if any reason code never occurs, widen the generator until each occurs at least once and state the final counts in the pull request.
  - Properties over the same generator: shuffle invariance (AC-b3); monotonicity (AC-b4); knowledge gate (AC-b5); a transactional message is never allowed when any of the four never-exempt reasons applies.

### 1.9 `identity.ts`

- **In:** raw identifier, channel, key. **Out:** `normalizeEmail`, `normalizePhone` (`ok | BAD_IDENTIFIER`), `identifierHash(key, channel, normalized) -> hex`.
- **Invariants:** PRD §5d normalization; hash input is `channel + ":" + normalized`; no provider-specific rewriting.
- **Tests:** ID-01 to ID-04; the same address with different case and padding hashes equally; `a.b@example.com` and `ab@example.com` hash differently.

### 1.10 `tokens.ts`

- **In:** payload, key map, time. **Out:** `issueToken(payload, key) -> string`; `verifyToken(token, keys, at) -> { status, payload?, allows }`; `lifetimeFor(scope, policy)`.
- **Invariants:** PRD §5c token table; constant-time signature comparison; unknown `kid` is `BAD_SIGNATURE`; nothing but `unsubscribe` is ever allowed on an expired token; a payload that fails the schema after a good signature is `MALFORMED`.
- **Tests:** TK-01 to TK-09 (TK-01 byte for byte).

### 1.11 `preferences.ts`

- **In:** contact state, rule set, catalog, a submission, token payload, time. **Out:** `preferenceView(state, ruleSet, catalog)`; `diffPreferences(...) -> EventDraft[] | { error }`; `oneClick(state, ruleSet, tokenPayload, at) -> EventDraft[]`. A draft is an event without `event_id` and `contact_id`.
- **Invariants:** PRD §5c rules 1 to 6; an unchanged submission yields no drafts; every draft passes `validateEvent` once ids are added; a submission can never produce a permissive draft together with a `GLOBAL_UNSUBSCRIBE`.
- **Tests:** PC-01 to PC-07, OC-01 to OC-04; a pending pair toggled on from a link on its own channel emits the opt-in; `NO_IDENTIFIER`; AC-c3 as a property over the generator's states, within the limits AC-c3 states. `preferenceView` and `diffPreferences` take the set of channels the contact has an identifier for.

### 1.12 `erasure.ts`

- **In:** request, registry, policy, tasks, task events, time, identifiers and key. **Out:** `planErasure(...) -> { eventDraft, tombstones, tasks, due_at }`; `applyTaskEvent(task, event, policy) -> task | INVALID_TRANSITION`; `tick(task, at, policy)` (applies a due timeout); `requestStatus(request, tasks, at, policy) -> { state, at_risk, overdue, completed_at?, completed_late?, eventDraft? }` (the completion draft is returned whenever the state is `COMPLETED`; appending it once is the caller's job). `planErasure` returns `ERASURE_ALREADY_OPEN` or `NO_RULE_SET_IN_FORCE` instead of a plan when they apply.
- **Invariants:** PRD §5d table; `max_attempts = backoff_seconds.length + 1` or the policy is refused; an `ACK` is accepted from every state; `ACKED` is terminal; `overdue` is strict (`at > due_at`).
- **Tests:** ER-01 to ER-09; per-task event sequences applied with the events of different tasks interleaved in any order give the same final tasks (AC-d2).

### 1.13 `import.ts`

- **In:** CSV text, mapping, status vocabulary, the affected contacts' ledgers keyed by identifier hash, a tombstone lookup, config, batch id, import time. **Out:** `parseCsv(text) -> rows | { error, row }`; `planImport(...) -> { rows: [{ row, outcome, reason?, notes, drafts }], summary, ledger_fingerprint }`.
- **Invariants:** PRD §5e rules 1 to 13; planning is pure and writes nothing; the plan does not depend on file order (AC-e2); AC-e3.
- **Tests:** IM-01 to IM-18 from `fixtures/import/im-sample.csv` with the summary counts; the same file with its rows reversed and in 20 seeded shuffles gives the same multiset of (row content, outcome, reason, notes) as AC-e2 states; AC-e5 CSV cases; AC-e3 as a property (for generated ledgers and generated permissive-heavy files, no pair that is "no" before is "yes" after applying the plan's drafts).

### 1.14 `audit.ts`

- **In:** as `decide`, plus mode; stored decision records; sends. **Out:** `explain(input, config, mode: "as_known" | "hindsight") -> { decision, trace }`; `exposure(events, sends, config) -> [{ send, hindsight_reasons, late_events: [{ event_id, occurred_at, recorded_at }] }]`; `verifyProof(record, events, config) -> MATCH | { mismatch: fields[] }`.
- **Invariants:** `explain(..., "as_known").decision` deep-equals `decide(...)`; `hindsight` uses every event with `occurred_at <= at` regardless of `recorded_at`; the trace names the event behind each reason and lists `not_yet_known` ids.
- **Tests:** AU-01 to AU-05; AC-f2 over all 35 cases.

- [ ] **1.15 Eval and gate.** `consent:eval` loads every golden file and prints one line per case (`WE-01 allow [] OK`) and totals per file; non-zero exit on any difference. `consent:lint` implemented as the scan described in the ground rules. `fixtures:check` implemented. Add the three commands and `test:consent` to the clone's CI workflow only if the session can push workflow changes; otherwise record it as a You step. Update `NEXT.md` with the gate output as printed, write `docs/optbook/PHASE-2-PLAN.md`, stop.

## Exit criteria

1. `npm run test:consent`: all green. State the number of test files and tests as printed.
2. `npm run consent:eval`: every case `OK`; totals 35 decisions, 9 tokens, 11 preference and one-click, 4 identity, 9 erasure, 18 import cases (19 rows), 6 audit.
3. Oracle: 2,000 of 2,000 agree, with per-outcome and per-reason counts printed.
4. `npm run consent:lint` and `npm run fixtures:check`: clean.
5. `npm run foundation:drift`: clean. `npm run lint` and `npm run typecheck`: clean, or recorded as "could not run here" with the error (typecheck needs the generated Prisma client; if it cannot be generated, run `npx tsc --noEmit -p tsconfig.json` anyway and report whether any error is under `src/lib/consent/`, `tests/consent/` or the three scripts: there must be none).
6. Nothing under `prisma/`, `src/app/`, `src/core/` or `src/modules/` changed.
7. Anything in the PRD that contradicts itself or cannot be built as written is listed in the pull request, not resolved silently. A resolved ambiguity is a `D-` row.

## What to say in the pull request

Counts as printed by the commands. What could not run and why. New `D-` rows. The limits from PRD §10, in one paragraph: two implementations by the same session agreeing with cases written by one earlier run is agreement, not proof.
