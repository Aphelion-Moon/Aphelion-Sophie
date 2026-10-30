# Sophie development handoff — 30 October 2026 (member records), with the 23 October snapshot below

Sophie provides deterministic community administration, Whitelist onboarding, private cases and website
configuration. No AI may receive ticket or onboarding session content. Read [AGENTS.md](../AGENTS.md) first; current
policy is in [the owner decisions](decisions/0001-owner-policy.md), remaining work and release gates in
[the workplan](workplan.md), and the checks actually run in [verification](verification.md). This page is a snapshot
for the next session: where the Shuttle Activity work stands, what is left before it opens, and how to work on it.
Where it disagrees with those records, they win.

## Newest: a45ca0f in production (30 October 2026, 22:27 UTC)

Production runs **a45ca0f** (schema 084, pushed): a6fa5b3 plus quick role changes as one entry and the evening audit fixes. Since e881f29 it added the following (decision log, verification):
- **8372861:** leave times and five message links, replaced applications kept as an entry, the regular check in core (at
  start and every 6 h), and deleted and edited messages (text kept 30 days, authors a year, attribution from the audit log).
- **35ec844:** profiles compared regardless of jsonb key order.
- **a6fa5b3:** role change entries and a Roles line in each header.

The pinned changelog post's opening lists every feature. Its text is `CHANGELOG_OPENING` in `modules/member-records`;
re-post it with `member-records-forum-2026-10-30/edit-changelog-opening.mjs --run`.

**Installed last:** `deployment-a45ca0f-production-2026-10-30` (the template for the next packet).

**Tools in `member-records-forum-2026-10-30`:**
- `verify-records.mjs [n]`: read-back of delivered posts;
- `inspect-post.mjs <thread>`: first lines and the event timeline of one post;
- `backfill.mjs [--departed]`: manual backfill, now also done by the regular check.

**Gotcha:** a Bash heredoc on this host collapses backslashes, quoted or not. Write code containing backslashes with
the Write or Edit tool only.

## e881f29 (30 October 2026, 15:37 UTC)

Production runs **`e881f29` (schema 081)**, pushed to `origin/main`. On top of the d8efd40 notes below: the two fixes are
installed; Staff and Lead Ops have **`/member watch member: on:`** (registered in the main server), which records an entry
and sets or removes the Watch tag; people who have left have records too (`backfill.mjs --departed`, 10 opened). The
changelog post is pinned (the owner gave Sophie Manage Threads on the forum). Packet:
`.agent_docs/aphelion-sophie/deployment-e881f29-production-2026-10-30` (`register-commands.mjs --rollback` removes /member).

## Member records installed (30 October 2026, 15:02 UTC)

Production ran **`d8efd40` (schema 080)**. Core keeps the member records itself; the section after this one describes
the state before the install and its "Next" list is done.

- **What core does:** each record (`sophie_core.member_records`) holds what the post should show and what is delivered;
  the dispatcher (`apps/core/discord/member-records.js`) brings one post up to date per worker tick, after Whitelist
  grants and notices, live work before backfill. Entries come from the Gateway (join, leave, Whitelist and Muzzled roles,
  names) and from Sophie's Whitelist confirmation. Every entry gets a line in the **changelog post** (thread ID ending
  7086 in the forum). Staff messages in record posts are copied to `member_record_messages`. The forum and its posts are
  case exclusions and refused by the AI context check.
- **Backfill:** run at 15:05 UTC (478 records; 22 Staff posts adopted). Core was still posting them at the time of
  writing, about 6 a minute. Watch it with `$env:TEMP\mr-progress.mjs`-style read-only queries, or
  `member-records-forum-2026-10-30/verify-records.mjs [n]` (GET-only read-back of n delivered posts).
