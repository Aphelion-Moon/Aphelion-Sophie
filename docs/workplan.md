# Current implementation workplan

Revision: 2026-10-25-production-bbe844c. Mistral Small 4 (mistral-small-2603) on the official EU API is the selected provider for trial; DeepSeek Flash is withdrawn. Local models are historical, explicitly selected alternatives only; no automatic fallback. Continue the DS workstream with synthetic data; full readiness and activation remain open.

All production release gates remain open; pure and isolated database checks are not full application acceptance.

Source requirements remain in the preserved v1.1 pack. Current owner decisions override conflicting source recommendations; delegation follows the current owner-authorized scope in AGENTS.md.

## Implementation checkpoint

Deterministic administration, Whitelist onboarding, protected editors, role/permission configuration and the configurable staging host are implemented.

Recorded baseline: Pinned 2063a50/schema075 (release sophie-mistral-2063a50) installed 22 October 12:34 UTC as a source-only update of 052864c (Shuttle Activity layout pass). Pinned 052864c/schema075 (release sophie-mistral-052864c) installed 22 October 11:51 UTC as a schema update of a723a49 (Shuttle Activity second pass, migration 075). Cold recovery point D:\Backups\sophie-staging\schema075-052864c-20261022. Pinned a723a49/schema074 (release sophie-mistral-a723a49) installed 22 October 10:43 UTC as a source-only update of b6af5d8 (Sophie speaks briefly at each stage). Pinned b6af5d8/schema074 (release sophie-mistral-b6af5d8, branch docs/shuttle-activity-plan) installed 22 October 01:35 UTC as a source-only completion of fe25c83 (01:28 UTC, migration 074, Shuttle Activity in testing on 127.0.0.1:38125), replacing 6c7de3b/schema073. Cold recovery point D:Backupssophie-stagingschema074-fe25c83-20261022. Pinned 25b8085/schema072 (release sophie-mistral-25b8085, the runtime paths of 5fc8442, branch staging/admission-trace) installed 20 October 17:05 UTC as a source-only update of 67c1f4a (15:47 UTC), 334fd97 (14:57 UTC), itself on 20bd3e7 (installed 13:55 UTC with migrations 071-072, replacing 38e4f3a/schema070), with the owner-accepted Mistral processing policy unchanged, Go live in force and a 32 KB prompt budget. Hosting after the d8fb0e5 conversion: core and the AI worker are ordinary Manual services with trust v2 (no expiry); the supervisor is Disabled. Cold recovery point D:\Backups\sophie-staging\schema072-20bd3e7-20261020.

Current work: Shuttle message groups, faster page turns and no Staff intervention (owner-approved 20 October): status card, plain step messages and a navigation card; instant "Opening…" feedback; Ask Staff removed; shared rate limits, delivery wake-up, boundary-scoped observation sharing and response-confirmed writes; migration 071. Prepared on codex/sophie-social-ai; not yet installed. Open: staging install and live walk-through with timing comparison; Mistral zero data retention; fresh-session join-time consent test; worker denial qualification; production.

At 88359f6: npm test 643 passed; storage fast 957 passed with the three known order-dependent failures (J01, U08, S17). Conversion prepared and checked read-only in GitHub/.agent_docs/aphelion-sophie/deployment-d8fb0e5-2026-10-12/ (prepare.mjs passed, setup -WhatIf on WUFF); not yet installed. Details: docs/verification.md.

## Selected AI workstream

Owner resumed implementation, commits and generated rebuilds. USD 20 per Europe/Vienna calendar month; no separate daily currency cap; 2,000 daily attempts. Confirmed replies share the 12-item, five-minute local context and inherit earliest source expiry. All original P/T/SAI requirements remain; current provider decisions supersede historical local-only directions.

| Task | Implementation | Qualification | SAI mapping | Remaining work |
|---|---|---|---|---|
| DS-00 — Reconcile preserved handoff | complete | Original eight source and five evidence hashes matched; historical files preserved | SAI-00, SAI-14 | Keep this tracker current at each milestone. |
| DS-01 — Provider and data-use clearance | Draft agreement/disclosure packet and schema2 protected processing evidence support; exact notice-bound consent receipts, export and outage-safe withdrawal implemented locally. Coherent notice checks now fence asynchronous metadata and control changes; unbound remote notices cannot offer or save opt-in. Consent navigation is paged with exact self-only lookup, and departure cleanup/restore holds block new consent and processing. Updated draft notice and factual implementation annex for schema066; 7058 characters, not published. | 4 October schema066 candidate: 90 focused unit checks, 92 AI/database scenarios and 20 composed staging scenarios passed, plus synthetic browser checks. No legal/provider clearance or live migration established. | SAI-00, SAI-12, SAI-14 | Obtain actual provider commitments and transfer/retention evidence; finish factual retention, eligibility and provider annexes before notice publication. Review final notice and operator publications, approve deployment of schema065/066 and the committed source separately, then complete existing worker and Discord acceptance gates. Draft documents and hashes are not legal clearance. Match the notice and retention annex to default AI-data deletion on departure; retained-data requests still use the existing operator contact route. Mistral, 11 October: owner reports ZDR requested and awaiting review, training opt-out in force, 30-day default retention meanwhile. Open: paid plan and processing-agreement coverage, sub-processor review, ZDR outcome and proof, prompt caching under ZDR, public privacy policy, exact notice with any interim retention window, per-channel AI disclosure. Mapping: GitHub/.agent_docs/aphelion-sophie/mistral-port-2026-10-11/ds-01-mistral-evidence-status.md. |
| DS-02 — Prepared-turn contract | Immutable bounded outbound preparation with independently redacted free text, unsafe structural-key rejection, private per-worker channel pseudonyms and keyed ephemeral diagnostic comparison. Profile schema2 binds redaction and cache-partition policy. | 4 October: final HTTP-body capture, worker partition rotation, budget/consent cancellation and 100 focused worker/context/provider checks pass; 79 isolated AI/database scenarios pass. Earlier browser/composed-staging evidence is historical. No live provider or cache requalification. | SAI-01, SAI-03, SAI-05, SAI-08 | Current Chat layout remains the control. Actual provider cache observations, reviewed answer quality, latency and Windows containment remain separately unqualified; no cache eviction or dispatch inference from preparation diagnostics. |
| DS-03 — Durable spending and dispatch | Durable reservation/dispatch/uncertainty accounting with bounded resolved-attempt and aggregate retention and a hard attempt-row capacity hold | 65 isolated AI/knowledge/Gateway scenarios pass, including 500-row cleanup, preserved unresolved charges and independent replay receipts; one actual isolated PostgreSQL check at 200,000 attempt rows verifies atomic last-slot admission, 500-row retention and preserved replay receipts (122 ms concurrent pair; 98 ms retention batch) | SAI-01, SAI-02, SAI-05 | Provider framing, approved prices, actual transport crash/rollover and installed-service capacity/latency remain unqualified. The single synthetic host capacity run is not an end-to-end timing or production load guarantee. |
| DS-04 — Windows worker and transport | Owner-selected OS-account worker isolation, manifest enforcement and protected installation composition; supports narrowly scoped public processing policy and independent preference-journal receipt. Installed preflight rejects any missing schema066 grant addition. | Installed on WUFF 29 September: worker/supervisor/core virtual accounts, service DACL, ACL scope and 4 egress block rules captured as receipts hashed into the release evidence; 701-entry package manifest enforced at startup (tamper and missing-file cases observed failing closed). 573/573 repository tests pass on the host with the supervisor installed. No worker boot or provider call yet. 4October:10 focused installation tests,93 isolated AI/database checks and read-only setup -WhatIf passed. Metadata confirms all five services stopped and expired receipts; no live worker acceptance. | SAI-04, SAI-05, SAI-14 | Approved7a152ca repair is installed on schema064 with wrapper-directory access corrected. Actual worker boot/lease, Node-child file/network denials and physical stop remain unrun; owner dashboard start and operational acceptance remain required. |
| DS-05 — Optional Responses comparison | deferred; Chat retained | No demonstrated gain; no paired paid trial | SAI-05, SAI-14, SAI-15 | Chat remains selected. Optional alternate protocol is not a release prerequisite. |
| DS-06 — Gathering and fair concurrency | Fenced three-fragment gathering, first-receipt deadline, ingress flood limit and fair bounded channel scheduler implemented; eligible edited fragments replace their own pre-freeze revision | 43 focused runtime/turn/observation checks and 63 isolated AI/knowledge/Gateway scenarios; no actual provider or Discord timing | SAI-02, SAI-05 | Qualify actual one-versus-two workers and end-to-end latency before increasing runtime concurrency from one. |
| DS-07 — Wiki synchronization and direct lookup | Installed read-only lookup plus separately credentialed knowledge-only editor/import/synchronizer composition, current actor checks and fixed Policies collection. No automatic publication. | 61 focused checks; 64 isolated AI/knowledge/Gateway scenarios; 18 composed staging scenarios, including Discord lookup with AI unavailable | SAI-08, SAI-11 | Distinct knowledge editor installed and database isolation verified 30 September. Fixed public Policies importer reached ready with current freshness metadata. Review/publish its extracts and Discord rules; qualify lookup and actual 40-question answers. Historical offline question review remains distinct. |
| DS-08 — Assistant context and explicit memory | Local self-service preferences with independent journal, epoch/quarantine, authenticated export/deletion/expiry; remote preference use remains off. Temporary context now redacts common identifiers and eligible identity aliases, preserves original question detection, rejects async invalidation races and uses cached byte counts. Pending metadata and admissions are fenced against invalidation; context cannot be refilled by an older admission. Departure now deletes personal AI data by default; explicit saved retention preserves local data without reenrolling the member. Durable cleanup and journal fences cover restart, rejoin, restore, dependent effects and unresolved spending. Minimal deletion/replay markers remain after erasure. 11 October: member-written notes (eight one-line notes, 200 characters) share the preference record; a separate member sharing switch gates inference use for that member only; migration 070; read-only trusted lookup; memory prompt block; turn recheck before dispatch and delivery. | 4 October departure candidate: 90 focused checks, 92 isolated AI/database scenarios, 20 staging scenarios and synthetic browser checks passed. Prior source-bound redaction/context timings remain historical; no new latency or anonymity claim. Approved pinned 5f60a24/schema066 deployment: actual database privileges and journal integrity/ACL/receipt passed; bytes preserved. Worker and member acceptance remain unrun. Pinned335a3f2/schema069 deployment preserves all rows/grants and independently renewed journal bytes/identity/configured ACLs; no worker execution. | SAI-02, SAI-10, SAI-11 | Actual worker file/network denials and physical stop, provider terms and factual privacy annexes, approved publications, current tester consent, private Discord/client acceptance and measured AI latency remain separate gates. Journal receipt expires 5 October at 20:54 Warsaw; installation trust at 21:54. Renewal requires fresh evidence. The initial dashboard assertion failed with an unrecorded status; a focused rerun passed, but its cause is unproven. The earlier P19 runtime fault also remains unexplained. Member notes: notice text describing them, deployment of migration 070, synthetic-account acceptance on the test guild. |
| DS-09 — Effects and operating controls | Authenticated worker desired/apply/stop/recovery plus reviewed operator-owned public channel activation. Actual worker probe, processing receipt, live audience, hashes, budget and actor authorization rechecked before confirmation; durable receipts prevent a replay enabling AI after disable. | 77 isolated AI/database scenarios pass, including approval denial, notice change, private audience, revoked authority and disable/replay. New synthetic live-probe checks distinguish current acknowledgement from recorded readiness. | SAI-06, SAI-07, SAI-14 | Installed7a152ca repair verified without changing runtime configuration or enabling processing. Owner publications, DS-01, individually current consent and actual worker/Discord acceptance remain open. |
| DS-10 — Selected-release qualification | Offline 40-question source review completed; three wording/citation findings corrected in the historical candidate | 40/40 supplied-source locators resolve; 27 support and 13 abstention expectations; no model-answer acceptance | SAI-15 | Owner character/source publication approval, fresh source revisions, independently reviewed actual answers, authorized paid/cache comparison and receipt-to-Discord timing. |
| DS-11 — Full selected capability readiness | matrix recorded; incomplete | No selected capability has full operational qualification | SAI-10, SAI-11, SAI-12, SAI-14, SAI-15 | Complete implemented/qualified/cleared/activated axes; explicit memory and named restricted domains remain visible. |
| DS-12 — Mistral provider port | Replaced the DeepSeek client with a Mistral Small 4 client on the official EU endpoint: dated model ID, reasoning off, locally validated JSON mode, private channel-scoped prompt_cache_key, usage normalised to the existing accounting shape with uncredited cache use charged as uncached, and a pinned returned-model identity gate. Transport, IPC identity, worker release, processing policy and installation preparation accept only provider mistral. The provider is bound into consent. | 11 October: synthetic live check with the owner key confirmed usage fields, reasoning setting, message layout, exact model echo and sub-1.5-second latency; unit and isolated-database results are in docs/verification.md. Quality and host-load qualification not run. | SAI-04, SAI-05, SAI-12 | Owner: fill the notice facts, supply the two missing evidence files, accept the processing policy; then publish personality, participation and budget, start the worker and enable the test channel. Renew trust with fresh evidence when it expires. Open: quality qualification and worker isolation/stop trials. If Mistral retains cached prefixes under ZDR, remove prompt_cache_key and requalify the profile. |

| Capability gate | Implementation | Qualification | Data clearance | Activation |
|---|---|---|---|---|
| SAI-G0 — Scope and contracts | foundation recorded | local evidence only | account terms unresolved | off |
| SAI-G1 — All five public social modes | Public-mode settings, notice/approval binding, reviewed channel activation and processing-expiry repair are installed in7a152ca/schema064. | worker/effects/full-turn gates open | blocked | off |
| SAI-G2 — Knowledge and direct lookup | Shared dashboard and signed Discord lookup, fixed Policies importer and knowledge-only editor/refresh are installed. No automatic publication. | 61 focused checks; 64 isolated AI/knowledge/Gateway scenarios; 18 composed staging scenarios, including Discord lookup with AI unavailable; operational/source/40-question gates open | Policies collection selected; advertised CC BY-NC-SA 4.0 retained; publication-specific review remains required | off |
| SAI-G3 — Explicit personal memory | Local member-saved reply length and language preferences with self inspection, replacement, export action, deletion and 90-day expiry; independent restore watermark fails closed | Offline lifecycle/export/restore evidence plus privacy grants preserved through installed 335a3f2/schema069 and independently renewed journal integrity/ACL/receipt. Actual worker denial and operational restore/export/departure acceptance remain open. | Two explicit preference types selected; external processing not cleared | off |
| SAI-G4 — Staff, Head/Project Lead and named project contexts | not qualified for remote | audiences, worker and provider separation unqualified | blocked per named domain | off |
| SAI-G5 — Registered file profiles | unselected | not applicable until selected | no exact resources approved | off |
| SAI-G6 — Operational release | incomplete | Approved pinned 335a3f2/schema069 deployment: 512 exact source hashes and all 69 migration checksums verified; 77 original rows in 103 tables and all grants preserved. Four service-child identities, loopback listeners, current Gateway, recovered supervisor, 18 local/public route checks and 2 asset checks passed. Tunnel unchanged; worker stopped; processing policy absent and AI disabled. Independent journal bytes/identity and configured ACL/firewall scope unchanged. Source-bound report: GitHub/.agent_docs/aphelion-sophie/deployment-335a3f2-2026-10-04/verification.json. Actual worker execution/denials/stop and measured AI performance remain unrun. Prepared worker OS probe: 13 synthetic checks pass; actual execution/identity/denial/physical-stop evidence remains absent. | capability-specific gates open | Staging preparation installed; no real-member AI activation or production approval. |

These SAI-G gates are separate from the original G gates. Partial implementation and blocked activation do not establish full readiness.

## Implemented milestones and remaining scope

Milestone entries preserve their checkpoint evidence. Current next steps and owner decisions supersede historical remaining-work text, including the retired Hyper-V/HCS/relay design.

