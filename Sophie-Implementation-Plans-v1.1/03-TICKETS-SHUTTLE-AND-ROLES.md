# 03 · Tickets, The Shuttle, roles, and automation

## Human-run ticket system

Create one private text channel per active case initially. Use distinct case types for support, player reports, staff-initiated contact, and Shuttle onboarding. The core record separates **opener**, **subject**, **participants**, and **assigned staff**. A reported player is not automatically added to the reporter's case.

Case lifecycle:

```text
requested -> provisioning -> open -> closing -> closed
                 |           ^                    |
          needs_operator      +------ reopen ------+
```

A request is not an open case until its channel and permissions are confirmed. Closing does not mean deletion succeeded. Keep transcript generation, channel archival/deletion, and retention expiry as tracked operations. Show failures with a safe retry rather than silently losing evidence.

Forms are versioned. Preserve the version submitted with a case. Support required short/long text, bounded select options and explicit participant choices that fit the pinned Discord API/library. Do not promise newly added component types until the compatibility spike passes.

## Permissions and case operations

Every case type defines who can open it, see it, assign it, add participants, close/reopen it, and retrieve transcripts. Staff-only notes belong in restricted application storage/dashboard, not as pseudo-private messages in a member-visible ticket channel.

Category placement is not sufficient privacy enforcement. Calculate effective channel permissions, apply explicit overwrites, and validate after creation and after role/category changes. Moving a case cannot silently broaden its audience. Discord's Administrator permission bypasses channel overwrites, and Manage Threads can expose private threads; communicate those platform limits accurately. [S08](11-SOURCES.md#s08)

Use non-identifying channel names such as `report-1042`, not the reported person's name or allegation. Member additions and transcript exports require confirmation plus an audit reason where sensitive. Case IDs are not authorisation tokens.

Support claim/unclaim, staff reassignment, human-written tags, manual priorities, and static canned replies. A canned reply is reviewed text, not a generated draft. Do not implement model triage, summaries, sentiment analysis or automated case-to-FAQ extraction.

## Attachments and transcripts

Keep transcript storage separate from web-public assets and the knowledge index. Escape all user content on rendering; never execute copied HTML. Use authenticated streaming/downloads with a fresh case access check, no public permanent URLs, and no prompt-containing logs.

Choose allowed attachment types, size/count limits, retention, and malware/quarantine behaviour at G0. Never fetch arbitrary user URLs as attachments. A registered connector may fetch only its approved source; case files use a separately bounded acquisition path. Do not run attachments or archive contents. If there is no approved scanning capability, restrict types and require download rather than inline active-content rendering.

Record message edit/delete observations when available. If the bot was offline or lacked access, label transcript coverage incomplete. Do not claim to recover messages deleted before capture or inaccessible history. Attachment URLs alone are not durable archival copies; the retention plan must state whether approved attachments are copied or only referenced.

## Shuttle experience

A persistent **Board the Shuttle** panel offers a button and a `/shuttle start` fallback. The handler verifies the existing admission prerequisite, finds or creates the member's one active session, and opens/resumes its private onboarding case.

Use the owner's final Shuttle copy, not invented values or admission criteria. Five stages can remain, but the old `s1`–`s5` roles do not drive state. Content is authored in the dashboard as a finite ordered workflow, with preview/publish and immutable published versions.

The member sees the current section with Continue, Back and Ask staff controls. Optional deterministic acknowledgements or forms must be approved as part of the workflow. Do not add AI explanations or open-ended model assessment.

Session lifecycle:

```text
not_started -> active(stage 1 ... n) -> acknowledged -> role_pending -> complete
                    |                       |               |
                needs_staff                 |         needs_operator
                    |                       |
               staff_resume           eligibility_revoked
```

Ask staff pauses progression only if that is the published workflow rule. Staff help is a human conversation in the case; resumption uses a logged action. A member can recover the current screen after a lost message or restart.

## Progression and recovery rules

