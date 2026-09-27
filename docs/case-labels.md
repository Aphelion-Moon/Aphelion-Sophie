# Manual case tags and priorities

Migration 035 adds a default `normal` priority and empty tag list to existing cases,
without inventing prior Staff actions. A separate retained change table records
the previous and new values, author, current authority grant, case version,
timestamp and exact request receipt. There is no automatic expiry or AI classifier.

Current responders can edit an open or closed case through `/ticket label` or
`/case-labels`. Both call the same core use case. Ordinary Staff cannot read or
change Head Admin contact labels; requester/participant status alone is insufficient.
Sealed or transitioning cases reject label access. Priority is `low`, `normal`,
`high` or `urgent`. Tags are up to eight distinct labels of 32 UTF-16 code units,
beginning with a letter or number and containing letters, numbers, spaces, dots,
underscores or hyphens. Discord accepts comma-separated tags and `-` to clear them;
the dashboard accepts comma-separated tags and a blank field to clear them.

The update locks the case and compares its current version with the reviewed
version. A competing label, assignment or lifecycle change makes the request stale.
An exact retry confirms the original receipt without replacing later values.
Authorization is checked again before commit; read access and case versions are
checked again before text is returned. Labels do not change permissions,
assignments, delivery order or the oldest-first queue. The Staff queue displays
manual priority; authorized case status displays priority and literal tags.

The dashboard uses current OAuth authority, CSRF and no-store responses. It renders
labels/history with `textContent`. Background refresh never rebases a dirty draft
onto a newer case version. A stale draft must be explicitly discarded and reloaded
before a new save. Unknown outcomes retain the exact request for retry. Account
changes, access denial and hidden pages clear drafts, rendered values and pending
requests; review retained history before resubmitting after a hidden-page interruption.

Authored labels and history stay in core. They are absent from member transcript
reads/exports, generic receipts/outbox and content-free recovery projections.
The encrypted core snapshot retains both current values and attributed history.

## Evidence and remaining gates

- 12 focused contract/controller/asset tests passed:
  `node --test tests/case-labels.test.js tests/dashboard-labels.test.js tests/case-staff.test.js tests/dashboard-assets.test.js`.
- `node scripts/test-storage.mjs --suite=labels --record`: K01–K14 and CL01–CL09 passed, covering existing ownership flows, current permissions, Head Admin isolation, role-loss rollback, concurrent edits, signed Discord commands, HTTP CSRF, history and projection exclusions.
- RB01–RB10 passed with exact label/history retention after actual PostgreSQL restoration. RT01–RT10 passed after updating the expected migration count from 34 to 35. All owned clusters stopped.
- Synthetic in-app Chromium checked keyboard opening, stale-draft blocking and explicit discard, lost-save retry producing one new version, older history, access-loss clearing and a 390px viewport without horizontal overflow. This is not a complete accessibility audit.

See [database report](evidence/labels-verification.json) and
[browser report](evidence/labels-browser-verification.json). This is partial
P08/P11/P17 evidence, not full T05/T07/T42 or release qualification. Command/API
equivalence for the other required operations remains open.

No dependency or licence change. Live staging remains on schema 032 and its old
command registration. Migration 035, the new command and dashboard route are not
deployed. Later staging installation needs the established orderly host stop,
reviewed owner migration and command registration. Rollback must retain label
history and select a compatible reviewed build; do not remove migration receipts,
drop records or bypass the runtime schema gate. Production remains blocked.
