# Dashboard case management

`/manage-cases` provides a current-authorized Staff queue and main-channel lookup,
then reviewed claim, release, reassignment, closure, reopening and participant
changes. The fixed HTTP routes call the existing Discord case services; they do
not accept a supplied actor, permission snapshot or arbitrary operation. Current
OAuth authority, CSRF, case version and the runtime delivery gate remain required.
Head Admin contacts remain restricted to their current responders.

Every change requires review and an unchecked confirmation. Adding a participant
warns that the member can gain access to retained history. Removing an invitation
does not remove independent Staff authority. Assignment records responsibility and
does not grant access. Closure and reopening are requests: the UI shows pending
state until the existing worker verifies Discord permissions. Records are retained.

The reviewed version is passed unchanged to the shared store. A competing change
requires a refresh and new review. The dashboard's existing single-request HTTP
lane can reject overlapping requests as busy before either service runs; retrying
still encounters the authoritative version check. Unknown outcomes retain the exact
request for retry, including its target and version. Receipts use a disjoint,
actor-bound `dashboard.<sha256>` namespace; signed Discord IDs remain numeric.
The existing transactional audit, outbox, fresh permission checks and compensation
paths apply unchanged.

Routine access refresh preserves an unfinished member selection when that action
is still available, but clears review and confirmation. Account changes, access
denial and hidden pages clear private metadata, drafts and pending retries. A
request may have committed before a page was hidden: inspect current state and
retained audit before submitting a new request after an interruption. Rendering
uses plain text. No case messages, forms, notes or file bytes are added to this UI.

## Evidence and remaining gates

- `node --test tests/dashboard-management.test.js tests/dashboard-assets.test.js`: eight focused tests passed.
- `node scripts/test-storage.mjs --suite=management --record`: 58 scenarios passed (J01–J17, K01–K14, CP01–CP19, MG01–MG08), including HTTP authorization, Head Admin isolation, exact receipts, stale versions, audit, participant ACL reconciliation and revoked reopening grants.
- `node scripts/test-storage.mjs --suite=staging --record`: RT01–RT10 passed; RT05 exercises the composed management route and retained Staff attribution. Both isolated clusters stopped.
- Synthetic Chromium checked queue navigation, participant review/confirmation, exact retry after a lost response, truthful pending state, unfinished-selection preservation, stale-version rejection, denial clearing and a 390px viewport without horizontal overflow. The temporary preview and tab stopped; viewport restored.
- The repository checker passed 316 JavaScript sources, 40 tasks, 60 acceptance specifications, 31 reference checksums and eight unchanged PNG copies.

See [database evidence](evidence/management-verification.json),
[browser evidence](evidence/management-browser-verification.json) and
[composed runtime evidence](evidence/staging-verification.json). These are partial
P08/P11/P17 and T05/T07/T42 results. Initial Staff-contact creation and recipient
navigation now have separate dashboard milestones. Remaining Shuttle/moderation
route parity, human replies, controlled file downloads and full
live multi-account/accessibility acceptance remain open. No full release pass.

No dependency, licence or migration change. The source schema remains 035; live
staging remains on 032 and this route is not deployed. A later staging upgrade
must use the established orderly stop and reviewed owner migration procedure.
Rollback can remove this additive UI/adapter with a compatible reviewed build;
retain namespaced receipts, audits and jobs, and do not downgrade the database or
remove migration records. Production deployment and independent recovery remain
gated.
