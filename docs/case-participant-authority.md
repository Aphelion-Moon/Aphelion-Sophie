# Participant membership authority

Scope: P05/P06/P09/P10/P17/P19; partial R02/R04/R07/R12/R16 and T01/T04–T08/T16/T22/T36. This is the membership-revocation prerequisite for explicitly chosen case participants. It does not create invitations, change a case audience, implement Staff-contact intake or grant access from a selected identity. No dependency, production mapping, service or Discord write is added.

## Separate membership and Staff permissions

Migration 026 adds `presence_epoch` to the existing core `actor_authority` table. Staff capabilities continue using their existing `capability_epoch` and policy version. The four-field operator-grant format and all existing retained operator records stay unchanged. Existing authority rows begin with presence epoch 1; no case invitation is inferred from those rows.

The authority store updates the role observation, capability epoch and presence epoch in one transaction. Observing a departure or loss of human eligibility invalidates the old membership binding. A later return does not revive it. Ordinary role, Muzzled, Whitelist, timeout and capability-policy changes do not by themselves invalidate membership. They continue to affect Staff capabilities and other domain-specific rules. A Muzzled participant remains subject to the existing Shuttle prohibition; this membership helper adds no Shuttle permission.

The Gateway journal advances presence epochs on member removal or bot identities, a new Identify after lost continuity, and guild unavailability. Sequence duplicates return before applying revocation. A successful uninterrupted Resume preserves the epoch, while access remains unavailable until continuity is current again. Repeated independent absence evidence may advance an epoch more than once; its value is a monotonic invalidation marker, not a count of departures.

Removal also now revokes an old Staff grant when the authorization table knew the identity but the separate member journal had never seen it. This closes the window where REST could see a fast return before its member-add event without invalidating the old capability epoch. Revocation and the Gateway cursor commit together.

## Narrow core interfaces

`resolveCaseParticipant({ guildId, userId })` observes current guild membership, validates the continuity stamp before and after recording it, and returns either `null` or `{ guildId, userId, presenceEpoch }`. Missing or bot identities return `null`. The returned metadata contains no role list, case ID or management capability.

`authorizeCaseParticipant(grant)` validates those exact fields and fetches current membership again. It succeeds only for a currently present human whose retained epoch still matches. Unknown continuity, stale observations, foreign guilds, failed storage and an in-flight continuity change cannot establish eligibility. Absence is durably recorded before returning a negative result.

These are internal eligibility checks, not bearer credentials or case-authorization endpoints. A caller must separately authorize the Staff actor, obtain explicit participant confirmation, bind the selected identity to the actual retained case and its version, and recheck that record before every access or Discord effect. A caller-constructed membership binding cannot act as an operator or bypass the case's participant list. No HTTP/Discord route accepts these bindings from a client, and no dashboard preview exposes case content.

Using the existing authority journal keeps recipient observations independent of the case owner's member lock. This avoids adding a second member-row lock inside an existing case transaction. The [contact workflow](case-contacts.md) adds durable invitation state, current audience checks, post-effect verification and compensation; this helper does not make a Discord write atomic with PostgreSQL.

## Verification and remaining work

Two contract tests cover exact binding fields and the separation between membership, explicit case participation and Staff-only operations. PA01–PA10 use real isolated PostgreSQL with synthetic Discord metadata to cover current eligibility without an invitation, role-independent membership, departure/rejoin, absent/bot/foreign identities, first-seen Gateway removal, duplicate events, Staff revocation, Resume/Identify/guild gaps, in-flight invalidation, out-of-order observations, transactional failure, knowledge denial and migration preservation. S34 checks persisted epochs across restart, rejects old bindings, and requires current authority after recovery without creating a case or audience write. Execution results are recorded in [verification](verification.md).

The [participant workflow](case-participants.md) now adds signed selection/confirmation for existing cases, retained invitations, versioned channel plans and recipient departure reconciliation. [Staff-created contacts](case-contacts.md) add initial selection/forms and private recipient navigation. These membership checks alone do not claim live Discord/OS or release acceptance.

Rollback the authority-store, core authorization and Gateway changes together. Retain migration 026 and its monotonic values. Any participant-dependent flow must stay disabled under older code, which does not maintain this epoch. No production schema or case state was changed here.
