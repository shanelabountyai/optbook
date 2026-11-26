# PRD: optbook — Consent & Preference Center

Status: draft for owner review, written 2026-11-26 by an unattended run. Nothing is built yet.
Companion documents: `DECISIONS.md` (authoritative; outranks this PRD where they differ), `IMPLEMENTATION_PLAN.md`, `PHASE-0-PLAN.md`, `PHASE-1-PLAN.md`, `GOLDEN-DECISIONS.md`, `../../fixtures/README.md`.

## Scope honesty (read first; copy this block into README.md verbatim in Phase 0)

> **optbook is a learning and portfolio project. It is not deployed and has no users.** Every contact, address, phone number, consent record and send in it is synthetic. It never sends a real email or SMS: the send adapters are mocks that write to a table. **optbook is not legal advice.** Its rule sets have invented names and illustrative values; they do not describe, and are not derived from, any law, regulation or carrier policy. Anything marked **[legal review]** is a rule a real deployment would need a qualified person to decide. Built by Lab Intelligence as a build-log project.

## 1. Problem

A marketing team's record of who may be contacted usually lives in several systems at once: the email platform, the SMS provider, the CRM, a webinar tool, a spreadsheet from an old migration. Each holds part of the story, each is updated on its own schedule, and none of them can say why it believes what it believes. The result is predictable: someone unsubscribes in one place and is emailed from another; a list import quietly switches people back on; an erasure request is actioned in the CRM and forgotten in the warehouse; and when a person asks "why did you message me?", nobody can reconstruct what was known at the moment of the send.

optbook is one place that answers a single question, the same way every time, with its reasons: **may we send this message, of this purpose, on this channel, to this contact, at this time?** It answers from an append-only record of consent events, never from a stored status field, so the answer can be re-derived for any past moment.

## 2. Users

| User | What they need |
|---|---|
| **Marketing ops admin** | One trustworthy source for "can we send". Imports old consent history without switching anyone back on. Sees every held or rejected import row with the reason. Owns rule-set configuration (with legal sign-off). |
| **Campaign builder** | Before a send: how many of this audience are eligible, and why the rest are not, in words they can act on (wait until 08:00, over the weekly cap, never confirmed). Cannot override a deny. |
| **The contact** | A preference page that needs no login, shows what they are subscribed to, lets them choose topics, channel and frequency, and has an unsubscribe that works in one step and keeps working from old messages. |
| **Privacy / legal reviewer** | For any contact and any past moment: what was known, which rule set applied, what the decision was and why. For any erasure request: which systems confirmed, when, and what is overdue. |

## 3. Goals and non-goals

**Goals**

1. Current consent state is always derived by replaying the ledger. Nothing else is the truth.
2. The send-eligibility decision is a pure function: same inputs, same output, with every applicable reason in a fixed order.
3. Restrictive facts are easy to record; permissive facts must prove themselves. An import can never turn a "no" into a "yes" on its own.
4. Erasure reaches every downstream system, is tracked per system against a clock, and leaves suppression working afterwards.
5. Any past decision can be reproduced from stored data and explained.
6. Regional rules and lawful basis are data, versioned by effective date, with nothing regional hard-coded.

**Non-goals** (seams are noted; none of this is built)

- Real sending, real provider accounts, deliverability, templates or a campaign scheduler. Send adapters are mocks, permanently.
- Deployment. The project is not deployed; no hosting, domains or environment configuration are part of any phase.
- Legal advice, a compliance certification, or a claim that any rule set matches any jurisdiction.
- Cookie or tracking consent, ad-platform audiences, data-subject access requests other than erasure, and data-processing records.
- Channels other than email and SMS (push, postal, phone calls, messaging apps).
- Identity resolution across people (merging two contacts, households, shared inboxes). One contact has at most one email address and one phone number in v1; address changes are an open question (Q-6).
- Consent of minors, sensitive-category data, and consent given on someone else's behalf.
- Any AI or language model in the decision path. Decisions are deterministic so they can be explained and reproduced (D-026).
- A rule-set editor. Rule sets are reviewed JSON files (D-024).

## 4. Vocabulary and data model

### 4.1 Tenancy

An **org** is the company whose marketing team uses optbook (the saas-foundation tenant). Everything below is scoped to one org. A **contact** is a person the org might message; a contact is not a user and never signs in.

### 4.2 Channels and purposes (the catalog, data)

Channels: `email`, `sms`.

| Purpose | Class | Consentable |
|---|---|---|
| `newsletter` | marketing | yes |
| `product_updates` | marketing | yes |
| `promotional` | marketing | yes |
| `transactional` | transactional | no (cannot be opted in or out of; see §5b.5) |

The catalog also holds the preference-center frequency choices: `standard` (no personal cap), `weekly` (1 marketing message per 7 days per channel), `monthly` (1 per 30 days per channel). Illustrative values.

### 4.3 Time

- Every timestamp is a UTC string `YYYY-MM-DDTHH:MM:SSZ`, second precision. Strings in this form compare correctly as text.
- The engines never read a clock. "Now" is always an argument.
- Each event has two times. `occurred_at` is when the thing happened (the person clicked, the form was submitted). `recorded_at` is when optbook's ledger learned of it. `occurred_at <= recorded_at` always; an event dated in the future is refused.
- **`occurred_at` decides which fact wins. `recorded_at` decides what was known at a given moment.** (D-008)
- Local time, needed only for SMS quiet hours, is UTC plus the contact's fixed `utc_offset_minutes`. There is no daylight-saving or named-zone handling in v1 (D-007, Q-4).

### 4.4 The consent event

```
ConsentEvent {
  event_id         string, unique, opaque (generated outside the engines)
  contact_id       string, opaque, never an address or phone number
  type             OPT_IN | OPT_IN_CONFIRM | OPT_OUT | GLOBAL_UNSUBSCRIBE | FREQUENCY_SET
                   | SUPPRESSION_ADD | SUPPRESSION_CLEAR | ERASURE_REQUESTED | ERASURE_COMPLETED | FACT_SET
  channel          email | sms | null
  purpose          a catalog purpose | null
  occurred_at      timestamp (captured-at)
  recorded_at      timestamp
  source           string: the system the event came from (web_form, preference_center, crm_import, esp_mock, ...)
  method           form | import | preference_center | api | double_opt_in_confirm | one_click | system
  evidence_ref     string | null: an opaque pointer to proof (a form snapshot, an import row); never the proof itself
  actor            { kind: contact | user | system | import, id?: string }
  verified_channel email | sms | null: the channel whose address the actor proved control of when acting
  -- type-specific --
  kind             hard_bounce | complaint          (SUPPRESSION_*)
  choice           a frequency choice key           (FREQUENCY_SET)
  fact, value      region | utc_offset_minutes      (FACT_SET)
}
```

Field rules by type (anything else is refused at append with a named error):

| Type | channel | purpose | Notes |
|---|---|---|---|
| `OPT_IN` | required | required, consentable | `evidence_ref` required unless `method = import` with a row reference (which is itself the evidence) |
| `OPT_IN_CONFIRM` | required | optional (`null` = every purpose on that channel) | `method` must be `double_opt_in_confirm` |
| `OPT_OUT` | required | optional (`null` = the whole channel) | purpose, if given, must be consentable |
| `GLOBAL_UNSUBSCRIBE` | null | null | all channels, all marketing purposes |
| `FREQUENCY_SET` | required | null | `choice` must be a catalog key |
| `SUPPRESSION_ADD` | required | null | `kind` required |
| `SUPPRESSION_CLEAR` | required | null | `kind` must be `hard_bounce`; `actor.kind` must be `user`; `evidence_ref` required. A complaint cannot be cleared in v1 (D-028) |
| `ERASURE_REQUESTED` / `ERASURE_COMPLETED` | null | null | |
| `FACT_SET` | null | null | decision-relevant contact facts are events so that past decisions can be reproduced (D-017) |

