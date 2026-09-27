# Ticket-form authoring

Scope: P05, P06, P08, P10, P17 and P19; partial T01, T04–T07, T19, T22, T36 and T57 evidence. This milestone implements core configuration use cases and authenticated HTTP routes. The [browser form editor](dashboard-forms.md) now uses these services; final owner questions and live acceptance remain unfinished. No production form is supplied or published, and no dependency is added.

## Authored data and permissions

`createCaseFormAuthoringStore` owns seven form categories, including [player reports](player-reports.md) and [Staff contacts](case-contacts.md). Quick Help stays formless. Drafts accept an empty title, zero fields or unfinished labels/options, within the same structural bounds as publication. Field IDs and option values must already be unique valid identifiers. Publication still requires one to five complete short-text, paragraph or single-selection fields. Executable conditions, role grants, files, arbitrary URLs and unrecognized keys are not configuration features.

Every operation requires the existing explicit `case.forms.publish` capability and current opaque core authority. Ordinary case-management access does not imply permission to edit configuration. This capability covers authored configuration across all seven categories; it does not grant access to Head Admin cases, submitted answers or any conversation. A production role mapping is still required. Reads and writes check authority inside the transaction, before accessing configuration and again before commit; HTTP checks again before returning the result. Losing a role or logging out invalidates an in-flight actor.

This interface never queries case records, modal handles, submissions, messages or transcripts. Static review shares the runtime form renderer but contains no usable submit handle. It returns plain authored data, not executable HTML. The browser editor renders this copy as text. No form/configuration content is sent to AI.

## Retention, review and publication

Migration 024 adds `case_form_drafts` and `case_form_editor_actions` in the core schema. Drafts are append-only through the service, retain canonical hashes, author grants and timestamps, and have a separate revision sequence per category. Core cannot delete this history; knowledge cannot read it. An expected revision prevents one editor from overwriting another. History pages contain at most ten metadata rows and a stable revision/version cursor; authored bodies are fetched individually.

Review returns the exact draft hash/revision, latest publication status/version, next version and static presentation. Publishing compares both the draft and latest publication against that review. The original publication store and authoring store use the same guild lock and immutable write helpers. Publication/action records and editor audit commit together. A failed final authority check or audit insert rolls back the entire operation.

Each mutation requires a 256-bit hexadecimal request ID. Retained receipts bind that ID to the guild, actor, category and exact canonical action. After a lost response, retry the identical request with the same ID under current authorization. A different body, actor or category collides. Duplicate receipts describe the original action; they are not a fresh status query and cannot reactivate withdrawn copy. Reload current publication state after resolving an uncertain response.

New publications leave previously opened forms pinned, subject to their existing expiry and withdrawal rules. Withdrawal requires the exact version/hash and explicit confirmation. It blocks unsubmitted handles for that version, keeps all previous definitions and submissions, and leaves exact committed intake replay intact. Withdrawing the latest version disables new entry for that category: there is **no fallback** to older published forms. Withdrawing an older version leaves a newer published version available. Recovery means publishing a new reviewed immutable version, never relabelling or overwriting the withdrawn one.

## Fixed HTTP surface

The existing dashboard server accepts an optional `formAuthoring` interface. Without it these routes are absent. `/auth/session` exposes `canEditForms` as a presentation hint only; every route independently authorizes its operation.

| Method | Route | Input |
|---|---|---|
| GET | `/api/ticket-forms/draft` | `caseType`, optional `revision` |
| GET | `/api/ticket-forms/history` | `caseType`, `kind=drafts` or `publications`, optional `before` |
| GET | `/api/ticket-forms/review` | `caseType`, `revision` |
| GET | `/api/ticket-forms/publication` | `caseType`, `version` |
| POST | `/api/ticket-forms/save` | `caseType`, `requestId`, `expectedRevision`, `document` |
| POST | `/api/ticket-forms/publish` | `caseType`, `requestId`, `expectedRevision`, `expectedHash`, `expectedLatestVersion`, `expectedLatestStatus` |
| POST | `/api/ticket-forms/withdraw` | `caseType`, `requestId`, `version`, `expectedHash`, `confirm=true` |

Authenticated mutations require the configured Origin and CSRF token. JSON is bounded to 128 KiB and decoded with strict UTF-8; compression, duplicate query keys, extra fields and GET bodies are rejected. Results are no-store with restrictive security headers. Errors do not echo configuration, credentials or internal exceptions. These are fixed core use cases, not a generic database, URL or preview API. TLS and real OAuth/browser enforcement remain release checks.

## Evidence and rollback

Four contract tests cover incomplete drafts versus publication, structural limits, immutable input and runtime-equivalent static presentation. Z01–Z21 exercise PostgreSQL concurrency, retained receipts, independent categories, immutable versions, withdrawal/pins, revocation/logout, rollback, bounded history, privileges, authenticated HTTP, malformed input, lost commit acknowledgements and corrupt hashes. Z22 connects the browser controller/transport to the actual authenticated HTTP/storage services. S32 recreates authorization and stores after database restart, verifies retained drafts/submissions/publications/receipts and confirms that an older published form does not become the current entry after latest withdrawal. See the source-bound [verification reports](verification.md) for actual execution status.

No live guild, production schema, service, credentials or publication has changed. Roll back the application slice by reverting its files and leaving migration 024's retained tables intact. An older build rejects an unknown applied migration; do not remove ledger rows or retained history to force it to start. A forward-compatible migration/build is required for a migrated deployment. Synthetic test clusters remain stopped and retained. The Windows host recovery and independent off-host restore gates remain open.
