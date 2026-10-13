# AI on the Test Discord Server — operator runbook

Status (13 October 2026): installed pin `5c54ba4` (14:23 UTC; `18f214d` prepared), after the hosting conversion to `d8fb0e5`
(12 October, 19:08 UTC); see `docs/verification.md` for the full sequence and the prepared next update. The conversion
implements the owner's AI stack decisions of 12 October (decision log; audit in
`GitHub/.agent_docs/aphelion-sophie/ai-stack-audit-2026-10-12.md`): turns read Gateway state and check authorization
twice, delivered replies are not re-verified, the worker is an ordinary service without the supervisor, trust and
journal receipts no longer expire, and Go live persists across restarts and deployments. Channel
`1551010229339037738` is activated. History of the 11–12 October deployments: [verification](verification.md). Do not
paste the provider key, Discord token, database passwords or trust-file contents into chat, logs or Git; verifiers
must print fixed codes only. Sections below that describe the 4 October builds are history.

### Operating the AI after the hosting conversion

1. Deploy from an elevated PowerShell 7 prompt with the deployment folder's `run-conversion.ps1` (later pins: a
   `run-deployment.ps1` built the same way). The script stops and starts Sophie's services itself; no dashboard stop
   is needed, and PostgreSQL and the tunnel keep running.
2. After a deployment or restart nothing needs to be clicked: the worker reconnects to core on its own and Go live
   stays in force. Only after the one-time conversion does the owner click **Go live** once, because the retiring
   supervisor-era core disables AI on its way out.
