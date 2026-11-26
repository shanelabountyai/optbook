# Phase 0 — Clone setup

Goal: the optbook repository contains the saas-foundation v1.7.0 tree, renamed to `optbook` on port 8400, with the `billing` module removed and the scope-honesty block in the README. No optbook product code. One branch, one draft pull request, not merged.

Read `CLAUDE.md` and `docs/optbook/DECISIONS.md` first. If your run prompt and this plan disagree, the run prompt wins; record the difference as a `D-` row.

## Facts measured on 2026-11-26 (by the run that wrote this plan)

- saas-foundation tag `v1.7.0` is commit `4938406`; its `FOUNDATION_VERSION` file reads `v1.7.0`. Template `main` is `b3805a8` and differs from the tag only under `audit/`. **Use the tag** (D-004).
- The tag's tree has 431 files. The only path it shares with this kit is `NEXT.md`. It has no `CLAUDE.md`, no `fixtures/`, no `docs/optbook/`. It does have a root `IMPLEMENTATION_PLAN.md` (the template's own; keep it, optbook's is under `docs/optbook/`).
- `CLONES.md` mentions no port 8400 (D-001).
- A dry run of steps 2 to 5 in a scratch directory gave: `new-project` rewrote `package.json`, `playwright.config.ts`, `.github/workflows/ci.yml` and `README.md`; `removeModule('.', 'billing')` left `notifications,sso,apikeys` present; `npm run foundation:drift` printed `foundation:drift: clean against v1.7.0 (modules removed: billing)`.
- In that sandbox `npm ci` installed the packages but its `postinstall` (`prisma generate`) failed: `binaries.prisma.sh` was refused by the network policy (403). Without the generated client, `tsc --noEmit` reported 177 errors, all downstream of the missing `src/generated/`. **Expect the same in a cloud session. Do not work around a network refusal. Record it; CI decides.**

## Steps

1. **Branch.** In a clone of `shanelabountyai/optbook`:
   ```bash
   git fetch origin
   git checkout -b phase-0 origin/prd        # the kit lives on prd until its pull request is merged; use origin/main if prd has been merged
   ```
   Stop with a notification if `phase-0` already exists on the remote, or if `package.json` already exists on the branch you cut from.

2. **Copy the v1.7.0 tree** (a tree copy, not shared history: D-005).
   ```bash
   GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch v1.7.0 https://github.com/shanelabountyai/saas-foundation.git ../saas-foundation-v1.7.0
   test "$(cat ../saas-foundation-v1.7.0/FOUNDATION_VERSION)" = "v1.7.0"
   git -C ../saas-foundation-v1.7.0 archive v1.7.0 | tar -x --exclude=NEXT.md -C .
   git fetch --depth 1 ../saas-foundation-v1.7.0 tag v1.7.0      # foundation:drift diffs against this tag
   ```
   The template's `README.md` replaces the repository's stub `README.md` on purpose (step 4 rewrites it); it is not a kit file. The kit's `NEXT.md`, `CLAUDE.md`, `docs/optbook/` and `fixtures/README.md` must be unchanged afterwards: check with `git status --short -- NEXT.md CLAUDE.md docs/optbook fixtures`, which must print nothing. Copy the whole tree; do not prune `spikes/`, `audit/` or the template's own documents.
   **Commit now, before anything is changed: commit (a), "saas-foundation v1.7.0 tree as copied"**, staging the top-level paths by name (`git add .env.example .github .gitignore BACKLOG.md ...`; list them with `git status --short`), never `git add -A`, and never the kit files.

3. **Install.** `npm ci`. If `postinstall` fails on the Prisma download, record the exact error, confirm `node_modules/` exists, and continue.

4. **Rename.** `npm run new-project -- optbook 8400`. Run it once only; a second run is refused. It cannot read the owner's port table from the cloud; that is expected (D-001).

5. **Remove `billing`**, using the recipe the template ships as code:
   ```bash
   npx tsx -e "import('./scripts/foundation-modules.ts').then(m => { m.removeModule('.', 'billing'); console.log('present:', m.presentModules().join(',')); })"
   ```
   It must print `present: notifications,sso,apikeys`. This deletes the six paths listed under `billing` in `scripts/foundation-modules.ts` and the lines marked `// billing` or `{/* billing */}` in the marked files, as the README's "Removing a module" section describes. Leave everything else: the `STRIPE_*` names in `.env.example` stay (an invariant test pins that file to `src/core/env.ts`), the billing tables stay in the migration history, and other mentions of billing inside template-owned files are not yours to edit. Do not remove `notifications`, `sso` or `apikeys` (D-006).

