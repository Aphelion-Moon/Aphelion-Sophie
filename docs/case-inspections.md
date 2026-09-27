# Periodic case permission reconciliation

This slice adds the bounded case-inspection portion of P06/P09–P11/P19, with partial T01/T07/T16/T18/T22/T36/T56/T59 coverage. A core service tick can schedule inspections even when no Gateway event announced a change. It reuses the current case dispatcher and its fresh observations, permission proofs, fencing and compensation. It adds no dependency, case-content reader, role-restoration rule or AI path.

## Scheduling and delivery

`apps/core/storage/case-inspections.js` owns the database schedule. `apps/core/discord/case-reconciler.js` supplies an explicitly injected `runOnce()` tick with the usual delivery gate and no local backlog. The future production service must call this tick alongside the existing outbox workers. Loading either module starts no timer, process, listener or Discord connection.

Each guild has a persisted batch deadline. A short transaction locks that row, checks the durable Discord pause/backoff and Gateway state, and selects a limited number of due, already-started provisions. Locked provisions are skipped and remain due. Selection covers pending, open, closing, closed and failed cases; untouched reservations are excluded so the sweep cannot start new channel creation. It also checks the immutable configured case policy.

| Setting | Development default | Accepted range |
|---|---|---|
| Batch size | 5 cases | 1–25 |
| Minimum interval between batches | 10 seconds | 1–60 seconds |
| Per-case interval after consideration | 15 minutes | 1 minute–24 hours |

These are bounded development settings, not approved production service or load budgets. PostgreSQL time determines deadlines. Two processes cannot admit the same batch concurrently; polling faster does not reset the persisted deadline. Indexes support due-case selection and outstanding-work lookup. All considered cases move to a later deadline, so blocked cases do not monopolize subsequent batches.

A case with an existing ready or leased provision job keeps that job, its backoff and attempt count. Any parked provision job, incompatible policy version or exhausted inspection revision requires review; the sweep does not clear that condition or create a replacement retry. Staff recovery remains necessary before automatic inspection can resume for that case. This deliberately preserves bounded retries and unresolved ambiguity.

Otherwise the transaction increments the inspection revision, creates one deterministic `case.provision` outbox operation, retains its reference and advances the deadline. Scheduling metadata and the outbox commit together. A lost transaction response is not retried inside the transaction helper; a later tick reads the retained deadline and jobs. No transaction spans PostgreSQL and Discord.

The case dispatcher checks current state when work runs, including closure/reopening intent, current requester presence and revocation epochs. An inspection queued while a case was open cannot replay an open-state snapshot after closure. It can restore the current exact open audience, restore read-only closure, or seal a failed/departed case. A returning requester cannot revive the old presence epoch. A new duplicate is permanently registered and excluded, sealed with unresolved candidates and parked for selection. The sweep never authorizes a replacement channel POST, Whitelist grant, Staff assignment, participant addition or role restoration.

## Observability and limits

The tick returns bounded counts of considered, queued, already-pending and review-required cases, plus its next batch delay. `case_inspection_sweeps.last_batch_at` records scheduling activity only. `case_provisions.last_inspection_operation_id` points to the retained outbox outcome; it is not a permission-freshness timestamp. Do not display “permissions verified” from a queued job, deadline or successful scheduler tick. Closed/failed cases and every retained duplicate remain excluded from AI.

This sweep does not promise uninterrupted confidentiality during a missed event, outage or in-flight Discord request. Parked or incompatible cases remain blocked for review, and due work can exceed the available delivery budget. Production needs service-loop composition, cadence and backlog monitoring, general operator repair routes, live permission checks and an approved host-load budget. Periodic member/role reconciliation, transcript/file capture and independent restore controls remain separate work. The existing provisional closed-channel audience is unchanged.

## Migration, evidence and rollback

Migration 018 adds per-provision due time, inspection revision and a foreign key to the last scheduled outbox operation, plus guild sweep metadata and indexes. Existing provisions become due with revision zero and no invented inspection success. No existing state, audit, marker, exclusion, pending job or role epoch is rewritten. Migrations 001–017 remain unchanged. Core needs SELECT/INSERT/UPDATE on the new sweep table; the knowledge identity has no access and core has no DELETE.

Four contract tests and I01–I14 cover bounded configuration, gate/concurrency behavior, database cadence, locked-row fairness, pending/parked work, missed permission changes, read-only closure, departure/rejoin, duplicate sealing, atomic rollback, policy changes, delivery barriers, rate limits and migration. S26 restarts the isolated database with an undelivered inspection and a delivery pause, then recreates services and verifies the original job repairs permissions without another channel POST. Actual results and source hashes are in [verification](verification.md). All remote state is synthetic; this is not live Discord or OS isolation acceptance.

Rollback: stop the scheduler and delivery workers, preserve migration 018, deadlines, revisions, outbox references/jobs, canonical cases, exclusions and revocation epochs, then restore compatible code after review. Disabling the sweep does not cancel already committed work. Do not delete history or claim older code without the sweep provides periodic coverage. No production service, database or Discord configuration was changed.
