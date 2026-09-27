# Persistent ticket links

Owner-requested scope: P06/P17/P19, partial T04–T07/T16/T22/T36/T59.

Once an ordinary ticket's open channel and exact audience are confirmed, Sophie
records one DM intent for its opener in the same transaction. A separate worker
rechecks current membership, presence epoch, case state/policy and the channel
proof before sending. Existing open ordinary tickets receive their first intent
through the same periodic channel reconciliation. Shuttle has no such intent.

The DM contains only static text and the fixed Discord channel URL. It does not
copy category/title, forms, conversation, attachments or notes. Mentions and link
previews are suppressed. It tells the user to continue in the ticket channel.
No incoming-DM intent, handler, history read, AI path or arbitrary recipient/text
API is added. The saved URL grants no access; Discord still enforces its current
permissions. Previously received links remain in the user's DM history.

The ephemeral command acknowledgment remains available even when DMs fail. The
preparing response explains that Sophie will attempt a DM. A blocked DM is a
terminal delivery outcome, never a failed ticket or a reason to post publicly.
There is no automatic repeated send to a blocked recipient.

## Delivery and persistence

Migration 032 adds a metadata-only `case_direct_notices` table and the fixed
`case.dm` outbox kind. It has one row per intake, a random durable nonce, bound
recipient/destination IDs, possible-send state and a verified message ID. It does
not rewrite historical migrations or delete retained data. Runtime table grants
remain SELECT/INSERT/UPDATE only; knowledge/inference gain no access.

Discord's [Create DM API](https://docs.discord.com/developers/resources/user#create-dm)
returns the existing one-to-one DM where available. Sophie verifies its exact
recipient and excludes group DMs. The fixed message POST uses
[nonce enforcement](https://docs.discord.com/developers/resources/message#create-message),
but does not rely on Discord's short deduplication window for durable safety.
Send intent commits before POST. Known late receipts survive lease loss. Lost
responses/armed crashes park without a blind repeat; definite rate-limit refusal
can release the unsent attempt while preserving the shared delivery barrier.
Uncertain DM jobs currently need operator inspection; they are not included in
the existing form-answer `/ticket issues` recovery interface. The ticket link in
the ephemeral response remains the fallback.

A membership/permission change observed before sending prevents delivery. As
with other Discord effects, a change racing an in-flight POST cannot be made
atomic with PostgreSQL; only static navigation metadata can be delivered late.

## Evidence and operation

28 focused tests, DM01–DM10, B01–B21/X01–X23/Y01–Y23 (67), and RT01–RT10 pass.
DM cases cover blocked channel creation/send, lost/late responses, fresh-worker
deduplication, membership departure/rejoin, closure, ACL drift, recipient binding
and rate limits. RT04 now verifies automatic DM delivery plus signed ticket
navigation. The owned test clusters stopped. Historical upgrade fixtures were
adjusted to reconstruct pre-DM schemas and to include the new table in their
existing cleanup statements. Full suites were not run. See the source-bound
[DM report](evidence/direct-notices-verification.json),
[intake report](evidence/intake-verification.json), and
[runtime report](evidence/staging-verification.json).

Live isolated staging: migration/privilege checks passed, the host restarted after
lease expiry, Gateway health became current and the public page returned 200.
Two scoped inspections were queued through the existing ordinary outbox so the
test did not need to wait for the 15-minute periodic schedule. Both existing
Quick Help tickets produced a verified DM receipt and a completed DM job. Only
delivery metadata was inspected. User-visible DM confirmation remains separate
from Discord API acceptance. See the [live record](evidence/ticket-direct-notices-live.json).

Deploy only to the isolated staging database after an orderly runtime stop.
Apply migration 032 using the owner maintenance identity, grant the runtime
identity SELECT/INSERT/UPDATE on the new table, verify all migration hashes and
table privileges, then restart after Gateway lease expiry. Do not rerun initial
database setup. No new dependency, licence, Discord permission or OAuth scope.

Rollback stops the host/worker and preserves all notice/outbox rows. Any code
rollback must retain migration-032 awareness; the older 31-migration binary will
correctly refuse startup. Do not drop notice records or clear possible-send flags
to obtain a repeat. Production release, backup and recovery gates remain open.
