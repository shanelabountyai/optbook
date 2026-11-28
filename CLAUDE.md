# CLAUDE.md — optbook

Consent & Preference Center: an append-only consent ledger, a pure send-eligibility decision with ordered reasons, a tokenized preference center, erasure fan-out with a clock and tombstones, a consent-history import with a preview, and proof of any past decision. A learning and portfolio project by Lab Intelligence. **Synthetic data only. Send adapters are mocks, permanently. Not deployed. Not legal advice.** Keep the scope-honesty block from `docs/optbook/PRD.md` verbatim in `README.md`.

Read first, in order: `docs/optbook/DECISIONS.md` (authoritative; outranks the PRD), `docs/optbook/PRD.md` (what), `docs/optbook/IMPLEMENTATION_PLAN.md` (phases and gates), the current phase plan (`docs/optbook/PHASE-0-PLAN.md` or `PHASE-1-PLAN.md`), `fixtures/README.md`. Session state: `NEXT.md`.

## Honesty rules

1. **No invented numbers.** No statistics, market sizes, fines, benchmarks, customer counts or percentages unless a command in this repository printed them, and then with the command. A value chosen for an example is labeled illustrative.
2. **No testimonials, logos, quotes or users.** There are none.
3. **Synthetic data only.** Addresses are on `example.com`; phone numbers are `+1555010xxxx`; names are invented. Never paste a real address, number or export into the repository, a fixture or a test.
4. **Mocks stay mocked.** No provider SDK (email, SMS, CRM, warehouse) is ever added. No real message is ever sent. "Sent" in this codebase means "the mock adapter wrote a row".
5. **Not deployed.** Never write "live", "launched", "in production", "customers" or "users" about optbook. Do not create hosting projects, accounts, domains, environment variables or secrets.
6. **Not legal advice.** Name no statute, regulation, regulator or carrier rule as the source of any behaviour. Rule sets have invented names and illustrative values. Anything a real deployment would need a lawyer for is marked **[legal review]**.
7. **Say what a test shows.** "35 golden cases pass" is a fact; "compliant", "correct" and "never sends to an opted-out contact" are not. The limits are in PRD §10.
8. **Report what could not run.** If a command cannot run in this session, record the command and the error in `NEXT.md` and the pull request. Never write that something passed unless you saw it pass.

## Non-negotiables

1. **The ledger is append-only and is the only truth.** No stored status is read by a decision. Any cache must equal a fresh replay.
2. **The engines are pure.** `src/lib/consent/` imports only itself, `zod` and `node:crypto`. No clock, randomness, network, environment, database, Next.js, `@/core`, `@/modules` or `@/app`. "Now" is an argument. `consent:lint` enforces it.
3. **Order-independent.** The same events in any order give the same state and the same decision.
4. **`occurred_at` decides which fact wins; `recorded_at` decides what was known.** Restrictive wins ties.
5. **Reasons are a closed set in a fixed order, and all that apply are reported.** New codes need a `DECISIONS.md` row first.
6. **An import never turns a no into a yes.** It is held for a person.
7. **Erasure, complaint and hard bounce are never exempted**, for any purpose, whatever the rule-set data says.
8. **No identifiers in the ledger.** No event field holds an address, a number or a name.
9. **Integers and strings only.** No floats in engine data. Timestamps are `YYYY-MM-DDTHH:MM:SSZ` strings; arithmetic is integer seconds. `Date` is not used under `src/lib/consent/`.
10. **Golden values are frozen.** Never edit an expected value to pass a test. If the engine and a golden case disagree, stop and show the owner both derivations.
11. **Rules are data.** Nothing regional, no cap, window, lifetime or delay is hard-coded in an engine; it comes from the validated config.
12. **Template-owned paths are never edited** (`src/core/**`, `src/modules/**`, `prisma/schema/core.prisma`, core migrations, `tests/invariants/**`, `scripts/foundation-*.ts`, the security routes). `npm run foundation:drift` enforces it. One owner-confirmed exception (D-056, O-8): back-relation lines added to `model Org` in `core.prisma`, each ending `// app`.

## Working rules

- **Phase gate.** Do not start a phase until the previous phase's exit criteria pass. Phases: 0 clone setup, 1 pure engines, 2 schema and persistence, 3 UI and preference center, 4 demo seed, e2e and closeout. Write the next phase's plan at the gate and stop for review.
- **Test first.** Write the failing test against a golden case, then the code.
- **Branch and draft pull request. Never merge. Never force-push. Never commit to `main`.** Never mark a pull request ready for review.
- Small commits, one concern each, naming files explicitly (never `git add -A`).
- **Ask before adding a dependency.** In an unattended run, do not add it: write the small thing yourself and record the choice. Specifically not without asking: a CSV parser, a date or time-zone library, a state-machine library, a validation library other than `zod`, any provider SDK, any AI SDK.
- **Judgment calls** go in `docs/optbook/DECISIONS.md` as the next `D-` row and in the pull request body.
- **Cloud sessions** may not be able to download Prisma engines or Playwright browsers, or start Postgres. Record exactly what could not run; CI decides.
- End every session by updating `NEXT.md`: what was built, what was decided, what is open, and the gate output as printed.

## Stack

TypeScript on a tree copy of saas-foundation v1.7.0 (Next.js 16, Prisma 7, PostgreSQL 17, vitest, Playwright). Port 8400. `billing` removed; `notifications`, `sso` and `apikeys` kept and unwired (D-006). No shared git history with the template (D-005): upgrades are hand ports, and the template tag is fetched locally for `foundation:drift`.

## Commands (created in Phase 1 unless noted)

- `npm run test:consent` — `vitest run tests/consent`: engine tests; need no database
- `npm run consent:lint` — fails on a forbidden import or token under `src/lib/consent/`
- `npm run consent:eval` — runs every golden case and prints one line per case plus totals; exits non-zero on any difference
- `npm run fixtures:check` — re-extracts the golden block from `docs/optbook/GOLDEN-DECISIONS.md`, compares it and its SHA-256 with `fixtures/golden/decisions.json`, and fails if `fixtures/` has uncommitted changes
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run foundation:drift` — from the template (Phase 0)

## Definition of done (any task)

Tests green, or recorded as "could not run here" with the command and error. `consent:eval` matches every golden case. `consent:lint` and `fixtures:check` clean. `DECISIONS.md` updated if a rule changed. `NEXT.md` updated. Numbers, not adjectives, in commit messages and the pull request.