Ledger invariants:

- **L-1 Append-only.** Events are never updated or deleted. A mistake is corrected by a later event.
- **L-2 No identifiers.** No event field holds an email address, a phone number or a name. Identifiers live only on the contact record.
- **L-3 State is derived.** There is no stored "subscribed" flag that the decision reads. Any cached state must equal a fresh replay and may be discarded at any time.
- **L-4 Order-independent.** Replaying the same set of events in any order gives the same state and the same decision.
- **L-5 Closed after erasure.** After `ERASURE_COMPLETED`, no further event is accepted for that contact.

### 4.5 Rule sets (data)

A rule set is a JSON document with an id, a version and an `effective_from` time. The version in force at time T is the one with the latest `effective_from <= T`. A contact's rule set is chosen by its `region` fact through a region map; an unknown or missing region gets the map's default, which is configured to be the strictest set (D-015). Region codes (`R-NORTH`, `R-SOUTH`) and rule-set names (`RS-STRICT`, `RS-BASELINE`) are invented and correspond to no real place or law.

| Field | Meaning | `RS-STRICT` v1 | `RS-BASELINE` v1 |
|---|---|---|---|
| `lawful_basis` per purpose **[legal review]** | `consent` = an opt-in is required. `notice_and_opt_out` = no opt-in is required, opt-outs are honoured. `contract` = transactional. | all marketing purposes `consent` | `product_updates` is `notice_and_opt_out`; others `consent` |
| `double_opt_in.required_channels` **[legal review]** | channels where an opt-in must be confirmed | `email`, `sms` | none |
| `double_opt_in.self_confirming_methods` | methods that count as confirmed when `verified_channel` equals the event's channel | `preference_center` | `preference_center` |
| `quiet_hours` **[legal review]** | channels, local `start`, local `end`, and what to do when the offset is unknown | `sms`, 21:00 to 08:00, deny | same |
| `frequency` | marketing messages allowed per channel in a window | 7 days: email 3, sms 2 | 7 days: email 5, sms 3 |
| `transactional_exempt_from` **[legal review]** | per channel, the deny reasons a transactional message bypasses | email: `GLOBAL_UNSUBSCRIBE`, `CHANNEL_OPT_OUT`, `FREQUENCY_CAP`. sms: `GLOBAL_UNSUBSCRIBE`, `TIMEZONE_UNKNOWN`, `QUIET_HOURS`, `FREQUENCY_CAP` | same |
| `erasure.sla_days` **[legal review]** | days allowed to complete an erasure | 30 | 30 |
| `one_click.scope` **[legal review]** | what a one-click unsubscribe opts out of | `channel` | `channel` |

`RS-STRICT` v2 (effective `2026-12-01T00:00:00Z`) is identical to v1 except the email cap is 2. It exists so that rule-set versioning is tested (WE-34, WE-35). All numbers in this table are illustrative.

## 5. Capabilities

### 5a. Consent ledger

**Behaviour.** Every change to what a contact has agreed to is one appended event (§4.4). The contact's state is computed by replaying the events known at the moment of interest.

**How state is derived** for a channel `c` and purpose `p`, from the events known at time T (those with `recorded_at <= T`):

1. `last_in` is the `OPT_IN` for exactly `(c, p)` with the latest `occurred_at` (ties: latest `recorded_at`, then greatest `event_id`).
2. A restrictive event **stands** if there is no `last_in`, or its `occurred_at >= last_in.occurred_at`. At the same second, the restrictive event wins (D-009).
3. Three restrictive scopes cover the pair: `GLOBAL_UNSUBSCRIBE`; `OPT_OUT(c, null)`; `OPT_OUT(c, p)`.
4. The pair is **confirmed** if `last_in.method` is self-confirming and `last_in.verified_channel = c`, or there is an `OPT_IN_CONFIRM` for channel `c` (purpose `p` or `null`) with `occurred_at >= last_in.occurred_at`.
5. A suppression of a kind on a channel is in force if there is a `SUPPRESSION_ADD` for it with no `SUPPRESSION_CLEAR` of the same channel and kind strictly later.
6. Facts and the frequency choice take the latest `FACT_SET` / `FREQUENCY_SET` by the same tie rule as step 1.

Consequence worth stating plainly: a later opt-in by the person revives exactly the pair they opted in to, even after a global unsubscribe (WE-09), and nothing else (WE-10). Whether that is acceptable is **[legal review]** (LR-8) and a decision for the owner.

**Acceptance criteria**

- AC-a1. Appending validates the type-specific field rules in §4.4 and refuses with a named error: `UNKNOWN_CHANNEL`, `UNKNOWN_PURPOSE`, `PURPOSE_NOT_CONSENTABLE`, `MISSING_FIELD:<name>`, `BAD_TIMESTAMP`, `OCCURRED_AFTER_RECORDED`, `DUPLICATE_EVENT_ID`, `METHOD_NOT_ALLOWED`, `COMPLAINT_NOT_CLEARABLE`, `CONTACT_ERASED`.
- AC-a2. For every worked example in §6, replaying the events in the listed order, in reverse, and in 20 seeded shuffles gives the same state.
- AC-a3. No code path updates or deletes an event (Phase 2: enforced by a database trigger and a test that tries).
- AC-a4. A validation test refuses any event whose string fields match an email or phone pattern (L-2).
- AC-a5. The state shown anywhere in the product equals a fresh replay (Phase 2 and 3: a test compares them after every write path).

### 5b. Send-eligibility decision

**Signature.**

```
decide({ at, message: { channel, purpose }, events, recent_sends, tombstone_match }, config) -> Decision

Decision {
  outcome   allow | deny
  reasons   [{ code, detail }]            in the fixed order below
  rule_set  { id, version }
  basis     { lawful_basis, opt_in_event_id | null, confirm_event_id | null }
}
```

`events` are the contact's ledger events (the function ignores those not yet known at `at`). `recent_sends` is the contact's send log: `{ channel, purpose, sent_at }`. `tombstone_match` says whether the contact's identifier on this channel matches an active erasure tombstone (§5d); the caller does the lookup. `config` is the catalog, the region map and the rule sets.

**5b.1 Reasons.** A closed set, evaluated in full (not first-match) and reported in this order:

| # | Code | Raised when |
|---|---|---|
| 0 | `NO_RULE_SET_IN_FORCE` | no version of the contact's rule set has `effective_from <= at`. Reported alone, nothing else is evaluated, and it can never be exempted |
| 1 | `ERASURE_IN_PROGRESS` | an `ERASURE_REQUESTED` is known and no `ERASURE_COMPLETED` |
| 2 | `ERASED_SUPPRESSED` | `tombstone_match` is true, or an `ERASURE_COMPLETED` is known |
| 3 | `SUPPRESSED_COMPLAINT` | a complaint suppression is in force on the channel |
| 4 | `SUPPRESSED_BOUNCE` | a hard-bounce suppression is in force on the channel |
| 5 | `GLOBAL_UNSUBSCRIBE` | a global unsubscribe stands (§5a step 2) |
| 6 | `CHANNEL_OPT_OUT` | a channel opt-out stands |
| 7 | `PURPOSE_OPT_OUT` | a purpose opt-out stands |
| 8 | `NO_CONSENT` | lawful basis is `consent` and there is no `last_in` |
| 9 | `PENDING_DOUBLE_OPT_IN` | lawful basis is `consent`, there is a `last_in`, none of 5 to 7 is raised, the rule set requires confirmation on the channel, and the pair is not confirmed |
| 10 | `TIMEZONE_UNKNOWN` | the channel has quiet hours, the offset fact is missing, and the rule set says deny |
| 11 | `QUIET_HOURS` | the channel has quiet hours and local time at `at` is inside `[start, end)`; detail carries `next_allowed_at` (UTC) |
| 12 | `FREQUENCY_CAP` | a cap is reached (5b.3); detail lists each cap reached with its source, count, max and window |
| 13 | `TRANSACTIONAL_EXEMPTION` | informational, always last: lists the reasons a transactional message bypassed (5b.5) |

