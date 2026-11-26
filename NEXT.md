# NEXT

## ▶ 2026-11-26 (scheduled run, nobody watching): Phase 0 and Phase 1 built on branch `kickoff`, draft pull request against `prd`. Not merged. Not deployed.

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
