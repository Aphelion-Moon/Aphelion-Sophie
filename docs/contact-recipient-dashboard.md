# Recipient contacts in the dashboard

`/contacts` lists contacts where the signed-in member has a current retained
invitation. It shows creator ID, creation time and access state, five contacts
per page, newest first. It contains no form answers, conversation excerpts, notes,
attachments or channel links from an unchecked queue result. Staff and creators
without an invitation use the separate Staff management queue.

The two fixed authenticated GET routes call the same navigation flow as
`/ticket contacts`. Discovery rechecks invitation and membership bindings, opener
presence, case policy and current member authority. A copied token grants nothing.
Opening a contact performs exact private-channel inspection and then rechecks the
current invitation and membership before returning a destination. Closed contacts
are labeled read-only; preparing contacts have no link. Category/ACL drift,
invitation removal, departure/rejoin and lost runtime readiness withhold the link.
The existing provisional closed-audience policy still needs release review.

The browser validates the returned guild/account, page bounds and destination
shape. Explicit checking moves keyboard focus to the result. Periodic refresh
rechecks selected access without moving focus. Pagination, identity changes,
denial, failed reads and hidden pages clear old links; hidden-page generations
also suppress late results. Private metadata stays in memory and renders as text.
Responses remain no-store. No permissions or case lifecycle action is added by
this navigation feature.

## Evidence and release limits

- Seven focused controller/asset checks passed: `node --test tests/dashboard-contacts.test.js tests/dashboard-assets.test.js`.
- `node scripts/test-storage.mjs --suite=contact-navigation --record` passed SC01–SC23 and RN01–RN08. These include shared Discord/HTTP metadata, uninvited Staff denial, copied/unknown references, cursor authorization, removal, late departure, rejoin, closed links, category/ACL drift, logout and runtime-gate loss. The isolated cluster stopped.
- RT01–RT10 passed, including the composed recipient route; its isolated cluster stopped.
- Synthetic Chromium checked five-plus-one pagination, explicit closed/read-only navigation, pending-without-link behavior, verified link generation, keyboard focus, a 390px layout and denial clearing. This is not a full accessibility or live Discord test.
- Repository checks passed 329 JavaScript sources, 40 tasks, 60 acceptance specifications, 31 reference checksums and eight unchanged PNG copies.

See [database evidence](evidence/contact-navigation-verification.json),
[browser evidence](evidence/contact-navigation-browser-verification.json) and
[runtime evidence](evidence/staging-verification.json). This is partial
P08/P11/P17 and T05/T07/T42 evidence. Human replies, curated responses, controlled
file downloads, remaining Shuttle/moderation parity and independent live privacy
checks remain open. The human worksheet retains all release gates as unpassed.

No migration, dependency, licence or live-service change. Source schema remains
035; staging remains 032. The route is undeployed. A reviewed compatible rollback
can remove this additive UI/HTTP adapter while retaining the shared Discord
navigation and all invitations, case records and migration receipts. Production
installation and independent recovery remain gated.