`outcome` is `deny` if any reason other than `TRANSACTIONAL_EXEMPTION` remains; otherwise `allow`. `NO_RULE_SET_IN_FORCE`, `NO_CONSENT`, `TIMEZONE_UNKNOWN` and `ERASED_SUPPRESSED` were added to the owner's list of reasons because the cases exist and need a name (D-012).

**5b.2 Quiet hours.** Local seconds-of-day = `(at + utc_offset_minutes * 60) mod 86400`. With `start` 21:00 and `end` 08:00 the window wraps midnight: inside if local time `>= 21:00:00` or `< 08:00:00`. 21:00:00 is inside; 08:00:00 is outside. `next_allowed_at` is the next local `end`, converted back to UTC.

**5b.3 Frequency.** Count the contact's sends in `recent_sends` on the same channel whose purpose is marketing-class, with `at - window < sent_at <= at`. A send exactly one window old is outside. Two caps may apply: the rule set's, and the contact's own choice (`weekly`, `monthly`) with its own window. Each is checked separately; the reason is raised if `count >= max` for either. Transactional sends are never counted.

**5b.4 Rule-set selection.** Region is the latest `region` fact known at `at`; the rule set comes from the region map (default if absent); the version is the one in force at `at`.

**5b.5 Transactional messages.** For a message whose purpose is transactional-class, all reasons are computed as usual, then those listed in the rule set's `transactional_exempt_from` for the channel are removed and named in a final `TRANSACTIONAL_EXEMPTION` reason. Four reasons can never be exempted, whatever the data says (the rule-set schema refuses them): `ERASURE_IN_PROGRESS`, `ERASED_SUPPRESSED`, `SUPPRESSED_COMPLAINT`, `SUPPRESSED_BOUNCE`. In the illustrative rule sets an SMS channel opt-out is not exempt, so a contact who has stopped all SMS receives no transactional SMS either (WE-21) **[legal review]** (LR-4).

The decision trusts the purpose the message declares. Guarding that declaration is a product control, not an engine one: only an admin can mark a message as transactional (Phase 3), every use of an exemption is stored with the decision, and the audit view lists them.

**Acceptance criteria**

- AC-b1. `decide` reproduces all 35 worked examples in §6: outcome, reason codes in order, reason details, rule set and version, and basis, exactly as in `GOLDEN-DECISIONS.md`.
- AC-b2. `decide` is pure: `consent:lint` finds no clock, randomness, network, environment, database or framework import under `src/lib/consent/`.
- AC-b3. Shuffling `events` or `recent_sends` never changes the output.
- AC-b4. Monotonicity: adding one restrictive event (`OPT_OUT`, `GLOBAL_UNSUBSCRIBE`, `SUPPRESSION_ADD` or `ERASURE_REQUESTED`) with `occurred_at = recorded_at = at` to any input never changes a `deny` to an `allow`.
- AC-b5. Knowledge gate: adding any event with `recorded_at > at` never changes the output.
- AC-b6. The production engine and a deliberately naive second implementation agree on 2,000 seeded random cases (§10 says what that does and does not prove).
- AC-b7. A rule set that lists a never-exempt reason under `transactional_exempt_from`, has overlapping versions with the same `effective_from`, or names an unknown channel or purpose is refused at load with the field name.

### 5c. Preference center

**Behaviour.** A page the contact reaches from a tokenized link. It shows each marketing purpose per channel as on, pending confirmation, or off; the frequency choice per channel; and a global unsubscribe. Transactional messages are shown as always on, with one sentence of explanation, and cannot be toggled. Saving the page appends only the events needed to get from the current state to the submitted one.

**Tokens.** `v1.<payload>.<signature>`: the payload is canonical JSON (keys sorted, no whitespace), base64url; the signature is HMAC-SHA-256 over `v1.<payload>` with an org signing key, base64url. Payload: `{ v, kid, org, cid, scope, ch, pur, mid, iat, exp }` with `iat`/`exp` in epoch seconds; `ch` is the channel the link was delivered on. Nothing is stored server-side; a key id (`kid`) allows rotation.

| Scope | Lifetime (illustrative) | When valid, allows | When expired but correctly signed, allows |
|---|---|---|---|
| `preferences` | 30 days | view, edit, unsubscribe | unsubscribe only |
| `unsubscribe` | 400 days | unsubscribe | unsubscribe |
| `confirm` | 7 days | confirm | nothing (a fresh confirmation message must be requested) |

A token is valid when `iat <= at < exp`. **An expired token never shows or changes preferences, but a correctly signed one still honours an unsubscribe**: an old message's unsubscribe link must not stop working, and an opt-out is the one action that is safe to accept on weaker proof (D-020) **[legal review]** (LR-8).

**One-click unsubscribe.**

- A `GET` on an unsubscribe link never changes anything; it renders a page with one button. Mail scanners and link previews fetch links, and a fetch must not unsubscribe anyone or count as proof of anything.
- A `POST` with the token performs the unsubscribe with no login, no further question and no second page required. It is idempotent.
- What it opts out of comes from the rule set's `one_click.scope`: `channel` (default: every marketing purpose on the channel the message was delivered on), `purpose`, or `global`. The confirmation page then offers the narrower and wider choices. (D-021)
- An inbound SMS `STOP` is mapped by the mock SMS adapter to `OPT_OUT(sms, null)` with `method = api`. Other keywords are out of scope.

**Rules for turning a submission into events** (`diffPreferences`):

1. Purpose toggled on where the pair is off: `OPT_IN(channel, purpose)`, `method = preference_center`, `verified_channel` = the token's `ch`. Where the pair is already on or pending: nothing.
2. Purpose toggled off where the pair is on or pending: `OPT_OUT(channel, purpose)`. Already off: nothing.
3. Frequency choice changed: `FREQUENCY_SET`.
4. Global unsubscribe ticked: one `GLOBAL_UNSUBSCRIBE`, and every permissive change in the same submission is dropped. If a global unsubscribe already stands for every marketing pair, nothing.
5. A submission that mentions a non-consentable purpose is refused whole with `PURPOSE_NOT_CONSENTABLE`.
6. All events from one submission share `occurred_at = recorded_at = at`. Drafts are ordered by catalog channel, then catalog purpose, then frequency.

| ID | Starting state | Action | Result |
|---|---|---|---|
| PC-01 | WE-01 contact | save with nothing changed | no events |
| PC-02 | WE-01 contact | email: newsletter off, product_updates on (link delivered by email) | `OPT_OUT(email, newsletter)`; `OPT_IN(email, product_updates)` with `verified_channel = email` |
| PC-03 | WE-01 contact | email frequency `standard` to `weekly` | `FREQUENCY_SET(email, weekly)` |
| PC-04 | WE-01 contact | global unsubscribe ticked and product_updates turned on | `GLOBAL_UNSUBSCRIBE` only |
| PC-05 | WE-08 contact (globally unsubscribed) | email newsletter turned on, global not ticked (link delivered by email) | `OPT_IN(email, newsletter)`; afterwards email/newsletter is on and sms/promotional is still off |
| PC-06 | WE-01 contact, `RS-STRICT` | sms promotional turned on from a link delivered by email | `OPT_IN(sms, promotional)` with `verified_channel = email`; the pair shows as pending (WE-33) until a confirmation sent to the phone is answered |
| PC-07 | any | submission includes `transactional` | refused, `PURPOSE_NOT_CONSENTABLE`, no events |
| OC-01 | WE-01 contact | `POST` one-click, token `scope = unsubscribe`, `ch = email`, rule scope `channel` | `OPT_OUT(email, null)`, `method = one_click` |
| OC-02 | after OC-01 | the same `POST` again | no events |
| OC-03 | WE-01 contact | the same `POST` with the token one second past `exp` | `OPT_OUT(email, null)` (expired tokens still unsubscribe) |
| OC-04 | WE-01 contact | `POST` with one character of the signature changed | no events; `BAD_SIGNATURE` |