3. The dashboard's AI worker panel only reports **Connected** / **Not connected**. If it stays disconnected for more than
   a minute, check `C:\Aphelion\Sophie\logs\worker\` (fixed codes `AI_WORKER_FAULT …`, `AI_WORKER_UNAVAILABLE …`) and that
   `aphelion-bot-ai-worker` is running; WinSW restarts it if it exits.
4. Consent survives restarts. If the restart opened a fresh Gateway session, consent is kept when the member's
   Discord join time precedes the consent; a leave and rejoin still voids it.
5. Diagnose turns with the fixed codes in `C:\Aphelion\Sophie\logs\core\aphelion-bot.err.log`:
   `AI_ADMISSION_SKIPPED_<REASON>`, `AI_TURN_<STATE>_<STAGE>_<N>S[_<CODE>]`, `AI_OBSERVATION_LIMITED_MEMBER_…` (a member
   Discord had not yet described to core; rare), `AI_WORKER_CONNECTION_UNAVAILABLE`, `AI_QUALIFICATION_REBIND_UNAVAILABLE`.
6. Delivered replies are withdrawn only when the member opts out or leaves, or a message the reply drew on is edited
   or deleted. Disabling AI keeps earlier replies.

## What is installed

After the conversion. Before it (7764723), the supervisor also runs with control on 127.0.0.1:47551 and starts the worker.


| Service (all Manual) | Account | Runs |
| --- | --- | --- |
| `aphelion-bot-postgres` | `NT SERVICE\aphelion-bot-postgres` | Staging PostgreSQL 17.11 on 127.0.0.1:52435, data in `C:\Aphelion\Sophie\staging\postgres-data`, from Sophie's own hash-verified binary copy in `C:\Aphelion\Sophie\postgres` |
| `aphelion-bot-tunnel` | `NT SERVICE\aphelion-bot-tunnel` | Pinned cloudflared for the `sophie-staging` tunnel (`sophie.a13.info`) |
| `aphelion-bot` | `NT SERVICE\aphelion-bot` | `apps/core/installed.mjs`; listeners 127.0.0.1:38121/38122 and the worker channel 127.0.0.1:47552 |
| `aphelion-bot-ai-worker` | `NT SERVICE\aphelion-bot-ai-worker` | `apps/knowledge-worker/main.mjs`; reads `trust\worker.json` and the provider key, dials core; restarted by WinSW/SCM if it exits |
| `aphelion-bot-ai-supervisor` | `NT SERVICE\aphelion-bot-ai-supervisor` | Retired: **Disabled**, kept only so `rollback.ps1` can restore the 7764723 hosting |

Start order: postgres, tunnel, core, worker (the worker waits and retries until core listens). Wait at least 31 seconds
between stopping and starting core, because its Gateway ownership lease fails closed (`GATEWAY_OWNER_ACTIVE`) until
then. Setup is reproducible with `ops/windows/Setup-StagingServices.ps1` and `ops/windows/Setup-InferenceAccount.ps1`.
Both are idempotent and support `-WhatIf`; the latter also upgrades a supervisor-era worker wrapper in place.
Database `sophie_stage_bot` was created fresh for the new application, now with migrations 001–069. The
earlier staging data is retained, renamed and fenced as `sophie_stage_archive_20260929`, plus encrypted
bundles in `D:\Backups`. Runtime identities are `sophie_stage_core`, `sophie_stage_control` (AI tables only)
and `sophie_stage_knowledge` (read-only knowledge), plus `sophie_stage_knowledge_editor` (knowledge-only
SELECT/INSERT/UPDATE). The owner and admin logins are maintenance-only. Policy version 2 adds the
approved AI/editor capabilities for the existing configured Head Admin role; other grants and role ownership remain unchanged.

## Applied updates

The current `335a3f2` deployment added migrations 067–069, allowing the fixed moderation, case-delivery
and Shuttle recovery return paths. All 77 original rows across 103 tables and all grants were preserved.
The 512 selected source files match the pinned Git bytes. It added no AI processing clearance or worker
activation. Evidence: `GitHub/.agent_docs/aphelion-sophie/deployment-335a3f2-2026-10-04/verification.json`.
The initial post-start HTTP assertion failed with an unrecorded status; a focused rerun passed. Its cause
remains unexplained. Future operational checks must record unexpected status codes without response bodies.

The earlier schema066 privacy update below remains part of the installed build and records its original grants.

The installed source adds exact-notice consent receipts, identifier redaction, default deletion on
departure and explicit retention. The owner approved the concrete proposal in
`GitHub/.agent_docs/aphelion-sophie/test-readiness-2026-10-04/`. Source `5f60a24`, migrations 065/066,
the exact grants below, receipt renewal and Sophie service starts were applied. Member processing
remains held, the worker stopped and publications unchanged. Results are recorded in
`GitHub/.agent_docs/aphelion-sophie/deployment-5f60a24-2026-10-04/verification.json`.

The maintenance identity migrated only `sophie_stage_bot` after checking existing migration
checksums and preserving a verified cold recovery point. All 72 original rows across 101 tables
were preserved. In addition to its existing grants, AI control received SELECT/INSERT on
`sophie_ai.request_tombstones`, SELECT/INSERT/DELETE on
`sophie_ai.effect_erasure`, and DELETE on `sophie_ai.consents` and `sophie_ai.request_receipts`.
Core gains no AI-schema access or DELETE privilege. Installed control qualification now rejects any
missing privilege in this delta with `AI_DATABASE_PRIVILEGES_MISSING` before composing the service.

Preserve the independent journal's bytes and identity; verify its ACL, integrity, capacity and exclusion
from database restores. Renew its receipt separately from installation trust. Do not rerun a provisioning
helper that would recreate a missing journal. A missing or corrupt journal is a recovery hold.

## Renew the installation receipts (obsolete after the hosting conversion)

Trust and journal receipts no longer expire once `d8fb0e5` is installed; this section describes the supervisor-era
procedure and must not be used afterwards. `staging\renewal\renew-installation.ps1` mirrors repository HEAD, never use it.

The October 4 deployment retained the reviewed worker access to `services\worker` and metadata access
to `services`. Setup rejects drifted service/firewall configuration before mutation. Current package,
configuration, service-child identities, recovered supervisor state and dashboard checks passed;
qualified descriptors/firewall scope stayed unchanged. The protected assembler now points to fresh
`qualification\evidence-20261004-335a3f2` configured identity/ACL/firewall evidence. This does not prove
actual worker file/network denial or physical stop; those checks remain open with the worker stopped.

Trust files expire 24 hours after issue by design. The legacy protected helper
`C:\Aphelion\Sophie\staging\renewal\renew-installation.ps1` copies repository source and restarts services.
Its pre-mutation guard now requires a clean checkout of exactly
`335a3f267b357612dbdc08affc1eefe7da35034f`; the newer working checkout is rejected before any service stop.
Do not remove that guard to renew from a later HEAD. Use a reviewed runner bound to the approved source
archive, with fresh evidence, confirmed child quiescence and the Gateway lease wait. A source change
requires its own deployment authorization. The protected assembler is also pinned to `335a3f2`.
Credentials remain in the existing protected staging directory and must never enter the review packet.

The assembler retains `knowledge-editor.json`, `preference-journal.json` and any separately approved
`processing-policy.json` from the protected staging directory. The independent journal has its own
qualification expiry; renewing installation trust does not extend that evidence automatically.
After rechecking its ACL and database-restore exclusion, explicitly renew its receipt before expiry.
Current installation trust expires **5 October 2026 at 19:54:15 UTC (21:54 Warsaw)**. The independent
journal receipt expires **18:54:14 UTC (20:54 Warsaw)** and is not extended by installation renewal.
Its existing bytes/identity were verified and preserved. Renewed timestamps must follow fresh evidence,
not merely the passage of time. The protected recovery point is
`D:\Backups\sophie-staging\schema069-335a3f2-20261004`; its separate journal copy must never replace
current journal history during a database restore. Later documentation commits do not change the
installed source pin; review the exact next commit before any further deployment.

## Enabling AI on one test channel

1. Record DS-01 evidence before clearing real message processing. The protected core installation accepts
   an optional `processingPolicy`: schemaVersion 2, provider `mistral`, domain `public`, explicit `approved`,
   nonzero evidenceHash, validUntil, noticeRevision (at least 2), and exact reviewed noticeText (at most
   8000 characters). Its review must be `accepted` and bind actual processor-agreement, Discord
   service-provider, retention/deletion and international-transfer evidence hashes. Drafts and legacy
   schema1 receipts cannot authorise remote processing. Missing, unapproved, expired or unqualified
   policy denies processing and opt-in. Renewal must retain this reviewed policy;
   never manufacture clearance from possession of an API key. It does not approve restricted data; the notice must describe member-written notes before members can share them.
   The owner reported disabling “Improve the model for everyone” on September 30. Base Terms 4.3
   names the switch and includes APIs; the Open Platform incorporates those terms and shares the account.
   This supports the improvement-use opt-out interpretation, but supplies no fixed API retention/deletion
   commitment. The downstream-user exclusion in Privacy Policy/Open Platform 5.5 still applies.
   The owner reports an EU-based operation. The unsent provider enquiry at
   `GitHub/.agent_docs/aphelion-sophie/test-readiness-2026-10-04/provider-enquiry-DRAFT.json` requests applicable API
   processor terms, retention/deletion commitments, subprocessors and international-transfer safeguards.
   A member disclosure does not create those provider commitments or install processing clearance.
2. Review the effective capability policy. Grant the chosen operator role `ai.control`,
   `ai.personality.publish` and `ai.runtime.apply`; `ai.knowledge.publish` also requires the separate
   knowledge-only editor identity. Role names, guild ownership and Administrator do not grant these operations.
3. In the dashboard review/publish Sophie’s personality, participation for the exact public test channel,
   and the USD 20/month Europe/Vienna budget with 2,000 daily attempts and a current price review date.
   Knowledge tests additionally need reviewed current source publications and the 40-question acceptance.
   Tickets, onboarding, their parent categories and child channels remain excluded.
4. **Start the worker** from the dashboard AI page by selecting the installed release
   (`sophie-mistral-<commit>`). Core asks the supervisor for a fresh boot, and the supervisor starts
   `aphelion-bot-ai-worker`. The worker reaches Mistral only on TCP 443, and only at public IPv4 addresses.
5. Select the configured channel under **Enable a reviewed public channel**, review, then confirm. The
   maintenance identity verifies current authorization, actual worker acknowledgement, public channel
   audience, processing evidence, publication hashes and budget again before committing qualification
   and clearing the global processing hold. Changed reviews fail; duplicate confirmations do not enable
   AI again after a later disable. Do not insert qualification rows or flip database flags manually.
6. Test members read the displayed processing notice and opt into that channel individually. Consent to
   an older notice does not carry forward after an installation with a new notice revision.
7. Record installed worker boot/lease, actual child-process network/file denials, stop/revocation and a
   receipt-to-Discord response within 15 seconds. Exercise exclusion and opt-out with synthetic data.

Perform the synthetic worker isolation and stop checks before enabling a member channel. Keep
protected-file probes metadata-only: opening a forbidden file must fail; never read or print its
contents. Network denial needs a reachable controlled endpoint and a successful control connection;
a timeout to an unroutable address is not firewall evidence. The approved account design blocks
non-443 outbound traffic, with fixed-provider/public-IPv4 checks in the application. It does not
claim OS denial of loopback or arbitrary TCP 443. Record actual wrapper and Node-child exit,
not only SCM's stopped state. Keep processing disabled until these checks and DS-01 are cleared.

The installed knowledge editor uses optional `knowledgeOwnerDatabase`, a distinct non-owner PostgreSQL
login with only USAGE and SELECT/INSERT/UPDATE in `sophie_knowledge`, no CREATE and no core/AI access.
The separate read-only knowledge login remains unchanged. No source is published automatically; the
fixed Policies synchronizer refreshes only after Gateway readiness and stops with core.

Preferences use optional `preferenceJournal` with id, evidenceHash and expiresAt in protected core
configuration. Its fixed path is `C:\Aphelion\Sophie\preferences\watermarks.jsonl`, independently
provisioned outside database restore bundles and readable/writable only by core plus the operator,
SYSTEM and Administrators. Missing/truncated/unqualified journals stay unavailable and are never
recreated at startup. Saved settings and member-written notes reach inference only for a member who ticked the sharing switch, on that member's own turns in a consented channel. This needs migration 070 and the same journal; without the journal no memory is read.

Before enabling the candidate, exercise default departure deletion and separately saved retention with
synthetic accounts. Check rejoin requires fresh consent, pending cleanup holds new processing, dependent
effects are removed only after acknowledgement, and uncertain spending stays pending. Retention keeps
local saved data within existing expiry limits and never preserves temporary context or active consent.
Use the updated notice and retention annex; provider copies and backups need their own factual schedules.

## Rollback

Disable AI and stop only Sophie’s affected services. Preserve retained database state, credentials,
receipts and the independent preference journal. After applying 069, prefer a schema069-compatible
forward repair with AI disabled. The older schema066 build is not a compatible runtime rollback. Do not restore a
pre-deletion snapshot as live data or discard the new erasure/replay markers. Cold copies and encrypted
bundles are retained recovery evidence and must remain quarantined if restored. They are not automatic
live rollback targets. Do not restore old Discord roles, reactivate approvals or erase uncertain effects.

## Still to do in Discord (owner)

- Remove the previous application's bot from the test guild, then remove its guild commands under
  Server Settings → Integrations. Delete the previous roles, category and lobby once no longer needed.
  The new bootstrap created fresh "Sophie Test" ones.
- Optionally grant the new bot **Manage Threads**, which child-thread inspection may require. Do not
  grant Administrator.
- Retire the previous application in the Developer Portal, then delete its credential file from the Desktop.
