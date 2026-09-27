# Reviewed static automation policy

Scope: P18/R06, partial T45. The configuration service and authenticated API
support reviewed rules and synthetic dry-runs. Explicitly enabled Gateway
admission now commits metadata receipts, cooldowns and bounded pending jobs.
Message/reaction delivery now consumes these jobs with fresh permission checks,
deadline enforcement and durable receipts. Current-authorized operator recovery
is available through the shared service and authenticated API. The reviewed
browser editor/recovery UI remains unimplemented. Publishing configuration does not activate automation.
No live upgrade, capability grant or production approval has occurred.

## Rules and dry-runs

One versioned guild policy holds at most 25 named rules, with up to 20 explicit
channel IDs per rule and 50 distinct channels overall. Matching is literal
`exact` or `contains`, with an explicit case-sensitivity choice and NFC Unicode
normalization. No arbitrary regular expressions, code, imports or variable
substitution are accepted. Response text is retained literally, including any
template-looking text. Actions are a static message of at most 2,000 UTF-16 units
or a bounded Unicode/custom emoji reference. Custom emoji availability, name and
bot-role eligibility are checked against the current guild emoji endpoint before
delivery. External/app emoji are not supported.

Higher numeric priority runs first; ties use the rule ID in ascending order.
A matching stop rule blocks lower rules even while cooling down. Per-rule user
cooldowns span channels, and per-rule channel cooldowns span users. Both are
bounded to 1 second–24 hours. At most three actions are selected per message.
Clock regressions keep cooldowns active. These are explicit bounded defaults,
not extracted owner copy or live-server settings.

Dry-runs accept up to 20 explicitly synthetic events over one hypothetical day.
They simulate these cooldowns without changing retained runtime state, recording
samples, creating jobs or sending messages. Returned decisions/actions never echo
sample message content. Bot/webhook/self events and excluded channels are
suppressed before inspecting content. Mention and link-preview suppression is
declared in preview and enforced in the fixed outbound payload. Messages include
a disabled “Automated response” attribution button, literal approved text and no
files, source quote or user ping. Independent live behavior remains unverified.

Review and publication fetch only current channel metadata. They reject missing,
foreign, non-text and protected ticket-category destinations, retained case
exclusion tombstones and children of excluded parents. Closed/moved cases remain
excluded. Rules cannot opt out of this check. Preview also applies current
exclusion checks to sample destinations. These checks do not establish a durable
channel-access guarantee. Admission rechecks channel identity, policy and
exclusions; delivery also rechecks current membership and channel permissions.

## Authority and persistence

All five operations require the optional `automation.publish` capability.
Omitted or empty grants deny access; Discord ownership/Administrator alone
provides no bypass. Each operation resolves current authority and checks it again
before returning or committing. The session response exposes `canEditAutomation`
for the future browser editor. No new role ownership or Discord scope is added.

The API routes are `/api/automation` (current), `/api/automation/history`,
`/api/automation/review`, `/api/automation/preview` and `/api/automation/change`.
POST routes require the established authenticated session, origin and CSRF
checks. Unknown fields and case references are rejected. Preview requires
`synthetic: true`; changes require exact review SHA-256, current expected
revision, explicit confirmation and public-source attestation. Software cannot
verify an editor's provenance claim; do not paste real case content into samples
or rules. There is no case-content import, AI or message-history path.

Migration 041 adds `automation_policies`, retaining publications, withdrawal
tombstones, canonical document/intent hashes, original author grants and exact
request receipts. One guild lock serializes policy changes. Withdrawal keeps
history; an exact previously accepted request resolves its original receipt
after later changes, subject to current publisher authority. A reused request ID
with a different intent/author fails. History pages retain 10 entries each. No
automatic expiry or deletion is introduced. Normal restricted core grants are
SELECT/INSERT/UPDATE; knowledge and inference gain no access.

## Evidence and next work