| ID | Token case (key `test-only-key-not-a-secret`, a test fixture, never a real key) | Expected |
|---|---|---|
| TK-01 | issue `{ v:1, kid:"k1", org:"org_demo", cid:"c_0001", scope:"unsubscribe", ch:"email", pur:"newsletter", mid:"m_0042", iat:1795186800, exp:1829746800 }` (issued 2026-11-20T15:00:00Z, 400 days) | exactly `v1.eyJjaCI6ImVtYWlsIiwiY2lkIjoiY18wMDAxIiwiZXhwIjoxODI5NzQ2ODAwLCJpYXQiOjE3OTUxODY4MDAsImtpZCI6ImsxIiwibWlkIjoibV8wMDQyIiwib3JnIjoib3JnX2RlbW8iLCJwdXIiOiJuZXdzbGV0dGVyIiwic2NvcGUiOiJ1bnN1YnNjcmliZSIsInYiOjF9.Fg3OxE2vsphw91pscUUxpk3y_azqJEnhXxi50OQjQDc` |
| TK-02 | verify TK-01 at `iat` | `VALID`, allows `[unsubscribe]` |
| TK-03 | verify TK-01 at `exp - 1` | `VALID` |
| TK-04 | verify TK-01 at `exp` | `EXPIRED`, allows `[unsubscribe]` |
| TK-05 | a `confirm` token verified at its `exp` | `EXPIRED`, allows `[]` |
| TK-06 | TK-01 with the last signature character changed | `BAD_SIGNATURE` |
| TK-07 | TK-01 verified with a key map that has no `k1` | `BAD_SIGNATURE` (an unknown key is not distinguished from a wrong one) |
| TK-08 | `v1.abc` (two parts) | `MALFORMED` |
| TK-09 | verify TK-01 at `iat - 1` | `NOT_YET_VALID` |

**Acceptance criteria**

- AC-c1. PC-01 to PC-07, OC-01 to OC-04 and TK-01 to TK-09 pass as written. TK-01 is a known-answer test: the token string must match byte for byte.
- AC-c2. Signature comparison is constant-time.
- AC-c3. Applying the events from `diffPreferences` and rendering again shows the submitted state, except pairs that are pending confirmation.
- AC-c4. (Phase 3) `GET` on any tokenized route performs no write. A test fetches every public route and asserts the event count is unchanged.
- AC-c5. (Phase 3) A bad, malformed or unknown-contact token renders the same neutral page and status, so the route cannot be used to test whether a contact exists.
- AC-c6. (Phase 3) Public routes are rate-limited with the foundation's limiter.

### 5d. Erasure requests

**Behaviour.** An erasure request starts a clock and fans out one task per downstream system through an outbox. Each system must acknowledge. Failures are retried on a schedule; a task that exhausts its retries is flagged for a person. When every system has acknowledged, the contact's personal data is removed from optbook, and a tombstone keeps the person suppressed.

**What happens, in order**

1. **Request recorded.** An `ERASURE_REQUESTED` event is appended; from that second every send is denied, transactional included (WE-23). `due_at = requested_at + sla_days` from the contact's rule set at that time.
2. **Tombstones written at request time**, one per identifier the contact has: `HMAC-SHA-256(org tombstone key, channel + ":" + normalized identifier)`, hex. Writing them now, not at completion, closes the gap in which an import could re-create the person (D-018).
3. **Tasks planned**, one per system in the downstream registry. The registry is data; in this project every system is a mock (`esp_mock`, `sms_gateway_mock`, `crm_mock`, `warehouse_mock`).
4. **Tasks run** through the state machine below.
5. **Completion.** When all tasks are `ACKED`: an `ERASURE_COMPLETED` event is appended; the contact record (identifiers, name) and stored evidence are deleted; task payloads are scrubbed. What remains: the ledger events (which hold no identifiers, L-2), stored decisions, the tombstones, and the request with its per-system acknowledgements. Keeping the pseudonymous ledger rows and a keyed hash after erasure is **[legal review]** (LR-6) and the first question for the owner.

**Identifier normalization.** Email: trim, lowercase, must match `local@domain.tld` with no spaces. No provider-specific rewriting (no dot or plus-tag stripping) (D-029). Phone: remove spaces, hyphens, dots and parentheses; the result must match `+` followed by 8 to 15 digits, first digit not zero. A number without a `+` country prefix is refused, never guessed.

| ID | Input | Normalized | Hash with key `test-only-key-not-a-secret` |
|---|---|---|---|
| ID-01 | `"  Ada.Lovelace@Example.COM "` (email) | `ada.lovelace@example.com` | `8690b981d53beeebcb93393d94c8a35453b3bf7018d47ffcfd06c86a12912b96` |
| ID-02 | `"+1 (555) 010-0199"` (sms) | `+15550100199` | `79af8db2075c8d79d46afeadc08aed2e439cf25aa70d069d47d353cc3e7528d7` |
| ID-03 | `"555 010 0199"` (sms) | refused: `BAD_IDENTIFIER` | none |
| ID-04 | `"ada@@example.com"`, `"ada@example"`, `""` (email) | refused: `BAD_IDENTIFIER` | none |

**Task state machine.** Fan-out policy (data, illustrative): `ack_timeout_seconds = 3600`; `backoff_seconds = [300, 1800, 7200, 43200, 86400]`; `max_attempts = 6` (always `backoff_seconds.length + 1`); `warn_days = 5`.

| From | Event | To | Effect |
|---|---|---|---|
| `PENDING` | `ATTEMPT(at)` | `SENT` | `attempts + 1`; `last_attempt_at = at` |
| `RETRY_WAIT` | `ATTEMPT(at)`, `at >= next_attempt_at` | `SENT` | same |
| `SENT` | `ACK(at)` | `ACKED` | `acked_at = at` |
| `SENT` | `NACK(at)`, or no `ACK` by `last_attempt_at + ack_timeout_seconds` | `RETRY_WAIT` if `attempts < max_attempts`, else `DEAD` | `next_attempt_at = failure time + backoff_seconds[attempts - 1]` |
| `PENDING`, `RETRY_WAIT`, `DEAD` | `ACK(at)` | `ACKED` | a late or out-of-order acknowledgement is always accepted |
| `ACKED` | anything | `ACKED` | no change |
| `DEAD` | `REQUEUE(at)` by a user | `RETRY_WAIT` | `attempts = 0`; `requeues + 1`; `next_attempt_at = at` |
| any other pair | | unchanged | returns `INVALID_TRANSITION` |

**Request status** at time `at`: `COMPLETED` if every task is `ACKED` (`completed_at` = the latest `acked_at`; `completed_late` if that is after `due_at`); else `BLOCKED` if any task is `DEAD`; else `IN_PROGRESS`. Two flags on any request that is not completed: `at_risk` when `at >= due_at - warn_days`; `overdue` when `at > due_at`. The clock never pauses (D-019) **[legal review]** (LR-5).

