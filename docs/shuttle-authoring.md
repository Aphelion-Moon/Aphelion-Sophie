# Shuttle draft, review and publication services

Scope: P05/P06/P08/P13; R03/R04/R07/R16/R18; partial T03–T05/T16/T19/T22/T36/T42 evidence. This implements the authoring backend and authenticated HTTP API. A separate [browser editor](dashboard-ui.md) now exercises these routes; live Discord/OAuth/TLS checks, full accessibility acceptance and owner-content approval remain open. No dependency, production credential, service or public listener was added. The supplied source file and its adaptation remain unchanged and unpublished.

## Drafts and static review

`modules/onboarding/authoring.js` accepts one bounded document: a boolean help-pause rule and 1–20 stages, each containing a stable identifier, title and body. The owner approved adding, removing and reordering steps on 20 September 2026. Empty text can be saved while editing. Total serialized draft size is bounded to 100,000 UTF-8 bytes, within the existing HTTP body limit. Extra settings, executable workflow fields, oversized text, control characters and malformed Unicode are rejected. A draft has no access-granting effect and is never read by the Shuttle dispatcher.

Review uses the existing runtime publication and pagination contracts. It returns either stable validation errors or the exact proposed publication plus its exact authored screens, or legacy page segments. HTML-looking copy remains data; the browser renderer uses text nodes and fixed DOM elements. This API does not generate HTML, execute Markdown, fetch links or preview a live onboarding session. It has no model, AI or case-content dependency.

`apps/core/storage/onboarding-authoring.js` is configured with one guild and definition identifier by the trusted composition. Callers cannot select another definition or override the actor. All reads and writes require the configured `shuttle.publish` capability through the shared core authorizer. Access is checked before work and again before returning/committing. Browser routes reauthorize once more before delivering their result.

Migration 020 stores append-only draft revisions, canonical hashes, author grants and database timestamps. Each save uses the expected current revision. Competing edits cannot silently overwrite one another; the caller must reload and explicitly reconcile the content. Earlier revisions remain readable and can be saved as a new revision through the same operation. There is no automatic draft import, autosave loop or source-file rewrite.

## Publish and withdraw

Publication requires the exact reviewed draft revision/hash and highest recorded publication version/status. The next version is allocated by the server. Publication, definition and action receipt/audit commit together. The original publication use case and editor share the same definition lock and write helper, so they cannot overwrite competing immutable copy. An intervening save, publish or withdrawal makes a stale review fail. Invalid drafts never become runtime publications.

New runs select the latest still-published definition under the existing entry policy. Existing runs retain their original version, stage and help rule; publication does not reset progress, migrate sessions or change roles. The overview distinguishes the highest recorded version from the version currently selected for new runs. Runtime entry still checks current eligibility and verifies the selected copy; this metadata is not a readiness guarantee.

Publication review returns aggregate impact: currently active runs, currently pending role grants, and all retained completed runs of that version. Counts are runs, not distinct members. No member/session IDs or conversation content are returned. The completed-run count includes retained completions even though they are no longer marked current. Counts can change as members progress; withdrawal records its own transaction-time snapshot.

Withdrawal requires the selected immutable publication hash and explicit confirmation. Its review states which older published version would serve new runs, or null if none remains. The backend marks the version withdrawn, records the actor and receipt, and queues the existing screen-cleanup intents in one transaction. Queued grants cannot use the withdrawn definition, completed Whitelist access remains earned, and all copy, progress, cases and exclusion records are retained. Active runs pinned to withdrawn guidance remain blocked under existing policy; there is no implicit migration or restoration.

Mutations use random 256-bit request IDs. An exact retry by the same currently authorized actor returns the original action receipt; reuse with a different body or actor is rejected. Receipt results describe recorded actions, not a promise of current state. Clients must re-read the draft/publication after a mutation or retry. Replaying an old publish receipt cannot reactivate a withdrawn version. A lost response or permission loss after commit does not undo the durable action.

## HTTP interface

`createShuttleAuthoringHttp` binds the fixed operations into the existing loopback dashboard listener through its explicit optional `authoring` dependency. Without that dependency, the routes are absent. The authentication-only factory name remains compatible; no listener is started automatically.

