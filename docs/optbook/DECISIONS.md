# optbook — Decisions

**This file outranks the PRD.** If a decision here and a sentence in `PRD.md` disagree, this file wins and the PRD is corrected in the same change. Add new rows at the end with the next number; never renumber. A changed decision gets a new row that names the one it replaces.

The worked examples in `PRD.md` and `GOLDEN-DECISIONS.md` encode these decisions. To change a decision that an example depends on, change the decision first, then the example, deliberately, and say so in the pull request. Never edit an expected value to make a test pass.

## Owner decisions (Shane, given in the task brief of 2026-11-26; not reopened)

| # | Decision | Why |
|---|---|---|
| O-1 | Built on saas-foundation v1.7.0 with the `billing` module removed. | Same as truckroll and holdout. |
| O-2 | Port 8400. | Owner's choice. See D-001. |
| O-3 | Synthetic contacts and data only. Channels are email and SMS. No real sending, ever: send adapters are mocks. | A public repository must be safe to read and to run. |
| O-4 | Not deployed. Never described as live, launched or in production. | It is not. |
| O-5 | Phase 1 is pure engines only (no database writes, no UI), with golden and oracle tests. | The rules are the product; they are proven before anything is stored or drawn. |
| O-6 | A portfolio piece for marketing-ops and applied-AI leadership roles; Lab Intelligence branding where branding appears. | |
| O-7 | Rule sets carry illustrative names; optbook is not legal advice and names no statute; rules needing legal review are flagged. | |

## Judgment calls by the PRD run (unattended, Fable 5.2, 2026-11-26). Each stands until the owner changes it.

