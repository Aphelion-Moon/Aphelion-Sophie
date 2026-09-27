# Recovery control history

P06/P26/P27, T18/T24/T39/T58. Migration 033 adds an owner-only
`sophie_control.events` ledger. Eleven fixed source tables append selected control
metadata in the same transaction as the underlying state change. Existing state
gets a baseline while installation holds each source-table lock. A failed ledger
write fails the state change; transaction rollback removes both. Installation does
not reinterpret old membership or restore Whitelist.

The projection covers membership eligibility/access/presence epochs and mute
intent; actor capability/presence epochs; case lifecycle, provisioning and audience
versions; participant status; channel exclusions; publication withdrawals; and
configuration policy versions/hashes. It does not copy member observations, role
snapshots, case bodies, submitted answers, notes, attachment data, credentials or
Shuttle progress. Routine observation refreshes with unchanged control metadata
produce no new event. Delete events retain the previous projected metadata; this
is not an implemented exceptional case-deletion feature.

The restricted application identity writes through fixed owner-executed triggers
but cannot access the ledger schema or call its projection functions. Knowledge
has no access either. Functions have a fixed search path and qualified destination;
there is no request route, arbitrary SQL tool or content/AI connector. Startup and
backup verification check that all eleven capture triggers remain enabled and
bound to the owner function. Runtime database validation rejects direct ledger
privileges. The schema owner remains trusted; this is not protection against a
malicious database administrator. See PostgreSQL's
[trigger transaction behavior](https://www.postgresql.org/docs/17/sql-createtrigger.html).

Snapshot hashing reads bounded pages inside a repeatable-read or serializable
transaction and returns only count/hash metadata. Allocation IDs are **not commit
order**. A replication implementation must preserve committed transactions; polling
`id > last_seen` would miss a lower allocated ID that commits later. RC07 exercises
that race. No independent latest-state claim follows from the local sequence,
timestamp, digest or a completed database backup.

Backup format 2 includes `sophie_control`, its stable snapshot digest and all prior
bundle checks. Restore verifies the ledger against that digest before declaring
the import complete, then keeps the existing quarantine. Format 1 remains tied to
the earlier compatible build; the new importer rejects it rather than silently
claiming missing history exists. Use the preserved build in isolation for an older
backup and follow a separately reviewed migration/recovery procedure. Do not remove
the quarantine or treat a baseline as pre-migration revocation history.

Independent durable replication, latest-state verification after loss, deletion
replay and activation are still missing. In particular, asynchronously copying
this ledger after acknowledging a commit leaves a loss window. Native PostgreSQL
replication is an available direction for subsequent isolated qualification; no
off-host endpoint, retention/RPO/RTO or replication/activation policy is approved
by this change. The existing no-destination owner answer remains a production
blocker. T58 and G5 are open.

Validation: RC01–RC09 cover baseline/repeatability, actual Whitelist loss, rollback,
content exclusion, restricted identities, lifecycle/deletion metadata, late commits,
disabled capture and revoked participant/capability metadata. RB01–RB10 exercise
the encrypted dump and restored ledger; RT01–RT10 exercise the composed runtime.
All use new synthetic PostgreSQL clusters. Evidence is in the matching `controls`,
`recovery` and `staging` reports under `docs/evidence/`. No full release specification,
live migration or production rollout is claimed.

Migration 033 adds a separate schema and triggers, without changing existing table
data or grants. The running staging host remains on migration 032 until an explicit
stopped-host upgrade. Stop/drain before a reviewed upgrade; retain the history and
backups. There is no automatic down migration: reverting executable code must not
drop control history or make a restored database eligible to run.
