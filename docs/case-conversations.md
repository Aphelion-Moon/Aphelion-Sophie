# Case conversation retention and coverage gaps

Scope: P06/P09–P12/P19; partial T01/T04/T07/T10–T12/T18/T20–T23/T33/T36/T57.
This component retains observed case messages, partial edits, deletions and
capture gaps. [Private attachment acquisition](case-attachments.md) is a separate
core worker. [Authenticated paginated transcript reads](case-transcripts.md) now
render this ledger through core; exports and downloads remain incomplete. No case
content reaches AI.

## Core boundary and channel provenance

The metadata Gateway projection remains separate. An explicitly injected
`createCaseMessageCapture` adds an opaque, transient core handoff to the observer
and journal. The journal checks the retained channel mapping before reading
message body fields. Unknown/public channels, foreign guilds and ephemeral
messages do not enter retained case storage. There is no generic event registry,
history fetcher or content handoff to knowledge/inference.

Authoritative root channels are registered when the existing case adapter retains
a verified channel candidate. Each duplicate candidate stays associated with
its original case. Gateway channel/thread observations and thread-list/guild
snapshots can register descendants of those known channels. Category placement
alone cannot establish ownership. Movement never rebinds a channel to another
case, and its AI exclusion remains permanent. Deleted channels keep their records.

This mapping proves provenance, not read permission. A child thread may have a
narrower audience than its parent. The transcript read use case independently
rechecks current case, recipient/responder authority and selected child access.
It exposes no bearer URL or file download.

## Durable observations

Migration 029 adds `case_capture_channels`, `case_message_observations` and
`case_capture_gaps`, plus capture mode/checkpoint metadata on the Gateway lifecycle.
Only the separate observation table contains message content. Each observation
records guild/channel/message identity, stream epoch and sequence, observation
time, event kind, the fields actually present and any capture limitations.

Create, update and delete events commit with the Gateway cursor. Partial edits
do not replace omitted fields with empty strings. Explicit empty/null values
remain distinguishable. Deletes, including bounded bulk deletes, append evidence
and never erase earlier content. An edit/delete seen without an earlier create
does not manufacture the missing author, original text or original timestamp.
Duplicate/older sequences do not add revisions. Failed transactions leave the
cursor unchanged; replay after a lost acknowledgement finds the committed cursor.

The bounded projection retains text, author identity/display fields, timestamps,
message type/flags, inert embed/component/sticker/poll data and attachment metadata.
It discards role lists, interaction tokens, resolved entities and embedded
referenced-message bodies. Forwarded snapshots currently receive an explicit
not-captured marker. Stored components cannot execute actions. User markup and
URLs remain untrusted data for the later renderer/acquisition services.

Limits are explicit development bounds: 16,384 UTF-16 code units per string,
100 entries per structured array/object, depth 12, 4,096 nodes per structured
field and 128 KiB for the projected message body. The database separately bounds
JSON storage. Invalid Unicode, NUL characters and over-limit fields leave stable
field-loss markers while other valid fields survive. Bulk deletion above 100 IDs
records a channel gap instead of silently truncating the ID list. Channel
snapshots are bounded to 1,000 entries. Live load/compatibility review remains open.

Attachment URLs, names and sizes are references only. No HTTP acquisition,
malware scanning, archive expansion, file execution or inline rendering occurs.
They are not durable file copies by themselves. A separate explicit-policy
[acquisition worker](case-attachments.md) queues reference jobs atomically with
these observations and retains quarantined copies or capture failure reasons.
Authenticated artifact delivery remains incomplete.

## Coverage and recovery

Channel registration records unavailable earlier history. Migration backfill
creates unknown-start gaps for existing channels and invents no messages.
Capture disabled/not running, observer acquisition, disconnection, a new Identify,
guild unavailability, skipped sequence numbers and rejected payloads retain gap
evidence. Capture mode changes force a new Identify rather than reusing a session
with different intents. Acquisition after an expired owner begins at its last
durable observation, including a process that could not record its own shutdown.

Open intervals coalesce; closing one records how observation resumed and never
deletes the interval or certifies completeness. Successful Resume preserves the
interruption record. Channel/role/bot-membership changes mark access uncertain;
receiving another message alone cannot clear that warning. A separate verified
root-channel inspection can close its access interval. Child-thread access
remains unverified by the current root-channel adapter.

A missing/expired Gateway owner is not evidence of active capture. The
transcript service includes current observer state as well as these retained
intervals, field-loss markers and missing-create observations. Offline deleted
content, inaccessible history, unsupported surfaces and pre-registration races
cannot be reconstructed by this ledger. No complete-history claim is made.

## Discord compatibility and execution evidence

The explicit capture composition requests Guild Messages and Message Content in
addition to the existing Guilds/Guild Members intents (33283). The default
metadata-only composition keeps intents 3 and an open capture-disabled gap.
Discord documents the [message events](https://docs.discord.com/developers/events/gateway-events#messages),
[message fields](https://docs.discord.com/developers/resources/message#message-object)
and [content intent](https://docs.discord.com/developers/events/gateway#message-content-intent).
These contracts were checked on 19 September 2026. Real application intent
approval, effective permissions and Discord compatibility remain live gates;
no application setting or command was changed.

Five additional contract tests cover opaque handoff, omission/empty/null
semantics, safe bounds/Unicode, proof lifetime and fixed intent selection.
CC01–CC24 cover PostgreSQL cursor/content atomicity, duplicates, rollback/lost
acknowledgements, gaps, child provenance, disabled capture, mode changes,
indefinite history, migration preservation and knowledge/DELETE denial. CC24 uses
the native WebSocket client and a loopback Gateway peer. S37 checks two isolated
database restarts, persisted history/gaps/cursor, fresh opaque proofs, replay and
a retained delivery pause. Actual results and hashes are in [verification](verification.md).

Rollback: stop the observer and delivery before reverting adapters. Preserve
migration 029, message observations, gap history and exclusions. An older
metadata-only runtime cannot promise case capture or safely reuse a session
with different intents. No destructive down migration or retention sweep exists.
Dependencies, licences, production databases/services and original assets are unchanged.