| Milestone | Implemented and verified offline | Evidence | Still required |
|---|---|---|---|
| Durable administration foundation (P04, P06, P19) | ESM contracts, retained state, atomic intent/receipt commits, fenced workers, 30 versioned migrations and core/knowledge database separation. | [Storage](storage.md); S01–S20 and the [recorded reports](verification.md). | Authenticated artifact access, operator inventory/repair, independent recovery watermark, production identities and composition. |
| Crew, Muzzled and Whitelist (P09, P14, P15, P16) | Current-policy role delivery, fresh Shuttle after access loss, ordered Gateway revocations, duplicate handling and late-effect compensation. | [Role commands](command-authorization.md), [Gateway](gateway-continuity.md); D01–D14, M01–M14, A01–A14, G01–G17. | Authorized live acceptance of reviewed moderation recovery, approved role IDs/capabilities and effective permissions. |
| Private Shuttle experience (P13, P14, P16) | Pinned five-page runs, private navigation, final acknowledgement, human-help pauses, Staff alerts and audited message/channel recovery. | [Screens](shuttle-screens.md), [assistance](shuttle-assistance.md), [recovery](shuttle-artifact-recovery.md); U/V/N/H/W/L/R/F/Q suites. | Unidentified external results, owner-approved copy/links, override controls and live client checks. |
| Private cases and Staff operations (P10, P11, P17) | Staged private provisioning, duplicate sealing, retained close/reopen actions, permission-filtered queues, claims, reassignment, periodic ACL inspections and explicitly confirmed participant add/remove with revocation repair. | Commits 883f6d9, 75d4eb5, 5d9bdc8, b4eb586; [case lifecycle](case-lifecycle.md), [Staff queue](case-staff.md), [inspections](case-inspections.md), [participants](case-participants.md); C/J/K/I/CP suites and S35. | Restricted notes, archive placement, attachment operations and confirmed exports/downloads, participant/contact dashboard parity and unresolved external results. |
| Dashboard authentication (P05, P08) | Single-use browser-bound OAuth state, hashed sessions, CSRF and shared current-capability checks. | Commit 3b70c6d; [authentication](dashboard-auth.md); O01–O16, S27. | Other dashboard routes, public ingress/TLS limits and real provider/browser acceptance. |
| Shuttle authoring and browser editor (P08, P13, P36, P37) | Retained drafts, static comparison, immutable publication, withdrawal review, history and stale/uncertain-response recovery; approved source avatar bytes. | Commits 58842ee, 7dbb625; [authoring](shuttle-authoring.md), [editor checks](dashboard-ui.md); E01–E20, S28 and 15 controller/transport/asset tests. | Owner copy approval, workflow migration/override controls, remaining branding surfaces and independent accessibility acceptance. |
| Ordinary ticket intake (P05, P06, P09, P10, P17, P19) | Quick Help plus five versioned form categories, private signed submissions, indefinite retained answers, atomic case creation and verified navigation. | Commit 670cb36; [intake](case-intake.md); eight contract tests, B01–B21 and S29. | Final questions, production registration and live modal compatibility. Player reports and initial Staff-contact intake are implemented in separate milestones below. |
| Ordinary answer delivery (P06, P09, P10, P17, P19) | Retained delivery plans, ordered escaped answer pages, current private-channel proofs and one bounded Staff/lead-ops notification; uncertain writes stop for review. | Commit d63ee15; [answer delivery](case-intake-delivery.md); four contract tests, X01–X23 and S30. | Unidentified or uninspectable external results, final forms, live notification/client checks and production composition. |
| Ordinary ticket delivery review and recovery (P06, P09, P10, P11, P17, P19) | Permission-filtered parked queues, audited rechecks, exact-message identification and retained duplicate-channel selection; fresh worker confirmation remains mandatory. | Commit 9b12d02; [ordinary recovery](case-delivery-issues.md); four contract tests, Y01–Y23 and S31, also included in the current full-suite result. | Unidentified/uninspectable results, dashboard parity, integrated runtime, live permissions and independent restore. |
| Ticket-form authoring and authenticated API (P05, P06, P08, P10, P17, P19) | Retained bounded drafts, runtime-equivalent static review, guarded immutable publication/withdrawal, stable metadata history and exact request receipts; no submitted-answer access. | Commit 982be79; [form authoring](case-form-authoring.md); four contract tests, Z01–Z22 and S32 in the current full-suite result. | Final owner questions, production capability mapping, live clients and independent recovery. |
| Ticket-form browser editor (P05, P08, P10, P17, P36, P37) | Seven-category question/choice editing (five ordinary forms, player reports and Staff contacts), static saved-copy review, immutable publication/withdrawal, history, category protection and shared conflict/uncertain-request recovery; current-access clearing in state and DOM. | Commits 0fb8825 and 5ca3eaa; [form browser checks](dashboard-forms.md); twelve original controller/transport tests, additional report/contact-category tests, seven-category Z04 and Z22 with the actual API/store. Scoped Chromium keyboard/narrow checks cover the original editor; the added categories have controller/integration coverage. | Final owner questions, real OAuth/TLS/Discord clients, independent accessibility/brand review and runtime composition. |
| Player-report intake and subject separation (P05, P06, P09, P10, P17, P19) | Signed /ticket report, an optional pinned subject separate from the opener/audience, sixth authored form category, retained answers and subject-aware private delivery with exact recovery; existing forms migrate unchanged. | Commit 5ca3eaa; [player reports](player-reports.md); four contract tests, PR01–PR10, seven-category Z04 and S33, included in the current full-suite result. | Final questions, live command registration/client compatibility, production composition and independent restoration. |
| Participant membership authority prerequisite (P05, P06, P09, P10, P17, P19) | Independent durable membership epochs and current human eligibility; departure/rejoin and continuity gaps revoke old bindings, ordinary role changes preserve membership, and first-seen removal revokes Staff authority. No invitation or audience write is created. | Commit 948d0b7; [participant membership authority](case-participant-authority.md); two contract tests, PA01–PA10 and S34, included in the current full-suite result. | Explicit participant changes and initial Staff-contact intake are now implemented below. Live permissions and independent recovery remain. |
| Explicit case participants and audience reconciliation (P05, P06, P09, P10, P11, P17, P19) | Signed confirmed add/remove on existing cases, retained invitation/action history, shared case and audience versions, pending-authority checks, current membership delivery barriers, exact open/closed/sealed audiences and late-write compensation. First-seen Gateway removal now schedules invited cases. | Commit b4eb586; [explicit case participants](case-participants.md); four additional contract tests, CP01–CP19 and S35 in the recorded 212/536 full-suite result. | Participant dashboard parity, live permission/client checks, runtime composition and independent recovery; initial contact entry/navigation is implemented below. |
| Staff-contact intake and recipient navigation (P05, P06, P08, P09, P10, P11, P17, P19) | Signed selection of up to twenty recipients, explicit audience confirmation, a seventh pinned form category, atomic retained answers/invitations/actions, initial Staff-authority checks, revocation/late-write repair and a private paginated recipient queue with verified open/read-only destinations. | Commit 62e61d2; [Staff contacts](case-contacts.md); four additional contract tests, SC01–SC23 and two-restart S36, included in the 212/536 full-suite result. Existing intake/participant and seven-category authoring checks also pass. | Final questions, contact dashboard parity, live registration/client/ACL checks, attachment operations and confirmed exports/downloads, runtime composition and independent restoration. |
| Case conversation observations and coverage gaps (P06, P09, P10, P11, P12, P19) | Explicit core-only Gateway capture for retained case channels and discovered descendants; immutable create/partial-edit/delete observations, cursor atomicity, bounded inert content/attachment references, permanent provenance/exclusions and honest interruption/permission/loss gaps. | Commit 4154696; [Conversation retention](case-conversations.md); five additional contract tests, CC01–CC24 including native loopback Gateway traffic, and two-restart S37 in the 212/536 full-suite result. | Confirmed exports, current case/child export authorization and audit, live intents/permissions/clients, attachment operations and independent restoration. Quarantined file acquisition is implemented below. |
| Bounded private attachment acquisition (P06, P10, P11, P12, P19) | Atomic reference jobs, exact CDN identity/public DNS restrictions, current explicit policy, streaming limits, exclusive quarantined file slots, source/policy/hash evidence, conservative capacity reservations, durable cooldown, bounded retries and crash/late-write recovery without overwriting files. | Commit b66a2d4; [Private attachments](case-attachments.md); six contract tests, CA01–CA23 including native loopback HTTP/deadline and durable cooldown, and two-restart S38 in the 212/536 recorded full-suite result. | Approved production limits/download policy, controlled artifact streaming, inventory/requeue/orphan reconciliation, capacity alerts, Windows service ACLs, live CDN/TLS and independent filesystem/database recovery. |
| Authenticated transcript reads (P05, P06, P11, P12) | Authenticated five-observation/25-gap pages through the fixed dashboard listener; current case and selected-child authorization, independent membership epochs, logout/revocation suppression, escaped inert content and attachment status only. | [Transcript reads](case-transcripts.md); seven contract tests and TR01–TR11 in the [focused report](evidence/transcripts-verification.json). | Confirmed audited exports, controlled file downloads, browser navigation, live OAuth/Discord/TLS, runtime composition and independent recovery. |
| Isolated Discord staging host (P07, P09, P27) | Explicit foreground staging host with loopback listeners, readiness-gated commands/workers, bounded shutdown, fixed diagnostics, database privilege/migration checks and configuration template; no service installation. Separate explicit registration upserts the four fixed Sophie guild commands. | [Setup](discord-staging-setup.md), four runtime/CLI contracts and RT01–RT09; [scoped source-bound report](evidence/staging-verification.json). | Operator-provided isolated guild/application, IDs, credentials, approved ingress/database, live acceptance and production release gates. Attachment acquisition is deliberately unwired. |
| Confirmed bounded transcript exports (P06, P12, P19) | Current-audience exact-review confirmation, immutable policy binding, retained generation audit and optional authenticated HTML attachment routes; selected channel only, explicit bounds and partial-history labels. | [Export contract](case-exports.md); TR01–TR11 and EX01–EX08, [source-bound report](evidence/exports-verification.json). | Audience approval, runtime/browser composition, larger/multi-channel exports, file downloads, live and independent recovery checks. |
| Test-guild self-bootstrap and approved member exports (P07, P09, P12, P27) | Explicit isolated-guild resource creation with current application/guild-owner/permission checks, durable local receipts, uncertain-create stop, fixed registration and generated configuration. Approved current-reader exports composed into the host. | [Setup guide](discord-staging-setup.md); seven bootstrap/four runtime contracts, 14 transport checks and RT01–RT10 in the current [staging report](evidence/staging-verification.json). | Actual operator-provided test application/guild, intents/HTTPS/database, live verification, browser export workflow and production gates. |
| Initial live bootstrap and explicit hierarchy diagnostic (P09, P27) | Retain the strict numeric role hierarchy policy while distinguishing hierarchy failure from changed resource metadata. Preserve the observed live Crew role for resumption. | Eight focused bootstrap contracts pass, including tied-position retry and reuse after operator correction. Live REST identity/guild/non-Administrator permission checks passed; first role created. | Operator bot-role placement, remaining bootstrap resources, isolated database/HTTPS, live acceptance and all production gates. |
| Completed isolated Discord resource bootstrap (P09, P27) | Corrected non-administrator channel overwrites and HTTP 201 channel creation; completed retained test-guild bootstrap and verified exact resources, owner role, commands and absence of duplicates. | [Live REST report](evidence/discord-bootstrap-verification.json); 28 focused contracts; RT01–RT10 in [refreshed staging report](evidence/staging-verification.json), with clusterStopped true. | Dedicated staging database, sophie.a13.info ingress/OAuth registration, running-host and workflow acceptance; production gates remain open. |
| Live isolated staging host and Cloudflare ingress (P07, P09, P27) | Separate tunnel/hostname, dedicated loopback PostgreSQL, approved pinned connector and foreground core. Owner OAuth callback and login verified. No existing tunnel/game/wiki database changed. | [Live host report](evidence/discord-staging-live.json): healthy tunnel, current Gateway, HTTPS dashboard, signed endpoint validation, negative signature probes, 31 migration hashes/53 table privilege checks, OAuth callback/start/completed-flow checks and owner-reported editor visibility. | Synthetic guidance/form publication and live workflows/privacy/recovery; all production release gates. [Operation/stop instructions](staging-operations.md). |
| Case reader and browser export confirmation (P08, P12, P17) | Authenticated channel-ID selection, text-only observation/gap pages and explicit browser export review/confirmation for all current readers; identity/access clearing, hidden-page late-response suppression and exact uncertain-download retry. | 35 focused tests; TR01–TR12/EX01–EX08; synthetic Chromium keyboard, narrow-layout, inert rendering, pagination, download handoff and denial clearing. See docs/case-browser.md and source-bound case-browser/export reports. | Live user case/export acceptance, independent identities for privacy tests, attachment downloads/policy and operations, larger/multi-channel exports, other Staff screens and production/recovery gates. |
| Read-only attachment operations and Staff contact transport repair (P06, P08, P12) | Read-only staging operator inventory: bounded guild job/attempt metadata and whole-vault accounting/pause diagnostics, plus one retained-file size/hash verification with current-selection recheck; no content output, repair, deletion or download grant. Staff contact form GET routes now pass the browser category allowlist. | 24 focused tests; CA01–CA23/AO01–AO05; 276-source checker; isolated staging CLI smoke without mutation. See docs/attachment-operations.md and its source-bound report. | Live case/export acceptance, complete filesystem/orphan inventory, safe repair/requeue and capacity alerts, file-download/scanning policy, other Staff workflows and production/recovery gates. |
| Quick Help scan-metadata compatibility and destination diagnostics (P06, P17, P19) | Own-message verification accepts only bounded numeric Discord content_scan_version metadata while preserving exact visible fields, ownership and mentions. Destination failures emit fixed stage and allowlisted error codes without case content or identifiers. The fix is running in isolated staging; two existing channels have confirmed exact ACLs. | 21 focused tests, B01–B21/X01–X23/Y01–Y23 (67) and RT01–RT10 (10) pass; isolated clusters stopped. Orderly staging restart and public GET/Gateway health verified. See docs/ticket-staging-diagnosis.md and source-bound reports. | Signed live destination retry, authorized recheck of retained welcome notices, ordinary-member visibility and subsequent private-browser case/export acceptance. Production gates remain open. |
| Persistent ticket-link direct messages (P06, P17, P19) | One durable static-link DM per verified ordinary ticket opener, current membership/presence/channel checks, exact one-to-one recipient binding, no content forwarding or incoming-DM/AI path; ephemeral fallback. Migration 032 retains nonce/possible-send/receipt state; blocked DMs finish without closing tickets and lost responses never blindly repeat. | 28 focused tests, DM01–DM10, 67 intake/recovery scenarios and RT01–RT10. See docs/ticket-direct-notices.md and source-bound reports. Live staging: two static-link DMs accepted with verified receipts and completed jobs; no message history or case content inspected. See docs/evidence/ticket-direct-notices-live.json. | Owner DM visibility confirmation, retained welcome-notice recheck, private-browser case/export acceptance and existing production/recovery gates. |
| Single-sheet human release verification and corrected blocker reporting (P00, P27, P29, P30) | Consolidated owner decisions, human test procedures, expected evidence, source mappings and all unfinished task prerequisites. Corrected stale preflight claims about absent live staging. Optional knowledge/AI tracks and post-approval production execution remain distinct. | Catalogue and requirement completeness checks; workbook formula guards, visual/export verification; production preflight exit 2. See docs/human-release-verification.md. | Human evidence collection and implementation of independent recovery/backup, native service packaging, attachment operations and remaining Staff workflows. No production gate passed. |
| Encrypted consistent backups and isolated restore quarantine (P06, P26, P27) | Encrypted PostgreSQL snapshot/retained-file bundles, isolated restore CLI, exact metadata/hash verification and persistent runtime quarantine are implemented and exercised locally. Independent latest control history/replay, off-host custody/retention, active-vault remapping, activation and rollback remain open. | Seven focused file/configuration checks, RB01–RB10 with actual pg_dump/pg_restore and CLI, RT01–RT10; clusters stopped. See docs/recovery-bundles.md and source-bound reports. | No independent latest control watermark or off-host destination. No live backup, runtime rollout, T39/T58 release pass or production approval. |
| Transaction-bound recovery control history and format-2 restoration (P06, P26, P27) | Encrypted consistent snapshot/file bundles and quarantined restore are verified locally. Migration 033 adds transaction-bound control metadata and format-2 restored-history verification. Independent durability/latest-state verification, replay, off-host custody, activation and rollback remain open. | RC01–RC09, RB01–RB10 and RT01–RT10 on synthetic PostgreSQL. Migration repeatability, rollback, Whitelist loss, closed projections, owner-only ledger privileges, disabled trigger rejection and late lower-ID commits are checked. See docs/recovery-controls.md. | Independent durability, latest-state witness, safe replay/activation and owner off-host/retention inputs. No live migration or full T58/G5 approval. |
| Restricted Staff notes and browser workflow (P08, P17, P19) | Restricted human-authored Staff notes: attributed durable append receipts, current responder authorization, Head Admin isolation, plain-text browser history, exact uncertain-save retry and privacy clearing; excluded from member transcripts and control metadata, retained by encrypted core backup. | 12 focused tests, CN01–CN08, RB01–RB10 and RT01–RT10; synthetic Chromium workflow and 390px layout. See docs/staff-notes.md and source-bound reports. | Live independent Staff/member acceptance and deployment, remaining dashboard/reply/tag/priority workflows, file-download policy and independent production recovery gates. |
| Manual case tags and priorities (P08, P11, P17) | Human-written case tags and manual priorities share a current-responder use case across signed Discord and authenticated dashboard routes, with retained attribution, optimistic case versions, exact retries, private history and no changes to permissions or delivery order. | 12 focused tests, 23 Staff/label integration scenarios, 10 actual recovery scenarios and 10 composed runtime scenarios; synthetic Chromium workflow. See docs/case-labels.md and source-bound reports. | Isolated staging migration/command registration and live client acceptance, human replies, curated responses, other command/API parity and production/recovery gates. |
| Dashboard case management (P08, P11, P17) | Dashboard Staff queue and main-channel lookup, reviewed assignment, close/reopen and participant changes share existing current-authorized core services, optimistic versions, retained audit/outbox and actor-bound exact receipts. Browser confirmation, uncertain retry and privacy clearing are verified offline. | 8 focused tests, 58 lifecycle/Staff/participant/management scenarios, RT01–RT10 and synthetic Chromium checks. See docs/case-management.md and source-bound reports. | Live deployment and independent multi-account acceptance, initial Staff-contact dashboard creation, human replies, curated responses, remaining Shuttle/moderation parity and production/recovery gates. |
| Staff-contact dashboard entry (P08, P11, P17) | Staff-contact dashboard entry shares selection, audience confirmation, blank pinned forms, retained submission and verified creator navigation with Discord. Current authority, purpose-bound receipts, exact retries and privacy clearing are verified offline. | 9 focused tests, SC01–SC23/CE01–CE07 and RT01–RT10; synthetic Chromium confirmation, exact retry, literal answers, narrow layout and denial clearing. See docs/contact-entry-dashboard.md. | Live deployment and multi-account acceptance, recipient browser navigation, human replies, curated responses, other route parity and production/recovery gates. |
| Recipient contact dashboard navigation (P08, P11, P17) | Recipient dashboard discovery and verified destination links share the Discord contact navigation flow. Current invitation/membership checks, private metadata-only pagination, closed/read-only and preparing states, late-revocation denial and browser privacy clearing are verified offline. | 7 focused checks, SC01–SC23/RN01–RN08 and RT01–RT10; synthetic Chromium pagination, destination states, focus, narrow layout and denial clearing. See docs/contact-recipient-dashboard.md. | Live deployment and independent multi-account/client acceptance, human replies, curated responses, controlled file downloads, remaining shared routes and production/recovery gates. |
| Inactive human-reply delivery prerequisite (P17) | Inactive human-reply renderer and private-message adapter: attributed bounded human text, mention suppression, current exact-channel proofs and narrow known-own-message withdrawal. Twenty-two focused synthetic checks pass; durable requests, authorization, worker and human controls are not yet implemented. | 22 focused tests: tests/case-reply-messages.test.js, case-intake-delivery.test.js, shuttle-alerts.test.js and shuttle-screens.test.js. See docs/case-replies.md. | Durable requests/audit, current Staff grants, atomic outbox, ambiguous-send recovery and known-late compensation, shared command/dashboard controls, live acceptance and production gates. |
| Durable human replies and authenticated delivery API (P06, P11, P17) | Migration 036 retains human reply requests and audit with current Staff/version/audience checks, atomic metadata-only outbox intent, bounded exact retries, confirmed delivery and sticky known-message withdrawal. Authenticated HTTP confirmation/history, corruption rejection, ambiguous-send/late-lease handling, actual encrypted retention and runtime capture are verified offline. | 22 focused message checks, CR01–CR27, 67 B/X/Y intake/recovery scenarios, RB01–RB10 and RT01–RT10; all owned test clusters stopped. See docs/case-replies.md. | Browser and Discord reply controls, operator recovery UI, independent live privacy/attribution checks and all production/off-host recovery gates. Live staging stays on 032. |
| Staff reply dashboard review and retained history (P06, P17) | Staff reply dashboard shares the retained reply API: literal text/case review, explicit confirmation, current access/version refresh, exact uncertain-submit retry, delivery history and private-data clearing. Twelve focused checks and synthetic Chromium interaction pass; no live deployment. | 12 controller/API/asset checks; authored synthetic Chromium review, focus, paging, exact retry, status and access-loss clearing. Temporary tab closed and preview stopped. Prior backend suites not rerun. See docs/evidence/replies-browser-verification.json. | Discord reply and operator controls, independent live multi-account/client acceptance and production/off-host recovery gates. Staging remains on 032. |
| Confirmed Discord human replies through the shared service (P06, P17) | Discord /ticket reply requires reviewed case/version, bounded human text and explicit confirmation. Signed text is a one-use core-only value, never routing/receipt data; shared reply service and worker enforce current authorization, stable redelivery identity and truthful outcomes. Fourteen focused command checks, thirteen intake/contact regressions, CR01–CR29 and RT01–RT10 pass offline. | 14 command/verifier/receiver/response checks plus 13 intake/contact regressions; CR01–CR29 and RT01–RT10. Both owned database clusters stopped. See docs/evidence/replies-command-verification.json. | Operator reply recovery, curated answers and other shared routes, independent live client/privacy checks and production/off-host recovery gates. No live command registration or upgrade; staging stays on 032. |
| Audited operator recovery for parked human replies (P06, P17) | Parked human replies share the bounded signed /ticket issues queue, audited revision-checked Recheck and verified own-message adoption. Unknown sends cannot be blindly retried; normal workers confirm exact text/current original authority or withdraw. Migration 037 backfills issue metadata without resetting attempts or send state. Fourteen focused checks, CR01–CR36, 67 intake/recovery scenarios and RT01–RT10 pass offline. | 14 issue/adapter checks; CR01–CR36, 67 B/X/Y intake/recovery scenarios and RT01–RT10 with stopped isolated clusters. Repository check: 345 source files. See docs/evidence/replies-recovery-verification.json. | Curated answers, remaining shared routes and independent client/privacy/failure acceptance; off-host recovery and production gates remain open. No live upgrade; staging stays on 032. Encrypted restore not rerun for metadata-only migration 037. |
| Reviewed curated public-answer service and API (P17, P18) | Curated public-answer service and authenticated API: exact review/public-source attestation, optional default-denied publication capability, current member lookup, immutable publication/withdrawal receipts, bounded pages/capacity and no ticket import or send path. Seven focused checks, CA01–CA13 including encrypted restore, and RT01–RT11 pass offline. | Seven focused contract/authorization checks; CA01–CA13 and RT01–RT11 with stopped isolated clusters. CA13 compares actual encrypted restored publication/withdrawal records. Repository check: 350 source files. See docs/evidence/answers-api-verification.json. | Browser editor, Discord lookup and confirmed case-reply selection; static rules and independent live acceptance. No capability grant or migration deployed; staging stays on 032, source schema 038. Off-host recovery and production gates remain open. |
| Reviewed public-answer browser and member lookup (P17, P18) | Public-answer browser uses shared current-authority APIs for member lookup, literal editorial review, public-source confirmation, publication and withdrawal. Unsaved switching protection, changed-revision comparison, exact uncertain retry, bounded history and private-data clearing are verified by 25 focused tests and synthetic Chromium. RT01–RT11 pass offline. | 25 focused browser/transport/asset regressions and RT01–RT11. Synthetic Chromium checks literal markup, review focus, lost-response receipt retry, withdrawal/history paging and editor-loss DOM clearing with member lookup. Preview and isolated cluster stopped; repository check covers 355 source files. See docs/evidence/answers-browser-verification.json. | Direct Discord lookup and confirmed reply selection, static chat rules and independent mobile/accessibility/live acceptance. No deployment; staging remains 032, source schema 038. CA01–CA13 not rerun for browser work; production/off-host recovery gates stay open. |
| Discord lookup of approved public answers (P17, P18) | Signed Discord /answer list and /answer show share the curated public library with current member authorization at response time. Full approved text/source/revision, bounded pagination, withdrawal and departure are verified. Eighteen focused command/registration/reply checks, eight bootstrap checks and RT01–RT11 pass offline. | 18 focused command/registration/reply checks, eight bootstrap checks and RT01–RT11 pass. Runtime uses signed HTTP, current ordinary-member authorization, real isolated PostgreSQL and simulated Discord. Cluster stopped. See docs/evidence/answers-command-verification.json. | Confirmed case-reply answer selection, static rules, remaining parity, independent client/mobile/accessibility acceptance and production recovery. No live registration or upgrade; staging remains 032 and source schema 038. Full suites and CA01–CA13 were not rerun. |
| Confirmed public-answer selection into case replies (P17, P18) | Approved public answers can be selected explicitly in the case-reply browser and shared confirmed API. Migration 039 retains source name/revision/hash and exact text. Atomic publication checks reject stale new selections; exact prior receipts survive withdrawal without duplicating replies. Current case authority, final revocation, source races, migration preservation, encrypted restore and browser privacy/retry are verified offline. | 27 focused checks; CR01–CR43, CA01–CA13, 67 intake/recovery scenarios and RT01–RT11 pass in stopped isolated clusters. CR43 verifies encrypted restore of selected replies and withdrawn source history. Synthetic Chromium verifies read-only literal selection, focus/confirmation, exact retry after withdrawal, provenance and access-loss clearing. See docs/evidence/reply-answer-verification.json. | Direct Discord selection, remaining parity/static rules, file operations, off-host recovery and independent human acceptance. No live upgrade; staging schema 032, source schema 039. Full suites and broad recovery suite not rerun; the new selected-reply restore is verified separately. |
| Discord approved-answer review and confirmation (P17, P18) | Discord /ticket answer provides full approved-text review and explicit Confirm/Cancel through the shared reply transaction. Migration 040 retains author-bound metadata and source identity. Ten-minute expiry, five-review capacity, current grant/case/audience/publication checks, concurrent clicks, lost-commit exact retry and encrypted restore are verified offline. | 23 focused checks; CR01–CR52, CA01–CA13, 67 intake/recovery scenarios and RT01–RT11 pass in stopped isolated clusters. CR43 restores pending/cancelled/submitted reviews and retained source/reply history. Signed runtime controls verify cancellation, ownership and exact retry after withdrawal. See docs/evidence/answer-review-verification.json. | Static rules, remaining parity, file operations, off-host recovery and independent human acceptance. No live upgrade or registration; staging schema 032, source schema 040. Full suites and broad recovery suite not rerun; review-inclusive encrypted restore has separate CR43 evidence. |
| Reviewed static automation policy and dry-run API (P18) | Static automation configuration/API retains reviewed public policies and withdrawals under optional default-denied publisher authority. Bounded literal message/reaction rules, explicit channels, priority/stop and synthetic per-user/channel cooldown timelines share one pure policy. Current channel metadata and retained case exclusions gate review/publication; previews never store sample text or send. Migration 041, concurrency, revocation rollback, exact lost-commit retry and encrypted restore are verified offline. | 25 focused tests, AP01–AP15 and RT01–RT12 pass in stopped isolated clusters. AP14 verifies encrypted restore of published/withdrawn policy and author receipts. Current channel exclusion, concurrency, CSRF, late revocation and lost-commit exact retry are covered. See docs/evidence/automation-policy-verification.json. | Gateway ingestion, durable cooldowns, live delivery/reconciliation, automation browser, independent T45 and remaining production gates. Publishing does not activate automation. No live upgrade or grant; staging 032, source 041. Full suites unrun; other suites only received current-migration-count adjustments. |
| Durable Gateway automation admission (P18) | Explicitly enabled Gateway admission uses opaque transient message proofs, current channel/case exclusions and the reviewed literal rules. Cursor, metadata-only receipts, stable rule-ID cooldowns, approved-action references and bounded outbox jobs commit together. Migration 042 retains activation mode and admission state. Replay, capacity, rollback, fresh-service lost-commit recovery, encrypted restore and independent case capture are verified offline. | 35 focused tests; AA01–AA15/G01–G17 (32), AP01–AP15, RT01–RT13, 52 reply and 67 intake/recovery scenarios pass in five stopped isolated clusters. AA13 encrypted restore and AA14 lost cursor-COMMIT/fresh-service replay preserve one admission. RT13 separates public automation from private case capture. See docs/evidence/automation-ingress-verification.json. | No delivery consumer, deadline enforcement, reconciliation/recovery or automation browser yet. Live admission remains off; no deployment. Staging schema 032, source 042. Full suites and independent live acceptance unrun; historical upgrade fixtures were updated and exercised. All production gates remain open. |
| Durable automatic message and reaction delivery (P18) | Queued static messages and reactions now use current publication, source/channel metadata, human/bot permissions, Gateway continuity and a 60-second deadline. Migration 043 retains possible-send state, positive receipts, sticky compensation and metadata audit. Unknown creates park without repeats; late receipts, lost commits, idempotent removal, encrypted restore and composed runtime delivery are verified offline. | 39 focused checks and 203 integration scenarios pass across six stopped isolated clusters. AD01–AD24 include encrypted restore, late receipts, lost commits and idempotent withdrawal. RT13 composes Gateway admission and actual delivery while case capture stays separate. No live deployment or independent human pass. See docs/evidence/automation-worker-verification.json. | Operator recovery and automation browser remain open. No live activation/upgrade; staging 032, source 043. Full suites and independent live acceptance unrun. All production gates remain open. |
| Current-authorized automation operator recovery (P18) | Current-authorized automation recovery now provides bounded metadata queue/history and confirmed recheck/verified-effect adoption through authenticated APIs. Migration 044 retains operator request receipts and linked audit. Stale/concurrent controls, exact lost-commit replay, no absent-effect resend, preserved cooldown/pause/quarantine, revocation rollback, encrypted restore and composed runtime recovery are verified offline. | 45 focused checks and 175 integration scenarios pass across five stopped isolated clusters. AR01–AR19 include current authority, stale/concurrent controls, lost commits, atomic audit and encrypted restore. RT13 composes OAuth-authorized recovery of an uncertain automatic effect. No live deployment or independent human pass. See docs/evidence/automation-operator-verification.json. | The reviewed configuration/recovery browser and independent acceptance remain open. No live activation/upgrade; staging 032, source 044. Full suites and production qualification unrun. All production gates remain open. |
| Owner follow-up: adaptive Shuttle and custom capability roles (P03, P05, P08, P11, P13, P14, P26) | Owner-approved 1–20-step Shuttle authoring: add, reorder, confirmed removal, stable identities, bounded total text, immutable publications and pinned active runs. Completion and Discord controls derive from each retained version; 58 focused checks, 54 database scenarios and synthetic mobile/browser interaction pass. Independent configured capability role lists remove the two-role restriction; backup and closure decisions recorded. | 71 focused checks (13 permissions/runtime and 58 Shuttle/editor) plus 71 integration scenarios (17 authorization and 54 Shuttle) pass. Both successful isolated clusters stopped; an initial failed fixture cluster also stopped. Synthetic browser verified step changes, confirmation/publication, mobile reflow and clearing. No live upgrade or human release pass. See docs/evidence/adaptive-shuttle-verification.json and docs/evidence/authorization-verification.json. | Full permissions editor/responder customization, owner-authored copy and staged qualification, automation browser, controlled files and independent recovery. No production release gate is complete. |
| Reviewed permissions deployment candidates and per-type responders (P03, P05, P08, P11, P15, P26) | Reviewed /permissions editor: current role/category selection, independent permissions.publish authority, retained drafts/candidates/withdrawals, running/proposed review, self-lockout protection, exact uncertain retries and access-loss clearing. Optional per-case-type responder maps agree across authorization, queues, Discord ACLs and deterministic notifications; Head Admin privacy and owned membership roles remain protected. | 52 focused checks; PC01–PC12 plus A01–A17 (29) and RT01–RT13 (13), 42 isolated scenarios. All clusters stopped. Synthetic browser verifies saved review/confirmation, withdrawal, uncertain retry, literal role names, 390x844 reflow and access-loss DOM clearing. See docs/evidence/permission-editor-verification.json. | Activation/reconciliation of retained case channels for changed policy versions, live mapping selection, staging 032-to-045 qualification and independent member/client acceptance remain open. Candidates do not apply themselves. Membership-role migration, automation browser and all production gates remain open. |
| Reviewed automation configuration and recovery browser (P08, P18) | Automation browser at /automation uses the shared pure policy and authenticated APIs for literal rule editing, reviewed publication/withdrawal, synthetic preview, retained history and metadata recovery. Exact uncertain retries, changed-state review invalidation and access/visibility clearing are implemented; unknown sends cannot be rechecked or blindly repeated. | 42 focused checks and AR01–AR20 pass; isolated cluster stopped. Synthetic browser publication/withdrawal, uncertain retry, preview, recovery controls, mobile reflow and revocation clearing inspected. See docs/evidence/automation-browser-verification.json. | No live activation or staging upgrade; schema 032 preservation and upgrade qualification precede private owner testing. Independent T45 and all production gates remain open. |
| Exact historical staging preservation and upgrade qualification (P06, P26, P27) | Exact schema-032 preservation mode verifies immutable migration hashes, records absent control history explicitly and encrypts the snapshot and retained files. Historical restore remains quarantined. Synthetic 033–045 upgrade preserves all historical columns and installs current restricted runtime grants. | 10 focused checks, RB01–RB10/SU01–SU05 (15) and RT01–RT13 pass in stopped isolated clusters. Reports: docs/evidence/staging-upgrade-verification.json and docs/evidence/staging-verification.json. Initial historical-fixture timestamp/singleton/FK ordering issues were corrected without disabling constraints. | Live preservation/upgrade, independent latest control history and backup custody, changed-policy activation and human acceptance remain open. |
| Preserved isolated staging upgrade to schema 045 (P06, P08, P26, P27, P29) | Pinned de8b32b staging build, encrypted pre/post-upgrade copies under D:/Backups, verified historical restore into quarantine, unchanged old-column fingerprints and runtime policy configuration, strict current grants and Gateway/public readiness. No new publisher grant or automation activation. | 45 migration hashes and 69 table grants pass; 54 original table fingerprints preserved. Public pages 200 with CSP/no-store, anonymous session 403, unsigned Discord request 401. See docs/evidence/staging-upgrade-live.json. | Private owner journey tests, permission-candidate activation and optional publisher grant approval, command registration parity, independent latest recovery history/key custody and all production gates. Rollback database/configuration compatibility verified; rollback live start unrun. |
| Candidate-bound permission deployment assessment (P03, P05, P08, P15) | Single-statement control-metadata inventory and exact candidate-bound review hash; current authority on entry/return, invalid candidate/base/selection rejection, aggregate blockers and saved-draft preparation view. No policy registration, case modification or outbox effect. | 10 focused checks and PC01–PC18/A01–A17 (35 isolated scenarios). Source-bound results in docs/evidence/permission-deployment-verification.json. No new owner test requested. | Durable activation receipts, exclusive writer fencing, current Discord inventory, verified sealing before replacement, retained open/closed/sealed reconciliation and forward-version rollback. No staging deployment or permission activation. |
| Durable permission-maintenance preparation barrier (P03, P05, P06, P15, P26) | Owner-only candidate/review-bound entry with monotonic generations, active-lease refusal, durable hold and unchanged-preparation cancellation. Statement guards fence every restricted runtime DML transaction, including stale repeatable-read snapshots. Core sees only availability; composed host latches disabled after observing maintenance. Additive schema 047 and guarded startup verification. | 11 focused checks and 73 isolated scenarios (42 permissions/authorization, 14 composed runtime, 17 recovery/upgrade). All owned clusters stopped. Initial fixture FK reset and retained JSON object-order issues corrected; candidate comparison now canonical. See docs/evidence/permission-maintenance-verification.json. | Current Discord metadata inventory, durable effect phases, uncertain-effect resolution, verified sealing and policy replacement, eligibility reconciliation and forward-version rollback. No public activation/cancellation route or live CLI. Before an authorized 047 upgrade, preserve/restore-verify live 046 with pinned 046 tooling. Owner acceptance and production release remain open. |
| Retained permission channel inventory (P03, P05, P06, P11, P15, P26) | Core-only current role/channel metadata projection and retained owner-only inventory revisions. Classification distinguishes missing, moved, mismatched, discovered and orphaned channels, unavailable selections and exact versus stale duplicate choices. Names/arbitrary topics and all case-content sources are excluded. No adoption, permission mutation or activation follows from inventory. | 17 focused checks and 70 isolated scenarios: permissions/maintenance/inventory/authorization (52), recovery/upgrade (18), all owned clusters stopped. Exact retries, cancellation/control-state races, proof copying/expiry, withheld identities in aggregate receipts, corruption, encryption and held-state migration covered. See docs/evidence/permission-inventory-verification.json. | Durable seal plans/effect journal, current bot authority, permanent exclusions for newly confirmed case channels, bot-only sealing, policy replacement, current-eligibility reconciliation and forward-version rollback. No browser/live CLI activation surface or live deployment. Current source backup validation expects 048; preserve live 046 with pinned tooling before a separately authorized upgrade. |
| Durable permission channel sealing (P03, P05, P06, P11, P15, P26) | Owner-only reviewed inventory confirmation, atomic plan/exclusion retention, fixed bot-only adapter and durable per-channel effect phases. Fresh identity/bot checks precede dispatch; started and uncertain effects are never blindly resent. Read-only verification retains uncertainty; whole-inventory completion detects missing, reopened or newly appearing channels. The maintenance barrier remains held and policies/desired case access remain unchanged. | 21 focused checks and 82 isolated scenarios (63 permissions/authorization, 19 recovery/upgrade), all owned clusters stopped. Lost plan/start commits, concurrent dispatch, lost responses, false success, drift, discovered-channel exclusions, corruption and encrypted restore covered. An initial suite teardown left the synthetic barrier held before authorization tests; fixture teardown was corrected and the complete selected suites passed. See docs/evidence/permission-sealing-verification.json. | Policy replacement, adoption/capture reconciliation, current eligible audiences, reviewed resolution of unresolved effects, forward-version rollback and operational activation surface. No live deployment. Source backup validation expects 049; preserve live 046 with pinned tooling before a separately authorized upgrade. |
| Held permission policy application (P03, P05, P06, P11, P15, P26) | Confirmed owner-only application reobserves inventory/seals, rejects unsettled control work and commits new immutable policies, actor epochs, case version/audience bindings, confirmed channel/capture adoption and reconciliation jobs together. Member/presence epochs, invitations, original desired case access and historical policies are preserved. Journaled secret-free base sections make interrupted applications reviewable with either configuration. Maintenance entry records capture downtime; no runtime release API. | 21 focused checks and 94 isolated scenarios: 74 permissions/authorization and 20 recovery/upgrade. Exact retry, stale controls/ACLs, expiration rollback, capability-only behavior, old-grant denial, discovered duplicates, current-eligibility worker compatibility, capture downtime, encrypted recovery and 049 preservation verified. See docs/evidence/permission-policy-application-verification.json. | Operational owner-only reconciliation coordinator, fresh completion/lockout checks, compatible runtime configuration handoff and forward-version rollback. Reviewed resolution of old uncertain effects and missing/conflicting identities; no live deployment or human acceptance. Source schema050 requires compatible backup/runtime tooling; preserve live046 with pinned tools before any separately authorized upgrade. |
| Shuttle minimum-product human-test checkpoint (P05, P08, P13, P14, P27) | Owner priority and stopping condition updated. Existing pinned Shuttle source, public shell/assets, anonymous-session denial and redacted process/status metadata inspected. Concrete private editor/screen/progression/role/privacy/help test prepared in the handoff. No runtime or deployment change. | Eleven selected staged sources match pinned2b984d2 and the source-bound feedback report. Four public GET checks pass; rendered application HTML is unchanged apart from an edge challenge insertion. Host/connector processes observed alive; status reports current. See docs/evidence/shuttle-mvp-readiness.json. | Owner private browser and ordinary-member Discord test is now required. Stop the current goal at this explicit boundary. Production membership/revocation/privacy, recovery, final configuration/content and operator approval gates remain open; broader administration backlog is preserved. |
| Persistent Onboarding journey and shared system wording (P05, P08, P13, P14, P27) | One editable Discord anchor across page turns and completion, silent successful controls, legacy recovery, shared publisher-authorized wording editor with pinned in-flight revisions, and Onboarding implementation names with protocol compatibility. | 406 unit tests; 88 Onboarding/wording, 67 intake, 20 recovery/upgrade and 14 composed runtime scenarios; ten synthetic browser checks. Source-bound reports in docs/evidence/onboarding-experience-verification.json. All owned clusters stopped. | Private Discord/browser retest after the completed schema053 staging upgrade and restart verification. Existing live entry-navigation symptom needs confirmation. Production privacy, role, recovery, final content/mappings and operational gates remain open. |
| System wording OAuth return-path forward repair (P05, P08) | Add the System wording route to the database OAuth return-path allowlist, retaining all original routes and checks. | O01–O19 and RT01–RT14 pass:33 isolated scenarios including a complete synthetic sign-in returning to /localizations and authenticated wording APIs. Owned clusters stopped; see docs/evidence/onboarding-wording-return-verification.json. | Private owner sign-in/session and wording retest; schema053 staging restart and public login-start check are complete. No production acceptance. |
| Onboarding upgrade state reconciled for continuation (P05, P08, P13, P14, P27) | Full handoff updated with completed046→052→053 preservation/migrations, selected036476f archive, remaining verification and owner test, durable authorization, code pointers, operational receipts and deferred release gates. | 27 September read-only check: 754 archive hashes match; selected launcher verified; recorded host/connector PIDs absent; no 38121–38123 listeners; dedicated pg_ctl status 3; three public endpoints return HTTP 530. The20September receipt records 53 migrations, 70 retained-table fingerprints and 70 restricted runtime table checks. | Historical offline handoff checkpoint; the subsequent restart is recorded below. Private owner retest and production gates remain open. |
| Schema053 staging restart and public verification (P05, P08, P13, P14, P27) | Restarted the existing pinned 036476f host, dedicated database and connector under retained authorization, using fresh hidden-process logs. No migrations, configuration/grant changes, candidate activation or bootstrap. | 27 September: 754 archive hashes and unchanged launcher verified; fresh current Gateway, matching host/connector ownership and loopback ports, dedicated pg_ctl status 0; all 12 public HTTPS checks pass, including exact wording asset hash and System wording OAuth-start redirect. See docs/evidence/onboarding-experience-live.json. Prior upgrade/preservation results remain separately dated historical evidence. | Stop for the owner private browser/ordinary-member Onboarding test in docs/handoff.md. No application suites rerun, real login, human acceptance or production approval. |
| Onboarding channel lifecycle, entry panel and login boundary (P05, P08, P13, P14, P27) | Schema054 adds channel activity/retirement and retained previous case bindings. Fresh unknown-channel proof allows safe destination replacement. Versioned state and grant cancellation protect manual/automatic removal. Staff /shuttle close and publisher /shuttle panel use current authority; panel copy is in System wording. Login precedes dashboard HTML and preserves allowlisted return pages. | 45 unit checks; OC01–OC13 isolated lifecycle scenarios; 88 existing Onboarding/wording scenarios. See docs/onboarding-followup.md and source-bound reports. Schema053 original columns preserved by synthetic forward migration. Owner reports prior tests1–4 passed; wording5 untested. RT01–RT16 composed runtime scenarios also pass, including actual signed public panel and private closure responses, synthetic OAuth and gated dashboard HTML. All owned test clusters stopped. | The subsequent authorized 054 deployment/command rename is complete; private recovery/cleanup/panel/login/wording retest and full production release gates remain open. |
| Whitelist command rename and authorized schema054 staging upgrade (P05, P08, P13, P14, P27) | Public /whitelist replaces /shuttle in registration, signed ingress and new default instructions. Existing command ID and internal session/control identifiers remain stable. Preserved schema053, verified quarantined restore, migrated054, pinned9479c2c, renamed guild command and restarted owned host/connector. | Renamed candidate: 27 focused unit checks, 88 Onboarding/wording, 13 lifecycle and 16 runtime scenarios passed; owned test clusters stopped. Live schema053 encrypted preservation/quarantined restore, 70 unchanged table fingerprints, 54 migrations/70 runtime table checks and current encrypted backup passed. All 765 archive hashes, fresh Gateway, process/port ownership and 24 public HTTPS checks passed. See docs/evidence/onboarding-followup-live.json. No new human acceptance or production pass. | Private account retry and actual client/timing acceptance. Independent recovery and production release gates remain open. |
| Whitelist arrival, permitted navigation and Meridian-informed editor (P05, P08, P13, P14, P27) | Local next-test feedback: verified arrival before one Begin Whitelist link, default one-hour closure notice, permission-filtered HTML with one-use session bootstrap and renewal, and Meridian-informed responsive presentation. 45 focused unit checks, 88 Onboarding/wording, 18 authorization and 16 runtime scenarios pass; synthetic desktop/mobile editing and quiet mode checked. See docs/whitelist-test-feedback.md. Subsequently deployed with owner authorization on pinned036c3db/schema054; 768 Git hashes, orderly shutdown, current Gateway, process/port ownership and 26 public checks passed. No migration, configuration, command or grant changes. Private client acceptance remains open. | docs/evidence/whitelist-test-feedback-verification.json; owned synthetic clusters/preview servers stopped. Current authority and no-AI boundaries remain intact. Authorized live replacement: docs/evidence/whitelist-test-feedback-live.json; 26 public checks, 54 migration and 70 runtime table checks pass. | Private Discord/browser acceptance; custom typography assets/licences and production gates remain open. |
| Website role configuration and durable apply workflow (P03, P05, P08, P11, P15) | Website role/feature configuration and apply workflow implemented locally on schema055. Crew/base, Whitelist, Muzzled, Staff/lead ops, capability grants, responder groups and category routing are editable. Durable apply/status/retry, owner maintenance, role/case reconciliation, restart selection, lockout protection and restore quarantine are verified. 14 focused unit checks and 123 isolated scenarios pass (87 permissions/authorization, 16 runtime, 20 recovery/upgrade). Lead ops only is the owner-selected initial editor grant. Staging remains036c3db/schema054; deploying the new host and schema requires scoped authorization. | docs/permission-configuration.md; docs/evidence/website-configuration-verification.json. Synthetic desktop save/review/approve/apply/status/retry and mobile comparison checked. No dependencies added. | Scoped staging deployment authorization; live private role, Muzzled, Whitelist revocation and case ACL acceptance. Production gates remain open. |
| Authorized schema055 configuration deployment (P03, P05, P08, P11, P15) | Owner-authorized a5e0232/schema055 deployment completed with the configurable host and Lead ops-only permissions.publish at capability version2. 779 Git file hashes verified; encrypted preservation restored in quarantine; migration preserved all 70 existing tables. Current Gateway, process/loopback-port ownership, 32 public HTTPS checks and 55 migration/71 restricted runtime table checks pass. Next: owner private Roles and permissions/apply/ACL acceptance. No production approval. | docs/evidence/website-configuration-live.json; docs/permission-configuration.md. Current encrypted backup completed; independent off-host recovery remains unverified. | Owner private live configuration/apply and role/ACL acceptance; production gates remain open. |
| Local AI participation and control foundation (P23, P24, P25) | Schema056 candidate, five preset policies, isolated AI control state, versioned publications/consent, deadline-aware scheduler/client, metadata-only receipts, transient context and core-owned output. Authenticated dashboard participation/personality/member controls. No live deployment, model inference or added package dependency. | 37 focused unit/adapter checks and 12 isolated PostgreSQL scenarios passed; synthetic dashboard review/publication and opt-in/opt-out passed with no browser console errors. Logs and source-bound evidence under GitHub/.agent_docs/aphelion-sophie. These are offline foundation results, not feature completion. | Actual runtime composition, knowledge, recovery, worker isolation and model qualification, dialogue evaluation and explicit live activation. Personal memory and restricted lanes remain gated; full AI readiness has not been reached. |
| Local AI runtime boundaries and approved public knowledge (P21, P22, P23, P24, P25) | Schema057 stable AI Gateway boundary, optional isolated runtime composition and strict metadata observations; reviewed public knowledge library/editor, source hash checks/withdrawal, attribution, deliberate context trimming and bounded typing. Named local trial approvals recorded. No new npm dependency, deployment or model execution. | 47 focused unit/adapter/auth checks, 35 isolated AI/Gateway/knowledge scenarios including schema056 upgrade, and 17 composed staging scenarios passed. Both clusters stopped. Synthetic knowledge browser review/confirmation/publication/withdrawal passed with no console warnings/errors. Source-bound logs and worker preparation are outside the repository. | Operator restart before the approved synthetic worker trial; actual containment, 15-second end-to-end load evidence, model dialogue/knowledge evaluation, source sync, qualified broker/restore and effect recovery, explicit memory/named restricted domains and live acceptance. This milestone is not full AI readiness. |
| Post-restart local worker startup and exact token counting (P23, P24, P25) | Verified operator restart and built/started the contained candidate. Diagnosed absent MSVCP140/VCRUNTIME140/VCRUNTIME140_1 before model load. Adapter now counts the exact generation request through the pinned runtime endpoint. | Docker boundary inspection and contained DLL-presence check; nine focused scheduler/client checks pass. Pinned Microsoft-signed 14.51.36247.0 package downloaded for review only. Source-bound startup evidence outside the repository. | New non-MIT container-runtime decision; actual inference, model/dialogue/source quality, full-turn latency/load and remaining selected-feature implementation/activation. No live AI or performance pass. |
| Contained local model screens and per-turn output constraints (P23, P24, P25) | Approved container-only Microsoft runtime and Qwen model pins recorded. Actual Phi/Qwen probes completed. Output grammar restricts actions, emoji and citations per turn, removes trimmed evidence IDs and disables thinking; core validation remains independent. | 22 focused runtime/turn checks pass. Network-none Hyper-V probes used synthetic content only; Phi failed timing and Qwen failed truthfulness/conduct despite fast valid JSON. Source-bound logs and prepared-file snapshots are outside the repository. | Historical local-model milestone, superseded by the later Flash selection. Neither local candidate is qualified or a fallback. Current remaining work is in DS-00–11. |
| DeepSeek preparation, accounting and bounded assistant context (P21, P24, P25) | Immutable final-body preparation, exact outbound byte cap, local block diagnostics, usage-before-output accounting, fenced reservations and uncertainty, reviewed USD 20/Vienna spending controls, notice revision gate, confirmed assistant context with dependency expiry and cancellation. | Focused unit and isolated AI storage results, synthetic browser observations and exact source hashes in docs/verification.md and external deepseek-verification.json. No new provider or Discord call. | DS-03 retention and actual transport/rollover qualification; DS-04 worker; DS-06 gathering; DS-07 importer/direct lookup; DS-08 explicit memory; DS-09 durable effects; all real-data/release gates. |
| Member direct lookup independent of inference (P21, P22) | Authenticated Public answers search returns up to four current published extracts with source links, authority, revision and attribution. No model, conversational consent, editorial authority or AI control store is required. | 34 focused turn/lookup/dashboard checks, 18 isolated composed staging scenarios and synthetic browser search/empty-state checks; exact source-bound report outside the repository. | Approve actual wiki endpoint, collection/rights and extractor; importer/sync/template invalidation, Discord /lookup and actual reviewed-source qualification remain. |
| Policies collection and bounded extraction (P20, P21) | Owner-selected Policies page and discovered MediaWiki API; anonymous bounded one-page collection with template metadata, rendered hashes and race checks. Approved parse5/entities dependency scope, isolated structured extraction and local immutable unreviewed artifacts. No publication or live schedule. | 14 focused checks; actual page 878/revision 14796, 52 template metadata dependencies, 174 headings and 25 tables/257 rows extracted locally. Exact external report; no human publication or release pass. | Durable snapshot/import store, review-to-publication integration and immediate template/deletion invalidation; Discord /lookup; separate Discord rules publication; reviewed knowledge launch qualification. |
| Durable Policies imports and source-bound publication review (P20, P21) | Durable Policies snapshots, fenced manual refresh, source-bound review/publication and dashboard structured review implemented; service deployment and unattended synchronization incomplete | 38 focused checks, 51 isolated AI/knowledge/accounting scenarios and synthetic browser review; no live publication or deployment | Qualified knowledge-service composition and unattended refresh; Discord /lookup; reviewed wiki extracts and separate Discord rules publication; 40-question knowledge acceptance and live qualification. |
| Authenticated worker-stream foundation (P23, P24) | Authenticated bounded private-stream broker/worker foundation implemented; native service/transport and OS qualification incomplete | 40 focused IPC/adapter/scheduler checks using synthetic loopback streams and mocked provider transport; not OS/process isolation or end-to-end release evidence | Provision and qualify the exact private transport and Windows identity/ACL/egress profile, provider-only credential custody, worker-local HTTP pool and AI-only process replacement. Qualify Node maintenance separately; no service listener or production connector is installed. |
| Durable AI effects and conservative IPC settlement (P23, P24) | Durable bounded own-effect receipts, deterministic automation precedence and known-effect restart/revocation cleanup implemented | 25 focused turn/observation checks; 55 isolated AI/knowledge/Gateway scenarios; 18 composed staging scenarios. Synthetic effects only. 13 IPC checks pass after accounting correction. | Active worker revisions and AI-only apply/replacement; actual Discord effect/recovery and Windows qualification remain open. |
| Bounded gathering and channel fairness (P23, P24) | Fenced three-fragment gathering, first-receipt deadline, ingress flood limit and fair bounded channel scheduler implemented | 40 focused runtime/turn/observation checks and 56 isolated AI/knowledge/Gateway scenarios; no actual provider or Discord timing | Gathered edits currently cancel the turn; replacing an edited fragment before freeze remains to implement. Qualify actual one-versus-two workers and end-to-end latency before increasing runtime concurrency from one. |
| Explicit local response preferences (P23, P24) | Local member-saved reply length and language preferences with self inspection, replacement, export action, deletion and 90-day expiry; independent restore watermark fails closed | 28 focused unit checks, 62 isolated AI/knowledge scenarios, 18 composed staging scenarios; synthetic browser save/edit/delete verified | Independent journal identity/location/ACL and restore exclusion require operator qualification. Actual browser download remains unverified. Remote preference use stays disabled pending provider/data clearance; no conversational extraction. |
| Revision-fenced gathering edits (P23, P24) | Fenced three-fragment gathering, first-receipt deadline, ingress flood limit and fair bounded channel scheduler implemented; eligible edited fragments replace their own pre-freeze revision | 43 focused runtime/turn/observation checks and 63 isolated AI/knowledge/Gateway scenarios; no actual provider or Discord timing | Qualify actual one-versus-two workers and end-to-end latency before increasing runtime concurrency from one. |
| Discord direct lookup and unattended Policies refresh (P21, P23) | Shared dashboard and signed Discord direct lookup; fixed Policies importer, human publication review and qualified unattended refresh composition implemented locally | 61 focused checks; 64 isolated AI/knowledge/Gateway scenarios; 18 composed staging scenarios, including Discord lookup with AI unavailable | Deploy and qualify the actual knowledge identity and command registration; review/publish the selected wiki extracts and separate Discord rules; run the 40-question source/answer gate. No source publication or live service is activated. |
| Native worker transport, bounded accounting and source question review (P22, P23, P24) | Authenticated boot-specific Windows named-pipe composition and single-socket worker-owned HTTPS transport implemented and checked locally | 18 IPC/native checks; 65 isolated AI/knowledge/Gateway scenarios; 509 module checks; 40-case historical source review | Actual service identities, ACLs/pipe confidentiality, remote-pipe denial, fixed egress, credential custody, process-tree termination and replacement remain unqualified. AI-only apply/recovery UI and same-LTS runtime candidate qualification remain open; no service installed. |
| AI worker operating controls (P22, P23, P24) | Durable desired/active/acknowledged worker revisions, authenticated AI-only apply/stop/recovery controls and a fenced single-owner lifecycle coordinator | 44 focused checks, 75 isolated AI/knowledge/Gateway scenarios and 19 composed staging scenarios pass; both disposable clusters stopped. Synthetic browser review/apply/stop verified. | Concrete registered Windows lifecycle adapter, actual service identity/ACL/egress/credential and process-tree termination qualification, runtime candidate qualification and activation remain open. Apply keeps message processing disabled. |
| Ephemeral prepared-request diagnostics (P22, P23, P24) | Immutable bounded outbound preparation with per-boot keyed ephemeral block comparison, source-bound expiry/invalidation and authenticated public-channel diagnostic inspection | 77 focused checks, 76 isolated AI/knowledge/Gateway scenarios and 19 composed staging scenarios pass; both disposable clusters stopped. Synthetic browser display and expiry verified. | Current Chat layout remains the control. Actual provider cache observations, reviewed answer quality, latency and Windows containment remain separately unqualified; no cache eviction or dispatch inference from preparation diagnostics. |
| Fixed-destination worker egress (P22, P23, P24) | Authenticated fixed-destination host egress bridge and worker-owned TLS pipe connector, composed with the bounded single-socket HTTPS transport | 36 focused checks pass using actual host-local Windows pipes and synthetic loopback TLS, including authentication/replay, certificate/hostname rejection, address and byte limits, reuse and physical cancellation. Not Hyper-V or production isolation qualification. | Concrete worker package, host/guest inference transport and registered Windows lifecycle supervisor; actual Hyper-V pipe mapping, identities/ACLs/egress/credential and process-tree termination qualification; runtime candidate qualification and activation remain open. |
| Worker source package and host-initiated turns (P22, P23, P24) | Worker-initiated authenticated inference pipes, fixed-path container entrypoint and short-lived signed qualification leases; fixed-destination egress and worker-owned TLS retained | 46 focused checks pass, including actual host-local Windows pipes, metered reverse connections, cancellation and signed lease replay/expiry/stalled-read checks; container executable and OS isolation remain unqualified. | Concrete privileged supervisor and atomic lease/bootstrap writer, runtime distribution qualification, exact identities/ACLs/mounts/credentials and Hyper-V pipe mapping, physical termination and composed OS qualification remain open. |
| Registered container adapter and atomic boot publication (P22, P23, P24) | Worker source package and authenticated reverse pipes, plus a fixed-slot privileged Docker adapter and atomic bootstrap/qualification-lease publication with terminal revocation | 30 focused checks pass using a synthetic loopback Engine API, actual Windows temporary files and existing host-local pipe tests; no actual Docker/Hyper-V or service qualification. | Durable supervisor ownership/recovery journal, authenticated control protocol, separate egress/core composition and service lifecycle adapter remain unfinished. Runtime distribution, image, identities/ACLs/mounts/credentials, Hyper-V pipes and physical termination require actual OS qualification. |
| Supervisor journal and removal-only restart recovery (P22, P23, P24) | Kernel-held Windows supervisor ownership, bounded revisioned on-disk journal and composed container lifecycle with intent-before-effect, removal-only restart recovery and preserved uncertain creates | 44 focused checks pass, including actual Windows files/pipes, abrupt termination of six test-only Node processes and a synthetic Engine HTTP endpoint. No real Docker/Hyper-V or service qualification. | Authenticated supervisor control protocol/client, service entrypoints, core/egress readiness and lease scheduling remain unfinished. Node/image distribution, actual identities/ACLs/mounts/credentials, Hyper-V pipes, physical termination and unresolved-create operator disposition require qualification. |
| Authenticated supervisor control and role-gated worker lifecycle (P22, P23, P24) | Authenticated role-scoped control sessions and revisioned jobs compose core launch/stop, a separate egress observer, purpose-specific boot keys, expiring readiness and signed worker-lease renewal with the durable supervisor | 53 focused checks pass: 21 control/lifecycle scenarios and 32 existing IPC/native/package/architecture checks. Actual host-local Windows pipes and temporary boot files carry one metered synthetic turn through worker-owned TLS to a loopback endpoint. Egress loss revokes authority and confirms synthetic Engine removal; no actual Docker/Hyper-V or live provider qualification. | Fixed service entrypoints and trusted installation/qualification inputs remain unfinished. Node/image distribution, actual identities/ACLs/mounts/credentials, Hyper-V communication, physical termination and unresolved-create operator disposition require qualification. Database-coordinator/installed-service and actual Discord acceptance remain open. |
| Encrypted inference and supervisor control frames (P22, P23, P24) | Mandatory encrypted v2 inference/control frames protect prompt/reply content and purpose-key handoff while preserving fresh peer challenges, bounded accounting and lifecycle control | 66 focused IPC, control, native, worker-package and egress checks pass. Actual host-local Windows pipes and synthetic TLS cover a metered turn; captured traffic excludes plaintext content and grants. Tampering, reflection, cross-profile traffic, replay and valid legacy HMAC frames are rejected. No actual Docker/Hyper-V or live provider qualification. | Fixed service entrypoints and trusted installation/qualification inputs remain unfinished. Node/image distribution and bundled-notice scope, actual service identities and pipe/file ACLs, mounts/credentials, Hyper-V communication, physical termination and unresolved-create operator disposition require qualification. Database-coordinator/installed-service and actual Discord acceptance remain open. |
| Authenticated preference attachment export (P22, P23, P24) | Fixed native browser attachment download shares current self-authorized preference inspection and rejects unavailable or quarantined state | 14 focused checks pass. An actual in-app browser download produced the expected 218-byte synthetic JSON file; contents/hash verified. Late session loss, query selectors and unavailable/quarantined stores reject without an attachment. No database/provider/Discord/live-service change. | Independent journal identity/location/ACL and restore exclusion require operator qualification. Browser attachment download is verified with synthetic data. Remote preference use stays disabled pending provider/data clearance; no conversational extraction. |
| Approved private Node runtime bundle (P22, P23, P24) | Owner approved the exact Node 24.19.0 Windows x64 executable and original bundled notices for private packaging and synthetic qualification | Official archive/executable hashes and valid OpenJS signature verified; original aggregate plus seven supplemental notices retained. Static PE imports inspected. No host runtime replacement, container build, service/ACL change or operational qualification. | Exact Windows pipe creation/client-access adapter and its implementation/toolchain scope remain open, followed by fixed service entrypoints and trusted installation checks. Service identities/ACLs, mounts/credentials, Hyper-V communication, actual Node/image compatibility, physical termination and unresolved-create disposition require qualification. Database-coordinator/installed-service and Discord acceptance remain open. |
| Native pipe primitives and accounting capacity (P22, P23, P24) | Recorded owner C#/.NET approval, implemented protected Windows pipe and explicit-rights client primitives with owned overlapped cancellation; qualified the existing accounting capacity boundary | 10 native checks pass with the actual approved installed compiler/runtime. One isolated PostgreSQL run reaches 200,000 attempts: exactly one of two final-slot reservations succeeds, holds preserve balances, and 500-row retention keeps replay receipts. Cluster stopped. No provider calls or live service/permission changes. | Complete parent/stdio verification, registered role/boot companion protocol, bounded multiplex/credit flow and JavaScript Duplex integration. Qualify final-byte drain, cross-service access denials and the full encrypted transport. Then complete fixed service entrypoints and trusted installation checks. Actual service identities/ACLs, mounts/credentials, Hyper-V mapping, worker-image runtime compatibility, physical termination, unresolved-create disposition and Discord/installed-core acceptance remain open. Provider framing, approved prices, actual transport crash/rollover and installed-service capacity/latency remain unqualified. The single synthetic host capacity run is not an end-to-end timing or production load guarantee. |
| Synthetic Windows companion and encrypted transport (P22, P23, P24) | Original MIT C# companion verifies pinned parent/runtime and protected overlapped stdio, enforces role/boot endpoint registration, bounds multiplexed credit streams, and confirms native closure. A bounded JavaScript Duplex/server adapter is injected at control, inference and egress seams. Synthetic profiles derive only unique test namespaces; installed profiles remain unavailable. | Pinned csc build and three loaded Framework hashes verified. Ten native primitive checks, restricted-token generic-write/instance denial plus explicit-data acceptance, interrupted-frame poisoning, 1 MiB duplex/final-byte flow, stalled-reader cancellation, parent/helper exit, malformed/oversized commands and namespace cleanup passed. Existing encrypted control/inference and worker TLS carried two metered synthetic provider turns; wrong control key rejected. No real provider, database, Discord, container or installed-service changes. | Complete installed role profiles and protected-installation verification, fixed service entrypoints, and the helper/package manifest. The current companion explicitly accepts synthetic profiles only. Actual service identities/ACLs, HCS/Hyper-V proxy mapping, worker-image Framework compatibility, mounts/credentials, operational termination and unresolved-create disposition still require their separate operational trial. Installed-core/database and actual Discord acceptance remain open. |
| Installed Windows profiles and role composition (P22, P23, P24) | Fixed installed profiles validate independent protected owner records, retained file handles, source/runtime manifests, parent/service identities and expiring authority. Core, supervisor, egress and worker payloads compose the native adapter; core isolates database readers and replaces lifecycle ownership on configuration Apply. Worker trust uses a separate read-only mount. Control proof binding now tolerates readiness before native write acknowledgement. | Pinned nine-source x64 helper build; 36 native descriptor/path/profile assertions; 11 companion and four stream PASS groups; six installation configuration checks; three composed scenarios with four actual synthetic companions; 15 isolated PostgreSQL privilege checks with owned cluster stopped; 51 focused repository checks (50 control/supervisor/worker plus new trust-mount regression). No installed-service, container, real provider or Discord qualification. | Authorize the concrete Windows trial and exact SCM wrapper scope in GitHub/.agent_docs/aphelion-sophie/windows-pipe-installation/operational-trial-proposal.md. Actual service tokens, protected-file acceptance, HCS proxy/guest identities and masks, Framework compatibility, mount/credential isolation, physical termination and uncertain-create disposition remain unqualified. Final host SCM packaging, installed-core/database and actual Discord acceptance remain open. Provider/account clearance, preference journal custody and publication/actual-answer gates remain independent. |
| Authorized Windows trial: guest runtime gate (P22, P23, P24) | Owner approved the exact synthetic Windows trial and WinSW bundle scope. The pinned worker source/runtime/helper package built into an actual Windows image; one bounded Hyper-V runtime probe executed. No application source changed. | Host compiler/Framework/Node and WinSW hashes matched. ContainerUser executed approved Node 24.19.0 in a four-CPU/eight-GiB Hyper-V container with network none, no mounts and no published ports. Guest Framework release 528449 differs from the host-pinned 533325; helper startup correctly rejected with PIPE_START_FAILED_1:PIPE_RUNTIME_CHANGED. Owned container removal and absence confirmed. No services, installation root/ACLs or existing data changed. | The approved trial stopped at its first incompatible runtime boundary. Review GitHub/.agent_docs/aphelion-sophie/windows-installation-trial-2026-09-28/runtime-amendment.md for the exact bundled guest Framework 4.8/compiler exception. WinSW and the named service/ACL trial are already approved; do not ask again. After a qualified guest build, resume service tokens, protected files, HCS masks, mount/credential isolation, physical termination and uncertain-create qualification. Provider/account, publication/actual-answer, preference-journal and Discord gates remain open. |
| Pinned guest Framework helper (P22, P23, P24) | Separate compile-time host and Server Core worker runtime pins. Guest helper builds with the exact image-bundled compiler and rejects installed host roles. Host Framework 4.8.1 pins remain unchanged; no runtime fallback or Microsoft binary copying. | Exact guest CLR/assembly/compiler/configuration inventory recorded; GAC and Framework64 System hashes match. Guest build and 36 native assertions pass. Actual ContainerUser Node/helper tests pass 11 boundary groups, four stream groups and both cross-profile rejection checks in bounded network-disabled Hyper-V containers. Host build and stream checks pass. Owned trial containers removed. | Continue the already approved service/file/HCS/mount/termination trial with the guest-specific package. Service tokens, installed protected-file acceptance, exact HCS identity/access, mount/credential isolation and uncertain-create disposition remain unqualified. No further approval is needed for the recorded service/WinSW/guest Framework scope. Stop at any new incompatible OS boundary. Provider, publication/actual-answer, preference-journal and Discord gates remain independent. |
| Windows service trial: shared-ancestor path gate (P22, P23, P24) | Three approved Manual diagnostic services and the new protected ProgramData trial tree are provisioned. Core parent/native-child identity checks pass after requesting TOKEN_DUPLICATE with TOKEN_QUERY for enabled service membership; worker-only checks still request QUERY. No service/process DACL was widened. | Guest-specific and host helper builds pass. Final guest build passes 36 native assertions, 11 boundary groups, four stream groups and two runtime/role rejection checks; host stream checks pass. Actual core service identity passes; protected-root validation then rejects the existing ProgramData Users metadata-write ACE (0x116). Egress/supervisor were installed but not started. All three services are Manual/stopped; no owned trial processes remain. The guest containers were removed. | Review the concrete fixed-root amendment at GitHub/.agent_docs/aphelion-sophie/windows-service-trial/installation-root-amendment.md. It proposes C:\Aphelion\Sophie while preserving the guard, existing shared ACLs and old trial artifacts. Service/WinSW and guest Framework approvals remain valid. Installed file/pipe/HCS, mounts, credential custody, physical termination and uncertain-create gates are not passed. Provider, publication/actual-answer, preference-journal and Discord gates remain independent. |
| Approved fixed root and measured WinSW clean-exit gate (P22, P23, P24) | Approved fixed host root changed to C:\Aphelion\Sophie in native and JavaScript profiles. Created only the new protected parent/tree and repointed the three owned Manual diagnostic services with unchanged identities. Preserved the old ProgramData trial tree and shared ancestor descriptors; no protection rule was relaxed. | Host and guest helpers rebuilt. Actual core service passes parent/child user and service SID, protected-root/own-marker, cross-role read and own-marker write denial, service-SID pipe create/close, and companion readiness/drained stop checks. Guest checks pass 36 native assertions, 11 boundary groups, four stream groups and two cross-profile rejection assertions. Host stream checks and six installation configuration checks pass. WinSW then fails clean-child-exit reporting because it requests full SCM access; the bounded driver stops the wrapper. Egress/supervisor were not started. Three services are Manual/stopped, no owned processes or containers remain. | The fixed-root amendment is implemented. Review the private WinSW clean-exit build amendment at GitHub/.agent_docs/aphelion-sophie/windows-fixed-root-trial/wrapper-amendment.md: one SCM access-mask call-site fix, exact SDK/package inputs and unchanged service permissions. The stock-wrapper qualification is blocked; no patched wrapper has been built or installed. After that gate, continue the already approved egress/supervisor, HCS, mount, credential, physical-termination and uncertain-create checks. Full installed application, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. |
| Patched wrapper qualification and HCS forbidden-open gate (P22, P23, P24) | Owner-approved private WinSW 2.12.0 rebuild changes only the clean-exit SCM open to Connect. Pinned SDK/runtime/packages and required NET461 build metadata used; warnings/analyzers retained. Derived wrapper 9dba15b5cc15f9f51190bc8d35bfeb3f870276fdb53902d1cb7b95dc502f603f installed in the three owned services with unchanged identities and ACLs. Application source and installed guards are unchanged. | All three actual service diagnostics pass identity, protected-marker and pipe creation/close checks, companion drained stop and clean SCM exit. Core/egress deny cross-role, provider, bootstrap and supervisor-state reads. Child exit 7 is preserved; operator stop delivers SIGINT and exits cleanly. Host file fixtures verify held write/rename denial, post-close rename, reparse/owner/inheritance/writable-DACL rejection, and bootstrap unlink with a retained snapshot. A Hyper-V diagnostic preserves both exact pipe DACLs and echoes with 0x00120183/anonymous SQOS. A second probe accepts its first forbidden WRITE_DAC open and stops; no descriptor mutation was attempted. Both containers removed; three services Manual/stopped. | The wrapper gate is passed for synthetic diagnostics. HCS access isolation remains unqualified: a WRITE_DAC open request was accepted, and the associated vmwp primary SID changes by VM and is not proof of the effective opener. Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/diagnostic-amendment.md for bounded disposable-pipe checks under actual core/egress creators and a narrower candidate group DACL. No production descriptor/profile change or owner receipt is approved by those observations. Remaining installed composition, guest mounts/credentials, worker physical termination/uncertain-create, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. |
| Actual-owner HCS diagnostic and descriptor-write denial (P22, P23, P24) | Executed the approved external HCS diagnostic with actual core/egress virtual-account pipe creators and a protected role-owner-full/VM-group-data descriptor. Application source, installed profiles and permissions are unchanged. Source and host/guest executable hashes recorded before probe execution. | Both host role owners/DACLs, Node/native service identities and first-instance guards pass. Separate supervisor restricted-token outsider checks deny data, all forbidden masks and extra server creation. Guest core owner/DACL projection and eight-byte echo pass. A subsequent WRITE_DAC open returns a valid handle on a fresh connection; the one permitted identical-DACL reapply returns Access Denied (5). Host owner/DACL bytes remain unchanged. The trial stops; later guest masks, guest egress/extra-instance checks and the conditional second container are not run. Container/proxy removed; all services exit zero and remain Manual/stopped; XML and permission snapshots restored/unchanged. | HCS isolation remains unqualified because the existing guest forbidden-open gate still fails, despite the separately measured descriptor-write denial. Resolve the Windows/HCS transport contract before proposing further operational diagnostics or application changes; do not weaken assertions, broaden grants, substitute authentication or create an owner receipt. The approved stop condition has been reached and the conditional second-container gate was not met. Installed composition, guest mounts/credentials, worker physical termination/uncertain-create, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. |
| Test-server AI target and handle-rights probe preparation (P22, P23, P24) | Owner selected the Test Discord Server with AI included. Prepared an original external read-only NtQueryObject handle-rights probe and a bounded one-container observation package; no application or deployment change. | Pinned host compilation with warnings as errors passes. Local fresh-pipe controls report data access 0x00120183 and owner-authorized WRITE_DAC access 0x00140080. Initial exact-mask assumption failure is retained; corrected control permits only synchronization/read-attributes additions and still distinguishes management rights. New guest/container run is unexecuted; prior HCS forbidden-open failure remains unchanged. Current public provider terms do not establish actual account clearance. | Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-review/proposal.md for one additional observational container and permission to collect the remaining mask observations while recording all failed open checks. The prior amendment stop condition is not waived. Resolve the transport contract from evidence; no production proxy identity or qualification receipt yet. Provider/account evidence, protected mounts, termination/recovery, installed composition, approved publication/actual answers, preference/restricted-context gates and the exact Test Discord Server deployment remain open. |
| Approved handle-rights observation stopped before start; runner corrected (P22, P23, P24) | Executed the approved one-container HCS handle-rights attempt. Host service identity/owner/DACL and restricted-outsider controls passed; the runner rejected container configuration before guest start. Preserved the failure and prepared a corrected replacement runner. | Docker records create/destroy only. All three services are Manual/stopped with zero exit codes, XML and permissions restored, and no owned processes/containers remain. The absent ExposedPorts guard defect reproduces offline; corrected exposure and approval controls pass. The current rejected inspect was not saved. All guest requested/granted measurements are unrun; the earlier forbidden-open failure remains failed. | Authorize one replacement observation using GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-retry-review/proposal.md; the prior one-container limit is consumed and no retry ran. Retain the transport gate until evidence supports an explicit decision. Provider/account clearance, protected mounts, termination/recovery, installed composition, publication/actual-answer review, preference/restricted-context gates and exact Test Discord Server activation remain open. |
| Completed HCS rights matrix rejects direct transport (P22, P23, P24) | Completed the approved replacement HCS observation on core and egress. All ten forbidden opens succeeded with corresponding guest handle rights, so the direct transport remains unqualified. Prepared an explicit per-purpose relay transport decision; no application or installed permission change. | Each pipe passed five fresh exact-data-rights/descriptor/echo checks. Actual host owner/DACL and restricted-outsider controls passed; owner/DACL bytes remained unchanged after all connections. Guest/container exit 2 records the failed acceptance checks. Container removed, observed vmwp PID absent, services Manual/stopped with zero exit codes, XML/permissions restored and no owned processes/containers remain. | Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/transport-decision.md to select separate per-purpose untrusted relays for local implementation. Do not repeat the same direct-HCS matrix or qualify a proxy SID from guest masks/associated primary tokens. Replacement architecture and its new public/private contract require the owner decision; installation and operational qualification remain separate. Provider/account, protected mounts, termination/recovery, installed composition, publication/actual answers, preference/restricted-context and Test Discord Server activation gates remain open. |
| Relay source and synthetic session checkpoint; lifecycle clarification pending (P22, P23, P24) | Implemented the local relay session primitive, v2 distinct role/boot identity profiles, private/public pipe mapping, exact data-pipe owner/DACL checks, keyless relay entrypoints and supervisor readiness/physical-close seams. Installed supervisor refuses a missing relay controller. The final per-boot controller is not implemented; no installed activation is claimed. | Pinned Framework/C# build passed. Five native transport groups passed (both-purpose 1 MiB duplex/final drain, role/boot and capacity denial, backpressure stop, abnormal disconnect and exact owned helper loss). Native malformed-frame/profile checks and JS owner/secret-field rejection passed. Nine focused supervisor/control tests passed; after cancellation propagation changed, C23/C24 both passed, and six focused shutdown checks passed after ordering relay closure before worker removal. Repository checker passed 561 modules. An initial test assertion used the wrong status shape; it was corrected to inspect the actual journal and the failure log retained. | Resolve the pending owner choice: allow fully drained graceful connections within the same boot (recommended to match existing worker probe/reply behavior), or require a new boot after each completed connection. Unexpected disconnects must revoke the boot either way. Then implement separately authenticated per-boot arm records (never supervisor rewrites of static owner profiles), the concrete relay controller, source/package integration and focused composition evidence; prepare exact service/account/ACL/network/lifecycle changes for separate operational approval. Existing HCS failures, provider/account clearance and other Test Discord Server AI gates remain open. |
| Graceful same-worker-boot relay reuse and application completion (P22, P23, P24) | Owner-approved graceful same-worker-boot reuse is implemented. Each relay retains its single first-instance listener across fully drained sessions; faults terminate that relay. Successful inference exchanges now finish through an explicit bounded graceful-close path; cancellation and malformed traffic still abort. Windows host restarts are prohibited by this workflow. | Pinned native build passed. Five native transport groups passed, including three sequential sessions per purpose in unchanged helper/worker identities, final-byte drain, idle/backpressured stop, capacity denial and no reconnect after failure. Native malformed-frame/profile checks passed. The existing application protocol fixture, adapted to both relays, passed a probe and two metered synthetic localhost-TLS replies plus confirmed cleanup. All 19 IPC tests passed, including added EOF-before-write-ack and stalled-drain regressions. Earlier failing composition and cancellation checks are retained; their source causes were fixed, not waived. | Complete the installed per-boot relay controller and independently authenticated dynamic grants, without rewriting static owner profiles or restarting the Windows host. Then prepare the exact two-service/account/ACL/network installation for separate operational authorization and actual-identity qualification. Installed activation still fails closed without a controller. Provider/account clearance, publication/actual-answer review, remaining AI acceptance gates and Test Discord Server deployment remain open. |
| Installed per-boot relay controller and bounded physical closure (P22, P23, P24) | Installed per-boot relay control is implemented: distinct private supervisor control pipes authenticate relay owners and the supervisor using OS descriptors; native grants bind installation, worker, release, profile, evidence, boot and operation. Persistent relay processes accept fresh boots after confirmed quiescence. Partial startup failure drains both purposes, qualification is bounded, and uncertain closure remains failed. No Windows host restart is part of this workflow. | Pinned host C# build and four native boundary groups passed. Five native-controller groups passed: two fresh boots through unchanged relay processes, repeated sessions, heartbeat, physical closure, unexpected disconnect, supervisor loss, native consumed-boot rejection and native heartbeat expiry. Actual application composition passed encrypted control/wrong-key denial, probe and two metered synthetic localhost-TLS replies plus confirmed cleanup. Six focused lifecycle tests DS04-C23 through C28 passed, as did v3 profile checks and repository validation. Earlier diagnostic failures are preserved and their source causes corrected. | Separately authorize and qualify the exact two relay service identities, filesystem/process/private-pipe/network boundaries, then the changed guest build/public HCS projection and installed composition. Provider/account clearance, publication/actual-answer review and remaining AI acceptance gates still precede Test Discord Server activation. No installed qualification receipt or production readiness is implied by local synthetic checks. |
| Authorized relay service trial stopped at ancestor access; rollback verified (P22, P23, P24) | The owner approved and the operator executed the bounded two-relay service trial against candidate f13395b731859fbd5473d46b8c8f6dead864d863. Both Manual services and dedicated protected package roots were installed, required privileges limited to SeChangeNotifyPrivilege, and 12 scoped firewall block rules created and read back. No container or AI application was activated. | Candidate files and wrapper matched their pinned hashes. SCM configuration and rule readback succeeded. The first inference service launch failed before its diagnostic/native entrypoint: Node lstat returned EPERM on C:\Aphelion. The original trial forbids changing that existing ancestor, so execution stopped. Secondary wrapper Event Log errors exposed omitted source registration in the sc-create diagnostic procedure. Both services, all 12 rules and all new directories were removed; existing three Sophie service states/files and six existing ancestor descriptors match preflight. No candidate processes remained. | Approve the exact non-inheriting metadata-access amendment for the two relay SIDs on five existing ancestor directories, correct wrapper event-source registration, then repeat the authorized trial. Actual identity, private pipe, custody, process and network denials remain unqualified. Guest/public-projection, provider/account, publication/actual-answer and Test Discord Server activation gates remain open. No host reboot is authorized. |
| Local blocker repairs and reviewed test preparation (P07, P19, P23, P25) | Processing approval rechecks expiry after asynchronous qualification. SCM operations have one deadline covering initial commands and polling, with late-result fencing. Worker setup validates existing registration/wrapper/firewall scope before mutation and adds missing services-parent metadata and worker-wrapper read/execute grants in source. | 19 focused installation/service tests and 26 pure PowerShell guard cases passed. Read-only installed observations confirm absent worker wrapper-directory grant and matching current service/firewall configuration; -WhatIf performed no writes. Source-bound verification and publication/qualification preparation are external. | Repair candidate not deployed; no installed permission change, worker boot, provider call, publication or Discord acceptance. DS-01, owner approvals, actual worker qualification and production recovery gates remain open. |
| Approved worker repair installed on retained schema064 (P07, P19, P23, P25) | Approved repair source7a152ca is installed on schema064. Configuration digest and independent journal expiry are preserved; only the two approved services/worker directory descriptors changed. Four Sophie service children match their virtual accounts, Gateway is current/leased and12 public/loopback checks pass. Worker remains stopped; processing is unapproved. | Local repair19 focused and26 PowerShell checks remain source-bound to7a152ca. Installed manifest/configuration/ACL/identity/control/dashboard evidence is in GitHub/.agent_docs/aphelion-sophie/repair-deployment-verification-2026-09-30.json. No worker boot, provider call or Discord AI acceptance. Earlier storage evidence was not rerun. | Provider commitments and operator source/personality/participation/budget/notice review; actual worker and Discord acceptance. No new production clearance. |
| Draft agreements and exact consent support prepared (P19, P23, P25) | Prepared draft privacy notice, per-channel voluntary consent and proposed provider processor agreement for the identified Netherlands operator. Source candidate schema065 preserves exact latest consent snapshots and private export, permits withdrawal during approval outage, binds remote admission/delivery to the current notice and evidence, and rejects legacy/draft processing approvals. Installed staging remains source7a152ca/schema064, worker stopped and processing unapproved. | 14 focused installation/policy/preference HTTP tests and79 isolated AI/storage/knowledge/Gateway scenarios passed; isolated cluster stopped. Repository module checks passed. Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/consent-support-verification-2026-09-30.json. DOCX text/structure checked; rendering unavailable, no visual QA. No new deployment or real provider processing. | Obtain actual provider commitments and transfer/retention evidence; finish factual retention, eligibility and provider annexes before notice publication. Review final notice and operator publications, approve deployment of schema065/source separately, then complete existing worker and Discord acceptance gates. Draft documents and hashes are not legal clearance. |
| AI memory and DeepSeek identifier redaction (P23, P25) | Owner-selected free-form chat with local identifier redaction before temporary memory and independently at DeepSeek egress. Current metadata names, common structured identifiers and unsafe structural keys are handled; the original eligible question trigger is preserved. Private per-worker channel pseudonyms replace provider-key-derived values. Context retrieval rejects stale earlier records after async authorization and serializes each record once for byte accounting. | 100 focused context/provider/worker checks and 79 isolated AI/storage/knowledge/Gateway scenarios pass; cluster stopped. Synthetic 3,000-insert/100-lane median improved from 112.06 to 54.76 ms, including redaction. Maximum-size redaction/nonmatch medians were 0.02–0.56 ms. These are local synthetic measurements, not provider or end-to-end timing. Evidence: GitHub/.agent_docs/aphelion-sophie/memory-2026-10-04/verification.json. | Free text can still identify people, and conservative masking can also remove ordinary words/numbers. Redaction is not proof of anonymity or EU compliance. Existing processing, consent, publication and worker gates remain; the changed profile needs separately authorized staging renewal/qualification. Explicit preferences remain local; no new persistent memory category or automatic extraction. |
| AI privacy checks fenced across asynchronous work (P23, P25) | Invalidation fences pending metadata, member observations and admissions so cleared context cannot be refilled by older work. New exclusions are checked around authority, automation, source and reaction lookups. Admission uses coherent approved notice/revision/binding checks before and after metadata, rejects unbound remote notices, and verifies current consent/control/qualification versions after slow reads. Duplicate receipts stop before repeating approval or Discord metadata work. | 68 focused observation/turn/installation/runtime tests, 81 isolated AI/database scenarios and 20 composed staging scenarios passed; synthetic clusters stopped. Four race regressions failed before the fixes. Two coherent notice reads replace three separate approval-dependent reads per eligible snapshot; no new end-to-end latency measurement. Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/privacy-iteration-2026-10-04/verification.json. | Free-form redaction remains best effort. Provider commitments, reviewed notices/publications, deployment and worker/Discord acceptance remain separate gates. Current dashboard privacy controls require guild membership; a departed-member withdrawal/export route or operator-led process remains to be settled. No live configuration, permission, schema or activation change. |
| AI data deletion on departure, explicit retention and complete consent navigation (P23, P25) | Schema066 records confirmed departure and cleanup epochs in core authority and adds a default-off retention choice protected by the independent journal. AI cleanup is durable, bounded and independent of inference; deleted preferences/consents/resolved activity cannot silently return from an older consistent restore. Cross-member effects and uncertain costs remain pending until resolved. Retention never restores active consent. Consent pages/exact lookup expose every historical choice; absent withdrawals are no-ops. Accepted DeepSeek request serialization is reused for byte accounting and dispatch. | 90 focused unit checks, 92 isolated AI/database scenarios, 20 composed staging scenarios, synthetic browser pagination/withdrawal/retention checks, and 554 source checks passed; owned clusters and preview stopped. Final cleanup queries are covered by the final AI/database run. Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/dispatch-iteration-2026-10-04/verification.json. No new end-to-end performance measurement. | Local candidate only. Qualify schema066 and narrow AI-control grants, journal health/capacity, matching notice and retention annex, and changed worker source. Unknown effects/charges require resolution before deletion completes. Selective/inconsistent restores are not qualified. Provider commitments, live Discord/member acceptance and deployment remain separate gates; free-form redaction is best effort. |
| AI test preparation and required deletion privilege preflight (P23, P25) | Installed AI control qualification checks all seven schema066 grant additions before composing the service. Updated the exact notice and retention annex, prepared held personality/budget drafts, a source-linked 40-case results template and a concrete deployment/qualification proposal. The runbook now requires schema2 accepted processing evidence and records current stopped services and expired receipts. | 10 installation checks and 93 isolated AI/database scenarios passed; AI-D11 rejects each missing grant under an actual restricted database role. Cluster stopped. Read-only service/trust/journal metadata and Setup-InferenceAccount -WhatIf passed; no actual worker denial or Discord/provider test. The 7058-character draft notice fits the runtime limit and draft processing remains held. Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/test-readiness-2026-10-04/verification.json. | Review actual provider commitments and remaining factual/legal retention/transfer inputs; approve the pinned source/schema065-066/grant/receipt renewal and staging service starts. Keep worker stopped and processing held. Refresh protected assembler evidence references and independently verify the existing journal before receipt renewal. Then complete owner publications, current member consent and actual worker/Discord/answer/latency acceptance. Word layout QA is blocked by the missing bundled LibreOffice renderer; text/JSON drafts are available. |
| Approved schema066 staging deployment and receipt renewal (P23, P25) | Preserved and verified the stopped installation/database recovery point, applied 065/066 and the seven narrow AI-control grants, installed pinned 5f60a24 and refreshed protected assembler evidence references, journal receipt and installation trust. Started only Sophie PostgreSQL, tunnel, supervisor and core. Runtime/credentials and journal bytes unchanged; worker stopped and processing disabled. | Approved staging deployment: 66 migration checksums and actual runtime database identities passed; 72 original rows across 101 tables preserved; exactly seven grants added. 485 mirrored files plus three root files match pinned 5f60a24. Four service-child identities, loopback listeners, current Gateway, recovered supervisor and 12 dashboard checks passed. Journal bytes/identity preserved; configured ACL/firewall evidence renewed. Source-bound report: GitHub/.agent_docs/aphelion-sophie/deployment-5f60a24-2026-10-04/verification.json. | Provider commitments and factual notice/retention/transfer annexes, owner publications, current tester consent, actual worker file/network denial and physical stop, Discord privacy/departure/answer acceptance and measured latency remain open. Worker stays stopped and processing denied. Journal receipt expires 5 October at 16:13 Warsaw; installation trust at 17:14. Renewal requires fresh evidence. Word draft layout remains unverified; canonical text/JSON are available. |
| Reviewed moderation recovery dashboard (P05, P08, P15) | Bounded member-specific delivery review, explicit confirmed retry, current actor/original moderator checks, action/eligibility/job fencing and idempotent retry receipts. Preserves uncertain dispatch and requires fresh moderation after departure/rejoin. Schema067 extends the fixed OAuth return allowlist; no grants/dependencies changed. | 21 focused unit checks, M01–M20 and 21 composed staging scenarios pass, including RT21 OAuth/CSRF/current-role recovery. Synthetic browser confirmation and expired-decision checks pass; isolated clusters and preview stopped. GitHub/.agent_docs/aphelion-sophie/moderation-recovery-2026-10-04/verification.json. | Local candidate only; installed5f60a24/schema066 unchanged. Authorized deployment, live capability/role/client acceptance and production gates remain open. |
| Available synthetic AI Gateway exclusion evidence (P19) | Composed staging/Gateway scenario with enabled synthetic qualification and consent, a public positive control and protected/permanent/moved/thread exclusion sentinels. No production code change in this milestone. | 22 composed staging scenarios pass, including P19-RT22 and final RT21 moderation recovery; cluster stopped. No protected source fetch, extra knowledge/model call, AI request/effect/provider attempt or Discord write. Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/ai-exclusion-2026-10-04/verification.json. | Installed worker/OS/network qualification, full authenticated artifact-route exclusion and T22–T26 release acceptance. Local schema067 candidate remains undeployed; installed5f60a24/schema066 and processing gates unchanged. |
| Read-only vault inventory and retained-slot ownership (P06, P12, P26) | Bounded staging scan enumerates opaque flat-directory metadata and reports whole-vault counts without file-body reads, recursion, link following or mutations. Cross-job retained slots and recorded-size mismatches fail closed before file verification or backup selection. No additional migration/grant/dependency change. | Six focused file tests, 31 isolated attachment/operations scenarios and 11 isolated recovery scenarios pass; both clusters stopped. AO06–AO08 cover classification/links/limits/selection races and RB11 rejects a cross-job slot before a backup manifest. GitHub/.agent_docs/aphelion-sophie/attachment-inventory-2026-10-04/verification.json. | Local undeployed candidate. No real vault scanned. Repair/requeue/deletion/download policy, larger-vault limits, alert thresholds and live operational acceptance remain open. |
| Fixed shared Sophie brand-profile contract (P36) | Dashboard startup and repository checks validate fixed identity, approved local asset references, original metadata and static presentation boundaries. Preserved profiles/manifests/PNGs remain unchanged. P20–P22/P39 records reconciled with existing direct-lookup and installed knowledge evidence. | Nine focused brand/dashboard tests and repository asset/source checks; GitHub/.agent_docs/aphelion-sophie/brand-profile-2026-10-04/verification.json. | Local candidate only. Package the existing brand-profile.json with the core dashboard. Owner distribution/publication, any derivative review and independent live/accessibility acceptance remain open. |
| Ordinary ticket delivery recovery dashboard (P08, P17, P27) | Metadata-only bounded queue and explicitly reviewed repair controls at /case-delivery. Browser and signed Discord commands share receipt-first recovery, current case authority and trusted exact-message/channel proofs. Migration068 extends only OAuth return paths; no dependency or capability changes. | 27 focused checks; 71 B/X/Y intake/recovery and 23 composed runtime scenarios pass with stopped clusters. Synthetic browser confirms review/focus/keyboard flow, lost-response exact retry, denial clearing and corrected 32-hex pagination. GitHub/.agent_docs/aphelion-sophie/case-delivery-dashboard-2026-10-04/verification.json. | Undeployed candidate. Shuttle dashboard parity, controlled file downloads, final copy and independent live/client/accessibility acceptance remain open. No unidentified message is resent. |
| Shuttle assistance and delivery dashboard (P08, P14, P16, P17, P27) | Bounded metadata queues, reviewed help resolution/resumption and delivery repairs under existing Shuttle authority. Commands and HTTP share receipt-first operations, trusted proof issuers and fenced transactions. Migration069 adds two fixed login return paths only. | 31 focused checks; 87 Shuttle database scenarios; RT24 composed OAuth/CSRF, paused-help and uncertain-screen recovery. All24 runtime scenarios passed a diagnostic rerun. Browser confirms keyboard confirmation, numeric pagination, exact retry, message/channel repair and access-loss clearing. Clusters, preview and tab stopped; see shuttle-dashboard-2026-10-04/verification.json. | Undeployed. Original intermittent P19-RT22 AI_TURN_UNAVAILABLE remains unreproduced despite a passing isolated and full diagnostic run; no AI assertion was relaxed. Live worker/provider/publication/consent and independent release acceptance remain open. |
| Completed-admission AI exclusion probe (P19, P27) | The synthetic exclusion scenario waits for the admission transaction to commit and release before fixture mutation, retaining its qualification counter and every existing exclusion, receipt, cancellation and no-fault assertion. No production AI, schema or authority change. | Targeted P19-RT22 passed with external diagnostic logging and in an uninstrumented run; both disposable clusters stopped. Read-only review found no reproducible production defect. See ai-admission-diagnostic-2026-10-04/verification.json. | Original intermittent AI_TURN_UNAVAILABLE remains unexplained, not fixed. Actual worker isolation/stop, provider/notice/publication/consent and independent live acceptance remain open. |
| Static Sophie placement review preparation (P29, P37, P38) | Local-only review surface validates all four original assets and presents contained banner, small/circular avatar, paired alpha surfaces and narrow live-text fallback. The installed dashboard and original artwork are unchanged. | All 11 placements loaded; developer review at desktop and 320 CSS pixels, light/dark alpha, keyboard focus, quiet mode and missing-image fallbacks passed. Preview process/listener and tab stopped; no console errors observed. See brand-review-2026-10-04/verification.json. | Owner placement/distribution approval, independent accessibility/browser-zoom and Discord upload qualification, final product placement and integrated T51 acceptance remain open. |
| Current release-review inputs and result preservation (P04, P23, P27, P32) | Updated selected-provider T31-T33/T52 and P23/P32 scope, current implementation/acceptance distinctions, effective R10 with historical reference retained, and separate SAI-G metadata. Generator refuses human-result overwrite and supports a fresh output path. Existing XLSX remains untouched. | Two focused generator checks cover all stable IDs/gates and byte-preserving refusal for every human-result field; 117 rows, 60 specifications and 18 requirement mappings regenerate without a release pass. See release-review-2026-10-04/verification.json. | Independent human evidence reconciliation and all provider/privacy/publication/consent/worker/live release gates remain open. Historical workbook values were not read, imported or replaced. |
| Core-owned Contact staff entry without AI content transfer (P19, P24) | Core adds fixed Contact staff navigation after closed AI payload validation. Current member clicks receive the existing six public categories privately, then freshly authorized blank ordinary forms; Quick Help retains its no-form entry. No AI text, source message ID, category decision or generated field value enters intake. | 54 focused checks and two composed runtime scenarios pass. Current membership, private chooser, blank fields, late-response rejection and only member-entered stored answers are covered; existing Onboarding panel remains functional. Disposable cluster stopped. See contact-staff-2026-10-04/verification.json. | Independent live Discord/client and full T26 acceptance; provider/privacy/publication/consent and worker gates remain open. No deployment, schema, permission, dependency or provider change. |
| Maintenance and upgrade procedure draft (P35) | Prepared a source-bound maintenance review draft for dependency/API/provider/model revalidation, proposed operator roles and cadence, agent PR/release evidence and isolated recovery with current deletion/revocation history. It uses existing tooling and creates no recurring job or operational change. | Documentation review against current owner decisions, selected-provider scope, existing builders and recovery/runbook contracts; local links and generated workplan/ledger checked. No application tests or operational drill. See maintenance-2026-10-04/verification.json. | P31 cutover remains a prerequisite for adoption. Owner must select named operators/reviewer/custodian, cadence and outage/fallback channels, independent recovery destination/key custody and RPO/RTO/retention. Operational drills, upgrades and production qualification require their exact authorization and evidence. |
| Pinned schema069 staging candidate preparation (P07, P27) | Prepared a pinned 335a3f2/schema069 staging review packet and 512-file source archive. Read-only installed manifest/baseline/database checks pass; exact schema066-to069 preservation, idempotency and return-path boundary checks pass in a stopped disposable cluster. No installed state changed. | All512 archive entries match pinned Git; installed trust/manifests and488 selected baseline paths verified, with recorded CRLF-only text differences. Live schema066 checksums and held AI state verified read-only. Synthetic066-to069 flows/session/grants preservation and fixed-path bounds pass; cluster stopped. See candidate-335a3f2-2026-10-04/verification.json. | Scoped owner authorization is required to install this candidate, migrate067-069, renew receipts from fresh evidence and restart affected staging services. Worker remains stopped; provider, publication, consent and actual worker/client/performance gates remain separate. No destructive rollback is authorized. |
| Approved schema069 staging deployment and receipt renewal (P23, P25) | Preserved a fresh stopped database/package/configuration recovery point with independent journal. Applied only 067–069 without new grants, installed exact 335a3f2 archive, pinned protected assembler commit/evidence, renewed journal receipt and trust, restarted core/supervisor after quiescence and Gateway lease expiry. No shared-ancestor ACL, firewall, service registration, credential, publication or processing-policy change. | Approved pinned 335a3f2/schema069 deployment: 512 exact source hashes and all 69 migration checksums verified; 77 original rows in 103 tables and all grants preserved. Four service-child identities, loopback listeners, current Gateway, recovered supervisor, 18 local/public route checks and 2 asset checks passed. Tunnel unchanged; worker stopped; processing policy absent and AI disabled. Independent journal bytes/identity and configured ACL/firewall scope unchanged. Source-bound report: GitHub/.agent_docs/aphelion-sophie/deployment-335a3f2-2026-10-04/verification.json. | Actual worker file/network denials and physical stop, provider terms and factual privacy annexes, approved publications, current tester consent, private Discord/client acceptance and measured AI latency remain separate gates. Journal receipt expires 5 October at 20:54 Warsaw; installation trust at 21:54. Renewal requires fresh evidence. The initial dashboard assertion failed with an unrecorded status; a focused rerun passed, but its cause is unproven. The earlier P19 runtime fault also remains unexplained. |
| Paged single-channel exports and exact browser retries (P06, P12, P19) | Local paged single-channel transcript exports retain the existing per-part limits and exclusions, bind exact input/continuation positions into review hashes, preserve exhausted-stream positions, and require explicit review/confirmation for each part. Distinct filenames and exact retries retain the existing audit without a migration. The browser rechecks account identity after fetch and preserves uncertain retries across routine access refresh. No AI case data path was added. | 16 focused unit checks and 22 isolated PostgreSQL/HTTP scenarios passed, including 105 observations and both stream-exhaustion orders. Composed RT10 member export, P19-RT22 AI case exclusion, and an initially misselected RT14 maintenance scenario passed; every synthetic cluster stopped. Nine controller checks reran after the final access-refresh correction. Synthetic browser review, unchecked confirmation, uncertain download/retry, next-part and final handoff passed. Source-bound report: GitHub/.agent_docs/aphelion-sophie/paged-exports-2026-10-04/verification.json. | Export candidate is local and not deployed; staging stays pinned to 335a3f2/schema069. Parts are current views, not a globally frozen/full-history archive. Byte-oversized parts still fail explicitly. Private client acceptance, saved-file receipt, multi-channel/archive selection, attachment downloads/scanning and independent recovery remain open. Actual worker isolation/stop, provider terms, approved publications, consent and measured AI latency remain gated. |
| Pinned source-update and worker OS test preparation (P07, P12, P19, P23, P28) | Prepared the exact 2c5d356 source-only/schema069 export candidate and guarded operator entry point; corrected current staging/runbook/release-checklist references. Prepared an inactive fixed-target worker OS probe and proposed no-provider lifecycle/identity/stop procedure. | Read-only installed 335 checks match 512 source files and 69 migration hashes; the 512-entry archive and 741 installer/support/dependency files are hash-bound. Fourteen operator scripts pass syntax checks; default and missing-approval paths perform no deployment. Thirteen synthetic probe checks pass. Host inspection found the existing public Sophie ingress on TCP 80; one operator control connected without application data. Reports: GitHub/.agent_docs/aphelion-sophie/candidate-2c5d356-2026-10-04/verification.json and worker-os-qualification-2026-10-04/verification.json. | No source deployment or worker trial was executed. Separate source-update and worker-trial approvals, fresh endpoint/identity bindings, provider facts, publications/consent, actual Windows denial/stop, private client acceptance and measured AI latency remain open. |
| Test cleanup and staff-editor simplification (P08, P17, P18) | Storage harness reports every failing scenario; workplan graph, workplan regeneration, release-ledger wording and evidence recording removed as gates; case labels last-write-wins; request-ID replay removed from form and Shuttle authoring, curated answers and system wording (review hashes, publication and permission checks unchanged); J01, S17, S28 and U08 updated to the current Shuttle. | At 564a038: npm test 656 passed; repository check and verify-foundation passed; storage (parallel, 4 shards) 997 passed, 0 failed. | Deploy the prepared source-only update and check label, form, Shuttle, answer and wording edits on the Test Discord Server. |
| Shuttle message groups and faster page turns (P13, P14, P16) | Owner request of 20 October: each Shuttle run is a status card (edited in place, no controls), the current step as plain messages (per-message link previews, off by default) and a navigation card with Back and Continue; a step change deletes the previous step's messages and card, posts the new ones in order and edits the status card last. Continue, Back and Check completion update their own card at once ("Opening…"); a click that records nothing restores it. Ask Staff is no longer shown; earlier requests, alerts and pauses are still handled. Speed: one rate-limit registry shared by every transport, queued instead of busy-failed requests, delivery woken on commit, observations shared across a render while the Gateway authority boundary is unchanged, writes confirmed from Discord's response (an unconfirmed edit is read back, never rewritten blindly), and fixed-code timing traces. Migration 071 adds retained message parts; the editor shows message breaks and a per-message preview toggle. | Offline, on the message-group source: npm test 672 passed, 0 failed; repository check passed; storage (parallel, 4 shards) 998 passed, 0 failed (new V11b; suites rewritten for message groups and the retired Ask Staff). Transport (04f305c) and delivery wake-up/traces (6c1570e) each passed 997 storage scenarios on their own. Not live: no staging install, Discord rendering or timing measurement yet. Installed on staging 20 October 13:55 UTC as pin 20bd3e7 (schema 072; folder deployment-20bd3e7-2026-10-20): prepare, cold preservation, migration 070->072 (103 tables and 16,177 rows kept identical; nothing to release; one grant: SELECT/INSERT/UPDATE on shuttle_screen_parts for the runtime), pre-start, service boundaries, installed 26/26 and dashboard 24/24 passed (the first installed and dashboard passes got 503 from the authenticated API routes within about 40 s of start; both rechecks passed). | Walk all five steps on desktop and mobile on the Test Discord Server; compare SHUTTLE_COMMAND/SHUTTLE_RENDER timings from real clicks with the code-read estimate; owner confirmation of the one 60-second same-nonce retry for lost step-message creates. |
| Shuttle without Staff intervention (P14, P16) | Owner direction of 20 October: Staff take no part in the Shuttle. Migration 072 released earlier help pauses, closed open help requests and withdrew unsent notices; the help-pause rule is retired from the editor and drafts. Parked Whitelist grant/reconciliation, Shuttle message and Shuttle channel jobs are rechecked automatically (2 minutes after parking, doubling to 15); creates unanswered after 2 minutes are redone (a step is reposted, a status card restarts the run, a channel is recreated); duplicate Shuttle channels keep the opened or oldest channel; Whitelist delivery problems no longer alert Staff. | Offline: npm test 672 passed; repository check passed; storage (parallel, 4 shards) 1002 passed, 0 failed (new F21-F23, Q12; L04-L06, L15, L16, L21 rewritten for no-Staff recovery and the migration release). Installed on staging 20 October 13:55 UTC as pin 20bd3e7 (schema 072; folder deployment-20bd3e7-2026-10-20): prepare, cold preservation, migration 070->072 (103 tables and 16,177 rows kept identical; nothing to release; one grant: SELECT/INSERT/UPDATE on shuttle_screen_parts for the runtime), pre-start, service boundaries, installed 26/26 and dashboard 24/24 passed (the first installed and dashboard passes got 503 from the authenticated API routes within about 40 s of start; both rechecks passed). | Observe SHUTTLE_SELF_HEAL_REQUEUED and the automatic Whitelist recheck live on staging. |
| Shuttle clicks overtaken by Gateway traffic (P14, P16) | Staging 20bd3e7 showed a slow /whitelist start and first page (about 30 s) and a first Continue answered "We couldn’t confirm that request" with its card left on "Opening…". Member reads are checked against Gateway continuity, which every dispatch advances; the instant "Opening…" edit produces a MESSAGE_UPDATE during the click's own reads, and the command path, unlike the render worker, did not retry. Shuttle commands now retry transient read, cooldown and busy failures up to three times; still transient, members are asked to try again (reply.onboarding_retry) instead of being sent to Staff; a click that records nothing always puts its card back, falling back to a Discord-free release of the member's own card; a Shuttle channel that opens makes its waiting first page due at once; traces carry error codes (SHUTTLE_COMMAND_RETRIED/FAILED_<code>, SHUTTLE_RENDER_<outcome>_<code>, CASE_PROVISION_<outcome>_<code>). The same-day AI report was the member chatting in their Shuttle channel, correctly excluded. | Offline: npm test 673 passed; repository check passed; storage first run 1004 passed, 1 failed (OC02: Discord refusing access was worded as busy; narrowed to transient codes only); new V21-V23. Final storage run 1005 passed, 0 failed (4 shards). Installed on staging 20 October 14:57 UTC as pin 334fd97 (source-only; prepare, pre-start, boundaries, installed and dashboard checks passed first time). | Live click-through on staging; read the SHUTTLE_COMMAND_RETRIED/FAILED and CASE_PROVISION codes to confirm the cause and decide whether channel creation also needs a short retry for overtaken reads. |
| Shuttle lag, stutter and stale cards (P14, P16) | After a full staging walk-through on 334fd97 (owner: "significant lag and stutter", and a stale card fixed only by /whitelist start), traces showed every click retried once after OBSERVATION_INVALIDATED (about 5 s) and render jobs needing 2-5 attempts; those retry traces exceeded the host's 64-character limit and were dropped. Role, member and channel observations are now checked against the authority boundary instead of the per-dispatch continuity (message reads keep the continuity; dashboard view reuse unchanged); delivery reads overtaken before any write retry after 250 ms; every Continue, Back or Check leaves a 20-second database watch that redraws its card unless it was replaced or put back, finishing without Discord calls when there is nothing to do; /whitelist start does not count a watch as its re-check; failure codes go on their own trace lines. | Offline: npm test 674 passed (new authority-boundary test); repository check passed; onboarding storage suites 97 passed (new V24, V25; V11 caught the watch suppressing the entry re-check). Full storage run 1007 passed, 0 failed (4 shards). Installed on staging 20 October 15:47 UTC as pin 67c1f4a (source-only; prepare, pre-start, boundaries, installed and dashboard checks passed first time). | Timed live walk-through on staging, compared with the 334fd97 run (about 5 s per click plus 2-5 s per render). |
| Slow ticket opening and lingering step messages (P14, P16) | Owner reports on 67c1f4a: about 20 s to open a Whitelist ticket, and a step message that seemed not to delete before the next step. Discord's own delete events show the order was right, but the deletes were spread over 7 s by OBSERVATION_UNAVAILABLE retries; channel creation and the first page also failed on OBSERVATION_OUT_OF_ORDER and re-reads. A boundary read now waits up to 750 ms for dispatches already received to be recorded; an older membership observation that agrees with the stored one is kept; render and channel claims re-read overtaken observations within the claim; a first page whose channel is pending waits without reading Discord and is made due when the channel opens. | Offline: npm test 674 passed; repository check passed; storage 1007 passed, 0 failed (4 shards, 835 s). Installed on staging 20 October 17:05 UTC as pin 25b8085 (source-only; prepare, pre-start, boundaries, installed and dashboard checks passed first time). | Timed live walk-through of ticket opening and page turns on staging. |
| Faster isolated database tests (P27) | Owner: "Thirteen minutes per build is excessive." Per-scenario TRUNCATE resets became DELETE in replica mode (tests/fixtures/reset.js, one shared CORE_STATE_TABLES list); the synthetic test clusters run with fsync, synchronous_commit and full_page_writes off and initdb --no-sync (owner decision); shards take suites one at a time, longest first; each suite runs on its own copy of the migrated template database, so suites are order-independent (--order=reverse check); RT09 waits out a real 5 s Gateway lease (journal leaseMs option, deployments keep 30 s) and P19-RT22 uses a 1.5 s member interval; per-scenario SCENARIO_MS timings; storage test inventory generated from the suites. No scenario was merged or dropped: none duplicates another. | npm test 674 passed; repository check passed; storage (4 shards) 1007 passed, 0 failed in 68 s (835 s before); reverse-order serial 1007/0 in 3 min 29 s; forward serial 1007/0 in 3 min 39 s (about 20 minutes before). | None for speed. Optional: rename the scenario IDs reused across suites (CA01-CA13, PA01-PA10 and others) where evidence documents allow. |
| Production-test preparation: artwork removed, Shuttle wording, channel title and category (P36, P14, P10, P11) | Owner direction of 20 October. All branches merged into main. Sophie's custom artwork, manifests, brand profiles and the dashboard avatar are removed (text identity only). Member-facing Shuttle replies no longer mention Staff help and the Shuttle case type is labelled "Shuttle". New Shuttle channels are titled "<Discord username>'s Shuttle" from a fresh member read (username not stored; tickets keep case-… names). An optional casePolicy.shuttleCategoryId, chosen on the Permissions page, places Shuttle channels in their own category; changing it advances the case-policy version, the apply step inventories and seals each retained channel into its case type's category, and the category is recorded as a case exclusion for AI and automation. | See docs/verification.md (20 October 2026, production-test preparation). | Not deployed. Choose the Shuttle category on the Permissions page and apply it after deployment; set the bot account avatar in Discord if wanted. |
| Sophie keeps her own memories (automatic member and channel memory) (P24, P32) | Owner direction of 20 October 2026 supersedes the 11 October member-notes-only rule. Sophie may add up to two memories to any outcome (no extra provider call): member memories (one subject) and channel memories (up to four subjects). Members are stored as subjects with {n} placeholders, never names or turn labels; identifiers are masked. Turns see up to eight member memories about the people present and four recent channel memories. Memories expire 90 days after last use, are capped per member and channel, carry each subject's preference epoch (journal-backed restore fence), are erased on departure, and are cancelled before delivery if changed. Members see, edit, forget or turn off memory on their AI preferences page; ai.memory.audit holders list and delete any memory. Migration 073 (sophie_ai.memories, sophie_ai.memory_optouts). Memory runs only under an accepted processing policy with automaticMemory: true, which changes the consent binding. | See docs/verification.md (20 October 2026, Sophie keeps her own memories) and docs/ai-memory.md. | Not deployed. Owner: revise the notice (draft in docs/ai-memory.md), re-accept the policy with automaticMemory, grant the control role on the two new tables, grant ai.memory.audit, deploy the new worker release; members then opt in again. Live behaviour with Mistral (how often and how well she writes memories) is untested. |
| Shuttle reading time in Whitelist notices, /whitelist progress, and the first log review (P50) | Owner request of 25 October 2026. The Activity measures focused reading time per stop and sends it with Continue, Back and Check; core credits it once per request, capped by the time that passed (migration 079: shuttle_activity_runs.attention_at_ms/completed_at_ms, shuttle_activity_attention). The staff-bot-channel notice adds "Time to completion: … focused (… from boarding) · N pages, average … a page". Staff and Lead Ops run /whitelist progress member: for a private view of a member's Discord state, run position, grant state and timing. Log review fixes: a sign-in never resends a spent Discord code and retries its post-exchange reads; AI disabled is traced once. | See docs/verification.md (Production install of bbe844c). | Installed 25 October 2026. Watch the first timed notices and a Staff progress check; fix the GitHub token's access (FORBIDDEN). |
| Member records: rendering and the Staff test run (P56) | Owner decisions of 30 October 2026. modules/member-records renders each member's post: header, ledger, three reserved messages, entries and application transcription, with date-of-birth and game-name interpretation. A host-only script opened posts for the 22 current Staff and Lead Ops holders in the Staff forum (header, ledger, reserved, a Record opened entry the ledger links to), added the forum's tags and archived each post. Core and the installed release are unchanged. | npm test: 913 passed, none failed (MR-01 to MR-14 included); npm run check passed; staff-test-verify.json: 22 posts checked, no problems. | Core integration and its install, the backfill of everyone else, application transcription (permission), the discussion copy. |

