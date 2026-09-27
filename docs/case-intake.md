# Ordinary ticket intake

Scope: P05, P06, P09, P10, P17 and P19; partial R02, R04, R07, R12 and R16 coverage. This is an offline backend slice. It uses the existing case provisioning, permission, lifecycle and outbox systems. No dependency, production configuration, real form copy or Discord registration is added.

## Entry and forms

The static Ticket Nexus panel and `/ticket open type` accept six public categories: Quick Help, Admin Help, Staff Report, Tech Support, Database Support and Head Admin contact. Quick Help records a request without collecting a form. The other five require a published form for that category; absent configuration fails closed. Shuttle, [player reports](player-reports.md) and [Staff contacts](case-contacts.md) are separate use cases and cannot be invoked through these controls. Staff contacts share the bounded slot/answer services with explicit selection and initial Staff authority.

`modules/tickets/intake.js` accepts bounded data: a title and one to five short-text, paragraph or single-selection fields. Field IDs and option values are constrained identifiers; limits are explicit. Extra fields, duplicate IDs, unknown selections, executable conditions, uploaded files and resolved Discord entities are rejected. Answers must match the pinned definition exactly and are never silently truncated or dropped. Form fields cannot grant participant access or automatically add a reported subject. All checked questions and answers are authored synthetic fixtures; the owner's five forms remain unspecified and unpublished.

`case.forms.publish` is a new explicit capability. Existing capability policies remain valid and deny it by default. Assigning it requires a new immutable capability-policy version and an approved Staff/lead ops role mapping. The store checks current authority before and after each publication or withdrawal. Published versions retain their canonical hash and operator audit. Identical retries do not duplicate actions, conflicting content cannot overwrite a version, and withdrawal cannot be undone by republishing that version. New requests use the latest version only: a withdrawn latest form does not silently fall back to an older form. Already opened forms remain pinned to their older published version until expiry or withdrawal.

The [form-authoring service and API](case-form-authoring.md) add retained drafts, exact static review, version-checked publication, withdrawal and metadata history using that same capability and publication path. The [browser form editor](dashboard-forms.md) supplies the configuration workspace; the owner's final questions remain outstanding.

## Timing, retention and replay

Discord modals must be an initial interaction response. The receiver therefore prepares a form within a local 2.5-second budget and returns callback type 9 without deferring or sending a webhook follow-up. Ordinary submissions still receive a private deferred acknowledgement before their database work. A timed-out preparation retains the receiver's one-operation reservation until that work finishes; it cannot continue through the deferred command path. The platform specifies a three-second initial deadline and a 15-minute response-token lifetime. These are wire requirements, not measured production latency. [Discord interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding)

The supported modal wire format uses Label components containing Text Input or String Select components. Input limits, required flags and a single selected value are rendered explicitly; submissions accept only the supported bounded shapes. Text-only rendering and disabled mention parsing do not replace authorization. Real desktop/mobile compatibility still needs testing. [Discord component reference](https://docs.discord.com/developers/components/reference)

Migration `021-case-intake.sql` separates temporary handles from retained records:

| Table | Purpose |
|---|---|
| `case_forms` | Immutable published definitions and retained withdrawal status |
| `case_form_actions` | Publication/withdrawal actor grants and timestamps |
| `case_form_slots` | Temporary member-owned form handles, pinned versions and presence epochs; no answers |
| `case_intakes` | Indefinitely retained canonical answers, version, hash, requester and case reference |

Current development limits are 128 unexpired handles per guild, four per member, a three-second opening cadence and ten-minute expiry. Consumed handles continue counting until expiry, preventing their original opening interaction from recreating a form. Expired slots are reused without deleting case records. These numbers have synthetic boundary tests and still need live capacity review. Merely opening a form reserves no case capacity; submission rechecks the shared member/guild case limits and cooldown used by Shuttle and explicit reopening.

A form submission atomically commits its case reservation, retained intake, handle consumption, interaction receipt, provisioning intent and [answer-delivery plan](case-intake-delivery.md). Duplicate equivalent submissions produce one case. Reusing a consumed handle with different answers or an interaction ID with another request is rejected. An exact committed replay can still resolve its original case after withdrawal while the handle remains valid. Expiry, policy changes and departure/rejoin invalidate handles, including consumed ones; retained case records remain available to the existing Staff workflow. An uncertain commit is never automatically replayed with a new interaction ID.

Submission checks a signed member principal, current membership and authority, the handle's owner, current case policy, presence epoch and pinned published definition. Muzzled members may request ordinary help; this does not permit Shuttle completion or role delivery. Only Head Admin contact excludes ordinary Staff. No admission, blacklist or BYOND role ownership changes are made.

## Private data and navigation

The signature verifier keeps bounded submitted values in a private weak-map record, outside the routing envelope. Only the explicit intake handoff can take them, once, within the principal lifetime. Response tokens also remain transient. Answers are retained only in the core intake table; receipts, outbox jobs, action audits, navigation and stable error responses contain references or hashes. Knowledge/inference receive neither this interface nor a database pool. PostgreSQL privilege checks are separate from the still-open Windows identity/ACL gate.

The member receives a pending Check ticket control until provisioning finishes. A channel link is returned only after current membership, ownership, case policy, presence epoch and fresh exact channel-permission proof all pass. A component ID or stored receipt never confers access. Closing or incompatible cases return a status without an unverified link. A ready channel is not evidence of Staff notification or answer delivery.

## Evidence and remaining work

Eight contract tests and B01–B21 cover bounded definitions and wire parsing, private value handoff, Quick Help, version pinning and withdrawal, competing submissions, quotas, stale authority, rollback and lost commit acknowledgement, database privileges, Muzzled/Head Admin audiences, private navigation, shared case limits, signed loopback HTTP, response deadlines including slow availability checks, and redacted failures. S29 checks retained forms, submissions, receipts, withdrawal and paused provisioning across an actual synthetic PostgreSQL restart. See [recorded verification](verification.md) for the full-suite result.

The [answer-delivery worker](case-intake-delivery.md) now sends the pinned answers and a bounded responder notice under current private-channel checks. [Ordinary delivery recovery](case-delivery-issues.md), the [form-authoring API](case-form-authoring.md) and [player reports](player-reports.md) extend this flow. [Explicit participants](case-participants.md) and [Staff contacts](case-contacts.md) share its audience and private-delivery checks. Final owner questions, live panel/command registration, contact dashboard parity, attachment acquisition and transcripts remain independent work. [Conversation observations](case-conversations.md) are retained separately. Live modal timing and client compatibility, actual role/ACL mappings, public ingress/TLS, production composition and recovery gates remain open. No full acceptance specification is marked passed by these partial checks.

Rollback: disable intake ingress and delivery, retain migrations 021/022 and every form/submission/message/audit/receipt, then use compatible application code. Do not drop tables, reuse version numbers, unwithdraw a published definition, clear revocation epochs or manufacture replacement interactions to bypass unknown results. This slice only exercised new synthetic databases and loopback listeners; it changed no production service or Discord state.
