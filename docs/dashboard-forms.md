# Ticket-form browser editor

Scope: P05/P08/P10/P17/P36/P37; partial R02/R03/R04/R07/R12/R16/R18 and T01/T03–T07/T19/T22/T36/T42/T43/T49–T51. This milestone adds the `/ticket-forms` browser workspace over the [verified form-authoring API](case-form-authoring.md). It manages authored configuration only. It never loads submissions, case content, attachments, notes or transcripts, and has no model path. The original editor milestone added no dependency, migration, production service, credential or owner form. The later [player-report](player-reports.md) and [Staff-contact](case-contacts.md) extensions add the sixth and seventh categories.

## Composition and shared workflow

The existing fixed asset map now serves both authoring shells, the shared stylesheet, nine browser modules and the original manifest-selected avatar. Inject `presentation`, `formAuthoring` and the existing authentication/authorization services into the core dashboard listener. All remain explicit optional dependencies. Static navigation connects Shuttle guidance and ticket forms; the established OAuth callback still returns to the dashboard root. A public shell contains no authored questions or private data and grants no access.

`authoring-controller.js` shares draft review, exact-request recovery, conflict comparison, retained history and permission clearing between the two editors. Fixed source-code profiles keep Shuttle publication semantics and ticket-form semantics separate; these profiles are not editable configuration or plugins. Domain controllers expose only their relevant editing operations. `shell.js` shares quiet mode, focus/visibility access checks and the warning before leaving with unsaved or uncertain work.

The browser transport adds only seven fixed form routes. It validates category/cursor inputs, keeps CSRF in memory, uses same-origin credentials/no-store fetches and rejects redirects. `canEditForms` is a presentation hint from the current session; all API operations still authorize independently under the explicit `case.forms.publish` capability. Configuration access does not grant case access, including Head Admin contact. Failure to verify current access clears loaded forms, choices, history, dialogs and pending work from both state and DOM.

## Form editing and review

Seven categories have independent drafts and publication histories. Quick Help remains formless. The editor supports a title, up to five ordered questions, short text/paragraph/single choice, optional guidance, required/optional answers, text limits from 1 to 4,000 characters and up to 25 ordered choices. Existing field/choice keys remain attached to their entries when reordered; new entries receive bounded unique keys. The UI does not expose executable rules, role grants, remote sources or uploads.

Incomplete copy can be saved as a draft. Invalid numeric input disables saving/review until corrected. Changing a populated choice question to text or removing a question requires a separate local confirmation. Switching categories with unsaved work offers an explicit discard or return to editing; uncertainty blocks switching. Nothing autosaves or silently merges. Only the optional quiet-mode preference is stored locally.

Review requires the saved unchanged draft. It compares every question, guidance line, choice, ordering, requirement and text limit against the currently selected published form. A static layout preview uses the API's runtime-equivalent presentation data. It accepts no answers and makes no claim to reproduce Discord pixels. HTML-looking copy is rendered as text, without markup interpretation or link fetching. Publication requires a review checkbox and separate action.

History uses the API's ten-record pages. Inspecting is read-only; reusing a retained version creates an unsaved draft which must be saved and reviewed again. Withdrawal has its own review and confirmation. It states that unsubmitted forms pinned to that version stop accepting answers while retained definitions/submissions remain. Withdrawing the latest version disables new category entry, with **no fallback** to an older published version. Withdrawing an older version can leave the newer current version available. Refreshed status is authoritative; a historical action receipt is not treated as present availability.

Lost mutation responses retain the exact request ID/body, close action dialogs and expose **Retry same request**. Other edits and category changes are locked until recovery. An acknowledged action whose refresh fails is labelled as recorded, with a separate reload path. Conflicts retain the local copy and require explicit comparison before using the latest saved copy or preparing the local copy for a new save. Previously displayed information cannot be made unseen, and these UI behaviors do not replace backend authorization or OS isolation.

## Executed developer checks

Twelve form controller/transport tests cover saved-copy publication, independent categories, stable keys and bounded editing, confirmations, incomplete forms, exact uncertain retries, acknowledged-action refresh failures, conflicts, permission/identity clearing, history pagination/reuse, in-flight exclusion and fixed same-origin transport. The existing 13 Shuttle controller/transport tests pass after the shared refactor. Fixed-asset tests cover both public shells and reject unlisted asset/configuration paths.

Z22 connects the actual browser controller and transport to the authenticated loopback HTTP API and PostgreSQL authoring store. It covers first publication, a simulated lost save response and exact retry, a second publication, latest withdrawal without fallback, independent Head Admin drafts and permission clearing. The test supplies manual cookies/Host/Origin over loopback; it does not establish real browser OAuth/TLS/Secure-cookie behavior. See [verification](verification.md) for the current source-bound full-suite report.

On 19 September 2026, the local in-app Chromium browser exercised authored synthetic fixtures using `scripts/preview-dashboard.mjs`:

| Check | Observed result |
|---|---|
| Title and choice editing | Unsaved state and disabled review; named third choice retained on save. |
| Destructive draft change/category switch | Confirmation appeared; cancel preserved the existing copy and category. |
| Saved review and publication | Exact current/proposed copy and static preview; checkbox required; recorded status and focus returned to Review. |
| Plain-text boundary | `<b>Synthetic browser form</b>` remained literal text in comparison and preview. |
| Lost save response | Competing controls disabled; Retry same request resolved the recorded revision. |
| Concurrent edit | Both complete copies shown; Keep my copy followed by Save created the next revision. |
| Withdrawal | No-fallback impact stated; current entry became unavailable while history remained visible. |
| Separate category/limits | Head Admin draft began independently; 4,001-character limit disabled saving, 300 enabled it. |
| Revocation/logout | Loaded input values, question/choice/history nodes and review text were cleared; current access could later reopen the workspace. |
| Keyboard/quiet mode | Tab reached the review checkbox; focus returned after publication; quiet mode hid the optional avatar. |
| Narrow layout | At 390 × 844, page and dialog scroll widths matched their client widths, including 45-character unbroken titles/labels; controls and comparisons remained readable. |
| Shared Shuttle behavior | All five pages and the help setting rendered in the existing review; no browser script errors were reported. |

The temporary preview servers were stopped, their browser tab was closed and the viewport override was reset. The preview is synthetic in-memory configuration only: no credentials, database, Discord connection or real case data. Its control route is excluded from the production asset/API map. These are scoped developer checks, not independent accessibility, brand, real provider/client or release acceptance.

## Remaining work and rollback

Final owner questions/links, production capability mapping, live client/OAuth/TLS checks and independent accessibility/brand acceptance remain open. Other Staff/dashboard workflows, attachment acquisition and transcripts, runtime composition and independent restoration remain separate implementation work. [Player reports](player-reports.md) and [Staff contacts](case-contacts.md) use this editor and the shared intake flow; the added categories have controller/API coverage. No release gate is marked passed by this milestone.

Rollback the browser files, shared controller/transport refactor and fixed asset-map changes together. Keep the already-retained backend drafts, immutable forms and audit history. No migration downgrade is needed for this UI milestone, and no production state was changed. Source PNGs and the original planning pack are unchanged.