| ID | Setup (request at 2026-11-01T00:00:00Z, 30 days, so `due_at` = 2026-12-01T00:00:00Z) | Expected |
|---|---|---|
| ER-01 | plan for a contact with an email and a phone, 4 systems | 1 `ERASURE_REQUESTED` draft, 2 tombstones, 4 tasks `PENDING` |
| ER-02 | all 4 tasks attempted at 00:01:00 and acknowledged, the last at 00:10:00 | `COMPLETED`, `completed_at` 2026-11-01T00:10:00Z, not late; one `ERASURE_COMPLETED` draft |
| ER-03 | `crm_mock`: `ATTEMPT` 00:01:00, `NACK` 00:01:05 | `RETRY_WAIT`, `attempts = 1`, `next_attempt_at` 2026-11-01T00:06:05Z |
| ER-04 | `crm_mock`: `ATTEMPT` 00:01:00, nothing further; status asked at 01:01:00 | `RETRY_WAIT`, `next_attempt_at` 2026-11-01T01:06:00Z (timeout at 01:01:00 plus 300 s) |
| ER-05 | `crm_mock` fails 6 attempts | `DEAD` after the sixth; request `BLOCKED` |
| ER-06 | one task still `RETRY_WAIT`; status asked at 2026-11-25T23:59:59Z, 2026-11-26T00:00:00Z, 2026-12-01T00:00:00Z, 2026-12-01T00:00:01Z | `at_risk` false, true, true, true; `overdue` false, false, false, true |
| ER-07 | the `DEAD` task of ER-05 receives `ACK` at 2026-12-03T10:00:00Z, the others acknowledged earlier | task `ACKED`; request `COMPLETED`, `completed_late` true |
| ER-08 | a second `ACK` for an `ACKED` task | no change, no error |
| ER-09 | `ATTEMPT` on a task in `RETRY_WAIT` one second before `next_attempt_at` | `INVALID_TRANSITION`, task unchanged |

**Re-subscribing after erasure.** A tombstone blocks imports and any contact created by a system. If the same person later opts in themselves, through a form with a confirmed opt-in, the tombstone is marked lifted (never deleted) and a new contact starts with an empty ledger. Nothing else lifts a tombstone. **[legal review]** (LR-7). Lifting is a Phase 2 write path; in Phase 1 the decision only receives `tombstone_match`.

**Acceptance criteria**

- AC-d1. ID-01 to ID-04 and ER-01 to ER-09 pass as written. The two hashes are known-answer tests.
- AC-d2. The state machine is a pure function of (task, event, policy); the same events in any arrival order that respects each task's own sequence give the same final state.
- AC-d3. From the second an erasure is requested, `decide` denies every message for the contact (WE-23), and after completion any contact whose identifier matches the tombstone is denied (WE-29).
- AC-d4. (Phase 2) After completion no table holds the contact's identifier in clear; a test searches every text column for the fixture address and phone.
- AC-d5. (Phase 2) The fan-out worker only ever calls mock adapters; a lint check fails on any provider SDK import.
- AC-d6. (Phase 3) The erasure queue shows each request's per-system status, `due_at`, and the `at_risk` and `overdue` flags, sorted with overdue first.

### 5e. Consent-history import

**Behaviour.** An admin uploads a CSV exported from another system and declares a column mapping: which column is the identifier, the channel (or a constant), the purpose (or a constant), the status, the date, optionally a confirmation date, and **which date format the file uses**. optbook produces a preview: for every row, one outcome and a reason a person can read. Nothing is written until the admin commits, and the commit writes exactly what the preview showed: the preview carries a fingerprint of the ledger it was computed against, and a commit against a changed ledger is refused and re-previewed.

**Outcomes** (closed set)

| Outcome | Meaning |
|---|---|
| `APPEND` | one or more events will be added and they change, or may later change, the contact's state |
| `APPEND_NO_EFFECT` | the event will be added as history, but the contact's current state for that pair is the same with or without it (a newer ledger event already decides it) |
| `DUPLICATE` | an event with the same contact, type, channel, purpose and `occurred_at` already exists (in the ledger or earlier in the file); nothing is written |
| `HOLD_REVIEW` | a permissive row that would turn a "no" into a "yes"; nothing is written; a person must decide |
| `SKIP_ERASED` | a restrictive row for an identifier that matches an erasure tombstone; nothing is needed |
| `REJECT` | the row cannot be used; carries one reason code |

Reject reasons: `MISSING_IDENTIFIER`, `BAD_IDENTIFIER`, `UNKNOWN_CHANNEL`, `UNKNOWN_PURPOSE`, `PURPOSE_NOT_CONSENTABLE`, `UNKNOWN_STATUS`, `BAD_DATE`, `FUTURE_DATE`, `MISSING_DATE_OPT_IN`, `ERASED_IDENTIFIER`. Notes that can accompany an accepted row: `CONTACT_CREATED`, `DATE_DEFAULTED`, `DATE_ONLY`, `WILL_BE_PENDING_DOUBLE_OPT_IN`.

**Rules**

1. **Status vocabulary is data**, matched after trimming and lowercasing. Permissive: `subscribed`, `opted in`, `opt-in`, `optin`, `yes`, `y`, `true`, `1`, `active`, and `pending`, `unconfirmed` (an opt-in with no confirmation). Restrictive: `unsubscribed`, `opted out`, `opt-out`, `optout`, `no`, `n`, `false`, `0`, `removed`. Suppression: `bounced`, `hard bounce` (hard bounce); `complained`, `spam`, `abuse` (complaint). Anything else, including an empty cell, is `UNKNOWN_STATUS`. Vendor words whose meaning varies are left out on purpose and rejected so that a person maps them. A suppression row applies to the whole channel; its purpose cell is ignored.
2. **Dates are parsed only in the declared format**: `iso` (`YYYY-MM-DD` or the full UTC timestamp), `mdy` (`MM/DD/YYYY`) or `dmy` (`DD/MM/YYYY`). A cell that does not parse under the declared format is `BAD_DATE`; the format is never guessed per row.
3. **A date without a time** is placed where the restrictive reading wins: a permissive row at `00:00:00Z`, a restrictive row at `23:59:59Z` of that day, and never later than the import time. So an opt-in and an opt-out on the same day leave the person opted out.
4. **A restrictive row with no date** is accepted and dated at the import time (`DATE_DEFAULTED`). **A permissive row with no date** is `MISSING_DATE_OPT_IN`: a claimed consent with no date proves nothing.
5. **Hold rule.** A permissive row is `HOLD_REVIEW` when, at the row's own date, the ledger (plus the accepted rows of the same file) already says no for that pair: a global unsubscribe, a channel opt-out or a purpose opt-out stands at that moment. This is the case "an import disagrees with a newer ledger event, and the import is the newer one". The opposite case, an old permissive row and a newer ledger opt-out, is `APPEND_NO_EFFECT`.
6. **Restrictive and suppression rows are always appended** unless they are duplicates.
7. **Erased identifiers.** A permissive row whose identifier matches a tombstone is `REJECT / ERASED_IDENTIFIER`; a restrictive one is `SKIP_ERASED`.
8. **Unknown identifiers** create a contact (`CONTACT_CREATED`), for restrictive rows as well: an opt-out for someone not yet on file must still be remembered.
9. Rows are planned in ledger order (by `occurred_at`, restrictive last on ties), not file order, so the result does not depend on how the file was sorted.
10. Imported events carry `method = import`, `source` = the mapping's label, `actor = { kind: import, id: <batch id> }`, `evidence_ref = import/<batch id>#row<n>` and `recorded_at` = the import time. A confirmation date column, when mapped and filled, adds an `OPT_IN_CONFIRM`.
11. A row gets exactly one reject reason. Checks run in this order and stop at the first failure: identifier (`MISSING_IDENTIFIER`, `BAD_IDENTIFIER`), channel, purpose (`UNKNOWN_PURPOSE`, `PURPOSE_NOT_CONSENTABLE`; skipped for suppression rows), status, date (`BAD_DATE`, `FUTURE_DATE`, `MISSING_DATE_OPT_IN`), tombstone (`ERASED_IDENTIFIER`).
12. `WILL_BE_PENDING_DOUBLE_OPT_IN` is attached only to an `APPEND` of an opt-in that the contact's rule set will hold as pending. `CONTACT_CREATED` is attached to the contact's first accepted row in ledger order.
13. A held row is resolved by a person (Phase 3): approving it appends the opt-in with that user as actor and a required evidence reference; declining it records the decision and writes nothing to the ledger.

