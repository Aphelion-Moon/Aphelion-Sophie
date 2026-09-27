# Player reports

Scope: P05/P06/P09/P10/P17/P19; partial R02/R04/R07/R12/R16 and T01/T04–T08/T16/T22/T36/T57. This extends the existing retained intake and delivery use cases with `/ticket report [player]`. Staff-created contact and explicit participant management remain separate implementation work. No production form, command registration, dependency or service is added.

## Entry and subject separation

The signed command opens the currently published `player-report` form. An optional Discord user selection records a subject ID; omitting it permits a report without a Discord identity. Details still belong in the owner-authored questions. The six existing Ticket Nexus buttons remain unchanged. The static command definition now includes both `/ticket open` and `/ticket report`; importing it performs no registration or remote write. The user option follows Discord's [application-command contract](https://docs.discord.com/developers/docs/interactions/slash-commands), checked on 19 September 2026. Actual client compatibility remains a live gate.

The requester remains the signed actor, authorization target, case opener and owner of the modal handle. The subject is never an authorization target. Resolved user/member objects, names and role snapshots are not retained. There is no subject membership lookup, blacklist import, account-linking operation or BYOND action. A departed/nonmember subject does not invalidate a currently eligible reporter's request. Muzzled requesters can use this support flow under the existing `case.create` policy; Shuttle restrictions are unchanged.

The subject is pinned when the form handle is issued. Replaying the same opening interaction with a different subject is rejected. Submission accepts only the pinned form answers; it cannot supply an audience or replace the subject. Expiring a temporary handle never expires a submitted report. Reusing an expired slot clears its old subject when opening an unrelated form.

Selection grants no access and produces no user mention or direct message. Report channels use the ordinary requester/Staff/lead-ops audience, independent of the subject. Someone who already qualifies as a responder retains those existing permissions; selecting them as the subject neither grants nor revokes that authority. Head Admin contact keeps its separate lead-ops audience. Channel names and topics contain no report subject or allegation.

## Durable data and delivery

Migration 025 extends the accepted authored form categories and adds nullable `subject_id` columns to temporary form slots and retained intakes. Existing definitions, hashes, answers and message identities are unchanged; historical records receive no invented subject. Constraints permit a subject only on a player report and require a valid identifier. The retained intake keeps opener and subject in separate fields, with the exact form version and answers.

The existing member transaction commits the case, subject, answers, consumed handle, exact receipt, bounded message plan and provisioning/delivery intentions together. Duplicate or lost-acknowledgement recovery requires current authority. A departure, expired handle or revoked principal cannot obtain authority from an old receipt.

The ordinary worker first verifies the private channel and delivers the exact pinned answer pages. Its final Staff notice includes the selected Discord ID as plain text, or states that none was selected. Allowed user mentions remain empty; only the existing bounded Staff role notice is permitted. The committed payload hashes cover this subject text: an unexpected stored subject change stops delivery for review before a POST. Subject IDs stay out of outbox effects, generic receipts, channel plans and ephemeral destination replies.

All submitted data remains core-only, with no automatic expiry, knowledge-store permission or AI path. Closure retains it. This milestone does not implement conversation capture or archival attachment/transcript retention.

## Configuration and checks

Player report is the sixth form-authoring category. It uses the same explicit `case.forms.publish` capability, independent history, incomplete drafts, saved review, immutable publication and no-fallback withdrawal. The browser controller and its fixed transport accept the category; no report instances or submitted values enter configuration routes. Final questions remain unpublished.

Four contract tests cover strict signed selection, subject/access separation, plain-text delivery and independent browser configuration/transport. PR01–PR10 exercise PostgreSQL-backed provisioning and closure, absent subjects and Muzzled requesters, pinned subject conflicts and slot reuse, concurrent/lost-acknowledgement recovery, subject denial, atomic rollback/database isolation, version/withdrawal behavior, signed loopback HTTP, corruption rejection and migration preservation. Z04 now checks publication isolation across all seven categories, including the later Staff-contact form. S33 covers retained subjects, handles and partial delivery across a database restart, with the delivery barrier and fresh authorization intact. Current execution results are recorded in [verification](verification.md); specifications alone are not passed tests.

The browser configuration extension was checked through its controller/transport tests. The preceding [browser evidence](dashboard-forms.md) covers the shared editor controls; a new live Discord/OAuth/client or independent accessibility acceptance is not inferred.

## Remaining work and rollback

[Staff-created contacts](case-contacts.md) separately implement explicit recipient selection and current audience checks. Their [membership-revocation prerequisite](case-participant-authority.md) grants no invitation by itself. Final questions, production capability/role mapping, command registration, runtime composition, live clients and independent restoration remain open. No release gate is closed by this milestone.

Disable new report entry and pause affected workers before rolling application code back. Preserve migration 025 and retained reports; earlier code does not understand this category's subject-aware delivery. Do not drop columns, rewrite submitted records or retry report delivery with an older renderer. Existing source references and PNGs are unchanged, and no production state was modified.