| # | Decision | Why | Alternative not taken |
|---|---|---|---|
| D-001 | **Port 8400 is recorded but not verified against the owner's port table.** The cloud session cannot read `~/.claude/CLAUDE.md`. `CLONES.md` at saas-foundation `b3805a8` mentions no 8400 (highest listed: 8300, countersign). "Add 8400 to your port table" is a You step in the pull request. | The only check available here was made. | Stopping for confirmation: the owner said not to ask. |
| D-002 | **`main` holds one commit: the README stub.** Everything else is on `prd` behind a draft pull request. | The brief's Step 0. | |
| D-003 | **Kit layout.** `CLAUDE.md` and `NEXT.md` at the repository root (where turnstile keeps them and where Claude Code reads them); everything else under `docs/optbook/`; golden-case description in `fixtures/README.md`. **The machine-readable golden cases are a fenced block in `docs/optbook/GOLDEN-DECISIONS.md`, not a `.json` file**, because this branch is docs-only. Phase 1 extracts it and checks its SHA-256. | A transcribed table invites transcription errors; a block with a checksum does not. | Committing `fixtures/golden/decisions.json` directly: arguably test data rather than application code, but outside a strict reading of "docs only". |
| D-004 | **Phase 0 uses the tag `v1.7.0` (`4938406`), not saas-foundation `main` (`b3805a8`).** `main` is ahead of the tag. | `FOUNDATION_VERSION` names the release a clone started from and `foundation:drift` compares against it. | Copying `main`: it would drift from its own version file. |
| D-005 | **Phase 0 copies the v1.7.0 tree; optbook does not share git history with the template.** The template tag is fetched into the local repository so `foundation:drift` has something to compare against. Later template releases are hand ports, as tradepost's are. | The brief says to copy the tree, and `main` already has its own root commit. | Rebuilding `main` on the template's history: needs a force-push, which is forbidden. |
| D-006 | **Only `billing` is removed. `notifications`, `sso` and `apikeys` stay, unwired.** optbook's own sends never go through `src/modules/notifications` or any provider SDK; they go through optbook's mock adapters (Phase 2). The foundation's own sign-in email is untouched. | The owner named one module to remove. | Removing `notifications` too, which would make "no real sending" structural; left as a question the owner can take up. |
| D-007 | **Time is UTC, second precision, as strings; the engines never read a clock.** Local time for SMS quiet hours is UTC plus a fixed `utc_offset_minutes` fact. No named zones, no daylight saving. | Deterministic and free of time-zone data. | Named zones through `Intl`: correct across clock changes, but the result then depends on the runtime's zone data. PRD Q-4. |
| D-008 | **Two times per event. `occurred_at` decides which fact wins; `recorded_at` decides what was known when.** A decision at T uses only events with `recorded_at <= T`. | It is the only way to answer both "what should have happened" and "what could we have known". | A single timestamp: a late-arriving opt-out would silently rewrite the explanation of past sends. |
| D-009 | **Scope containment, latest wins, restrictive wins ties.** A restrictive event (global, channel, purpose) stands against an opt-in for a pair unless the opt-in is strictly later. | One rule explains every case and is order-independent. | Independent flags per scope, each cleared only at its own scope: a person could then never re-subscribe to one topic after a channel opt-out. |
| D-010 | **A person's own later opt-in revives exactly that pair, even after a global unsubscribe. An import never can** (it is held for review). | People do come back; systems must not bring them back. PRD Q-3, LR-8. | A global unsubscribe that only an admin can lift. |
| D-011 | **Confirmation is per opt-in.** A pair is confirmed by an `OPT_IN_CONFIRM` on the channel at or after the opt-in, or by an opt-in made in the preference center when the link was delivered on that same channel (`verified_channel`). | An opt-in typed into a form proves nothing about who typed it; a link opened from the address does. | Confirming an address once, forever. |
| D-012 | **Reasons are a closed, ordered set and all applicable reasons are reported, not just the first.** Four codes were added to the owner's list: `NO_RULE_SET_IN_FORCE` (a decision asked for a time before any version of the rule set), `NO_CONSENT`, `TIMEZONE_UNKNOWN`, `ERASED_SUPPRESSED`. Suppression is two codes (`SUPPRESSED_COMPLAINT`, `SUPPRESSED_BOUNCE`). | A campaign builder needs every blocker to fix a send; the added cases exist and need names. | First-match only. |
| D-013 | **Transactional exemptions are data, per channel, with four reasons that can never be exempted** (erasure in progress, erased, complaint, hard bounce). In the illustrative sets an SMS channel opt-out is not exempt; an email one is. | PRD Q-10, LR-4. | Treating transactional as "always send". |
| D-014 | **Lawful basis is functional data with three values:** `consent`, `notice_and_opt_out`, `contract`. | The brief asks for lawful basis as data; a label that changes nothing would be decoration. | |
| D-015 | **Two illustrative rule sets (`RS-STRICT`, `RS-BASELINE`), invented region codes (`R-NORTH`, `R-SOUTH`), default = the strict set, versions selected by `effective_from`.** | No real place or law is implied. | |
| D-016 | **Frequency caps count marketing sends per channel across all purposes, in a window open at the old end** (`at - window < sent_at <= at`). The rule-set cap and the contact's own choice are both checked. Transactional sends are not counted. | PRD Q-12. | |
| D-017 | **Decision-relevant contact facts (`region`, `utc_offset_minutes`) are ledger events (`FACT_SET`).** | A past decision cannot be reproduced if the facts it used have been overwritten. | Columns on the contact row. |
| D-018 | **Erasure keeps the pseudonymous ledger rows and writes keyed-hash tombstones (HMAC-SHA-256) at request time.** The ledger never holds identifiers (L-2), so nothing in it needs deleting. | Append-only and erasable at once; suppression survives; no window for a re-import. PRD Q-1, LR-6. | Purging the contact's events at completion; an unkeyed hash (guessable for email addresses). |
| D-019 | **Erasure policy values are illustrative** (30 days, 5 warning days, 1-hour acknowledgement timeout, five retry delays, six attempts). **The clock never pauses.** | PRD Q-11, LR-5. | |
| D-020 | **Tokens are stateless and HMAC-signed. An expired but correctly signed token still honours an unsubscribe, and nothing else.** | Old messages' unsubscribe links must keep working; an opt-out is safe to accept on weaker proof. | Expired means dead: simpler, and breaks every old link. |
| D-021 | **One-click unsubscribe opts out of every marketing purpose on that channel (as data). `GET` never changes state.** | PRD Q-2. Link scanners fetch URLs. | |
| D-022 | **Import: restrictive rows are easy to accept, permissive rows must prove themselves.** Closed outcome set; declared date format, never guessed; date-only rows placed so the restrictive reading wins; undated opt-ins rejected; a permissive row is held when the ledger says no at the row's own date. | PRD §5e. | Evidence-based auto-approval of held rows. |
| D-023 | **The Phase 1 oracle is a second, deliberately naive TypeScript implementation under `tests/`, compared on seeded random inputs, plus metamorphic properties.** No Python. | The decision is small enough to transcribe directly; a second language adds a toolchain, not independence. | A Python oracle as in turnstile. |
| D-024 | **The catalog, rule sets, region map and policies are JSON files in the repository, validated at load, changed by pull request.** No editor. | The review of a rule change is the pull request. PRD Q-8. | |
| D-025 | **No new roles.** Foundation `owner`/`admin` = marketing ops admin; `member` = campaign builder and reviewer. | Authorization is template-owned. PRD Q-9. | |
| D-026 | **No AI or language model in the decision path, in any phase.** | The product's claim is that a decision can be reproduced and explained. An assistive idea (suggesting an import's column mapping, with a person confirming) is noted as a seam and not planned. | |
| D-027 | **The worked examples were checked against a throwaway implementation that was not committed.** The PRD says plainly what that does and does not show (§10). | Hand-derived tables this size contain slips; a same-author check finds slips, not misunderstandings. | |
| D-028 | **A complaint suppression cannot be cleared in v1.** A hard bounce can, by a user, with evidence. | LR-11. | |
| D-029 | **Email normalization is trim and lowercase only.** No provider-specific rewriting. Phone numbers must arrive with a `+` country prefix. | Guessing which addresses are "the same" is how two people get merged. | |
| D-030 | **Each phase is one branch and one draft pull request, never merged by the run that wrote it.** Phase 0 and Phase 1 branches are cut from `prd` while its pull request is open. | The kit is only on `prd`. | |