**Worked examples.** Import time 2026-11-20T15:00:00Z, format `iso`, channel constant `email`. Ledger before the import, for the contact whose address is `ada@example.com`: `OPT_IN(email, newsletter)` 2026-03-01T10:00:00Z; `OPT_IN_CONFIRM(email)` 2026-03-01T10:05:00Z; `OPT_OUT(email, newsletter)` 2026-06-10T09:00:00Z. `gone@example.com` matches a tombstone. No other address is on file.

| ID | Row (identifier, purpose, status, date) | Outcome | Why |
|---|---|---|---|
| IM-01 | `ada@example.com`, newsletter, `subscribed`, `2026-02-01` | `APPEND_NO_EFFECT` | opt-in dated before the standing opt-out of 06-10; history only |
| IM-02 | `Ada@Example.com `, newsletter, `subscribed`, `2026-09-01` | `HOLD_REVIEW` | on 09-01 the ledger says no (purpose opt-out of 06-10 stands) |
| IM-03 | `ada@example.com`, newsletter, `unsubscribed`, `2026-06-10T09:00:00Z` | `DUPLICATE` | same event already in the ledger |
| IM-04 | `ada@example.com`, promotional, `unsubscribed`, (blank) | `APPEND` + `DATE_DEFAULTED` | `OPT_OUT(email, promotional)` at 2026-11-20T15:00:00Z |
| IM-05 | `ada@example.com`, promotional, `subscribed`, (blank) | `REJECT / MISSING_DATE_OPT_IN` | |
| IM-06 | `new.person@example.com`, newsletter, `yes`, `2026-10-05` | `APPEND` + `CONTACT_CREATED`, `DATE_ONLY`, `WILL_BE_PENDING_DOUBLE_OPT_IN` | `OPT_IN` at 2026-10-05T00:00:00Z; no region, so `RS-STRICT` applies and the pair is not sendable until confirmed |
| IM-07 | `not-an-email`, newsletter, `yes`, `2026-10-05` | `REJECT / BAD_IDENTIFIER` | |
| IM-08 | `ada@example.com`, newsletter, `cleaned`, `2026-05-01` | `REJECT / UNKNOWN_STATUS` | |
| IM-09 | `ada@example.com`, newsletter, `subscribed`, `2027-01-01` | `REJECT / FUTURE_DATE` | |
| IM-10 | `gone@example.com`, newsletter, `subscribed`, `2026-10-05` | `REJECT / ERASED_IDENTIFIER` | |
| IM-11 | `gone@example.com`, newsletter, `unsubscribed`, `2026-10-05` | `SKIP_ERASED` | |
| IM-12 | `ada@example.com`, transactional, `unsubscribed`, `2026-10-05` | `REJECT / PURPOSE_NOT_CONSENTABLE` | |
| IM-13 | `ada@example.com`, newsletter, `unsubscribed`, `2026-07-04` | `APPEND` + `DATE_ONLY` | `OPT_OUT` at 2026-07-04T23:59:59Z |
| IM-14 | two rows: `bo@example.com`, newsletter, `subscribed`, `2026-08-08` and `bo@example.com`, newsletter, `unsubscribed`, `2026-08-08` | first `APPEND_NO_EFFECT` (+ `CONTACT_CREATED`), second `APPEND` | opt-in at 00:00:00Z, opt-out at 23:59:59Z; the person ends opted out whichever row comes first in the file |
| IM-15 | `ada@example.com`, newsletter, `subscribed`, `03/04/2025` | `REJECT / BAD_DATE` | the file was declared `iso` |
| IM-16 | `cy@example.com`, newsletter, `bounced`, `2026-10-01` | `APPEND` + `CONTACT_CREATED` | `SUPPRESSION_ADD(email, hard_bounce)` at 2026-10-01T23:59:59Z |
| IM-17 | `di@example.com`, newsletter, `subscribed`, `2026-10-05`, confirmation date `2026-10-06` | `APPEND` + `CONTACT_CREATED` | `OPT_IN` at 2026-10-05T00:00:00Z and `OPT_IN_CONFIRM(email)` at 2026-10-06T00:00:00Z |
| IM-18 | (blank), newsletter, `yes`, `2026-10-05` | `REJECT / MISSING_IDENTIFIER` | |

The preview summary for these 19 rows: `APPEND` 6, `APPEND_NO_EFFECT` 2, `DUPLICATE` 1, `HOLD_REVIEW` 1, `SKIP_ERASED` 1, `REJECT` 8 (one each of the reasons shown in IM-05, IM-07, IM-08, IM-09, IM-10, IM-12, IM-15, IM-18).

**Acceptance criteria**

- AC-e1. IM-01 to IM-18 produce the outcomes, notes, event types and timestamps shown, and the summary counts above.
- AC-e2. The plan is the same for any ordering of the file's rows (row numbers in `evidence_ref` aside).
- AC-e3. Property: for any file, no contact-and-pair that the ledger says "no" for before the import is "yes" after committing it.
- AC-e4. Planning writes nothing. (Phase 2) Commit writes exactly the planned events in one transaction, and is refused with `LEDGER_CHANGED` if the fingerprint no longer matches.
- AC-e5. The CSV reader handles quoted fields, doubled quotes, commas and newlines inside quotes, CRLF and LF, a UTF-8 byte-order mark, and a missing trailing newline; a row with the wrong number of columns is rejected by row number, not silently shifted.
- AC-e6. (Phase 3) Every row of a preview is visible with its outcome and reason, filterable by outcome, and downloadable as CSV.

### 5f. Audit and proof

**Behaviour.** For any contact, message and past time, optbook shows the decision and what it rested on.

- **As known.** `explain(input, config)` returns the same decision `decide` returns for time T, plus a trace: the facts and rule-set version used, the event behind each reason, the basis for an allow, and the ids of events that existed but were **not yet known** at T (recorded later).
- **In hindsight.** The same question using every event with `occurred_at <= T`, whenever it was recorded. The difference between the two views is the useful one for operations: sends that were allowed on what was known and would have been denied on what was true. `exposure(events, sends, config)` lists them (the "late opt-out" report).
- **Stored decisions.** (Phase 2) Every decision made for a mock send is stored with its inputs' fingerprint (SHA-256 of canonical JSON), the outcome, reasons, rule set and version. `verifyProof(record, events, config)` recomputes it and returns `MATCH` or `MISMATCH` with the differing fields.

| ID | Case | Expected |
|---|---|---|
| AU-01 | WE-27's ledger, as known at 2026-11-20T15:00:00Z | allow; `not_yet_known` lists the opt-out recorded on 11-21 |
| AU-02 | the same, in hindsight at 2026-11-20T15:00:00Z | deny, `PURPOSE_OPT_OUT` |
| AU-03 | `exposure` over WE-27's ledger with one newsletter send at 2026-11-20T15:00:00Z | that send is listed, with the opt-out's `occurred_at` and `recorded_at` |
| AU-04 | `verifyProof` on a stored record equal to WE-05's expected decision | `MATCH` |
| AU-05 | the same record with `outcome` changed to `allow` | `MISMATCH`, field `outcome` |
| AU-06 | canonical JSON of `{"b":1,"a":[true,null,"x"],"c":{"z":"é","y":-3}}` | `{"a":[true,null,"x"],"b":1,"c":{"y":-3,"z":"é"}}`, SHA-256 `14a1892f6065261941f36fac5ca1109fd07e941f39ba553de2a189d9d0ea78bb` |

**Acceptance criteria**

