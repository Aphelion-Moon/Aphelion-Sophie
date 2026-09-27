# Reviewed administrative permissions

## Website configuration and apply — schema 055

The owner selected **Full website configuration and apply workflow**, then
**Lead ops only** for the initial `permissions.publish` grant on 27 September 2026.
The owner subsequently approved deployment: staging now runs pinned a5e0232/schema055
with capability policy version2 and the Lead ops-only editor grant. This replaces
the candidate-only scope described in the historical sections below. See the
[live deployment evidence](evidence/website-configuration-live.json).

`/permissions` selects Crew/base, Whitelist, Muzzled, Staff and lead ops, the shared
case category, eight administrative capability grants and nine case responder
groups. Head Admin contact remains lead-ops-only. Guild/bot identity, credentials,
external role ownership, deployment switches and ports remain deployment inputs.
No new dependencies or artwork are introduced.

The workflow is **save draft → review → approve → review running changes → apply**.
Application requires current editor authority, CSRF, explicit confirmation and an
exact retained candidate/review hash. Repeated requests recover the same receipt;
competing applies or candidate mutations are rejected. The applying administrator
must retain publisher authority after owned-role changes. Role existence,
hierarchy, bot permissions and privileged-role restrictions are rechecked against
Discord. Queued, leased, parked or unresolved work must settle before review passes.

`createConfigurableStagingRuntime` wraps the normal restricted runtime. Its separate
owner pool never enters normal runtime composition. Startup verifies the restricted
identity, migration checksums, guards and restore quarantine. Application stops
normal work, waits for leases to expire, and takes the existing maintenance barrier.
The coordinator inventories and seals affected case channels, applies versioned
policies, migrates owned roles, reconciles case access and verifies resulting state.
It atomically selects the retained configuration and releases the barrier, then
restarts core. A restarted host loads the retained selection rather than reverting
to its bootstrap mappings.

