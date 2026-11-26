# optbook — Implementation plan

What is built, in what order, and what has to be true before the next phase starts. The PRD says what and why; `DECISIONS.md` settles disputes; this file is the order of work. The template's own plan stays at the repository root as `IMPLEMENTATION_PLAN.md` after Phase 0 and is not this document.

## Rules for every phase

- One branch (`phase-N`), one draft pull request, never merged by the run that wrote it, never force-pushed. `main` receives nothing directly.
- A phase starts only when the previous phase's exit criteria have been seen to pass, or have been recorded as "could not run here" with CI green on the pull request.
- The next phase's detailed plan (`PHASE-N-PLAN.md`) is written at the gate, then the run stops for review.
- Template-owned paths are never edited. `npm run foundation:drift` stays clean.
- Every judgment call becomes a `D-` row.

## Phase 0 — Clone setup

Detail: `PHASE-0-PLAN.md`. Output: the v1.7.0 tree, renamed, `billing` removed, scope banner in README. No product code.

## Phase 1 — Pure engines

Detail: `PHASE-1-PLAN.md`. Output: `src/lib/consent/` (twelve modules), `tests/consent/`, `fixtures/golden/`, three scripts. No database writes, no Prisma model, no route, no UI, no new dependency.

Exit: all golden cases pass (35 decisions plus the token, preference, identity, erasure, import and audit tables); the oracle comparison and the properties pass; `consent:lint`, `consent:eval` and `fixtures:check` clean; `foundation:drift` clean.

## Phase 2 — Schema, persistence, RLS and export hooks (shape only; plan written at the Phase 1 gate)

Clone-owned Prisma file `prisma/schema/optbook.prisma` and its own migrations, dated after the template's newest migration.

| Table | Holds | Notes |
|---|---|---|
| `Contact` | opaque id, display name | the only place, with `ContactIdentifier`, where personal data lives |
| `ContactIdentifier` | channel, normalized value | deleted at erasure completion; unique per org, channel and value |
| `ConsentEvent` | the ledger, fields as PRD §4.4 | **append-only by database trigger**: `UPDATE` and `DELETE` raise; hand-written SQL in the migration |
| `SendLog` | mock sends: contact, channel, purpose, `sent_at`, decision id | written only by the mock adapters |
| `DecisionRecord` | every decision made for a send: inputs fingerprint, outcome, reasons, rule set and version | |
| `EvidenceSnapshot` | small JSON per `evidence_ref` | deleted at erasure completion |
| `ErasureRequest`, `ErasureTask` | the request, its clock, one task per downstream system | task payloads scrubbed on acknowledgement |
| `Tombstone` | keyed hash, channel, status (`active`, `lifted`), request id | never deleted |
| `ImportBatch`, `ImportRow` | a preview and its row outcomes; held rows and their resolution | |

- Every table carries `orgId`. RLS policies are generated with `npm run rls:policies` and committed. Each table is listed in `src/app/export-hooks.ts` as exported (safe columns only) or in `exportSkipped` with a reason; the template's invariant tests fail otherwise. Whether `Tombstone` hashes belong in an export is decided in the Phase 2 plan.
- Config (`config/optbook/*.json`: catalog, rule sets, region map, fan-out policy, status vocabulary, token lifetimes) is loaded and validated at start; an invalid file stops the app with the field name.
- Keys (token signing, tombstone hashing) are read through the foundation's env module. Phase 2 decides how without editing template-owned files; until then the engines take keys as arguments and tests use the fixture key.
- Services wrap the engines: append (validate, then insert), decide-and-record, mock send, erasure worker (cron entry in the clone-owned `src/app/cron-jobs.ts`), import preview and commit.
- Mock adapters only: `MockEmailAdapter`, `MockSmsAdapter`, and four mock downstream systems with scripted outcomes (acknowledge, refuse, stay silent) so retries can be shown. A lint check fails on any provider SDK import.

Exit: every Phase 1 golden case gives the same result when its events are written to the database and read back; PRD AC-a3, AC-a5, AC-d4, AC-d5, AC-e4; template invariants green with the new tables; `foundation:drift` clean.

## Phase 3 — UI and preference center (shape only)

- Admin, under `/o/[org]/`: contacts list; contact page with the ledger timeline and the "why" explainer (as known, and in hindsight); eligibility checker for an audience and a message; imports (mapping, preview, commit, held rows); erasure queue with the clock; rule sets, read-only; exemption-use and late-opt-out reports.
- Public, tokenized, no login: preference center, one-click unsubscribe (`GET` renders, `POST` acts), confirmation link. Rate-limited. Neutral responses for bad tokens.
- Lab Intelligence branding in the footer and page titles; the scope banner on every public page.
- Accessibility: keyboard reachable, labeled controls, no information by color alone, checked with an automated pass and by hand.

Exit: PRD AC-c4 to AC-c6, AC-d6, AC-e6, AC-f4.

## Phase 4 — Demo seed, e2e, closeout (shape only)

- A seeded synthetic org (fixed seed; size chosen then and stated as a count, not a claim) covering every reason code, one held import, one overdue erasure.
- Playwright paths: one per user in PRD §2.
- README: what optbook is, the scope block, what was measured (counts printed by commands) and what was not. Closeout notes and build-log draft.

Exit: e2e green in CI; nothing in the README that a command did not print.

## Risks

| Risk | What is done about it |
|---|---|
| A rule in the PRD is wrong or reads as legal advice | Independent review before the pull request; every regional rule is data and flagged; the owner confirms five defaults |
| Golden cases and the engine share one author's misunderstanding | Stated in PRD §10 and never described as verification |
| The cloud session cannot generate the Prisma client or start Postgres | Phase 1 needs neither; later phases record what could not run and let CI decide |
| No shared history with the template makes upgrades manual | Accepted (D-005); `foundation:drift` still guards template-owned paths |
| Scope creep toward a real sender | Mocks only is an owner decision (O-3) and a lint check from Phase 2 |
