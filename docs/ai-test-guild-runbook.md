# AI on the Test Discord Server — operator runbook

Status (29 September 2026): the source and offline tests are ready. **None of these steps has been run on
the host.** Every step marked *approval* changes host state, which needs the owner's explicit go-ahead.
Record the outcome of each one in `docs/verification.md`. Do not paste the provider key, Discord token or
trust-file contents into chat, logs or Git.

## 0. Gates that stay open throughout

- The owner confirms the 29 September account-isolation decision entry in `decisions/0001-owner-policy.md`.
- DS-01 provider/data-use clearance. Until it passes, public message processing stays blocked even with
  the worker running.
- Publication review of the selected knowledge sources, and the actual-answer gate.
- Per-channel participation and per-member opt-in on the test server, configured in the dashboard. Unknown
  channels default to ignore.
- The USD 20/month budget. Tickets and onboarding content are never AI inputs.

## 1. Stage a package (local)

Copy `apps`, `contracts`, `modules`, `platform`, `node_modules`, `package.json`, `package-lock.json` and
`LICENSE` from the reviewed commit into `<staging>\source`. Copy the pinned runtime into `<staging>\runtime`
(`node.exe`, SHA-256 `3602f2bb…0237`, plus `LICENSE`). The manifest is written in step 3.

## 2. Register the worker service — *approval*

```powershell
pwsh -File ops\windows\Setup-InferenceAccount.ps1 -WhatIf   # review first
pwsh -File ops\windows\Setup-InferenceAccount.ps1
```

This creates `aphelion-bot-ai-worker` under `NT SERVICE\aphelion-bot-ai-worker`, adds the worker's file
grants, replaces the `provider\` ACL, grants the supervisor start/stop rights on the service and creates four
outbound block rules. It also removes the stale Hyper-V container ACE (`S-1-5-93-2-2`) from `provider\`.
Readback commands are printed at the end.

## 3. Collect receipts and write trust files — *approval*

Record one evidence file per check. These are text captures, kept outside Git:

| Check | Capture |
| --- | --- |
| `service-account-identity` | `sc.exe qc aphelion-bot-ai-worker`, `sc.exe showsid aphelion-bot-ai-worker`, `sc.exe sdshow aphelion-bot-ai-worker` |
| `file-acl-scope` | `icacls` on `trust`, `trust\*.json`, `provider`, `state\boots`, the core database credential and the Discord token location; the worker SID must appear only on the allowed paths |
| `firewall-egress-scope` | `Get-NetFirewallRule -DisplayName 'Sophie AI worker*'` with its service/port filters |

A denial probe running *as* the worker (reading `trust\core.json` fails, a TCP 80 connection fails) would
be stronger than ACL readback. The earlier `qualification\service-probe.mjs` pattern can host one if the
owner wants it.

Write an input file in a restricted folder outside Git. Its fields are listed in the header of
`scripts/prepare-ai-installation.mjs`. The core block must contain `runtime`, `database`, `ownerDatabase`,
`controlDatabase`, `knowledgeDatabase` and `credentials` (`token`, `clientSecret`), matching
`apps/core/runtime/installed.js`. Then run:

```powershell
node scripts\prepare-ai-installation.mjs <restricted>\input.json
```

Copy `<staging>` to `C:\Aphelion\Sophie\package` and the two trust files to `C:\Aphelion\Sophie\trust`.
Rerun the setup script so `core.json` is readable only by `aphelion-bot` and `supervisor.json` only by
`aphelion-bot-ai-supervisor`. Register the printed release record in the dashboard AI worker catalogue.
The receipts expire after 24 hours, so trust files and the release record are reissued daily.

## 4. Point core and supervisor at the installed entrypoints — *approval*

In the existing WinSW XMLs under `services\`:

- `aphelion-bot`: set `<arguments>` to `"C:\Aphelion\Sophie\package\source\apps\core\installed.mjs" start-installed`
  and `<workingdirectory>` to `package\source`.
- `aphelion-bot-ai-supervisor`: set `<arguments>` to `"C:\Aphelion\Sophie\package\source\apps\inference-host\installed.mjs"`
  and change `<serviceaccount>` from `LocalSystem` to `NT SERVICE` / `aphelion-bot-ai-supervisor`. It already
  has full control of `state\boots`, and step 2 gave it rights on the worker service.

Installed core uses the same bot token as the foreground staging launcher (`.local/staging-host/run.mjs`).
Stop the launcher before starting `aphelion-bot`; they must never run at the same time.

## 5. Start and observe — *approval*

Start `aphelion-bot-ai-supervisor`, then `aphelion-bot`. Core drives the worker through the supervisor.
Never start `aphelion-bot-ai-worker` by hand. Check `logs\*` and the dashboard AI page for the worker
acknowledgement. Only then enable one test channel and one opted-in test member.

## Rollback

Stop the three services. Run `services\worker\aphelion-bot-ai-worker.exe uninstall` and remove the
`Sophie AI worker*` firewall rules. Restore the two XMLs from their backup copies and restart the
foreground staging launcher. Trust files and boot directories can be deleted; they hold no durable state.

## Obsolete after confirmation

- The `aphelion-bot-ai-egress` service and `services\egress`: stopped, Manual, and no longer used by any code.
- `worker-trust\` and the `qualification\*-probe` executables from the HCS trials.
- The Hyper-V role. Disabling it needs a reboot, which is not authorized.

Remove these only with approval. They are harmless while stopped.
