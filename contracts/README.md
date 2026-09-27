# Domain contracts

These are pure JavaScript policy functions, not network routes. Only trusted adapters may construct membership, actor or channel-classification observations. Never map an HTTP body or component ID directly to one of those observations. Inject a clock and fetch current Discord state; unknown, out-of-order or stale observations fail closed.

`membership` owns Crew/Muzzled policy and eligibility/access/presence epochs. `onboarding` owns five-stage progress and emits a narrowly typed Whitelist intent. `tickets` owns case audiences, channel policy, admission budgets and bounded form/answer contracts. Core intake stores own the temporary pinned handles, retained submissions and publication audits; answers never enter routing envelopes, receipts or outbox bodies. The core composition root will authorise operators, load state and commit state plus intended effects. No module performs network, filesystem or database writes.

The five-second observation limit is a conservative development proposal. It does not make Discord observations atomic with external effects. In-flight effects need a fresh post-response check and compensation toward current policy.

## Persistence integration and remaining delivery work

The approved PostgreSQL engine has a core adapter and synthetic integration suite; see `docs/storage.md`. The full delivery contract is:

- A transaction that loads the actor's current capability epoch, member and session; validates expected versions; inserts a unique `(guild, interactionId)` receipt; writes the transition and inserts its uniquely identified outbox effect together.
- A uniqueness constraint permitting only one active Shuttle session per member. Voluntary repeat visits create a new session pinned to the latest published definition; historical sessions remain intact.
- Durable case provisioning reservations, member/guild limits and idempotency. Limit checks without the same transaction would race.
- Immutable authored Shuttle copy, session-to-case bindings and retained screen metadata. Progress and intended screen replacement commit together. Signed controls require the current member, private case, original observed message, session version/nonce and access epoch; an old component ID cannot authorize a transition.
- Retained Shuttle help requests and staff resolution records. One request per session may be open; resolution, actor-bound receipt and eligible screen refresh commit together. Current case-management authority gates paged metadata reads and resolution, while historical requests never replace a newer run's screen or authorize role changes.
- A publication's immutable help rule can pause a session with its request. All progression and old grants are denied while paused. Staff resumption rotates the version/nonce and records its resulting version atomically, without advancing a page or emitting a grant. A cancelled final-page intent needs a fresh member acknowledgement; current Muzzled or durable mute restrictions prevent resumption.
- New help requests and Whitelist failures commit bounded Staff-alert records and intents with their source state. Delivery checks current private-case audience and permits only the mapped Staff mention. An observed own-message ID/body/mention is required for confirmation; unknown POST results park instead of creating another notification. Alert delivery never resumes a session or grants roles.
- Leased, fenced job claims. The Whitelist dispatcher reloads current session/definition/member state and checks fresh Discord role metadata, ownership and hierarchy before each effect. The Crew/Muzzled dispatcher reauthorises retained moderator identity/epoch metadata through the current authority adapter. The case dispatcher creates with bot-only access and requires fresh opaque observations and exact audience policy before confirmation; retries never rely on an original event's roles.
- Cancellation of stale access epochs; a mute request invalidates pending delivery before Discord applies Muzzled. Only confirmed unmute may clear the durable mute intent. External role updates require reconciliation, not silent intent clearing.
- Eligibility epochs advance on every observed Whitelist loss or departure. A fresh run at the current epoch can earn Whitelist again. Muzzle/unmuzzle advances access epochs without erasing partial reading progress; an invalidated pending grant needs a fresh final acknowledgement.
- Discord role confirmation after delivery. The pure guard is also used after a response; a stale or uncertain result stays incomplete and enters operator reconciliation. Fencing cannot prevent an already in-flight Discord request.
- Permanent case/channel exclusions (including closed, moved, deleted and legacy-bot cases and descendants). A metadata-only cutover inventory is required; do not import historical case contents.

There is no memory/file/JSON database fallback. Pure tests and a real isolated PostgreSQL suite now cover atomic receipts/state/outbox, reservations, leases, fencing, connection failure and database stop/start. They do not certify exactly-once delivery, OAuth, Discord ACLs, an independent restore watermark, host crash/power-loss recovery or production readiness.

Ordinary intake adds retained answer-delivery plans in the submission transaction.
Only core may release a payload after current member, case and private-channel
proofs. Ordered own-message confirmations precede the bounded responder notice;
uncertain creates retain their markers and never authorize a blind resend. See
[delivery contracts and limitations](../docs/case-intake-delivery.md).

Ordinary delivery issues retain current case ownership and a parked fence. Repair
requires current responder authority, an exact issue revision, an atomic audit
and receipt, and fresh proofs for identified messages or channel candidates.
Requeue preserves global barriers and possible effects. See [ordinary recovery](../docs/case-delivery-issues.md).

## Access contracts

Signed moderation and Shuttle entry interactions now resolve opaque process-local actors; fresh role observations, immutable policy versions and continuity stamps drive the shared core authorizer. Reconstructed JSON actor objects are denied. The Gateway journal supplies ordered revocation evidence, never current role grants. See `docs/command-authorization.md`, `docs/shuttle-entry.md` and `docs/gateway-continuity.md` for the HTTP and observer boundaries. The native socket supervisor and dashboard OAuth actor source have offline coverage; live composition/provider acceptance remain open. Case conversation capture uses a separate opaque core handoff and never extends the metadata contract with content; see `docs/case-conversations.md`.

Case `openerId`, `subjectId` and `participantIds` are distinct. The subject receives no automatic access. Staff notes and management require the case's current staff group even if a staff member is the requester. Only Head Admin contact restricts responders to `lead ops`; Staff Report remains accessible to Staff under the owner's explicit clarification. Discord Administrator visibility is a platform limitation, not a capability grant to the dashboard.

The AI policy consumes only current classification metadata. It requires a complete non-ticket lineage, a working persistent exclusion registry, explicit channel approval and current actor permission. Both ingress and final delivery must apply it. No model, prompt builder, case export path or AI worker exists in this foundation.

Attachment policy is bounded data with explicit current approval, indefinite retention and unscanned quarantine. Core alone owns source jobs, private file proofs and capacity reservations; no download or AI path exists. See `docs/case-attachments.md` for acquisition, recovery and release limits.
