# Sophie development handoff — 23 October 2026

Sophie provides deterministic community administration, Whitelist onboarding, private cases and website
configuration. No AI may receive ticket or onboarding session content. Read [AGENTS.md](../AGENTS.md) first; current
policy is in [the owner decisions](decisions/0001-owner-policy.md), remaining work and release gates in
[the workplan](workplan.md), and the checks actually run in [verification](verification.md). This page is a snapshot
for the next session: where the Shuttle Activity work stands, what is left before it opens, and how to work on it.
Where it disagrees with those records, they win.

## Newest: member records (30 October 2026)

Production runs `bbe844c` (schema 079) in the main Aphelion server; the Shuttle Activity is open. The sections below this one
are the 23 October snapshot and are partly out of date; the decision log and workplan win.

- **What:** a Staff forum (`1562315014998728727`, "staff-evidence-logs", Staff category) with one post per member, kept
  indefinitely. Each post opens with Sophie's header, ledger and three reserved messages; Staff discuss freely below; Sophie's
  automatic entries are linked from the ledger. Decisions, including the amendment to the admission rule (approved
  applications are transcribed; interviews never touched), are in the decision log entry of 30 October; task P56.
- **Done:** `modules/member-records` (rendering, MR-01 to MR-14) and a Staff test run: 22 posts for current Staff and Lead
  Ops, verified, archived. They were made by a host-only script, not by core, so **they do not update yet**.
- **Folder:** `GitHub/.agent_docs/aphelion-sophie/member-records-forum-2026-10-30`: `proposal.md` (the design and the
  loose-ends review), the probes, `staff-test-run.mjs` (`--plan`, `--run [--limit N]`, `--verify`), `staff-test-state.json`
  (every post and message ID, for core to adopt), `show-post.mjs`.
- **Blocked:** reading approved applications returns `403 Missing Permissions`. The owner needs to give Sophie the
  permission Discord wants (try Kick Members in a separate role, then Manage Server), then rerun `probe-join-requests.mjs`.
- **Next:** core integration (migration 080 with runtime grants, outbox kinds, producers, adoption of the test posts),
  the backfill of everyone else (about 470 posts), application transcription, the copy of the discussion. Each install,
  the backfill and any permission change need the owner's recorded approval.

## Where things stand

**Update, 23 October 2026, 01:00 UTC:** `791e2fe` is installed in the **main Aphelion server** in the Activity-and-AI
production mode, on the new `sophie_prod_main` database (decision log entry of 23 October). The test Discord no longer has
Sophie's commands. The story still has to be published (after the owner's first dashboard sign-in), and AI goes live when
the owner publishes the character, budget and channel settings. Rollback: `rollback.ps1` in the deployment folder. The
bullets below describe the state before this install.

- **Installed release:** `sophie-mistral-a0eb904` (schema 075), installed 22 October 2026 at 21:14 UTC as a
  source-only update, on the Windows Server 2022 host under `C:\Aphelion\Sophie`. Services: `aphelion-bot` (core),
  `aphelion-bot-ai-worker`, `aphelion-bot-activity` (the closed "not boarding yet" screen on `127.0.0.1:38124`, kept
  for rollback) and `aphelion-bot-tunnel` (cloudflared, tunnel `sophie-staging`). PostgreSQL holds the staging
  database.
- **Discord:** Sophie's existing application, which is also the Activity's application, in the **test Discord**.
  Sophie is not in the main Aphelion server yet.
- **Hosts:** `sophie.a13.info` (dashboard and interactions) and `onboarding.a13.info` (the Activity, served by core on
  `127.0.0.1:38125`).
- **Activity status `testing`:** only the owner and current holders of the configured lead ops role get past the
  closed screen, checked on every request from Sophie's current role reads.
- **Story:** the Shuttle copy is published as **version 5** (21:15 UTC). Runs keep the version they started on: the
  owner's test run is on version 3, so seeing version 5 needs a new run.
- **Git:** work is on `main`, pushed to `origin` on 23 October (the Shuttle branch was merged with the owner's
  approval). Six commits after the push are not installed: `15252f9` (dashboard sign-in), `bbe039d` (one Yes or No
  and `/sophie`), `28eb1e5` (contexts and longer replies), `a560420` (staff channels), `7115fce` (Guidebook,
  Wolfgate, authenticated GitHub sync) and `c33a418` (code search). Schema 076 is new and unapplied.
- **AI:** the AI worker runs in staging under the owner-accepted Mistral processing policy. The Shuttle has no AI path.
  Memory is off in the installed release (no `automaticMemory` in its policy); the owner accepted automatic memory on
  23 October, and notice revision 4 is drafted in [ai-notice-r4.md](ai-notice-r4.md).
- **Host:** the Sophie services start at boot since 23 October (rollback in
  `.agent_docs/aphelion-sophie/service-autostart-2026-10-23`). The deployment scripts still expect `Manual`, so the
  next adapter must expect the new start types. The read-only GitHub token is staged at
  `C:\Aphelion\Sophie\trust\github-token.txt` (core-only ACL) and goes into core's `credentials.githubToken` at the
  next install.
