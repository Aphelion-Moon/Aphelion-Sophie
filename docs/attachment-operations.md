# Read-only staging attachment operations

`apps/core/attachment-operations.mjs` is a local operator tool for a restricted
staging database and an existing vault directory. It does not load a Discord
token, start acquisition, expose a dashboard route, download attachments, scan
malware, requeue jobs, clear pauses or change reservations. Its dedicated database
connection sets `default_transaction_read_only = on`; the vault adapter also
refuses writes and will not create a missing directory.

Use an explicitly chosen staging configuration, restricted core database JSON
and the absolute path of the vault recorded by attachment acquisition:

```powershell
node apps/core/attachment-operations.mjs inventory --config .local/staging-host/runtime.json --database .local/staging-host/core.json --vault C:\path\to\existing\staging-vault --confirm-guild 1551010228642910318
```

`inventory` returns 25 reference jobs at a time. Pass the returned `next` token as
`--after` to continue. It shows status, fenced attempt metadata, opaque slots,
retained sizes/hashes and fixed failure codes; it never selects message patches,
filenames, URLs, authored forms, Staff notes or file bodies. Jobs are scoped to
the confirmed guild. Each attempt indicates whether it belongs to the selected
vault. Up to four attempt records are included per job (normal acquisition is
limited to three).

Capacity is explicitly **whole-vault**, because its reservations may cover more
than one guild. Reserved bytes and total attempt bytes come from one database
snapshot, alongside pause/cooldown state. A mismatch is a diagnostic, never
permission to reset a counter. Inventory does not inspect the filesystem, measure
free disk space or claim a complete orphan scan; every entry starts with integrity
`not_checked`.

Verify one retained reference using its opaque job token:

```powershell
node apps/core/attachment-operations.mjs verify --config .local/staging-host/runtime.json --database .local/staging-host/core.json --vault C:\path\to\existing\staging-vault --confirm-guild 1551010228642910318 --job <48-hex-job-token>
```

Verification accepts only a retained job in the confirmed guild and exact vault.
It reads at most the existing 32 MiB file ceiling using the acquisition adapter's
size/type/hash checks. Results distinguish `matches`, `mismatch`, `missing`,
`unavailable` and `changed`. The database selection is rechecked after file I/O.
These are point-in-time integrity observations, not malware clearance or a
download grant. Missing/corrupt records and their reservations remain intact.
No unreferenced files are moved, erased or adopted.

The current foreground Discord host still has attachment acquisition disabled
and no configured acquisition vault. The CLI smoke check used a separate empty
synthetic directory and found zero attachment jobs in the isolated staging
database. It did not establish live file capture or inspect any user file.

## Evidence and remaining work

Twenty-four focused attachment/browser tests pass. CA01–CA23 and AO01–AO05 pass
against isolated PostgreSQL and synthetic local files; the owned database stopped.
AO checks cover pagination/content exclusion, matching/corrupt/missing files,
foreign guild/vault and non-retained denial, selection races, accounting mismatch
and retained pauses. Read-only vault checks cover missing roots, regular-file
roots and attempted writes. See [the source-bound report](evidence/attachment-operations-verification.json).
The repository checker passes 276 JavaScript sources, 40 tasks, 60 specifications,
31 reference checksums and eight preserved source PNG copies. Full suites were
not rerun.

The same milestone fixes the browser API allowlist for the existing seventh
**Staff contact** form category; its draft/history/review/publication GETs now
reach the already-authorized server routes. The existing transport test covers
those exact routes. This does not expose submitted contact content.

No migrations, dependencies, licence changes, new role permissions, Windows
services or production changes. Rollback by omitting the operator CLI and
reverting the compatible source changes; retain all records and files.
Safe orphan reconciliation, reviewed requeue/repair, capacity alert thresholds,
approved file-download/scanning policy, live file acceptance, Windows ACLs and
independent recovery remain open.
