# NEXT

## ▶ 2026-11-28: Shane confirmed the open decisions (O-8 to O-12 in `DECISIONS.md`)

D-056 (the `// app` lines in `core.prisma`, now named in `CLAUDE.md` non-negotiable 12), D-058, D-061, D-066, D-067, D-069, D-074, D-075, D-047, D-048 and the five defaults stand as owner decisions. D-072 stands as written: `RLS_ENFORCE` is not set. PRD IM-17 now writes `OPT_IN_CONFIRM(email, newsletter)` (D-048). The Phase 2 plan (#3) is merged to `main`; the next run builds Phase 2 on branch `phase-2` from `main`.

Still yours: add the optbook row to saas-foundation's `CLONES.md` (text in `PHASE-0-PLAN.md`); add port 8400 to your port table in `~/.claude/CLAUDE.md`; set `RLS_ENFORCE=1` if and when you want the RLS leg in CI.

---

## Earlier: 2026-11-27 (scheduled run, nobody watching): Phase 2 plan written; next run builds Phase 2 on these defaults unless Shane changes a D-row.

State: `main` = `7ce7212` with the PRD kit (#1) and Phase 0 + Phase 1 (#2) merged and CI green (`ci (off)`, `modules-removed`). This run added documents only, on branch `phase-2-plan`, as a draft pull request against `main`. **No product code. Not deployed.**

What was written:

- `docs/optbook/PHASE-2-PLAN.md`: eleven tables (named, not written), three migrations (named), a service-contracts table, thirteen work items in build order with their files and acceptance, 16 exit criteria, the PRD items Phase 2 closes and how each is shown, the Phase 1 items carried with the default that stands, and "Not in Phase 2".
- `docs/optbook/DECISIONS.md`: D-055 to D-077 and a review-log entry (appended; no earlier row changed).
- `docs/optbook/PRD.md`: two one-sentence annotations pointing at D-061 (L-1) and D-074 (§5e), because `DECISIONS.md` requires the PRD to be corrected in the same change.

What was checked: one fresh agent reviewed the first draft against the PRD, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, `CLAUDE.md` and the Phase 1 code (6 must-fix, 17 should-fix, 8 nits; it ran no test). Five must-fix items were fixed in the plan; the sixth (D-056 against `CLAUDE.md` non-negotiable 12) is kept as the default and is your first hand step. 15 should-fix items were fixed; what was not changed and why is D-077.

### Gate output (this session, as printed)

| Command | Result |
|---|---|
| `npm ci` | exit 1: `postinstall` `prisma generate` refused by the network policy, as in D-041. `node_modules/` installed. Not worked around. |
| `npm run lint` | exit 0: `✖ 1 problem (0 errors, 1 warning)` (template file `src/app/org-hooks.ts`, `'orgId' is defined but never used`) |
| everything else | not run: this change is documents only. CI on the pull request is the gate. |

Nothing in the plan was run against Postgres. One assumption in it is explicitly untested (work item 2.3: a child table's delete trigger during an org-deletion cascade); the plan says what to do if it fails.

**Next, in order:**

1. Shane reviews the Phase 2 plan pull request and confirms or reverses the D-rows below.
2. The next run builds Phase 2 on branch `phase-2` from `main`, following `docs/optbook/PHASE-2-PLAN.md`, on these defaults unless a D-row has changed.
3. At the Phase 2 gate: write `docs/optbook/PHASE-3-PLAN.md` and stop for review.

**Yours (Shane):**

- You: confirm or reverse D-056 (back-relation lines in `prisma/schema/core.prisma` ending `// app`; `CLAUDE.md` non-negotiable 12 reads stricter). This is the first thing the build needs.
- You: confirm or reverse D-058 (keys derived from `AUTH_SECRET`; rotating it breaks tombstone matching), D-061 (four append-only tables; deleting an org removes its ledger), D-066 (the uploaded import file is kept until commit, discard or expiry), D-067 (preference, one-click, confirm and held-row services wait for Phase 3), D-069 (exports carry no addresses, numbers or names), D-074 (`recorded_at` is the commit time for imports, and one second after a same-second decision), D-075 (two added fields in the Phase 1 import engine).
- You: decide whether to set the repository variable `RLS_ENFORCE=1`; until then RLS behaviour is unverified in CI (D-072).
- You: still open from Phase 1: D-047, D-048 and the five defaults in `DECISIONS.md`.
- You: still open from Phase 0: add the optbook row to saas-foundation's `CLONES.md` (text in `PHASE-0-PLAN.md`) and port 8400 to your port table in `~/.claude/CLAUDE.md`.

---

## Earlier: 2026-11-26 (scheduled run): Phase 0 and Phase 1 built on branch `kickoff`. Since merged to `main` (#1, #2).

What exists:

- `main`: the README stub only.
- `prd`: the PRD and kickoff kit (its own draft pull request, #1). **Review that first.**
- `kickoff` (cut from `prd`, one branch for both phases, D-039):
  - Phase 0, three commits: the saas-foundation v1.7.0 tree (314 files, D-040), `new-project optbook 8400`, `billing` removed by `removeModule`, the scope-honesty block in `README.md` (verbatim, checked with `cmp`).
  - Phase 1: `src/lib/consent/` (12 pure modules), `tests/consent/` (14 test files), `fixtures/golden/*.json` and `fixtures/import/im-sample.csv` (committed before any engine code), `scripts/consent-lint.ts`, `consent-eval.ts`, `fixtures-check.ts`, four npm scripts, three CI steps.

What was decided: D-039 to D-054 in `docs/optbook/DECISIONS.md`. For Shane: D-048 (an imported confirmation carries the row's purpose, which differs from the PRD's IM-17 text) and D-047 (an unknown message channel or purpose throws; no new reason code).

What was checked: an independent agent reviewed the diff against the PRD and Phase 1 plan (2 must-fix, 7 should-fix, 3 nits). Both must-fix items were handled: the proof fingerprint was fixed; the import reject order is recorded (D-049). Six should-fixes were fixed with regression tests (`tests/consent/review-regressions.test.ts`). Open: the nits (caller-input throws, D-047; `fixtures:check` only sees uncommitted fixture edits; the AC-d2 interleaving test cannot fail by construction).

### Gate output (this session, as printed)

| Command | Result |
|---|---|
| `npm ci` | exit 1: `postinstall` `prisma generate` refused, `binaries.prisma.sh ... 403 Forbidden (agent proxy: no rule or network setting allows this host)`. `node_modules/` installed. Not worked around (D-041). |
| `npm run lint` | exit 0: `✖ 1 problem (0 errors, 1 warning)` (template file `src/app/org-hooks.ts`) |
| `npm run typecheck` | exit 2: 177 errors, all from the missing generated Prisma client (`@/generated/prisma/*`); 0 under `src/lib/consent/`, `tests/consent/` or the three scripts |
| `npm test` | exit 1: `Test Files 39 failed \| 18 passed (57)`, `Tests 288 passed (288)`. The 39 are template files that fail to load without `@/generated/prisma/client` and `.env.test` (`Invalid environment: DATABASE_URL, AUTH_SECRET, APP_URL`); none is a consent file. Same 39 as at Phase 0. |
| `npm run build` | exit 1: `Turbopack build failed with 6 errors`, all `Module not found: Can't resolve '@/generated/prisma/...'` |
| `npm run test:consent` | exit 0: `Test Files 14 passed (14)`, `Tests 193 passed (193)` |
| `npm run consent:eval` | exit 0: `decisions 35/35, tokens 9/9, preferences 11/11, identity 4/4, erasure 9/9, import 19/19, audit 6/6; 93/93 OK`; `oracle: 2000/2000 agree` |
| `npm run consent:lint` | exit 0: `12 files, 0 problem(s)` |
| `npm run fixtures:check` | exit 0: `sha256 63d21b97…bb64; clean` |
| `npm run foundation:drift` | exit 0: `clean against v1.7.0 (modules removed: billing)` |

CI is the gate for typecheck, build and the template's tests (it can download Prisma engines and runs Postgres 17).

**Next, in order:**

1. Shane reviews the `prd` pull request, then this one.
2. If CI is red, look at which step: Phase 0 could not run typecheck, build or the template tests here.
3. At the Phase 1 gate: write `docs/optbook/PHASE-2-PLAN.md` (not written in this run, D-054) and stop for review.

**Yours (Shane):**

- Add the optbook row to saas-foundation's `CLONES.md` (text in `PHASE-0-PLAN.md`).
- Add port 8400 to your port table in `~/.claude/CLAUDE.md`.
- Confirm or reverse D-048 and D-047, and the five defaults in `DECISIONS.md`.
