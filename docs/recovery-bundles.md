# Isolated backup and restore

P06/P26/P27, T01/T24/T39/T57/T58: the local operator tool now makes an encrypted,
database-consistent backup and restores it into a quarantined database. This is
partial recovery evidence. It does not implement independently recoverable latest
revocations/deletion history, off-host storage, retention, rollback or production
activation. No live staging or production database was backed up by this milestone.

`node apps/core/recovery.mjs backup --request <absolute-request-json>` accepts only
an explicitly selected loopback staging database. `restore` accepts only an empty,
owner-controlled `sophie_restore_<16–32 lowercase hex>` database. Provision that
database with a separate owner identity and no other CONNECT grants before using
the tool. The tool cannot create a database, overwrite one, install a service or
load a Discord token. Never use a production credential or a source database as
the restore target.

### Exact schema-032 staging preservation

`node apps/core/recovery.mjs preserve-staging-032 --request <absolute-request-json>`
uses the same request fields as `backup`, but accepts exactly the historical first
32 migration hashes and no control schema. Normal `backup` and runtime startup
still require the complete current schema. This mode exists only to preserve the
isolated staging database before its 033–045 upgrade; it is not a schema downgrade
or a way to activate an old backup.

The authenticated format-3 manifest explicitly records `controls: null` and
`quarantined-staging-032-preservation-only`. Schema 032 had no control ledger;
an empty watermark would be misleading. Restoration verifies the same historical
hashes, counts and retained files, then applies the normal persistent quarantine,
job parking, session revocation and read-only database default. Output reports
`preservationOnly: true`, `sourceMigrations: 32`, `controlHistoryAvailable: false`.
It provides no activation path or independent-recovery claim. Upgraded databases
use ordinary current-schema backups and a schema-045-aware rollback binary.

Offline evidence: 10 focused recovery/runtime checks, RB01–RB10 and SU01–SU05
(15 isolated scenarios), plus RT01–RT13. Historical fixtures use the original DDL
and preserve foreign-key/check constraints, synthetic observations and actual
file bytes. The upgrade retains all old-column values and verifies new restricted
grants; both clusters stopped. See [upgrade evidence](evidence/staging-upgrade-verification.json).

Both request files contain `environment: "staging"`, `databasePath`, `keyPath`,
`binaryRoot`, `parent`, `maxDatabaseBytes` and `confirmGuildId`. Use absolute local
paths. The parent must already exist; each operation creates a fresh child with
Windows ACLs restricted to the invoking identity, SYSTEM and Administrators.
`databasePath` selects the existing five-field host/port/database/user/password
configuration. `keyPath` selects a separately protected JSON file containing only
`keyHex`: 64 lowercase hex characters generated from 32 cryptographically random
bytes. Do not place that key in the backup, source repository or evidence sheet.
The owner selected `D:\Backups` as the local backup parent on 20 September 2026.
Use that path in the request's `parent` field; each completed bundle occupies a new
restricted child directory. Do not change ACLs on the shared parent or unrelated
backups. Read-only inspection found the directory on a healthy fixed NTFS volume;
that establishes local availability, not independent failure protection. Independent
key custody, an independent recovery copy, backup retention and recovery targets
remain unresolved. No live backup or restore was performed by this decision update.

Backup requests additionally contain `configurationPath` (validated token-free
staging runtime JSON), `buildId` (the reviewed source SHA-256), and `vaultRoots`
(the absolute roots of every vault holding retained files). The explicit database
size bound is an operational ceiling, not the unresolved production retention
policy. A missing vault, foreign guild, changed/missing retained file, migration
mismatch or dump failure prevents completion. Keep the returned manifest SHA-256
receipt with the operator's evidence. A receipt selects a backup; it does not prove
that the backup is the newest state.

Restore requests instead contain `bundleDirectory` and the saved `manifestSha256`.
The key and receipt must come from the operator's trusted backup record. A
PostgreSQL dump can contain executable database definitions: this tool is for
Sophie-owned backups, not archives supplied by another user. All encrypted entries
are authenticated and their plaintext hashes checked before SQL import starts.
The generated working directory retains the decrypted dump and files under its
restricted ACL for operator review. Failed operations also retain diagnostic
directories; there is no automatic deletion or expiry.

The database dump and retained-file selection share an exported PostgreSQL
repeatable-read snapshot. Concurrent later writes stay out of both. Only
`sophie_core`, `sophie_migrations` and `sophie_control` are included; roles, server credentials,
unrelated schemas, unretained files and other services are outside the bundle.
Format 2 includes configuration and source identity, table counts, migrations,
the local control-history digest,
retained slots, sizes and SHA-256 hashes. Each entry uses AES-256-GCM with a fresh
nonce and a bundle/entry-bound authenticated label. Temporary PostgreSQL password
files live in a separate restricted temporary directory and are removed afterward.
The encrypted manifest is written last; an incomplete directory is not a backup.
See the fixed [pg_dump snapshot options](https://www.postgresql.org/docs/17/app-pgdump.html).

Restoration uses a single transaction and stops on errors, with original ownership
and grants omitted. It verifies migration checksums, snapshot table counts and
retained-file metadata. The quarantine schema is installed before import, so a
failed process still leaves a persistent runtime fence. Successful import also
parks ready/leased outbox jobs, invalidates Gateway leases, revokes browser sessions
and pending login flows, and sets the database's default to read-only. The runtime
rejects both the restore database name and the persistent marker; changing the
configuration or renaming the database does not authorize it. See the
[pg_restore transaction options](https://www.postgresql.org/docs/17/app-pgrestore.html).

There is deliberately no activation or quarantine-removal command. Restored files
retain their original vault identities in the database; moving them into an active
vault needs reviewed remapping and capacity reconciliation. This marker is a fence
for tool-managed restoration, **not** an independent watermark: a raw older backup
restored outside the tool could lack it. T58 still requires independent latest
control history, revocation/deletion replay, current Discord reconciliation and
an operator-approved activation procedure. No full T39/T58 or G5 pass is claimed.

Validation: 7 focused file/configuration tests, 10 actual PostgreSQL recovery
scenarios (including operator CLI restoration, a concurrent commit, interrupted
restore and wrong-guild rejection), and 10 composed staging regression scenarios.
Both synthetic clusters stopped. Source-bound results are in
`docs/evidence/recovery-verification.json` and `docs/evidence/staging-verification.json`.
The installed pg_dump/pg_restore binaries are pinned within ADR 0003's existing
local server/client test scope; no dependency, redistribution or production
distribution approval was added. The later [control-history milestone](recovery-controls.md)
adds migration 033 and format 2; the backup source needs an operator identity that
can read the owner-only control schema. The ordinary bot identity cannot do so.

Rollback of the original format-1 source milestone was a code revert with no live
data migration. Format 2 requires the control-history migration and its separate
rollback constraints.
Keep completed or failed restore databases quarantined; reverting code is never
permission to start a bot against a restored database.