Migration reads member/role metadata through Discord's paginated
[List Guild Members](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx#list-guild-members)
route with the existing GUILD_MEMBERS intent. It transfers Muzzled before removing
the retired role, removes Crew from restricted members, and grants the configured
Crew role to eligible members. A Whitelist change invalidates old eligibility and
removes both retired Whitelist and pre-existing assignments of the newly selected
Whitelist role. Members must complete a fresh run; no completion or role snapshot
becomes a new Whitelist grant. Unrelated/game-owned roles are untouched.

Schema055 retains requests in guarded core storage and phases, member effects and
the current selection in owner-only storage. A lost response is resolved by fresh
observation; an unconfirmed effect is never blindly resent. During maintenance,
only the applying administrator can read settings/status or request retry. The
maintenance website exposes no case APIs and cannot approve another configuration.
Restrictions stay held on uncertain effects, authority loss, role/ACL failures or
drift. Restore quarantine blocks both coordination and maintenance HTTP.

Resolve a blocked apply's reported problem, then use **Retry after resolving the
problem**. An uncertain effect requires observed Discord state to match retained
intent; a human may need to reconcile that exact role/ACL under operational
authority. There is no force-release button. Semantic rollback uses a retained
candidate as a new draft, rebased on current configuration and applied at new
versions. It never decreases revocation epochs or restores Whitelist.

Deployment needs schema055, core SELECT/INSERT/UPDATE rights on the new guarded
request table, and the configurable host with a distinct existing owner pool.
Do not grant core access to `sophie_control`. A launcher must use the configurable
host's identity preflight when resuming a held apply; the old `checkRuntimeDatabase`
preflight intentionally rejects that barrier. Do not bypass quarantine or guards.
The owner-selected existing Lead ops role was bootstrapped at capability policy
version2 during the authorized schema055 deployment. Do not repeat bootstrap.
After schema055 application, the schema054 binary/configuration is not a blind
rollback target. Use forward configuration recovery or the separate isolated
backup/restore procedure while preserving later records.

See [verification](verification.md) for evidence and remaining live acceptance.

## Historical implementation slices

## Candidate editor — schema 045

Scope: P03/P05/P08/P11/P15, partial T04/T21/T36/T42/T53. `/permissions` now
provides role/category selection, saved drafts, running-versus-proposed review,
confirmed approval, retained history and withdrawal. The optional independent
`permissions.publish` grant is required on every operation and again before
commit/response; omission denies access. Bootstrap this grant through an explicitly
reviewed deployment configuration. Another editor grant or Discord Administrator
does not substitute for it, and permission-editor authority alone grants no case access.

The editor selects Staff/lead-ops roles, the case category, independent capability
roles and 1–20 responder roles per case type. Choices contain current role/category
names and IDs only: no channel topics, case excerpts, overwrites, credentials or
member lists. Crew, Muzzled, Whitelist, external role ownership, guild/bot identity
and activation flags are not editable. Their migration requires separate work.

Approval rechecks selections and requires the current editor to retain usable
`permissions.publish` authority under the proposed policy. A deleted role/category,
changed running base, stale revision/hash, competing approval or late role loss
blocks the operation. Drafts may be saved before satisfying the approval lockout
check. Unknown configuration fields, malformed/duplicate IDs, role-ownership
conflicts and invalid responder maps are rejected.

History retains drafts, candidates, authors and withdrawals. Withdrawal requires
confirmation and does not undo an already deployed policy. Uncertain responses
retain the exact request for receipt recovery. Conflicts preserve local selections
for explicit comparison. Access loss/sign-out clears selections and review/history
content; configuration never enters browser storage. Historical candidates can be
copied into a new draft and explicitly rebased onto the running configuration.

### Responder policy and delivery

`responders` is an optional complete map in both `capabilityPolicy` and `casePolicy`.
Omission preserves the original Staff/lead-ops behavior. If present, the two maps
must agree for every case type. Head Admin contact is exactly `[leadOps]` and
cannot include ordinary Staff as an additional role. Custom responders govern app
reads/management, assignment, per-type queues, issue lists and channel role
overwrites. Closed channels deny writes; legacy sealed channels stay bot-only.
Roles remain role grants, never snapshots of current holders.

Current membership, hierarchy, bot/timeout/Muzzled restrictions, continuity and
revocation epochs still apply. Role loss, observed loss/reacquisition and a newer
capability policy invalidate recorded management authority at delivery. Channel
preparation checks that selected responder roles still exist. Static intake/Shuttle
notifications use the first canonical (ID-sorted) responder role and retain the
existing mentionability/permission check. Selection does not guarantee a notification.

### Activation and rollback limits

Approval is **preparation for deployment**, not live activation. It writes no active
policy, Discord overwrite, role, category move or outbox effect. Candidate history/API
exposes only the three secret-free runtime sections: `mapping`, `capabilityPolicy`
and `casePolicy`. No live mapping, staging schema or production permission changed.

Candidates bind the exact running base hash and advance the capability-policy
version. Responder/category/Staff/lead-ops changes also advance the case-policy
version; capability-only changes preserve the current case policy. Before deployment,
compare the candidate with the actual current configuration, recheck roles/categories
and editor access, and qualify queued actions and rollback. Existing case provisions
are pinned to their policy version. **Do not deploy a changed case-policy candidate
against retained cases without a reviewed channel reconciliation/migration procedure.**
That activation procedure remains unfinished. There is no browser activation control.

Migration 045 is additive and retained in encrypted core recovery bundles. At this
historical milestone staging was still 032. Staging now runs schema 046 and needs
a 046/screen-aware executable. Do not remove history, lower policy versions/epochs
or use an older build that cannot validate custom responder maps.

### Deployment assessment follow-up — 20 September 2026

Saved draft review now includes an aggregate deployment assessment: retained open,
read-only and sealed access, recorded channels, active/pending invitations and
queued/in-flight/parked deliveries. Missing policy bindings, unresolved channel
selection, uncertain creates and pending transitions are explicit blockers.
These are database records, not evidence of current Discord overwrites. The
permissions-editor capability still grants no case content or case-management access.

An approved candidate can be assessed through authenticated
`GET /api/permissions/deployment-review?version=N`. Optional `expectedReviewHash`
rechecks an earlier assessment and returns conflict when it differs. Withdrawn or
superseded candidates, a changed running base, unavailable selections, self-lockout
and lost current authority are rejected. The hash binds the exact approved candidate
and a single SQL snapshot of explicit control metadata, including record identities,
policy versions, membership/authority epochs and queued-work fences. Equal counts
do not imply an unchanged review. Harmless observation timestamps are excluded.
Only aggregate counts, fixed status codes and a hash leave this boundary; no case
IDs, people, message bodies, forms, notes, files or transcripts are returned.

Every assessment explicitly returns `canActivate: false`. It is advisory, has no
durable activation receipt and does not fence writers or certify a later mutation.
It registers no policy, edits no case/audience, and schedules no Discord effect.
The next implementation is a durable, candidate-bound maintenance procedure with
exclusive writer fencing, fresh metadata-only Discord inventory, verified sealing
before policy replacement, current-eligibility reconciliation and forward-version
rollback. Legacy sealed cases must stay sealed, closed cases read-only, and Head
Admin contacts restricted throughout. Never use the review hash alone as authority
to activate a candidate or bypass those remaining requirements.

Validation and limits are recorded in
[deployment assessment evidence](evidence/permission-deployment-verification.json).
No schema, dependency, live grant, live configuration or release gate changed.

### Durable maintenance barrier — local schema 047

`createPermissionMaintenance` is an owner-only internal preparation API. It has no
HTTP route, live CLI command or automatic activation path. `begin` binds a retained
approved candidate and its exact deployment review, drains active runtime writes,
rejects active Gateway/outbox/attachment leases, and records a durable hold with a
monotonic generation. An uncertain commit is recovered with the same operation ID;
replaying a cancelled operation never reacquires a hold.

Migration 047 installs a write guard on every core table. Restricted runtime
transactions take a shared advisory lock and read the permanent gate row under a
row lock before DML. Maintenance entry takes the exclusive advisory lock. Existing
writers finish first; subsequent writes fail while held. Old repeatable-read
snapshots fail serialization instead of reusing old availability. Startup verifies
the trigger coverage/ownership, and the runtime can read only an availability
boolean, not the owner-only control records. Privileged maintenance uses the table
owner identity; this does not grant additional privileges to runtime identities.

The host checks availability before startup and before new transport/application
operations. Once it observes a hold, that process stays disabled even after the
hold is cancelled; an explicit restart is required. This barrier is **not proof that
already-sent Discord requests had no late effects**. An orderly stopped host,
current channel inventory, resolution of uncertain effects and verified sealing
are still required before changing any permission policy or opening an audience.

`cancelPreparation` only releases an unchanged, pre-activation hold with the exact
operation/generation and original control snapshot. Changed preparation remains
held for investigation. Future activation phases must add their own recovery and
forward-version rollback; they must not reuse this cancellation path after issuing
Discord effects. There is no expiry, forced reset or browser cancellation control.
The gate and receipts survive encrypted backup and owner-only quarantined restore.

This is local only: staging remains **2b984d2 / 046**. Before a future 047 upgrade,
preserve and restore-verify the 046 database with the pinned 046 tooling; current
source backup verification expects 047. After upgrading, use a 047-aware executable
and preserve maintenance records. No live migration or permission change is
authorized by this implementation. See
[maintenance evidence](evidence/permission-maintenance-verification.json).

### Retained Discord channel inventory — local schema 048

The held maintenance operation can now call `inspectChannels` with an exact
operation/generation, request ID and expected inventory revision. The core-only
adapter reads guild role/channel metadata, projects out names and arbitrary topics,
and certifies a five-second observation bound to the candidate, control snapshot
and selected IDs. Serialized, expired or differently bound proofs are rejected.
Database locks are released during Discord reads; operation state, revision and
control bindings are checked again before recording the result.

Inventory distinguishes recorded and newly discovered matching channels, missing
retained channels, identity/reference conflicts, orphan markers, moved channels,
unresolved or stale duplicate choices, and unavailable candidate roles/categories.
An exact retained duplicate choice is accepted only for the complete observed set.
The first matching channel is never chosen from multiple results. The open/closed/
sealed counts describe retained intended access, not a certification of current
Discord permissions. Discovery does not adopt a channel, change
its audience or alter a permanent exclusion. Confirmed sealing below performs the
exclusion/write phase separately.

Migration 048 retains inventory revisions in the owner-only control schema. The
maintenance service returns counts, fixed blocker codes, revision and hash; it exposes no
case/channel/user IDs or raw overwrite records. The owner-only retained record has
the explicit routing and overwrite metadata needed by future reconciliation, with
no messages, form responses, participant lists, notes, attachment bytes or
transcripts. Encrypted recovery preserves it in quarantine. An exact retry returns
the retained receipt without another Discord read; a new observation needs a new
request ID and current revision. Historical retrieval is not a fresh Discord proof.

Observations are bounded to the existing 500-role/500-channel response contract and
10,000 retained cases/selected channel IDs. Oversized or malformed results fail
without recording a partial inventory. Every result still reports
`canActivate: false`. Inventory itself performs no permission writes. Missing or
conflicting identities and uncertain old effects must be resolved before activation.
See [inventory evidence](evidence/permission-inventory-verification.json).

### Durable channel sealing — local schema 049

The owner-only maintenance service now accepts an explicitly confirmed seal plan
for a case-policy change. The request binds the exact held operation/generation,
latest retained inventory revision/hash and request ID. It reobserves Discord
metadata and rejects changed or blocked inventories before committing a plan.
Capability-only changes do not invoke case sealing.

One transaction records all channel targets, permanent case exclusions and the
sealing phase before any external write. This includes newly discovered channels
whose case identity and complete duplicate choice have been verified. Discovery
does not yet adopt them into the case channel/capture registry. Case state, desired
open/closed/sealed access, invitations and registered policies remain unchanged.
Ordinary preparation cancellation is unavailable once the plan is committed.

Each bounded dispatch prepares the current bot identity, role permissions, target
marker/type and destination category. It durably marks the channel started before
attempting a fixed bot-only overwrite at the candidate category. The adapter cannot
grant a human audience or read a case participant/message. Already sealed channels
skip the write but still need a fresh verification. Discord owner/Administrator
bypass remains an independent deployment/privacy gate.

The effect journal distinguishes planned, started, sent, uncertain and verified.
Concurrent callers cannot dispatch the same intent twice. A lost response or a
process interruption never causes an automatic resend of started/uncertain work.
Read-only rechecking can verify an observed seal while retaining the uncertainty
flag; a success response alone cannot verify permissions. If the observed channel
is not sealed, the barrier remains held. Reviewed resolution of that state and
compensation for older potentially permissive effects remain unfinished.

Finishing sealing reobserves the whole inventory, checks exact target identities
and bot-only ACLs, and rejects missing, reopened or newly appearing case channels.
It retains the observation hash and marks the phase sealed, but does not release
the barrier or activate any policy. Status and exact plan retry are historical
receipts; subsequent activation must reobserve current state. Fresh verification
is not a claim of atomicity between PostgreSQL and Discord or prevention of later
external permission changes.

Validation: 21 focused checks and 82 isolated scenarios pass, including lost
planning/start commits, concurrent dispatch, lost responses, false HTTP success,
identity/ACL drift, exclusions before writes, restricted control access, encrypted
quarantine recovery and preservation of exact schema-048 inventories. All owned
clusters stopped. The first database run exposed synthetic teardown leaving the
barrier held before the authorization suite; teardown was corrected and the full
selected suite rerun successfully. See [source-bound sealing evidence](evidence/permission-sealing-verification.json).

This remains local, without a public route or operational activation CLI. Staging
is **2b984d2 / 046**. The policy-application follow-up below extends this local
sealing phase. No new dependency or live permission change.

### Held policy application — local schema 050

A separate owner-only confirmation binds the operation/generation, latest retained
inventory and, for a case-policy change, the completed seal-plan hash. The service
reobserves Discord metadata and exact sealed audiences, rejects stale controls and
unsettled deliveries, invitations or lifecycle transitions, and keeps the runtime
barrier held throughout. Only complete unambiguous channel discovery may resolve
the control assessment's missing-registration/selection blockers. Missing or
conflicting channel identities still block application.

Application commits new immutable capability/case policies, increases existing actor
authorization epochs, and updates case policy/audience/version bindings together.
It preserves membership state, presence epochs, invitations and intended open/closed/
sealed access. Historical policies and recorded grants are not rewritten; old grants
are denied by the new version/epoch. Selected responder groups remain role grants.
Confirmed channels enter the case/capture registry with permanent exclusions and
explicit coverage gaps. Existing capture interruption is recorded when maintenance
is acquired, and preparation cancellation cannot certify recovery. No case content
is read by this maintenance path.

For each created case, the same transaction queues one retained reconciliation job
using the existing case-provision contract. The journal stores its references,
pre/post control hashes, confirmed inventory hash, aggregate counts and the old
secret-free configuration sections. Exact lost-commit retries return the retained
receipt without another observation, epoch increment or queued job. A process using
either the old or candidate configuration can verify that receipt; a different base
or corrupted journal is rejected. A receipt is historical evidence, not current
Discord authority.

Capability-only changes register the new capability policy and raise actor epochs
without migrating provisions, sealing channels or queueing case work. They require
a fresh clean inventory with no unadopted discoveries. Changed case policies require
the complete verified sealing phase even when there are no retained channels.
No configuration file is edited and no runtime is started or released by this API.

Validation: 21 focused checks and 94 isolated scenarios pass. PA01–PA11 cover atomic
policy/epoch/job persistence, preservation of revocation and invitation history,
capability-only behavior, blocked uncertain work, stale ACL/control rejection, lost
commit recovery, expiry rollback, capture downtime and encrypted quarantine restore.
The existing dispatcher, composed only in a synthetic owner fixture, reconciles
migrated cases using current eligibility: Head Admin privacy, closed read-only
access, legacy seals and departed-opener denial remain enforced. This is compatibility
evidence, not an operational maintenance coordinator or approval to use one live.
SU10 preserves an exact schema-049 seal journal without applying any policy.
See [application evidence](evidence/permission-policy-application-verification.json).

Next implement the bounded owner reconciliation coordinator, fresh completion and
editor-access checks, explicit configuration/runtime handoff and forward-version
rollback using the retained old semantics at new versions. Pending/uncertain effects
and missing/conflicting identities still need reviewed resolution. Until those
paths are complete, application remains local and reports `canResume: false`.
Staging stays **2b984d2 / 046**. Current source recovery expects **050**; preserve live
046 with its pinned tools before a separately authorized upgrade, then require a
050-aware executable. Never delete maintenance history or lower policy/revocation
epochs to recover. No browser/public activation route, live deployment or human
release acceptance is added here.

### Historical candidate-editor evidence

52 focused checks and 42 isolated database/runtime scenarios pass: PC01–PC12,
A01–A17 and RT01–RT13. Coverage includes CSRF, denials, selective responder queues,
lockout, deleted selections, stale/concurrent edits, late-revocation rollback,
lost-COMMIT retry, restricted grants, migration replay and encrypted restore into
quarantine. Synthetic browser checks cover selections, saved comparison, confirmation,
withdrawal, uncertain retry, literal role names, narrow reflow and access-loss clearing.
See [source-bound milestone evidence](evidence/permission-editor-verification.json).

An initial database run exposed JSONB property ordering in hashes; hashing now
canonicalizes keys recursively. A concurrency fixture was corrected to check whichever
request won, without assuming scheduler order. The transport fixture expects the new
deny-by-default session capability. All owned clusters stopped. No new dependency,
live upgrade, independent client acceptance, automatic case-access migration or
production approval occurred.

## Previous capability-only milestone

Scope: P03/P05/P08/P09/P15, partial T04/T21/T36/T53. The owner requires configurable
permissions. Role/channel IDs already come from the deployment configuration;
this change removes the additional restriction that operator grants could select
only the configured Staff and lead-ops roles. No live mapping was changed.

Each entry in `capabilityPolicy.grants` independently accepts zero to fifty unique
Discord role IDs. An empty list denies the operation. Current supported entries:
`member.mute`, `member.unmute`, `shuttle.publish`, `case.registry`,
`case.forms.publish`, `answers.publish` and `automation.publish` (now also
`permissions.publish`). The first four
remain required; omitted optional entries deny access. For example, an editor
role can publish Shuttle guidance without receiving moderation or case access.
Role names are never matched. Unknown capability names, malformed/duplicate IDs,
`@everyone` and Muzzled as granting roles are rejected.

Current membership, bot/timeout/Muzzled restrictions, moderation hierarchy,
current policy version and revocation epochs still apply on every operation and
queued delivery. A deleted or unheld role cannot authorize anyone. Reacquiring a
role never revives a prior recorded grant. Policy records remain immutable:
increment `capabilityPolicy.version` when changing the configured map, review the
effect and restart only through the approved deployment procedure. Reusing an
old version with new grants or rolling back to an older version is rejected.

At this previous milestone, this was a configuration-level capability change. Case readership/management
still uses the configured Staff/lead-ops responder groups, verified requester and
explicit invitations. Category placement and role ownership use their existing
explicit ID mappings. There is no new grant based on a channel overwrite,
Administrator permission or a capability to edit public guidance. A permissions
browser with role/channel selection, review and retained changes, and more flexible
responder mapping were still outstanding; the local candidate editor above supersedes
that limitation while keeping activation separate.

Validation: 13 focused authorization/runtime checks and 17 isolated PostgreSQL
authorization scenarios pass. A15–A17 cover a custom role driving moderation,
absence of case/other-capability access, removal/reacquisition and versioned grant
revocation before delivery. The isolated database stopped. See
[source-bound evidence](evidence/authorization-verification.json). No new dependency,
schema migration, live permission change, production deployment or independent
human acceptance occurred. Rollback is a code revert only when configuration uses
the older accepted two-role grant format; never lower a retained policy version.
