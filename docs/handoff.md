# Sophie development handoff — 2 November 2026

Sophie provides deterministic community administration, Whitelist onboarding, private cases and website configuration.
No AI may receive ticket or onboarding session content.

Read [AGENTS.md](../AGENTS.md) first. The other records, which win where this page disagrees:
- current policy: [the owner decisions](decisions/0001-owner-policy.md);
- remaining work and release gates: [the workplan](workplan.md);
- the checks actually run: [verification](verification.md).

This page is a snapshot for the next session: what runs in production, what the member records do, what is left, and how
to work safely. Earlier snapshots are in this file's git history.

## Production now

- **Release:** **`bc57644`** (schema 086, no migration), installed 2 November 2026 at 18:13 UTC: the Wolfgate AI preparation
  and reply checks, and no Contact staff button on AI replies (`deployment-bc57644-production-2026-11-02`). Before it,
  `4eeca3d` (schema 086) from 14:08 UTC that day: game moderation in the record posts, the Gateway queue fix and the hourly
  GitHub 403 retry.
- **Central identity database:** core reads `aphelion_central` (127.0.0.1:5490, service `aphelion-central-postgres`) as
  `sophie_central_reader`, read-only, for the posts' games messages (ADR 0006). Its docs are in the `Aphelion-Central`
  repository.
- **Server:** the main Aphelion server, in the Activity-and-AI production mode (`scope: activity-ai`). Another bot owns
  roles, cases and moderation; Sophie only adds Whitelist at the end of the Shuttle.
- **Host and database:** Windows Server 2022 host, `C:\Aphelion\Sophie`; database `sophie_prod_main`.
  - Services: `aphelion-bot` (core), `aphelion-bot-ai-worker`, `aphelion-bot-activity`, `aphelion-bot-tunnel`,
    `aphelion-bot-postgres`.
  - They start at boot and restart on failure.
  - Node 24.22.1 is pinned. A host Node update needs a runtime pin and review first.
- **Shuttle Activity:** open to every eligible member since 24 October (Shuttle version 6). Sophie grants Whitelist when a
  member finishes.
- **Notices and alerts:**
  - Whitelist notices with reading time go to the staff bot channel `1528802745136447508`.
  - Error alerts go to `1528812406724231288`, pinging @matriarch.