## Next implementation sequence

These are bounded next steps within the task dependencies below. An unresolved live or operational input stops only work that needs that input.

1. **Review the prepared source-only export update** (P07, P08, P15, P17, P27). Review GitHub/.agent_docs/aphelion-sophie/candidate-2c5d356-2026-10-04/deployment-review.md and its exact archive/runner hashes. The source-only update has no migration, new grant or dependency and keeps PostgreSQL/tunnel running and AI disabled. Execute only after separate operator approval; follow with private saved-file/export acceptance. Exit evidence: Authorized operation receipt, unchanged retained data/grants/publications, matching source/schema/service identities and safe dashboard checks. Independent client and AI gates remain open.
2. **Qualify actual worker isolation and stopping under approved operator scope** (P19, P23, P28). The inactive worker OS probe and proposed trial are in GitHub/.agent_docs/aphelion-sophie/worker-os-qualification-2026-10-04/operational-review.md. Existing public Sophie ingress on TCP 80 is a remote target with one successful operator control; bind fresh address/request/probe/temporary-wrapper scope before execution approval. Use the existing authenticated no-provider dashboard lifecycle; independently verify actual wrapper/Node SID, positive controls and physical exit. Synthetic checks and ingress reachability do not clear the OS, provider, consent or processing gates. Exit evidence: Source-bound actual identity/access/stop observations and independent live T22–T26 acceptance, without changing production or unrelated services.
3. **Resolve provider terms and complete owner-led worker/chat acceptance** (P07, P19, P21, P22, P23, P24, P25, P32). The approved pinned 335a3f2/schema069 staging update is complete; use the running dashboard for owner review. Resolve provider/factual inputs using the prepared notice and retention annex. Complete exact owner publications, separately authorized worker isolation/stop checks, current member consent and actual worker/Discord acceptance before processing. Keep the independent journal and trust receipts current through reviewed renewals; no automatic source redeployment or member activation. Exit evidence: Current installed package, identities, configured ACL/firewall scope, Gateway and anonymous dashboard checks are recorded. Still needed: actual worker file/network denials and child termination, accepted provider evidence/publications/current consent, live privacy/departure/answer tests and measured end-to-end latency.
4. **Privately verify deployed configuration and apply workflow** (P03, P05, P08, P11, P15). Sign in with the existing Lead ops role at /permissions. Verify Crew/base, Whitelist, Muzzled, Staff/lead ops, feature grants, responders and category; review/apply an intentional change and verify progress, preserved restrictions and case access. Do not inspect private data through agent tools or repeat bootstrap/deployment. Exit evidence: Owner pass/fail with client/time and no private content. Keep the held recovery path and fresh Whitelist-run rule; no old-policy or schema054 rollback.
5. **After feedback: qualify Onboarding production gates** (P01, P02, P05, P06, P07, P09, P13, P14, P26, P27, P29, P30, P31). Address the reported Onboarding failures first. Then qualify final guidance/mappings, existing-role ownership, Muzzled and fresh-run revocation, no-AI/privacy, restart/uncertain-effect recovery, independent latest-history recovery, Windows identity/service packaging and approved production handoff. Preserve the broader feature backlog without making unrelated functionality a prerequisite for the next Onboarding test. Exit evidence: Build-specific applicable release evidence and explicit operator approval; no production-ready claim from this human-test checkpoint.
6. **Start the Shuttle Activity** (P40, P42). The owner enables Activities on the production application and chooses its production ingress. Then run the P40 spike behind the tester gate. Scene work and the sound options (P42) can start alongside. Exit evidence: Spike report per platform and a verified tester gate. Sounds are converted, hash-pinned and approved by the owner (docs/shuttle-activity-sounds.md).

