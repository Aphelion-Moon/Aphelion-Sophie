# Curated public answer library

Scope: P17/P18, R06 and partial T04/T05/T45. This covers the service/API, browser, Discord lookup and confirmed reply selection,
not full canned-reply or static-chat-rule acceptance. No live deployment occurred.

## Publication and access

The library accepts human-authored public configuration only: a stable name,
title, exact text and public-source description. Titles are bounded to 80 UTF-16
units, text to 4000 and source descriptions to 300. No URL is fetched, template is
executed, ticket is imported or answer is generated. Human editors must attest
that their text is approved for public use; software cannot establish that an
editor's source claim is true. Never copy ticket content into this library.

Publication requires the optional `answers.publish` capability. Omission or an
empty role list denies editing, including to Discord administrators and owners.
Operators must explicitly configure approved Staff/lead-ops role IDs and advance
the capability-policy version before enabling editors. No existing configuration
or live role grant was changed by this milestone.

Current non-bot guild members can look up the latest published answer. This is
public library access, not case access. Editorial history requires publication
authority; withdrawn text is unavailable to ordinary lookup. Every operation
authenticates its actor and checks current authority both before and after its
work. Publication never grants permission to read, manage or reply to a case.

## Review, retention and races

Review returns the exact candidate and a digest bound to its name, action,
expected revision and text. Change requires that digest, explicit confirmation
and public-source attestation. The digest is a review binding, not an authorization
credential. The current publisher grant supplies attribution.

Migration 038 retains each immutable publication or withdrawal and its exact
request receipt in `curated_answers`. Withdrawal appends a tombstone and preserves
all previous text and authorship. It does not erase previously sent messages.
Reusing a request returns its original result after current authorization; it
cannot restore a subsequently withdrawn answer. Changed actor or request meaning
is rejected. Competing revisions have one winner.

Operations serialize per guild. The library permits 100 distinct names, including
withdrawn ones, with retained revisions rather than expiry. Existing names may be
republished after review. Public pages contain up to 25 titles; editorial history
contains up to ten revisions. Stored document and request digests are checked
before serving or mutating a record. No publication queues a Discord message.

## Shared API and browser

OAuth/CSRF-protected routes are `/api/answers`, `/api/answers/lookup`,
`/api/answers/history`, `/api/answers/review` and `/api/answers/change`.
GET query and POST body shapes are closed; callers cannot supply actor identity
or case references. Responses are actor/guild-bound and use `no-store`.

`/answers` exposes member lookup and a separately permitted editor. The session
reports `canEditAnswers` from current configured authority; every API operation
still authorizes independently. Omitted flags fail closed in the browser. Editors
open a published or retained name, edit literal title/text/source, and review the
exact candidate alongside the previous publication. Changed revisions require
fresh review and show a warning. Publication requires explicit public-source
attestation; withdrawal has a separate review preserving history.

Unsaved changes block entry switching until explicitly discarded. Uncertain
submissions retain one exact in-memory request, disable competing changes and
provide receipt retry, including when a later editor has already withdrawn that
publication. A duplicate receipt never claims to restore it. Background access
refresh invalidates review while preserving a dirty draft's original revision.
Identity change, failed access, editor loss, logout and hidden-page events clear
drafts, review, history and pending requests; a warning states that an already
submitted change may still complete. Late responses cannot repopulate cleared data.
Only the existing Quiet mode preference uses browser storage.

Public library and editorial history have bounded paging. The DOM renders all
authored copy with literal text/value operations; it does not inject HTML. Focus
moves to the review heading, controls have labels, and existing shared presentation
and navigation are retained. No private browser session is used in development.

The case-reply browser can now select a current public answer into the existing
confirmed reply workflow. It shows the exact text and revision, preserves case
authorization and suppresses mentions. See [selection details](case-replies.md).
Discord `/ticket answer` now adds full-text review with owner-bound Confirm/Cancel
controls; see the same selection details. Static rules, cooldowns, channel allowlists and
generic-automation ticket exclusion still require implementation.

## Evidence and rollout

