# ADR 0002 — PostgreSQL transactional storage

Status: PostgreSQL infrastructure exception accepted by the owner in this task on 18 September 2026 ("Approved, proceed."). Implementation and synthetic verification may proceed. Production provisioning and release remain gated.

The application needs transactions, uniqueness, compare-and-swap versions, durable outbox claims/fencing, separate core/knowledge principals and reliable backup/restore. PostgreSQL is selected; no Sophie production database is installed.

The [PostgreSQL License](https://www.postgresql.org/about/licence/) is permissive but is not MIT. This is the named database exception, not a change to the MIT requirement for directly reused application projects. The [official Windows distribution page](https://www.postgresql.org/download/windows/) lists Windows Server 2022 support.

The driver decision and named indirect-component scope are recorded in ADR 0003 and the dependency inventory. Production still requires an exact approved distribution/hash and dedicated Sophie storage and principals. The host's existing SS14 PostgreSQL service and wiki MariaDB service are not authorisation to use their databases, credentials, ports or administrator accounts. No existing service configuration may change incidentally.

Use one production engine. Do not create a file/JSON database, persist test fixtures, or adopt public-domain SQLite merely to bypass this decision. A queue library is optional only if the approved store adapter proves the required outbox semantics; no existing library is approved by a top-level licence badge.

## Restore condition

An older backup cannot establish the latest revocation/deletion state. The eventual recovery design must retain or reconstruct a current, independently recoverable control ledger with a verified recovery watermark. The application must refuse delivery and confidential reads after restore until that watermark and current Discord state have been reconciled. An old ledger restored alongside the old database is insufficient.

T58 must cover: take backup; then remove Whitelist/delete or restrict a resource; lose the live store; restore the old backup. Missing newer control records must leave delivery disabled. Normal case retention is indefinite; exceptional deletion and knowledge withdrawal still need safe restore handling. The owner has not supplied an offsite destination or accepted data-loss targets.

Primary-source licence/platform pages reviewed 18 September 2026. Synthetic tests use an ephemeral cluster with its own data directory, credentials and loopback port. They do not create a Windows service, use existing database logins or provision production storage.