## Inputs and release gates still open

| Input or gate | Affected work | Work that can continue now |
|---|---|---|
| Isolated Discord test guild/bootstrap and current live Gateway are configured; complete client/permission/workflow acceptance remains pending | Live Gateway, modal/client, role hierarchy, case ACL and command-registration checks. | Synthetic adapter, authorization, delivery and recovery implementation. |
| Production role/channel selections and responsibility review; candidate editor and per-type responder maps implemented locally, activation/reconciliation remains open | Real Staff/lead-ops access, moderation/configuration permissions and single-writer cutover. | Versioned capability policies and negative authorization tests. |
| Owner will author Shuttle guidance with the adaptive editor; final form questions/links remain to publish. Closed-case read-only audience is approved. | Production publication and final case/closure UX. | Data-driven form editor, synthetic workflow tests and provisional read-only closure. |
| Attachment type/count/size/storage limits and quarantine/download policy; scanning capability is unapproved | Production attachment acquisition, storage admission and artifact delivery. | Authenticated transcript implementation, operator artifact inventory/repair, and synthetic export/capacity tests. |
| https://sophie.a13.info ingress, OAuth callback and owner login verified; multi-account permissions and complete live workflow acceptance remain pending | Live dashboard/provider compatibility and public ingress. | Loopback authentication, route parity and synthetic browser checks. |
| Reviewed runtime distributions, native service identities, ACLs, data root and ports | Service installation, OS isolation, resource baseline and host reboot tests. | Packaging, explicit composition and installation/preflight scripts. |
| D:\Backups selected locally; independent recovery copy, key custody, RPO/RTO, backup retention and latest recovery watermark remain open | Verified independent restore and production cutover; a local destination is not an off-host recovery pass. | Backup/restore interfaces, local synthetic drills, retained-artifact design and operator runbooks. |
| Human brand/accessibility review and administration pilot approval | G2 presentation acceptance and live cutover. | Static approved-asset previews and developer keyboard/reflow checks. |
| Policies collection and the separate owner-supplied Discord rules are selected; current publication review remains open. Exact DeepSeek account processing terms/notices and named restricted-audience clearance remain unresolved. Reply length and preferred language are the two selected explicit preference types. | Real member processing, reviewed source publication, remote preference use and each restricted context. | Synthetic source/worker/effect/control implementation; administration stays independent. |
| P35 maintenance draft needs owner adoption after P31, named operators/reviewer/custodian and approved cadence/outage routes | Maintenance ownership, recurring reviews, drills and operational upgrades; no recurring jobs are authorized by the draft. | Local procedure draft completed: GitHub/.agent_docs/aphelion-sophie/maintenance-2026-10-04/procedure.md. Existing recovery destination/key-custody/RPO/RTO inputs remain separate. |

## Task status

Status counts: 3 complete; 43 in progress; 7 planned, not started. These are full-task statuses, not a percentage of code or release readiness.

An in-progress task can contain several verified milestones and still have unfinished implementation or acceptance. Acceptance IDs below link requirements to tasks; they do not assert that those specifications have passed.

