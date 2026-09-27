# Staff-created contacts and recipient navigation

Scope: P05/P06/P08–P11/P17/P19; partial R02/R04/R07/R12/R16 and
T01/T04–T09/T16/T22/T36/T57. This implements initial Staff-contact selection,
retained intake and recipient navigation using the existing form, invitation,
permission and delivery services. No case data enters an AI path.

## Entry, selection and confirmation

`/ticket contact` requires current Staff or lead-ops case-management authority.
It returns a private User Select for one to twenty current human recipients.
The signed actor remains the creator; Discord's resolved roles and source
message are discarded. The response follows Discord's documented
[User Select contract](https://docs.discord.com/developers/components/reference#user-select),
checked on 19 September 2026. Registration and real client compatibility remain
live acceptance work.

Selection pins the recipient membership bindings, initiating Staff grant,
published `staff-contact` form version, opener presence and case policy in a
bounded temporary form handle. Ordinary and contact forms share the existing
128-slot guild limit, four unexpired handles per creator, three-second reservation
cadence and ten-minute expiry. Expiry permits slot reuse; it never deletes a
submitted case, answers, invitations or audit history.

The private review names the creator, selected IDs and Staff/lead-ops responder
audience, and explicitly states that they can see the submitted form and retained
history. Confirming opens blank authored questions; cancellation creates no case.
Another member cannot confirm, cancel or submit this handle. Changed recipients
need a new selection. Duplicate selection compares structured bindings without
depending on PostgreSQL JSON key order.

Confirmation checks current and original Staff authority within the initial
modal-response deadline. It grants no channel access. Recipient membership is
checked on selection, review, submission and every delivery boundary; twenty
recipient lookups are not added to the modal's initial-response deadline.
Submission requires explicit confirmation and the original pinned form, with
current Staff and recipient checks before and after recording its effects.

`staff-contact` is the seventh independent configuration category in the shared
authoring API and browser editor. The same `case.forms.publish` capability,
review, immutable publication, withdrawal and history apply. Public Ticket Nexus
buttons cannot bypass Staff entry. No final production questions are invented
or published, and no chat content is transferred into the form.

## Durable creation and first delivery

One transaction retains the case, answers, initial invitations, one action audit
per recipient, case/audience versions, exact receipt and provisioning/delivery
intent. One submitted interaction may record multiple distinct recipient
actions. Existing-case single-recipient changes retain their receipt and version
checks. Action/invitation writes share transaction helpers with those changes.

Migration 028 widens authored categories, adds bounded selection/confirmation
metadata to form slots, records the initial contact-authority outcome on intake,
and permits distinct recipient actions for one interaction. Existing ordinary
forms, hashes, answers and delivery identities remain unchanged. Existing table
privileges continue to deny knowledge access and core DELETE operations.

Before first audience confirmation, the worker rechecks the initiating Staff
grant as well as each invitation. Lost Staff authority revokes the initial
contact; losing all selected recipients also stops first creation. With some
current recipients remaining, invalid invitations are retained as revoked and
the worker verifies the reduced audience. A late external write is sealed or
reconciled under current policy. This is eventual repair, not an exactly-once or
zero-exposure claim.

After a verified non-sealed audience, the contact is confirmed and unrelated
later changes to the creator's Staff roles do not undo that completed action.
Recipient departure/rejoin still revokes the old invitation. Explicit Staff
reopening can supersede a revoked initial request when a channel exists, using
the normal retained lifecycle audit and fresh authority. Reopening does not
restore revoked invitations; each recipient needs a new explicit action.

## Private recipient navigation

`/ticket contacts` lists at most five currently invited contacts per page. It
shows only creator, creation time and access state. Recipients see navigation
controls, never form excerpts, notes or conversation previews. Each destination
requires a current retained invitation, matching membership epoch, a fresh
opener observation, current policy and an exact private-channel proof. Removed,
departed, unrelated or merely Staff identities cannot use a copied recipient
reference. Staff retain their separate management queue.

Closed contacts may link to the existing read-only audience, subject to the
provisional closure policy's release review. Sealed/failed contacts cannot yield
a destination. Queue buttons confer no authority; access is rechecked when
opened and again after Discord inspection. No recipient member-row lock is
nested inside the opener lock. All ephemeral replies suppress mentions; this
feature sends no unsolicited DM or recipient ping. The existing bounded
responder notification remains part of retained answer delivery.

## Verification and remaining work

Four additional contract tests cover signed selection isolation, strict routing,
explicit audience review and independent browser configuration. SC01–SC23 cover
the PostgreSQL services, bounds, original/current Staff authority, absence/bots,
confirmation/cancellation, membership loss/rejoin, duplicate/lost-acknowledgement
recovery, atomic rollback, pinned/withdrawn forms, private pagination, exact open
and closed audiences, late writes and navigation revocation, schema preservation,
slot reuse, initial deadlines, real signed loopback HTTP and explicit reopening.
S36 recreates authorization, intake, channel adapters and the worker across two
database restarts, retaining selection and pending invitations while respecting
the delivery barrier. Actual execution and source hashes are recorded in
[verification](verification.md); these descriptions alone are not passing tests.

Initial contact entry now also has a [dashboard workflow](contact-entry-dashboard.md)
through the same services. Final questions, live command registration/client/ACL
checks, controlled file downloads and independent
backup/restore remain open. Earlier browser-category coverage is
controller/API integration evidence; it is not a new independent visual review.

Recipient browser discovery and verified links are now implemented through the
shared navigation flow; see [current recipient evidence](contact-recipient-dashboard.md).

Rollback: disable contact entry and delivery before reverting adapters. Preserve
migration 028 and retained contact/intake/invitation records; old application
versions do not understand the new category or initial authority state. Do not
drop columns, rewrite historical checksums or replay restored jobs into production.
No production schema, service, Discord application or case was changed.
