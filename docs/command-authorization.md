# Authenticated moderation and membership delivery

Scope: P05, P09 and P15; partial T01/T04/T05/T18/T20/T21/T53 evidence. This implementation uses the existing Node runtime and PostgreSQL driver. No dependency, production credential, Windows service, live Discord registration or firewall change was added.

## Identity and capabilities

`apps/core/security/interaction-verifier.js` verifies Ed25519 signatures over the timestamp and original bounded request bytes before parsing. It binds the application, guild, guild installation, interaction type and member identity, and accepts only the implemented `/mute member`, `/unmute member`, `/shuttle start`, `/shuttle queue`, exact entry button, bounded Shuttle stage controls, Staff queue/resolution controls and the separately documented ticket lifecycle, ownership and intake routes. Stale/future timestamps, malformed bodies, foreign installations and unsupported commands fail closed. Incoming role arrays and permission flags do not confer authority. The [Discord interaction security contract](https://docs.discord.com/developers/interactions/overview#validating-security-request-headers) supplies the signature format; Node's built-in cryptography performs verification without another package. [Shuttle entry](shuttle-entry.md) and [stage controls](shuttle-screens.md) derive their target from the authenticated member; the store separately checks the private case, original message, session and current policy.

Verified envelopes and resolved actors have process-local identity tracked by weak maps. A serialized copy cannot become an authenticated actor. Interaction response tokens remain in the verifier's private memory, expire, and are never written to receipts, role intents, logs or actor observations. Ordinary modal submissions now have a separate bounded core-only value handoff; answers are absent from routing and response credentials. Arbitrary command handler names remain unsupported. See [ticket intake](case-intake.md) for initial modal timing, pinned versions and retention.

`apps/core/security/authorization.js` is shared application authorization. It obtains fresh guild owner, role and member metadata from the fixed Discord adapter for every operation. Role names, supplied HTTP claims, old snapshots and Discord Administrator do not grant application capabilities. Self-service operations bind the authenticated user to the member; case management applies the existing case audience policy, including lead-ops-only Head Admin contact.

Operator capabilities use an explicit, immutable, versioned map. Only configured Staff/lead ops role IDs can receive the currently supported operator capabilities; empty lists deny access. The optional `case.forms.publish` capability also denies by default when absent; enabling it requires a new policy version. The Staff/lead ops capability assignments in tests are synthetic choices, not an approved production capability map. Moderation also denies self, bot, guild-owner, Administrator and equal/higher-role targets as a conservative application policy requiring staging review. The [Discord permission and hierarchy documentation](https://docs.discord.com/developers/topics/permissions) is the platform reference, not proof that the application's policy is deployed correctly.

Migration 004 persists authority observations and capability epochs. An observed role/access change or policy-version change invalidates the old grant even if the staff role is subsequently reacquired. Policy versions cannot be edited in place or rolled back by an older process. An outage does not record an absent member or empty role array. The [Gateway journal and observer](gateway-continuity.md) record replayed revocations and supply continuity stamps at ingress and after checks. A changed stamp rejects observations even if health has returned to true. The native WebSocket supervisor now has loopback coverage; live Discord composition remains open. These records do not substitute for the independent recovery watermark.

The [dashboard authentication backend](dashboard-auth.md) adds browser-bound OAuth state, digest-only local sessions and CSRF checks. Its opaque proofs use this same authorizer. Principal validity is checked before and after capability checks so logout during an operation denies the protected action. Already committed work retains its recorded authority grant and must still pass current-policy delivery checks. The [Shuttle authoring API](shuttle-authoring.md) now uses the same publication capability and shared publication/withdrawal operations. Other browser use-case routes and live OAuth remain open.

## Mute, unmute and Crew

Migration 003 stores retained, versioned moderation decisions containing only routing/authority metadata. The request, durable mute block, receipt and outbox intent commit together. A newer decision supersedes an older queued effect. Ordinary retries cannot clear a mute intent.

`createMembershipDispatcher` shares the bounded role-delivery engine with Whitelist dispatch. It claims only member-reconciliation work and performs at most one role change per call. Mute first removes Crew, then applies Muzzled. Unmute retains the durable block until Muzzled removal is observed and the recorded operator's current capability epoch, policy and hierarchy are rechecked; only then can Crew be returned. Successful intermediate progress releases the job for its next step. Lost responses and expired leases schedule inspection rather than acknowledging an old claim.

Current membership observations durably request Crew correction. An externally applied Muzzled role removes Crew, and a completed unmute does not authorize automatically removing a later manual Muzzled role. A departed member's old moderation decision cannot resume against a changed eligibility epoch; a fresh operator decision is needed. Restrictive pending intent is retained during that review. A very late role result that cannot be distinguished from a later manual action must not grant access automatically.

Recorded authorization defaults to denial when its adapter is missing. Crew removal enforcing a current restrictive policy may proceed while a queued moderation write is parked; adding/removing Muzzled and confirming unmute require current recorded authority. Owned community roles with moderation/administration permission bits cannot be added. Role removal remains available for correction. External/BYOND roles are never replaced or written, and there is no Whitelist restoration path here.

## HTTP receipt and replies

The internal [participant membership helper](case-participant-authority.md) records a separate presence epoch and rechecks current human membership. It grants no invitation, case access or Staff capability, and has no client route. The [participant command/service](case-participants.md) separately requires current case-specific Staff authority, explicit selection/confirmation, a reason and the actual case version before recording an invitation. Existing operator grants retain their original fields. A first-seen Gateway removal now revokes old Staff authority even if the member journal had not yet observed that identity.

The closed command union also includes `/shuttle issues`, its specific delivery recheck controls, `/shuttle recover` for one message ID and `/shuttle choose` for one retained candidate channel ID. Both recovery commands require a versioned issue reference. [Delivery review](shuttle-delivery-issues.md), [message recovery](shuttle-artifact-recovery.md) and [channel selection](shuttle-channel-selection.md) share current `case.manage` policy for bound Shuttle cases, retained receipts and operation audits. Queue replies authorize again before rendering metadata. There is no generic outbox retry or permission override route.

`/ticket status`, `/ticket close` and `/ticket reopen` share the [versioned case lifecycle](case-lifecycle.md). Signed mutations carry a case ID/version and bounded reason code; every operation and rendered reply checks current permissions for the actual case type. Pending reopening rechecks the recorded `case.manage` grant before and after delivery, using the same retained authority epochs as moderation. A closed/reopened channel remains excluded from AI. Static registration data does not register commands or approve production permissions.

`/whitelist progress member:` (owner request, 25 October 2026) is registered in production beside `/whitelist post`. It
authorizes `case.manage` with the Shuttle assistance scope, as `/whitelist queue` does (Staff and Lead Ops; Muzzled or
timed-out actors refused), keeps only the member option's ID (never `resolved` data), reads that member once and the run,
its reading time and the latest Whitelist grant job in a read-only transaction, and replies privately. It changes nothing.

`/ticket queue`, `/ticket claim`, `/ticket unclaim` and `/ticket assign` provide [Staff ownership operations](case-staff.md). Queue rows are permission-filtered and private; assignment checks the current recipient independently and records responsibility without granting access. Bounded queue controls resolve retained tokens and expected versions, with no authority derived from a component or old role snapshot. Replies reauthorize before returning metadata, and a revoked recorded assignee remains flagged for review.

`apps/core/discord/interaction-http.js` binds IPv4 loopback only. It has bounded headers/body/read time, rejects duplicate signature headers and compressed inputs, and admits one active command without a waiting backlog. It sends the ephemeral deferred acknowledgement before Discord/database work. This follows the [interaction response deadline and callback contract](https://docs.discord.com/developers/interactions/receiving-and-responding). Signed PINGs work without enabling command delivery.

The handler invokes the shared store methods through the real authorizer. `interaction-response.js` edits only that verified interaction's original response, using fixed status text, bounded private navigation/queue metadata and suppressed mentions. [Staff assistance](shuttle-assistance.md) reauthorizes and reads its queue again at response time; no conversation content is included. “Request recorded” confirms a durable request, not a completed role change. Failed or uncertain storage and response delivery use stable errors without raw URLs/tokens. A failed reply never rolls back an already committed moderation decision. The reviewed status/retry screen is implemented below; durable user-facing role completion notices remain separate.

These files do not select a public hostname, expose a public listener, configure TLS, register Discord commands or activate a bot. Discord supports one chosen interaction ingress mode per application; the production choice and compatibility check remain open. The HTTP boundary and current Gateway supervisor use native Node APIs without a Discord SDK. Oceanic has not been adopted or added as a dependency.

## Reviewed dashboard recovery — 4 October 2026

`/moderation` shows up to twenty current reconciliation jobs for one entered member ID.
The current actor must have the existing mute or unmute capability for that target and
decision. Retrying a parked job requires explicit review and confirmation, the same action
revision, eligibility epoch and job fence, and current authority for the original moderator.
A departure/rejoin or revoked original grant requires a new `/mute` or `/unmute` decision.

The exact retry has a durable receipt and increments the job fence once. It preserves any
uncertain prior dispatch so the worker observes current roles before continuing. This
screen creates no new moderation decision, grants no capability and has no Whitelist or
external-role restoration path. Account changes, hidden pages and lost access clear the
review; an uncertain save retains the same request identity. “Retry recorded” does not
claim successful role delivery.

Migration 067 only adds `/moderation` to the fixed OAuth return-path constraint; existing
flows remain valid. No dependency, runtime grant or capability-policy change is required.
This is a local candidate; installed staging remains pinned to `5f60a24` and schema066.

Twenty-one focused unit checks, M01–M20 and twenty-one composed staging scenarios pass.
M15–M20 cover duplicate/concurrent retry, stale reviews, current/original authority loss,
departure/rejoin, unknown/quarantined failure codes and wrong-job rejection. RT21 exercises signed moderation, OAuth return,
CSRF denial, reviewed recovery and current-role revocation through the real runtime.
A synthetic browser check confirms explicit confirmation, one recorded retry and no retry
for an expired decision. Both isolated database clusters and the browser fixture stopped.
Source-bound evidence is in
`GitHub/.agent_docs/aphelion-sophie/moderation-recovery-2026-10-04/verification.json`.

## Evidence and remaining work

M01–M14 exercise real PostgreSQL transactions with simulated role HTTP, including mute/unmute order, competing decisions, lost authority, expired leases, lost replies, late Crew arrival, manual Muzzled changes and departure/rejoin. A01–A14 exercise cryptographically signed synthetic interactions, actual authority storage and the real policy. A13/A14 additionally send real local HTTP requests through the receiver and execute the command/store/dispatcher path, with Discord HTTP still simulated. Contract tests cover signature/body bounds, forged identities, hierarchy, prompt acknowledgement, overload, disabled delivery and redacted errors.

No live Discord, public TLS/OAuth, effective Muzzled channel overwrites, Windows service/ACL, off-host recovery or dashboard acceptance is claimed. Separate suites cover local Gateway continuity and simulated case provisioning. The five-second observation bound, production capability map, role ordering and bot hierarchy need live verification. Continued offline work remains possible on missing application components; no production gate is passed.

Rollback: stop delivery and the local listener, retain the schema/authority epochs/decisions/outbox, and revert compatible application files if needed. Do not remove an applied migration, lower a policy version, clear mute intent or replay parked work as a rollback shortcut. All exercised databases and HTTP listeners were created specifically for synthetic testing and stopped afterward.
