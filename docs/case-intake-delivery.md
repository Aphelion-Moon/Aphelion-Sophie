# Retained ticket answer delivery

Scope: P06, P09, P10, P17, P19 and P27; partial T01, T04–T07, T16, T22, T36 and T57 coverage. This extends [ordinary intake](case-intake.md) with deterministic answer delivery and responder notification. All input, messages and credentials exercised here are synthetic. No dependency, production configuration, live Discord registration or AI path is added.

## Source and presentation

The core store reads the retained intake and its immutable form version, verifies their canonical hashes, and generates a versioned delivery plan. A later form publication or withdrawal cannot reword an already committed submission. The raw canonical answers remain in `case_intakes`; message plans hold references, hashes and delivery state. Descriptors, receipts, outbox effects and stable errors contain no submitted values. The payload is released to the core delivery worker only after current membership, case state and exact private-channel permission checks.

Each field is labelled with its pinned question and its exact text or selected option label. Markdown punctuation is escaped. Text is split without discarding whitespace, dividing a UTF-16 surrogate pair or dividing an escape sequence. Up to five 4,000-character answers yield at most fifteen answer messages and one final notice. Each message has one bounded embed, no controls, no files and no automatically parsed mentions. This follows Discord's 256-character title and 4,096-character description bounds and stays below the combined embed text limit. [Discord message reference](https://docs.discord.com/developers/resources/message)

Quick Help has no form answers and creates only the notice. Normal cases mention the configured Staff role; Head Admin contact mentions lead ops and retains its restricted audience. The notice explicitly permits only that one role mention. Current role mentionability or effective bot mention permission must permit it; otherwise the notice remains unresolved even if earlier answers were delivered. No claim is made that a person has read a notification. Muzzled members can receive ordinary support delivery without Crew/Whitelist changes or Shuttle eligibility.

## Durable intent and delivery

Migration `022-case-intake-delivery.sql` adds `case_intakes.delivery_format`, the retained `case_intake_messages` table and the seventh closed outbox kind, `case.intake`.

| Retained field | Purpose |
|---|---|
| Case, guild, requester and ordinal | Bind each part to its source, audience and order |
| Format, kind and payload hash | Keep the original rendering stable and detect changed source/format |
| Random part ID | Identify this one planned message; a marker is never an access grant |
| Create-started, channel and message IDs | Distinguish definitely unsent work from known or uncertain effects |
| Pending/confirmed state and confirmation time | Record observed completion without deleting the source |

New submissions commit their case, source answers, all planned parts, receipt and provisioning/delivery intents in the same transaction. Migration backfill creates only durable intent for older retained intake; the worker plans its parts under current policy. An existing operation with a different kind, requester or effect aborts migration transactionally rather than silently losing delivery intent. No historical message or notification is invented as delivered.

Each worker invocation can create at most one part. It requires an active fenced lease and delivery gate, current member presence, the original presence epoch, an open compatible case and a freshly verified private channel. The store arms that part durably before the POST. The worker retains an authentic returned message ID, fetches that exact Sophie message and verifies its author, marker, body, mention metadata, channel and current permissions before confirming it. Confirmed parts precede the final responder notice. Subsequent invocations inspect known IDs instead of creating replacements.

The adapter shares the fixed own-message proof machinery used by Shuttle screens and alerts, with a third closed format. It exposes no history scan, arbitrary destination, renderer callback or URL. The transport sends a stable nonce with `enforce_nonce`, but Discord only deduplicates recent message creation for a limited period. Permanent idempotency therefore comes from retained state and conservative uncertainty handling, not a claim that Discord is exactly-once. [Discord message creation](https://docs.discord.com/developers/resources/message#create-message)

## Failures and authority changes

A lost POST response leaves the part unresolved and stops automatic creation. A late authentic response may retain the known ID and queue inspection; it cannot let an expired worker continue sending. A definitely unsent attempt, or a definite rate-limit/authorization refusal under the current lease, can release its unsent marker. Timeouts and ambiguous writes cannot clear that marker. Existing shared rate limits, delivery pauses and member-level lease serialization still apply.

Departure, closure, incompatible policy or changed permissions stop further delivery. Possible writes and audience failures queue a durable case-permission inspection. A member who leaves and rejoins cannot revive intake from the previous presence epoch. Confirmed answers and source records remain retained; no role is restored and no case content is transferred elsewhere.

A changed or deleted known message stops confirmation and is not blindly recreated. Confirmation records what was observed at that time: this slice does not continuously watch confirmed messages for later edits/deletion, and Discord posting cannot be atomic with later permission changes. The retained source remains authoritative. The [ordinary delivery review interface](case-delivery-issues.md) now supplies audited rechecks, exact-message identification and case-candidate selection. Earlier X-suite tests that reset parked work still use explicit synthetic intervention; the Y-suite separately exercises the authorized recovery routes.

## Verification and remaining scope

Four contract tests cover bounded/lossless escaped pagination, Unicode, role targeting and payload rejection. X01–X23 cover ordering and duplicate suppression, maximum forms, Head Admin/Muzzled policy, ACL and membership races, closure, lost/late writes and fences, rate limits, private descriptors, invalid proofs, changed/deleted messages, atomic submission/confirmation failures, delivery pauses, immutable pinned sources, unavailable role mentions, migration backfill and collision rollback. S30 restarts the isolated database between answer delivery and confirmation, then uses a recreated worker to inspect the retained known ID and deliver only the remaining notice. See [verification](verification.md) for recorded full-suite results and limitations.

Form authoring, the browser editor, other approved intake types and [conversation observations](case-conversations.md) are implemented separately. Still required: unresolved external results, final form copy, attachment acquisition, authenticated transcripts, dashboard parity and full production composition. Live client rendering, notification semantics, role/ACL mappings, Windows identity isolation and independent backup/restore remain acceptance gates. This is not conversation capture or a transcript/archive implementation.

Rollback: stop intake ingress and delivery, retain migrations 021/022 and every source, part, message ID, receipt and job, and use application code compatible with the retained schema. Do not drop retained tables, clear uncertain attempts, repeat notifications or roll back authority/presence epochs. No production schema, service or Discord state was changed by this slice.
