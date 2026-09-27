# 02 · Architecture and data contracts

## Shape of the application

Use a modular monolith in one repository, with a separate knowledge worker and inference process for resource and access isolation. This is not a network of general-purpose microservices. The separation serves a concrete purpose: the code that reads cases must not be the code that constructs model prompts.

```text
Discord events / staff browser
            |
       core service
     /              \
case + onboarding    approved non-ticket AI request
+ membership rules           |
     |                knowledge worker
administrative store     /          \
+ durable outbox    knowledge store   local inference
     |                    |
Discord delivery     MediaWiki / approved read-only connectors
```

**Only the core service holds the Discord bot token.** The knowledge worker has no case-store credential, transcript-directory access, or generic Discord history client. The inference process has no connector credential, bot token, or case filesystem access. Any local administrator controlling the entire host can bypass process-level isolation; this design reduces application mistakes and blast radius, not trust in the host operator.

Core administrative jobs and knowledge jobs have separate capacity budgets. A model queue must never block ticket creation or role operations. Core alone sends Discord output, after rechecking the destination.

## Repository organisation

```text
apps/
  core/                    Discord gateway, staff HTTP API, admin job pump
  dashboard/               React staff interface; static production build
  knowledge-worker/        Approved ingestion, lookup, model orchestration
modules/
  tickets/                 Cases, participants, forms, transcripts
  onboarding/              Versioned Shuttle workflow
  membership/              Role policies, grants, revocations, reconciliation
  automation/              Static responses/reactions and approved scheduling
  knowledge/               Sources, documents, search, citations
  assistant/               Non-ticket chat policy, model request lifecycle
  integrations/            Allowlisted external adapters
platform/
  authorization/           Shared actor/capability checks
  configuration/           Validated, versioned settings
  persistence/             Approved database driver and transaction unit
  jobs/                    Durable delivery, leases, retries
  audit/                   Structured security/operational events
contracts/                 Runtime schemas and documented JS/JSDoc interfaces
tests/                     Unit, contract, integration, recovery, evaluation
ops/windows/               Installation, services, health, backup, restore
legal/                     Dependency inventory, notices, approvals
assets/                    Approved local brand assets and provenance
docs/decisions/            Architectural decisions and migration notes
```

Within a module, keep rules, use cases, and adapters distinct. Avoid one file per trivial wrapper, a global service locator, broad `utils` folders, and singleton managers with hidden mutable state. Depend on narrow injected interfaces. Fastify's plugin encapsulation supports route/hook organisation; it is not a security sandbox for untrusted code. [S28](11-SOURCES.md#s28)

## Ownership and allowed dependencies

Tickets may call membership/onboarding through explicit use cases where necessary. Onboarding owns progress; membership owns all access-role writes. The assistant may invoke knowledge lookups, never ticket repositories or role operations. Integrations produce approved records; they cannot directly update another module's tables.

The composition root wires modules. No feature imports another feature's internal storage adapter. Enforce these boundaries in automated architecture tests. Share small contracts and stable identifiers, not a universal domain-object hierarchy.

## Identity is presentation data, not an assistant dependency

`brand-profile.json` defines Sophie's display identity; `asset-manifest.json` maps stable asset IDs to versioned local files. A narrow presentation adapter reads those fields for Discord notices and dashboard branding. Core and dashboard rendering do not call `AssistantService` to obtain a name, avatar, image, message template or status label.

Resolve asset IDs only inside an approved static-artwork root. Ticket files, transcripts and knowledge-source attachments never enter that root. Configuration uses validated IDs rather than arbitrary URLs or filesystem paths. No new service, character engine, image-generation runtime, or provider is introduced.

The optional non-ticket assistant receives only approved style guidance plus its existing request/evidence. It receives no current dashboard page or ticket context. Versioned branding can change without changing permissions or historical workflow definitions. Retain existing technical service identifiers; human-facing Sophie labels are not schema migrations.

## Durable state and Discord side effects