| Task | Status | Depends on |
|---|---|---|
| P00 — Freeze scope and deployment inputs | complete | None |
| P01 — Approve licence scope and persistence choice | in_progress | P00 |
| P02 — Inventory and baseline Windows host | in_progress | P00 |
| P03 — Discover Discord, wiki and design inputs | in_progress | P00 |
| P04 — Bootstrap repository and contract checks | in_progress | P00 |
| P05 — Implement authentication and shared capability policy | in_progress | P03, P04 |
| P06 — Implement durable storage and outbox | in_progress | P01, P04 |
| P07 — Package native service skeleton | in_progress | P02, P04 |
| P08 — Build dashboard shell and shared controls | in_progress | P04, P05 |
| P09 — Implement Discord adapter and command plumbing | in_progress | P04, P05 |
| P10 — Implement ticket provisioning and state | in_progress | P06, P09 |
| P11 — Implement case permissions and staff lifecycle | in_progress | P05, P10 |
| P12 — Implement transcripts and attachment policy | in_progress | P06, P11 |
| P13 — Implement Onboarding content editor and definitions | in_progress | P08, P10 |
| P14 — Implement deterministic Onboarding progression | in_progress | P06, P13 |
| P15 — Implement role ownership, restoration and revocation | in_progress | P06, P09 |
| P16 — Integrate final Shuttle grant and recovery | in_progress | P14, P15 |
| P17 — Complete staff ticket UX and commands | in_progress | P08, P11, P12 |
| P18 — Implement simple automation and curated answers | in_progress | P08, P09 |
| P19 — Enforce AI exclusion at every boundary | in_progress | P05, P06, P07, P10 |
| P20 — Implement MediaWiki ingestion and sync | in_progress | P03, P06, P19 |
| P21 — Implement direct lookup and source authority | in_progress | P20 |
| P22 — Implement knowledge administration | in_progress | P08, P20, P21 |
| P23 — Qualify the selected inference provider and runtime | in_progress | P01, P02, P07 |
| P24 — Implement non-ticket knowledge assistant | in_progress | P19, P21, P23 |
| P25 — Implement AI controls and evaluation tooling | in_progress | P08, P24 |
| P26 — Implement backups, deletion and operator runbooks | in_progress | P06, P07, P12 |
| P27 — Run administration failure and permission suite | in_progress | P16, P17, P18, P26 |
| P28 — Run selected AI isolation, quality and host-load qualification | planned_not_started | P25, P26, P39 |
| P29 — Approve brand implementation and accessibility | planned_not_started | P03, P13, P17, P18, P38 |
| P30 — Approve administration pilot and cutover ledger | planned_not_started | P27, P29 |
| P31 — Cut over administrative responsibilities | planned_not_started | P30 |
| P32 — Activate separately approved non-ticket AI | planned_not_started | P28, P31, P39 |
| P33 — Add selected read-only service adapters | planned_not_started | P31, P39 |
| P34 — Add small community utilities | planned_not_started | P31 |
| P35 — Establish maintenance and upgrade cadence | in_progress | P31 |
| P36 — Sophie identity (custom artwork removed) | complete | P03, P04 |
| P37 — Apply Sophie branding to interfaces and static copy | in_progress | P36, P08, P09, P13, P17 |
| P38 — Review identity consistency and non-AI presentation | in_progress | P37, P19 |
| P39 — Validate and activate direct knowledge independently of AI | in_progress | P19, P21, P22, P26 |
| P40 — Shuttle Activity: production spike and tester gate | in_progress | P14, P16 |
| P41 — Shuttle Activity: backend, and the Shuttle leaves tickets | in_progress | P40, P14, P15, P16 |
| P42 — Shuttle Activity: scene renderer, art and sounds | complete | P40 |
| P43 — Shuttle Activity: visual novel client and main page | in_progress | P41, P42 |
| P44 — Shuttle Activity: Rules post, editor and opening | in_progress | P43 |
| P45 — Dashboard sign-in after a Shuttle Activity sign-in | in_progress | None |
| P46 — One Yes or No for the whole server, and /sophie | in_progress | P45 |
| P47 — Channel contexts and longer replies | in_progress | P46 |
| P48 — Named staff channels | in_progress | P47 |
| P49 — Code, Guidebook and community sources | in_progress | P47 |
| P50 — Move to the main server for closed testing | in_progress | P45, P46, P47, P48, P49 |
| P51 — Sophie accuracy and memory: adversarial review and regression probe | completed | P50 |
| P52 — Memory privacy and honesty (release blocker for memory) | in_progress | P51 |
| P53 — Grounding, capabilities and community vocabulary | pending | P51 |
| P54 — Retrieval, citations, code search and lookup | pending | P51 |
| P55 — Model profile and the probe as a release gate | pending | P52, P53 |
| P56 — Member records: a Staff forum with one post per member | in_progress | None |

## P00 — Freeze scope and deployment inputs

Status: **complete**. Phase: Foundation. Priority: P0.

Depends on: None. Acceptance: T01, T22.

Current owner policy, source precedence, unresolved inputs and MIT publication decision recorded. No deployment authorisation inferred.

Full task deliverables:

- Scope ledger and unresolved input manifest
- No-AI-in-tickets invariant recorded as superseding earlier proposals
- Sophie identity decision and source-asset set recorded; no-AI boundary unchanged

Boundary: No new product features or implicit approvals; all unknown IDs and credentials remain unset.

## P01 — Approve licence scope and persistence choice

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P00. Acceptance: T02.

Owner approved PostgreSQL infrastructure exception. pg 8.23.0 and exact indirect components/notices reviewed and pinned. Production Node/PostgreSQL distribution review remains open.

Implemented scope:

- Named PostgreSQL exception and exact pinned pg dependency/notice review.

Remaining scope:

- Production Node/PostgreSQL distribution and packaging review; separate model/runtime decisions if adopted.

Full task deliverables:

- Exact dependency/runtime/model inventory and notices
- Owner decision for indirect/tooling/platform scope; one approved storage and queue design

Boundary: Do not install unknown/non-MIT components or invent a custom database to bypass a gate.

## P02 — Inventory and baseline Windows host

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P00. Acceptance: T37.

Sanitised live inventory recorded; representative-load baseline, accounts and backup destination remain open.

Implemented scope:

- Sanitised inventory of this host and existing workload/port constraints.

Remaining scope:

- Representative-load baseline and approved service/data/backup layout.

Full task deliverables:

- CPU/RAM/disk/service/port inventory
- Resource baseline and deployment/recovery constraints

Boundary: Read-only inventory; do not disrupt existing services or claim unmeasured model speed.

## P03 — Discover Discord, wiki and design inputs

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P00. Acceptance: T08, T21, T27, T43, T49.

Role names, audiences, Shuttle source, retention and wiki endpoint/capabilities discovered. IDs, forms, publication and source-collection approval remain open. Permission candidate editor and per-type responder contracts are implemented locally at schema 045; approval does not activate a live policy. See docs/permission-configuration.md.

Implemented scope:

- Owner role/audience/retention decisions, preserved Shuttle source and MediaWiki capability discovery.
- Bounded permission configuration with retained drafts/candidates, running-base binding and reviewed role/category selections; deployment activation is separate.
- Owner-only durable seal intent commits before external writes; started/sent/uncertain/verified phases prevent blind resend and preserve uncertainty after read-only recovery.
- Held candidate-bound policy application atomically registers immutable policies, raises actor authorization epochs, migrates case version bindings, records explicit reconciliation jobs and retains a hashed receipt with the old configuration sections. Exact lost-commit recovery works with old or new configuration.

Remaining scope:

- Live IDs and capability map, final forms/copy/links, source/visual approvals; closed-case read-only audience is now approved.

Full task deliverables:

- Guild/role/channel ownership matrix and approved member baseline method
- MediaWiki capabilities, approved sources and website asset/token evidence
- Final Shuttle copy/forms and retention inputs
- Inspect the supplied Sophie manifest and existing WUFF addendum; distinguish these from still-unverified site tokens and load measurements

Boundary: No guessed IDs, website CSS, content licences or admission requirements.

## P04 — Bootstrap repository and contract checks

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P00. Acceptance: T02, T46, T60.

ESM/JSDoc foundation, built-in tests, exact dependency lock/notice checks and repository checks implemented. CI runner/tooling approval remains open.

Implemented scope:

- ESM/JSDoc contracts, approved dependency lock, synthetic fixtures, source-bound reports and repository checks.

Remaining scope:

- Approved CI runner/tooling and production build/packaging validation.

Full task deliverables:

- JavaScript ESM repository with runtime schemas/JSDoc
- Locked approved dependencies, CI and module-boundary tests
- Synthetic fixtures and build manifest

Boundary: No production secrets; TypeScript only after explicit approval. Dependency-free contract work may proceed under G0; package installation and deployable packaging still depend on P01.

## P05 — Implement authentication and shared capability policy

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P03, P04. Acceptance: T01, T03, T04, T05.

Shared current authorization now permits independently selected role lists for each configured administrative capability; 13 focused checks and 17 database scenarios pass. Case audiences still use configured functional groups. Reviewed permission/role/channel editing, flexible responder mapping, remaining route parity and live acceptance remain open. Permission candidate editor and per-type responder contracts are implemented locally at schema 045; approval does not activate a live policy. See docs/permission-configuration.md. Bounded sliding session renewal, one fresh Discord observation for session hints, and allowlisted return paths bound to OAuth state. Migration 046 preserves active session rows. O01–O19 pass; real provider/client renewal acceptance remains open. System-wording reads/writes independently require current guidance-publisher authority; concurrent edits conflict and exact uncertain saves replay without another revision. Local next-test feedback: verified arrival before one Begin Whitelist link, default one-hour closure notice, permission-filtered HTML with one-use session bootstrap and renewal, and Meridian-informed responsive presentation. 45 focused unit checks, 88 Onboarding/wording, 18 authorization and 16 runtime scenarios pass; synthetic desktop/mobile editing and quiet mode checked. See docs/whitelist-test-feedback.md. Subsequently deployed with owner authorization on pinned036c3db/schema054; 768 Git hashes, orderly shutdown, current Gateway, process/port ownership and 26 public checks passed. No migration, configuration, command or grant changes. Private client acceptance remains open.

Implemented scope:

- Signed Discord actors, persistent revocation/authority epochs, current capabilities and protected browser sessions.
- Ticket-form configuration routes use the same current authority and explicit capability, with CSRF and final response authorization.
- Current participant membership resolution/revalidation with an independent presence epoch; membership metadata grants neither an invitation nor Staff authority.
- Explicit participant actions require current case-specific Staff authority, confirmation and a retained membership binding; recipient status never grants management authority.
- Staff-contact selection, confirmation and submission bind the original/current Staff authority and selected membership; recipient navigation requires a current retained invitation and fresh channel proof.
- Configured administrative capabilities accept independent lists of up to fifty role IDs, without requiring the Staff or lead-ops role. Thirteen focused checks and A01–A17 verify current authority, selective grants, policy epochs and queued revocation. No live grant changed.
- Independent permissions.publish authority, current-role self-lockout protection, and per-type responder authorization/recorded-grant revocation; no case grant follows from editor access.
- Bounded sliding session renewal, one fresh Discord observation for session hints, and allowlisted return paths bound to OAuth state. Migration 046 preserves active session rows. O01–O19 pass; real provider/client renewal acceptance remains open.
- Candidate-bound deployment assessment with fresh permissions.publish checks, exact base/selection validation, aggregate retained-state blockers and stale-review rejection. Advisory only; no activation or writer fencing.
- Owner-only durable preparation barrier binds candidate/control snapshot, rejects active leases, drains runtime writers and gates all core DML, startup and new application/transport work. Old snapshots serialize-fail; cancelled holds cannot revive; observed holds require host restart. No Discord activation safety claimed.
- Held-operation role/channel observations use opaque expiring proofs bound to exact selectors, candidate and control snapshot; owner-only inventory retention rechecks state after I/O and handles exact uncertain retries without a second fetch. Inventories grant no write authority.
- Confirmed seal plans install permanent exclusions before Discord writes, including discovered channels. The adapter reads only current bot/role/channel metadata and can issue only fixed bot-only overwrites.
- Policy application rejects unresolved deliveries/transitions, requires fresh confirmed sealing for case-policy changes and preserves membership/presence and invitation history. Runtime release remains unavailable; capability-only changes do not touch case channels.
- System-wording reads/writes independently require current guidance-publisher authority; concurrent edits conflict and exact uncertain saves replay without another revision.

Remaining scope:

- Private owner/member acceptance of the installed website apply/reconciliation workflow and independently selected capability mappings; production OAuth/TLS and current authorization acceptance.

Full task deliverables:

- Discord/OAuth actor resolution and sessions
- Shared capability/access-epoch policy
- CSRF, guild binding and negative permission tests

Boundary: UI visibility cannot substitute for backend checks.

## P06 — Implement durable storage and outbox

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P01, P04. Acceptance: T15, T16, T36.

Thirty-three migrations are implemented; the running staging host is still on 032. Local control-history capture and restored-history checks extend quarantined file acquisition, authenticated reads/exports and read-only artifact inventory. Independent durability, recovery activation, repair/alerts and production identities remain open. 4 October local candidate: bounded metadata-only vault scan and retained-slot ownership guards verified; see docs/attachment-operations.md. No live vault scan or deployment. Local paged single-channel transcript exports retain the existing per-part limits and exclusions, bind exact input/continuation positions into review hashes, preserve exhausted-stream positions, and require explicit review/confirmation for each part. Distinct filenames and exact retries retain the existing audit without a migration. The browser rechecks account identity after fetch and preserves uncertain retries across routine access refresh. No AI case data path was added. See GitHub/.agent_docs/aphelion-sophie/paged-exports-2026-10-04/verification.json.

Implemented scope:

- Thirty verified migrations through retained conversations and attachment acquisition; transactions, receipts, leases, compensation, retained audits and synthetic failure/restart checks.
- Core-only create/update/delete observations, child-channel provenance and interruption/permission gaps; cursor/content atomicity and restart/replay evidence.
- Quarantined private file slots, policy/source hashes, atomic reference jobs and capacity reservations, bounded retries, late-write fencing and recovery without duplicate downloads.
- Migration 031 retains export-policy hashes and generation-attempt audit without copying case bodies or implying successful delivery.
- Read-only staging operator inventory: bounded guild job/attempt metadata and whole-vault accounting/pause diagnostics, plus one retained-file size/hash verification with current-selection recheck; no content output, repair, deletion or download grant.
- Migration 036 retains human reply requests and audit with current Staff/version/audience checks, atomic metadata-only outbox intent, bounded exact retries, confirmed delivery and sticky known-message withdrawal. Authenticated HTTP confirmation/history, corruption rejection, ambiguous-send/late-lease handling, actual encrypted retention and runtime capture are verified offline.
- Staff reply dashboard shares the retained reply API: literal text/case review, explicit confirmation, current access/version refresh, exact uncertain-submit retry, delivery history and private-data clearing. Twelve focused checks and synthetic Chromium interaction pass; no live deployment.
- Discord /ticket reply requires reviewed case/version, bounded human text and explicit confirmation. Signed text is a one-use core-only value, never routing/receipt data; shared reply service and worker enforce current authorization, stable redelivery identity and truthful outcomes. Fourteen focused command checks, thirteen intake/contact regressions, CR01–CR29 and RT01–RT10 pass offline.
- Parked human replies share the bounded signed /ticket issues queue, audited revision-checked Recheck and verified own-message adoption. Unknown sends cannot be blindly retried; normal workers confirm exact text/current original authority or withdraw. Migration 037 backfills issue metadata without resetting attempts or send state. Fourteen focused checks, CR01–CR36, 67 intake/recovery scenarios and RT01–RT10 pass offline.
- Additive migration 047 installs runtime write guards and owner-only maintenance receipts/gate. Held state survives encrypted quarantined restore; exact 046-to-047 synthetic upgrade retains all core rows. No live upgrade.
- Additive migration 048 retains explicit routing/overwrite metadata in owner-only inventory revisions, preserved by encrypted quarantine restore. A held 047 operation/generation survives migration unchanged.
- Additive schema 049 retains seal plans/effects and sealed-observation hashes; encrypted quarantine recovery preserves the journal, exclusions and held runtime barrier. Exact schema-048 inventory survives upgrade.
- Schema 050 retains application journals, pre/post control hashes, base configuration sections and job references. Confirmed discovered channels enter the capture registry with explicit gaps; maintenance entry records existing capture interruption immediately. Recovery keeps the barrier held.
- Local read-only whole-vault metadata scan reports bounded flat-directory classifications without following links, reading bodies or changing files/capacity. Inventory and backup reject cross-job retained slots and mismatched recorded sizes before reading content. Six focused checks, CA01–CA23/AO01–AO08 and RB01–RB11 pass; clusters stopped.

Remaining scope:

- Approved file downloads, safe artifact orphan reconciliation and repair/requeue, capacity alerts, production identities/composition and the independent restore watermark.

Full task deliverables:

- Logical schema realised in the approved engine
- Migrations, transactions, uniqueness, leases/fencing
- Idempotency, retry and reconciliation contracts

Boundary: Treat external delivery as at-least-once; no exactly-once claim.

## P07 — Package native service skeleton

Status: **in_progress**. Phase: Foundation. Priority: P0.

Depends on: P02, P04. Acceptance: T24, T37, T38.

Pinned 335a3f2/schema069 staging services are installed under separate virtual identities; worker stopped and AI disabled. A source-only 2c5d356 export update is prepared with guarded operator tooling. Actual worker OS denial/stop, production and independent recovery qualification remain open.

Implemented scope:

- Read-only inventory and offline/production-rejecting preflight.
- Explicit foreground staging host with loopback listeners, readiness-gated commands/workers, bounded shutdown, fixed diagnostics, database privilege/migration checks and configuration template; no service installation.
- Owner-authorized isolated foreground host at sophie.a13.info with a new dedicated loopback database, restricted core credentials and separately approved pinned cloudflared connector; no Windows service.
- Prepared a pinned 335a3f2/schema069 staging review packet and 512-file source archive. Read-only installed manifest/baseline/database checks pass; exact schema066-to069 preservation, idempotency and return-path boundary checks pass in a stopped disposable cluster. No installed state changed.
- Prepared the exact 512-file 2c5d356/schema069 source-only archive and guarded operator sequence. Archive/support-file hashes, script syntax and missing-approval rejection verified; not deployed.

Remaining scope:

- Production service packaging, separate Windows identities/ACLs, trusted HTTPS ingress, distribution review, operational monitoring and independent recovery.

Full task deliverables:

- Version-matched service scripts and ACL layout
- Separated core/knowledge/inference identities
- Liveness/readiness and redacted logs

Boundary: Do not expose inference/database or run as a personal administrator.

## P08 — Build dashboard shell and shared controls

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P04, P05. Acceptance: T42, T43.

The fixed-asset shell includes Shuttle/form authoring, authorized case reading/export, restricted notes, manual labels, case management, Staff-contact creation and recipient navigation. Shared authoring recovery, explicit confirmations, current-access clearing and synthetic browser/HTTP checks are recorded. Owner private-browser login is confirmed; production role/client acceptance, other Staff/configuration screens and full accessibility review remain open. Permission candidate editor and per-type responder contracts are implemented locally at schema 045; approval does not activate a live policy. See docs/permission-configuration.md. Owner feedback fixes: quiet authoring access refresh, coalesced focus checks, grouped service navigation, explicit Shuttle screens and local safe Markdown previews. 70 focused checks and synthetic browser save/review/publication/removal, sign-out clearing and return-page checks pass. See docs/dashboard-feedback.md. Historical pinned 2b984d2/schema046 staging passed encrypted preservation/restore and a 69-table comparison. Historical pinned036476f/schema053 restart and 12 public checks passed. Searchable shared System wording editor with Markdown preview, defaults, placeholders, durable revisions and quiet focus checks. Onboarding names in configuration navigation and code. Deployed pinned9479c2c/schema054 follow-up adds channel lifecycle/recovery, entry panel copy and login gating; see docs/onboarding-followup.md. Staging migration and /whitelist command rename verified; private retest remains. Local next-test feedback: verified arrival before one Begin Whitelist link, default one-hour closure notice, permission-filtered HTML with one-use session bootstrap and renewal, and Meridian-informed responsive presentation. 45 focused unit checks, 88 Onboarding/wording, 18 authorization and 16 runtime scenarios pass; synthetic desktop/mobile editing and quiet mode checked. See docs/whitelist-test-feedback.md. Subsequently deployed with owner authorization on pinned036c3db/schema054; 768 Git hashes, orderly shutdown, current Gateway, process/port ownership and 26 public checks passed. No migration, configuration, command or grant changes. Private client acceptance remains open. Local schema069 adds authenticated Shuttle assistance and delivery queues with explicit review, current authority and shared exact-receipt/proof operations. Help resolution preserves progress and eligibility; workers alone confirm repaired delivery. See docs/shuttle-assistance.md, docs/shuttle-delivery-issues.md and GitHub/.agent_docs/aphelion-sophie/shuttle-dashboard-2026-10-04/verification.json. This candidate is not deployed.

Implemented scope:

- Optional fixed-asset dashboard shell and reviewed Shuttle editor, with synthetic controller/HTTP/browser checks.
- Ticket-form authoring API with exact static review, retained history and guarded publication/withdrawal; no case/submission-content route.
- Browser ticket-form editing, static comparison/preview, publication/withdrawal, category protection and shared authoring recovery; synthetic keyboard/narrow/browser and integrated API/storage checks.
- Staff-contact is the seventh independent form category, using the same authoring API/browser review, publication and history; no submitted contact content is exposed.
- Authenticated channel-ID selection, text-only observation/gap pages and explicit browser export review/confirmation for all current readers; identity/access clearing, hidden-page late-response suppression and exact uncertain-download retry.
- Fixed the browser transport allowlist for Staff contact, restoring the seventh existing form category draft/history/review/publication reads; focused route regression coverage.
- Restricted human-authored Staff notes: attributed durable append receipts, current responder authorization, Head Admin isolation, plain-text browser history, exact uncertain-save retry and privacy clearing; excluded from member transcripts and control metadata, retained by encrypted core backup.
- Human-written case tags and manual priorities share a current-responder use case across signed Discord and authenticated dashboard routes, with retained attribution, optimistic case versions, exact retries, private history and no changes to permissions or delivery order.
- Dashboard Staff queue and main-channel lookup, reviewed assignment, close/reopen and participant changes share existing current-authorized core services, optimistic versions, retained audit/outbox and actor-bound exact receipts. Browser confirmation, uncertain retry and privacy clearing are verified offline.
- Staff-contact dashboard entry shares selection, audience confirmation, blank pinned forms, retained submission and verified creator navigation with Discord. Current authority, purpose-bound receipts, exact retries and privacy clearing are verified offline.
- Recipient dashboard discovery and verified destination links share the Discord contact navigation flow. Current invitation/membership checks, private metadata-only pagination, closed/read-only and preparing states, late-revocation denial and browser privacy clearing are verified offline.
- Owner-approved 1–20-step Shuttle authoring: add, reorder, confirmed removal, stable identities, bounded total text, immutable publications and pinned active runs. Completion and Discord controls derive from each retained version; 58 focused checks, 54 database scenarios and synthetic mobile/browser interaction pass.
- Reviewed /permissions browser with saved comparison, confirmation, retained history, exact retry, conflict handling and access-loss clearing.
- Owner feedback fixes: quiet authoring access refresh, coalesced focus checks, grouped service navigation, explicit Shuttle screens and local safe Markdown previews. 70 focused checks and synthetic browser save/review/publication/removal, sign-out clearing and return-page checks pass. See docs/dashboard-feedback.md.
- Saved permission review shows aggregate retained open/read-only/sealed cases, invitation status and queued/in-flight/parked work without exposing case identities or contents.
- Searchable shared System wording editor with Markdown preview, defaults, placeholders, durable revisions and quiet focus checks. Onboarding names in configuration navigation and code.
- Authenticated /case-delivery page and metadata-only API share ordinary ticket recheck, exact message adoption and retained-channel selection with signed commands. Current case authority, fresh opaque proofs, stable retry receipts and private-state clearing remain enforced; no AI or private-content read route. Schema068 adds only the login return path. Offline HTTP/database/browser evidence is recorded.
- Authenticated Shuttle assistance and delivery queues share current authority, exact receipts and trusted proofs with signed commands. Reviewed help resolution preserves progress and eligibility; delivery workers verify repairs. Schema069 adds only fixed login return paths; HTTP/database and synthetic browser checks pass.

Remaining scope:

- Independent live authentication/client, owner workflow/presentation review and full accessibility acceptance of the implemented dashboard.

Full task deliverables:

- Capability-aware navigation and common forms/tables/dialogs
- Accessible Sophie shell using bundled reference assets, with production placement approval still required
- Configuration draft/validate/publish flow

Boundary: No case AI widgets or page-context injection into previews.

## P09 — Implement Discord adapter and command plumbing

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P04, P05. Acceptance: T01, T05, T45.

Isolated test roles/channels, command registration, live Gateway, signed ticket navigation and private-browser OAuth are verified. Full live client/permission/error-recovery acceptance and production mapping remain open.

Implemented scope:

- Native fixed HTTP routes, signed bounded ingress, Gateway supervision, metadata-only observations and shared ordinary recovery commands with private reauthorized replies.
- Gateway removal, Identify and guild-gap revocation of participant membership; first-seen removal also invalidates existing Staff grants.
- Signed /ticket participant add/remove requires explicit selection, reason, confirmation and current case version; private loopback HTTP and recipient-triggered Gateway inspections are verified.
- Signed /ticket contact selection, audience confirmation and modal entry, plus /ticket contacts private recipient navigation; User Select resolved metadata is discarded.
- Explicit case-content Gateway handoff, fixed Guild Messages/Message Content intents, disabled-mode gaps and new Identify when capture mode changes; native loopback coverage.
- Staging composition of existing adapters plus explicit application/bot-verified guild command registration; complete synthetic signed Shuttle progression and role delivery.
- Test-only explicit self-bootstrap creates and verifies dedicated roles/channels, verifies guild owner before assigning the new Head Admin role, registers fixed commands and writes configuration; ambiguous creates halt behind durable local receipts.
- Live identity/guild/permission preflight succeeded; first test role creation exposed tied numeric positions. Specific hierarchy diagnostic and receipt-preserving correction/resume contract verified. Live bootstrap remains incomplete.
- Owner-authorized isolated Discord bootstrap verified live: five zero-permission roles, private case category/test lobby, current owner Head Admin role and four fixed guild commands. Manage Roles overwrite and HTTP 201 compatibility defects corrected; exact existing category reconciled without duplication.
- Live Gateway current; Discord accepted the signed public interaction endpoint. Unsigned/forged signatures rejected over HTTPS. OAuth callback registered and a completed owner login verified; editor visibility confirmed by the owner on a private machine.

Remaining scope:

- Fresh test application and six commands are installed; complete independent Discord client, role hierarchy, remaining workflow and production registration acceptance.

Full task deliverables:

- Version-matched Discord HTTP/Gateway compatibility evidence; review and pin any SDK before adoption
- Gateway routing, prompt acknowledgment and modal handling
- Shared service invocation and rate-limit/error behaviour
- Apply the shared Sophie display identity in staging; live profile/avatar changes require release approval

Boundary: Only the core owns the production token; optional voice remains absent.

## P10 — Implement ticket provisioning and state

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P06, P09. Acceptance: T06, T08, T16, T59.

Quick Help, seven authored form categories, participant/contact workflows, retained observations, confirmed bounded exports and persistent ticket-link DMs are implemented. Two live Quick Help channels/navigation and DM receipts are verified. Archive placement, other live workflows and unresolved external-result acceptance remain open.

Implemented scope:

- Private provisioning, quotas, retained lifecycle, duplicate sealing/selection, forms/intake, ordered answer delivery/recovery, ownership and periodic permission inspections.
- Retained configurable form drafts, static review and immutable publication share the existing intake version policy.
- Browser configuration of seven form categories: five ordinary forms, player reports and Staff contacts, over the retained authoring API.
- Signed player-report intake with a pinned optional subject, retained versioned answers and private delivery; subjects confer no audience or management access.
- Participant membership prerequisite: current human eligibility and durable revocation, separate from explicit invitations and case access.
- Existing-case participant additions/removals with retained invitations, versioned audiences, current delivery proofs and revocation reconciliation across ordinary cases and Shuttle.
- Initial Staff-created contacts with explicit audience review, pinned blank forms, atomic answers/invitations, initial-authority revocation and private recipient navigation.
- Verified root candidates and discovered descendants retain immutable case provenance and permanent exclusions for conversation capture.

Remaining scope:

- Unidentified or uninspectable external results, final forms, archive placement, attachment operations and confirmed transcript exports/downloads; independent live acceptance of the implemented Staff-contact dashboard.

Full task deliverables:

- Case type/form versions and opener/subject/participant separation
- Private-channel provisioning with operation markers
- Recoverable open/close state

Boundary: Reported subject is never auto-invited.

## P11 — Implement case permissions and staff lifecycle

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P05, P10. Acceptance: T07, T09, T56.

Current audiences and responder authority cover lifecycle, queues, assignment, ordinary repair, participants and initial Staff contacts. Dashboard creation and recipient navigation share the existing core/Discord services; destinations require current invitations and exact private-channel proof. Notes/labels and case management are verified offline. Controlled downloads, uninspectable effects, closed-audience policy approval and independent live checks remain open. Permission candidate editor and per-type responder contracts are implemented locally at schema 045; approval does not activate a live policy. See docs/permission-configuration.md.

Implemented scope:

- Current private audiences and responder checks; audited close/reopen/ownership, periodic ACL repair, ordinary delivery rechecks and retained channel selection.
- Versioned participant add/remove with explicit confirmation, retained actor/reason/invitation audit, exact channel audiences, departure/rejoin revocation and late-effect compensation.
- Initial contact invitations and current recipient navigation; lost initial Staff authority/all recipients blocks first creation, late effects are sealed, and explicit reopening never restores revoked invitations.
- Capture access gaps on channel/role/bot changes; only a separate verified root-channel inspection clears its permission interval. Child provenance does not confer read access.
- Human-written case tags and manual priorities share a current-responder use case across signed Discord and authenticated dashboard routes, with retained attribution, optimistic case versions, exact retries, private history and no changes to permissions or delivery order.
- Dashboard Staff queue and main-channel lookup, reviewed assignment, close/reopen and participant changes share existing current-authorized core services, optimistic versions, retained audit/outbox and actor-bound exact receipts. Browser confirmation, uncertain retry and privacy clearing are verified offline.
- Staff-contact dashboard entry shares selection, audience confirmation, blank pinned forms, retained submission and verified creator navigation with Discord. Current authority, purpose-bound receipts, exact retries and privacy clearing are verified offline.
- Recipient dashboard discovery and verified destination links share the Discord contact navigation flow. Current invitation/membership checks, private metadata-only pagination, closed/read-only and preparing states, late-revocation denial and browser privacy clearing are verified offline.
- Migration 036 retains human reply requests and audit with current Staff/version/audience checks, atomic metadata-only outbox intent, bounded exact retries, confirmed delivery and sticky known-message withdrawal. Authenticated HTTP confirmation/history, corruption rejection, ambiguous-send/late-lease handling, actual encrypted retention and runtime capture are verified offline.
- Optional per-type responder maps shared across application authorization, queues, issue lists, channel role overwrites and static notifications; Head Admin and sealed-case privacy preserved.
- Fresh whole-guild metadata verifies every planned channel is sealed before the operation advances; original case state, desired open/closed/sealed access and registered policies are preserved.
- Migrated case jobs are compatible with the existing current-eligibility dispatcher in a synthetic owner composition: Head Admin restrictions, closed read-only access, legacy seals and departed-opener denial preserved. A production maintenance coordinator remains unimplemented.

Remaining scope:

- Controlled file downloads, live notes/labels/management/contact/recipient acceptance, live enforcement of the approved closed-case audience, unidentified or uninspectable effects and live permission checks.

Full task deliverables:

- Effective permission validation and category-change handling
- Claim/reassign/participant/close/reopen services
- Restricted staff notes and audit events

Boundary: Do not promise privacy from Discord Administrator privileges.

## P12 — Implement transcripts and attachment policy

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P06, P11. Acceptance: T10, T11, T12, T35, T57.

Capture, quarantined acquisition, authenticated reads and confirmed bounded exports now have a browser reader for all current readers. Current-authorized channel lookup and browser lifecycle/confirmation checks pass offline and in synthetic Chromium. File downloads, artifact operations and live case/recovery acceptance remain open. A staging-only read-only operator tool now inventories metadata/accounting and checks one retained file against its pinned hash. 4 October local candidate: bounded metadata-only vault scan and retained-slot ownership guards verified; see docs/attachment-operations.md. No live vault scan or deployment. Local paged single-channel transcript exports retain the existing per-part limits and exclusions, bind exact input/continuation positions into review hashes, preserve exhausted-stream positions, and require explicit review/confirmation for each part. Distinct filenames and exact retries retain the existing audit without a migration. The browser rechecks account identity after fetch and preserves uncertain retries across routine access refresh. No AI case data path was added. See GitHub/.agent_docs/aphelion-sophie/paged-exports-2026-10-04/verification.json.

Implemented scope:

- Immutable core message observations with atomic Gateway cursor commits, duplicate/lost-acknowledgement handling, known-case/child routing, bounded inert payloads, field-loss markers, indefinite retention and restart.
- Retained initial-history, disconnect, Identify, guild, sequence, permission and rejected-payload gaps; successful replay never certifies complete history.
- Explicit type/count/size/storage/deadline policy, exact CDN identity and public DNS restrictions, exclusive private file slots, retained failure reasons, conservative reservations, fresh policy checks and recovery across two database restarts.
- Authenticated five-observation/25-gap pages through the fixed dashboard listener; current case and selected-child authorization, independent membership epochs, logout/revocation suppression, escaped inert content and attachment status only.
- Confirmed bounded single-channel transcript exports with exact review hash, explicit audience policy, current authorization, metadata-only generation audit, no-store inert HTML attachment and post-audit revocation checks; TR01–TR11/EX01–EX08.
- Owner-approved current-reader export audience is composed into the staging host; RT10 verifies member OAuth review/confirmed attachment delivery.
- Authenticated channel-ID selection, text-only observation/gap pages and explicit browser export review/confirmation for all current readers; identity/access clearing, hidden-page late-response suppression and exact uncertain-download retry.
- Read-only staging operator inventory: bounded guild job/attempt metadata and whole-vault accounting/pause diagnostics, plus one retained-file size/hash verification with current-selection recheck; no content output, repair, deletion or download grant.
- Local read-only whole-vault metadata scan reports bounded flat-directory classifications without following links, reading bodies or changing files/capacity. Inventory and backup reject cross-job retained slots and mismatched recorded sizes before reading content. Six focused checks, CA01–CA23/AO01–AO08 and RB01–RB11 pass; clusters stopped.

