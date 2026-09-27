# Staff review of Shuttle delivery

Scope: P06, P09, P16 and P17; partial T04, T05, T13–T16, T18–T21 and T36. The initial slice added a private Staff queue and an audited request to recheck parked Whitelist jobs. [Case/message recovery](shuttle-artifact-recovery.md) extends it to the three fixed Shuttle artifact jobs. It uses the existing runtime, driver, token boundary and case policy. There is no dependency or licence change, live command registration or production activation.

## Review and authority

`/shuttle issues` lists at most five parked Shuttle deliveries, with retained cursors for subsequent pages. Each entry contains only member/case references, a static reason, possible-effect indication and a specific Recheck control or message-identification instructions. Current Staff or lead ops authority is checked when executing, reading, committing and constructing the later ephemeral response. Incoming Discord role arrays, requester status, Administrator permissions, copied component IDs and serialized actors confer no authority. Responses suppress all mentions.

Role entries cover only `whitelist.grant` and `whitelist.reconcile` jobs whose actual source grant belongs to a retained session and bound Shuttle case. The case, screen and alert entries use their own recorded ownership and recovery checks. The queue cannot target moderation, other case types or arbitrary outbox operations. It does not accept notes, message text, SQL, URLs or an arbitrary operation ID. No case data is forwarded to AI. An empty page says only that no parked bound Shuttle jobs appear there; it is not a system-wide health assertion.

Recheck is available after Staff reviews the cause, for example after an operator corrects a role hierarchy or missing permission. The request records an audit and makes the original job available to the normal role worker. It does not itself change roles, advance a page, resume help, clear Muzzled, publish copy or assert delivery. Grant rechecks require the stored open private case, unchanged policy and a fresh opaque proof of its exact channel audience. Reconciliation may inspect a closed case's retained role intent because it can only preserve current earned access or remove an unintended late grant.

## Preserved evidence and current policy

The transaction retains the immutable effect, original operation identity and `dispatch_started` marker. It records the operator grant, signed interaction identity, issue revision, old fence, attempts, possible-effect marker and bounded error code. It resets the attempt budget and increments the job fence; it does not clear global pauses, rate-limit cooldowns or Gateway continuity barriers. No Discord request happens in this transaction.

The worker obtains fresh role metadata and rechecks the session, pinned definition, progress, help pause, membership and revocation epochs. A repaired environment cannot revive a stale grant. A Muzzled member, departed member, old run or withdrawn publication causes cancellation and, where necessary, compensation. A fresh Shuttle qualification must still follow any Whitelist loss. Reconciliation preserves already earned current access. The separate BYOND integration remains untouched.

Duplicate signed interactions return the retained outcome after current authorization. A distinct request with an old issue revision or a job that is ready, leased, complete or cancelled is rejected. Parking again advances the retained issue revision; the old queue cannot authorize a newer attempt. Late workers still cannot complete through their old lease. A possible role effect remains recorded for inspection and compensation. The database does not make Discord exactly once.

## Schema, verification and rollback

Migration `013-shuttle-delivery-issues.sql` adds retained issue identities and per-action audits. It backfills only existing bound parked role jobs without replaying them or changing effects. Migration-generated opaque handles are routing identifiers, not credentials. A collision or incompatible row aborts migration. Existing SQL files remain unchanged. Core receives the existing SELECT/INSERT/UPDATE privileges only; the knowledge identity cannot read these records.

The new contract checks cover signed closed routing, bounded metadata/pagination and explicit adapter injection. R01–R17 exercise current Staff authority, duplicate/competing actions, lost permissions, Muzzled/loss/pause/withdrawal guards, possible role effects, closed-case compensation, earned entitlement, exact channel proofs, leases, barriers, transaction rollback, retained cursors, database isolation, real loopback HTTP and migration backfill. S21 checks persisted issues, audits, duplicate receipts, possible effects and delivery pause across an actual isolated database restart. Execution counts and outcomes are recorded in [verification](verification.md); this test specification alone does not claim those checks passed.

Rollback requires stopping commands and workers, preserving migration 013, issue/audit/receipt records and unfinished effects, and restoring code compatible with the applied migration ledger. Do not delete history, clear possible-send markers, replay unknown creates or downgrade to a migrator that rejects the retained schema.

Recovery of known late cases and exact own-messages is documented separately. [Canonical duplicate-channel selection](shuttle-channel-selection.md) now retains an audited choice and requires fresh worker verification. Unidentified results, other ticket operations, dashboard parity, production composition and live Discord authorization/role checks remain open. The owner's actual Shuttle copy remains unpublished, and this development slice does not pass a production release gate.
