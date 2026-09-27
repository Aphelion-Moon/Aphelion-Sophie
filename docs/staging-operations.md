# Current isolated staging operation

On 20 September 2026 the owner authorized `https://sophie.a13.info` and the
[cloudflared staging exception](decisions/0004-staging-cloudflare.md). The test bot,
dedicated PostgreSQL cluster and separate foreground tunnel connector were launched
on the current development computer; they were restarted and verified on 27 September as recorded below. This is not a Windows service or production
release. Only synthetic content belongs in this test guild.

## Selected build: schema 054 — upgrade verified 27 September

The owner explicitly approved this upgrade and the public /whitelist command rename.
The launcher now selects build-9479c2c-lf, commit **9479c2c**, with 765 exact commit
file hashes. Schema-053 preservation and quarantined restore passed; all 70 original
table fingerprints are unchanged, 54 migrations and 70 runtime table checks passed,
and a current encrypted backup completed. Runtime configuration and grants are unchanged.

The previous processes/database were already absent despite stale health status;
no orderly prior shutdown is claimed. New host PID 5156 and connector PID 31416
reached fresh current Gateway with verified parent/loopback ownership and empty
stderr. All 24 public HTTPS checks passed. The guild command retains its ID under
/whitelist with seven subcommands; /shuttle is absent and unrelated commands unchanged.
See [live evidence](evidence/onboarding-followup-live.json). These are timed observations.

Next: the owner's private account recovery, cleanup, close/panel, login and wording
retest in [handoff](handoff.md). Do not repeat this completed migration or registration.
No panel was posted, authored publication changed or account impersonated. Existing
channels received a fresh grace period. No production release or independent recovery pass.
Rollback is stop-and-repair-forward with schema054 compatible code. run-before-054.mjs
is provenance only; never run schema053 executables against this database.

## Historical build: schema 053 — restart verified 27 September

The authorized upgrade completed through **036476f / schema 053** on 20 September.
The selected launcher is .local/staging-host/run.mjs, backed by
build-036476f/ and its 754-file manifest. After the earlier offline
[handoff check](evidence/onboarding-handoff-status.json), a fresh preflight verified
all archive hashes, the unchanged launcher, no stop file, absent owned processes,
no listeners on 38121–38123 and dedicated pg_ctl status 3. The authorized restart
at 12:40 UTC reached fresh current Gateway. Host PID 36644 and connector PID 33696
matched the live status, process parent and loopback port ownership. These are
time-bound observations; recheck before later operational actions.

The 053 receipt records 70 unchanged table fingerprints, 53 migration hashes and 70
restricted runtime table checks, a verified pre-upgrade quarantined restore and a
fresh encrypted 053 backup. The preceding 046→052 migration preserved all 69 old tables
and added only core's ordinary access to the wording table. Runtime configuration,
capability grants and automation state were unchanged. No permission candidate was
activated. Preservation receipts and keys remain in the restricted ignored host folder.

All **12 public HTTPS checks** passed using check-053.mjs, including the exact
wording JavaScript hash, System wording OAuth-start redirect, external-return
rejection, anonymous session/wording denial and unsigned-interaction denial.
See [schema-053 live evidence](evidence/onboarding-experience-live.json).
The check started one OAuth flow for /localizations without logging into an account.
Fresh logs are host-053-20260927-144000.log and its separate -errors.log under
.local/staging-host/; previous logs remain intact. No migration, bootstrap,
configuration change or permission activation was performed.

**Historical next step (completed above):** owner feedback produced the local [schema-054 follow-up](onboarding-followup.md).
Obtain its explicit staging-upgrade/command-registration authorization before live
changes. The existing 053 runtime remains selected. Do not rerun successful prior
upgrades. The
[schema 052 public checkpoint](evidence/onboarding-experience-052-live.json) is historical.
Preserve it when recording final 053 results. Independent recovery and human acceptance
remain open. The earlier handoff check was read-only; the subsequent continuation
performed the already authorized restart of the existing staging processes.

**Rollback:** repair forward with compatible schema 053 code. Neither 052 nor 046
executables can run against this database. Keep all history, receipts and parked work;
do not downgrade or activate a quarantined restore. run-before-053.mjs is provenance,
not a compatible fallback. Use the current run-build-036476f.mjs selection.

## Historical schema-046 checkpoint