Remaining scope:

- Owner-approved file-download/scanning policy; multi-channel/frozen-archive export design; controlled hash-verified downloads; reviewed requeue/repair and orphan disposition, larger-vault operational qualification, capacity alert thresholds, Windows ACLs and independent restoration.

Full task deliverables:

- Authenticated private artifacts and escaped rendering
- Bounded attachment path and coverage-gap reporting
- Owner-approved retention enforced

Boundary: No public permanent transcript links or AI ingestion.

## P13 — Implement Onboarding content editor and definitions

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P08, P10. Acceptance: T19, T42.

Shuttle supports 1–20 editable/reorderable steps, confirmed removal, saved comparison/publication, history and exact retry. Existing runs retain their original count/order. 58 focused checks, 54 isolated database scenarios and synthetic mobile/browser checks pass. Owner will author final copy; live acceptance and override/migration controls remain open. Explicit 1–5 screens per step with add/reorder/confirmed removal, retained boundaries and Markdown preview. Owner selected Next/Back before final-screen acknowledgement. Existing publications/runs remain unchanged. E01–E24/V01–V19/W01–W12 pass (55 scenarios). Historical pinned 2b984d2/schema046 staging passed encrypted preservation/restore and a 69-table comparison. Historical pinned036476f/schema053 restart and 12 public checks passed. One shared server wording catalogue is separate from authored guidance. Development files/exports/content and canonical authoring routes use Onboarding; stored protocols and endpoint/session compatibility aliases remain stable. Deployed pinned9479c2c/schema054 follow-up adds channel lifecycle/recovery, entry panel copy and login gating; see docs/onboarding-followup.md. Staging migration and /whitelist command rename verified; private retest remains. Local next-test feedback: verified arrival before one Begin Whitelist link, default one-hour closure notice, permission-filtered HTML with one-use session bootstrap and renewal, and Meridian-informed responsive presentation. 45 focused unit checks, 88 Onboarding/wording, 18 authorization and 16 runtime scenarios pass; synthetic desktop/mobile editing and quiet mode checked. See docs/whitelist-test-feedback.md. Subsequently deployed with owner authorization on pinned036c3db/schema054; 768 Git hashes, orderly shutdown, current Gateway, process/port ownership and 26 public checks passed. No migration, configuration, command or grant changes. Private client acceptance remains open.

Implemented scope:

- Immutable guidance, retained drafts, publication/withdrawal services and a browser review/history editor.
- Owner-approved 1–20-step Shuttle authoring: add, reorder, confirmed removal, stable identities, bounded total text, immutable publications and pinned active runs. Completion and Discord controls derive from each retained version; 58 focused checks, 54 database scenarios and synthetic mobile/browser interaction pass.
- Explicit 1–5 screens per step with add/reorder/confirmed removal, retained boundaries and Markdown preview. Owner selected Next/Back before final-screen acknowledgement. Existing publications/runs remain unchanged. E01–E24/V01–V19/W01–W12 pass (55 scenarios).
- One shared server wording catalogue is separate from authored guidance. Development files/exports/content and canonical authoring routes use Onboarding; stored protocols and endpoint/session compatibility aliases remain stable.

Remaining scope:

- Owner copy/link approval, workflow migration/override controls and live/full accessibility acceptance.

Full task deliverables:

- Immutable published workflow versions
- Owner-provided copy/forms, preview and withdrawal/migration controls

Boundary: No generated admissions rules; no infinite visual workflow builder.

## P14 — Implement deterministic Onboarding progression

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P06, P13. Acceptance: T13, T14, T15, T17, T19, T55.

Progression, final acknowledgement and delivery validate the pinned definition count from 1–20. Original five-step runs remain compatible; observed grants and pause/revocation checks pass offline. Unidentified external effects and independent live presentation remain open. Versioned screen index and definition screen counts gate step acknowledgement and Whitelist delivery. Navigation shares nonce, current-authority, pause and revocation fences. Legacy sessions retain their original shape and behavior; no automatic run migration. A run retains one Discord message anchor with versioned controls. Page turns/help/completion edit it in place, omit internal footers and suppress routine progress replies. Uncertain edits and pre-upgrade message recovery retain current authority. Deployed pinned9479c2c/schema054 follow-up adds channel lifecycle/recovery, entry panel copy and login gating; see docs/onboarding-followup.md. Staging migration and /whitelist command rename verified; private retest remains. Local next-test feedback: verified arrival before one Begin Whitelist link, default one-hour closure notice, permission-filtered HTML with one-use session bootstrap and renewal, and Meridian-informed responsive presentation. 45 focused unit checks, 88 Onboarding/wording, 18 authorization and 16 runtime scenarios pass; synthetic desktop/mobile editing and quiet mode checked. See docs/whitelist-test-feedback.md. Subsequently deployed with owner authorization on pinned036c3db/schema054; 768 Git hashes, orderly shutdown, current Gateway, process/port ownership and 26 public checks passed. No migration, configuration, command or grant changes. Private client acceptance remains open. Local schema069 adds authenticated Shuttle assistance and delivery queues with explicit review, current authority and shared exact-receipt/proof operations. Help resolution preserves progress and eligibility; workers alone confirm repaired delivery. See docs/shuttle-assistance.md, docs/shuttle-delivery-issues.md and GitHub/.agent_docs/aphelion-sophie/shuttle-dashboard-2026-10-04/verification.json. This candidate is not deployed.

Implemented scope:

- Pinned deterministic five-page progression, private controls/navigation, human-help pauses and current-policy recovery.
- Owner-approved 1–20-step Shuttle authoring: add, reorder, confirmed removal, stable identities, bounded total text, immutable publications and pinned active runs. Completion and Discord controls derive from each retained version; 58 focused checks, 54 database scenarios and synthetic mobile/browser interaction pass.
- Versioned screen index and definition screen counts gate step acknowledgement and Whitelist delivery. Navigation shares nonce, current-authority, pause and revocation fences. Legacy sessions retain their original shape and behavior; no automatic run migration.
- A run retains one Discord message anchor with versioned controls. Page turns/help/completion edit it in place, omit internal footers and suppress routine progress replies. Uncertain edits and pre-upgrade message recovery retain current authority.

Remaining scope:

- Unidentified external-result resolution and live end-to-end presentation.

Full task deliverables:

- Start/resume/advance/back/human-help state machine
- Component nonce/version checks and control reconstruction

Boundary: Neither Discord role visibility nor a model determines progress.

## P15 — Implement role ownership, restoration and revocation

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P06, P09. Acceptance: T18, T20, T21, T53, T54.

Crew join reconciliation, ordered mute/unmute, restrictive intent, current moderator reauthorization, competing decisions and late-result inspection are tested. Ordered Gateway wire ingestion schedules role inspection and preserves replayed revocations; a native loopback join triggers Crew delivery. Reviewed moderation recovery is now a local schema067 candidate: current actor/original grant checks, action/eligibility/job fencing and exact retry receipts. Twenty-one focused unit checks, M01–M20 and twenty-one composed runtime scenarios pass; synthetic browser confirmation and expired-decision checks pass. Live capability/ID mapping and effective channel permissions remain open. Permission candidate editor and per-type responder contracts are implemented locally at schema 045; approval does not activate a live policy. See docs/permission-configuration.md.

Implemented scope:

- Crew/Muzzled reconciliation, durable mute/unmute, ownership boundaries and loss/departure invalidation.
- Permission candidates preserve Crew/Muzzled/Whitelist and external role ownership; role remapping and live activation need separately reviewed migration.
- Sealing is bound to the held reviewed permission candidate and exact inventory, requires confirmation and current bot authority, and prevents preparation cancellation after effects begin.
- Reviewed policy versions and actor epochs advance without rewriting history. Old saved grants and old configuration are denied. Capability-only application leaves case policies/provisions and Discord audiences unchanged.
- Reviewed /moderation status and explicit retry for one member, using current target capability, original moderator authority, action/eligibility/job fences and exact durable receipts; uncertain dispatch is retained for current-role inspection. Migration067 extends the OAuth return allowlist only; installed staging remains schema066.

Remaining scope:

- Authorized deployment and private live acceptance of moderation recovery; any approved cosmetic-role allowlist, actual capability mapping and effective channel permissions.

Full task deliverables:

- Crew default role except Muzzled; durable mute/unmute and current-policy reconciliation
- Whitelist loss/departure epochs; no snapshot-based Whitelist restoration; fresh Shuttle required
- External BYOND ownership, current role hierarchy and conservative cosmetic-role allowlists

Boundary: No privileged-role restoration or external-bot role interference.

## P16 — Integrate final Shuttle grant and recovery

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P14, P15. Acceptance: T15, T18, T19.

Automatic Whitelist delivery and observed-role confirmation have revocation, pause, closure and late-effect guards. Case closure cancels pending grants and compensates possible effects while preserving earned access. Reopening requires a fresh final acknowledgement. Staff recovery records intent only. Unidentified results, live composition and staging remain open. Local schema069 adds authenticated Shuttle assistance and delivery queues with explicit review, current authority and shared exact-receipt/proof operations. Help resolution preserves progress and eligibility; workers alone confirm repaired delivery. See docs/shuttle-assistance.md, docs/shuttle-delivery-issues.md and GitHub/.agent_docs/aphelion-sophie/shuttle-dashboard-2026-10-04/verification.json. This candidate is not deployed.

Implemented scope:

- Acknowledged/pending/observed completion, revocation checks, late-effect compensation and audited recovery.

Remaining scope:

- Unidentified external effects, approved human override controls, production composition and staging.

Full task deliverables:

- Acknowledged/role-pending/complete outcomes
- Grant confirmation, late-effect compensation and operator repair
- Human assistance and logged overrides

Boundary: Success requires confirmed delivery; AI is never involved.

## P17 — Complete staff ticket UX and commands

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P08, P11, P12. Acceptance: T05, T07, T10, T26, T42.

Shared case tools, public-answer lookup, reviewed ordinary delivery recovery and Shuttle assistance/recovery dashboard parity are implemented locally. OAuth and signed commands share exact receipts, current authority and trusted proof issuers; metadata-only queues require explicit confirmation. Controlled downloads and independent live acceptance remain open.

Implemented scope:

- Private assistance/recovery queues, case status, claims/reassignment, intake navigation, ordered answer/notice delivery and audited ordinary message/channel recovery.
- Explicitly authorized ticket-form configuration API, retained author history and withdrawal review.
- Reviewed browser form configuration with protected category switching, retained history and exact uncertain-action recovery.
- Player-report entry and its sixth configuration category share the existing authenticated form, case and delivery use cases.
- Signed existing-case participant add/remove and selected-member status, with current case-specific Staff authority, explicit confirmation, retained audit and revocation repair.
- Initial Staff-contact selection/review/form submission and a bounded private recipient queue, including closed read-only destinations and removal/departure denial.
- Authenticated channel-ID selection, text-only observation/gap pages and explicit browser export review/confirmation for all current readers; identity/access clearing, hidden-page late-response suppression and exact uncertain-download retry.
- Restricted human-authored Staff notes: attributed durable append receipts, current responder authorization, Head Admin isolation, plain-text browser history, exact uncertain-save retry and privacy clearing; excluded from member transcripts and control metadata, retained by encrypted core backup.
- Human-written case tags and manual priorities share a current-responder use case across signed Discord and authenticated dashboard routes, with retained attribution, optimistic case versions, exact retries, private history and no changes to permissions or delivery order.
- Dashboard Staff queue and main-channel lookup, reviewed assignment, close/reopen and participant changes share existing current-authorized core services, optimistic versions, retained audit/outbox and actor-bound exact receipts. Browser confirmation, uncertain retry and privacy clearing are verified offline.
- Staff-contact dashboard entry shares selection, audience confirmation, blank pinned forms, retained submission and verified creator navigation with Discord. Current authority, purpose-bound receipts, exact retries and privacy clearing are verified offline.
- Recipient dashboard discovery and verified destination links share the Discord contact navigation flow. Current invitation/membership checks, private metadata-only pagination, closed/read-only and preparing states, late-revocation denial and browser privacy clearing are verified offline.
- Inactive human-reply renderer and private-message adapter: attributed bounded human text, mention suppression, current exact-channel proofs and narrow known-own-message withdrawal. Twenty-two focused synthetic checks pass; durable requests, authorization, worker and human controls are not yet implemented.
- Migration 036 retains human reply requests and audit with current Staff/version/audience checks, atomic metadata-only outbox intent, bounded exact retries, confirmed delivery and sticky known-message withdrawal. Authenticated HTTP confirmation/history, corruption rejection, ambiguous-send/late-lease handling, actual encrypted retention and runtime capture are verified offline.
- Staff reply dashboard shares the retained reply API: literal text/case review, explicit confirmation, current access/version refresh, exact uncertain-submit retry, delivery history and private-data clearing. Twelve focused checks and synthetic Chromium interaction pass; no live deployment.
- Discord /ticket reply requires reviewed case/version, bounded human text and explicit confirmation. Signed text is a one-use core-only value, never routing/receipt data; shared reply service and worker enforce current authorization, stable redelivery identity and truthful outcomes. Fourteen focused command checks, thirteen intake/contact regressions, CR01–CR29 and RT01–RT10 pass offline.
- Parked human replies share the bounded signed /ticket issues queue, audited revision-checked Recheck and verified own-message adoption. Unknown sends cannot be blindly retried; normal workers confirm exact text/current original authority or withdraw. Migration 037 backfills issue metadata without resetting attempts or send state. Fourteen focused checks, CR01–CR36, 67 intake/recovery scenarios and RT01–RT10 pass offline.
- Curated public-answer service and authenticated API: exact review/public-source attestation, optional default-denied publication capability, current member lookup, immutable publication/withdrawal receipts, bounded pages/capacity and no ticket import or send path. Seven focused checks, CA01–CA13 including encrypted restore, and RT01–RT11 pass offline.
- Public-answer browser uses shared current-authority APIs for member lookup, literal editorial review, public-source confirmation, publication and withdrawal. Unsaved switching protection, changed-revision comparison, exact uncertain retry, bounded history and private-data clearing are verified by 25 focused tests and synthetic Chromium. RT01–RT11 pass offline.
- Signed Discord /answer list and /answer show share the curated public library with current member authorization at response time. Full approved text/source/revision, bounded pagination, withdrawal and departure are verified. Eighteen focused command/registration/reply checks, eight bootstrap checks and RT01–RT11 pass offline.
- Approved public answers can be selected explicitly in the case-reply browser and shared confirmed API. Migration 039 retains source name/revision/hash and exact text. Atomic publication checks reject stale new selections; exact prior receipts survive withdrawal without duplicating replies. Current case authority, final revocation, source races, migration preservation, encrypted restore and browser privacy/retry are verified offline.
- Discord /ticket answer provides full approved-text review and explicit Confirm/Cancel through the shared reply transaction. Migration 040 retains author-bound metadata and source identity. Ten-minute expiry, five-review capacity, current grant/case/audience/publication checks, concurrent clicks, lost-commit exact retry and encrypted restore are verified offline.
- Authenticated /case-delivery page and metadata-only API share ordinary ticket recheck, exact message adoption and retained-channel selection with signed commands. Current case authority, fresh opaque proofs, stable retry receipts and private-state clearing remain enforced; no AI or private-content read route. Schema068 adds only the login return path. Offline HTTP/database/browser evidence is recorded.
- Authenticated Shuttle assistance and delivery queues share current authority, exact receipts and trusted proofs with signed commands. Reviewed help resolution preserves progress and eligibility; delivery workers verify repairs. Schema069 adds only fixed login return paths; HTTP/database and synthetic browser checks pass.

Remaining scope:

- Controlled downloads and independent live acceptance of implemented ticket and Shuttle dashboard workflows. Unidentifiable message results remain operator review; no blind resend.

Full task deliverables:

- Permitted queues, case detail, notes and participant controls
- Human replies, canned-answer selection and transcripts
- Command/dashboard parity

Boundary: No summaries, drafting, triage or conversation-transfer AI.

## P18 — Implement simple automation and curated answers

Status: **in_progress**. Phase: Administration. Priority: P1.

Depends on: P08, P09. Acceptance: T45.

Curated replies, reviewed static rules, durable admission/delivery, operator recovery and the configuration/recovery browser are verified offline. Independent acceptance remains open; live activation stays off.

Implemented scope:

- Curated public-answer service and authenticated API: exact review/public-source attestation, optional default-denied publication capability, current member lookup, immutable publication/withdrawal receipts, bounded pages/capacity and no ticket import or send path. Seven focused checks, CA01–CA13 including encrypted restore, and RT01–RT11 pass offline.
- Public-answer browser uses shared current-authority APIs for member lookup, literal editorial review, public-source confirmation, publication and withdrawal. Unsaved switching protection, changed-revision comparison, exact uncertain retry, bounded history and private-data clearing are verified by 25 focused tests and synthetic Chromium. RT01–RT11 pass offline.
- Signed Discord /answer list and /answer show share the curated public library with current member authorization at response time. Full approved text/source/revision, bounded pagination, withdrawal and departure are verified. Eighteen focused command/registration/reply checks, eight bootstrap checks and RT01–RT11 pass offline.
- Approved public answers can be selected explicitly in the case-reply browser and shared confirmed API. Migration 039 retains source name/revision/hash and exact text. Atomic publication checks reject stale new selections; exact prior receipts survive withdrawal without duplicating replies. Current case authority, final revocation, source races, migration preservation, encrypted restore and browser privacy/retry are verified offline.
- Discord /ticket answer provides full approved-text review and explicit Confirm/Cancel through the shared reply transaction. Migration 040 retains author-bound metadata and source identity. Ten-minute expiry, five-review capacity, current grant/case/audience/publication checks, concurrent clicks, lost-commit exact retry and encrypted restore are verified offline.
- Static automation configuration/API retains reviewed public policies and withdrawals under optional default-denied publisher authority. Bounded literal message/reaction rules, explicit channels, priority/stop and synthetic per-user/channel cooldown timelines share one pure policy. Current channel metadata and retained case exclusions gate review/publication; previews never store sample text or send. Migration 041, concurrency, revocation rollback, exact lost-commit retry and encrypted restore are verified offline.
- Explicitly enabled Gateway admission uses opaque transient message proofs, current channel/case exclusions and the reviewed literal rules. Cursor, metadata-only receipts, stable rule-ID cooldowns, approved-action references and bounded outbox jobs commit together. Migration 042 retains activation mode and admission state. Replay, capacity, rollback, fresh-service lost-commit recovery, encrypted restore and independent case capture are verified offline.
- Queued static messages and reactions now use current publication, source/channel metadata, human/bot permissions, Gateway continuity and a 60-second deadline. Migration 043 retains possible-send state, positive receipts, sticky compensation and metadata audit. Unknown creates park without repeats; late receipts, lost commits, idempotent removal, encrypted restore and composed runtime delivery are verified offline.
- Current-authorized automation recovery now provides bounded metadata queue/history and confirmed recheck/verified-effect adoption through authenticated APIs. Migration 044 retains operator request receipts and linked audit. Stale/concurrent controls, exact lost-commit replay, no absent-effect resend, preserved cooldown/pause/quarantine, revocation rollback, encrypted restore and composed runtime recovery are verified offline.
- Automation browser at /automation uses the shared pure policy and authenticated APIs for literal rule editing, reviewed publication/withdrawal, synthetic preview, retained history and metadata recovery. Exact uncertain retries, changed-state review invalidation and access/visibility clearing are implemented; unknown sends cannot be rechecked or blindly repeated.

Remaining scope:

- Independent browser/Discord/member/editor acceptance of lookup, publication, full-text review, expiry, cancellation and confirmed reply selection.
- Keep live activation disabled pending independent T45 loop/mention/permission/deadline/recovery checks; qualify browser behavior in the owner’s private session after the safe staging upgrade.
- Independent public-source/copy approval and full T45 live acceptance.

Full task deliverables:

- Literal/bounded rules, cooldowns, mention suppression
- Join/static response previews and manually curated answers

Boundary: Generic auto-responses ignore tickets and bot/webhook loops.

## P19 — Enforce AI exclusion at every boundary

Status: **in_progress**. Phase: Knowledge. Priority: P0.

Depends on: P05, P06, P07, P10. Acceptance: T22, T23, T24, T25, T26, T46.

Core metadata guards, permanent exclusions and separate private case-content capture remain enforced. Expanded P19-RT22 now covers qualified Gateway exclusions plus actual authenticated form authoring/review/submission, confirmed private intake delivery, Staff notes and transcript HTML/attachment metadata. Two public controls use a real restricted knowledge library and an available synthetic worker. All 22 composed scenarios pass; a subsequent valid held reply is cancelled before deadline when its public destination moves into the protected category, with no Discord write or AI effect. Actual worker OS/file/network isolation, physical stop and full release acceptance remain open.

Implemented scope:

- Permanent case exclusions, guarded metadata boundaries, core-only submitted-value handoff and denied knowledge database access; ordinary recovery descriptors/audits exclude answer content.
- Ticket-form authoring reads authored configuration only; no case, modal-handle, submission, conversation or transcript queries.
- Form browser previews contain authored configuration only, render it as text and have no submission or AI path.
- Reported identities remain core-only context; no subject lookup, AI handoff, participant grant or user notification.
- Invitation and action records stay core-only; no knowledge read or automatic deletion, case subjects remain separate and static replies contain no case excerpts.
- Contact form values remain in core intake/delivery; recipient pages expose bounded authorized metadata only, with no content previews, automatic chat transfer, AI request or recipient ping.
- Separate core-only case-content handoff reads registered-channel bodies only; metadata, outbox and knowledge contain no copied conversation values. Descendant exclusions survive moves/deletion.
- Attachment references, file bytes and storage records stay in core; no token/cookies on CDN requests, no content in ordinary outbox/receipts, no public file route or AI path.
- Restricted human-authored Staff notes: attributed durable append receipts, current responder authorization, Head Admin isolation, plain-text browser history, exact uncertain-save retry and privacy clearing; excluded from member transcripts and control metadata, retained by encrypted core backup.
- P19-RT22: enabled synthetic configuration/qualification/consent through loopback Gateway. A public control reaches knowledge and worker; permanent roots, child threads, moved exclusions and protected-category contexts produce no source fetches, further knowledge/model calls, request receipts, provider attempts or effects. Every sentinel reaches qualification and shutdown drains pending work before assertions.
- Expanded P19-RT22: authenticated Staff-contact form publication/submission and confirmed private delivery; Staff-note append/read; captured message and attachment metadata; authorized transcript read/review/download. Real public knowledge has a positive match but no case-ID/transcript-link result. Every AI/knowledge table is free of raw or Markdown-escaped sentinels; the restricted knowledge identity cannot read the four case-content tables. Default member cooldown and actual intake retry times are respected. A standalone member command opens a blank ordinary form; this does not qualify a separate AI-to-Staff control.
- P19-RT22 delivery race: an admitted public turn reaches an available synthetic worker with a schema-valid reply held in flight. A committed loopback CHANNEL_UPDATE moves the destination to the protected category, aborts the worker signal before deadline and records cancellation. The worker deliberately returns after abort; no Discord write, message or AI effect results. Both earlier public positive controls and all artifact exclusions still pass in the final 22-scenario run.
- P24/T26 core-owned Contact staff control now has signed HTTP and composed database evidence for private member routing, empty fields and no AI source transfer; independent live acceptance remains open.

Remaining scope:

- Actual worker OS identity/filesystem/network isolation and physical stop; independent live exclusions and complete T22–T26 release acceptance. Attachment-byte downloads remain absent pending owner policy. The separate Contact staff control is implemented locally with blank-form and source-exclusion evidence. Synthetic qualification and cancellation are not operational clearance.

Full task deliverables:

- Ingress/delivery classification guard and permanent case exclusions
- Worker/database/filesystem isolation
- Sentinel tests and architecture import restrictions

Boundary: No toggle or staff bypass can enable AI inside cases.

## P20 — Implement MediaWiki ingestion and sync

Status: **in_progress**. Phase: Knowledge. Priority: P0.

Depends on: P03, P06, P19. Acceptance: T23, T27, T28.

Fixed Policies collection, immutable snapshots, fenced manual/serialized refresh and source-bound publication review are implemented; installed knowledge-only composition has metadata-only refresh evidence. Reviewed publication and live source/lookup acceptance remain open.

Implemented scope:

- Actual MediaWiki 1.46.0/site licence/capabilities discovered and source collection fixed to Policies.
- Fixed-origin, no-redirect, bounded read-only collector rechecks article/template/rights/rendered state.
- Worker-bounded extraction retains headings, lists, table cells/spans/headers and anchors; 14 focused checks pass.
- Owner approved parse5 8.0.1 and indirect entities 8.1.0; exact package hashes and notices recorded.
- Migration059 stores immutable bounded snapshots/extracts, fenced jobs and receipt input hashes. Source changes revoke old document epochs; review hashes bind source generations, including reversions. Currentness verifies stored integrity and five-minute source freshness.
- Manual publisher source review safely renders structured text and retains wiki binding/attribution across edits. Refresh does not publish and cannot occupy the administrative HTTP request slot.
- Native composition supplies serialized fixed-source refresh with cancellation. The installed knowledge-only editor and read identity are isolated; a Policies refresh reached ready without automatic publication. Evidence remains bound to its recorded installed source.

Remaining scope:

- Review and publish fresh Policies extracts and separate Discord rules. Installed fixed-source refresh and direct lookup need live acceptance; complete the source-bound 40-question knowledge gate.

Full task deliverables:

- Capability-aware API connector and rendered snapshots
- Cursor/checkpoint, template dependency, deletion and review pipeline
- Provenance/rights and collection restrictions

Boundary: No guessed endpoint, broad Discord scrape or case archive source.

## P21 — Implement direct lookup and source authority

Status: **in_progress**. Phase: Knowledge. Priority: P0.

Depends on: P20. Acceptance: T27, T28, T29, T34.

Model-independent dashboard and signed Discord /lookup share reviewed lexical/alias retrieval, source authority/revision/hash/expiry checks and fresh member/context checks. Reviewed source publications, live command/lookup acceptance and the 40-question release gate remain open.

Implemented scope:

- Approved public lexical/alias retrieval, authority labels, revision/hash/expiry checks and attributed citations implemented.
- Member dashboard direct lookup on Public answers, independent of inference and AI opt-in.
- Signed /lookup rechecks membership, non-case channel/parent and source validity before returning an attributed private response. Synthetic current-member direct lookup works with AI unavailable.

Remaining scope:

- Direct dashboard and Discord lookup are implemented. Qualify current source attribution, authority, invalidation and member access against reviewed publications; complete the 40-question gate.

Full task deliverables:

- Exact/alias/lexical retrieval and valid source links
- Audience/version-aware caches and authority conflicts
- Model-independent /lookup

Boundary: No semantic model dependency for basic lookup.

## P22 — Implement knowledge administration

Status: **in_progress**. Phase: Knowledge. Priority: P1.

Depends on: P08, P20, P21. Acceptance: T28, T29, T42.

Separate knowledge identity, public publication/catalogue/editor, fixed Policies refresh and source invalidation are implemented. Knowledge-only editor composition is installed and isolated; owner publication and operational invalidation/recovery/live acceptance remain open.

Implemented scope:

- Separate knowledge identity, reviewed public publication, catalogue/editor, source invalidation and removal of all stored plaintext revisions on withdrawal.
- Installed knowledge-only editor composition and fixed Policies refresh have source-bound identity/metadata evidence; refresh has no publication authority.

Remaining scope:

- Knowledge-only editor and fixed Policies refresh are installed with database isolation checked. Remaining: owner source publication, operational invalidation/recovery and live editor/lookup acceptance.

Full task deliverables:

- Source/collection review and snapshot comparison
- Sync diagnostics, quarantine, deletion and safe previews

Boundary: Preview has no case-context or transcript import path.

## P23 — Qualify the selected inference provider and runtime

Status: **in_progress**. Phase: Non-ticket AI. Priority: P0.

Depends on: P01, P02, P07. Acceptance: T31, T32, T33.

Approved runtime installed inside Hyper-V only; both pinned models ran under four CPUs/8 GiB, ContainerUser, network none, no mounts/ports. Phi failed timing; Qwen2.5 completed small screens in 3.824–5.920 seconds but invented policy/authority. Exact count and prompt usage agreed. No full-turn, host-load, quality or live qualification. Later owner selection: official DeepSeek Flash supersedes active local-only exploration. The preserved local screens remain historical; Flash worker identity, transport and operational qualification are open. Authenticated bounded private-stream broker/worker foundation implemented; native service/transport and OS qualification incomplete. 11 October: owner selected a Mistral trial; the worker client, single-origin transport, provider identity checks, default prices and notice wording now target mistral-small-2603 with a pinned-model identity gate. Synthetic verification only; no key, live call or deployment.

Implemented scope:

- Pinned Microsoft C++ runtime installed only inside the approved temporary worker; version/hash and containment evidence recorded.
- Actual Phi/Qwen synthetic screens, bounded negative-access checks and Zen 4 backend observation completed. Per-turn output grammar and evidence-trimming constraints implemented; 22 focused checks pass.
- Bounded mutual-challenge HMAC stream exchange pins worker/boot/release/provider profile and preserves core dispatch/usage acknowledgements. Final source/consent checks precede prompt transfer; cancellation, expiry, replay and uncertain handoff tested locally.

Remaining scope:

- Installed repair7a152ca verified. Qualify actual worker child identity/file/network denials, signed leases, physical stop and failed-start recovery; owner dashboard start remains pending.
- DS-01 processing/deletion/transfer commitments, actual full-turn timing, representative host load and selected feature acceptance remain open.
- Mistral: fresh DS-01 evidence, a first live call to confirm usage fields, reasoning_effort, message layout and latency, synthetic quality qualification, then a new pinned package.

Full task deliverables:

- Exact selected provider/model, runtime/release/profile and approved dependency lock
- Worker isolation, fixed provider egress, credential custody and measured budget/queue/deadline limits; local CPU inference only if separately selected
- Cold/warm full-turn latency, physical cancellation/stop and representative host-load qualification

Boundary: No automatic provider/model fallback, auto-download or claimed unmeasured throughput. Provider/privacy clearance and actual worker qualification remain separate.

## P24 — Implement non-ticket knowledge assistant

Status: **in_progress**. Phase: Non-ticket AI. Priority: P0.

Depends on: P19, P21, P23. Acceptance: T22, T25, T26, T29, T30, T34, T48, T52.

Core Gateway handoff now composes metadata observations, current audience/presence gates, consent, short-lived context, public retrieval, inference queue and fixed output. Stable AI continuity ignores ordinary traffic but invalidates audience changes. Input trimming retains policy/current question; brief typing is limited to admitted addressed turns. Qualified worker broker and service/restore wiring, durable effect recovery and reaction ownership, private worker domains, explicit-memory implementation/scope, source sync and full enabled-feature acceptance remain open. Core adds fixed Contact staff navigation after closed AI payload validation. Current member clicks receive the existing six public categories privately, then freshly authorized blank ordinary forms; Quick Help retains its no-form entry. No AI text, source message ID, category decision or generated field value enters intake.

Implemented scope:

- Core Gateway handoff now composes metadata observations, current audience/presence gates, consent, short-lived context, public retrieval, inference queue and fixed output. Stable AI continuity ignores ordinary traffic but invalidates audience changes. Input trimming retains policy/current question; brief typing is limited to admitted addressed turns.
- Core adds fixed Contact staff navigation after closed AI payload validation. Current member clicks receive the existing six public categories privately, then freshly authorized blank ordinary forms; Quick Help retains its no-form entry. No AI text, source message ID, category decision or generated field value enters intake.

Remaining scope:

- Public-context gathering, durable effects and temporary replies are implemented. Qualify actual worker/Discord lifecycle, effects and source revocation. Remote explicit preferences and named restricted domains remain separately blocked. Independent Discord/client Contact staff acceptance and the rest of T26 remain open.

Full task deliverables:

- Dedicated-channel /ask and short-lived bounded sessions
- Application-directed retrieval and source-ID validation
- Final delivery revalidation and blank staff-contact link
- Bounded Sophie style profile with citations, truthful action claims and no ticket exceptions

Boundary: No ticket data/tools, case advice automation or arbitrary browsing.

## P25 — Implement AI controls and evaluation tooling

Status: **in_progress**. Phase: Non-ticket AI. Priority: P1.

Depends on: P08, P24. Acceptance: T26, T31, T33, T42, T48.

Participation/personality/own-consent dashboard plus authenticated reviewed public knowledge editor. Synthetic editor publication and withdrawal verified; unavailable AI controls do not block composed administration. Applied-worker acknowledgement, operational release/resources controls, source sync, personal-memory controls, actual model dialogue evaluation and explicit activation remain open. Schema065 candidate adds exact notice/evidence-bound consent and private latest-record export; no live installation or provider clearance.

Implemented scope:

- Participation/personality/own-consent dashboard plus authenticated reviewed public knowledge editor. Synthetic editor publication and withdrawal verified; unavailable AI controls do not block composed administration.

Remaining scope:

- Reviewed activation and repaired processing-expiry check are installed. Owner-reviewed personality, exact channel participation, budget, notice and current individual consent remain required; actual model dialogue/release acceptance remains open.

Full task deliverables:

- Model/limits/queue/cancel/disable dashboard
- Versioned prompts and evaluation ledger
- Public-knowledge previews and redacted diagnostics

Boundary: No persistent member profiling or case-content feedback.

## P26 — Implement backups, deletion and operator runbooks

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P06, P07, P12. Acceptance: T35, T37, T38, T39, T58.

Encrypted snapshot/file bundles and quarantined restore are verified locally. Owner selected D:\Backups as local backup parent; directory exists on healthy NTFS, with no backup executed in this update. Independent copy/key custody, latest-state replay, activation/rollback and production service qualification remain open. 4 October local candidate: bounded metadata-only vault scan and retained-slot ownership guards verified; see docs/attachment-operations.md. No live vault scan or deployment.

Implemented scope:

