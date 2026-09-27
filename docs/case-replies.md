# Human Staff replies

P06/P11/P17, partial T05/T07/T10/T22/T36/T39. The shared core request, authenticated
HTTP API, browser composer and runtime worker are implemented and verified offline.
The Discord command shares the same request service. No AI, note-to-reply transfer or
automatic drafting. Live staging remains on migration 032.

The internal reply renderer preserves up to 4,000 UTF-16 units of well-formed,
human-authored text, including whitespace and Markdown. A fixed embed title shows
the human author's Discord ID; the footer binds the durable reply ID. All mention
allowances are empty. Extra text, embeds, files, controls and attribution formats
are rejected. The authorized store supplies the author and exact text; the
renderer itself cannot authenticate a person.

## Requests, authorization and retained state

### Selected public answers

Migration 039 adds nullable `answer_reference` to each reply. Old manual replies
retain their original hashes and text. Selected replies retain the public answer's
name, revision and full-document SHA-256 alongside the exact text and original
author grant. The library keeps that publication even after withdrawal.

The shared request API accepts an optional `answer` object with exactly `name`,
`revision` and `sha256`. Under the case lock, admission checks current Staff and
case authority, then locks the same guild publication boundary as library edits.
It accepts only the current published revision/hash with exact matching text.
No public-reader or publisher permission grants case access. Final Staff access
is rechecked before commit. Outbox and event metadata never copy the answer text.

An exact prior receipt resolves before consulting today's library. A changed
reference or text collides with the original request ID. Withdrawal prevents new
selections but does not cancel a reply already confirmed by its human author and
admitted to the ledger. Such a request remains a snapshot; delivery still checks
the original author, membership, case audience and private channel permissions.

In `/case-replies`, open the permitted case, clear any draft, enter an approved
name from `/answers`, then choose **Use approved answer**. Selected text is read-only.
Review shows the case, full text and publication revision. Confirmation is required.
Review rechecks the publication; a changed or withdrawn source clears selection
without replacing it silently. Uncertain submission keeps its exact text and
reference for retry. Retained history shows the selected name and revision.
Access loss, identity change and hidden pages clear selection and private text.
The ordinary Discord `/ticket reply` remains a manual-text command; direct
Discord selection of reviewed public answers is still pending.

Twenty-seven focused checks, CR01–CR43, CA01–CA13 and RT01–RT11 pass. CR37–CR43
exercise source binding, receipt retry after withdrawal, mismatched selection,
ordinary-member denial, late Staff revocation, concurrent withdrawal, migration
replay, corrupt provenance and actual encrypted restore in read-only quarantine.
The browser preview verifies literal text, review focus, confirmation, one
retained request after a lost response and withdrawal, source labels and access
loss clearing. See [selection evidence](evidence/reply-answer-verification.json).

Migration 036 adds `case_replies`, `case_reply_events` and the closed `case.reply`
outbox kind. It leaves existing cases/intake unchanged and invents no historical
reply requests. Core receives SELECT/INSERT/UPDATE only; knowledge gains no
access. There is no expiry or body in an outbox job, control-history projection
or ordinary delivery error. Text and audit survive encrypted core restoration;
the existing restore quarantine prevents serving or replaying restored jobs.

`GET /api/cases/replies?channelId=...` returns a current-responder history page of
at most 25 retained replies, with a paired `beforeAt`/`beforeId` cursor. Drafts,
pending/failed replies and their history require current `case.manage`, including
Head Admin isolation. Membership or channel visibility is insufficient. Closed
cases retain readable history; sealed and inaccessible cases are denied. Replies
actually delivered into the case are visible to its current readers; Gateway
capture retains the embed's human attribution with the conversation.

`POST /api/cases/replies/request` requires OAuth/CSRF, the exact fields
`channelId`, `requestId`, `expectedVersion`, `text`, `confirmed: true`, and current
Staff authorization before and after the transaction's work. The case must be
open. The server derives the author, retains the reviewed version and audience,
and atomically records the request, audit and outbox intent. A SHA-256 binds case,
author, version and text; corrupted retained data is not served or delivered.
Exact receipt retries return the original outcome under current authorization;
changed text or another author cannot reuse that receipt. A new request requires
the currently reviewed case version.

The queue permits five pending replies per author per guild, twenty per case,
and one new authored request per three seconds. Serial case/author locks enforce
these bounds across concurrent submissions. Pending records never expire to make
room. HTTP capacity/cadence refusal returns 429; exact committed retries remain
available. Responses are no-store and carry authenticated actor/guild IDs.