## Changes made after the independent review (2026-11-26)

| # | Decision | Why | Alternative not taken |
|---|---|---|---|
| D-031 | **`tombstone_match` means a match with a tombstone written for a different contact.** A contact's own open erasure is reported by `ERASURE_IN_PROGRESS` only. | Tombstones are written at request time (D-018); without this every erasing contact would also match itself and WE-23 would be wrong. Reviewer P-1. | Writing tombstones only at completion. |
| D-032 | **A confirmation covers an opt-in only if it both occurred and was recorded at or after it.** | Otherwise a backdated import of a new purpose borrows an old confirmation. Reviewer P-2. No golden case changed. | |
| D-033 | **A restrictive or suppression import row is never dropped for a bad cell**: a missing, unparseable or future date becomes the import time; a blank or unknown purpose becomes a channel opt-out. Exception: a row naming a non-consentable purpose is rejected for a person to look at. | A list-level unsubscribe export with no purpose column is an ordinary file; rejecting its rows would lose opt-outs. Reviewer M-1. | Rejecting them, as first written. |
| D-034 | **Import details:** `APPEND_NO_EFFECT` applies to permissive rows only; the duplicate key includes `kind`; an imported confirmation carries `method = import`; `DATE_ONLY` is noted on every accepted row whose date cell had no time. | Reviewer X-1, X-2, X-3, M-2: the first draft's table contradicted its own definitions. | |
| D-035 | **No manual do-not-contact suppression kind.** An admin records one as a `GLOBAL_UNSUBSCRIBE` with a user actor and evidence. | Reviewer M-3; one mechanism instead of two. | A `manual` suppression kind. |
| D-036 | **A pending pair toggled on again from a link delivered on that pair's own channel emits a self-confirming opt-in. A channel with no identifier on file is not offered** (`NO_IDENTIFIER`). | Reviewer M-4. | |
| D-037 | **Stored decisions keep their non-event inputs, not only a fingerprint; `exposure` reports hindsight reasons and late events, not only opt-outs; a send is never counted against itself.** | Reviewer X-9. | |
| D-038 | **Not done from the review, on purpose:** complete JSON for the non-decision tables (X-14; mitigated by committing the transcription before engine code and asserting only what the PRD states); region and offset columns in the import mapping (M-5; imported contacts fall under the default rule set); erasure edge cases (P-5; listed as Q-13). | Each is a scope increase the owner should choose. | |

## Decisions for the owner to confirm (defaults in force)

1. **After erasure, keep the pseudonymous ledger rows and stored decisions?** Default: keep (D-018, Q-1).
2. **One-click unsubscribe covers the whole channel?** Default: yes (D-021, Q-2).
3. **A person's own later opt-in can revive a topic after a global unsubscribe?** Default: yes, an import never can (D-010, Q-3).
4. **Fixed UTC offset for quiet hours, not named time zones?** Default: fixed offset (D-007, Q-4).
5. **Transactional SMS is blocked after an SMS channel opt-out, transactional email is not blocked by an email opt-out?** Default: yes, as data (D-013, Q-10).

## Review log

2026-11-26: one fresh agent, given only `PRD.md`, `IMPLEMENTATION_PLAN.md`, `PHASE-0-PLAN.md` and `PHASE-1-PLAN.md`, reviewed as a marketing-ops lead and as a privacy reviewer. It reported 8 must-fix, 15 should-fix and 3 nits, and recomputed all 35 decision rows, the token, hash and canonical-JSON known answers and the erasure table without finding a wrong value. The must-fix items were contradictions between the import table and its definitions, the tombstone and erasure-in-progress overlap, a `pairStatus` test that could not pass, and a commit-ordering error in the Phase 0 plan. All 8 must-fix items and 13 should-fix items were fixed in the documents (D-031 to D-037); what was not done is D-038. Full list in the pull request.