- Database snapshot and retained-file selection are consistent under a concurrent committed write; artifacts and manifest are encrypted with authenticated per-entry labels.
- Actual isolated restoration checks migrations/table counts/artifact metadata, parks pending jobs, revokes sessions, invalidates Gateway leases and leaves the database read-only with a persistent runtime fence.
- Owner-only ledger of selected control metadata committed with state changes; routine observations are excluded, rollback is atomic, and format-2 backup/restore verifies its snapshot hash.
- Isolated migration/recovery evidence includes retained schema-048 inventories and schema-049 sealed effects. No live upgrade or release-gate approval.
- Exact schema-049 seal records survive migration050 unchanged; encrypted quarantine restore retains applied policies, application history, migrated provisions and pending reconciliation. Staging stays at046.
- Local read-only whole-vault metadata scan reports bounded flat-directory classifications without following links, reading bodies or changing files/capacity. Inventory and backup reject cross-job retained slots and mismatched recorded sizes before reading content. Six focused checks, CA01–CA23/AO01–AO08 and RB01–RB11 pass; clusters stopped.

Remaining scope:

- Independent latest revocation/deletion control history and verified replay/current-state reconciliation before activation.
- Use approved D:\Backups local destination; complete independent recovery copy, key custody, RPO/RTO, backup retention and production runtime/service qualification.
- Reviewed artifact-vault remapping/capacity reconciliation, exceptional deletion, rollback and operator recovery acceptance.

Full task deliverables:

- Retention/deletion ledger and consistent artifact backups
- Isolated restore/rollback scripts and evidence
- Independent outage alert/fallback process

Boundary: Do not replay restored jobs into production.

## P27 — Run administration failure and permission suite

Status: **in_progress**. Phase: Administration. Priority: P0.

Depends on: P16, P17, P18, P26. Acceptance: T03, T06, T07, T13, T15, T16, T18, T20, T21, T36, T39.

Component evidence plus ten composed staging scenarios and limited live ticket/OAuth/DM observations are recorded. Full G2, multi-account privacy, OS permissions, controlled failure/reboot/load drills and independent restoration remain outstanding. 406 unit tests; 88 focused Onboarding/wording, 67 intake, 20 recovery/upgrade and 14 composed-runtime scenarios; ten synthetic browser checks. No live upgrade or human acceptance. Shuttle milestone: 31 focused checks and 87 assistance/recovery database scenarios pass; all24 composed scenarios pass in a diagnostic rerun. The first standard composed run exposed one unreproduced AI_TURN_UNAVAILABLE in P19-RT22 after all exclusion/delivery assertions passed; retain that reliability gap. Synthetic browser flows and stopped disposable clusters are recorded.

Implemented scope:

- 212 contract tests and 536 isolated PostgreSQL scenarios passed, including CA01–CA23 and S38 for acquisition boundaries, durable rate-limit pauses, rollback, capacity, private files, lost acknowledgements, native loopback HTTP and two restarts. Source-bound manifests are retained.
- RT01–RT09 exercise the combined foreground host with isolated PostgreSQL and loopback HTTP/WebSocket, including full Shuttle delivery, readiness loss, graceful shutdown and retained restart. Four runtime/CLI contracts pass.
- 28 focused bootstrap/Discord/case-channel contracts and RT01–RT10 pass on live-bootstrap fixes; owned test cluster stopped. Separate live REST report verifies isolated resource setup only.
- 406 unit tests; 88 focused Onboarding/wording, 67 intake, 20 recovery/upgrade and 14 composed-runtime scenarios; ten synthetic browser checks. No live upgrade or human acceptance.
- Y24–Y27 exercise authenticated ordinary repair receipts, Head Admin exclusion, retained-candidate selection and authority loss during proof acquisition. Composed RT23 exercises actual OAuth/CSRF, new-page return, private Staff-reply adoption, worker confirmation and exact duplicate replay without resending. P19-RT22 remains passing on the same composed run.
- Current release-review generator preserves all 117 row IDs, 60 acceptance IDs and 18 requirement mappings; selected-provider acceptance, separate SAI-G states and current remaining scope replace superseded local-only/status assumptions. Nonblank human JSON results cannot be overwritten; the existing workbook remains untouched.
- Prepared a pinned 335a3f2/schema069 staging review packet and 512-file source archive. Read-only installed manifest/baseline/database checks pass; exact schema066-to069 preservation, idempotency and return-path boundary checks pass in a stopped disposable cluster. No installed state changed.

Remaining scope:

- Integrated G2 acceptance, complete workflows, live Discord/OS permissions, power-loss and independent restore evidence.

Full task deliverables:

- Recorded G2 results for crashes, permissions, restores and role races
- Defect fixes and build-specific evidence

Boundary: Tests use synthetic cases; findings block release until resolved.

## P28 — Run selected AI isolation, quality and host-load qualification

Status: **planned_not_started**. Phase: Non-ticket AI. Priority: P0.

Depends on: P25, P26, P39. Acceptance: T22, T23, T24, T25, T28, T29, T30, T31, T32, T33, T34, T35, T48, T52.

Not implemented. Reference-pack acceptance requirements still apply.

Full task deliverables:

- G4 evidence and reviewed 40-question minimum set; G3 is separately owned by P39
- Sentinel, permission, deletion and model-failure results
- Resource usability sign-off on actual host

Boundary: Zero prohibited data/tool paths; no ticket material used in tests.

## P29 — Approve brand implementation and accessibility

Status: **planned_not_started**. Phase: Administration. Priority: P1.

Depends on: P03, P13, P17, P18, P38. Acceptance: T42, T43, T49, T50, T51.

Human approval has not started. Synthetic browser/layout and keyboard checks exist for both guidance and ticket-form editors; full brand, accessibility and Staff workflow acceptance remain outstanding.

Full task deliverables:

- Approved theme tokens/assets/provenance
- Keyboard/contrast/reflow/quiet-mode evidence
- Core staff workflow review
- Sophie crop, transparency, fallback and neutral-case presentation review

Boundary: Do not infer exact live-site assets from this planning pack.

## P30 — Approve administration pilot and cutover ledger

Status: **planned_not_started**. Phase: Administration. Priority: P0.

Depends on: P27, P29. Acceptance: T40, T41.

Not implemented. Reference-pack acceptance requirements still apply.

Full task deliverables:

- Reviewed existing-member eligibility baseline
- Bot responsibility/old-case drain plan
- Backup, fallback and operator release approval

Boundary: Administration approval does not depend on local AI readiness.

## P31 — Cut over administrative responsibilities

Status: **planned_not_started**. Phase: Administration. Priority: P0.

Depends on: P30. Acceptance: T38, T40, T41.

Not implemented. Reference-pack acceptance requirements still apply.

Full task deliverables:

- Single-writer feature transfers and monitored pilot results
- Old panels retired safely; old cases drained without migration
- Rollback/incident evidence and current release record

Boundary: Do not remove old ticket access while open cases still need it.

## P32 — Activate separately approved non-ticket AI

Status: **planned_not_started**. Phase: Non-ticket AI. Priority: P1.

Depends on: P28, P31, P39. Acceptance: T22, T29, T32, T34, T48, T52.

Not implemented. Reference-pack acceptance requirements still apply.

Full task deliverables:

- Source/AI channel approvals and final source freshness check
- Scoped rollout, disable and administration-independence test; no automatic provider/model fallback
- Published exact processing notice and reviewed provider evidence with current individual consent

Boundary: AI remains off until G4 and operator approval; direct lookup has its own G3 activation under P39.

## P33 — Add selected read-only service adapters

Status: **planned_not_started**. Phase: Later utilities. Priority: P2.

Depends on: P31, P39. Acceptance: T29, T46, T47.

Not implemented. Reference-pack acceptance requirements still apply.

Full task deliverables:

- Owner-approved platform/resource inventory
- Scoped connector credentials and contracts
- SSRF, timeout, audience and source-provenance tests

Boundary: No automatic writes, BYOND duplication or broad generic network tool.

## P34 — Add small community utilities

Status: **planned_not_started**. Phase: Later utilities. Priority: P2.

Depends on: P31. Acceptance: T08, T44, T45.

Not implemented. Reference-pack acceptance requirements still apply.

Full task deliverables:

- Prioritised suggestions, message-context reports or announcements
- Bounded scheduler and human-curated answer workflow

Boundary: Choose one feature slice at a time; no ticket AI or unreviewed code ports.

## P35 — Establish maintenance and upgrade cadence

Status: **in_progress**. Phase: Operations. Priority: P1.

Depends on: P31. Acceptance: T02, T31, T38, T39, T46.

Prepared a source-bound maintenance review draft for dependency/API/provider/model revalidation, proposed operator roles and cadence, agent PR/release evidence and isolated recovery with current deletion/revocation history. It uses existing tooling and creates no recurring job or operational change. P31 cutover remains a prerequisite for adoption. Owner must select named operators/reviewer/custodian, cadence and outage/fallback channels, independent recovery destination/key custody and RPO/RTO/retention. Operational drills, upgrades and production qualification require their exact authorization and evidence.

Implemented scope:

- Prepared a source-bound maintenance review draft for dependency/API/provider/model revalidation, proposed operator roles and cadence, agent PR/release evidence and isolated recovery with current deletion/revocation history. It uses existing tooling and creates no recurring job or operational change.

Remaining scope:

- P31 cutover remains a prerequisite for adoption. Owner must select named operators/reviewer/custodian, cadence and outage/fallback channels, independent recovery destination/key custody and RPO/RTO/retention. Operational drills, upgrades and production qualification require their exact authorization and evidence.

Full task deliverables:

- Dependency/API/model revalidation procedure
- Operator ownership and recovery-drill schedule proposal
- Documented agent PR and release protocol

Boundary: No unattended production upgrades or recurring jobs without owner approval.

## P36 — Sophie identity (custom artwork removed)

Status: **complete**. Phase: Foundation. Priority: P1.

Depends on: P03, P04. Acceptance: T49.

Owner direction of 20 October 2026 removed all custom artwork. The four PNGs, both manifests and brand profiles, the brand-profile contract, its test, the repository asset check and the dashboard avatar route were removed; the planning pack HTML no longer embeds the images. The bot's Discord avatar is set on the account, outside this repository.

Implemented scope:

- Artwork and references removed; the former avatar path answers 404 (dashboard asset test).

Remaining scope:

- None. Git history still contains the former PNGs.

Full task deliverables:

- Text identity Sophie / Community Services on every dashboard page
- No bundled Sophie artwork, brand profile or asset manifest

Boundary: Sophie is not depicted (radio voice only, owner decision of 21 October 2026). Shuttle Activity art is made by the coding agent under that decision, with provenance records.

## P37 — Apply Sophie branding to interfaces and static copy

Status: **in_progress**. Phase: Administration. Priority: P1.

Depends on: P36, P08, P09, P13, P17. Acceptance: T50, T51.

The guidance editor uses live Sophie/Community Services text, the bundled static avatar, system fonts, quiet mode and text-only copy. Proposed colours, desktop/narrow placement and keyboard recovery have synthetic developer checks. Other surfaces, identity controls, owner-approved templates and independent production visual/accessibility acceptance remain open. Ticket-form configuration now shares the approved static avatar, quiet mode and shell, with synthetic narrow-layout/keyboard review; independent human acceptance remains open.

Implemented scope:

- Sophie/Community Services shell, static avatar, quiet mode and synthetic editor layout/keyboard checks.

Remaining scope:

- Other interfaces and state templates, owner presentation review and independent visual/accessibility acceptance.

Full task deliverables:

- Avatar/header/hero/wordmark placement with live-text and quiet-mode fallbacks
- Identity controls separate from AI settings and case permissions
- State-derived, owner-reviewed static templates for ticket and Shuttle notices

Boundary: No AI inside cases, mascot chat widget, rewritten admission rules, unsupported success claims or unreadable decorative surfaces.

## P38 — Review identity consistency and non-AI presentation

Status: **in_progress**. Phase: Administration. Priority: P1.

Depends on: P37, P19. Acceptance: T49, T50, T51.

Local static placement review uses the four unchanged source PNGs with fixed profile/hash validation, circular/small previews, paired light/dark alpha surfaces and narrow live-text fallback. Developer browser checks cover 320 CSS-pixel reflow, keyboard quiet mode and failed-image recovery. No product page or installed service was changed; independent identity/asset release approval remains outstanding.

Implemented scope:

- Source-bound local preview and developer browser evidence for original image loading/proportions, small/circular crop limits, light/dark alpha, narrow live-text fallback, keyboard focus, quiet mode and missing images. See GitHub/.agent_docs/aphelion-sophie/brand-review-2026-10-04/verification.json.

Remaining scope:

- Owner approval of proposed placement and distribution; independent full accessibility/browser-zoom and Discord upload checks; integrated deterministic-case T51 evidence and versioned administration release approval.

Full task deliverables:

- Small/circular/narrow-layout previews and alpha checks on light/dark surfaces
- Brand-preview and deterministic-case sentinel test evidence with zero model calls
- Versioned asset approval and rollback record for the administration release

Boundary: Artwork review is not a production benchmark or legal certification. Do not block human administration on local-model readiness.

## P39 — Validate and activate direct knowledge independently of AI

Status: **in_progress**. Phase: Knowledge. Priority: P0.

Depends on: P19, P21, P22, P26. Acceptance: T23, T27, T28, T29, T34, T35, T47.

Dashboard and signed Discord direct lookup, reviewed-source authority checks, fixed Policies connector/refresh and separate knowledge-only composition are implemented independently of inference. Synthetic member lookup with AI unavailable passes; independent G3, source publications, 40-question acceptance and live activation remain open.

Implemented scope:

- Model-independent shared dashboard/Discord lookup and restricted public knowledge storage are implemented. Synthetic composed scenarios prove direct lookup with AI unavailable.
- Installed knowledge-only editor/read identities and fixed-source refresh have recorded source-bound evidence; no model or automatic publication prerequisite.

Remaining scope:

- Owner-reviewed current Policies extracts and separate Discord rules publication; complete source-bound 40-question G3, invalidation/recovery and destination/member acceptance before operator-approved direct-lookup activation.

Full task deliverables:

- G3 extraction, rights, authority, audience, template and deletion evidence without an inference process
- Operator-approved direct lookup activation and independent disable/fallback check

Boundary: No dependency on P23-P25, P28 or a working model. Live activation still requires approved source collections and destination policy.

## P40 — Shuttle Activity: production spike and tester gate

Status: **in_progress**. Phase: Shuttle Activity. Priority: P1.

Depends on: P14, P16. Acceptance: T01, T02, T37.

Owner decisions of 21 October 2026 ("The Shuttle becomes an Activity" D1, D4, D5, D6, D8; "Shuttle Activity application and hostname") and 22 October 2026 (SDK approved with a scoped big-integer exception; testers are the server owner and current lead ops role holders). The Activity uses Sophie's current application at onboarding.a13.info. Built, tested offline and deployed in testing on 22 October 2026 (release sophie-mistral-b6af5d8).

Implemented scope:

- Closed "not boarding yet" screen host built and tested on 21 October 2026 (apps/activity/closed-host.*, tests/activity-closed-host.test.js; see docs/shuttle-activity-closed-screen.md). Loopback only, two paths, strict CSP, no token or data.
- Routed on 22 October 2026: sophie-staging tunnel configuration v3 adds onboarding.a13.info -> 127.0.0.1:38124 before the catch-all, with a proxied CNAME; v2 backed up. Closed screen started; public HTTPS checks passed for onboarding.a13.info (page, font, 404) and sophie.a13.info is unchanged.
- Closed screen running as the Manual service aphelion-bot-activity (NT SERVICE account, pinned Node, reviewed WinSW wrapper) since 22 October 2026, installed by ops/windows/Setup-ActivityService.ps1 from a hash-recorded copy of b9f7c11; public HTTPS checks passed after the handover.
- Embedded App SDK 2.5.0 pinned on 22 October 2026 (1ca206b, 2515b34): scripts/vendor-embedded-sdk.mjs checks the tarball's npm integrity and SHA-256 and copies the 57 modules reachable from DiscordSDK, Events and Constants byte for byte; the URL patcher (fetch/WebSocket) with its 0BSD tslib helper is not shipped. Bundled zod, uuid, eventemitter3 (MIT) and big-integer (Unlicense, scoped exception) with notices. T-ACT-SDK-01..04.
- Sign-in round trip, instance lookup and tester gate built on 22 October 2026 (5c3cc6c): code exchange without a redirect URI (identify and rpc.activities.write only), instance checked with the bot token (this server, this member), one-hour in-memory bearer tokens through core principals; shuttle.activity.test admits the server owner and current lead ops role holders, read from Discord on every request. T-ACT-CORE-01..09; storage SA01..SA08 on isolated PostgreSQL.
- Launch-activity response from the rules post button built on 22 October 2026 (4384b7c), T-ACT-POST-03. Rules post banner format chosen: a 32-column code block with box characters (no ANSI, no image).
- Deployed in testing on 22 October 2026 (owner approval): core release sophie-mistral-b6af5d8 (schema 074, after fe25c83 failed to start because four SDK modules were missing from Git; 3 min 43 s outage, fixed in b6af5d8), the activity block on 127.0.0.1:38125, commands re-registered with /whitelist post, and onboarding.a13.info routed to core (tunnel configuration v4). Installation, boundary, dashboard and public HTTPS checks passed. Closed screen kept on 38124 for rollback.

Remaining scope:

- Live sign-in, instance lookup and tester gate inside Discord; platform report for Windows desktop, web, iOS and Android (launch time, layouts, presence, launch notice, Activities permission).

Full task deliverables:

- Owner enables Activities on the production application; URL mapping to an owner-chosen production ingress (ADR 0004 covers staging only)
- Tester gate: configured tester user IDs; everyone else sees a closed "not boarding yet" screen
- Sign-in round trip (identify and rpc.activities.write), Activity instance lookup with the bot token, and a launch-activity response from a Rules post button
- Platform report for Windows desktop, web, iOS and Android: launch time, layout modes, presence, the launch notice in the channel and the Activities permission
- Cozette coverage and rendering check; Rules post banner format chosen (ANSI code block or pre-rendered image)

Boundary: Production application behind the tester gate only. Each deploy and the opening need recorded owner approval. No production secrets in prompts; no Shuttle copy or member data in logs.

## P41 — Shuttle Activity: backend, and the Shuttle leaves tickets

Status: **in_progress**. Phase: Shuttle Activity. Priority: P1.

Depends on: P40, P14, P15, P16. Acceptance: T13, T14, T15, T18, T19, T22, T26, T53, T54, T55, T57.

Owner decisions of 21-22 October 2026. Activity runs, routes and the opening switch are built and tested offline on branch docs/shuttle-activity-plan; deployed in testing on 22 October 2026 (sophie-mistral-b6af5d8, migration 074). New runs leave ticket channels only at the opening (decision of 22 October 2026).

Implemented scope:

- Activity runs on 22 October 2026 (5c3cc6c): ordinary sessions with the same domain rules, nonce rotation, receipts and Whitelist grant effect, no case or channel (not counted against case quotas), marked in sophie_core.shuttle_activity_runs (migration 074). Whitelist shows confirmed only after the grant is observed on Discord. Routes: GET /api/shuttle, POST /api/shuttle/board and /api/shuttle/act (Continue, Back, Check), one request key per click. Storage SA01..SA08; T-ACT-CORE-07..09. Full storage suite 1024+2 passed with the 74-migration count (d7191b9).
- Opening switch on 22 October 2026 (4384b7c): with status open, the entry button and /whitelist start launch the Activity instead of opening a channel; channel runs in progress continue in their channels.

Remaining scope:

- Runs in progress in a channel moving into the Activity at the same step (today the Activity tells the member to finish in their channel).
- Text version reachable from the rules post, sharing the same run.
- Live checks against Discord after deployment.

Full task deliverables:

- /activity routes in core for sign-in, state, Board/Continue, Back, Complete and Check; short-lived in-memory session tokens bound to user, instance, membership episode and revocation epochs
- New Shuttle runs without a private case or channel, not counted against case quotas; existing Shuttle cases, records, transcripts and capture ledgers retained
- Runs in progress move into the Activity at the same step; existing Shuttle channels keep their rules until they close
- The same store methods and checks as the signed controls; Whitelist completion only after observed delivery
- Text version from the Rules post sharing the same run

Boundary: No AI path. Current eligibility on every action; never grant from a client response, launch location or presence. Other ticket types unchanged; no Shuttle record deleted.

## P42 — Shuttle Activity: scene renderer, art and sounds

Status: **complete**. Phase: Shuttle Activity. Priority: P1.

Depends on: P40. Acceptance: T02, T43, T49, T60.

Owner decisions of 21 October 2026 ("The Shuttle becomes an Activity", D1-D10; sounds chosen and approved; encoding tool). Sounds converted and approved; scene engine, renderer and six scenes built and tested; Cozette pinned. The owner reviewed the scene fixes in the preview on 21 October 2026 ("The fixes look right in the preview").

Implemented scope:

- Sound cue list (24 cues, including the owner-added MUS-02 arrival theme) and the owner's choice for each, with source, author and licence checked on each sound's page: legal/shuttle-activity-sounds.json. 23 CC0 1.0, one CC BY 4.0 credited in legal/THIRD-PARTY-NOTICES.
- Original audio received from the owner and verified on 21 October 2026: 24 of 24 SHA-256 hashes match the owner's checksum list and each header matches its source page; hashes and measured formats are pinned in legal/shuttle-activity-sounds.json. Originals stay uncommitted in .local/shuttle-sounds/.
- Encoding tool decided on 21 October 2026: a pinned FFmpeg LGPL Windows build (n9.0.2-17-g2a571b6068, SHA-256 recorded in legal/DEPENDENCIES.json), build time only on the development machine, producing Ogg Opus with MP3 fallbacks.
- Pinned FFmpeg build downloaded and checked on 21 October 2026: archive SHA-256 matches, libopus and libmp3lame present, no GPL or nonfree components; effective licence LGPL-3.0-or-later. Review: legal/ffmpeg-build-time-encoder.json.
- Sounds converted on 21 October 2026 by scripts/build-shuttle-sounds.mjs: 24 Ogg Opus files (4.6 MB) and 24 MP3 fallbacks (8.0 MB) in content/shuttle-activity/sounds/, with cut, loop and level data in content/shuttle-activity/sound-edits.json. Loops are crossfaded and padded; measured seam jumps are 0.06-1.3 times a normal sample step in both formats. Output hashes are pinned in the sounds record and were byte-identical on a second build. See docs/shuttle-activity-sounds.md.
- Owner auditioned all 24 converted sounds on 21 October 2026 and approved every one without changes; a rebuild reproduced the approved hashes.
- Scene engine and art on 21 October 2026: bounded scene format, validator and frame composer (modules/onboarding/scenes.js); canvas renderer and player (apps/activity/); six scenes with provenance, landscape and portrait (content/shuttle-activity/scenes/), written deterministically by scripts/author-shuttle-scenes.mjs. The door cannot draw open before Whitelist is confirmed. 10 tests in tests/shuttle-scenes.test.js and tests/shuttle-scene-player.test.js. See docs/shuttle-activity-scenes.md.
- Cozette 1.30.0 (MIT) downloaded on 21 October 2026, hash matched the release digest, bundled at apps/activity/fonts/CozetteVector.woff2 and pinned in legal/DEPENDENCIES.json with its notice. It maps all 138 SCENE_GLYPHS; tests/shuttle-font.test.js checks hashes and coverage.

Full task deliverables:

- Bounded scene format and validator: size, characters present in Cozette, colour keys, frames, fixed effect kinds, file size and alt text
- Glyph-grid renderer: canvas backdrop under HTML text, 12 fps cap, still frames for reduced motion, picture-in-picture, heat warnings and hidden pages
- Six scenes made by the coding agent (hangar viewport, departure lounge, baggage hall, boarding ramp and cabin, viewport, pressure door and new lab) with provenance records
- Sound cue list with CC0/CC-BY options for owner selection; chosen sounds pinned with source, author, licence and SHA-256, with credits and notices; converted to Ogg Opus with MP3 fallbacks by the pinned build-time FFmpeg

Boundary: Sophie is not depicted and no runtime image generation is added. No more than three flashes a second. Audio is CC0 1.0 or CC BY 3.0/4.0 only.

## P43 — Shuttle Activity: visual novel client and main page

Status: **in_progress**. Phase: Shuttle Activity. Priority: P1.

Depends on: P41, P42. Acceptance: T13, T14, T42, T43, T52, T53, T54.

