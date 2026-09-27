# 08 · Implementation workplan

## Working method

Use one lead agent to maintain contracts, the decision log, dependency ordering and release evidence. Delegate bounded feature slices with explicit files/contracts and tests. A separate reviewer checks security-sensitive changes. Agents do not self-approve production deployment or licence exceptions.

All work is planned, not started. `backlog.json` is the machine-readable work queue. Task dependencies are logical ordering, not time estimates. `test-cases.json` describes acceptance, not executed tests.

## Sequencing and useful parallel work

| Stage | Tasks | Exit |
|---|---|---|
| Discovery | P00–P03 | G0 input/licence/storage decisions recorded |
| Foundation | P04–P09 | G1 contracts, auth, state, native skeleton |
| Human administration | P10–P18, P26–P27, P29–P31 | G2 and G5 administration cutover |
| Knowledge, in parallel after foundations | P19–P22 | G3 direct lookup without models |
| Local AI, separate from case work | P23–P25, P28, P32 | G4 isolated local inference and approved activation |
| Identity and asset integration | P36–P38, before P29 sign-off | Sophie source files, placement and no-AI presentation checks |
| Follow-on utility and maintenance | P33–P35 | Explicit per-feature approval and evidence |

After shared contracts stabilise, ticket/dashboard work and the isolated knowledge connector can proceed in separate branches. Database schema/auth policy changes require lead integration to avoid conflicting migrations. Keep CPU benchmarking independent of ticket development.

The first integrated demonstration is a human-operated Shuttle ticket and staff dashboard surviving a restart and a revoked role grant. A separate demonstration answers a public MediaWiki question locally. Neither demonstration may use the other's content.

## Pull request contract

Each change states scope, requirement IDs, task/test IDs, affected permission boundaries, dependency/licence changes, migration/rollback effects, and documentation updates. Attach actual results and limitations. Do not claim tests passed if they were only written or skipped.

Keep changes small enough to review. Add tests before fixing reliability/security defects where practical. Comments explain why a rule exists; names and types/contracts explain what the code does. Avoid speculative abstraction, hidden globals, dead code, broad exception suppression and unbounded retries.

## Optional feature reuse queue

Prioritise static canned answers, message-context reporting, suggestion statuses, scheduled announcements/reminders, generated command help and message previews. Reuse the approved forms, permissions, outbox and audit mechanisms. These are independent implementations unless a specifically reviewed MIT component is adopted.

Non-MIT bots may inform a written behaviour specification only. Do not translate their source into this project. No source code from Red, Discord Tickets or another bot has been included in this planning pack.

## Task specifications

### P00 · Freeze scope and deployment inputs

**Lane:** Foundation · **Priority:** P0 · **Owner:** Lead agent

**Depends on:** None. **Tests:** T01, T22.

**Deliver:** Scope ledger and unresolved input manifest; No-AI-in-tickets invariant recorded as superseding earlier proposals; Sophie identity decision and source-asset set recorded; no-AI boundary unchanged.

**Boundary:** No new product features or implicit approvals; all unknown IDs and credentials remain unset.

### P01 · Approve licence scope and persistence choice

**Lane:** Foundation · **Priority:** P0 · **Owner:** Supply-chain agent

**Depends on:** P00. **Tests:** T02.

**Deliver:** Exact dependency/runtime/model inventory and notices; Owner decision for indirect/tooling/platform scope; one approved storage and queue design.

**Boundary:** Do not install unknown/non-MIT components or invent a custom database to bypass a gate.

### P02 · Inventory and baseline Windows host

**Lane:** Foundation · **Priority:** P0 · **Owner:** Operations agent

**Depends on:** P00. **Tests:** T37.

**Deliver:** CPU/RAM/disk/service/port inventory; Resource baseline and deployment/recovery constraints.

**Boundary:** Read-only inventory; do not disrupt existing services or claim unmeasured model speed.

### P03 · Discover Discord, wiki and design inputs

**Lane:** Foundation · **Priority:** P0 · **Owner:** Integration/design agent