6. **README.** Directly under the banner line that `new-project` wrote, insert a one-paragraph description ("optbook: Consent & Preference Center...") and the scope-honesty block from `docs/optbook/PRD.md`, verbatim, including "not deployed" and "not legal advice". Add one line pointing to `docs/optbook/PRD.md` and `CLAUDE.md`. Leave the template's README text below it.

7. **Gate.** Run each and record the last lines of output, or the exact error, in `NEXT.md`:
   ```bash
   npm run foundation:drift      # must print: clean against v1.7.0 (modules removed: billing)
   npm run lint
   npm run typecheck             # needs the generated Prisma client
   npm run build                 # needs the generated Prisma client
   npm test                      # needs a local Postgres 17 and npm run db:setup
   git ls-files | grep -iE "\.env|secret|credential|\.pem$|\.key$"     # after staging: only .env.example may appear
   ```
   `foundation:drift` must pass here; it needs nothing from the network. It compares only template-owned paths (`src/core`, `src/modules`, `src/proxy.ts`, `prisma/schema`, `prisma/migrations`, `tests/invariants`, `scripts/foundation-*.ts`, `FOUNDATION_VERSION` and the security routes); `README.md`, `package.json`, `.github/workflows/ci.yml`, `playwright.config.ts`, other `scripts/`, `src/lib/`, `tests/consent/`, `fixtures/` and `docs/` are clone-owned and cannot cause drift. If the `grep` prints a path other than `.env.example`, list the paths in the pull request and leave the files alone (they are template source files whose names contain those words, not secrets); if one actually holds a secret value, stop and notify. For the others, "could not run here: <command>: <error>" is an acceptable result in a cloud session; a failure that is not about the environment is not, and is reported, not fixed inside template-owned paths.

8. **Commit the rest**, naming paths (never `git add -A`). Commit (a) was made in step 2. Now: (b) the `new-project` rewrite and the `billing` removal; (c) the README block, `NEXT.md`, and any new `DECISIONS.md` rows. End each message with the attribution lines your session gives you.

9. **Push and open a draft pull request** `optbook: Phase 0 clone setup` against `main`. Say in the body that it includes the `prd` commits until that pull request is merged, list what ran and what could not, and repeat the hold line: do not merge until Shane reviews. Never merge, never force-push, never mark ready.
   If the push is refused because the session may not write `.github/workflows/`, commit everything else, leave `ci.yml` out, record the exact error, and add a You step asking Shane to add the file.

## Exit criteria

- `foundation:drift` clean against v1.7.0 with `billing` removed (seen, not assumed).
- `package.json` name is `optbook`; dev and start scripts use port 8400.
- `src/modules/billing`, `prisma/schema/billing.prisma`, `src/app/api/webhooks/stripe`, `src/app/o/[org]/settings/billing`, `tests/invariants/inv-12-webhooks.test.ts` and `e2e/billing.spec.ts` do not exist.
- README carries the scope-honesty block verbatim.
- Kit files unchanged except `NEXT.md` and `DECISIONS.md`.
- Every gate command is recorded as passed (with output) or as "could not run here" (with the error).
- No `src/lib/consent/`, no Prisma model, no migration, no route added.

## Hand steps for Shane (the template is read-only from the cloud)

- Add 8400 to the port table in `~/.claude/CLAUDE.md`.
- After Phase 0 is merged, add this row to saas-foundation's `CLONES.md` (adjust the date and wording to what actually landed):

  ```
  | optbook | [shanelabountyai/optbook](https://github.com/shanelabountyai/optbook) (public) | v1.7.0 | 2026-11-26 (Phase 0: tree copy of v1.7.0, no shared history, `billing` removed); consent & preference center (append-only consent ledger, pure send-eligibility decision, preference center, erasure fan-out, import preview); port 8400; not deployed, synthetic only, send adapters are mocks |
  ```
- If CI is red only because of something Phase 0 could not run locally, that is the signal to look; nothing was assumed green.