At this historical checkpoint, the isolated host ran pinned **2b984d2** at schema **046**, with the
[dashboard feedback fixes](dashboard-feedback.md): quiet authoring access checks,
renewable sessions and OAuth return paths, grouped navigation, Markdown previews
and explicit Next/Back screens within each Shuttle step. The pinned archive is
`.local/staging-host/build-2b984d2/`; `run.mjs` selects it and verifies every file.

The current schema-045 database was encrypted under a new restricted child of
`D:\Backups` and restored into a separate owner-only quarantined/read-only database
before migration 046. All **69** original core tables retained their old-column
fingerprints; **46** migration hashes and **69** restricted runtime table grants
pass. A current schema-046 encrypted backup also completed. Configuration and
capability grants are unchanged, automation remains disabled, and no commands or
authored copy were published. See [live evidence](evidence/dashboard-feedback-live.json).
No private case or onboarding content entered agent tools.

Gateway health is current and eight public HTTPS checks passed, including the
new shell/Markdown assets, return-page links, rejected external return targets,
anonymous session denial and unsigned-interaction denial. Owner acceptance of
real OAuth renewal, focus behavior and Discord Next/Back is still required.
Local preservation remains distinct from independent recovery and production approval.

**Rollback boundary:** schema-045 executables, including de8b32b and b0426ca,
cannot run against 046 or new screen-aware sessions. Stop and repair forward with
a compatible build, preserving all history. Do not downgrade the database or
activate a quarantined restore. The earlier launchers are retained for provenance,
not as current rollback targets. `run-before-046.mjs` preserves the old selection;
`run-build-2b984d2.mjs` is the current pinned launcher.

## Historical schema-032 to 045 checkpoint

The previous isolated host was pinned to **de8b32b** (20 September 2026), including
adaptive Shuttle authoring, reviewed permission candidates and the automation
configuration/recovery browser. Its immutable archive is under ignored
`.local/staging-host/build-de8b32b/`; `run.mjs` verifies the archive manifest before
starting. Ordinary edits to the checkout no longer change the selected staging
build on restart. Select and qualify a new pinned archive for later upgrades.

The original schema-032 database was encrypted under a new restricted child of
`D:\Backups`, restored into a separate owner-only quarantined/read-only database,
then upgraded through 033–045. All 54 original tables retained their old-column
fingerprints; all 45 migration hashes and 69 restricted runtime table grants pass.
A second encrypted backup preserves the upgraded schema. No retained file blobs
were present. No case content was printed or supplied to agent tools. The local
key and receipts remain in the restricted ignored host directory; independent
key custody, off-host recovery and latest independent control history are unresolved.

Configuration, role/channel maps and capability-policy versions were unchanged.
Automation remains disabled. Optional `permissions.publish`, `answers.publish`
and `automation.publish` remain omitted/denied; granting them needs an explicit
reviewed configuration. Public shells do not confer editor access. No commands
were re-registered. Private owner testing is now due for adaptive Shuttle
publication and version-pinned Discord journeys, followed by the existing synthetic
ticket reader/export/closed-audience checks. No human acceptance was entered.

Gateway health is current. `/`, `/automation`, `/permissions` and the automation
entry asset return 200 with CSP/no-store; anonymous session access is 403 and an
unsigned interaction is 401. See [live evidence](evidence/staging-upgrade-live.json).
The resource evidence below describes earlier checkpoints, not the current schema.

Before migration 046, rollback at schema 045 could use the pinned **b0426ca** archive
and `.local/staging-host/run-rollback-b0426ca.mjs`. That build passed current
database/privilege/configuration checks; its live startup was not exercised.
Follow the same orderly stop and lease-expiry procedure, preserve the current
launcher, and select that launcher as `run.mjs` before restarting. Never downgrade
the database or replace current records with the preservation copy. The separately
retained **27e6350** launcher matched the previous live source report and was a
pre-migration contingency only; it cannot run against schema 045. Restored copies
remain quarantined and are not rollback activation targets.

## Original bootstrap resources and evidence (historical)

- Five zero-permission test roles, private case category, test lobby, current-owner
  Head Admin assignment and `shuttle`, `ticket`, `mute`, `unmute` guild commands.
- Separate Cloudflare tunnel `sophie-staging` and a proxied DNS record for
  `sophie.a13.info`; no existing tunnel or DNS record was replaced.
- Exact `/discord/interactions` routes to IPv4 loopback port 38121; other paths on
  the hostname route to dashboard port 38122. The tunnel's catch-all is HTTP 404.