| Route | Input and result |
|---|---|
| `GET /api/shuttle/draft` | Latest draft and version metadata; optional `revision` reads retained draft copy |
| `GET /api/shuttle/history` | `kind=drafts` or `kind=publications`, optional `before`; at most ten metadata rows |
| `GET /api/shuttle/review` | Exact `revision`; validation, proposed publication, static segments and impact |
| `GET /api/shuttle/publication` | Exact `version`; immutable copy, current status, impact and withdrawal fallback |
| `POST /api/shuttle/save` | Request ID, expected revision and bounded draft document |
| `POST /api/shuttle/publish` | Request ID, reviewed draft revision/hash and highest publication version/status |
| `POST /api/shuttle/withdraw` | Request ID, selected version/hash and explicit confirmation |

Every mutation uses the existing Secure/HttpOnly session, exact Origin and CSRF header checks. Bodies must be UTF-8 JSON, at most 128 KiB, with exact fields; GET bodies and compressed input are rejected. Queries reject duplicate or unsupported fields. Forged actor/definition fields do not reach the store. Stable 400/403/404/409/503 responses never echo draft text, provider errors or credentials. Existing no-cache/CSP/referrer protections and one-operation admission apply. No case, session-detail, transcript or AI route was added.

Histories use descending revision/version cursors with ten-row pages. They return author IDs, timestamps, hashes and publication status without every stored body. Selected authorized reads return the bounded authored document. There is no public draft URL or external preview connector.

## Storage, evidence and release limits

The adaptive-step milestone passes 58 focused checks and E01–E23, V01–V19,
W01–W12 (54 isolated PostgreSQL scenarios). These exercise 1-step and 20-step
publication through actual completion and observed Whitelist delivery, reordered
new guidance with unchanged active runs, size rejection, current final-step checks,
pause/revocation and signed controls. Synthetic browser checks verify addition,
reordering, deletion/cancellation, saved comparison/publication, the step limit,
mobile reflow and clearing on sign-out. See
[current evidence](evidence/adaptive-shuttle-verification.json). Earlier evidence
below describes its historical build. No schema change or live upgrade occurred.

The default draft still starts with five pages. Every run uses its pinned
definition's count and order. The runtime validates the final index again before
Whitelist delivery and does not infer completion from a displayed button. Existing
five-step versions remain valid. Once a variable-length version is retained, an
older fixed-five build is not a compatible rollback: retain the records and use
a build that understands them; do not delete history or force old session indices.

Migration 020 adds `shuttle_draft_revisions`, `shuttle_editor_actions`, an authoring history index and an index supporting impact counts. Core uses SELECT/INSERT/UPDATE permissions, with no DELETE; knowledge cannot access the core schema. Draft and publication history have no automatic expiry. Publication helpers do not take member/screen row locks behind a definition lock. They commit cleanup intents durably and leave Discord delivery to the existing workers; a database commit is not external completion.

Four contract tests cover incomplete drafts, structural/text limits, static pagination and runtime publication rejection. E01–E19 cover competing edits, exact request replay, pinned old runs, new-version selection, immutable copy, withdrawal/fallback, retained completion counts, earned Whitelist, shared writers, revoked permissions, logout, transactional audit failure, bounded histories and database privileges. E16–E19 use actual loopback HTTP with synthetic OAuth sessions and Discord metadata. S28 retains revisions, publish/withdraw receipts and pending cleanup across database restart, then rechecks authorization and delivers the original cleanup behind the delivery barrier. See [verification](verification.md) for execution evidence.

The browser editor supplies labelled forms, safe local Markdown previews, before/after comparison, explicit publication/withdrawal confirmation, stale-edit recovery and refresh after uncertain responses. Its synthetic checks are recorded separately; full accessibility acceptance remains open. Role IDs/capability assignments, final links/copy, session migration/override semantics, production capacity and independent recovery remain release inputs. No full acceptance specification is marked passed from backend or synthetic browser tests alone. Authored source is separate from onboarding-session content; neither creates an AI ingestion path.

Rollback: close the owned listener and stop delivery before reverting compatible application files. Retain migration 020, revisions, actions, definitions, exclusions and pending jobs. Do not erase receipts, lower revisions or republish a withdrawn version to make an older build run. No destructive down migration or production change is part of this slice. The original plans, hardware addendum, artwork and existing host services remain untouched.