**Depends on:** P00. **Tests:** T08, T21, T27, T43, T49.

**Deliver:** Guild/role/channel ownership matrix and approved member baseline method; MediaWiki capabilities, approved sources and website asset/token evidence; Final Shuttle copy/forms and retention inputs; Inspect the supplied Sophie manifest and existing WUFF addendum; distinguish these from still-unverified site tokens and load measurements.

**Boundary:** No guessed IDs, website CSS, content licences or admission requirements.

### P04 · Bootstrap repository and contract checks

**Lane:** Foundation · **Priority:** P0 · **Owner:** Platform agent

**Depends on:** P01. **Tests:** T02, T46.

**Deliver:** JavaScript ESM repository with runtime schemas/JSDoc; Locked approved dependencies, CI and module-boundary tests; Synthetic fixtures and build manifest.

**Boundary:** No production secrets; TypeScript only after explicit approval.

### P05 · Implement authentication and shared capability policy

**Lane:** Foundation · **Priority:** P0 · **Owner:** Security/platform agent

**Depends on:** P03, P04. **Tests:** T01, T03, T04, T05.

**Deliver:** Discord/OAuth actor resolution and sessions; Shared capability/access-epoch policy; CSRF, guild binding and negative permission tests.

**Boundary:** UI visibility cannot substitute for backend checks.

### P06 · Implement durable storage and outbox

**Lane:** Foundation · **Priority:** P0 · **Owner:** Data agent

**Depends on:** P01, P04. **Tests:** T15, T16, T36.

**Deliver:** Logical schema realised in the approved engine; Migrations, transactions, uniqueness, leases/fencing; Idempotency, retry and reconciliation contracts.

**Boundary:** Treat external delivery as at-least-once; no exactly-once claim.

### P07 · Package native service skeleton

**Lane:** Foundation · **Priority:** P0 · **Owner:** Operations agent

**Depends on:** P02, P04. **Tests:** T24, T37, T38.

**Deliver:** Version-matched service scripts and ACL layout; Separated core/knowledge/inference identities; Liveness/readiness and redacted logs.

**Boundary:** Do not expose inference/database or run as a personal administrator.

### P08 · Build dashboard shell and shared controls

**Lane:** Administration · **Priority:** P0 · **Owner:** Dashboard agent

**Depends on:** P04, P05. **Tests:** T42, T43.

**Deliver:** Capability-aware navigation and common forms/tables/dialogs; Accessible Sophie shell using bundled reference assets, with production placement approval still required; Configuration draft/validate/publish flow.

**Boundary:** No case AI widgets or page-context injection into previews.

### P09 · Implement Discord adapter and command plumbing

**Lane:** Administration · **Priority:** P0 · **Owner:** Discord agent

**Depends on:** P04, P05. **Tests:** T01, T05, T45.

**Deliver:** Pinned Oceanic compatibility evidence; Gateway routing, prompt acknowledgment and modal handling; Shared service invocation and rate-limit/error behaviour; Apply the shared Sophie display identity in staging; live profile/avatar changes require release approval.

**Boundary:** Only the core owns the production token; optional voice remains absent.

### P10 · Implement ticket provisioning and state

**Lane:** Administration · **Priority:** P0 · **Owner:** Tickets agent

**Depends on:** P06, P09. **Tests:** T06, T08, T16.

**Deliver:** Case type/form versions and opener/subject/participant separation; Private-channel provisioning with operation markers; Recoverable open/close state.

**Boundary:** Reported subject is never auto-invited.

### P11 · Implement case permissions and staff lifecycle

**Lane:** Administration · **Priority:** P0 · **Owner:** Tickets/security agent

**Depends on:** P05, P10. **Tests:** T07, T09.

**Deliver:** Effective permission validation and category-change handling; Claim/reassign/participant/close/reopen services; Restricted staff notes and audit events.

**Boundary:** Do not promise privacy from Discord Administrator privileges.

### P12 · Implement transcripts and attachment policy

**Lane:** Administration · **Priority:** P0 · **Owner:** Tickets agent

