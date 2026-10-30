# Sophie development handoff — 30 October 2026, night

Sophie provides deterministic community administration, Whitelist onboarding, private cases and website configuration.
No AI may receive ticket or onboarding session content.

Read [AGENTS.md](../AGENTS.md) first. The other records, which win where this page disagrees:
- current policy: [the owner decisions](decisions/0001-owner-policy.md);
- remaining work and release gates: [the workplan](workplan.md);
- the checks actually run: [verification](verification.md).

This page is a snapshot for the next session: what runs in production, what the member records do, what is left, and how
to work safely. Earlier snapshots are in this file's git history.

## Production now

- **Release:** **`a45ca0f`** (schema 084), installed 30 October 2026 at 22:27 UTC. Everything is pushed to `origin/main`.
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
- **AI:** switched off in production; the log says `AI_ADMISSION_SKIPPED_AI_DISABLED`. The owner's focus is elsewhere,
  so don't press for Go live after each release; it stays in the workplan.
- **Known noise in the core log** (`C:\Aphelion\Sophie\logs\core\aphelion-bot.err.log`):
  - `KNOWLEDGE_SOURCE_GITHUB_FORBIDDEN` hourly: the GitHub token's access still needs fixing;
  - `DASHBOARD_DENIED_DASHBOARD_CREDENTIAL_INVALID` after each restart: old sessions, harmless.
- **Every install, publication and production write needs the owner's recorded approval.** Approval for one step does not
  carry over to the next. The last packet, `.agent_docs/aphelion-sophie/deployment-a45ca0f-production-2026-10-30`, is
  the template for the next one.

## Member records (P56)

### What Sophie keeps

The Staff forum is `1562315014998728727` ("staff-evidence-logs"), with one post per member, kept forever. Every current
member has a post, and so do the people who have left that Sophie can name.

**Each post opens with five of Sophie's messages:**
1. **Header**, kept up to date: names and ID, account age, status, joins, last leave (date and time), Shuttle run and
   reading time, mutes, birth month and year and game accounts (from the application), earlier names, current roles.
2. **Ledger:** links to her entries.
3. **Access application:** transcribed. A newer one replaces it, and the older one is kept as an entry.
4. **Game records:** reserved for Meridian Rift and Wolfgate, waiting on SSymphony.
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
refreshes the channel map. It refuses a member list that would mean more than a few leaves at once.

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
| Migrations | `apps/core/storage/migrations/080`–`084` |
| Tests | `tests/member-records*.test.js`, `scripts/integration/member-records-suite.mjs` (`--suite=member-records`) |

### Production at handoff

Read-only check at 22:28 UTC:
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
a small edit, run only the affected test files. Last full run: 931 unit tests and 1058 storage tests passed.

### Install (production, source-only)

1. Copy the last packet folder's scripts and JSON into `deployment-<sha>-production-<date>`.
2. Run `git archive --format=zip -o source-<sha>.zip <sha> -- apps contracts modules platform legal content/shuttle-activity
   package.json package-lock.json LICENSE`, then unzip it into `pinned/source`.
3. Adapt the scripts, replacing the identifiers in order: the full commit hashes first, then the short hashes and
   folder names.
4. Set the reviewed file list and count (`git diff --name-only <installed> <sha> -- …`), the migrations added and their
   count, and `migrate-production.mjs` / `revert-migration.mjs`.
5. **A migration that adds a table must grant it** like `shuttle_activity_runs` in `migrate-production.mjs`, or core will
   not start.
6. Rehearse the migration and its revert on a synthetic cluster (`scripts/lib/postgres-test-cluster.mjs`).
7. Run `prepare.mjs` (read-only against production).
8. Write `approval.json` quoting the owner.
9. Run `run-deployment.ps1` elevated and unsandboxed (`Start-Process pwsh -Verb RunAs`, then wait for `run.exit`).
10. If the public check sees 503 in the first minute, run `verify-public.mjs` again before calling it failed.

`rollback.ps1` restores the preserved installation; `revert-migration.mjs` undoes that release's migration.

### Read-only production queries

Use `C:\Aphelion\Sophie\production\owner.json` inside `BEGIN READ ONLY`. Print counts and fixed fields, never member
text.

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
  a backslash using the Write or Edit tool. This bit three times on 30 October.
- **PostgreSQL stores jsonb keys in its own order.** Compare JSON values with keys sorted (`canonicalJson` in the module),
  never as raw text.
- **Fake transports in tests skip the real payload checks.** Run rendered text through the real transport (MR-28 does) when
  wording changes.
- **Changing production capability grants** needs a `capabilityPolicy.version` bump, or every authorization fails.
- **Installs:** `SERVICE_CHILD_STILL_RUNNING` means a child process outlived the stop. Confirm none is left, then run the
  same folder again.
- **An install restarts core** and interrupts anyone in the Shuttle. Check that no run is active first: a read-only query
  of runs with recent attention, and ask the owner.
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
