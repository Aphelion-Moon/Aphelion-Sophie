# AI on the Test Discord Server — operator runbook

Status (30 September 2026): schema 064 and source commit `95e92bd` are installed on WUFF for the
Test Discord Server, using the `aphelion-sophie` Discord application. PostgreSQL, tunnel, supervisor
and core are running with a current Gateway. The worker is stopped. Public dashboard/login/denial
and current AI JavaScript checks passed; the owner already holds the configured test Head Admin role.
No live AI processing is cleared. Starting the worker is an owner action through the dashboard. Do not paste
the provider key, Discord token or trust-file contents into chat, logs or Git.

## What is installed

| Service (all Manual) | Account | Runs |
| --- | --- | --- |
| `aphelion-bot-postgres` | `NT SERVICE\aphelion-bot-postgres` | Staging PostgreSQL 17.11 on 127.0.0.1:52435, data in `C:\Aphelion\Sophie\staging\postgres-data`, from Sophie's own hash-verified binary copy in `C:\Aphelion\Sophie\postgres` |
| `aphelion-bot-tunnel` | `NT SERVICE\aphelion-bot-tunnel` | Pinned cloudflared for the `sophie-staging` tunnel (`sophie.a13.info`) |
| `aphelion-bot-ai-supervisor` | `NT SERVICE\aphelion-bot-ai-supervisor` | `apps/inference-host/installed.mjs`; control on 127.0.0.1:47551 |
| `aphelion-bot` | `NT SERVICE\aphelion-bot` | `apps/core/installed.mjs`; listeners 127.0.0.1:38121/38122 |
| `aphelion-bot-ai-worker` | `NT SERVICE\aphelion-bot-ai-worker` | `apps/knowledge-worker/main.mjs`; started/stopped only by the supervisor |

Start order: postgres, tunnel, supervisor, core. Wait at least 31 seconds between stopping and starting
core, because its Gateway ownership lease fails closed (`GATEWAY_OWNER_ACTIVE`) until then.
Setup is reproducible with `ops/windows/Setup-StagingServices.ps1` and `ops/windows/Setup-InferenceAccount.ps1`.
Both are idempotent and support `-WhatIf`.

Database `sophie_stage_bot` was created fresh for the new application, now with migrations 001–064. The
earlier staging data is retained, renamed and fenced as `sophie_stage_archive_20260929`, plus encrypted
bundles in `D:\Backups`. Runtime identities are `sophie_stage_core`, `sophie_stage_control` (AI tables only)
and `sophie_stage_knowledge` (read-only knowledge), plus `sophie_stage_knowledge_editor` (knowledge-only
SELECT/INSERT/UPDATE). The owner and admin logins are maintenance-only. Policy version 2 adds the
approved AI/editor capabilities for the existing configured Head Admin role; other grants and role ownership remain unchanged.

## Daily: renew the installation receipts

The September 30 local repair candidate is not installed. Its setup source adds worker read/execute
access to `services\worker` and metadata access to `services`; the installed worker currently lacks
the wrapper-directory grant. It also rejects drifted existing service/firewall configuration before
changing anything. Review the scoped repair/qualification proposal in
`GitHub/.agent_docs/aphelion-sophie/blocker-preparation-2026-09-30.json` before applying this candidate.
An installation receipt or successful `-WhatIf` does not prove actual worker file/network denial.

Trust files expire 24 hours after issue by design. From an elevated PowerShell:

```powershell
pwsh -File C:\Aphelion\Sophie\staging\renewal\renew-installation.ps1
```

It resyncs `package\source` from the committed repository (it refuses to run with uncommitted changes),
rewrites the manifest and both trust files with fresh keys, re-locks them, and restarts the supervisor
and core with the lease wait. The Discord credentials it reads live in `staging\renewal`, readable only
by SYSTEM, Administrators and the operator. A renewal also redeploys the current commit, so review what
is committed before running it.

The assembler retains `knowledge-editor.json`, `preference-journal.json` and any separately approved
`processing-policy.json` from the protected staging directory. The independent journal has its own
qualification expiry; renewing installation trust does not extend that evidence automatically.
After rechecking its ACL and database-restore exclusion, explicitly renew its receipt before expiry.
The September 30 installation trust expires 1 October at 13:57 Warsaw time.

## Enabling AI on one test channel

1. Record DS-01 evidence before clearing real message processing. The protected core installation accepts
   an optional `processingPolicy`: schemaVersion 1, provider `deepseek`, domain `public`, explicit `approved`,
   nonzero evidenceHash, validUntil, noticeRevision (at least 2), and reviewed noticeText. Missing, unapproved,
   expired or unqualified policy denies processing and opt-in. Renewal must retain this reviewed policy;
   never manufacture clearance from possession of an API key. It does not approve memory or restricted data.
   The owner reported disabling “Improve the model for everyone” on September 30. Base Terms 4.3
   names the switch and includes APIs; the Open Platform incorporates those terms and shares the account.
   This supports the improvement-use opt-out interpretation, but supplies no fixed API retention/deletion
   commitment. The downstream-user exclusion in Privacy Policy/Open Platform 5.5 still applies.
2. Review the effective capability policy. Grant the chosen operator role `ai.control`,
   `ai.personality.publish` and `ai.runtime.apply`; `ai.knowledge.publish` also requires the separate
   knowledge-only editor identity. Role names, guild ownership and Administrator do not grant these operations.
3. In the dashboard review/publish Sophie’s personality, participation for the exact public test channel,
   and the USD 20/month Europe/Vienna budget with 2,000 daily attempts and a current price review date.
   Knowledge tests additionally need reviewed current source publications and the 40-question acceptance.
   Tickets, onboarding, their parent categories and child channels remain excluded.
4. **Start the worker** from the dashboard AI page by selecting the installed release
   (`sophie-deepseek-<commit>`). Core asks the supervisor for a fresh boot, and the supervisor starts
   `aphelion-bot-ai-worker`. The worker reaches DeepSeek only on TCP 443, and only at public IPv4 addresses.
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
recreated at startup. Remote preference use remains separately disabled.

## Rollback

Disable AI and stop only Sophie’s affected services. Preserve retained database state, credentials,
receipts and the independent preference journal. After applying 064, repair forward with schema-064
compatible code; the old schema-063 package is no longer a runtime rollback. Cold copies and encrypted
bundles are retained recovery evidence and must remain quarantined if restored. They are not automatic
live rollback targets. Do not restore old Discord roles, reactivate approvals or erase uncertain effects.

## Still to do in Discord (owner)

- Remove the previous application's bot from the test guild, then remove its guild commands under
  Server Settings → Integrations. Delete the previous roles, category and lobby once no longer needed.
  The new bootstrap created fresh "Sophie Test" ones.
- Optionally grant the new bot **Manage Threads**, which child-thread inspection may require. Do not
  grant Administrator.
- Retire the previous application in the Developer Portal, then delete its credential file from the Desktop.
