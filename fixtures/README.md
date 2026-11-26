# fixtures

Golden cases for the optbook engines. **Everything here is synthetic**: addresses are on `example.com`, phone numbers are `+1555010xxxx`, names are invented, `evidence_ref` values point at nothing, and the signing key `test-only-key-not-a-secret` is a test fixture that must never be used for anything else.

On the `prd` branch this directory holds only this file. Phase 1 creates the files below. Product code never writes here and never reads an `expected` value; only tests and `consent:eval` do.

## Rules

1. **Never edit an expected value to make a test pass.** If the engine and a golden case disagree, stop and show the owner both derivations.
2. To change a golden case: change `docs/optbook/DECISIONS.md` first, then the PRD table, then the fixture, in one pull request that says why.
3. `npm run fixtures:check` must pass in CI: the decisions file matches the block in `docs/optbook/GOLDEN-DECISIONS.md` and its SHA-256, and nothing under `fixtures/` is modified or untracked after the tests run.

## Files

| File | Source of truth | Cases | Made how |
|---|---|---|---|
| `golden/decisions.json` | `docs/optbook/GOLDEN-DECISIONS.md` (the fenced JSON block) | WE-01 to WE-35 | Extracted byte for byte with the `awk` command in that document; SHA-256 checked. Also carries the config (catalog, region map, rule sets) that every other test loads. |
| `golden/tokens.json` | PRD §5c token table | TK-01 to TK-09 | Transcribed by Phase 1. TK-01's token string is a known-answer value. |
| `golden/preferences.json` | PRD §5c | PC-01 to PC-07, OC-01 to OC-04 | Transcribed. Starting states refer to decision cases by id (`WE-01`, `WE-08`) and reuse their events. |
| `golden/identity.json` | PRD §5d | ID-01 to ID-04 | Transcribed. Two hashes are known-answer values. |
| `golden/erasure.json` | PRD §5d | ER-01 to ER-09 | Transcribed, including the fan-out policy values. |
| `golden/import.json` and `import/im-sample.csv` | PRD §5e | IM-01 to IM-18 (19 rows) | The CSV is the block below, byte for byte. The JSON holds the ledger before the import, the tombstoned address, the mapping, the import time, the expected outcome, notes and events per row, and the summary counts. |
| `golden/audit.json` | PRD §5f | AU-01 to AU-06 | Transcribed. AU-06's hash is a known-answer value. |

Each transcribed file has the shape `{ "schema": "optbook.golden.<name>/1", "cases": [ { "id", "title", "input", "expected" } ] }`. A test asserts the ids present in each file are exactly the ids listed above, so a case cannot be dropped quietly.

## The decision cases, by what they pin down

| Cases | What they pin down |
|---|---|
| WE-01 to WE-04 | opt-in with and without confirmation; a rule set that does not require confirmation; no consent at all |
| WE-05 to WE-08, WE-12 | purpose, channel and global opt-outs; other purposes unaffected; three standing opt-outs reported in order |
| WE-09, WE-10 | a person's own later opt-in revives exactly one pair after a global unsubscribe |
| WE-11 | opt-in and opt-out at the same second: the restrictive event wins |
| WE-13 to WE-16, WE-32 | SMS quiet hours: inside, both boundaries, unknown offset, `next_allowed_at` before and after midnight |
| WE-17 to WE-19, WE-32, WE-34, WE-35 | frequency caps: at the cap, the window's old edge, the contact's own choice, two reasons at once, rule-set versions |
| WE-20 to WE-23, WE-26 | transactional exemptions and the reasons that are never exempt |
| WE-24, WE-25 | hard-bounce suppression and its clearing |
| WE-27, WE-28 | an opt-out that happened before a send but was recorded after it |
| WE-29 | an identifier that matches an erasure tombstone |
| WE-30, WE-31 | a purpose on a notice-and-opt-out basis |
| WE-33 | an SMS opt-in made from a link delivered by email is not self-confirming |

## `import/im-sample.csv`

Mapping: identifier = `email`, channel = constant `email`, purpose = `topic`, status = `status`, date = `date`, confirmation date = `confirmed`, date format `iso`, source label `crm_import`. Import time `2026-11-20T15:00:00Z`. Row 2 has a trailing space after the address, inside quotes. Row numbers used in `evidence_ref` start at 1 for the first data row.

```csv
email,topic,status,date,confirmed
ada@example.com,newsletter,subscribed,2026-02-01,
"Ada@Example.com ",newsletter,subscribed,2026-09-01,
ada@example.com,newsletter,unsubscribed,2026-06-10T09:00:00Z,
ada@example.com,promotional,unsubscribed,,
ada@example.com,promotional,subscribed,,
new.person@example.com,newsletter,yes,2026-10-05,
not-an-email,newsletter,yes,2026-10-05,
ada@example.com,newsletter,cleaned,2026-05-01,
ada@example.com,newsletter,subscribed,2027-01-01,
gone@example.com,newsletter,subscribed,2026-10-05,
gone@example.com,newsletter,unsubscribed,2026-10-05,
ada@example.com,transactional,unsubscribed,2026-10-05,
ada@example.com,newsletter,unsubscribed,2026-07-04,
bo@example.com,newsletter,subscribed,2026-08-08,
bo@example.com,newsletter,unsubscribed,2026-08-08,
ada@example.com,newsletter,subscribed,03/04/2025,
cy@example.com,newsletter,bounced,2026-10-01,
di@example.com,newsletter,subscribed,2026-10-05,2026-10-06
,newsletter,yes,2026-10-05,
```

Rows 1 to 13 are IM-01 to IM-13; rows 14 and 15 are IM-14; rows 16 to 19 are IM-15 to IM-18.

## The oracle's inputs are not fixtures

The seeded random cases used to compare the engine with the naive reference (PRD AC-b6) are generated inside the test from the seed `20261126` and are not written to disk.