Owner decisions of 21 October 2026 (D2, D3, D6, D9, D10) and 22 October 2026 (second pass: SS13 culture only, ASCII viewscreens with links, arrival links, all at once; third pass: station counts and boarding pass, radio at half the typing time, all four Ten Thousand exchanges; fourth pass: the Shuttle as a story, with Rook and Pip, casual copy including the rules, and the story sounds; fifth pass: picked designs from a design picker, walk-behind depth, mothroaches, the BLASTWAVE cycle, a full-page title with the menu in a terminal window, story fixes). Client built and tested offline, previewed in a local harness with a fake API, and tested by the owner in the test Discord (a723a49). The third pass is installed (0d446fe, source-only, 22 October 14:26 UTC); the fourth pass is installed (135f2a6, source-only, 22 October 16:11 UTC, then SC-07 as a620ce0 at 16:20 UTC); its story copy is published as Shuttle version 3 (22 October 17:00 UTC, host-only command cf0c125). The fifth pass is installed (ceb46cb, source-only, 22 October 18:55 UTC); its fixed story copy is published as Shuttle version 4 (18:57 UTC, host-only command). An audit of the whole Activity followed, and its fixes are installed as f6c787e (source-only, 19:16 UTC); no copy changed. The sixth pass (staging that follows the reader: paging and reveal moments, the click mark, the username title, Beepsky, the staging lint and the review's scene fixes) is installed (a0eb904, source-only, 22 October 21:14 UTC); its story copy is published as Shuttle version 5 (21:15 UTC, host-only command).

Implemented scope:

- Visual-novel client on 22 October 2026 (086ef05): splash and game-style title menu over the animated hangar; Sophie's radio transmissions of the published copy (every character, in order) over each stop's scene and ambience; Whitelist requested and arrival screens (door opens only after confirmation, arrival theme only then); fixed notices for closed, unavailable, in a channel, unpublished, outside Discord and sign-in failure; settings for levels, sound, motion, typed or instant text and text size; keyboard control; landscape overlay and portrait stack; presence with the stop number only; safe markdown with https links opened through Discord. T-ACT-CLI-01..08. Preview: splash, menu, stops, pending, arrival and closed screen at 474x870 and 1280x720 with no console errors.
- Owner tested in the test Discord on 22 October 2026 ("It does appear to work"). Fix from that test (a723a49, installed 10:43 UTC): Sophie's radio static, RX lamp and text ticks run for 2.4 s as each stage begins and then trail off, instead of for as long as a transmission is on screen; button refreshes no longer re-type the transmission. T-ACT-CLI-09.
- Second pass on 22 October 2026 (owner feedback on a723a49): cue sheets so sounds filter in (title, stop, page, clearance, arrival) with ambience cross-fades and music ducking about 6 dB under Sophie; Sophie speaks 2.4 s at each stage and 1.2 s on every page, then trails off; a 400 ms wipe between scenes and a skippable 1.5 s ride between stops (motion on only); moments from the script (21 section headings mapped to scene beats, content/shuttle-activity/moments.json); six viewscreens of original ASCII art with https link cards (sea lion with the Wikipedia article, xkcd Ten Thousand as a link only, Aphelion links, rules, preferences import, Get Whitelisted), opened by their section, the View chip or V; station announcements, Tip of the Round, COMMON 145.9 radio header, HoP clearance line, Konami clown car; channel chips, emoji shortcodes and styled @names in the copy; arrival cards for channels the member can now see. T-ACT-CUE-01..02, T-ACT-MOM-01..03, T-ACT-MD-01, T-ACT-AUD-01, T-ACT-CLI-10.
- Title sections on 22 October 2026: Station log (this run's transmissions), Codex (fixed glossary) and a keys card ("?"); settings add master volume and text speed; swipe, 44 px tap targets; the title link panel reads truthfully per state (link state key) and floats above the console in portrait so the menu never covers it; the splash Enter no longer also presses Board; phone-width overflow in the radio header fixed.
- Scenes on 22 October 2026: beat and link state keys, sprite effect (carp, Ian, clown, monkey, sea lion), limits 48 layers and 64 effects; the lounge has a panelled wall with framed gridded windows, wall fittings, a detailed floor and cycling departures; the baggage belt runs with the bags. tests/shuttle-scenes.test.js 12 tests.
- Layout pass on 22 October 2026 (owner review of 052864c): a reading column on the left with a fixed-size status window (Sophie's radio standing by, or the section's extra material) above the splash, menu or transmission, and the scene alone on the right; landscape scenes re-laid at 96 by 40 so nothing sits under text; menu button fixed to the window corner; glyphs clipped to their cells (no lines beside changing text); the baggage hall's ten kinds of bags ride the belt as fixed figures through the scanner with a live scale; Ten Thousand tied to the page that links the comic (phrase moments). Installed as 2063a50 (source-only, 12:34 UTC) with the owner's approval; carp face the way they swim.
- Third pass on 22 October 2026 (owner review of 2063a50), built and tested offline, installed as 0d446fe (source-only, 14:26 UTC) with the owner's approval: a detailed Aphelion station on the title (mirrored ring, spokes, hub, arrays, beacon, blinking windows); The Brochure's book, wet floor sign and section strip centred; the baggage belt as one conveyor of 13 bags with Wolfgate beside Meridian (SS 14 MONOLITH, HARDLIGHT, AFTERLIGHT, FRONTIER, WAYFARER; SS 13 BUBBER, SPLURT, NOVA, OCULIS, RATWOOD, MARINES), refused bags labelled per section and pushed into DISPOSALS, a burning BLASTWAVE bag and firebot, two passengers talking LOOC, the claim terminal above and left of the belt; a scene per Board the Shuttle section (landing-bay, boarding-cabin with people sitting down and asking first, cabin-turbulence with the sea lion and a cabin jolt); Admire the Lights rebuilt (gas giant, nebula, comet, meteors, cargo hauler, carp school, greytide, info panel row, deck, two crew playing out the four Ten Thousand exchanges); Disembarking re-laid (STATION BOARD with crew and online counts, welcome banner, greeters, janitor, carts, vending); the boarding pass in the status window; Sophie's radio for half the page's typing time (2-6 s) with a trailing meter; squares drawn as shapes. Format: dialogue, conveyor, sprite hold/rest/clip/beat clock, text alignment, {crew}/{online}. T-ACT-CUE-03, T-ACT-MOM-05, T-ACT-CLI-11, P44 scene and player tests.
- Fourth pass on 22 October 2026 (owner review of 0d446fe: "introducing, using, and then cleaning assets"; decision log "The Shuttle as a story" and "Story sounds chosen and approved"), built and tested offline, installed as 135f2a6 (source-only, 16:11 UTC) with the owner's approval: pages break at every heading so each page stages exactly its section; scene conditions after/until from reached beats (by position, so Back works; clearance and arrival count the last stop as reached); beat-clock layers and sprites that play once, enter, hold and exit; dialogues that play once; scene sound cues on the wall or beat clock, fired only while animating and checked against the sound index; sign cards for NOTICE quotes and dialogue lines with name tags; ambience and announcements follow the scene on screen; scenes re-staged so every actor and prop is introduced, used and cleared (LOOC pair, Pip asking for a seat, the launch rail sea lion, the deck pair, the janitor, the checklist, the Get Whitelisted monitor, the concourse behind the door); the guidance rewritten as a casual story (content/onboarding/story.md -> story-definition.json, a draft for the editor) with a meaning checklist test; 17 new sounds (DLG-06, SC-08 to SC-21, AMB-07 and a new AMB-06) picked, hash-verified, encoded and approved by the owner on the audition page. Evidence: npm test 774 passed; repository check passed; npm run test:storage:fast 1028 passed, none failed; preview harness at 1100x620 and 375x812 walked every stop with the story copy, clearance and arrival, no console errors and every sound request answered.
- SC-07 (launch roll) on 22 October 2026: the owner's second-round pick (Freesound 338367, CC0 1.0), hash computed on receipt and pinned, encoded as a 7 s swell under the forward view; the rebuild reproduced the 40 other outputs; PENDING_SOUND_CUES now empty. Approved by the owner in chat (the audition page saved no verdict) and installed as a620ce0 (source-only, 16:20 UTC).
- Story copy published on 22 October 2026 at 17:00 UTC with the host-only publishing command (owner decision "Host-only Shuttle publishing"; installed as cf0c125 at 16:57 UTC): draft revision 3 (c9bd3e11...) became Shuttle version 3 (7f45693f...) with the owner as author, both hashes equal to the committed content/onboarding/story-draft.json; existing runs keep version 2. T-LOCAL-PUB-01..04, storage E25; npm test 778, storage 1029 passed.
- Fifth pass on 22 October 2026 (owner review of the fourth pass; decision log "Shuttle Activity fifth pass: picked designs, full-page title and depth"), built and tested offline, installed as ceb46cb (source-only, 18:55 UTC) with the owner's approval: a design picker artifact with three original alternatives for 40 asset groups and an art audit, and the owner's picks applied (Ian, carp, monkey, lizard, greytide, mothroach, a mixed crowd, Rook's jacket, Pip's badge, janitor, greeters with a welcome sign, ground crew, sleeper in a nightcap, the clown in big shoes, fire, firebot, cleanbot, sixteen bags, the scanner with lamps, the shuttle with engine glow, all traffic designs, the wet floor sign with NO RUNNING built in and centred, the help desk, vending machine, hydroponics trays, carts with destination cards, the feedback terminal, the red-cross locker, the BOARDING CHECK screen, the swipe card, the boxed EXIT and the MOTHROACH CROSSING sign); standing objects as front layers that people walk behind (composer occlusion, validator) and a scene menu slot (validator, player slotRect and layout handler); the title full page with the splash and menu laid over the terminal window drawn in the hangar's console, a more detailed station, the orbit clear of the subtitle, the rainbow stripes kept, numbered choices and keys 1-9; the BLASTWAVE fire as a 24 s cycle of sprites (15 s flames, the firebot out of its dock and foaming with SC-12, smoke, cold, a spark at 23 s with SC-21); three mothroaches; cabin boarders file behind the seats; story fixes (no button name for the last step, no unused entry part) and the launch post's new wording. Evidence: npm test 787 passed (T-SCENE-DEPTH-01..09 new; P43, P44, P45 and T-ACT-POST-01 updated); repository check passed; npm run test:storage:fast 1029 passed, none failed; preview harness at 1100x620 and 375x812 for the splash and menu, number keys, the baggage hall and the pressure door, no console errors; the composed scenes checked frame by frame with a walk-behind audit.
- Story version 4 published on 22 October 2026 at 18:57 UTC with the host-only command (owner approval "Approved: install the fifth pass ... then publish the fixed story as Shuttle version 4 with the host-only command."): draft revision 4 (b5be96be...) became Shuttle version 4 (887fddc7...) with the owner as author, both hashes equal to those recomputed from the committed content/onboarding/story-draft.json; existing runs keep version 3.
- Activity audit on 22 October 2026 (owner request while away): client code and wording read through; every scene, layout, beat and Whitelist state composed and checked for actors over props and layers over each other; every scene the story points at checked in both layouts. Fixed: the cape in locker 12 as the story says; the gate and its 18+ light on phones; the phone baggage hall (bag clear of the cart) and cabin (a second row of seats); the Codex explains mothroaches. T-STORY-SCENE-01..02; npm test 789; storage 1029 passed, none failed. Installed as f6c787e (source-only, 19:16 UTC); nothing to publish.
- Sixth pass on 22 October 2026 (owner review of the audit build f6c787e, 22 notes; decision log "Shuttle Activity sixth pass: staging that follows the reader"), built and tested offline, not installed: trends found and the Activity compared with simple visual novels; pages cut across the whole stop (not per Discord message) with sign cards never split, author page breaks (break moments) and beats that start when the typing reaches a phrase (reveal moments, read-time fallback with instant text); a click-to-continue mark; the title window shows the member's own Discord username as name@aphelion (shown only to them, never stored or logged; long names cut with an ellipsis) over a new title slot; the radio meter's travelling wave restored (a specificity regression from f63eebd); Codex entries for Beepsky and mothroaches. Scenes: Officer Beepsky delivers the age check and the 18+ light is gone; the mothroach walks in front of the benches, pauses at its crossing sign and leaves off the left edge; EXIT under the window, pointing away from the gate; the baggage floor tiled under the firebot and fire, the monkey's idle loop, belt tags that change column by column, a DISPOSAL chute as wide as its label, Rook clear of the bag and dock; the sea lion lined up and yapping across pages 5 to 7 and struck on "We crush sea-lions with shuttles."; a crew member pops the confetti popper on Admire page 2; the deck's flyers on one schedule with lanes and slots; litter dropped for the cleanbot; the janitor's corner tiled again after they leave. A staging lint (T-STAGE-01..04) checks every scene and layout, and found and fixed more of the same: Pip behind the cabin seats, Rook and Pip behind the ground crew, the carp in the greytide's lane, and floor holes around five props. Story copy version 5 (Beepsky's line, no re-reading, "Real questions are welcome", the sea-lion order, no Complete Shuttle instruction) is built, not published. Evidence: npm test 799 passed (T-ACT-PAGE-01..02, T-ACT-CLI-12..14, T-STAGE-01..04 new; T-ACT-STORY-01, P44, P45, T-SCENE-DEPTH-08..09, T-STORY-SCENE-01..02 and the story checklist updated); npm run check passed (687 source files); npm run test:storage:fast 1029 passed, none failed; composed scenes checked by text dumps in both layouts and with the walk-behind and collision audits. Not previewed in the browser pane this time (it crashed the desktop app earlier in the session).
- Story version 5 published on 22 October 2026 at 21:15 UTC with the host-only command (owner approval "Approved: install the sixth pass (source-only update) in the test Discord, then publish story version 5 with the host-only command."): draft revision 5 (20ad5a25...) became Shuttle version 5 (66da6827...) with the owner as author, both hashes equal to those recomputed from the committed content/onboarding/story-draft.json; runs in progress keep their version.

Remaining scope:

- Owner review of the sixth pass (installed a0eb904, story copy published as version 5) in the test Discord, on a new run (the owner's test run is on version 3).
- Candidates recorded for a later pass, not built: auto mode (advance after reading time), skipping pages already read, small choices that gate nothing.
- Checks inside Discord: whether discord.com/channels links open inside the app (desktop and mobile), audio unlock, picture-in-picture, mobile portrait, presence, screen readers, and the username title on a long name.

Full task deliverables:

- Title screen built on a section registry with fixed action kinds; V1 sections Board/Continue, Settings, Text mode and Credits; Station log and Codex reserved and hidden
- Scene player: stops, sections and pages, Sophie reading the published copy as radio transmissions, and a log
- Truthful screens for every run state: new, in progress, Whitelist requested, complete, Muzzled, withdrawn guidance and departed
- Settings for text speed, motion, text mode, text size, volume and mute
- Focused, portrait and picture-in-picture layouts; presence naming the area and current stop only
- Accessibility: keyboard, screen readers through text mode, contrast and reduced motion

Boundary: Published copy is shown as written; art and sound cannot change its meaning, hide errors or fake progress. No AI-backed section without a separate owner decision.

## P44 — Shuttle Activity: Rules post, editor and opening

Status: **in_progress**. Phase: Shuttle Activity. Priority: P1.

Depends on: P43. Acceptance: T05, T19, T42, T55.

Owner decisions of 21 October 2026 (D5) and 22 October 2026 (ticket switch at the opening; arrival links and the layout editor; a scene per section and the station board). Rules post, launch response and opening switch built and tested offline (4384b7c); the layout editor (per-stop scene picker, and now a scene per section) built and verified offline; docs/shuttle-activity.md updated.

Implemented scope:

- Rules post on 22 October 2026 (4384b7c): /whitelist post posts the departures banner (provenance recorded), dashboard-editable title, body and button wording, and a Board the Shuttle button answering LAUNCH_ACTIVITY. T-ACT-POST-01..03.
- docs/shuttle-activity.md written on 22 October 2026, with the deployment steps and rollback.
- /whitelist post registered on 22 October 2026 with the deployment; not yet posted.
- Activity layout editor on 22 October 2026: dashboard page /activity (guidance publishers) choosing each stop's scene, each section's moment and viewscreen, and a curated arrival list of up to 12 channels with notes; numbered versions with operator grant and digest in sophie_core.activity_layouts (migration 075); stale versions, reused request keys, beats the scene cannot draw and unknown stops are refused; core lists only channels the member can view now from current roles and overwrites. T-ACT-LAY-01..03, T-ACT-CHAN-01, T-ACT-CORE-10, storage SA09.
- Installed 052864c (schema 074 -> 075) on 22 October 2026 at 11:51 UTC with the owner's "All at once" approval: 43 files, migration 075 with the core grant, configuration unchanged; services down about 40 s; boundary, installation, dashboard and public checks passed.
- Third pass on 22 October 2026, built and tested offline: a moment can name its own scene (validators, layout store, editor, client swap); core adds the station counts (GET /guilds/{id}?with_counts=true, cached 5 min) and the member's own pass (fresh member read, cached 60 s) to that member's run view from the last stop on, never stored or logged, left out with ACTIVITY_STATION_UNAVAILABLE / ACTIVITY_PASS_UNAVAILABLE on failure. T-ACT-CORE-11; storage SA10.
- Installed 0d446fe (source-only) on 22 October 2026 at 14:26 UTC with the owner's approval: 28 files, no migration or configuration change; services down 33 s; boundary, installation (40 checks), dashboard and public checks passed.
- Installed 135f2a6 (source-only) on 22 October 2026 at 16:11 UTC with the owner's approval: 52 files written and the 2 replaced AMB-06 outputs removed, no migration or configuration change; services down 33 s; pre-start, boundary, installation (46 checks), dashboard and public checks passed.
- Installed a620ce0 (source-only) on 22 October 2026 at 16:20 UTC with the owner's approval: SC-07, 6 files written, none removed, no migration or configuration change; services down 33 s; pre-start, boundary, installation (48 checks), dashboard and public checks passed.
- Installed cf0c125 (source-only) on 22 October 2026 at 16:57 UTC with the owner's approval: the host-only Shuttle publishing command (3 files, no route, listener, service or configuration change); services down 33 s; pre-start, boundary, installation (50 checks), dashboard and public checks passed, including that neither public host serves the command.
- Launch post wording on 22 October 2026 (fifth pass, built offline): new default title "The Shuttle's boarding" and body in Sophie's voice (five short stops, no quiz, finishing requests the Whitelist role, the real Board the Shuttle button, what to do if it does nothing, where to ask); the banner stays by the owner's pick. T-ACT-POST-01 updated.
- Installed ceb46cb (source-only) on 22 October 2026 at 18:55 UTC with the owner's approval: the fifth pass and the launch post wording, 15 files written, none removed, no migration or configuration change; services down 33 s; pre-start, boundary, installation (65 checks), dashboard and public checks passed (the 14 changed Activity files byte for byte; the publishing command and core's messages not served).
- Installed f6c787e (source-only) on 22 October 2026 at 19:16 UTC on the owner's request to install the audit's updates: 4 files written, none removed, no migration or configuration change. The first run refused before writing anything (SERVICE_CHILD_STILL_RUNNING: a child outlived the 2-second check after the stop); the second run passed, so services were down about 62 s. Pre-start, boundary, installation (65 checks), dashboard and public checks passed.
- Installed a0eb904 (source-only) on 22 October 2026 at 21:14 UTC with the owner's approval ("Approved: install the sixth pass (source-only update) in the test Discord, then publish story version 5 with the host-only command."): the sixth pass, 17 files written, none removed, no migration or configuration change; services down about 33 s; pre-start, boundary, installation (68 checks), dashboard and public checks passed on the first run (the 16 changed Activity files the page loads byte for byte; the layout editor's module, the publishing command and core's messages not served).
- The opening on 24 October 2026: 0e513dc installed with activity.status open (owner-approved); the station-broadcast rules post is installed.

Remaining scope:

- Owner: check "Use Activities" for members in #rules, post /whitelist post there, watch the first public rides (Whitelist delivered by Sophie), then ping everyone.

Full task deliverables:

- Rules post styled like the Activity, replacing the public Shuttle entry panel: Board the Shuttle answers with a launch-activity response, plus a text route; copy editable from the dashboard
- Per-stop scene picker in the Shuttle editor, saved with the publication
- docs/shuttle-activity.md plus verification and workplan updates
- Tester acceptance on the production application, then the owner-approved opening

Boundary: Opening the Activity to all members is a separate recorded owner approval.

## P45 — Dashboard sign-in after a Shuttle Activity sign-in

Status: **in_progress**. Phase: AI controls. Priority: P0.

Depends on: None. Acceptance: tests/dashboard-auth.test.js, storage O03.

The owner's sign-in failed with DASHBOARD_AUTH_UNAVAILABLE_OAUTH_RESPONSE_INVALID: Discord reports every scope granted to the application, so after an Activity sign-in the dashboard exchange saw two scopes. Fixed in 15252f9; installation bundled with the production install by the owner's choice.

Implemented scope:

- 15252f9 on 23 October 2026. Offline on 23 October 2026: npm test 823 passed, npm run check passed, npm run test:storage:fast 1032 passed with none failed. Not installed; no live Discord check yet.

Remaining scope:

- Install with the production packet (P50), then sign in to confirm.

Full task deliverables:

- The dashboard OAuth exchange accepts identify alone or with rpc.activities.write, and refuses any other scope with OAUTH_SCOPE_UNEXPECTED

Boundary: Only users/@me is ever called with the token; no broader scope is accepted.

## P46 — One Yes or No for the whole server, and /sophie

Status: **in_progress**. Phase: AI controls. Priority: P0.

Depends on: P45. Acceptance: tests/sophie-member-panel.test.js, tests/ai-preferences.test.js, storage AI04, DS01-C06, DS01-C07, DS08-D01..D03, MEM-S01.

Owner decisions of 23 October 2026 (decision log).

Implemented scope:

- bbe039d on 23 October 2026. Offline on 23 October 2026: npm test 823 passed, npm run check passed, npm run test:storage:fast 1032 passed with none failed. Not installed; no live Discord check yet.

Remaining scope:

- Install with P50; the owner reviews notice revision 4; live check of /sophie in the channel and in DMs (the DM interaction context is unverified until then).

Full task deliverables:

- Migration 076: sophie_ai.member_consents and sophie_ai.consent_invitations
- Admission, memory use and erasure follow the server-wide choice
- /sophie panel (ephemeral or DM): Yes after the whole notice, No, notes, data copy, forget memories, delete, keep-on-leave
- Static Set up Sophie invitation, once a day at most
- Dashboard page rebuilt on the same use cases (/api/ai/me*)
- Notice revision 4 drafted (docs/ai-notice-r4.md)

Boundary: Component IDs carry no authority; every click re-reads current state and the consent epoch. No model is involved in the panel.

## P47 — Channel contexts and longer replies

Status: **in_progress**. Phase: AI controls. Priority: P1.

Depends on: P46. Acceptance: tests/ai-contexts.test.js.

Several API keys were considered and not adopted: Mistral limits are per workspace or organisation and keys carry no context.

Implemented scope:

- 28eb1e5 on 23 October 2026. Offline on 23 October 2026: npm test 823 passed, npm run check passed, npm run test:storage:fast 1032 passed with none failed. Not installed; no live Discord check yet.

Remaining scope:

- Requalify the worker (profile hash changed) with the P50 install; the owner sets each context's brief and reply length on the dashboard.

Full task deliverables:

- AI configuration schema 2 with chat, support and staff contexts
- Context brief, reply length, output budget and deadline in the prompt and output contract
- Long replies as embeds in one message
- AI deadline ceiling 30 s
- Dashboard context editor

Boundary: A brief is presentation data and never permission. The worker never asks for more output than its qualified profile allows.

## P48 — Named staff channels

Status: **in_progress**. Phase: AI controls. Priority: P1.

Depends on: P47. Acceptance: tests/ai-staff-context.test.js, storage TS-AI02, MEM-S08.

Owner decision of 23 October 2026: "Yes, named staff channels".

Implemented scope:

- a560420 on 23 October 2026. Offline on 23 October 2026: npm test 823 passed, npm run check passed, npm run test:storage:fast 1032 passed with none failed. Not installed; no live Discord check yet.

Remaining scope:

- The owner names the staff channels; activation of each after the P50 install.

Full task deliverables:

- Restricted channels only as a Staff context under a staffChannels policy
- Worker accepts a restricted lane only as a declared staff turn
- Staff memories stay in staff channels

Boundary: Case, ticket and onboarding channels and their threads stay excluded; each staff member needs their own Yes.

## P49 — Code, Guidebook and community sources

Status: **in_progress**. Phase: AI knowledge. Priority: P1.

Depends on: P47. Acceptance: tests/knowledge-guide.test.js, tests/code-search.test.js, tests/knowledge-sources.test.js.

Owner decisions of 23 October 2026. Live search against GitHub succeeded for Wolfgate and Meridian-Rift on 23 October.

Implemented scope:

- 7115fce and c33a418 on 23 October 2026. Offline on 23 October 2026: npm test 823 passed, npm run check passed, npm run test:storage:fast 1032 passed with none failed. Not installed; no live Discord check yet.

Remaining scope:

- Put the token into core credentials (credentials.githubToken) with the P50 install; check the first Guidebook and GitHub sync in the knowledge page.

Full task deliverables:

- Wolfgate Guidebook synced source with rule authority
- VanguardControl/Wolfgate in the GitHub sync; authenticated sync with a read-only token
- Code search in contexts that turn it on
- Fixed cause codes for Policies refresh failures

Boundary: Fixed allowlist of origins and repositories; nothing cloned or executed; no model chooses what is fetched; the token goes only to api.github.com.

## P50 — Move to the main server for closed testing

Status: **in_progress**. Phase: Deployment. Priority: P0.

Depends on: P45, P46, P47, P48, P49. Acceptance: verify-public.mjs, W5 live checklist.

Owner decisions of 23 October 2026: move the install to the main server; Activity and AI only.

Implemented scope:

- Owner inputs received on 23 October 2026 and checked with the bot account: guild, six roles, three channels (Ask-Sophie support, Staff Chatter staff and private, main-bots chat). Recorded in .agent_docs/aphelion-sophie/production-inputs-2026-10-23.
- Activity-and-AI-only production mode (ef094a0): no role reconciliation, no case/role/Shuttle-channel workers, no Whitelist grant, only /sophie and /lookup, reduced dashboard, a transport that refuses role, channel and permission writes, sophie_prod_ databases. npm test 827 passed; npm run check passed; storage 1033 passed, none failed.
- #ask-sophie exception (owner decision): aiChannelExceptions allows exact channels inside the protected category for the AI only; siblings, the category and recorded case exclusions stay refused. npm test 830 passed; npm run check passed; storage 1033 passed, none failed.
- Installed 791e2fe in the main server on 23 October 2026 at 00:59 UTC with the owner's approval: new sophie_prod_main database, production configuration, commands moved, all checks passed. Story publication waits for the owner's first dashboard sign-in.
- Character ported from staging (revision 2 -> production revision 1, same digest) on the owner's request.
- Owner published budget and configuration revision 1 on the dashboard; channel settings published as configuration revision 2 (#ask-sophie support, #staff-chatter staff, #main-bots chat) on the owner's request; staging budget not ported because the owner's is newer; story published as production version 1.
- Found on the first live #ask-sophie turn (23 October 2026): support and staff turns (1,024 output tokens) were refused as AI_WORKER_UNAVAILABLE before reaching Mistral, because core's prepared-turn check, the budget estimate and the provider_attempts constraint still stopped at 512. Fixed in b336843 with migration 077 and regression test DS04-I01b. npm test 831 passed; npm run check passed; storage 1033 passed, none failed. Not installed.
- Installed b336843 in production at 01:27 UTC on 23 October 2026 with the owner's approval: four files, migration 077, all checks passed.
- Installed 1e02c98 at 01:41 UTC on 23 October 2026 with the owner's approval: replies in long context turns are delivered (delivery still capped AI deadlines at 15 s) and the Set up Sophie invitation goes by DM. Three files, no migration; checks passed on re-run after core finished starting.
- 7394de5 built on 24 October 2026 (owner chose post-only): /whitelist post for Lead Ops in production; install packet prepared, not installed. npm test 834 passed; npm run check passed; storage 1033 passed, none failed.
- /whitelist post installed with 26f72b7 on 24 October 2026; main server commands lookup, sophie, whitelist(post).
- Story revision 1 (owner) installed with a65ee31 and published as Shuttle version 2 on 24 October 2026; all checks passed.
- 7d3e2ee installed on 24 October 2026: story updates dispose of Activity progress on older versions; Reset journey in Settings.
- da5b48a installed on 24 October 2026: scene dialogue follows story revision 1, the sea lion is hit on the THUMP page, Staff join the Activity testers.
- 366b6cb installed on 24 October 2026: Sophie grants Whitelist in production; UPSTREAM bag; story revision 2 published as Shuttle version 3.
- be0fe69 installed on 24 October 2026: unexpected Activity request failures log their kind.
- a6730b5 installed and story revision 3 published as Shuttle version 4 on 24 October 2026: About pages keep their link boxes, Ian barks three times, Meridian IN DEV, Glossary, page counter, silent session renewal, 6,000-character stages.
- Rules post redesigned as a station broadcast (Components V2, posted as Sophie's own message, rules links, desktop colour, neon bar); built and tested offline on 24 October 2026, not installed.
- Mobile audit of the Activity on 24 October 2026: sheets open at their top with one header-bar shape, backdrop closes, hover only on hover devices, 44 px touch targets, short portrait and landscape layouts, narrow glossary, glossary wording.
- cc90730 installed on 24 October 2026: the station-broadcast rules post and the Activity mobile audit fixes.
- d69637c installed on 24 October 2026: the owner's rules post wording; the logotype and board as images served by the Activity host.
- a928b04 installed on 24 October 2026: the rules post links its channels, @matriarch and its emoji (never notifying), with the owner's second edit.
- The Activity opened to every eligible member on 24 October 2026 (0e513dc).
- a4f8b71 installed and Shuttle version 5 published on 24 October 2026: error alerts to the alert channel pinging @matriarch, a link that retries then offers to try again, frames on a fixed grid at 30 fps, typewriter speed independent of refresh, music at 50%, Akula.
- 68881eb installed and Shuttle version 6 published on 24 October 2026: the memorial for ArcanaObscura (cross, candles, icon from :mikmoff:, linking her gallery), clearer links, alerts naming who was affected, lock timeouts retried.
- aff1bc0 installed on 24 October 2026: Activity capability checks before the member lock (PG_55P03), the link recovering on return to the window, Resume keeping the page, link arrows typed last, Recommended Reading redrawn as an open book (owner pick C).
- df3856b installed on 24 October 2026 on Node.js 24.22.1 (host CVE update; reviewed and pinned): Large text working and Aa in the radio header (member feedback). The first attempt, 1d3c0ff, stopped at the runtime check and was rolled back to aff1bc0.
- 2301f3a installed on 24 October 2026: ♪ beside Aa in the radio header (master volume and mute), M to mute (member feedback).
- 8ad8324 installed on 24 October 2026: Aa no longer flickers the page (the status line keeps its size; the scene canvas is resized only when its grid changes and redrawn before paint).
- e6aab6b installed on 24 October 2026: the main menu's deep space backdrop, the Wing (dock and depart), seven easter eggs, blink patterns in the scene engine (owner picks on the Hangar Art Picks page).
- cba5358 installed on 24 October 2026: a request budget per member before Discord (after one member's mashing made Discord busy for everyone), quiet Discord busy, shared directory and count refreshes, client single-flight and once-per-tap links; Rook and Pip walk in behind the concourse sign; game servers (info channels and quick connect) on the main menu and the last step once Whitelisted.
- b45d7dd installed on 24 October 2026: at the end of the ride the member's new role overtaking the channel reads is tried again and never alerts (first real applicant's report).
- f288aae installed on 24 October 2026: the member is observed after the capability checks, so a final Continue under load is no longer refused stale with Whitelist never queued (owner report); host log lines carry UTC times, and refused or quietly retried Activity requests are logged with the member, request, stop, phase, cause, retries and time.
- a36973c installed on 24 October 2026: Whitelist notices to the staff bot channel (migration 078), DISCORD_TRANSPORT_DISABLED quiet in the Activity, audit fixes (policy registered once, shared gate checks, module preloads, stepped clearance checks), and each request checks its member once (owner decision replacing 12 October).
- 33e7a5d installed on 24 October 2026: Staff administration checks each step once too (merged branch, 49 scenarios reworked); production queues no Whitelist reconciliation that nothing would run.
- bf4ddca installed on 24 October 2026: a curtain across the Shuttle when the journey starts and when it returns to the main menu (owner request).
- 7ecf473 installed on 25 October 2026: a Gateway event that cannot be recorded replaces the connection (Resume, then a fresh Identify if it fails again) instead of stopping Sophie, with GATEWAY_RECONNECTING / GATEWAY_HALTED traces naming the event type and cause code; Windows restarts core (60 s), the Activity closed screen, the tunnel and PostgreSQL (10 s) after an unexpected exit (owner report: Sophie stopped at 00:53 UTC after about thirty applicants).
- bbe844c prepared on 25 October 2026, not installed (owner: "Prepare the updates, do not yet install them"): focused reading time in the Shuttle Activity (visible, focused, not picture-in-picture, input within 2 minutes; core credits at most the time that passed, migration 079), the Whitelist notice adds time to completion and the average time a page (numbers only, owner choice), Staff /whitelist progress member: (case.manage for Shuttle assistance, no policy change), and from the log review: sign-in no longer resends a spent Discord code (5 failed sign-ins), AI_ADMISSION_SKIPPED_AI_DISABLED is said once instead of per message (4,618 lines), and a GitHub 403 that is not a rate limit is reported as FORBIDDEN and skips only that part. Evidence in docs/verification.md.
- bbe844c installed on 25 October 2026 at 22:46 UTC with the owner's approval: migration 079, reading time in the Activity and the Whitelist notice, /whitelist progress registered in the main server, the log review fixes. Core first refused to start because the new table had no runtime grant; mirrored from shuttle_activity_runs at 22:49 UTC, about 3.5 minutes down; all checks then passed.

Remaining scope:

- GitHub refuses the knowledge sync token for part of the sync (KNOWLEDGE_SOURCE_GITHUB_FORBIDDEN since bbe844c): check the fine-grained token's repository access (organisation Aphelion-Moon, VanguardControl/Wolfgate) or replace it.
- Watch the first timed Whitelist notices and a Staff /whitelist progress run.
- Main menu redesign, next: date and clock eggs (Halloween before 31 October, winter lights, night shift, welcome back), typed and tapped eggs (HONK, the sun, barrel roll), then the Ring Hub rework.
- Owner: confirm Sophie can post in the staff bot channel for Whitelist notices (the leftover reconciliation job was removed 24 October 2026 at 17:49 UTC).
- Owner: Go live again in each channel on the new release (bbe844c) when the AI is next tested; the onboarding Activity is the current focus.
- Owner: Go live in each channel on the dashboard; /sophie Yes.
- Live checks: a reply in #ask-sophie (code and Guidebook), a saved memory, Get my data, the Activity for a Lead Ops tester, a staff channel turn.
- Owner: /whitelist post in a private channel, check the images on desktop and a phone, then post it in the rules channel and delete the old one; re-open the Activity on a phone.
- Confirm the first error alert reaches the alert channel and pings @matriarch (Sophie needs to see and send messages there).

Full task deliverables:

- Production configuration: main guild, tester gate, AI and /sophie on, case and role modules off
- Fresh production database (migrations 001-076), seed, publications, processing policy and story version 5
- Commands registered in the main guild and removed from the test Discord
- Deployment packet with approval, configuration diff, rollback and public checks
- Live checks of memory, /sophie, long replies, code search, Guidebook rules and staff channels

Boundary: Its own recorded owner approval. The existing bot keeps its roles; Whitelist delivery and tickets stay off until the cutover (P30/P31).

## P51 — Sophie accuracy and memory: adversarial review and regression probe

Status: **completed**. Phase: AI quality. Priority: P0.

Depends on: P50. Acceptance: probe baseline-1e02c98.json, review.md scorecard.

Owner request of 24 October 2026 after live testing: two made-up answers (CI, song requests) and single links on multi-source answers.

Implemented scope:

- Baseline: 6 pass, 11 partial, 19 fail of 36. Review on the shipped prompt: 20 pass, 20 partial, 52 fail of 92 (22%).

Full task deliverables:

- Read-only probe harness running the installed production pipeline without Discord (.agent_docs/aphelion-sophie/sophie-probe-2026-10-24/probe.mjs)
- Baseline scorecard on 1e02c98 (36 cases) and an adversarial review by one Opus sub-agent at extra-high effort (review.md, 139 case runs, 103 Mistral calls)
- Regression case set with machine assertions (cases-review.json, 56 cases) and pass criteria per class
- Seed glossary from the wiki and Guidebook (39 entries, each with its source heading) for owner approval

Boundary: Reads production publications and knowledge with SELECT only; spends a few cents of Mistral budget; never posts to Discord or writes a database.

## P52 — Memory privacy and honesty (release blocker for memory)

Status: **in_progress**. Phase: AI quality. Priority: P0.

Depends on: P51. Acceptance: MEM-S storage test: forPrompt never returns a non-requester member memory, rv-mem-* probe classes at their review.md gates (privacy, safety and staff: all runs pass; capture >= 5 of 7; honesty 100%), npm test, npm run check, npm run test:storage:fast.

Review findings C1, C2, C3, H4, H6, M2, M3, M4 in .agent_docs/aphelion-sophie/sophie-probe-2026-10-24/review.md.

Implemented scope:

- Built 24 October 2026 (5137d5b, 26f72b7): requester-only member memories (C1); no staff memories (H6); per-item memory and citation dropping, missing citations field tolerated (H4); member memories about the requester only, instruction, rank, real-name, location and health text refused (M2, M3 owner decision); unbacked claim sentences removed and real saves announced by DM (C3, owner decisions); memory-bearing reply shape, triggers and exclusions, AI_MEMORY_PROPOSED traces (C2 part). Offline and probe evidence in docs/verification.md.
- Installed in production as 26f72b7 on 24 October 2026 with the owner's approval; all checks passed.

Remaining scope:

- Owner: Go live again; live checks of a save DM, a removed claim and a staff turn without memory.
- C2 rest: owner-written memory examples so project mentions are captured.
- M4: retention renewal, same-subject replacement, written-days-ago, no relative-time words (owner decision on retention).

Full task deliverables:

- C1: a turn sees only the requester's own member memories plus channel memories; the remembering block forbids revealing what she remembers about anyone else
- H6: no memories in staff channels (recommended) or a case-vocabulary filter (owner decision)
- M2: a member memory must be about the requester; instruction-shaped and role-claim memory text is refused
- H4: an invalid memory item is dropped instead of discarding the reply; more than 4 citations are trimmed; local validation failures trace AI_OUTPUT_INVALID, not AI_WORKER_UNAVAILABLE
- C3: core shows "-# Sophie will remember: ... (/sophie to review)" only when a memory is actually saved, and a reply that claims to have saved, noted, deleted or complied without a matching memory is refused or corrected
- C2: memory capture works: a memory-bearing reply shape when memory labels are offered, explicit triggers and exclusions in the per-turn guidance, owner-written memory examples, AI_MEMORY_PROPOSED_n traces
- M4: retention renews only on re-proposal or member edit (or an absolute cap), same-subject replacement, written-days-ago in the memory view, no relative-time words

Boundary: Until C1 ships, keep AI off or keep automatic memory unused: a saved memory would be shown to other members. Sensitive-data handling (M3) and staff memories (H6) need owner decisions. Each install needs its own recorded approval.

## P53 — Grounding, capabilities and community vocabulary

Status: **pending**. Phase: AI quality. Priority: P0.

Depends on: P51. Acceptance: rv-cap-*, rv-ground-*, rv-auth-*, rv-label-* at their review.md gates, unit tests for each validation check, npm test, npm run check, npm run test:storage:fast.

Review findings C4, H1, H2, H3, H5, H7, M5, M6 in .agent_docs/aphelion-sophie/sophie-probe-2026-10-24/review.md; seed glossary in section 4.

Full task deliverables:

- H3: owner-published capability manifest and channel directory (commands /sophie, /lookup, /whitelist post; what she cannot do: voice, music, moderation, roles, live server or build status); a rule and a validation check that she never names a channel, command or process outside it
- H2: owner-approved glossary published as a knowledge document with aliases (CI, PMS, RDM, EORG ...), plus alias query expansion; settle Combat Indicator versus Combat Intent
- C4: lexical support check for provided_sources answers (numbers, channels, commands and rule codes must appear in a cited passage or the glossary); proactive replies need a retrieval score floor
- H1: Guidebook upstream rulesets relabelled as upstream references (or left out) and every evidence block names its game; an answer naming Wolfgate cites Wolfgate policy or says it relies on the Meridian fallback
- H7: defunct or banner-flagged pages (Red Server Policy, Starter Guide intents) withdrawn or marked historical
- H5: "Member N" labels removed from rendered replies; an addressed turn that comes back silent gets an owner-worded template reply
- M5: character examples may carry support and citations; owner-written examples for a capability refusal, "not verified" and a memory; joke about herself, never about facts; system message 0 exempt from redaction
- M6: owner-written context briefs; game per channel (schema change, owner approval); prompts say /sophie instead of the preferences page

Boundary: Manifest, directory, glossary, briefs and character changes are owner publications. Validation may refuse or replace a reply; it never grants anything.

## P54 — Retrieval, citations, code search and lookup

Status: **pending**. Phase: AI quality. Priority: P1.

Depends on: P51. Acceptance: rv-retrieval-*, rv-code-*, rv-cite-* probe cases, unit tests for anchors, acronyms, code terms, lookup with 5 results, no KNOWLEDGE_SOURCE_GITHUB_RATE_LIMITED after a full sync.

Review findings H8, L1, M1, M7, M9 in .agent_docs/aphelion-sophie/sophie-probe-2026-10-24/review.md.

Full task deliverables:

- L1: section anchors in link lines so different sections of one page show as separate links, with the rule code
- M1: parenthesised heading acronyms treated like rule codes; title boost only when the title covers the rarest word; a fallback for chatty questions; no retrieval in chat unless the message looks like a question
- H8: code search maps game words to a repository scope, stop-lists verbs, searches identifiers first, recognises "codebase"
- M7: GitHub file contents fetched through the authenticated API; 403 and 429 told apart; redirects keep auth on the same origin
- M9: /lookup takes the first 4 passages instead of failing on 5 (verify live)

Boundary: GitHub token only in Authorization headers to api.github.com; no generic URL fetching.

## P55 — Model profile and the probe as a release gate

Status: **pending**. Phase: AI quality. Priority: P1.

Depends on: P52, P53. Acceptance: cases-review.json gates pass before every AI release.

Review findings M8 and M10 in .agent_docs/aphelion-sophie/sophie-probe-2026-10-24/review.md.

Full task deliverables:

- M10: probe evaluator for the assert fields, N runs per case, a pinned knowledge snapshot, and a staging-backed memory suite
- M8: trials of strict JSON schema output, temperature by context (support and staff about 0.2) and mistral-medium for support, compared on cases-review.json

Boundary: A model or profile change alters mistralProfileHash and needs policy re-acceptance and requalification.

## P56 — Member records: a Staff forum with one post per member

Status: **in_progress**. Phase: Community administration. Priority: P1.

Depends on: None. Acceptance: MR-01 to MR-14 (rendering), One post per member across leave and rejoin; the ledger links only to posted entries; no AI path reads the forum.

Owner decisions of 30 October 2026 in the decision log; proposal, probes and the Staff test run in .agent_docs/aphelion-sophie/member-records-forum-2026-10-30.

Implemented scope:

- Rendering module and tests (MR-01 to MR-14)
- Staff test run: 22 posts for current Staff and Lead Ops in forum 1562315014998728727, verified read-back

Remaining scope:

- Core integration and its install
- Backfill of the other members
- Application transcription after the permission is granted
- Discussion copy

Full task deliverables:

- modules/member-records: title, tags, header, ledger, three reserved messages, entries, application transcription, date-of-birth and game-name interpretation
- Core integration: migration 080 (member_records, member_record_events, runtime grants), outbox kinds member.record.open/entry/header, producers in the gateway projection, Shuttle grant, member actions and Whitelist loss
- Adoption of the Staff test run posts from staff-test-state.json; host-only paced backfill of every current member
- Approved-application transcription (needs the permission Discord asks for; undocumented join-request interface)
- Copy of the forum discussion into Sophie's database (owner: "She can copy into her DB"; never AI)
- Later: Discord moderation (Guild Moderation intent, View Audit Log) and SSymphony/game records for Meridian Rift and Wolfgate

Boundary: No AI reads or writes member records. Sophie decides nothing and sets no role from an application, and never opens, joins or reads an interview. Rejected applications are not recorded.