## Delivery and recovery

The private-message adapter uses the existing exact channel audience and fresh,
single-use preparation checks. It verifies the bot author, channel, marker,
message ID, observed text/attribution and actual mentions. Stale authentic receipts
can identify a late result but cannot authorize delivery or confirmation.

A narrow withdrawal operation can remove only an observed own reply from the
identified case channel. It requires current channel identity, fresh authentic
message proof and a single-use preparation, even after the audience stops being
valid for sending. It does not remove retained case history. This uses Discord's
[single-message deletion endpoint](https://docs.discord.com/developers/resources/message#delete-message),
which permits an author to delete its own message without granting broad message
management rights. A lost deletion response remains uncertain; an explicit later
unknown-message GET proves absence. Missing channels, foreign objects, fabricated
proofs and other errors do not prove successful removal.

The worker rechecks opener presence/epoch, policy registration, case state,
reviewed audience and the recorded Staff grant before sending and before final
confirmation. A known failure makes withdrawal sticky. Unsent requests become
`cancelled`; known late messages are removed and become `withdrawn`. Their text,
author, request and delivery events remain retained. A durable withdrawal decision
does not require the original Staff grant to become valid again. Confirmed
historical replies are not removed when their author later loses Staff access.

Send intent commits before POST. Definite rate-limit refusal can release an unsent
attempt while preserving the shared Discord barrier. Unknown POST responses or
armed crashes park without a blind repeat; authentic late IDs survive an old
lease and queue current-policy reconciliation. Missing or uninspectable known
messages require review. An uncertain DELETE is recovered by a fresh absence
check, never by assuming success. Worker retries cannot make Discord atomic with
PostgreSQL or prevent every in-flight external race.

The API distinguishes pending, uncertain, needs-review, withdrawing and terminal
states. `/ticket issues` includes bounded reply delivery metadata for current case
responders, with Head Admin isolation. It includes the reply marker, never authored
text. Recheck records an audited, revision-checked worker retry for unsent work or
a known message ID. An unknown attempted send blocks Recheck: the operator must
identify the matching Sophie message and use `/ticket recover` with its ID.

Recovery verifies fresh channel identity and the bot author/channel/reply marker.
It retains that reference without confirming delivery, clearing the send flag or
changing the original author grant. The normal worker then verifies exact text and
current authorization; altered text or a revoked original author leads to withdrawal.
A different current responder can perform recovery. Duplicate requests preserve one
audit action, and competing or old revisions cannot revive the parked job.
Do not clear possible-send flags or reset jobs manually to force a repeat. Missing
bot access, unknown IDs and uninspectable external results remain operator work.
Repeated audience instability does not reset the bounded worker attempt budget.

## Staff browser replies

`/case-replies` shares the authenticated request/history service. Staff select the
main case channel, write a reply, review its literal text and case, and explicitly
confirm sending to all current readers. Restricted notes stay in `/staff-notes`.
Each review refreshes current access/version. Background access checks invalidate
confirmation without silently changing the draft's original version; a new review
warns when the case changed after drafting. Closed history is read-only.

Unknown submission results retain one exact request in memory and disable new
composition/case switching until its retry resolves. Definite validation/conflict
rejections restore the draft for a new access check and review. Hiding the page,
changing accounts, or failing an access check clears private text and pending
request data. A submitted request may still complete after local clearing: inspect
history before composing another copy. No draft or reply is stored in browser
persistent storage. Delivery status distinguishes pending, uncertain, operator
review, withdrawing, confirmed, cancelled and withdrawn records.

Twelve focused controller/API/static-asset checks pass. Synthetic Chromium checks
cover literal text, confirmation, focus, lost-response retry, pending/confirmed
status, paging and clearing after access loss. The temporary preview and its tab
are stopped/closed. See [browser evidence](evidence/replies-browser-verification.json).
These checks do not replace live multi-account privacy, accessibility or client
acceptance. The browser assets are not deployed to staging yet.

## Discord reply command

`/ticket reply case:<id>@<version> text:<human reply> confirm:True` uses the
reference from `/ticket status`. Staff review their command text and current case
before choosing the required confirmation. `False` records no reply. This is a
direct confirmed command; the dashboard offers a separate preview screen. The
[Discord command schema](https://docs.discord.com/developers/interactions/application-commands#application-command-object-application-command-option-structure)
supports the bounded string and Boolean options; Sophie applies the same 4,000
UTF-16-unit limit as its browser/API service.

Signature verification holds text separately from the immutable routing envelope.
Only the reply adapter can consume that authentic text, once, within the proof
window. It resolves current Staff authority and case destination, then calls the
shared request service with the reviewed version. Re-delivery of the same signed
interaction uses the same request ID and returns the original result. A newly
invoked command is a new request: after an uncertain response, inspect Case replies
in the dashboard before sending another copy. Static ephemeral acknowledgments
contain no authored text and distinguish pending, confirmed, cancelled, withdrawn,
limited and uncertain outcomes. No command adds a direct Discord send path.

Fourteen focused command/verifier/receiver/response regressions pass. CR28–CR29
exercise the shared database service, duplicate delivery and access boundaries.
RT04 exercises signed HTTP command receipt through the composed worker and verifies
one delivered message plus an idempotent confirmed result. Command registration is
updated in source only; live staging has not registered `/ticket reply`.

## Discord approved-answer review

`/ticket answer case:<id@version> name:<approved-name>` prepares an ephemeral
review of the entire published text and source revision. Confirm reply explicitly
admits that snapshot through the same reply transaction as the browser; Cancel
settles an unsubmitted review. It never sends directly from a component handler.
Migration 040 retains metadata, the original author grant and source identity;
text remains in the immutable publication and accepted reply records.

At most five active reviews per author are allowed. Controls expire after ten
minutes without deleting records. Confirmation requires the reviewing author,
current case authority, unchanged grant, case version, audience and publication.
Copied controls and revoked authority fail closed. Competing confirmation/cancel
clicks serialize. A submitted review resolves the original receipt after expiry
or source withdrawal; cancellation then truthfully reports it already submitted.

23 focused checks, CR01–CR52, CA01–CA13, the 67 intake/recovery scenarios and
RT01–RT11 pass offline. CR43 verifies encrypted restore of pending, cancelled
and submitted review metadata alongside retained reply/source history. CR44–CR52
cover ownership, expiry, corruption, concurrency, late revocation rollback,
lost commit acknowledgement and migration preservation. RT11 exercises signed
review/cancellation/confirmation and browser interoperability. See
[review evidence](evidence/answer-review-verification.json). No live command
registration or independent Discord-client acceptance has been performed.

## Verified scope and next work

For the operator recovery milestone, 14 focused issue/adapter regressions,
CR01–CR36, the 67 B/X/Y intake/recovery regressions and RT01–RT10 pass. The owned
isolated clusters stopped. RB01–RB10 remain earlier encrypted-restore evidence;
that suite was not rerun for the metadata-only migration 037.
CR covers authorization, atomicity, concurrency/bounds, corruption, closed cases,
revocation/ACL races, late leases, missing/changed messages, HTTP confirmation,
CSRF, history, migration 036, recovery authorization/concurrency and migration 037
backfill without resetting attempts or send state. RB03 retains reply requests and audit in an actual
encrypted restore. RT05 exercises OAuth request → worker → attributed message →
Gateway capture. These use only authored synthetic fixtures. See the reports for
[replies](evidence/replies-verification.json),
[intake](evidence/intake-verification.json),
[restore](evidence/recovery-verification.json) and
[runtime](evidence/staging-verification.json). The earlier
[adapter report](evidence/case-reply-messages-verification.json) remains its recorded
build; later source differences are identified separately. RT04 additionally
exercises a lost POST response, metadata issue queue and verified message adoption
through signed HTTP commands, ending with one confirmed message. See
[operator recovery evidence](evidence/replies-recovery-verification.json).
Full suites and live Discord acceptance remain unrun.

Next: static rules, remaining shared-route parity, independent live privacy/
attribution/client checks and the remaining production gates.

No dependency, licence, Discord-permission or live-service change. Command
registration must be updated during an authorized upgrade. Before an authorized
staging upgrade, stop the host, apply migrations 036–040
with the owner identity after the missing 033–035 migrations, grant only the
normal restricted runtime privileges on the new tables, including
`case_answer_reviews`, verify migration
hashes/privileges, and restart after lease expiry. Do not rerun bootstrap. Rollback
stops the reply worker and preserves all requests, audit and jobs; a compatible
binary must still understand migrations 036–040. Migration 040 adds retained
review metadata; expiration never authorizes deletion. Migration 039 adds a column to
the existing reply table, requiring no additional grant. Migration 037 only backfills
existing issue metadata; it adds no table or privilege. Never drop these tables to make an
older binary start. Production, independent backup and release gates remain open.
