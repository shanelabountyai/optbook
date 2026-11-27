# NEXT

## ▶ 2026-11-26 (Fable 5.2, scheduled run, nobody watching): PRD and kickoff kit written on branch `prd`. Draft pull request open, not merged. Nothing is built.

What exists:

- `main`: one commit, the README stub.
- `prd`: this file, `CLAUDE.md`, `docs/optbook/PRD.md`, `DECISIONS.md`, `IMPLEMENTATION_PLAN.md`, `PHASE-0-PLAN.md`, `PHASE-1-PLAN.md`, `GOLDEN-DECISIONS.md`, and `fixtures/README.md`. Documents only: no application code, no template files, no `package.json`.

What was decided: owner decisions O-1 to O-7 and judgment calls from D-001 on, in `docs/optbook/DECISIONS.md`. Five are flagged for the owner to confirm; defaults are in force.

What was checked: the 35 send-eligibility cases were generated from a throwaway implementation (not committed) and the JSON block's SHA-256 was verified by extracting it with the command in `GOLDEN-DECISIONS.md`. The token and hash known-answer values were computed with Node's `crypto`. The other example tables (preferences, erasure, import, audit) were derived by hand. An independent agent reviewed the PRD and plans (8 must-fix, 15 should-fix, 3 nits); what was fixed is D-031 to D-037, what was not is D-038, and the full list is in the pull request. The import table was corrected by that review, so treat the import rules as the least-settled part of the PRD.

What was not checked: nothing was installed, built or run against the template. Port 8400 was checked against `CLONES.md` only.

**Next, in order:**

1. **Phase 0** (`docs/optbook/PHASE-0-PLAN.md`): copy the saas-foundation v1.7.0 tree, `npm run new-project -- optbook 8400`, remove `billing`, add the scope banner, run the gate. Branch `phase-0` from `prd`.
2. **Phase 1** (`docs/optbook/PHASE-1-PLAN.md`): the pure engines under `src/lib/consent/` with golden and oracle tests. Branch `phase-1` from `phase-0`.
3. Stop. Write `docs/optbook/PHASE-2-PLAN.md` at the gate and wait for review.

**Yours (Shane):**

- Review and merge (or redirect) the `prd` pull request.
- Add 8400 to the port table in `~/.claude/CLAUDE.md`.
- After Phase 0 lands: add the optbook row to saas-foundation's `CLONES.md` (text in `PHASE-0-PLAN.md`).
- Answer the five decisions in `DECISIONS.md`, the first one first: keep the pseudonymous ledger rows after erasure, or purge them?
