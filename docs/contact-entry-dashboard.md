# Staff-contact creation from the dashboard

`/contact-entry` now shares the existing Staff-contact selection, confirmation,
submission and verified destination services with Discord. Current Staff or Head
Admin authority is checked for every request, alongside OAuth, CSRF, membership
and runtime continuity. A supplied actor, recipient-role snapshot or ordinary
member-form handle cannot substitute for an authorized Staff-contact selection.

The operator enters one to twenty distinct current human member IDs, reviews the
creator/recipient/Staff audience and explicitly confirms access to retained form
answers and case history. Confirmation opens the pinned published form with blank
fields. A second review displays literal answers and requires an unchecked
confirmation before creation. No chat is imported and no content enters AI.

The existing ten-minute selection expiry, four-handle creator limit, 128 guild
slots, reservation cadence and case-capacity limits still apply. The original
Staff grant, recipient membership bindings, form publication and policy remain
authoritative at submission and delivery. The same transaction records intake,
invitations, audit, receipt and delivery intent. Removing Staff authority before
first delivery prevents creation; it does not silently create a Staff-only case.

Browser receipt IDs occupy an actor- and purpose-bound `dashboard.<sha256>`
namespace. Exact retries preserve the selection and submitted answers. A repeated
submission cannot overwrite retained answers or create another case. Uncertain
outcomes disable competing actions until the original request is retried. Expired
handles still require Staff review rather than blind resubmission.

The dashboard reports a recorded request separately from verified Discord access.
A destination link is available only after a fresh member observation and exact
private-channel proof. Recipients retain `/ticket contacts` navigation and now have
[dashboard discovery](contact-recipient-dashboard.md). The Staff queue can recover a recorded
contact after a page interruption.

All values render as text. Form drafts and pending requests are memory-only.
Account changes, access denial, uncertain access checks and page hiding clear
private data; a request sent before clearing may already have committed. Review
the Staff queue before starting again. Routine successful access refresh preserves
unfinished answers but returns a final review to editing and clears confirmation.

## Evidence and deployment limits

- Nine focused controller/asset tests passed: `node --test tests/dashboard-contact.test.js tests/dashboard-assets.test.js`.
- SC01–SC23 and CE01–CE07 passed with `node scripts/test-storage.mjs --suite=contact-entry --record`. They cover shared Discord behavior, HTTP authority/CSRF, owner binding, pinned forms, ordinary-handle rejection, duplicate/colliding requests, cancellation, expiry, recipient revocation, private delivery and Staff-loss fencing. The isolated cluster stopped.
- RT01–RT10 passed with the composed dashboard access route; the isolated cluster stopped.
- Synthetic Chromium checks cover audience and submission confirmation, blank fields, literal answers, draft preservation, unknown-outcome retry, pending versus verified navigation, narrow layout and access-loss clearing. This is not live Discord or a complete accessibility audit.

See [database report](evidence/contact-entry-verification.json),
[browser report](evidence/contact-entry-browser-verification.json) and
[runtime report](evidence/staging-verification.json). These are partial
P08/P11/P17 and T05/T07/T42 results. Human replies, curated responses,
remaining Shuttle/moderation parity and independent live
multi-account checks remain open.

No dependency, licence, database migration or live-service change. Source schema
remains 035; live staging remains 032. Deploy only through the established reviewed
staging upgrade procedure. Rollback removes the additive routes/UI using a reviewed
compatible build while preserving contact handles, intake, namespaced receipts,
audits, invitations and jobs. Do not drop retained content or downgrade schema.
All production and independent recovery gates remain open.
