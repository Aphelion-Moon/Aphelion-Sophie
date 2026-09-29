# AI on the Test Discord Server — operator runbook

Status (29 September 2026): Sophie runs on WUFF as installed services against the Test Discord Server,
using the `aphelion-sophie` Discord application. The AI worker is installed but **not started**, and no
channel is qualified for AI. Starting it is an owner action through the dashboard (step 3). Do not paste
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

Database `sophie_stage_bot` was created fresh for the new application, with migrations 001–063. The
earlier staging data is retained, renamed and fenced as `sophie_stage_archive_20260929`, plus encrypted
bundles in `D:\Backups`. Runtime identities are `sophie_stage_core`, `sophie_stage_control` (AI tables only)
and `sophie_stage_knowledge` (read-only knowledge). The owner and admin logins are maintenance-only.

## Daily: renew the installation receipts

Trust files expire 24 hours after issue by design. From an elevated PowerShell:

```powershell
pwsh -File C:\Aphelion\Sophie\staging\renewal\renew-installation.ps1
```

It resyncs `package\source` from the committed repository (it refuses to run with uncommitted changes),
rewrites the manifest and both trust files with fresh keys, re-locks them, and restarts the supervisor
and core with the lease wait. The Discord credentials it reads live in `staging\renewal`, readable only
by SYSTEM, Administrators and the operator. A renewal also redeploys the current commit, so review what
is committed before running it.

## Enabling AI on one test channel

1. **Clear the gates first**: DS-01 provider/data-use clearance, knowledge-source publication review, and
   the USD 20/month budget policy. Tickets and onboarding content are never AI inputs.
2. **Dashboard setup** (Head Admin): publish the AI notice and budget policy, then have test members opt in.
3. **Start the worker** from the dashboard AI page by selecting the installed release
   (`sophie-deepseek-<commit>`). Core asks the supervisor for a fresh boot, and the supervisor starts
   `aphelion-bot-ai-worker`. The worker reaches DeepSeek only on TCP 443, and only at public IPv4 addresses.
4. **Qualify one channel**: insert its row in `sophie_ai.qualifications` as the owner identity. The row
   binds the release and evidence hashes, so it has to be reissued when the release changes. Unknown
   channels default to ignore.

## Rollback

Stop the four running services. Core, supervisor and the worker return to the previous state by
restoring the XML backups in `C:\Aphelion\Sophie\rollback\20260929-170850` (the old configs no longer
start anything useful). The database rollback is the cold copy
`D:\Backups\sophie-staging\cold-20260929-172054` plus its credential files. Uninstall added services with
their WinSW `uninstall` (tunnel, worker) or `pg_ctl unregister -N aphelion-bot-postgres`, and remove the
`Sophie AI worker*` firewall rules. Retired artifacts from the earlier project name are archived under
`D:\Backups\sophie-staging\legacy-artifacts-20260929`.

## Still to do in Discord (owner)

- Remove the previous application's bot from the test guild, then remove its guild commands under
  Server Settings → Integrations. Delete the previous roles, category and lobby once no longer needed.
  The new bootstrap created fresh "Sophie Test" ones.
- Optionally grant the new bot **Manage Threads**, which child-thread inspection may require. Do not
  grant Administrator.
- Retire the previous application in the Developer Portal, then delete its credential file from the Desktop.
