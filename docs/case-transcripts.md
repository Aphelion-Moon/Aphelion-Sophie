# Authenticated transcript reads

Scope: P05/P06/P11/P12; partial T01/T04/T07/T10–T12/T22/T23/T36/T57.
This milestone reads retained observations through core. It adds no AI path,
export, artifact download, Staff notes, browser navigation or production service.

## Fixed read contract

`GET /api/cases/transcript?caseToken=...` uses the existing dashboard session.
Optional `channelId` selects one child of the selected root. `after` pages
observations; `gapsAfter` independently pages capture gaps. Unknown/duplicate
query fields, bodies and other methods are rejected. Case tokens and cursors
identify records; they are not credentials.

The JSON response contains `caseToken`, `channelId`, escaped `html`, `next`,
`gapsNext`, `captureAvailable` and `completeHistory: false`. Each page has at most
five observations and 25 gap records. Observation ordering is ascending stream
epoch, sequence and message ID, including bulk-delete ties. Cursors preserve
bigint precision and bind to the case and channel. Omitted fields in partial
updates remain omitted; deletes retain the earlier observations.

Gap pages use retained token order, not chronology. They include both selected
channel and guild intervals. They are a live view: newly inserted gaps can sort
before an earlier cursor, and intervals can close between requests. Restart
pagination to refresh all gaps. Current availability checks *all* relevant open
intervals, the capture mode and current Gateway owner, independently of the gap
cursor. Initial-history uncertainty remains visible on every page. Replay,
reconnection or receiving a message never establishes complete history.

All retained text, including nested embeds/components, is escaped inside `pre`
elements. No retained value becomes an attribute, link, image or executable
component. Attachment output contains bounded identity/name/type/size and
acquisition status only; URL/proxy fields and vault slots/paths are omitted.
Retained files are explicitly quarantined and unscanned. The response uses the
existing no-store, nosniff and restrictive CSP headers.

## Authorization and composition

`createCaseTranscripts` is the shared core use case; `createCaseTranscriptsHttp`
adapts it to the existing fixed dashboard listener's optional `transcripts`
route handler. Inject core authorization, the same healthy Gateway-backed role
adapter, the core pool, clock and `createCaseChildAccess`. There is no connector
or knowledge/inference import. Live runtime composition remains a later gate.

Current Staff/lead ops access follows case type. The opener requires its retained
core membership episode; REST-observed absence is persisted before the read
authorization so a subsequent login cannot reuse that episode. Staff-contact
recipients require a current active invitation. Other explicit participants
also require an active invitation with the independently retained actor-authority
presence epoch. Pending/removed/revoked invitations are insufficient. Core member
and actor-authority epochs are never compared to each other.

Case state, selected channel, policy/audience/case versions and invitation metadata
are compared around the content query. Current case authority is checked before
and after it; the HTTP adapter resolves the session again before returning.
Logout, membership/role revocation, unavailable continuity and changed snapshots
suppress the response. No case lock spans Discord requests. The page, attachment
statuses, gaps and persisted availability share one database statement snapshot.

A child additionally requires fresh metadata proving the original case marker,
guild and parent, requester/bot parent View Channel and Read Message History,
and private-thread membership unless Manage Threads applies. Its opaque proof
binds actor, case, root, child, freshness and Gateway continuity. Deleted, moved,
missing or uninspectable children fail closed; root access never aggregates them.
The helper uses fixed GETs only and never joins/unarchives a thread or fetches
Discord message content. Discord's [thread permissions](https://docs.discord.com/developers/topics/threads#permissions)
and [Get Thread Member contract](https://docs.discord.com/developers/resources/channel#get-thread-member)
were checked for this implementation. Live effective permissions remain untested.

## Evidence and limits

The later [case browser](case-browser.md) adds authenticated channel-ID lookup and
equivalent inert structured page data. It uses the same reader authorization and
never treats a channel ID as permission. TR01–TR12 were rerun with EX01–EX08 for
that build in [the export report](evidence/exports-verification.json); the evidence
below describes the original transcript milestone.

`node --test tests/case-child-access.test.js tests/case-transcripts.test.js`
passes seven focused contracts. `node scripts/test-storage.mjs --suite=transcripts
--record` runs TR01–TR11 in a new isolated PostgreSQL cluster, records source hashes
in [the focused report](evidence/transcripts-verification.json), and stops that
cluster before recording success. It leaves the historical full reports intact.

TR01 covers observation pagination/child separation; TR02–TR04 cover responder,
opener and invitation authority; TR05–TR08 exercise version/removal/logout/role/
membership/child/continuity races; TR09 checks gap paging and current coverage;
TR10 checks escaping and status-only attachments; TR11 uses the real authenticated
loopback listener. All data and identities are synthetic.

The existing Gateway revision changes for every dispatch, so unrelated events
can conservatively invalidate an in-flight read. This remains fail-closed and
is not optimized here. Full suites, real OAuth/TLS, live Discord, browser UX,
load/performance, exports/downloads and independent restoration were not run.
T57/full G2 acceptance remains incomplete; T58 has no independent recovery result.

Rollback: omit the optional transcript handler or revert this milestone's source
files. There is no migration, dependency/licence change, new role grant or service
installation. Preserve all existing observations, gaps, invitations and files.