**Depends on:** P06, P11. **Tests:** T10, T11, T12, T35.

**Deliver:** Authenticated private artifacts and escaped rendering; Bounded attachment path and coverage-gap reporting; Owner-approved retention enforced.

**Boundary:** No public permanent transcript links or AI ingestion.

### P13 · Implement Shuttle content editor and definitions

**Lane:** Administration · **Priority:** P0 · **Owner:** Onboarding/dashboard agent

**Depends on:** P08, P10. **Tests:** T19, T42.

**Deliver:** Immutable published workflow versions; Owner-provided copy/forms, preview and withdrawal/migration controls.

**Boundary:** No generated admissions rules; no infinite visual workflow builder.

### P14 · Implement deterministic Shuttle progression

**Lane:** Administration · **Priority:** P0 · **Owner:** Onboarding agent

**Depends on:** P06, P13. **Tests:** T13, T14, T15, T17, T19.

**Deliver:** Start/resume/advance/back/human-help state machine; Component nonce/version checks and control reconstruction.

**Boundary:** Neither Discord role visibility nor a model determines progress.

### P15 · Implement role ownership, restoration and revocation

**Lane:** Administration · **Priority:** P0 · **Owner:** Membership agent

**Depends on:** P06, P09. **Tests:** T18, T20, T21.

**Deliver:** Role ownership/restoration allowlists; Eligibility epochs and revocation-safe reconciliation; Stale/offline snapshot handling.

**Boundary:** No privileged-role restoration or external-bot role interference.

### P16 · Integrate final Shuttle grant and recovery

**Lane:** Administration · **Priority:** P0 · **Owner:** Onboarding/membership agent

**Depends on:** P14, P15. **Tests:** T15, T18, T19.

**Deliver:** Acknowledged/role-pending/complete outcomes; Grant confirmation, late-effect compensation and operator repair; Human assistance and logged overrides.

**Boundary:** Success requires confirmed delivery; AI is never involved.

### P17 · Complete staff ticket UX and commands

**Lane:** Administration · **Priority:** P0 · **Owner:** Dashboard/tickets agent

**Depends on:** P08, P11, P12. **Tests:** T05, T07, T10, T26, T42.

**Deliver:** Permitted queues, case detail, notes and participant controls; Human replies, canned-answer selection and transcripts; Command/dashboard parity.

**Boundary:** No summaries, drafting, triage or conversation-transfer AI.

### P18 · Implement simple automation and curated answers

**Lane:** Administration · **Priority:** P1 · **Owner:** Automation agent

**Depends on:** P08, P09. **Tests:** T45.

**Deliver:** Literal/bounded rules, cooldowns, mention suppression; Join/static response previews and manually curated answers.

**Boundary:** Generic auto-responses ignore tickets and bot/webhook loops.

### P19 · Enforce AI exclusion at every boundary

**Lane:** Knowledge · **Priority:** P0 · **Owner:** Security/knowledge agent

**Depends on:** P05, P06, P07, P10. **Tests:** T22, T23, T24, T25, T26, T46.

**Deliver:** Ingress/delivery classification guard and permanent case exclusions; Worker/database/filesystem isolation; Sentinel tests and architecture import restrictions.

**Boundary:** No toggle or staff bypass can enable AI inside cases.

### P20 · Implement MediaWiki ingestion and sync

**Lane:** Knowledge · **Priority:** P0 · **Owner:** Knowledge agent

**Depends on:** P03, P06, P19. **Tests:** T23, T27, T28.

**Deliver:** Capability-aware API connector and rendered snapshots; Cursor/checkpoint, template dependency, deletion and review pipeline; Provenance/rights and collection restrictions.

**Boundary:** No guessed endpoint, broad Discord scrape or case archive source.

### P21 · Implement direct lookup and source authority

**Lane:** Knowledge · **Priority:** P0 · **Owner:** Knowledge agent

**Depends on:** P20. **Tests:** T27, T28, T29, T34.

**Deliver:** Exact/alias/lexical retrieval and valid source links; Audience/version-aware caches and authority conflicts; Model-independent /lookup.

