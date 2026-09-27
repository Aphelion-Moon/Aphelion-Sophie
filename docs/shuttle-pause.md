# Published help pauses and logged Staff resumption

Scope: P06, P13, P14, P16 and the Shuttle portion of P17; partial T13–T16, T19 and T53–T55. This implements the published help rule using the existing core, authorization and delivery interfaces. There is no dependency or licence change. No live command, publication, service or production database was changed; the owner's copy remains a draft.

## Member and Staff behavior

`helpPauses` is a boolean in each immutable publication. False retains the existing help request without stopping progression. True records the request and sets `helpPaused` in the same transaction, preserving the page while rotating the session version/nonce and replacing its screen. Continue, Back and Complete are disabled in presentation and denied by the shared domain guards. Entry cannot clear the pause. Repeated help clicks coalesce into the one open request without another version change.

The private Staff queue marks paused runs and offers Resolve / resume. Current Staff or lead ops authority, the request revision, current membership, pinned publication and case binding are checked again at resolution. A still-valid paused session requires an eligible member: Muzzled or an outstanding mute intent leaves the pause and request open. Observing removal of Muzzled alone cannot clear a durable mute intent. The existing observed-unmute operation must do that first.

Eligible resumption clears the pause at the same page, rotates its controls and records the resulting session version with the human operator grant, request identity and time. State, resolution, receipt and screen intents commit together. It does not complete reading or emit a role grant. The response reports a recorded resumption, not a promise of current access. Repeated interactions return the retained outcome without a second audit event.

A closed, withdrawn, departed, superseded or otherwise invalidated run can have its help request resolved as history. That action does not clear the old pause, reopen the case, replace a newer run or restore eligibility. All requests and resolution records remain retained.

## Pending and late Whitelist effects

Pausing a role-pending session returns it to active on page five and removes its grant access epoch. The version changes, so the previous grant cannot pass either pre-delivery validation or post-response confirmation. Resumption itself leaves the session active: a fresh final acknowledgement is required to create a new grant intent. Merely clearing the pause cannot make the old effect legitimate.

An already in-flight Discord write can still apply after the pause. The existing durable cancellation and reconciliation path checks current entitlement and removes a stale role when appropriate. A lost response retains the uncertain effect for reconciliation; it never authorizes another blind grant. This is compensation, not atomic or exactly-once Discord delivery. Any observed Whitelist loss, including compensation removing a stale grant, invalidates that run under the owner's policy and requires a fresh Shuttle.

Pausing an ordinary repeat preserves previously earned Whitelist. A later publication cannot change an active run's pinned help rule. Membership revocation, case permissions, withdrawal, delivery gates and authority epochs retain their existing checks; paused presentation is never an access grant.

## Evidence, migration and rollback

Three contract tests cover frozen progression, resumption without a grant, stale grant rejection and disabled controls. W01–W12 use real PostgreSQL and signed commands with simulated Discord: shared-core denial, queued/in-flight/lost-response grants, Staff resumption during a pending write, Muzzled and durable mute intent, duplicate controls, atomic failure rollback, pinned repeats, historical resolution, lost Staff authority and private loopback HTTP replies. S17 stops and restarts only its isolated test cluster, recovers a paused screen and its earlier resolution audit, then checks logged resumption at the retained page without a role effect. Only synthetic data is used.

Migration `011-shuttle-pause.sql` backfills old session and screen JSON with `helpPaused: false`, since earlier publications supported only that behavior. It adds constraints on the pause state and a nullable positive `resumed_version` to the resolution audit. Core has no DELETE/migration privilege; knowledge retains no access. Earlier migration files are unchanged.

Rollback requires stopping commands and delivery, retaining the schema, publications, paused state, requests/audit and unfinished effects, and restoring compatible code that enforces pauses. Do not run earlier code that drops or ignores the new state field, remove the migration, clear a pause without an audited operation, or replay old grants. Durable [Staff/failure notices](shuttle-alerts.md) now have separate local evidence. Live Discord rendering and permissions, operator repair, the editor, production composition and independent restore remain open gates.
