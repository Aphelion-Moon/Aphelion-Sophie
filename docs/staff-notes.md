# Restricted Staff notes

Migration 034 adds human-authored notes to the core case store. `/staff-notes`
opens a case by its main Discord channel ID and offers bounded history and an
append-only workflow. Each entry retains its author, authority grant, timestamp,
text hash and request receipt. Notes have no automatic expiry. Correct an entry
by adding another note; there is no edit/delete endpoint. This is an application
contract, not an assertion that a database owner cannot change the table.

Every read and save requires current `case.manage` authority. A requester or
participant binding alone is insufficient. Current ordinary Staff may use ordinary
case notes; Head Admin contact requires the configured lead authority even if an
ordinary Staff member opened the case. Open and closed cases are supported;
sealed or transitioning access is denied. Reads recheck current authority and
case versions before returning text. Saves lock the case, serialize numbering,
and recheck authority before commit. A repeated request ID confirms the original
save; conflicting content or attribution is rejected.

The dashboard uses the existing Discord OAuth session, same-origin CSRF checks
and no-store responses. Text is rendered literally, with preserved line breaks;
there are no Markdown embeds or note-derived external requests. Drafts and retry
receipts stay in memory. Account changes, access denial or hiding the page clear
private content and suppress late responses. If the page is hidden during an
uncertain save, reopen its history before adding another note: the server may
already have committed it.

Notes are separate from observations, transcript reads/exports, ordinary outbox,
content-free recovery controls and all knowledge/inference paths. The encrypted
core backup retains them, including attribution. The local restore drill verifies
the retained row while keeping the restored database quarantined.

## Evidence and limits

- `node --test tests/dashboard-notes.test.js tests/dashboard-assets.test.js tests/dashboard-cases.test.js`: 12 passed.
- `node scripts/test-storage.mjs --suite=notes --record`: CN01–CN08 passed, including member denial, Head Admin isolation, role-loss races, pagination/concurrent saves, CSRF and transcript/control exclusion.
- Recovery RB01–RB10 and staging RT01–RT10 passed; owned synthetic clusters stopped.
- Synthetic in-app Chromium: keyboard opening, older-page navigation, literal hostile-looking text, uncertain-save retry producing one note, denial clearing, and a 390px viewport with no horizontal overflow. This is not a full accessibility audit.

See [storage report](evidence/notes-verification.json) and
[browser report](evidence/notes-browser-verification.json). P08/P17 and T07/T22/T23
receive partial evidence; no full acceptance test or release gate is certified.
Live staging remains on migration 032. The new notes route and migrations 033–034
have not been deployed there. Independent Staff/member live checks remain open.

No dependency or licence was added. A later staging upgrade must use the existing
orderly stop/migrate/start procedure with the owner identity. For rollback, stop
the host, retain the new table and its records, and select a compatible reviewed
build. Do not drop notes or revert migration receipts to run an older build.