- Dedicated PostgreSQL 17.11 cluster, new maintenance/owner/core credentials and
  database `sophie_stage_bot`; the runtime identity passed all 32 migration hashes
  and privilege checks on 54 core tables. This is separate from integration-test
  clusters and existing game/wiki databases. The reviewed binaries are used read-only.
- Discord accepted `https://sophie.a13.info/discord/interactions`, verifying its
  signed PING. Unsigned and forged signatures receive HTTP 401 through public HTTPS.
  Gateway readiness is current; the landing page is served with CSP and no-store.
- Anonymous session access is denied. OAuth start returns the intended Discord
  authorization URL and a Secure, HttpOnly cookie. The owner registered
  `https://sophie.a13.info/auth/callback` and REST confirms it. The owner completed
  OAuth on a private machine; metadata-only database checks confirm the completed
  flow and active owner session. The owner confirms the editor is visible.

See the [live report](evidence/discord-staging-live.json) and separate
[resource-bootstrap report](evidence/discord-bootstrap-verification.json).
No live Shuttle, case privacy matrix, transcript/export or recovery acceptance is
claimed. Guidance/forms have not been published into this new database.

## Local control

Local configuration, the tunnel token, database credentials, retained data and the
operational launchers are under ignored `.local/staging-host/`, restricted to the
operator, SYSTEM and local Administrators. They are host-specific operational files,
not production packaging. The source-bound live report records launcher hashes.
Do not print credential files or copy them into Git. The temporary Cloudflare API
credential is needed for setup, not normal connector operation.

From the repository root, read redacted health:

```powershell
Get-Content -LiteralPath .local/staging-host/status.json
```

Request an orderly stop of this host, its owned connector and its owned database:

```powershell
Set-Content -LiteralPath .local/staging-host/stop -Value stop
```

Wait for `stopped: true` in the status file. Preserve the database, configuration,
bootstrap receipt and `.local/staging-category-reconciliation.json`; no deletion
or role restoration is part of stop/rollback. The public hostname remains routed
but unavailable when the foreground host/connector is stopped.

After a confirmed stop, allow the retained 30-second Gateway lease to expire
(wait at least 31 seconds), remove only the stop request, then restart:

```powershell
Remove-Item -LiteralPath .local/staging-host/stop
node .local/staging-host/run.mjs
```

Do not run the one-time database setup again or launch a second host. The launcher
verifies pinned PostgreSQL and cloudflared hashes, disables connector automatic
updates and request logging, and uses the restricted core database identity.
The public hostname, live Gateway and worker health must be checked after restart;
the 20 September reader update completed an orderly stop/restart after lease
expiry and returned to current Gateway health. This verifies restart mechanics,
not end-to-end case recovery or a production release gate.

The `/cases` reader is now running. The owner confirmed **Check ticket** works
after the [scan-metadata repair](ticket-staging-diagnosis.md). The requested
[persistent saved-link DMs](ticket-direct-notices.md) are implemented with a
private command fallback. Migration 032 is installed with 32 verified hashes and
54 restricted table grants. Gateway health is current and public GET returns 200.
Two scoped current-policy inspections queued through the ordinary outbox verified
the existing Quick Help channels; both saved-link DMs have verified Discord receipts
and completed jobs. No new ticket, case-content inspection or public message was needed.
The two parked notices await an authorized `/ticket issues` recheck. See
[the diagnosis and evidence](ticket-staging-diagnosis.md).

After navigation succeeds, use the existing **Quick Help** case in
the isolated guild, post only synthetic test text, then copy that case channel's
ID into the reader in a private browser. Review and confirm its export. This live
workflow is awaiting completion; no login cookies are requested. Quick Help
does not require a published form. Other form/Shuttle paths still need explicit
synthetic publication. See [the browser milestone](case-browser.md).

## Remaining setup

Use the owner's private browser and explicitly publish synthetic guidance/forms before
testing intake. Use separate consenting accounts for ordinary-member/Staff/Head
Admin privacy tests; the Discord owner bypasses channel ACLs. Do not request the
owner's private-browser cookies or require sign-in through the agent browser.

Production still needs the existing G2/recovery gates, production copy/audiences,
Windows identities and service packaging, runtime distribution review, independent
backup/control watermark and recorded operator release approval. No backup target
was inferred from the supplied Cloudflare credential file.