- **Commands in the main server:** `/lookup`, `/member watch`, `/sophie`, and `/whitelist` with `post` and `progress`.
- **AI:** switched on at 17:00 UTC on 2 November, but no channel is live: the log says
  `AI_ADMISSION_SKIPPED_CHANNEL_NOT_CONFIGURED` (or `NO_CONSENT`), and no AI turn has run. After each release, each channel
  needs Go live again on the dashboard; after `bc57644` that also accepts the new Mistral profile. The owner's focus is
  elsewhere, so don't press for Go live. The Wolfgate preparation is installed (see
  [AI: preparing Sophie for Wolfgate](#ai-preparing-sophie-for-wolfgate-2-november-2026)).
- **Known noise in the core log** (`C:\Aphelion\Sophie\logs\core\aphelion-bot.err.log`):
  - `KNOWLEDGE_SOURCE_GITHUB_FORBIDDEN` hourly since 4eeca3d (every 16 minutes before): the GitHub token is refused for the
    organisation listing, so no GitHub knowledge has synced since 25 October; the token's access still needs fixing;
  - `AI_ADMISSION_SKIPPED_CHANNEL_NOT_CONFIGURED`, and sometimes `NO_CONSENT` or `AUDIENCE_CHANGED`, for messages in
    channels without AI since AI was switched on (17:00 UTC, 2 November): diagnostics, not faults;
  - after a restart: `DASHBOARD_DENIED_DASHBOARD_CREDENTIAL_INVALID` (old sessions), `ACTIVITY_REQUEST_SIGNIN` (an open
    Shuttle run signing in again), and possibly one `MEMBER_RECORD_CHECK_FAILED code=DISCORD_TRANSPORT_DISABLED` while core
    takes over the Gateway; that check retries 10 minutes later (seen passing at 18:24 UTC after the bc57644 install).
- **Every install, publication and production write needs the owner's recorded approval.** Approval for one step does not
  carry over to the next. Templates: `.agent_docs/aphelion-sophie/deployment-bc57644-production-2026-11-02` for a
  source-only release (with `check-shuttle-quiet.mjs`, and `build-packet.mjs`, which builds a packet from the previous one),
  and `deployment-4eeca3d-production-2026-11-02` for one with a migration and its rehearsal (`rehearse-migration.mjs`).
  A release that changes the Mistral profile hash must say so in `prepare.mjs`, as bc57644's does, or the check refuses it.

## Member records (P56)

### What Sophie keeps

The Staff forum is `1562315014998728727` ("staff-evidence-logs"), with one post per member, kept forever. Every current
member has a post, and so do the people who have left that Sophie can name.

**Each post opens with five of Sophie's messages:**
1. **Header**, kept up to date: names and ID, account age, status, joins, last leave (date and time), Shuttle run and
   reading time, mutes, birth month and year and game accounts (from the application), earlier names, current roles.
2. **Ledger:** links to her entries.
3. **Access application:** transcribed. A newer one replaces it, and the older one is kept as an entry.
4. **Game records:** the verified Meridian Rift and Wolfgate accounts and their character names, from the central
   identity database every 15 minutes (owner, 31 October 2026). Conflicts are flagged, and so is a self-reported
   application name that differs.
5. **Spare.**

**Tags:** In server or Left, Whitelisted, Muzzled, Staff, Watch.

**Entries:**
- joined and rejoined;
- left, with the time and links to the 5 latest messages;
- Whitelist granted by Sophie (with reading time), given by someone else, or removed;
- Muzzled and unmuzzled;
- other role changes, with who changed them from the audit log, and quick changes combined into one entry;
- name changes;
- application, and application replaced;
- Watch on or off (`/member watch`, Staff and Lead Ops);
- deleted messages (text, attachments, who deleted them) and edited messages (before and after). These two stay in the
  post only, out of the ledger and the changelog.

**Changelog:** the pinned post "Sophie's changelog" (thread `1565736855431807086`) gets one line per entry, except
deletions and edits. Its opening lists every feature. The text is `CHANGELOG_OPENING` in `modules/member-records/index.js`;
re-post it with `member-records-forum-2026-10-30/edit-changelog-opening.mjs --run` (2,000 characters at most; 1,966 now).

**Regular check:** in core, at start and every 6 hours, beside the worker loop. It reads the member list and approved
applications, opens missing records (including people who have left), notices changes made while Sophie was offline, and
refreshes the channel map. It refuses a member list that would mean more than a few leaves at once. A check that fails
runs again 10 minutes later.

**Message store:**
- text is kept 30 days, and who wrote which message a year (rows are cleared, never deleted);
- nothing is kept from the ticket category, threads under it, case-excluded channels or record posts;
- a channel whose place is unknown keeps nothing;
- deleted or edited text entered in a post stays with the record (pinned post, decision log).

**Never AI:** the forum and its posts are case exclusions and are refused by the AI context check. Staff discussion in a
post is copied into `member_record_messages`, and no AI reads it.

### Where the code is

| Part | File |
|---|---|
| Rendering, wording, observation logic (pure) | `modules/member-records/index.js` |
| Store, Gateway sink, role merging, regular check data | `apps/core/storage/member-records.js` |
| Dispatcher (one record per tick, lease, audit attribution) | `apps/core/discord/member-records.js` |
| Gateway field extraction | `apps/core/discord/member-record-ingress.js` |
| Regular check | `apps/core/discord/member-record-reconciler.js` |
| `/member watch` | `apps/core/discord/member-watch.js` |
| Backfill planners (also used by the check) | `apps/core/operator/member-record-backfill.js` |
| Production write allowance and record methods | `apps/core/discord/transport.js` |
| Games feed and game moderation feed | `apps/core/discord/member-record-games.js`, `member-record-moderation.js`; reader `apps/core/storage/central-identity.js` |
| Migrations | `apps/core/storage/migrations/080`–`086` |
| Tests | `tests/member-records*.test.js`, `scripts/integration/member-records-suite.mjs` (`--suite=member-records`) |

### Production at the last records check

Read-only check on 30 October at 22:28 UTC (not repeated since; a production read needs the owner's approval):
- 489 records, 479 of them present, all delivered, none erroring;
- 436 with an approved application;
- 634 messages kept, none from tickets;
- real entries so far: edits, a deletion ("most likely by the author"), role changes and name changes.

### Not seen live yet

These are covered by tests, but worth a look the first time each happens:
- a combined role entry;
- a moderator deletion attributed from the audit log;
- a deleted "@everyone" message, or a very long quote;
- `/member watch` used by Staff;
- a leave with message links;
- a replaced application.

### Game moderation (installed 2 November 2026, 14:08 UTC, as 4eeca3d)

The owner asked for Meridian Rift and Wolfgate admin help tickets, notes and bans in each member's post: all of them,
secret notes too (marked), full ticket transcripts, and everything already stored.
- **Path:** the game databases → Aphelion-Central's sync (migration 005, `identity.moderation_records`, view
  `identity.member_moderation`; `sync/moderation.mjs` shapes the rows, no IP or HWID) → Sophie's moderation feed every
  15 minutes (migration 086, `member_record_sources`) → entries in the post.
- **Entries:** `game.ban`, `game.note`, `game.ticket`, and `game.changed` for a later lift, edit, deletion, closed or
  reopened ticket, or removal. Tickets stay out of the ledger and changelog. The first run's history skips the changelog.
  The header's Moderation line counts each game's bans, notes and admin helps.
- **Wolfgate ahelps:** not stored anywhere on the host; the PR plan is in
  `GitHub/.agent_docs/aphelion-sophie/wolfgate-ahelp-persistence/PLAN.md`.
- **Live since 2 November:**
  - Central migration 005 and the moderation sync, deployed to `C:\Aphelion\Central\sync\sync` at 14:02 UTC.
  - Sophie `4eeca3d` installed at 14:08 UTC.
  - The first run entered 89 records for 33 members, all posted by 14:11 UTC.
  - The changelog opening was re-posted.
- **Packets:** `deployment-central-005-2026-11-02` and `deployment-4eeca3d-production-2026-11-02` (the template for a
  release with a migration).
- **Read-back tools:** `verify-moderation-entries.mjs` and `watch-moderation-delivery.mjs`, both hashes and counts only.
- **Central deployment:** the sync runs from the copy in `C:\Aphelion\Central\sync`, not from the repository. Deploy a
  change by copying the files there. Run migrations from the repository with `npm run migrate`.

### Open, in order

1. **Privacy notice:** a line saying message text is kept 30 days, authors a year, and deleted or edited messages are kept
   in the record. This is the owner's wording to approve.
2. **Carl-bot's deleted-message log** (channel `1530218851785113641`) can stay as a backstop or go: the owner's call.
3. **Later:**
   - Discord moderation (bans and kicks via the audit log);
   - SSymphony game records for Meridian Rift and Wolfgate;
   - an index for the 30-day expiry once `member_messages` grows;
   - a concurrency test of a Gateway member update during the Whitelist confirmation (the lock order was fixed by
     reading the code).

### Tools (working folder `GitHub/.agent_docs/aphelion-sophie/member-records-forum-2026-10-30`)

Run them with `C:\Aphelion\Sophie\package\runtime\node.exe`, unsandboxed. They read the token through
`staging/renewal/secret-field.mjs` and never print it.

| Script | What it does |
|---|---|
| `verify-records.mjs [n]` | GET-only read-back of n delivered posts |
| `inspect-post.mjs <thread>` | First lines of Sophie's messages and the event timeline of one post (no Staff text) |
| `backfill.mjs --plan or --run [--departed]` | Manual backfill; the regular check now does this |
| `edit-changelog-opening.mjs --check or --run` | Updates the pinned post's opening from `changelog-opening.md` |
| `create-changelog.mjs` | Created the changelog post; `--run` only retries the pin |

### Today's releases (30 October 2026)

| Release | Installed (UTC) | What |
|---|---|---|
| `d8efd40` | 15:02 | Core keeps the records; changelog post; backfill of 478 (22 Staff posts adopted) |
| `e881f29` | 15:37 | Delivery fixes; `/member watch`; records for people who have left |
| `8372861` | 16:37 | Leave times and links; replaced applications; regular check; deleted and edited messages (082, 083) |
| `35ec844` | 16:43 | Profiles compared regardless of jsonb key order |
| `a6fa5b3` | 17:49 | Role change entries; Roles line in headers (084) |
| `a45ca0f` | 22:27 | Quick role changes as one entry; the evening audit's fixes |

`0b9298a` and `a137906` were prepared and then folded into later releases. Their folders say so.

## AI: preparing Sophie for Wolfgate (2 November 2026)

Sophie's AI chat was switched on once (23 October) and made things up. The best-known case: "CI" explained as GitHub's
continuous integration instead of the combat rule. The owner asked whether the model or retrieval was at fault, and for
her to handle SS14 Wolfgate gameplay questions. Read the decision log entry "Preparing Sophie for Wolfgate gameplay
questions - 2 November 2026" and workplan tasks P53, P55a, P55b and P57.

**Answer: mostly retrieval and grounding.** In the live run (270 calls on the owner's budget), the model passed 122 of 135
runs when handed the right passages, but only 93 of 135 in the real turn. The model's own fault is judging incidents
("That's definitely RDM"); a prompt rule and a reply check now remove such verdicts (`da650cd`).

**Owner decisions (2 November):**
- CI is the Combat Indicator, and "combat intent" is an alias.
- Wolfgate has no CI; escalation is Guidebook Conflict Rule 1.
- The Discord harvest takes only staff posts from public channels the owner names. They are distilled into documents
  the owner publishes.
- No model training.

**Installed as `bc57644` at 18:13 UTC on 2 November and pushed.** The prepared `b166a19` packet was never run and is
superseded. The knowledge re-read is done (counted at 19:28 UTC on the owner's approval): every wiki document and 359
of 360 Guidebook documents carry their game, 55 Guidebook entries are upstream rulesets, the 34 website documents are
labelled, and 404 wiki sections are marked out of date. For part of the evening another session had the main checkout on
the radio branch: see [Radio](#radio-p58-built-offline-on-three-branches-not-merged).

| What | Commits |
|---|---|
| Evaluator: retrieval, oracle and end-to-end modes, a diagnosis per case, re-judging without new calls | `45df8b8`, `6345c59`, `c2b7344` |
| `/lookup` shows the first four of five passages instead of failing (M9) | `88af284` |
| Every synced document names its game; upstream SS14 rulesets are titled as such (the next sync re-reads every wiki and Guidebook page once) | merge `d277acd` |
| "Open draft file" on the Approved knowledge page | merge `39096c6` |
| Routing: gameplay questions get no developer pages and no code search; the channel's game is ranked higher and upstream rulesets lower; evidence names its source and game; a question with no evidence is told not to answer from general knowledge | `c57fc97` |
| Glossary: an entry (`glossary-<slug>`) whose alias the question names anywhere comes first; its other names lift the community's own pages, never developer pages or upstream rulesets; a term in capitals finds headings that spell it out | `bfbfed7` |
| No Contact staff button on AI replies (owner direction, 2 November); buttons already posted still work | `65b8ceb` |
| Capability manifest in the prompt (her real commands, what she cannot do, how Whitelist is earned), the owner's channel directory (dashboard, AI page), and reply checks: unlisted channels and commands, incident verdicts and promises to report, numbers no source gives | `da650cd` |
| Evaluator: turns use the same checks; `ai-eval-rejudge.mjs --replay` re-runs stored live replies through them | `3d914af` |
| No turn labels in replies, an answer for addressed silence, example kinds, faces kept by redaction, out-of-date wiki sections (H5, M5, H7) | `d176f27` |
| Storage scenario P19-RT22 expects the fixed reply to an addressed silence | `bc57644` (installed) |

**Measured** (retrieval only, no model calls), Wolfgate questions on the labelled snapshot:

| Measure | Before routing | After routing | With the 27 glossary drafts |
|---|---|---|---|
| A passage that answers it found | 30 of 42 | 34 of 42 | 40 of 42 |
| Questions returning an upstream ruleset | 12 | 6 | 3 |
| Upstream ruleset ranked first | 7 | 3 | 1 |
| Developer pages on gameplay questions | 2 | 0 | 0 |

- The routing column was re-scored after five cases' gold was extended to accept the glossary section that paraphrases a
  passage they already accepted, hence 34 rather than 33.
- The two misses have nothing to find: the GitHub source is empty while its token is refused, and nothing says how a
  member appeals a Wolfgate ban (the owner's to publish, for example as a directory channel or a knowledge document).
- Installed with `bc57644`: the knowledge sync re-reads every wiki and Guidebook page once, after which documents carry
  their game. The glossary works once the owner publishes the entries, labels or not.
- **Narrowing to know about:** a plain-language code question ("how does the cloning system work") no longer triggers code
  search. It needs a developer word, a file name or an identifier.

**Reply checks, replayed** on the 270 stored replies of the 2 November live run, without model calls
(`live-all-45df8b8-replay-da650cd.json`; list removals with `removed-sentences.mjs`):
- They removed 9 invented channels (`#wolfgate-dev`, `#📢-announcements` and others), 3 incident verdicts ("That's
  definitely RDM") and 1 wrong number ("about 250 meters" for the rule's 256). No case got worse.
- `wg-rep-verdict` still fails: its replies offer the Contact staff button, which the published character's example
  names, and skip escalation.
- Until the owner lists channels in the directory, Sophie names none.

**Glossary drafts:** `GitHub/.agent_docs/aphelion-sophie/glossary-2026-11-02/drafts`, 27 files, nothing published.
- Each file opens in the dashboard with "Open draft file"; the owner reviews and publishes each one.
- Each definition paraphrases the snapshot passages it cites. `sources.txt` holds those passages
  (`extract-sources.mjs`, `find-text.mjs`), and `build-drafts.mjs` rebuilds the files and checks them against the
  dashboard's draft reader.
- One document per term, one section per game.
- The editor has no game field, so published entries carry no game label. They don't need one to lead.
- Measure a change with `--overlay <drafts folder>` on the evaluator.

**Evaluation folder:** `GitHub/.agent_docs/aphelion-sophie/ai-eval-2026-11-02`.
- `snapshot-2026-11-02`: the production knowledge, read-only, taken on the owner's approval.
- `snapshot-2026-11-02-labelled`: the same documents with the labels the merged collectors would give them
  (`label-snapshot.mjs`).
- `cases-wolfgate.json`: 45 cases.
- Results, plus `compare-retrieval.mjs` and `analyse.mjs`.
- Retrieval mode is free. Run it after every change:
  `node scripts/ai-eval.mjs --cases <folder>/cases-wolfgate.json --snapshot <folder>/snapshot-2026-11-02-labelled --out <file> --mode retrieval`.
- Live modes need `--live --max-calls n --provider-key <file>` and an owner call budget each time.
- Reading production for a new snapshot also needs the owner's approval; the classifier blocks it otherwise.

**Harvest tool:** `GitHub/.agent_docs/aphelion-sophie/discord-harvest-2026-11-02`. It reads with GET only and refuses
tickets, member records, case exclusions, the rules channel and channels @everyone cannot see. It has never been run. It
needs the owner's channel list and an approval for each run.

**Also done (`d176f27`):**
- "Member N" labels never reach a member.
- An addressed turn that comes back silent gets the owner's wording.
- Character examples can be marked as answers from general knowledge.
- Faces such as "@_@" survive redaction (redaction v2; the Mistral profile hash changed, so re-accept the profile before
  any Go live).
- Wiki sections the wiki flags as out of date say so (12 pages and 192 sections on the snapshot; such a page stops being
  policy).
- Character proposals for the owner: `GitHub/.agent_docs/aphelion-sophie/character-proposals-2026-11-02/proposals.md`.

**Next, in order:**
1. With the owner's approval, take a fresh knowledge snapshot and re-run the retrieval evaluator on production labels
   (the re-read itself is counted and done).
2. The owner fills the channel directory, reviews the wording, publishes the glossary drafts and a revised character,
   and withdraws the Red Server Policy if it is defunct.
3. The harvest, once the owner names channels; more glossary terms come from it.
4. Context briefs and the game per channel (M6, a schema change that needs approval).
5. Go live in a channel (which re-accepts the profile), then a live trial on budget.

**Owner inputs outstanding:**
- the channel directory: which channels Sophie may name (rules, announcements, tickets, ban appeals…) and their IDs;
- the wording page entries `ai.reply.unsupported_removed`, `ai.reply.silent_addressed` and
  `ai.reply.silent_addressed_staff`, and the capability text (`modules/assistant/capabilities.js`);
- the character: replace the Contact staff example, mark the factual examples, consider the proposed ones;
- how a member appeals a Wolfgate ban: nothing in the sources says;
- harvest channels;
- review and publication of the 27 glossary drafts, and approval of each harvest document;
- leaving the upstream rulesets out entirely, or keeping them relabelled;
- withdrawing the Red Server Policy (it carries no banner, so the collector cannot tell);
- context briefs;
- approval of a fresh knowledge snapshot (a production read);
- each call budget, Go live per channel (with the profile re-acceptance) and each install.

## Radio (P58): built offline on three branches, not merged

On 2 November the owner asked for a radio. Sophie plays SoundCloud and YouTube (through yt-dlp) in a voice channel. Staff
run it, Crew make requests, and Mewn the Matriarch keeps primary control. It must not eat into the Discord rate limits the
rest of Sophie needs. Choices that day:
- a Stage channel first, `1566856309477871638` (its guild, type and Sophie's permissions there are not checked yet);
  regular voice channels later, because since 1 March 2026 they require DAVE encryption and Stage channels do not;
- Crew can request tracks and vote to skip;
- a station playlist plays when nothing is queued.

**Planned shape:**
- **Core** keeps the only bot token. It owns the voice-state request (op 4), who is in the channel (in memory, never
  stored), the queue, and who may do what.
- **A new service, `aphelion-bot-radio`,** holds no token and no database. Core hands it one voice session at a time. It
  speaks the voice gateway and UDP, and runs yt-dlp and FFmpeg at Below Normal priority.
- **Budgets:** audio goes over UDP and costs nothing from Sophie's REST or Gateway budget. Joining and leaving have their
  own small sub-budget. The panel is one message: button presses answer through the interaction response, and any other
  edit waits at least 15 seconds and runs at the lowest priority.

**Nothing ships before the owner decides** (none recorded yet; workplan P58 lists them):
- superseding the voice exclusions in the reference plan (P09, `01-REQUIREMENTS` 36 and 45, `12-IDENTITY` 101, the plan
  pack's AGENTS 22, licence test T02) and in the P53 capability manifest. Radio is not AI;
- accepting the third-party content risk: YouTube's terms forbid access outside its player and API, and yt-dlp's
  SoundCloud path is not the official API;
- scope decisions for FFmpeg on the production host (today build-time only), for yt-dlp and what its build bundles
  (Python, GPL-2.0 mutagen), and for Node as yt-dlp's JavaScript runtime;
- that the guild owner holds `radio.configure`.

Staging comes first; the Shuttle's production-first exception does not cover the radio.

| Branch | Commits | What | Tests reported in its commits |
|---|---|---|---|
| `claude/radio-p58-domain` | `d955770`, `5d2f089` | `modules/radio/`: source allowlist and canonical links, owner settings, queue limits and turns, station picks, control precedence (owner hold, then Staff lock, then Crew), epochs, vote-skip; workplan P58 | RAD-D01 to D13 (13 passed), `npm run check` |
| `claude/adoring-wiles-924b1e` (R1) | `919e710`, `5f0758c` | Core: migration 087 (`gateway_lifecycle.voice_enabled`); intent 128 only while a radio is configured, a change forcing a fresh Identify; voice dispatches advance only the cursor; Stage presence in memory; op 4 within a radio sub-budget; voice session broker (backoff 5 s to 5 min, stops after 5 failures) | RAD-G01 to G10; storage suites expect 87 migrations |
| `claude/modest-margulis-077137` (R2) | `1e4db13` to `1dc0599` (6) | `apps/radio-worker/`: voice gateway v8, UDP discovery and RTP with both rtpsize AEAD modes, Ogg Opus demuxer, hrtime pacer; a check keeps the worker away from core, case, member and AI code (T46) | RAD-V01 to V16, T46 |

**Branch status:**
- Each session ran its own tests. Nobody has run `npm test` or the storage suites on the three together.
- None is merged or pushed. Merge when the owner asks, in this order: the domain branch, then R1, then R2.
- `docs/workplan.json` will conflict: take both sides and run `node scripts/build-workplan.mjs`.
- R1 and R2 branch from `c2b7344`, 13 commits behind `main`. R1 takes migration 087, so the radio tables are 088.

**Left, in order:**
1. R3 media: yt-dlp and FFmpeg child processes, with no audio written to disk.
2. R4 migration 088 and the store. A new table must be granted to `sophie_prod_core`.
3. R5 capabilities, with a `capabilityPolicy.version` bump:
   - `radio.request` for Crew, Staff and Lead Ops;
   - `radio.operate` for Staff and Lead Ops;
   - `radio.configure` for the guild owner.
4. R6 `/radio` and the panel, in their own interaction lane.
5. R7 the dashboard page.
6. R8 the service, firewall, pinned tools, licences and `docs/radio.md`.
7. A staging run in a Stage channel, then a one-hour soak counting REST calls by route.

Later: regular voice channels through DAVE (`@snazzah/davey`, MIT, after its own licence review).

**Expect:**
- YouTube to refuse this host now and then ("Sign in to confirm you're not a bot"). Never use account cookies.
- yt-dlp to need an update every few weeks. Pin each one, try it in staging, and get it approved.

## Shuttle Activity: what is left (P41)

- **Not built:**
  - moving a run in progress in a channel into the Activity at the same step (today the Activity tells the member to
    finish in their channel);
  - the text version reachable from the rules post, sharing the same run.
- **Checks inside Discord, not yet done:**
  - links opening inside the app;
  - audio unlock, picture-in-picture, presence and screen readers;
  - phone portrait with a long username;
  - the per-platform report (P40).
- **Later-pass candidates,** recorded but not approved: auto mode, skipping pages already read, small choices that gate
  nothing.

## How to work

### Tests

Run `npm test`, `npm run check` and `npm run test:storage:fast` (isolated PostgreSQL), and record the actual counts. For
a small edit, run only the affected test files. Last full runs, at `bc57644` (2 November): 981 unit tests and 1063 storage
tests passed. One suite alone: `node scripts/test-storage.mjs --suite=<name>` (for example `ai`, `staging`,
`system-wording`, `member-records`).

### Install (production)

Run the full tests at the candidate first, and install the commit at the tip of a pushed or about-to-be-pushed `main`.

1. Make the packet folder `deployment-<sha>-production-<date>` in `GitHub/.agent_docs/aphelion-sophie`.
   - **Source-only release:** copy `build-packet.mjs` from the last source-only packet (`deployment-bc57644-…`), set its
     old and new hashes, scope wording and expected file count, and run it. It copies the scripts and reviewed inputs,
     swaps the identifiers (full hashes first, then short hashes and folder names) and writes the reviewed file list.
   - **Release with a migration:** start from `deployment-4eeca3d-…` and adapt by hand the same way, plus
     `migrate-production.mjs` and `revert-migration.mjs`. **A migration that adds a table must grant it** like
     `shuttle_activity_runs`, or core will not start. Rehearse the migration and its revert on a synthetic cluster
     (`rehearse-migration.mjs`).
2. Run `git archive --format=zip -o source-<sha>.zip <sha> -- apps contracts modules platform legal content/shuttle-activity
   package.json package-lock.json LICENSE`, then unpack it into `pinned/source` (PowerShell `Expand-Archive`).
3. Run `prepare.mjs` (read-only against production): it checks the installed baseline against Git and its manifest, the
   reviewed scope and the dependencies, and copies them into `pinned/source`. **If the release changes the Mistral profile
   hash**, `prepare.mjs` must record the change (as bc57644's does); the install then writes the new hash into both trust
   files, which the worker checks at start.
4. Run `check-shuttle-quiet.mjs` (read-only). If a Shuttle run is open with recent attention, ask the owner whether to wait.
5. Write `approval.json` quoting the owner.
6. Run `run-deployment.ps1` elevated and unsandboxed, then wait for `run.exit` (`run.log` holds the statuses):
   `Start-Process pwsh -Verb RunAs -WorkingDirectory <packet> -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',"Set-Location '<packet>'; & '.\run-deployment.ps1' *> run.log; Set-Content -LiteralPath run.exit -Value `$LASTEXITCODE"`.
7. If the public check sees 503 in the first minute, run `verify-public.mjs` again before calling it failed.
8. Afterwards: check the services and the core log since the start, record the install (verification, decision log,
   workplan, this page, the packet's README) and push.

`rollback.ps1` restores the preserved installation; `revert-migration.mjs` undoes that release's migration. Read each
packet's rollback notes: after bc57644's knowledge re-read, older releases refuse the game label on synced documents.

### Read-only production queries

Use `C:\Aphelion\Sophie\production\owner.json` inside `BEGIN READ ONLY`. Print counts and fixed fields, never member
text. The auto-mode classifier refuses a production read that the owner's request does not clearly cover ("Production
Reads"): during the bc57644 install, `prepare.mjs` and `check-shuttle-quiet.mjs` ran, but a knowledge count afterwards was
refused. Ask the owner for that read, then run it.

### The Activity

- **Copy:** edit `content/onboarding/story.md`, then run `node scripts/build-onboarding-story.mjs`.
- **Moments:** `scripts/author-shuttle-viewscreens.mjs`.
- **Scenes:** `scripts/author-shuttle-scenes.mjs`. The staging lint must stay clean.
- **Scratch tools:** `GitHub/.agent_docs/aphelion-sophie/shuttle-activity-tools/`.
- **Publishing the story:** see [publishing](shuttle-publishing.md). Its paths were written for the staging install; check
  them against the production files before publishing.

### After each milestone

Update `docs/workplan.json` and run `node scripts/build-workplan.mjs`. Then update `docs/verification.md`, the decision
log and this page.

## Gotchas

- **Bash heredocs on this host collapse backslashes**, quoted or not, and `node -e` does too. Write any code or text with
  a backslash using the Write or Edit tool. This bit three times on 30 October and again on 2 November. In a script that
  edits files, pass `String.replace` a function, not a string: `$&`, `$'` and `` $` `` in a replacement string are expanded.
- **PostgreSQL stores jsonb keys in its own order.** Compare JSON values with keys sorted (`canonicalJson` in the module),
  never as raw text.
- **Fake transports in tests skip the real payload checks.** Run rendered text through the real transport (MR-28 does) when
  wording changes.
- **Changing production capability grants** needs a `capabilityPolicy.version` bump, or every authorization fails.
- **Installs:** `SERVICE_CHILD_STILL_RUNNING` means a child process outlived the stop. Confirm none is left, then run the
  same folder again.
- **An install restarts core** and interrupts anyone in the Shuttle. Check that no run is active first
  (`check-shuttle-quiet.mjs`), and ask the owner if one is: on 2 November one was open and the owner chose to install.
- **Another session may share this checkout.** On 2 November one switched it to its own branch mid-task. Check the branch
  before every commit; to commit to `main` meanwhile, use a temporary `git worktree add <scratchpad>/main-wt main` (join
  `node_modules` with a directory junction, copy `.local/postgres-runtime.json`, delete the junction before
  `git worktree remove`).
- **The browser pane crashed the desktop app** when a new tab was created and resized. Use text dumps instead.
- **The repository ignores `dist/`.** A test checks that every vendored SDK file is tracked; keep it.
- **A published story reaches new runs only.**

## Standing rules

- No AI anywhere in the Shuttle, tickets or member records. Use synthetic data only in tests, fixtures and screenshots.
- The member's username on the Shuttle title window and their boarding pass are shown only to them, never stored or
  logged.
  - Member records deliberately store names, for search (owner decision of 30 October).
- Never print Discord or Cloudflare tokens or other secrets.
- New dependencies must be MIT unless a scope decision is recorded.
- SS13 is shared culture only; no SS13 sprite or sound is copied.
- Sophie is never depicted.