1. Derive the member from the interaction, load current state, and check guild, case, active definition version, step, prerequisites, component nonce/version, and access epoch.
2. Treat Discord interaction IDs as deduplication inputs, not as proof of eligibility. Reject another member's or an obsolete step's controls.
3. Commit a single permitted transition using a transaction and expected session version. Concurrent clicks produce one transition and a current-state response for the duplicate.
4. Render the new state through an outbox action. An old or deleted Discord message never changes stored progress.
5. On final acknowledgement, recheck current admission eligibility and revocation state. Commit eligibility plus a pending role grant. Only mark access delivery successful when the configured role is observed.
6. Before every grant attempt, recheck the eligibility epoch and role ownership. Cancel stale grants after a revocation, exit, or staff decision.

A failed role write leaves a visible pending/blocked state and staff alert. It must not display a success it cannot confirm. Back navigation does not retract an already delivered membership grant; a completed session becomes read-only unless a deliberate staff reset/revocation workflow is invoked.

Published content changes apply to new sessions. Active sessions remain on their approved version by default. Emergency withdrawal invalidates affected sessions and requires a deliberate migration/resume decision; never silently change requirements halfway through.

## Membership and restoration

| Role class | Policy |
|---|---|
| Cosmetic/interests/notifications | Restore only explicit allowlisted roles |
| Join role | Assign only the configured non-privileged entry role |
| Admission/interview status | Owned by the existing admission process; do not infer from old progress roles |
| Whitelist/access role | Grant only from current eligibility and the agreed ownership contract |
| Staff/admin/privileged roles | Never restore automatically |
| Existing BYOND-bot roles | Never manage unless an explicitly revised ownership contract authorises it |
| Managed/integration/deleted/unassignable roles | Skip safely; show a diagnosable result |

A role snapshot is an observation, not entitlement. Store only approved classes. On rejoin, fetch current membership and policy, verify prerequisites, and recompute permitted actions. Rate-limit restores and report partial failure.

Out-of-band removal of an access role must not trigger blind automatic re-addition. Record it as a reconciliation exception or revocation according to the owner-approved policy; uncertain removals fail closed. Intentional revocation increments an eligibility epoch, invalidating queued old grants. Staff must not need to race a reconciler repeatedly restoring access.

During gateway outages, snapshots may be stale. Reconcile allowed roles on reconnect where possible; mark uncertain observations rather than pretending every offline change was recorded. Do not use an incomplete member cache to overwrite known state with an empty role list.

## Simple chat automation

Implement literal/keyword or bounded pattern rules with channel allowlists, per-user/channel cooldowns, and a priority/stop policy when multiple rules match. Suppress bot/webhook/self messages by default. Use explicit allowed mentions so template or AI text cannot create unwanted pings. Discord provides allowed-mentions controls for this purpose. [S07](11-SOURCES.md#s07)

Ticket channels are excluded from generic auto-reactions/responses by default. Essential deterministic ticket controls remain available. Arbitrary regular expressions and executable template logic are not a launch requirement; add only after validation and denial-of-service review.

## Canned knowledge and useful small additions

A manually curated canned-answer library can be used by staff in cases and by direct lookup outside cases. Import only approved public authored text—not ticket extracts. Editing this library does not grant access to confidential cases.

The first follow-on candidates are message-context reporting, staff reminders, scheduled announcements and suggestion statuses. Message-context reporting captures evidence into the case system only; it is not an AI operation.

## Sophie presentation in human workflows

Sophie is the bot's shared public identity, including the avatar shown beside deterministic messages. Static Sophie art and human-approved message templates may appear in onboarding and ticket entry panels. They never enable generation, ticket interpretation, drafting, triage or case-data ingestion.

Keep the existing Board the Shuttle, Continue, Back and Ask staff action meanings. Sophie branding does not rename steps, change prerequisites, certify a person, or replace final owner-supplied copy. In support/report cases, use neutral work surfaces and precise status wording; do not add a conversational mascot widget or imply an AI is reading the case. Staff replies remain attributable to staff.

Proposed copy examples and allowed contexts are in `12-SOPHIE-IDENTITY-AND-ASSETS.md`. A reassuring line is permitted only when the corresponding stored state or confirmed operation supports it. Template changes follow the existing preview/publish/version workflow.