- **Dashboard sign-in** is broken in the installed release (Discord now reports the Activity's scope too). The fix is
  `15252f9`, bundled with the production install by the owner's choice; meanwhile, removing Sophie under Discord's
  Authorized Apps and signing in again works around it.

## Next: the move to the main server (P50)

Owner decisions of 23 October (decision log): the install moves from the test Discord to the main Aphelion server with a
fresh production database, for closed testing of the Shuttle Activity behind the tester gate, Sophie's AI with memory,
and `/sophie`. Tickets, cases, moderation, Crew assignment and Whitelist delivery stay off until the cutover. Before the
packet: the owner invites Sophie and gives the guild ID, tester role, AI channels with their contexts and the staff
channels; check that each case and role module can be switched off independently. The packet carries migration 076 and
its grants, the processing policy with notice revision 4, `automaticMemory` and `staffChannels`, the GitHub token,
the worker requalification (new profile hash), command registration in the main guild, and the live checks in P50.

## What was done (the Shuttle Activity, 21–22 October 2026)

The Shuttle became a Discord Activity: an ASCII-art visual novel in which Sophie, a radio voice (never depicted),
talks the member through five stops with two companions, Rook and Pip. Each step is in the decision log and
verification.

| When | What | Release |
|---|---|---|
| 21 Oct | Decisions D1–D10 (Activity surface, agent-made art, Sophie as a radio voice, Cozette, rules post, presence, the Shuttle leaves tickets, production application with a tester gate, main page, CC0/CC BY sounds); 24 sounds chosen, converted (FFmpeg LGPL, build-time only) and approved; `onboarding.a13.info` chosen | — |
| 22 Oct | Embedded App SDK 2.5.0 pinned; closed-screen service; deployed in testing with migration 074, `/whitelist post` registered, route switched to core | `fe25c83`, `b6af5d8` |
| 22 Oct | Second pass: moments, viewscreens, arrival links, layout editor (migration 075); layout pass | `052864c`, `2063a50` |
| 22 Oct | Third pass: richer scenes, conveyor, station board, boarding pass | `0d446fe` |
| 22 Oct | Fourth pass: the Shuttle as a story, 17 story sounds, SC-07; host-only publishing command; story version 3 | `135f2a6`, `a620ce0`, `cf0c125` |
| 22 Oct | Fifth pass: the owner's design picks, walk-behind depth, full-page title, launch post wording; story version 4 | `ceb46cb` |
| 22 Oct | Audit of the whole Activity | `f6c787e` |
| 22 Oct | Sixth pass: pages and beats that follow the reader, click-to-continue mark, the member's own name on the title window, Beepsky, the staging lint, the review's scene fixes; story version 5 | `a0eb904` |

Offline evidence on `a0eb904`: `npm test` 799 passed, `npm run check` passed, `npm run test:storage:fast` 1029 passed
with none failed. Every install passed its pre-start, boundary, installation, dashboard and public checks.

## What is left before the opening

In order. Each install, publication and the opening needs a recorded owner approval.

1. **Owner review of the sixth pass** in the test Discord, on a new run (version 5). The owner re-posts the launch post
   with `/whitelist post` to show its new wording.
2. **Checks inside Discord**, none done yet:
   - whether `discord.com/channels` links open inside the app (desktop and mobile);
   - audio unlock, picture-in-picture, presence and screen readers;
   - mobile portrait, and the username title with a long name at phone width;
   - text shown at once: whether the sea lion's strike lands after the reading time;
   - the platform report for Windows desktop, web, iOS and Android (P40: launch time, layouts, the launch notice and
     the Activities permission).
3. **Not built yet** (P41), both part of the approved design:
   - moving a run in progress in a channel into the Activity at the same step (today the Activity tells the member to
     finish in their channel);
   - the text version reachable from the rules post, sharing the same run (D5's route for clients that cannot open
     Activities).
4. **Tester acceptance** on every platform: sign-in, every stop, Whitelist and the door ("Deploying" step 4 in
   [the Activity doc](shuttle-activity.md)).
5. **The opening** ("Deploying" step 5, its own recorded approval):
   - set the runtime configuration's `activity.status` to `open`. This is a configuration change: the source-only
     deployment scripts refuse it (they check that the configuration is unchanged), so it needs its own prepared and
     reviewed procedure;
   - the ticket switch happens here, not before: new Shuttle runs stop opening a ticket channel (decision of
     22 October). Runs already in a channel keep their channel rules;
   - post the launch post in the rules channel.
6. **Candidates for a later pass,** recorded but not approved: auto mode, skipping pages already read, small choices
   that gate nothing.

## Beyond the test Discord: owner decisions needed

"Deploying to the server" may mean more than the opening. The records say:

- Sophie is not in the main Aphelion server. The workplan's release status is that **all production release gates
  remain open**, and the cutover tasks (P30 pilot and cutover ledger, P31 cutting over administrative
  responsibilities) have not started.
- A separate testing application is planned "down the road" (21 October). Until then the tester gate is the only
  protection.

Ask the owner what the deployment covers: which guild, what moves when, role and channel IDs, and the cutover order.
Then record the answers before acting. Do not infer any of these.

## How to work on the Activity

- **Copy:** edit `content/onboarding/story.md`, then `node scripts/build-onboarding-story.mjs` (definition, draft and
  preview). `tests/onboarding-story.test.js` holds the meaning checklist.
- **Moments** (beats, page breaks, reveal phrases): `scripts/author-shuttle-viewscreens.mjs` writes
  `content/shuttle-activity/moments.json`.
- **Scenes:** `scripts/author-shuttle-scenes.mjs` writes `content/shuttle-activity/scenes/*.json`. The format and
  each scene's staging are in [the scenes doc](shuttle-activity-scenes.md). The staging lint
  (`tests/shuttle-staging-lint.test.js`) must stay clean.
- **Scratch tools** (not in the repository) are in `GitHub/.agent_docs/aphelion-sophie/shuttle-activity-tools/`. Run
  them from the repository root:
  - `dump.mjs <scene> <layout> <time> '<stateJson>' [rows]` prints a composed scene as text;
  - `audit-overlap.mjs [scene]` is the walk-behind audit;
  - `audit-collisions.mjs [scene]` finds layers overwriting each other;
  - `hidden.mjs <scene> <layout> <sprite> '<stateJson>'` shows where a sprite is hidden;
  - `who.mjs <scene> <layout> <x> <y>` names the actor that paints a cell;
  - `adapt-deployment-a0eb904.cjs` is the last deployment adapter, the template for the next.
- **Tests:** `npm test`, `npm run check` and `npm run test:storage:fast` (isolated PostgreSQL). Record the actual
  counts.
- **Install (source-only).**
  1. Create `GitHub/.agent_docs/aphelion-sophie/deployment-<sha>-<date>` and copy the previous folder's `*.ps1`,
     `*.mjs`, `activity-configuration.json` and `processing-policy.json`.
  2. Run `git archive --format=zip -o source-<sha>.zip <sha> -- apps contracts modules platform legal
     content/shuttle-activity package.json package-lock.json LICENSE`, then unzip it into `pinned/source`.
  3. Adapt the scripts with a copy of the last adapter (commits, the reviewed file list and count, the backup name,
     the release name, the served-file checks), and write `approval.json` quoting the owner's approval.
  4. Run `run-deployment.ps1` in an elevated, unsandboxed PowerShell (the sandbox cannot read `C:\Aphelion`), then
     `node verify-public.mjs`. `rollback.ps1` in the folder restores the preserved installation.
- **Publish the story** with the host-only command (details in [publishing](shuttle-publishing.md)). Run
  `C:\Aphelion\Sophie\package\runtime\node.exe C:\Aphelion\Sophie\package\source\apps\core\shuttle-publishing.mjs`
  with `--config C:\Aphelion\Sophie\staging\runtime.json --database C:\Aphelion\Sophie\staging\core.json
  --confirm-guild <guildId> --author <ownerUserId>`, both read from `C:\Aphelion\Sophie\staging\bootstrap-seed.json`:
  1. `status`;
  2. `save --document <folder>\story-draft.json` (the committed draft, copied into the deployment folder);
  3. `publish --revision N --sha256 H --expect-version <current> --expect-status published`;
  4. recompute both hashes from the committed draft with `canonicalOnboardingDraft`, `reviewOnboardingDraft` and
     SHA-256 of their JSON, and record them.
- **After each milestone:** update `docs/workplan.json` and run `node scripts/build-workplan.mjs`; update
  `docs/verification.md`, the decision log and the status section of [the Activity doc](shuttle-activity.md).

## Gotchas

- **The browser pane crashed the desktop app** when a new tab was created and resized. Prefer text dumps of composed
  scenes, and do not open or resize new preview tabs.
- **Shell escapes:** Bash heredocs and inline `node -e` on this host can collapse backslashes and turn `\u0000` into
  raw bytes. Use the Write and Edit tools (or `String.fromCharCode(92)`) for backslash-heavy edits.
- **`SERVICE_CHILD_STILL_RUNNING`:** an install can refuse before writing anything if a child process outlives the
  2-second check after the stop. Confirm no core or worker process is left, then run the same folder again.
- **Vendored files:** the repository ignores `dist/`. A test now checks that every vendored SDK file is tracked; keep it.
- **Run versions:** a published copy reaches new runs only.

## Standing rules for this work

- No AI anywhere in the Shuttle or tickets. Synthetic data only in tests, fixtures and screenshots.
- The member's Discord username (title window) and boarding pass are shown only to them, never stored or logged.
- Never print Discord or Cloudflare tokens or other secrets. When the owner supplies a Cloudflare token, use it only in
  request headers, and touch no tunnel, rule, DNS record or R2 secret beyond the approved change.
- Production and test-Discord installs, publications, service changes and the opening each need a recorded owner
  approval. Approval for one step does not carry over to the next.
- New dependencies must be MIT unless a scope decision is recorded. SS13 is shared culture only; no SS13 sprite or
  sound is copied. Sophie is never depicted.