**Boundary:** No semantic model dependency for basic lookup.

### P22 · Implement knowledge administration

**Lane:** Knowledge · **Priority:** P1 · **Owner:** Dashboard/knowledge agent

**Depends on:** P08, P20, P21. **Tests:** T28, T29, T42.

**Deliver:** Source/collection review and snapshot comparison; Sync diagnostics, quarantine, deletion and safe previews.

**Boundary:** Preview has no case-context or transcript import path.

### P23 · Provision and benchmark local model

**Lane:** Local AI · **Priority:** P0 · **Owner:** Local inference agent

**Depends on:** P01, P02, P07. **Tests:** T31, T32, T33.

**Deliver:** Model/runtime hash and licence lock; CPU-only llama.cpp hardening and measured limits; Cold/warm latency/memory/load benchmark report.

**Boundary:** No cloud fallback, auto-download or claimed unmeasured throughput.

### P24 · Implement non-ticket knowledge assistant

**Lane:** Local AI · **Priority:** P0 · **Owner:** Assistant agent

**Depends on:** P19, P21, P23. **Tests:** T22, T25, T26, T29, T30, T34, T48, T52.

**Deliver:** Dedicated-channel /ask and short-lived bounded sessions; Application-directed retrieval and source-ID validation; Final delivery revalidation and blank staff-contact link; Bounded Sophie style profile with citations, truthful action claims and no ticket exceptions.

**Boundary:** No ticket data/tools, case advice automation or arbitrary browsing.

### P25 · Implement AI controls and evaluation tooling

**Lane:** Local AI · **Priority:** P1 · **Owner:** Dashboard/AI evaluation agent

**Depends on:** P08, P24. **Tests:** T26, T31, T33, T42, T48.

**Deliver:** Model/limits/queue/cancel/disable dashboard; Versioned prompts and evaluation ledger; Public-knowledge previews and redacted diagnostics.

**Boundary:** No persistent member profiling or case-content feedback.

### P26 · Implement backups, deletion and operator runbooks

**Lane:** Administration · **Priority:** P0 · **Owner:** Operations agent

**Depends on:** P06, P07, P12. **Tests:** T35, T37, T38, T39.

**Deliver:** Retention/deletion ledger and consistent artifact backups; Isolated restore/rollback scripts and evidence; Independent outage alert/fallback process.

**Boundary:** Do not replay restored jobs into production.

### P27 · Run administration failure and permission suite

**Lane:** Administration · **Priority:** P0 · **Owner:** Independent test agent

**Depends on:** P16, P17, P18, P26. **Tests:** T03, T06, T07, T13, T15, T16, T18, T20, T21, T36, T39.

**Deliver:** Recorded G2 results for crashes, permissions, restores and role races; Defect fixes and build-specific evidence.

**Boundary:** Tests use synthetic cases; findings block release until resolved.

### P28 · Run knowledge/AI isolation, quality and load suite

**Lane:** Local AI · **Priority:** P0 · **Owner:** Independent test/evaluation agent

**Depends on:** P22, P25, P26. **Tests:** T22, T23, T24, T25, T28, T29, T30, T31, T32, T33, T34, T35, T48, T52.

**Deliver:** G3/G4 evidence and reviewed 40-question minimum set; Sentinel, permission, deletion and model-failure results; Resource usability sign-off on actual host.

**Boundary:** Zero prohibited data/tool paths; no ticket material used in tests.

### P29 · Approve brand implementation and accessibility

**Lane:** Administration · **Priority:** P1 · **Owner:** Design/accessibility reviewer

**Depends on:** P03, P13, P17, P18, P38. **Tests:** T42, T43, T49, T50, T51.

**Deliver:** Approved theme tokens/assets/provenance; Keyboard/contrast/reflow/quiet-mode evidence; Core staff workflow review; Sophie crop, transparency, fallback and neutral-case presentation review.

**Boundary:** Do not infer exact live-site assets from this planning pack.

### P30 · Approve administration pilot and cutover ledger

**Lane:** Administration · **Priority:** P0 · **Owner:** Lead/operator

