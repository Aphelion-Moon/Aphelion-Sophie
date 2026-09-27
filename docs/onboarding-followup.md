# Onboarding channel lifecycle and sign-in follow-up

Scope: P05/P08/P13/P14/P27; T13–T19/T42/T43/T51/T53–T55. Deployed schema **054**.
This milestone deployed **9479c2c/schema 054** after the authorized upgrade and command rename.
The later feedback build **036c3db/schema054** is now selected; see [current handoff](handoff.md).
See [live technical evidence](evidence/onboarding-followup-live.json): 70 tables preserved,
verified encrypted backup/quarantined restore, current Gateway and 24 public HTTPS checks.
No dependency, role grant, permission candidate or AI path changes.

The owner reports the earlier private checks 1–4 passed: editor/login behavior,
published screens and controls, completion/Whitelist delivery and role exclusions.
Shared wording remains untested. Client versions and exact test times were not supplied;
this feedback does not close the full production privacy/revocation/recovery gates.

## Resulting behavior

- `/whitelist start` checks the stored destination. Only a fresh, opaque proof of
  Discord's unknown-channel response can retire a missing channel. Permission errors,
  outages and uncertain creates cannot authorize replacement. Active runs retain
  their definition, progress, help pause and resolution request. Old destinations,
  screens and case bindings remain recorded; old controls cannot advance the run.
- Completed channels become eligible for removal after **one hour**. Inactive
  channels become eligible after **three days** without a start/resume, page control,
  help action or completion update. The bounded scheduler checks once per minute.
  Open help requests, help pauses and pending Whitelist grants require resolution
  before automatic removal. Current authority and the exact Sophie channel identity
  are checked before Discord deletion; confirmation requires observing absence.
- Staff use `/whitelist close confirm:true [channel:#channel]` to request removal of
  an existing Onboarding channel, defaulting to the current channel. Other case
  types are rejected. A queued Staff request rechecks its recorded authority.
  Closure cancels unfinished grants and preserves compensation for late effects.
  It never removes an already earned Whitelist role. A subsequent start resumes
  an eligible unfinished run or begins a repeat after completion.
- Guidance publishers use `/whitelist panel` in the desired ordinary text channel.
  Its public embed and button are returned through the signed interaction's
  initial response, after authorization and before its response deadline. Failed
  authorization/timeouts produce a private error. Case channels are excluded.
  The button uses the existing self-service route and conveys no authority.
- In **Configuration → System wording → Onboarding entry panel**, edit
  `onboarding.panel.title`, `onboarding.panel.body` and `onboarding.entry` (button).
  Edits affect newly posted panels; existing panels remain unchanged. Fixed routing,
  bounded text, revision checks, preview and mention suppression remain in place.
- `/login` shows only the sign-in presentation. Anonymous or expired-session
  requests for dashboard HTML redirect there with an allowlisted return page.
  Valid sessions require current dashboard access before receiving page HTML.
  Logout and failed session renewal return to login. Static code/styles/avatar
  remain public; protected data APIs keep their own authorization and CSRF checks.

Discord's [channel deletion contract](https://docs.discord.com/developers/resources/channel#deleteclose-channel)
returns the deleted channel object. Lost responses are reconciled against the exact
channel ID, rather than interpreted as proof of removal. The panel uses Discord's
[initial interaction response](https://docs.discord.com/developers/interactions/receiving-and-responding).

## Persistence, upgrade and rollback

Migration 054 adds retirement metadata/activity time to case reservations and
previous case IDs to Onboarding bindings. It changes no existing columns or stored
content, grants no privileges and queues no cleanup during migration. Existing
channels receive a fresh activity timestamp and the full applicable grace period.
No records, transcripts or attachments expire. Discord channel removal is distinct
from retained data deletion; previously uncaptured messages are not reconstructed.

The authorized upgrade completed on 27 September. The applied procedure was to: preserve schema 053 with its compatible tools,
verify an encrypted quarantined restore, stop the owned host and wait for its lease,
apply 054 with old-column preservation checks, pin the new archive and restart.
Rename only the existing guild `/shuttle` command to `/whitelist`, retaining its ID,
and register `close` and `panel`. Check for command-specific permission overrides
before the rename; leave unrelated commands untouched.
No public panel is posted by deployment, and no owner-authored guidance is republished.
Verify anonymous HTML redirects, login return links, exact assets, anonymous API
denial, unsigned-interaction denial and fresh Gateway health. The old check-053.mjs
expects public dashboard HTML and must not be reused unchanged.

After migration, rollback means stopping and repairing forward with schema-054
compatible code. Do not select 053 executables, drop/downgrade data, activate a
quarantined restore or restore old role snapshots. The owner-authorized staging upgrade and command rename are complete. The reported
account must privately retry /whitelist start; no session content was inspected or
manually rewritten. Private client and real elapsed cleanup acceptance remains open.

## Validation and next private test

- 45 focused unit checks: dashboard gating/editor/auth, channel proofs, entry routing,
  panel authorization/wording and system wording.
- 13 isolated lifecycle scenarios (OC01–OC13): missing-channel recovery, forged and
  permission-denied observations, preserved progress/help, Staff closure, timing,
  pending-grant cancellation/revoked Staff, uncertain deletion and schema-053
  preservation. See [lifecycle evidence](evidence/onboarding-lifecycle-verification.json).
- 88 existing Onboarding/wording scenarios passed; see
  [regression evidence](evidence/onboarding-verification.json). Each report records
  its source hashes and scope. Migration-count changes in other suites are not passes.
- 16 composed runtime scenarios (RT01–RT16) passed, including real signed loopback
  ingress for the public panel and private Staff closure response, plus actual
  synthetic OAuth followed by authenticated dashboard HTML. See
  [runtime evidence](evidence/staging-verification.json). All owned test clusters stopped.
- Repository source conventions, preserved reference checksums and asset copies pass.
  No real browser/Discord account or production service was used for these checks.

Privately retry the reported locked-out account using `/whitelist start`;
test a synthetic deleted destination, repeat completion, confirmed Staff closure,
the one-hour/three-day cleanup, configurable public panel, anonymous login gating and
the still-untested System wording editor. Report symptoms/client/time only. All
production release gates and independent recovery requirements remain open.

The public command rename preserves internal command/capability/session identifiers
and existing button IDs. New default command instructions use `/whitelist`; stored
custom wording and the exact historical renderer are not rewritten.

The renamed candidate passed 27 focused command/registration tests plus the same
88 Onboarding, 13 lifecycle and 16 composed runtime scenarios on 27 September.
All owned test clusters stopped, and repository checks passed.
