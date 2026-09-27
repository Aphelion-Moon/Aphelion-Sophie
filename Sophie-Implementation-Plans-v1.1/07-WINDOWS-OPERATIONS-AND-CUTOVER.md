# 07 · Windows deployment, operations, and controlled cutover

## Deployment baseline

Target the actual Windows Server 2022 host. Use native services and a reproducible release directory. Docker Desktop is not a supported Windows Server 2022 deployment route, so this plan does not depend on it. [S33](11-SOURCES.md#s33)

The intended runtime line is Node.js 24 LTS, subject to the G0 licence/platform decision and a compatible exact patch. Node's guidance recommends LTS releases for production. Pin the release, not the word `latest`. [S12](11-SOURCES.md#s12)

WinSW is the MIT service-wrapper candidate; verify the selected stable release and its own runtime requirements. Its repository distinguishes stable 2.x from 3.x prereleases. Do not blindly use XML/options from a different major version. [S13](11-SOURCES.md#s13)

If PostgreSQL is explicitly approved, use a supported compatible Windows build and pin the driver/queue combination. Its Windows installer documentation lists Server 2022 for supported versions, but that does not waive the licence gate. Avoid installing unrelated bundled tools automatically. [S16](11-SOURCES.md#s16); [S18](11-SOURCES.md#s18)

## Existing host overlay and brand packaging

The included `Aphelion-Bot-WUFF-Hardware-Addendum.md` remains the proposed shared-host overlay, including the queue/thread profile, non-conflicting loopback listener, data-root review and game-first contention tests. Its reported snapshot is supplied; current load and approvals remain unverified. The original addendum is preserved unchanged for provenance.

Package `assets/sophie/neon-chibi-v1/`, `asset-manifest.json` and `brand-profile.json` with the immutable release. Hash-check assets during release validation and serve them locally from a separate public-static root, never the case-artifact directory. Appearance rollback selects a compatible prior approved asset/profile version; it must not roll back access policy or revoke audit records.

Sophie is a display-name change. Do not automatically rename existing Windows services, deployment directories, service accounts or credentials. A production bot-avatar/profile update is an explicit release action; never use it as a frequent status signal. Runtime image generation, animated avatar rendering and additional model processes are not introduced by this branding pack.

## Read-only discovery checklist

Record CPU model/cores/instruction support, total and available RAM, disk type/capacity, OS build/patches, existing workloads, services, ports, backup destination, DNS/TLS setup and operator access. Do not publish host secrets or unrelated private service details in the repository.

Illustrative read-only PowerShell inventory:

```powershell
Get-CimInstance Win32_Processor |
  Select-Object Name, NumberOfCores, NumberOfLogicalProcessors
Get-CimInstance Win32_ComputerSystem |
  Select-Object TotalPhysicalMemory
Get-CimInstance Win32_OperatingSystem |
  Select-Object Caption, Version, BuildNumber, FreePhysicalMemory
Get-Volume |
  Select-Object DriveLetter, FileSystem, Size, SizeRemaining
```

These commands are provided for the operator; they have not been run on the user's server. Complete a representative-load baseline before setting inference thread/memory limits.

## Process and account layout

| Service | Work | Credentials/data |
|---|---|---|
| Aphelion Core | Gateway, dashboard API, administrative job dispatch, final Discord delivery | Discord token, administrative store, required OAuth/session secrets |
| Aphelion Knowledge | Approved source sync, retrieval, bounded model requests | Knowledge store and approved connector credentials only |
| Aphelion Inference | CPU model serving | Read-only model files and local service authentication; no case/connector access |
| Approved database service | Durable storage | Separate administrative and knowledge identities/scopes |

Use dedicated least-privilege service identities, noninteractive operation, automatic recovery with restart backoff, and explicitly secured data/log/model directories. Do not run application services as LocalSystem or a personal administrator account by convenience. Validate that the knowledge/inference accounts cannot read the transcript directory or administrative credentials.

If the approved database cannot isolate principals at the required granularity, use separate databases/stores or another reviewed isolation method. Do not make the no-AI boundary depend solely on a coding convention.

## Suggested filesystem layout

```text
C:\AphelionBot\releases\<build-id>\      immutable application artifact
C:\AphelionBot\current\                  selected release reference
C:\ProgramData\AphelionBot\config\      validated non-secret settings
C:\ProgramData\AphelionBot\secrets\     protected references/material
C:\ProgramData\AphelionBot\cases\       transcripts/attachments; core only
C:\ProgramData\AphelionBot\knowledge\   approved snapshots/index state
C:\ProgramData\AphelionBot\models\      hash-verified read-only model files
C:\ProgramData\AphelionBot\logs\        bounded redacted operational logs
```

These paths are proposals. The installer must accept an approved root, validate ACLs and fail safely on conflicts; it must not overwrite another service's data.

## Installation deliverables

The implementation agent supplies reviewed scripts for inventory, preflight, installation, configuration validation, database migration, service registration, health checks, backup, restore and rollback. Do not present placeholder service XML or untested commands as production-ready.

Install from a built, hash-verified release bundle with a dependency lock, notices, model lock and configuration schema version. No application dependency installation or remote model download occurs during normal service startup. Secrets are provisioned separately.

Only the HTTPS dashboard ingress is exposed as needed. Serve production static assets, not a frontend development server. Inference and internal worker endpoints remain local and authenticated. Reuse approved existing TLS infrastructure where possible rather than silently introducing another non-MIT service.

## Health and failure behaviour

Separate liveness, administration readiness, and knowledge/AI readiness. Core is not unhealthy merely because the optional model is disabled. A database outage should prevent unsafe mutations and show a static recoverable error, not grant access from stale assumptions.

Monitor oldest administrative job, stuck provisioning, pending role grants, failed case ACL validation, source freshness, AI queue/latency/memory, disk headroom, backup success and credential-expiry signals where available. Keep metric labels free of case contents and personal identifiers unless necessary and approved.

Use an independent host/service alert or existing operator channel for total bot outage; the bot cannot reliably alert through itself when it is entirely down. Define a member-visible fallback contact route that does not depend on the failed onboarding workflow.

## Backup, restore, and upgrades

Agree recovery-point and recovery-time objectives in G0; do not invent them. Back up the authoritative database, required case artifacts, configuration/approval versions and deletion ledger. Model binaries can be re-fetched from verified artifacts if the restoration policy permits; record their hashes.

Use a database-consistent backup process and a compatible artifact manifest so restored case records reference recoverable files. Encrypt backups and protect keys separately. Test restore to an isolated location with Discord delivery disabled; never replay production outbox actions into the live server during a drill.

After restore, apply deletion/tombstone and revocation records, reconcile side effects, verify schema/application compatibility, and only then re-enable consumers. A restored old queue must not resurrect revoked access or duplicate tickets.

Use forward-compatible expand/migrate/contract changes for production schemas. Database rollback is not simply restoring an old executable. Retain the previous compatible build, drain/stop affected workers, and document whether a migration can be reversed without data loss. A failed upgrade can enter read-only maintenance while an approved recovery decision is made.

## Staging

Use a distinct test Discord application/token and test guild, with synthetic members/cases/knowledge. There is still only one production bot identity. Never start two uncontrolled gateway clients with the production token during a rolling test.

Disable outbound messages and role writes by default in restored/test environments. Configuration must bind a release to its expected guild and environment; mismatch is fatal. Model and branding tests do not require production conversations.

## Cutover runbook

1. Export/review current bot responsibilities, panel messages, join/restore rules, admission mappings and existing-member eligibility. Do not import historical tickets.
2. Snapshot approved current membership/restorable roles and record the source/time of the baseline. Do not make old s1–s5 roles sufficient completion evidence; owner-approved grandfathering is explicit.
3. Pilot with staff and test accounts. Complete permission, restart, rejoin, ambiguity and AI-isolation tests. Make a backup and verify the operator fallback contact route.
4. Transfer chat reactions/responses one rule group at a time: disable the old rule before enabling the new one. Observe and record the result.
5. Transfer join/restoration ownership with a single-writer boundary and new events captured during the transition. Keep an explicit rollback snapshot; avoid two bots fighting over roles.
6. Stop old ticket creation, then enable the new panels. Existing tickets can remain in the old system until humans close them; drain and retain them according to policy without migrating records. Do not remove old bot access while open cases still need it.
7. Publish the new Shuttle entry panel and retire the old progression panels. Existing admitted members keep the approved baseline; incomplete members get a deliberate resume/restart policy, not arbitrary progress inference.
8. Activate direct knowledge lookup, then local AI only after G3/G4. Administration does not wait for model approval.
9. Remove obsolete bot permissions/integrations only when responsibilities and remaining old cases are accounted for. Record the cutover configuration, release and operator approval.

## Rollback

First disable the affected new feature and drain/fence its pending writes. Re-enable an old feature only after confirming it has exclusive responsibility and current role/eligibility rules. Reconcile membership from current approved policy; never blindly restore a database snapshot into live Discord.

For failed ticket deployment, keep new cases readable by authorised staff, disable new creation, and route new requests through the approved fallback. Do not delete newly created cases to make rollback look clean. AI rollback is simply disabling AI and serving direct lookup; it must not affect tickets.