The Discord review milestone adds migration 040. Twenty-three focused checks,
CR01–CR52, CA01–CA13, 67 intake/recovery scenarios and RT01–RT11 pass, including
review-inclusive encrypted restore and signed confirmation/cancellation.
Expiry, original-author binding, changed grant/case/audience/source rejection,
concurrency and exact receipt recovery are verified. See
[review evidence](evidence/answer-review-verification.json). No live upgrade or
independent client acceptance; the following entries record earlier milestones.

The selected-reply milestone adds migration 039 and preserves source name,
revision and document hash with the exact reply text. Twenty-seven focused checks,
CR01–CR43, CA01–CA13 and RT01–RT11 pass, including encrypted restore of selected
replies and withdrawn source history. Synthetic Chromium verifies explicit review,
literal read-only selection, exact retry after withdrawal, retained source labels
and access-loss clearing. See [selection evidence](evidence/reply-answer-verification.json).
All isolated clusters and the browser preview stopped. This does not establish
live Discord or independent client acceptance.

Discord `/answer list` now lists up to 25 current published names. Use its
`after` cursor for another page and `/answer show name:<name>` for a full entry.
The response includes the approved title, exact text, source label and revision.
Current guild members can look up public entries without editorial or case access.
The signed interaction response is ephemeral; the retained catalogue is also
available at `/answers`. Ticket navigation DMs are unchanged.

The response adapter resolves current identity and publication at delivery time.
Withdrawal prevents new lookup, including requests acknowledged before withdrawal.
An already delivered public answer remains a snapshot; withdrawal cannot recall
it or atomically stop a Discord request already in flight. Lookup never selects
a case, posts a reply, fetches a source URL, imports content or invokes AI.
Mentions are suppressed. Full text uses a single embed within Discord's
[message limits](https://docs.discord.com/developers/resources/message#embed-object).
Guild registration explicitly adds only the fixed `answer` command alongside
the existing four commands. No live command registration was performed.

For this Discord milestone, 18 focused signed-parser, lookup, response, registration
and reply regressions plus RT01–RT11 pass. RT11 uses real isolated PostgreSQL,
signed HTTP interactions, current ordinary-member authorization and simulated
Discord to verify full text, paging, departure and withdrawal. The cluster stopped.
See [command evidence](evidence/answers-command-verification.json). Independent
Discord client readability, mobile and assistive-technology checks remain open.

Seven focused contract/authorization checks, CA01–CA13 and RT01–RT11 pass offline.
The owned database clusters stopped. CA covers membership/editor separation,
attestation, stale reviews, exact retries, concurrent publication, revocation
rollback, bounded pages/capacity, corruption, HTTP/CSRF and retained history.
CA13 performs actual encrypted core backup/restore and compares all publication,
withdrawal, author and receipt fields; the restored database remains quarantined
and read-only. RT05 verifies publication is disabled without a grant, and RT11
exercises configured review/publication/withdrawal through the composed runtime.
See [database evidence](evidence/answers-verification.json),
[runtime evidence](evidence/staging-verification.json) and
[milestone evidence](evidence/answers-api-verification.json).

For the browser milestone, 25 focused controller/transport/asset regressions and
RT01–RT11 pass. Synthetic Chromium interaction verifies literal markup, focus,
explicit confirmation, lost-response receipt recovery, withdrawal with retained
text, history paging, editor-loss DOM clearing and continued member lookup. The
preview process and tab were stopped. See
[browser evidence](evidence/answers-browser-verification.json). CA01–CA13 remain
their recorded backend build; that suite was not rerun for browser work.
Mobile, assistive-technology and independent live multi-account checks remain open.

The browser milestone repository check covered 355 source files. No new dependency, licence or Discord
permission is required. Full suites, independent client acceptance and live migration
remain unrun; the shared worksheet records these gaps without passing T45.

Live staging remains on migration 032. An authorized maintenance upgrade must
stop the host, apply missing migrations through 040 with the owner identity,
grant normal restricted runtime SELECT/INSERT/UPDATE on the new tables, verify
hashes/privileges and restart after old leases expire. Do not rerun bootstrap.
Rollback stops the new route, keeps publication and audit rows, and uses a binary
compatible with migration 040. Never drop retained records to start an older
binary. Off-host recovery and all production gates remain open.

After an explicitly authorized command registration, a code rollback may leave
`/answer` visible but unsupported. Disable that command in the guild or restore
compatible lookup code; do not bulk-delete commands owned by existing services.
