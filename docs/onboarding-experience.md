# Onboarding experience and shared system wording

Scope: P05/P08/P13/P14/P27; partial T13–T19/T42/T43/T51/T53–T55.
This implements the owner's persistent-page and shared-wording decisions.
Implementation 119084b was followed by the OAuth return-path repair 036476f.
Staging now selects **9479c2c/schema 054** after the authorized 27 September
[channel/login follow-up and /whitelist rename](onboarding-followup.md). See [current handoff](handoff.md).
No dependency, AI path or publisher capability grant was added.

## One message per journey

The current Onboarding screen is a persistent message anchor. Next, Back,
acknowledgement, help and completion update its snapshot and edit that same Discord
message. Successful page controls receive a silent deferred update; errors use a
private follow-up. Routine page turns no longer post progress notices, retire the
previous page or show internal marker footers. Completion still follows observed
Whitelist delivery, never the button click alone.

Every change advances a control revision alongside the stored session state.
Current membership, access epoch, session version, nonce, private destination and
message identity checks remain mandatory. Late render jobs reconcile the latest
snapshot. An uncertain edit is inspected before another write. Lost creates still
require recovery rather than blind reposting; explicit replacement after deletion,
revocation or an abandoned uncertain create remains possible. Existing historical
messages are retained. An exact legacy renderer permits recovery of pre-upgrade
messages before refreshing them in place.

Explicit screens remain versioned with guidance: Next/Back precedes acknowledgement
on a step's final screen. The earlier focus, OAuth renewal/return-page, grouped
navigation and Markdown work is described in [dashboard feedback](dashboard-feedback.md).
The reported intermittent destination failure now gets one bounded retry for
invalidated or busy observations; its exact live cause has not been reproduced.

## Shared wording editor

Open **Configuration → System wording** (`/localizations`). Guidance publishers
can search 264 system templates by category, edit wording, preview Markdown,
restore a default and apply their changes. This is one shared set per server.
Placeholders and length limits are checked server-side. Templates are bounded data;
they cannot change routing, permissions or the state machine.

The catalogue covers Onboarding controls/status/navigation, assistance and delivery
queues, ticket wrappers/navigation/status, saved-link DMs and public-answer wrappers.
Authored guidance, form questions, answers, Staff replies and automation text remain
in their existing editors. Slash-command names/descriptions are deployment metadata;
already posted static entry panels are not rewritten by this editor.

The API independently checks authentication, current `shuttle.publish` authority and
CSRF. Revisions are append-only through this service. Expected-revision checks reject
concurrent edits, and exact request receipts allow uncertain saves to be retried.
Denied changes roll back. Browser drafts survive quiet focus checks and failed saves.
No member session, case conversation or private form content enters this editor.

New messages and subsequent page turns use saved wording. In-flight immutable
deliveries pin their revision before preparing a message, so changing wording cannot
invalidate an uncertain message's recovery proof. Existing deliveries migrate with
revision zero (bundled wording). Each page edit clears its wording pin for the next
render. Changes do not rewrite retained publications or submitted answers.

## Development names and compatibility

Use **Onboarding** for modules, factories, tests, configuration examples and source
content. **The Shuttle** remains public branding. Code files and exports now use
`onboarding`; source guidance is in `content/onboarding/` and editor routes use
`/api/onboarding/`. Historical SQL names/migrations, outbox kinds, capability keys,
error codes and Discord component identifiers stay stable. Public commands now use
`/whitelist`, as explicitly requested on 27 September. The old
`/api/shuttle/` routes and `canEditShuttle` session field remain compatibility aliases.
Preserved reference documents and source artwork have not been rewritten.

## Verification and next test

See [source-bound evidence](evidence/onboarding-experience-verification.json):
406 unit tests; 88 focused Onboarding/wording, 67 intake, 20 recovery/upgrade and
14 composed-runtime scenarios; ten synthetic browser checks. Owned database
clusters stopped. These are automated local checks, not live Discord/OAuth or
multi-account privacy acceptance. The human ledger remains unqualified.

The authorized staging upgrade and database preservation are complete through 053.
The final live verification and owner retest remain open. Restart the existing pinned
host as described in [handoff](handoff.md); do not repeat the completed migrations.
Migration 053 adds /localizations to the database OAuth return-path allowlist; 19
authentication and 14 composed-runtime scenarios passed for that forward repair.

Rollback is forward repair with compatible schema 053 code. Preserve rows, revisions,
receipts and pending effects; do not use 052/046 executables or downgrade the database.
Production gates remain open.