**Depends on:** P27, P29. **Tests:** T40, T41.

**Deliver:** Reviewed existing-member eligibility baseline; Bot responsibility/old-case drain plan; Backup, fallback and operator release approval.

**Boundary:** Administration approval does not depend on local AI readiness.

### P31 · Cut over administrative responsibilities

**Lane:** Administration · **Priority:** P0 · **Owner:** Operator/release agent

**Depends on:** P30. **Tests:** T38, T40, T41.

**Deliver:** Single-writer feature transfers and monitored pilot results; Old panels retired safely; old cases drained without migration; Rollback/incident evidence and current release record.

**Boundary:** Do not remove old ticket access while open cases still need it.

### P32 · Activate direct knowledge then approved AI

**Lane:** Local AI · **Priority:** P1 · **Owner:** Operator/knowledge lead

**Depends on:** P28, P31. **Tests:** T22, T29, T32, T34, T48, T52.

**Deliver:** Source/AI channel approvals and final source freshness check; Scoped rollout and disable/fallback test; Published local-processing notice.

**Boundary:** Direct lookup can go live earlier under G3; AI remains separately gated.

### P33 · Add selected read-only service adapters

**Lane:** Later utilities · **Priority:** P2 · **Owner:** Integration agent

**Depends on:** P32. **Tests:** T29, T46, T47.

**Deliver:** Owner-approved platform/resource inventory; Scoped connector credentials and contracts; SSRF, timeout, audience and source-provenance tests.

**Boundary:** No automatic writes, BYOND duplication or broad generic network tool.

### P34 · Add small community utilities

**Lane:** Later utilities · **Priority:** P2 · **Owner:** Community utilities agent

**Depends on:** P31. **Tests:** T08, T44, T45.

**Deliver:** Prioritised suggestions, message-context reports or announcements; Bounded scheduler and human-curated answer workflow.

**Boundary:** Choose one feature slice at a time; no ticket AI or unreviewed code ports.

### P35 · Establish maintenance and upgrade cadence

**Lane:** Operations · **Priority:** P1 · **Owner:** Lead/operations agent

**Depends on:** P31. **Tests:** T02, T31, T38, T39, T46.

**Deliver:** Dependency/API/model revalidation procedure; Operator ownership and recovery-drill schedule proposal; Documented agent PR and release protocol.

**Boundary:** No unattended production upgrades or recurring jobs without owner approval.

### P36 · Import Sophie identity and source assets

**Lane:** Foundation · **Priority:** P1 · **Owner:** Brand/integration agent

**Depends on:** P03, P04. **Tests:** T49.

**Deliver:** Four manifest-selected original PNGs in a versioned local asset root; Shared brand-profile contract, SHA-256 validation and source provenance; Legacy-human-art exclusion and explicit publication/derivative review records.

**Boundary:** No regeneration, relabelled artwork licence, remote asset loading, extra model runtime or technical service renaming.

### P37 · Apply Sophie branding to interfaces and static copy

**Lane:** Administration · **Priority:** P1 · **Owner:** Dashboard/Discord agent

**Depends on:** P36, P08, P09, P13, P17. **Tests:** T50, T51.

**Deliver:** Avatar/header/hero/wordmark placement with live-text and quiet-mode fallbacks; Identity controls separate from AI settings and case permissions; State-derived, owner-reviewed static templates for ticket and Shuttle notices.

**Boundary:** No AI inside cases, mascot chat widget, rewritten admission rules, unsupported success claims or unreadable decorative surfaces.

### P38 · Review identity consistency and non-AI presentation

**Lane:** Administration · **Priority:** P1 · **Owner:** Independent design/security reviewer

**Depends on:** P37, P19. **Tests:** T49, T50, T51.

**Deliver:** Small/circular/narrow-layout previews and alpha checks on light/dark surfaces; Brand-preview and deterministic-case sentinel test evidence with zero model calls; Versioned asset approval and rollback record for the administration release.

**Boundary:** Artwork review is not a production benchmark or legal certification. Do not block human administration on local-model readiness.

