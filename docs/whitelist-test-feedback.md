# Whitelist arrival and dashboard feedback

Scope: P05/P08/P13/P14/P27; T13–T19/T42/T43/T51/T53–T55. Deployed **036c3db**,
schema **054**, following the owner's 27 September test feedback and subsequent
“Deploy and proceed” authorization. No dependencies, migrations,
role grants, permission-policy changes or AI paths were added.

## Behavior

- Entry keeps Discord's deferred acknowledgement while checking for a verified
  destination, up to 16 observations separated by two seconds. It then gives one
  **Begin Whitelist** link with “Your shuttle has arrived. Click Begin Whitelist to
  proceed.” The former button that restarted entry while provisioning is removed.
  Each observation retains current authority checks. Timeout, unavailable authority
  or denied access cannot produce a destination link or a false arrival claim.
- The default completion message explains that the channel closes automatically
  after one hour, once outstanding Staff help is resolved. Cleanup itself remains
  one hour completed/three days inactive, with existing help and grant protections.
  Owner-authored overrides, published guidance and pinned in-flight payloads are
  preserved; historical messages are not bulk-edited.
- Authenticated HTML contains only permitted navigation links. Direct requests
  for unavailable editor pages redirect to Case records before sending editor HTML.
  A one-use session bootstrap supplies the already-checked identity, CSRF token and
  capability hints, removing the redundant initial browser `/auth/session` request.
  Page navigation renews the session. Later quiet refreshes still recheck authority;
  every protected page, data request and action remains server-authorized.
  Disabled authoring adapters do not advertise editor access. Navigation hints do
  not grant case access or replace per-record permissions.
- The shell uses a fixed desktop navigation rail, warm charcoal panels, cream
  headings, cyan accents, thin borders and compact corners, informed by visual and
  computed-style inspection of the owner's [Meridian reference](https://meridian.a13.info/about/).
  These are proposed Sophie styles, not an imported official design system. Mobile
  switches to an in-flow navigation and single-column editor. Quiet mode removes
  decorative color. Approved Sophie artwork is unchanged; no remote fonts, artwork
  or external requests were added. Exact Meridian custom typography remains outside
  this candidate because the font assets and licence scope are not approved here.

## Actual validation

- 45 focused unit checks: dashboard assets/auth/editor, navigation, wording and
  authorization. Covers filtered HTML, direct-page denial, grant revocation,
  session renewal, one-use bootstrap, ready/timeout/denied destinations and no early
  response or retry button.
- 88 isolated Onboarding/wording scenarios, including N11 provisioning before the
  single destination reply; 18 authorization scenarios, including A18 current
  responder/publisher changes and Muzzled/stale-authority denial; 16 composed runtime
  scenarios. All owned test clusters stopped. Runtime was rerun after the final
  HTTP session-renewal and adapter-availability changes.
- Synthetic browser inspection at desktop and 390×844 mobile: no horizontal
  overflow, editable draft saved successfully, and current quiet-mode presentation
  verified. No real sign-in, private content or live Discord interaction inspected.
  Temporary browser tabs and preview servers were closed.
- Repository checks and whitespace review passed. Source hashes, commands and
  execution-time database reports are recorded in
  [feedback evidence](evidence/whitelist-test-feedback-verification.json).

## Remaining boundary and rollback

The owner explicitly authorized this build replacement. Deployment completed with
all 768 pinned files verified against Git, orderly shutdown of the old owned
host/connector/database, fresh current Gateway and matching process/port ownership.
26 public HTTPS checks and 54 migration/70 restricted runtime table checks passed.
Configuration is unchanged; no migration, bootstrap, command rename, grant change
or private record inspection was performed. See [live evidence](evidence/whitelist-test-feedback-live.json).
Rollback may select the previous
schema-054-compatible **9479c2c** build; never select pre-054 executables.

The owner now privately verifies real Discord arrival/completion,
permitted navigation after sign-in and visual fit. Exact custom typography and full
production privacy/recovery/client acceptance remain separate gates.