- AC-f1. AU-01 to AU-06 pass as written.
- AC-f2. For all 35 worked examples, `explain(...).decision` equals `decide(...)`.
- AC-f3. Canonical JSON refuses `undefined`, non-finite numbers and non-integer numbers (no floats exist anywhere in the engines' data).
- AC-f4. (Phase 3) The contact page shows the ledger as a timeline and answers "why was this allowed or denied at this time?" for a chosen message and time, in sentences, each linked to the event it rests on.

## 6. Worked examples: the send-eligibility decision

These 35 cases are the contract for Phase 1. The table is the readable form; `GOLDEN-DECISIONS.md` holds the same cases as JSON with every field, and is what the tests load. Both were produced together on 2026-11-26. If they ever disagree, stop and report; do not pick one.

Reading the table: all times are UTC. `IN email/newsletter` is an `OPT_IN`; `CONFIRM email` is an `OPT_IN_CONFIRM` with no purpose; `OUT email/*` is a channel opt-out. Every event is recorded when it occurred unless the row says otherwise. "Offset" is `utc_offset_minutes` (-360 is six hours behind UTC). Under "Sends in the log", the year is 2026 and each send is a marketing message on the same channel as the message being decided.

| ID | Case | Region, offset | Ledger events known to the system (UTC) | Sends in the log (UTC) | Message | T (UTC) | Rule set | Decision | Reasons, in order |
|---|---|---|---|---|---|---|---|---|---|
| WE-01 | Opt-in with confirmation | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | none |
| WE-02 | Opt-in never confirmed, double opt-in required | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `PENDING_DOUBLE_OPT_IN` |
| WE-03 | Same unconfirmed opt-in where double opt-in is not required | R-SOUTH, 60 | IN email/newsletter 2026-03-01 10:00 via form | none | email / newsletter | 2026-11-20 15:00 | RS-BASELINE v1 | **allow** | none |
| WE-04 | No consent events at all | R-NORTH, -360 | none | none | email / promotional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `NO_CONSENT` |
| WE-05 | Purpose opt-out after a confirmed opt-in | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; OUT email/newsletter 2026-06-10 09:00 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `PURPOSE_OPT_OUT` |
| WE-06 | Other purposes unaffected by a purpose opt-out | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; IN email/product_updates 2026-03-01 10:00 via form; OUT email/newsletter 2026-06-10 09:00 | none | email / product_updates | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | none |
| WE-07 | Channel opt-out after opt-ins | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; OUT email/* 2026-07-01 12:00 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `CHANNEL_OPT_OUT` |
| WE-08 | Global unsubscribe covers every channel | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02; GLOBAL-UNSUB 2026-08-01 12:00 | none | sms / promotional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `GLOBAL_UNSUBSCRIBE` |
| WE-09 | Re-opt-in through the preference center after a global unsubscribe | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; IN email/promotional 2026-03-01 10:00 via form; GLOBAL-UNSUB 2026-08-01 12:00; IN email/newsletter 2026-09-15 08:00 via preference_center (link delivered by email) | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | none |
| WE-10 | Same contact, a purpose not re-opted-in stays blocked | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; IN email/promotional 2026-03-01 10:00 via form; GLOBAL-UNSUB 2026-08-01 12:00; IN email/newsletter 2026-09-15 08:00 via preference_center (link delivered by email) | none | email / promotional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `GLOBAL_UNSUBSCRIBE` |
| WE-11 | Opt-in and opt-out at the same second: restrictive wins | R-NORTH, -360 | IN email/newsletter 2026-05-05 10:00 via form; CONFIRM email 2026-05-05 10:00; OUT email/newsletter 2026-05-05 10:00 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `PURPOSE_OPT_OUT` |
| WE-12 | Three standing opt-outs reported in order | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; OUT email/newsletter 2026-06-10 09:00; OUT email/* 2026-07-01 12:00; GLOBAL-UNSUB 2026-08-01 12:00 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `GLOBAL_UNSUBSCRIBE`, `CHANNEL_OPT_OUT`, `PURPOSE_OPT_OUT` |
| WE-13 | SMS inside quiet hours (21:30 local) | R-NORTH, -360 | IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02 | none | sms / promotional | 2026-11-21 03:30 | RS-STRICT v1 | **deny** | `QUIET_HOURS` (next allowed 2026-11-21 14:00) |
| WE-14 | SMS at exactly 08:00:00 local: quiet hours have ended | R-NORTH, -360 | IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02 | none | sms / promotional | 2026-11-20 14:00 | RS-STRICT v1 | **allow** | none |
| WE-15 | SMS at exactly 21:00:00 local: quiet hours have begun | R-NORTH, -360 | IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02 | none | sms / promotional | 2026-11-21 03:00 | RS-STRICT v1 | **deny** | `QUIET_HOURS` (next allowed 2026-11-21 14:00) |
| WE-16 | SMS with no known timezone offset | R-NORTH, unknown | IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02 | none | sms / promotional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `TIMEZONE_UNKNOWN` |
| WE-17 | Email at the rule-set frequency cap (3 in 7 days) | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05 | 11-14 16:00, 11-17 09:00, 11-19 09:00 | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `FREQUENCY_CAP` (rule_set: 3 of 3 in 7d) |
| WE-18 | A send exactly 7 days old has left the window | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05 | 11-13 15:00, 11-17 09:00, 11-19 09:00 | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | none |
| WE-19 | Contact chose weekly: personal cap of 1 in 7 days | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; FREQ email=weekly 2026-10-01 09:00 | 11-17 09:00 | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `FREQUENCY_CAP` (contact: 1 of 1 in 7d) |
| WE-20 | Transactional email to a globally unsubscribed contact | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; GLOBAL-UNSUB 2026-08-01 12:00 | none | email / transactional | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | `TRANSACTIONAL_EXEMPTION` (exempted: GLOBAL_UNSUBSCRIBE) |
| WE-21 | Transactional SMS after an SMS channel opt-out (STOP) | R-NORTH, -360 | IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02; OUT sms/* 2026-09-01 18:00 | none | sms / transactional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `CHANNEL_OPT_OUT` |
| WE-22 | Transactional SMS at 23:00 local | R-NORTH, -360 | none | none | sms / transactional | 2026-11-21 05:00 | RS-STRICT v1 | **allow** | `TRANSACTIONAL_EXEMPTION` (exempted: QUIET_HOURS) |
| WE-23 | Erasure in progress blocks even transactional | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; ERASURE-REQUESTED 2026-11-18 09:00 | none | email / transactional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `ERASURE_IN_PROGRESS` |
| WE-24 | Hard bounce suppression | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; SUPPRESS email hard_bounce 2026-10-10 10:00 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `SUPPRESSED_BOUNCE` |
| WE-25 | Hard bounce cleared by an admin | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; SUPPRESS email hard_bounce 2026-10-10 10:00; CLEAR email hard_bounce 2026-10-20 10:00 | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | none |
| WE-26 | Complaint is never exempt, even for transactional | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; GLOBAL-UNSUB 2026-08-01 12:00; SUPPRESS email complaint 2026-08-01 12:00 | none | email / transactional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `SUPPRESSED_COMPLAINT`, `TRANSACTIONAL_EXEMPTION` (exempted: GLOBAL_UNSUBSCRIBE) |
| WE-27 | Opt-out happened on the 10th but was only recorded on the 21st: decision on the 20th | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; OUT email/newsletter 2026-11-10 09:00 (recorded 2026-11-21 08:00) | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **allow** | none |
| WE-28 | Same ledger, decision on the 22nd | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; OUT email/newsletter 2026-11-10 09:00 (recorded 2026-11-21 08:00) | none | email / newsletter | 2026-11-22 15:00 | RS-STRICT v1 | **deny** | `PURPOSE_OPT_OUT` |
| WE-29 | Identifier matches an erasure tombstone | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; tombstone match = true | none | email / newsletter | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `ERASED_SUPPRESSED` |
| WE-30 | Purpose on a notice-and-opt-out basis, no opt-in on file | R-SOUTH, 60 | none | none | email / product_updates | 2026-11-20 15:00 | RS-BASELINE v1 | **allow** | none |
| WE-31 | Notice-and-opt-out basis with a purpose opt-out | R-SOUTH, 60 | OUT email/product_updates 2026-04-04 09:00 | none | email / product_updates | 2026-11-20 15:00 | RS-BASELINE v1 | **deny** | `PURPOSE_OPT_OUT` |
| WE-32 | Quiet hours (07:30 local) and frequency cap together | R-NORTH, -360 | IN sms/promotional 2026-03-02 10:00 via form; CONFIRM sms 2026-03-02 10:02 | 11-16 18:00, 11-18 18:00 | sms / promotional | 2026-11-20 13:30 | RS-STRICT v1 | **deny** | `QUIET_HOURS` (next allowed 2026-11-20 14:00), `FREQUENCY_CAP` (rule_set: 2 of 2 in 7d) |
| WE-33 | SMS opt-in made in a preference center reached from an email link | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05; IN sms/promotional 2026-09-15 08:00 via preference_center (link delivered by email) | none | sms / promotional | 2026-11-20 15:00 | RS-STRICT v1 | **deny** | `PENDING_DOUBLE_OPT_IN` |
| WE-34 | Rule-set version 2 (email cap 2) is in force from 2026-12-01 | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05 | 11-28 09:00, 11-30 09:00 | email / newsletter | 2026-12-02 15:00 | RS-STRICT v2 | **deny** | `FREQUENCY_CAP` (rule_set: 2 of 2 in 7d) |
| WE-35 | Same two sends under version 1 (cap 3) | R-NORTH, -360 | IN email/newsletter 2026-03-01 10:00 via form; CONFIRM email 2026-03-01 10:05 | 11-28 09:00, 11-30 09:00 | email / newsletter | 2026-11-30 15:00 | RS-STRICT v1 | **allow** | none |

## 7. Rules that need legal review

optbook models these as data and takes no position on what the values should be. A real deployment needs a qualified person to decide each one.

| # | Rule | Where it lives |
|---|---|---|
| LR-1 | Which purposes, if any, may be sent without an opt-in (`notice_and_opt_out`) | `lawful_basis` |
| LR-2 | Whether an opt-in must be confirmed, on which channels, and what counts as confirmation | `double_opt_in` |
| LR-3 | The SMS quiet-hours window, what to do when the local time is unknown, and whether transactional SMS is bound by it | `quiet_hours`, `transactional_exempt_from` |
| LR-4 | What counts as transactional, and which opt-outs a transactional message may bypass on each channel | catalog class, `transactional_exempt_from` |
| LR-5 | How long an erasure may take, when the clock starts, and whether it can ever pause | `erasure.sla_days` |
| LR-6 | Whether pseudonymous ledger rows, stored decisions and a keyed hash of the identifier may be kept after erasure, and for how long | §5d step 5 |
| LR-7 | Whether and how a person can subscribe again after erasure | §5d |
| LR-8 | Whether a later opt-in may override an earlier global unsubscribe; what a one-click unsubscribe must cover; whether an expired link must still unsubscribe | §5a, `one_click.scope`, §5c |
| LR-9 | What evidence is enough to prove an opt-in, and how long evidence is kept | `evidence_ref`, Q-7 |
| LR-10 | Whether consent goes stale with age | not modeled; Q-5 |
| LR-11 | Whether a complaint may ever be cleared | D-028 |
| LR-12 | Which rule set applies when a contact's region is unknown | region map default |
| LR-13 | Whether imported consent from another system is valid at all without its original evidence | §5e |

## 8. Open questions (defaults are in force until the owner says otherwise)

| # | Question | Default | Why |
|---|---|---|---|
| Q-1 | After erasure, keep the pseudonymous ledger rows and stored decisions, or purge them? | Keep. They hold no identifiers (L-2). | Past sends stay explainable, and the ledger stays append-only. Purging is the stricter reading; it is one extra step at completion if chosen. |
| Q-2 | What does one-click unsubscribe opt out of? | Every marketing purpose on that channel. | Someone who clicks unsubscribe and then receives a different topic from the same sender reads it as being ignored. Narrower and wider choices are offered on the next page. |
| Q-3 | May a person's own later opt-in revive a pair after a global unsubscribe? | Yes, for exactly the pair they chose, and never from an import. | Otherwise a person who unsubscribed once can never come back by their own action. |
| Q-4 | Fixed UTC offset, or named time zones with daylight saving, for quiet hours? | Fixed offset. | It keeps the engine free of time-zone data and fully deterministic. The cost: a real deployment would be an hour wrong for part of the year unless offsets are maintained. |
| Q-5 | Should an opt-in expire with age? | No expiry in v1. | It would be one more rule-set field and one more reason code; left out until asked for. |
| Q-6 | What happens when a contact's address or number changes? | Out of scope: one address and one number per contact, fixed. | A changed address needs its own confirmation rules; not needed to show the core. |
| Q-7 | Where does evidence live, and for how long? | Phase 2 stores a small JSON snapshot per `evidence_ref`, deleted on erasure; no retention schedule. | Enough to show the pointer design. |
| Q-8 | Are rule sets edited in the product? | No. JSON files in the repo, validated at load, changed by pull request. | The review of a rule change is then the pull request itself. |
| Q-9 | Do the four users need distinct roles? | No new roles: foundation `owner`/`admin` act as marketing ops admin; `member` covers campaign builder and reviewer (read and check only). | The foundation's authorization paths are template-owned; a reviewer-only role would need an upstream change. |
| Q-10 | Should transactional SMS be blocked after an SMS channel opt-out, while transactional email is not blocked by an email opt-out? | Yes (as data). | The cautious reading on the channel where an unwanted message is most intrusive. |
| Q-11 | Should the erasure clock pause while a task is `DEAD` and waiting for a person? | No. | A paused clock hides exactly the requests that need attention. |
| Q-12 | Does the frequency cap count messages across all marketing purposes together? | Yes, per channel. | It is the contact's experience of volume that the cap protects. |

## 9. Phase plan

Each phase is one branch and one pull request, never merged by the run that wrote it. A phase does not start until the previous phase's exit criteria pass. Detail: `IMPLEMENTATION_PLAN.md`.

| Phase | What | Exit |
|---|---|---|
| 0. Clone setup | saas-foundation v1.7.0 tree, renamed to optbook on port 8400, `billing` removed, scope banner in README | `foundation:drift`, typecheck, lint and build pass (or each is recorded as "could not run here" with the reason) |
| 1. Pure engines | `src/lib/consent/`: time, canonical JSON, schemas, rule sets, ledger replay, decision, identity, tokens, preferences, erasure, import, audit. No database writes, no UI. | every worked example in this PRD passes; `consent:lint` clean; the oracle comparison agrees |
| 2. Schema and persistence | clone-owned tables, append-only trigger, RLS policies, export hooks, mock send log, stored decisions, erasure worker on mocks, import commit | the engines' results are unchanged when run through the database; AC-a3, AC-d4, AC-d5, AC-e4 |
| 3. UI and preference center | admin screens (contacts, timeline and "why", eligibility check, imports, erasure queue, rule sets read-only) and the public tokenized routes | AC-c4 to AC-c6, AC-d6, AC-e6, AC-f4; accessibility pass |
| 4. Demo seed, e2e, closeout | seeded synthetic org, Playwright paths for each user in §2, README, closeout notes | e2e green in CI; README states what was measured and what was not |

## 10. What passing the tests will and will not show

- The 35 decision cases and the other tables in this PRD were written by one unattended run and checked against a throwaway implementation by the same run. Phase 1 is a second implementation by a different run. Agreement shows the two read the specification the same way. It does not show the specification is right, complete, or lawful.
- The oracle comparison (AC-b6) compares two implementations written in the same session from the same text. It catches slips, not misunderstandings.
- No number in this document is a measurement. Caps, windows, lifetimes, retry delays and day counts are illustrative values chosen to make the examples readable.
- Nothing here has been run against a real mail or SMS provider, and nothing will be.