- **Not installed:** `207a1d1` and `601d5ad`: retry a request the delivery gate refused for a moment (`DISCORD_TRANSPORT_DISABLED`
  after Sophie's own post), and treat Discord's rate limit on post creation as a wait. Harmless meanwhile: records continue.
- **Owner actions:** pin the changelog post (Sophie's pin was refused: no Manage Threads); decide who may set the Watch tag.
- **Packet:** `.agent_docs/aphelion-sophie/deployment-d8efd40-production-2026-10-30` (template for the next one;
  `rollback.ps1` drops the records tables and restores bbe844c; posts already made stay in Discord).
- **Gotcha:** never write a JavaScript replacement string with backslashes through a Bash heredoc into `node -e` or
  `node -`; the string escapes collapse them. Use the Edit tool.

## Member records before the install (30 October 2026)

Production ran `bbe844c` (schema 079) in the main Aphelion server; the Shuttle Activity is open. The sections below this one
are the 23 October snapshot and are partly out of date; the decision log and workplan win.

### What it is

A Staff forum with one post per member, kept indefinitely. The forum is `1562315014998728727`, named
"staff-evidence-logs", in the Staff category. It already held one post that is not Sophie's.

Each post opens with five of Sophie's messages:
1. **Header**, which she edits: a summary of the member.
2. **Ledger**, which she edits: jump links to her automatic entries further down.
3. **Access application**, reserved: the transcribed approved application.
4. **Game records**, reserved for Meridian Rift and Wolfgate: a placeholder until SSymphony.
5. **Spare**, reserved and deliberately unassigned.

Below these, Staff discuss freely and Sophie posts her automatic entries.

Owner decisions are in the decision log entry of 30 October ("Member records: ..."), task **P56** in the workplan:
- Everyone gets a post (about 495 members, bots excluded), and records stay forever. Staff can see the forum.
- Sophie transcribes approved applications (this amends the 18 September admission rule) and reads the date of birth as a
  month and year. Interviews, and rejected or pending applications, are never read.
- Staff discussion is copied into Sophie's database. No AI ever reads member records or the forum.
- There are no age alerts, because the owner age-checks every member personally.
- Names are stored, for search. Blacklisting is unchanged for now: departures say "Left or removed".

### State at 15:25 local, 30 October

- **Commits on `main`:** `dbcfee3`, `ff80cc4` and `50f88db`. They are **not pushed**. Production still runs `bbe844c`;
  core and the database are unchanged.
- **`modules/member-records/index.js`:** pure rendering and interpretation, with tests MR-01 to MR-15 and MR-07b in
  `tests/member-records.test.js`. `npm test` passed 915 and `npm run check` passed.
- **Staff test run:**
  - 22 posts exist, one per current Staff or Lead Ops holder.
  - 14 have their application transcribed. The other 8 say none is on record, the owner's post among them.
  - All are archived, and the read-back check passed.
  - A **host-only script** made them, so **they do not update yet**.
  - The forum's tags are In server, Left, Whitelisted, Muzzled and Staff, plus Watch (moderated). Their IDs are in the
    state file.
- **Discord permissions:**
  - Sophie now holds **Kick Members**. The owner adjusted her role at about 15:14, and listing approved join requests
    needs that permission.
  - She also holds a role named "ssymphony", which gives her Manage Channels in the forum.
  - She has no Manage Threads, View Audit Log or Ban Members. Unarchiving and archiving her own posts works without
    Manage Threads.
- **Discord applications:** 436 approved, from 20 July 2026, covering 434 members.
  - The interface is undocumented: `GET /guilds/{id}/requests?status=APPROVED&limit=100&before=<id>` returns
    `{ guild_join_requests }`.
  - Each request has `form_responses` (multiple choice gives a `response` index into `choices`), `reviewed_at`,
    `actioned_by_user`, `user_id` and `interview_channel_id`. **Never touch `interview_channel_id`.**
  - Older forms combine the ckey and date of birth in one question, and most game answers are a bare name. Measured over
    all 436:
    - date of birth: read for 409, month unclear for 14, unreadable for 13;
    - game name: found for 430.

### Working folder

`GitHub/.agent_docs/aphelion-sophie/member-records-forum-2026-10-30`. Run its scripts with
`C:\Aphelion\Sophie\package\runtime\node.exe`, as an administrator. They read the token through
`staging/renewal/secret-field.mjs` and never print it.

| File | What it is |
|---|---|
| `proposal.md` | The design, the loose-ends review, and **"Core integration plan"** at the end: the build list for the next session |
| `staff-test-run.mjs` | `--plan`, `--run [--limit N]`, `--applications [--refresh]`, `--stats`, `--verify`. Read-only use of the production database (latest Activity run, mutes). |
| `staff-test-state.json` | Every post, message and tag ID, and the per-member application status. Core must **adopt** these posts, never create second ones. No application text is stored. |
| `show-post.mjs` | `<n>` shows a post as stored; `--masked <n>` shows a transcribed post with every value masked |
| `probe-*.mjs`, `inspect-*.mjs`, `*.json` | Read-only probes and their outputs |

### Next: core integration (needs the owner's approval to install; the backfill needs its own)

Follow "Core integration plan" in `proposal.md`, step by step. The model for the wiring is the Whitelist notice
(`apps/core/discord/whitelist-notices.js`, `outbox.js`, `core-store.js`, and `runtime/administration.js`,
`configuration.js`, `production-configuration.js`, `staging.js`).
1. **Migration `080-member-records.sql`:**
   - The tables `member_records`, `member_record_events` and `member_record_messages`.
   - The outbox kinds `member.record.open`, `member.record.entry` and `member.record.header`.
   - **Explicit grants to the runtime roles** (production copies grants; see the `bbe844c` install).
2. **Store and dispatcher:**
   - Write the ledger only after the entry's message ID is recorded.
   - Unarchive before editing, and archive again after.
   - Take nonces from the operation ID.
   - Use `allowed_mentions` with nothing allowed, and the suppress-embeds flag.
3. **Producers:**
   - Gateway member add, update and remove. The projection must start carrying `username`, `global_name`, `nick` and
     `joined_at`.
   - The Whitelist grant confirmation, member actions (mute and unmute), and Whitelist loss.
   - On a join, fetch that member's approved application and transcribe it into message 3.
4. **Adoption and backfill:** a host-only command imports `staff-test-state.json`, then runs a paced backfill of the
   other members of about 470 posts, through the store. Archive each post straight away: the server already had 489
   active threads.
5. **Discussion copy:** capture forum threads into `member_record_messages`, in the style of `case-message-capture.js`.
   Add a hard exclusion of the forum and its threads from AI ingress, with a test.
6. **Packet:**
   - Tests: unit, plus `scripts/test-storage.mjs --suite=...`.
   - A deployment folder copied from `deployment-bbe844c-production-2026-10-25`, with `approval.json` quoting the owner.
   - Record the work in `docs/workplan.json` (P56), `docs/verification.md` and the decision log.

### Gotchas from this session

- **No Linux shell on the host.** The remote Linux shell (device bash) did not start ("hypervisor is not running").
  Desktop Commander PowerShell works. For runs longer than about 2 minutes, use `Start-Process cmd.exe` with an
  output file and an `.exit` sentinel.
- **Escapes in written files.** Desktop Commander's write and edit can turn `\uXXXX` escapes into the real characters.
  After writing a file with such escapes, check it for stray invisible characters (see the PowerShell scan in this
  session's history), or build the characters with `String.fromCharCode`.
- **Module boundary.** Code under `modules/` may import only `contracts/` and its own files (`npm run check`). For that
  reason `formatDuration` is a local copy of `modules/onboarding/timing.js`.
- **NULL completion times.** `shuttle_activity_runs.completed_at_ms` is NULL for runs finished before 25 October. Read
  `sessions.state->>'status' = 'complete'` instead (logged in MISTAKES.md).
- **No test install.** The test Discord no longer has an install. Test in production behind owner approval, as the
  Staff run did.

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