A business operation writes its state change and a pending external action atomically. The dispatcher processes the committed outbox, records attempts/results, and retries only duplicate-safe operations. The transactional-outbox pattern addresses a database write/external delivery gap; it does not make the external API exactly-once. [S19](11-SOURCES.md#s19)

Pending actions carry `operationId`, `kind`, `aggregateId`, `expectedVersion`, `eligibilityEpoch`, `attempt`, `notBefore`, `leaseUntil`, and `lastErrorCode`. Treat them as at-least-once work. Use bounded retries, jitter, dead-letter review, and periodic reconciliation. An action whose authorisation epoch is obsolete is cancelled, not retried.

For channel creation, place a non-sensitive operation marker on the intended channel at creation where supported. On timeout, reconcile existing channels before retrying. If the result remains ambiguous, stop and surface it for staff; never assume idempotent channel creation. A distributed lock/lease alone is not enough—use a fencing generation so a stale worker cannot commit a newer worker's result.

Discord and the database do not share a transaction. A revocation can arrive while a permitted role request is already in flight. Recheck current policy after the external response; if a late result contradicts it, schedule a compensating action for the bot-owned role and alert on unresolved uncertainty. Do not promise zero transient inconsistency across the external API.

The storage implementation must support atomic transactions, uniqueness, concurrency control, backup/restore, and durable job claims. If PostgreSQL is explicitly approved, pg-boss may provide job machinery; otherwise choose an approved equivalent and prove the same semantics. Do not implement a home-grown database. [S17](11-SOURCES.md#s17)

## Logical data model

This is engine-neutral modelling, not executable DDL and not permission to install a database.

| Entity | Important fields and invariants |
|---|---|
| Guild configuration | Fixed guild ID, active version, policy epoch, validation state |
| Member eligibility | Member ID, admission status source, grant/revocation epoch, grandfathered decision provenance |
| Role policy | Role ID, owner module/system, restoration class, prerequisite rule, enabled status |
| Role snapshot | Only approved restorable IDs, observation time, snapshot version; never a universal privilege snapshot |
| Case type | Form version, participant/staff rules, category mapping, retention rule |
| Case | Case ID, opener, subject (optional), assigned staff, type/version, channel ID, lifecycle state, access epoch |
| Case participant | Case ID, actor ID, participant role; distinct from subject identity |
| Case event/message | Message ID, edit/delete status, authorised visibility, timestamps; no AI export |
| Transcript artifact | Case ID, content hash, access epoch, expiry, storage reference; no public static URL |
| Shuttle definition | Immutable published version, ordered stages, validated text/actions, publication audit |
| Shuttle session | Member, definition version, current stage, state/version, acknowledgement events |
| Access grant | Member, role, current eligibility epoch, desired/observed status, operation ID |
| Outbox/job | Idempotency identity, resource/version, lease/fence, retries, terminal result |
| Knowledge source | Adapter, approved endpoint, collections, publication authority, sync policy, disabled state |
| Knowledge document | Source/page ID, revision, section path, snapshot hash, dependency fingerprint, audience, approval |
| Knowledge chunk | Parent document/version, evidence text, source URL, permitted audience; no case foreign key |
| Source cursor/tombstone | Continuation checkpoint, last success, deletion/restriction marker, invalidation generation |
| AI session | Actor, approved non-ticket channel, expiry, bounded turns, policy generation; no case ID |
| AI request/result | Request ID, destination classification, model/config hash, evidence IDs, status, usage; minimal payload retention |
| Audit event | Actor, operation, resource, result, correlation ID, timestamp; no credentials or default raw conversation |

Use strings for Discord snowflakes and role IDs; do not coerce identifiers into floating-point numbers. Store timestamps in UTC and display staff schedules in Europe/Amsterdam with explicit daylight-saving handling. Scheduled work records its timezone and intended local occurrence rather than blindly adding 24 hours.

## Critical contracts

`ActorContext` is derived from authenticated Discord/OAuth events, never supplied as an arbitrary dashboard field or model argument. It contains actor, guild, current capabilities, destination and policy epoch.

`CaseService` exposes create, claim, add/remove participant, close, reopen, and authorised transcript retrieval. Each invocation checks current authority. Mutations require expected resource version and an idempotency key.

`OnboardingService` exposes start/resume, advance, back, requestHumanHelp, staffResume, and approvedOverride. Progress events are not inferred from Discord visibility.

`KnowledgeService` exposes search and getEvidence against explicit audience/collection limits. It has no generic SQL method and no ticket connector.

`AssistantService` accepts a verified non-ticket destination and a bounded query/session reference. It does not accept arbitrary history, a case ID, attachment fetch URLs, or actor overrides.

`DeliveryService` receives a result plus a narrowly scoped destination capability. It rechecks the destination at send time; pending results are cancelled if the channel becomes a ticket/restricted space or the member loses access.

## HTTP and Discord interfaces

Suggested route families: `/api/cases`, `/api/shuttle`, `/api/membership`, `/api/automation`, `/api/knowledge`, `/api/assistant`, `/api/operations`, and `/api/configuration`. Define response schemas as well as request schemas. Do not expose internal database records directly.

Use gateway interactions for the initial Discord adapter and OAuth HTTP callbacks for dashboard login. Discord documents gateway and HTTP interaction delivery as alternative mechanisms, not two parallel handlers for the same application. Acknowledge interactions promptly; initial responses have a three-second deadline. For an action opening a modal, the modal must be the initial supported response rather than attempting to open it after a generic deferred reply. [S07](11-SOURCES.md#s07)

Configure only the gateway intents required by enabled features. Join/role observation needs the relevant member events; ordinary message-based auto-responses and transcript capture need the relevant message events and message-content access. Verify Developer Portal settings and any applicable approval requirements in staging; slash commands alone do not establish that transcript capture works. [S10](11-SOURCES.md#s10)

Route both commands and dashboard buttons to the same use cases. Authentication is not authorisation. Use signed server-side sessions, CSRF protection for mutations, validated OAuth state, a fixed guild restriction, and fresh capability checks. [S09](11-SOURCES.md#s09); [S20](11-SOURCES.md#s20)

## Configuration and extension rules

Configuration is data: bounded forms, message templates, ordered steps and allowlists. No uploaded scripts, expression evaluation, arbitrary SQL, or dashboard-authored executable schemas. Fastify warns that its validation/serialization schemas compile code and must not be treated as untrusted user input. Keep executable schemas in reviewed application code. [S29](11-SOURCES.md#s29)

Each future connector declares inputs, outputs, permissions, timeouts, retry policy, permitted destinations, secrets, licence and owner. Add it behind the same contract tests. Do not build a plugin marketplace, generic agent framework, or multiple database implementations speculatively.