The admission milestone adds migration 042 and optional `automationEnabled`
(omitted means false). A changed activation mode clears the saved Gateway session
and requires a fresh Identify; a journal using the wrong mode fails closed.
When enabled, the existing message/content intents are requested even if case
capture is disabled. Required Developer Portal intent approval remains a separate
live gate. The [Gateway contract](https://docs.discord.com/developers/events/gateway)
and [message fields/types](https://docs.discord.com/developers/resources/message)
were checked against Discord's current documentation.

Only ordinary new guild messages and replies are candidates. Edits, bot/self,
webhook, interaction, system and ephemeral messages are ignored. Admission occurs
only while the retained Gateway session is current and the guild available;
replayed backlog during resumption is not a new automation opportunity. Opaque
transient proofs expire after one minute. Only current allowlisted, non-case text
channels can reach matching. Attachments, embedded/referenced messages and other
message content fields are never inspected by automation.

The cursor, metadata-only event receipt, approved policy/action references,
per-rule user/channel cooldowns and `automation.dispatch` outbox intent commit
together. Duplicate sequence or message IDs do not rematch, reset cooldowns or
enqueue another job. Policy changes retain stable rule-ID cooldowns. A second
channel/exclusion check precedes admission. Invalid input is never partially
matched. Incoming message text and its hash are not retained in these tables.

Pending work is bounded to 100 actions per guild, 10 per channel and 5 per author,
with the existing maximum of three selected actions per message. Capacity refusals
are retained without consuming a cooldown slot. Jobs reference a 60-second
deadline enforced by the delivery worker. Expired unstarted jobs are cancelled,
releasing pending capacity while keeping history. Unknown possible sends remain
parked and continue to count against capacity; never reset/delete them to make
room. Keep live activation off pending the reviewed browser and human acceptance.
Receipt/cooldown retention and disk capacity need operational
qualification; queue bounds do not bound total historical metadata.

The following paragraphs retain the earlier admission/configuration evidence.
35 focused tests, AA01–AA15/G01–G17 (32), AP01–AP15, RT01–RT13, 52 reply scenarios
and 67 intake/recovery scenarios pass. AA13 performs encrypted restore with
retained metadata, cooldowns and quarantined pending jobs. AA14 verifies lost
cursor-COMMIT acknowledgement and fresh-service replay; AA15 checks exclusion
observed after matching. RT13 composes OAuth publication, loopback Gateway
admission and independent private case capture. Historical upgrade fixtures now
reconstruct the later queue schema as well. All five isolated clusters stopped.
See [admission evidence](evidence/automation-ingress-verification.json).
The following paragraph retains the earlier configuration milestone's evidence.

25 focused tests and AP01–AP15 pass. They exercise literal/Unicode behavior,
priority/stop/cooldowns, input bounds, suppression before content access, channel
metadata projection, explicit current authority, stale/concurrent publication,
late revocation rollback, retained history/corruption, HTTP/CSRF, exact lost-commit
recovery and restricted privileges. AP14 performs actual encrypted restore of
published and withdrawn policy records into read-only quarantine. RT01–RT12
pass; RT05 checks default-denied configuration access and RT12 composes OAuth,
review/publication, dry-run cooldowns, changed-channel rejection, withdrawal and
permission loss. The isolated clusters stopped. See
[policy evidence](evidence/automation-policy-verification.json).

## Delivery, compensation and verification

Migration 043 adds possible-send and receipt state, a sticky withdrawal reason,
settlement time and metadata-only sequential audit. The worker checks the retained
event, policy and action hashes and requires the current publication revision.
Withdrawal or any new revision cancels unstarted work. Disabling automation also
cancels unstarted work while allowing cleanup of a known unconfirmed effect.

Before sending, current human presence, Muzzled/timeout status, channel view/send
access and bot permissions are verified. The shared retained exclusion check runs
before source metadata is fetched and again at the durable send boundary. Only
source IDs, author/type and reaction metadata are projected; source text, files,
embeds and referenced messages are not copied. Gateway continuity and opaque
proof freshness are checked immediately before the HTTP mutation.

Send intent commits before POST/PUT. A positive response becomes a bound receipt;
a later worker turn freshly checks eligibility and the actual own effect before
confirmation. A policy, membership, channel or deadline change before confirmation
requires removal of that known effect. Removal uses only the exact retained own
message ID or own reaction, without reading case bodies after a channel exclusion.
Known missing effects are never recreated. Confirmed historic effects are not
retroactively removed by unrelated later policy edits.

An already-present bot reaction is not adopted by a new job or removed on its
behalf. A lost message/reaction response parks possible-send state without a blind
repeat. Positive late receipts survive lease loss and wake an uncertainty job for
fresh verification. Lost DELETE responses retry idempotent removal. Receipt and
audit updates are transactional, and expired/outdated workers cannot authorize a
second creation. Discord effects are not atomic with database state: a change
racing an in-flight request can require subsequent compensation.

Discord's [message/reaction endpoints and nonce contract](https://docs.discord.com/developers/resources/message)
and [guild emoji fields](https://docs.discord.com/developers/resources/emoji) were
checked. Nonce enforcement is an extra short-lived guard, not durable deduplication.
No extra dependency, licence, permission grant or deployment is introduced.

39 focused checks, AD01–AD24, AA01–AA15/G01–G17, AP01–AP15, RT01–RT13,
52 reply and 67 intake scenarios pass offline. AD20 performs encrypted restore of
attempts, receipts and audit into quarantine; AD22 loses a receipt-COMMIT response.
RT13 now composes actual automatic message delivery and separate case capture.
See [delivery evidence](evidence/automation-worker-verification.json).
This paragraph records the delivery milestone. Operator recovery now has the
separate implementation/evidence below; the browser remains next work.

## Operator recovery

The optional, default-denied `automation.publish` capability also governs narrow
automation recovery. It is checked on every operation and again before commit or
response. No capability grant or Discord command registration is changed.
Migration 044 retains request hashes, the original operator grant and a link to
the delivery audit sequence. These are metadata records, not message copies.

`GET /api/automation/issues` pages ten parked deliveries; `before` is the previous
page's delivery-ID cursor. `GET /api/automation/issue?deliveryId=...` returns current
metadata and ten audit events, with an optional sequence cursor. No action text,
source text, profiles, files or credential/grant data is returned. Corrupt bound
references stay visible as an unverified issue without enabled repair actions.

`POST /api/automation/repair` uses the established authenticated session, origin
and CSRF checks. Its closed request contains `deliveryId`, `expectedVersion`,
`action` (`recheck` or `recover`), `messageId` (or null), a 64-character hexadecimal
`requestId`, and explicit `confirmed: true`. The current review version must match
the parked job. A recorded receipt describes the accepted repair request, not a
claim that delivery is currently complete. After an uncertain submission, repeat
the exact request rather than creating a new ID; fresh authorization still applies.

Recheck is allowed only when there is no unknown possible send. It releases the
existing job, advances its fence and resets its attempt budget while preserving
deadlines, possible-send state, receipts, job cooldown and the shared Discord
pause/backoff. It cannot release a restored-quarantine job. Expired unstarted
work will be cancelled by the normal worker; no deadline extension is granted.

Recover verifies a currently existing effect for a pending unknown send. For a
message, the submitted ID must identify Sophie's exact marked static output in
the retained destination. For a reaction, `messageId` is null and the retained
source must currently show Sophie's own matching reaction. Absence is never
treated as proof that a send did not happen, and recovery never issues POST/PUT.
Matching an observed reaction establishes the current own effect, not the causal
origin of Discord's earlier unknown response. The single bot identity must remain
under core ownership.

Current non-case channel checks precede and follow candidate inspection. Opaque
proofs bind the plan, effect, fresh bot permissions and Gateway continuity.
Recovery remains possible after deadline, source-member departure or policy
withdrawal so a normal worker can remove a verified obsolete effect. It does not
bypass the worker's current eligibility decision. An excluded destination,
missing/mismatched effect or corrupt reference remains parked for operator
investigation; do not clear flags or edit the database to obtain another send.

The outbox is locked before the delivery. Candidate adoption, operator audit and
queue release commit together. Concurrent/stale controls cannot reset a newer
job; late original receipts can agree with an adopted receipt without duplicate
audit or another send. Exact request receipts survive later policy/queue changes
and lost COMMIT acknowledgement. No retained record is automatically deleted.

45 focused checks, AR01–AR19, AD01–AD24, RT01–RT13, 52 reply and 67 intake
scenarios pass: 175 integration scenarios in five stopped isolated clusters.
AR16 encrypts/restores operator receipts and audit into quarantine. RT13 composes
OAuth-authorized recovery of an uncertain automatic send. Its synthetic clock
advance explicitly waits for a fresh Gateway heartbeat before further operations.
See [recovery evidence](evidence/automation-operator-verification.json).
That milestone left the reviewed browser and independent T45 recovery/permission
acceptance open. The browser is now implemented as described below. Keep live automation disabled.

Full suites and independent live acceptance are unrun. Existing suites received
only their current migration-count update unless named above. The single human
worksheet keeps full T45 unpassed. Next qualify the safe staging upgrade and private browser acceptance;
do not substitute synthetic delivery and recovery checks for
live loop/mention/privacy evidence.

Before any authorized staging upgrade, stop the host, apply all missing
migrations 033–045, grant the new tables' restricted privileges, verify hashes
and grants, and restart after old leases expire. Staging currently remains 032.
Do not rerun bootstrap. Rollback disables admission and stops the new API while
preserving all policy, receipt, cooldown, operator/delivery-audit and job rows; use a schema-045-aware
binary. Production release, independent
backup and all human gates remain open.

## Configuration and recovery browser

`/automation` requires the current `automation.publish` capability. The memory-only
editor reuses the pure policy validator, retains rule IDs, and separates approved
public source, literal matching, message/reaction action, priority/stop and cooldowns.
Removal needs confirmation. Publication and withdrawal show previous/proposed rules
and require explicit confirmation. Uncertain mutations freeze competing edits and
retry the exact request. History can be reused as a new draft after discarding edits.
Periodic access checks preserve unchanged reviews; changed versions invalidate them.
Hidden-page, account-change and access-loss handling clears drafts and samples.

Dry-runs accept only explicitly attested synthetic events and display bounded
decisions/actions without retaining sample text. Tickets and onboarding content
must never be pasted into this editor. Publishing does not enable live automation.

Parked-delivery lists and event history contain metadata only. Recovery reviews
re-read the current version and flags. Unknown sends offer verification of an
existing effect, never recheck/resend. Message recovery requires the exact output
ID; reaction recovery uses the original source. A recorded request is distinguished
from completed delivery. Corrupt and quarantined records have no repair path here.

42 focused checks and AR01–AR20 pass. Synthetic browser review, exact retry,
preview, message/reaction controls, narrow layout and revocation clearing were
inspected. See [browser evidence](evidence/automation-browser-verification.json).
No new dependency, migration, activation or human acceptance is included.
