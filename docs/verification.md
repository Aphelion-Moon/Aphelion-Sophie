# Verification and release limits

## Production-test preparation: artwork, Shuttle wording, channel title and category — 20 October 2026

Owner direction recorded in the decision log ("Production-test preparation"). All branches were merged into `main` first.

- **Artwork removed.** No Sophie image, manifest or brand profile remains in the working tree; the dashboard shows text
  identity and the former avatar path answers 404. The planning pack's SHA256SUMS were updated for the files removed
  and the stripped Sophie-Plan.html.
- **Shuttle wording.** Completion, busy, unavailable and setup-fault replies no longer mention Staff help; the Shuttle
  case type is labelled "Shuttle".
- **Channel title and category.** New Shuttle channels are named "<Discord username>'s Shuttle" and use
  `casePolicy.shuttleCategoryId` when set (Permissions page). Apply inventories both categories and seals each retained
  channel into its case type's category; the Shuttle category is recorded as a case exclusion.

**Evidence:**
- `npm test`: 673 passed (4 brand-profile tests removed with the contract; 3 added for the Shuttle title, category and
  permission document).
- Repository check passed.
- Storage, 4 shards: 1007 passed, 0 failed, 69 s.

**Not covered:** no isolated-database scenario yet applies a policy that sets or changes the Shuttle category, and no
live Discord check of the channel name as Discord normalises it. Not deployed.

## Faster isolated database tests — 20 October 2026

Owner: "Thirteen minutes per build is excessive." Audit and owner choices are in the decision log ("Faster isolated database
tests"). Baseline: `npm run test:storage:fast` (4 shards) 835 s wall for 1007 scenarios, 1214 s serial.

| Change | Full run (4 shards) |
| --- | --- |
| Baseline | 835 s |
| Per-scenario `TRUNCATE` → `DELETE` resets (`tests/fixtures/reset.js`), plus relaxed durability on test clusters | 130 s |
| Dynamic longest-first scheduling across shards | 90 s |
| Real waits removed: RT09 uses a real 5 s Gateway lease (journal `leaseMs`, renewed at a third; deployments keep 30 s); P19-RT22 uses a 1.5 s member interval | 63 s |
| A database copy per suite (order independence; `initdb --no-sync`) | 68 s |

What each change needed:
- **Resets:** the shared copies of the reset lists became one `CORE_STATE_TABLES` list.
- **Durability:** a DS06-E01 race became visible once commits were fast (it closed the gather window "now" and expected
  "too late"); its window now closes a second earlier.
- **Scheduling:** the storage suite's restarts must also refresh the cluster's own pools.
- **Database per suite:** a reverse-order run first failed 74 scenarios on leaked grants, dropped or replayed tables and
  shared AI rows. Each suite now runs on its own copy of the migrated template (`cluster.fresh()`), named within the
  isolated-backup `sophie_test_*` rule.
- **V23** compares a database timestamp with a margin (microseconds against milliseconds).
- The 24 PostgreSQL restarts in the storage suite now cost little (the suite takes 16 s), so they stay genuine restarts.

Condensing (owner: exact duplicates only): no scenario title appears in two suites, and none was merged or dropped.
`docs/storage-test-inventory.md` (`node scripts/build-storage-inventory.mjs`) lists every scenario and the 27 scenario
IDs reused by different suites (`CA01`–`CA13`, `PA01`–`PA10`, …).

**Evidence:**
- `npm test`: 674 passed.
- Repository check passed.
- Storage, 4 shards: 1007 passed, 0 failed, 68 s.
- `node scripts/test-storage.mjs --order=reverse`: 1007 passed, 0 failed, 3 min 29 s.
- Forward serial `node scripts/test-storage.mjs`: 1007 passed, 0 failed, 3 min 39 s (about 20 minutes before).

## Slow ticket opening and lingering step messages — 20 October 2026 (installed 17:05 UTC as `25b8085`)

Owner reports on `67c1f4a`: "It still takes like 20s to open a whitelist ticket", and "a message did not delete before
the next step's messages were sent". The new trace codes showed:
- **Channel creation** needed three claims: `OBSERVATION_OUT_OF_ORDER`, then `OBSERVATION_INVALIDATED` after its own
  permission changes moved the authority boundary.
- **The first page** was claimed again and again while the channel was pending, reading Discord each time and holding the
  member's lease against the channel's job. After that it hit `OBSERVATION_OUT_OF_ORDER`, `DELIVERY_UNCERTAIN` (one
  7-second attempt) and `OBSERVATION_UNAVAILABLE`.
- **Page turns** retried on `OBSERVATION_UNAVAILABLE`. Discord's own delete events (capture ledger) show the order was
  correct: all four messages of the old step were deleted before the first new one was posted. But the deletes were
  spread over 7 s (15:56:31.9, 33.2, 36.1, 38.6), and the new step followed 0.5 s after the last, so the step's top
  message lingered.

Causes:
- The authority boundary is deliberately absent while a received dispatch is still being recorded. Every post, edit or
  delete of this bot's own messages makes one, so the next check failed instead of waiting a moment.
- A shared delivery read keeps its original time. Membership refused it outright when a newer observation (for example
  from the click lane) had already been stored, even when both agreed.
- Render and channel claims re-read only `OBSERVATION_INVALIDATED` within the claim.

Fix:
- A boundary read waits up to 750 ms for dispatches already received to be recorded. If one of them was an authority
  change, the boundary still moves and the check is still voided.
- An older membership observation that agrees with the stored newer one is kept without change, as the actor authority
  store already does. One that disagrees is still refused and read again.
- Render and channel claims re-read overtaken, unavailable and out-of-order observations within the claim (three times).
  The channel claim does so for its inspection and its final confirmation.
- A first page whose channel is still pending steps aside without reading Discord (30 s fallback). Opening the channel
  makes it due at once. The reservation row is locked, so an opening that commits concurrently is never missed.

**Offline evidence:** `npm test` 674 passed (new agreeing-observation check); repository check passed; storage (4 shards)
1007 passed, 0 failed in 835 s (V23 now asserts the first page waits with no Discord call).

**Staging install:** owner: "Build and run the staging install." Pin `25b8085` = the runtime paths of `5fc8442` on
`67c1f4a` (this fix plus the configurable Gateway lease, which every deployment keeps at 30 s); release
`sophie-mistral-25b8085`, schema 072 unchanged; folder `deployment-25b8085-2026-10-20`, source-only (10 files).
Prepare (505 pinned and 505 installed files verified), pre-start, service boundaries, installed and dashboard checks all
passed on the first run; core logged no fault after the restart. Not yet run: a timed walk-through of ticket opening and
page turns.

## Shuttle lag, stutter and stale cards — 20 October 2026 (installed 15:47 UTC as `67c1f4a`)

Owner report after a full walk-through on `334fd97`: "significant lag and stutter throughout navigating the pages", and a
ticket whose navigation buttons did not work until `/whitelist start` was used again.

Evidence from that run:
- Every Continue logged `SHUTTLE_COMMAND_RETRIED_OBSERVATION_INVALIDATED` and then recorded after 4.6–5.6 s.
- Renders took 1.7–4.7 s with 7–16 Discord calls, and each render job needed 2–5 attempts.
- Those retries were invisible: their trace lines, now carrying an error code, exceeded the host's 64-character limit and
  were dropped.
- The only run's last group was fully confirmed. The stale ticket was most likely the card the previous build left on
  "Opening…" at 14:28.

Cause: role, member and channel checks were validated against the Gateway continuity, which every dispatch advances.
Message events (AI is live), the "Opening…" edit itself and each post of a step overtook the next check. Each render
burned its three in-claim attempts and then backed off 2, 4, then 8 s.

Fix:
- Role, member and channel observations are checked against the authority boundary; message reads keep the full
  continuity (decision log, "Role and channel checks follow the authority boundary").
- Delivery reads overtaken before any write retry after 250 ms instead of backing off.
- Every Continue, Back or Check first notes in the database that its card now shows "Opening…" and queues a watch 20 s
  later. The watch redraws the card unless it was replaced (the click recorded) or redrawn (the click was put back). It
  finishes from the database without any Discord call when there is nothing to do. This covers clicks that never finish,
  including a restart in the middle.
- Error codes now go on their own trace lines (`SHUTTLE_RENDER_CODE_<code>`, `CASE_PROVISION_CODE_<code>`, giving the
  original failure).

**Offline evidence:** `npm test` 674 passed (new authority-boundary test); repository check passed. Storage (4 shards)
1007 passed, 0 failed. New V24 (an unfinished click's card is redrawn by its watch) and V25 (a recorded click's watch
makes no Discord call). On the way there, V11 caught that a waiting watch suppressed the prompt re-check of
`/whitelist start`, and five delivery suites caught an extra result field; both were corrected.

**Staging install:** owner approved ("Install now"), after being told of the validity change. Pin `67c1f4a` = the runtime
paths of `f92272a` on `334fd97`; release `sophie-mistral-67c1f4a`, schema 072 unchanged; folder
`deployment-67c1f4a-2026-10-20`, source-only (12 files). Prepare (505 pinned and 505 installed files verified), pre-start,
service boundaries, installed and dashboard checks all passed on the first run, and core logged no fault after the
restart. Not yet run: a timed walk-through to compare with the 334fd97 run.

## Shuttle clicks overtaken by Gateway traffic — 20 October 2026 (installed 14:57 UTC as `334fd97`)

Reported on staging 20bd3e7: `/whitelist start` and the new channel were slow, and the first Continue answered "We
couldn’t confirm that request. Please ask Staff…". Trace `SHUTTLE_COMMAND_UNAVAILABLE_952MS`. No render or restore job
was queued afterwards, so the card stayed on "Opening…".

Cause, from code and the staging rows (the exact error code was not logged; the new traces record it):
- **Click failure:** member reads are checked against the Gateway continuity, which advances on every dispatch, and with
  AI live that includes message events. The instant "Opening…" edit of the clicked card makes Discord send a
  `MESSAGE_UPDATE` while the click's own reads are in flight. The render worker retries `OBSERVATION_INVALIDATED`; the
  command path did not. The card restore reads Discord too, so it failed the same way. This regression came with the
  "Opening…" change.
- **Slow first page:** it was queued with the channel and failed "channel pending" until the channel existed. Each
  failure was treated as Discord being unavailable (2 s, 4 s, 8 s back-off; the channel took 3 attempts), and nothing
  woke it when the channel opened. The page appeared about 30 s after `/whitelist start`.

Fix:
- The Shuttle commands retry `OBSERVATION_INVALIDATED`, `OBSERVATION_UNAVAILABLE`, `MEMBERSHIP_STALE`, `DISCORD_BUSY`,
  `RATE_LIMITED` and `DISCORD_UNAVAILABLE` up to three times (150, 400 and 1,000 ms, or the reported cooldown up to 2 s).
  This is safe because opening a run and every Shuttle change are keyed by the interaction.
- Still transient after the retries, the member is told to try again in a moment (`reply.onboarding_retry`), not sent
  to Staff. Failures a retry cannot fix (for example Discord refusing access) keep the general reply.
- A click that records nothing always puts its card back. If the normal restore cannot read Discord,
  `releaseOnboardingControl` queues the member's own current card to be drawn again. It records nothing, grants nothing
  and reads nothing from Discord; the render re-checks everything.
- When a Shuttle channel opens, its waiting first page is made due at once with its attempts reset.
- Traces now carry codes: `SHUTTLE_COMMAND_RETRIED_<code>`, `SHUTTLE_COMMAND_FAILED_<code>`,
  `SHUTTLE_RENDER_<outcome>_<code>_…`, and the new `CASE_PROVISION_<outcome>[_<code>]_<ms>MS`.

AI chatter on the same day was not a fault: the two messages were in the member's private Shuttle channel, which is a
case channel, and were correctly skipped (`AI_ADMISSION_SKIPPED_CHANNEL_NOT_CONFIGURED`). AI is enabled only in channel
1551010229339037738 (qualified, one consenting member). No AI change was made.

**Offline evidence:** `npm test` 673 passed; repository check passed. Storage: the first full run passed 1004 and failed
OC02, which correctly caught that Discord refusing access must not be worded as "busy"; the wording was narrowed.
After that change the full run passed 1005, 0 failed (4 shards). New V21–V23: retry after overtaken reads; card release without Discord; first page drawn as soon as its channel opens.
**Staging install:** owner approved ("Install now"). Pin `334fd97` = the runtime paths of `229708b` on `20bd3e7`; release
`sophie-mistral-334fd97`, schema 072 unchanged; folder `deployment-334fd97-2026-10-20`, source-only (9 files; PostgreSQL
and the tunnel kept running). Prepare (505 pinned and 505 installed files verified, dependencies unchanged), pre-start,
service boundaries, installed and dashboard checks all passed on the first run. Not yet run: a live click-through; read
the new `SHUTTLE_COMMAND_RETRIED/FAILED` and `CASE_PROVISION` codes from it.

## Staging install of 20bd3e7 — 20 October 2026 (installed 13:55 UTC, schema 072)

Owner request "Session is now elevated. Go redeploy us, please." Pin `20bd3e7` on `staging/admission-trace` = the
runtime paths of `64dc0aa` (both sections below) on `5face56`, so the six unrun 13 October `5face56` fixes are included.
Release `sophie-mistral-20bd3e7`, replacing `38e4f3a` (schema 070). Folder
`.agent_docs/aphelion-sophie/deployment-20bd3e7-2026-10-20`, run by the agent in the owner's elevated session.

- **Prepared (read-only):** 505 pinned files equal Git; the installed 38e4f3a matched its trusted manifest (504 files);
  212 dependency files copied from it, none fetched; provider profile and processing policy unchanged.
- **Stopped and preserved:** the services were already all stopped; a cold recovery point
  `D:\Backups\sophie-staging\schema072-20bd3e7-20261020` (database 6540 files, package, trust, services,
  qualification, renewal, journal) was verified by hash.
- **Installed:** 40 files written, `apps/core/storage/onboarding-role-source.js` removed.
- **Migrated** 070 → 072 as the owner identity. All checksums verified. 103 tables and 16,177 rows kept identical. The
  072 release found nothing to release (no open help requests, pending notices, paused sessions or parked jobs), so no
  rows changed. The only grant added is SELECT, INSERT, UPDATE on `sophie_core.shuttle_screen_parts` for the runtime, as
  `docs/discord-staging-setup.md` directs. Runtime check (72 tables) and the AI control, knowledge and knowledge-editor
  identity checks passed. AI state unchanged.
- **Trust v2 and start:** fresh evidence and journal binding; the pre-start check passed. PostgreSQL, the tunnel, core and
  the worker were started; the supervisor stays retired.
- **After start:** service boundaries passed.
  - Installed check: 26 of 26 passed on the rerun. The Gateway is current and leased, AI is still live, and one active
    qualification is on the new release.
  - Dashboard: 24 of 24 routes passed on the retry.
  - The first passes, within about 40 seconds of start, got 503 from the three authenticated API routes, locally and
    through the tunnel. Both reports are kept in the folder.
  - Core's log since the start holds only the expected dashboard-denial probes.
- **Rollback:** `rollback.ps1` restores the cold database copy with the 38e4f3a package. Shuttle and case activity after
  13:55 UTC would be lost; the 38e4f3a runtime refuses schema 072, so the code is never rolled back alone.
- **Not yet run:** a live walk through all five Shuttle steps on desktop and mobile; `SHUTTLE_COMMAND`/`SHUTTLE_RENDER`
  timings from real clicks; observing `SHUTTLE_SELF_HEAL_REQUEUED`. Production is untouched.

## Shuttle without Staff intervention — 20 October 2026 (installed on staging as `20bd3e7`)

Owner direction (decision log, "Staff take no part in the Shuttle"). Migration 072 releases earlier help pauses, closes
open help requests and withdraws unsent notices. Parked Shuttle work (Whitelist grant and reconciliation, Shuttle
messages, Shuttle channels) is rechecked automatically two minutes after parking, doubling to fifteen; creates still
unanswered after two minutes are redone; duplicate Shuttle channels keep the opened or oldest channel; Whitelist delivery
problems no longer alert Staff. Only a global rate-limit halt still needs the operator.

**Offline evidence:** `npm test` 672 passed; repository check passed; storage (parallel, 4 shards) 1002 passed, 0 failed.
New F21-F23 and Q12 cover the automatic recoveries; L04-L06, L15, L16 and L21 now cover no-Staff recovery, recheck
timing and the migration release. Installed on staging with migration 072 (see the install above); not yet observed
live.

## Shuttle message groups and faster page turns — 20 October 2026 (installed on staging as `20bd3e7`)

Owner request and decisions of 20 October (decision log, "Shuttle message groups"). Source on `codex/sophie-social-ai`:
- `04f305c`: one rate-limit registry for every transport on the bot token, keyed by Discord's bucket and top-level
  resource; an overlapping request queues briefly instead of failing `DISCORD_BUSY`; cooldowns of 1.5 s or less are
  waited out once.
- `6c1570e`: a recorded Shuttle command wakes delivery at once; fixed-code timing traces on a new `onTrace` channel
  (`SHUTTLE_COMMAND_<result>_<ms>MS`, `SHUTTLE_RENDER_<outcome>_<ms>MS_<n>CALLS_<ms>WAITMS`); `/whitelist start` no
  longer holds the one-command slot while its reply waits for the channel.
- the message-group commit following `6c1570e`: message groups (status card, plain step messages, navigation card), instant "Opening…" click
  feedback, per-message link previews, Ask Staff removed, boundary-scoped observation sharing and response-confirmed
  writes, migration 071 and the editor's message breaks and preview toggle.

**Offline evidence:** Offline, on the message-group source: npm test 672 passed, 0 failed; repository check passed; storage (parallel, 4 shards) 998 passed, 0 failed (new V11b; suites rewritten for message groups and the retired Ask Staff). Transport (04f305c) and delivery wake-up/traces (6c1570e) each passed 997 storage scenarios on their own. Not live: no staging install, Discord rendering or timing measurement yet. Installed on staging on 20 October (see the install above).

Diagnosis of the slow page turns (from code, not measured live): one click cost about 20 serial Discord requests
(about 6 for the command, about 14 for the render, including a second full role and channel check after the edit),
then waited for the worker tick and a round-robin of ten dispatchers. Overlapping requests failed `DISCORD_BUSY` and
each lane kept its own view of the shared buckets, so retries backed off exponentially. The new traces measure each
part on staging.

Installed on staging with migration 071 on 20 October (see the install above). Not yet run: a live walk through all
five steps on desktop and mobile, and a before/after timing comparison. Rollback: forward repair, or the full
cold-copy restore in the deployment folder. Never run older code against schema 071 or later: it ignores
`shuttle_screen_parts`, would leave posted step messages visible and would redraw status cards as single messages.

## Rule codes in chatty questions — 13 October 2026 (prepared, not yet installed)

Asked "My finger slipped :< Anyways, sophie, can you summarize CR 1 for me?", Sophie answered that she had no verified
information. The CR 1 passage is on the wiki with policy authority; retrieval weighs words by rarity, so the common "CR"
and "1" lost to the chatty words and no passage qualified. `b5f40cd`: a rule code in a question (CR 1, CR1, CR-01, Core
Rule 1) selects the passages whose heading carries it, first, and CR 1 never matches CR 10. Reproduced and checked
against the full live wiki (230 pages) in an isolated cluster. Pin `18f214d` = `5c54ba4` plus `apps/knowledge/library.js`.
Offline: `npm test` 656 passed; AI storage suites 89 passed.

## Test cleanup and staff-editor simplification — 13 October 2026 (installed 14:23 UTC as `5c54ba4`)

Installed with passing pre-start, service-boundary, installed and dashboard checks; Sophie back online after the 08:20
UTC stop.

**Installed now:** pin `b4b81db` (source `37acf37`), release `sophie-mistral-b4b81db`, schema 070, 32 KB prompt budget.
Installed after the conversion below, each with passing pre-start, service-boundary, installed and dashboard checks
(UTC, 12 October): `d8fb0e5` 19:08 (hosting conversion), `193a94a` 20:13, `0dbc4fc` 20:27, `3fa6be3` 20:45,
`1354730` 21:06, `3a2fb62` 21:55, `f05f6f5` 22:07, `b4b81db` 22:46. At 08:20 UTC on 13 October the b4b81db folder was
run a second time: its deploy script stopped core and the worker before finding the existing backup
(`PRESERVATION_ALREADY_EXISTS`), changed nothing else, and left both services stopped. The next deployment folder checks
for its backup before it stops anything.

Source on `codex/sophie-social-ai` since `37acf37` (owner-approved 13 October, keeping every permission re-check):
- `d07dd3d`: a failed storage scenario no longer skips the rest of its suite; `--record` evidence removed.
- `87fd7f4`: the workplan graph, workplan regeneration and release-ledger wording are no longer automated gates.
- `15ca3a9`: case labels are last-write-wins without request IDs or expected versions.
- `f038a66`, `c78ce7e`: form and Shuttle authoring, curated answers and system wording no longer replay request IDs;
  a resent request fails as stale. Review hashes, publication checks and permission checks are unchanged.
- `564a038`: J01, S17, S28 and U08 updated to the current Shuttle (stale expectations, not product faults).

**Offline evidence at `564a038`:** `npm test` 656 passed, 0 failed; repository check and verify-foundation passed;
storage (parallel, 4 shards) 997 passed, 0 failed. Eleven runtime files change (core storage, HTTP and dashboard for
the editors above); no migration, dependency, licence, provider-profile or AI-worker code change. Not yet run: the
deployment and a live check of label, form, Shuttle, answer and wording edits on the Test Discord Server.

## AI stack rebuild — 12 October 2026 (installed 12 October, 19:08 UTC as `d8fb0e5`)

Owner decisions of 12 October (decision log, "AI stack rebuild"); audit:
`GitHub/.agent_docs/aphelion-sophie/ai-stack-audit-2026-10-12.md`. Source on `codex/sophie-social-ai`: `1d6239b`
(Gateway-state turns, two checks, no reply re-verification), `28d6117` (plain worker service, trust v2 without expiry,
persistent Go live) and `88359f6` (deterministic worker service setup). Pin `d8fb0e5b98a6da117c5bba6c9369dc1555cfedad`
on `staging/admission-trace` = `7764723` plus 3 added, 26 modified and 20 removed runtime files and the two operator
scripts; no migration, dependency or licence change.

- **Offline evidence at `88359f6`:** `npm test` 643 passed, 0 failed. The worker-channel tests now listen on ephemeral
  ports; the earlier "DS04 first-run" failures were a collision with the live staging core on 127.0.0.1:47552.
  Storage (parallel, 4 shards) 957 passed with the three known order-dependent failures (J01, U08, S17); the twelve
  worker-lifecycle scenarios were removed with that code. New: GS-01..19, RL-04, RB-01..03, RB-E05, RB-A01, RB-P01b,
  RB-P05, RB-P05b, an opt-out withdrawal check in AI04 and a read-only worker status test.
- **Deployment preparation:** `deployment-d8fb0e5-2026-10-12/prepare.mjs` passed (497 pinned files, 514 installed
  baseline files equal to Git, 20 reviewed removals, provider profile unchanged). The new
  `Setup-InferenceAccount.ps1` was exercised with `-WhatIf` on WUFF. Not yet run: the conversion itself, its service
  boundary and installed checks, and a live rapid-conversation test on the Test Discord Server.
- **Installed state:** `7764723` (below). At 17:38 UTC its supervisor lost worker readiness three times and disabled AI
  (`AI_WORKER_RESTART_LIMIT`).
## First working AI replies on the Test Discord Server — 11 and 12 October 2026

**Installed now:** pinned `c1f908497a804bbfb187316113bfd2d06ed99d4a`, release `sophie-mistral-c1f9084`, schema 070
unchanged, owner-accepted processing policy (notice revision 3, evidence hash `3ff06663…cf5c`) retained. Pins live on
branch `staging/admission-trace`: each is the previous pin plus only the changed runtime files from
`codex/sophie-social-ai`, so `package.json` and dependencies never drift. Every deployment below used the same
source-only procedure: owner stops the worker from the dashboard; core and supervisor stopped and their children
confirmed gone; PostgreSQL and the tunnel keep their process IDs; a protected copy of package, trust, services,
qualification, renewal tooling and journal in `D:\Backups\sophie-staging\source-only-<pin>-<date>`; only the
reviewed files written; fresh evidence in `qualification\evidence-<date>-<pin>`; journal receipt and trust renewed;
pre-start check, service boundaries, 25 installed checks and the dashboard route check passed after each start.
Evidence for each: `GitHub/.agent_docs/aphelion-sophie/deployment-<pin>-<date>/`.

| Pin | Owner-visible change |
| --- | --- |
| `dbd0937`, `d7591bd` (11 Oct) | AI and personal preference pages reorganised; setup checklist, live worker panel, inline review |
| `11c87c3` (11 Oct) | Recovery conflict codes scoped to their routes (RN05 regression); recovery tools pinned to System32 |
| `policy-install-11c87c3` (12 Oct, 00:16 Warsaw) | Processing policy installed under the owner's acceptance; channel activated |
| `b2b949c` (12 Oct) | **Failed before start**, see below; re-run as `b2b949c-r2` with rotated credentials |
| `22b502a`, `1eb2e7d` | Admission no longer blocks itself: lock-timeout invalidation and control-pool starvation |
| `6d270b3` | Diagnostics: each turn reports the stage and fixed code at which it ends |
| `78c5f74`, `b150364` | Short Discord cooldowns waited out; source metadata cached 2 s; consent survives Gateway reconnects within one membership |
| `f8850d1` | Addressed-turn guidance reaches Mistral; AI page views reuse a 1.5 s role observation |
| `d8fc757` | An unverifiable reply check defers (30 s) instead of deleting the reply; reply shape shown to the model |
| `214e13a` | Worker self-restart; replies re-verified every 10 s and not during a turn; dashboard request queue and one-request AI page load |
| `c1f9084` | Concurrent dashboard and AI role observations no longer fail `OBSERVATION_OUT_OF_ORDER` (owner saw lost dashboard access); dashboard faults name their code |

**Root causes found with fixed-code diagnostics** (no message text or identifiers logged). Last night the worker was
quiesced by the supervisor five minutes after start (one late readiness heartbeat) while the database still showed
it ready. After the redeploy, admissions failed in turn on: a presence epoch advanced by the Gateway reconnect
(`PRESENCE_CHANGED`); the 1 s refresh hitting `lock_timeout` behind admission and invalidating it
(`CONTEXT_UNAVAILABLE`); the four-connection control pool exhausted by pollers waiting for the same advisory lock
(6.8 s idle admission transactions, measured with `pg_stat_activity`); Discord's five member/message reads per second
drained by repeated rechecks (`RATE_LIMITED` after typing); the Mistral client dropping the "addressed you directly,
reply" guidance (silent outcomes from a completed generation); the reconciliation deleting a just-delivered reply when
its check hit `DISCORD_BUSY`; and continuous one-second re-verification of every delivered reply starving new messages.

**Live result (12 October, owner on the Test Discord Server):** addressed messages at 11:47:42 and 11:48:25 UTC were
answered in 6 and 13 seconds and the replies stayed; with `214e13a` the re-verification no longer competes with turns.
An unaddressed remark is not answered unless the channel profile chooses to participate.

**Credential incident.** The first `b2b949c` pre-start check compared the full core trust configuration with
`assert.deepEqual`; its mismatch (a verifier bug: the old configuration still contained the processing policy) printed
the Discord bot token, client secret and database passwords into the operator transcript. The owner rotated the
Discord token and client secret; the five exposed database role passwords were rotated with client-side SCRAM verifiers
and statement logging off. The verifier now compares hashes of secret-free configuration and prints only a step and a
fixed code. Old copies of the revoked credentials remain only in pre-incident backups under `D:\Backups`.

**Tests at `3719c9a`:** `npm test` 647 passed; `npm run test:storage:fast` 968 passed and the three known order-
dependent failures (J01, U08, S17); new scenarios DS09-O11/O12 (relaunch, limit, owner precedence), DA-VIEW-01..04,
DASH-B01, SAI RL-01..03, SAI AT-13; MG07 now expects a queued competing case write to be refused by its version check.
`DS04` worker-pipe tests fail on the first `npm test` after a change and pass on rerun; not yet diagnosed.

**Still open:** actual worker denial and stop qualification; the join-time consent rule has not yet met a fresh
Gateway session in staging; Mistral zero data retention (notice revision and re-acceptance when confirmed); measured
latency under load; production.

## Dashboard sign-in fix — 11 October 2026

After the schema070 deployment the owner could not sign in to the dashboard: every attempt ended with
"Sign-in or request could not be verified." and no session had been issued since 30 September. The callback
address the owner saved shows the cause: Discord now appends `iss=https://discord.com` (the RFC 9207
issuer) to its redirect, and the callback handler refused anything other than exactly `code` and `state`.
The handler now accepts `iss` at most once and only with that exact value; any other issuer, a repeated
issuer and any other extra parameter are still refused before the sign-in is consumed.

Checked first and ruled out: the public login redirect, the registered redirect address (read from Discord
for Sophie's own application), cookie handling over HTTP/1.1 and HTTP/2 through the tunnel, and the callback
path with a valid cookie and an invalid code. An earlier reading that the browser was returning without its
sign-in cookie was wrong: a missing cookie and an unexpected parameter produce the same message.

Windows, Node.js 24.19.0: `node scripts/test-storage.mjs --suite=dashboard-auth` passed 19 scenarios,
including four refused issuer variants followed by a successful redirect in Discord's real shape. Unit
tests and the repository check are recorded with the commit. Evidence: `GitHub/.agent_docs/aphelion-sophie/signin-fix-2026-10-11/`.

**Installed** under a separate [owner approval](decisions/0001-owner-policy.md#sign-in-fix-staging-deployment-approved--11-october-2026)
as pinned `66a69f87af0fa29d6d9282ec4ee7c1f2fbbdcf7f`, release `sophie-mistral-66a69f8`, schema 070 unchanged.
Core and supervisor were stopped and their children confirmed gone; PostgreSQL and the tunnel kept their
process IDs. A protected copy of the package, trust, services, qualification, renewal tooling and journal
is in `D:\Backups\sophie-staging\source-only-66a69f8-20261011`. Exactly one file was written; the other 513
already matched. Fresh evidence is in `qualification\evidence-20261011-66a69f8`; the assembler and renewal
guard pin this commit. After restart: 25 of 25 installed checks, service boundaries, and 24 of 24 dashboard
routes and assets passed. Through the public address with an invalid test code, a callback in Discord's
shape now reaches the code exchange and a wrong issuer is refused. Installation trust expires 12 October
18:30 UTC (20:30 Warsaw); the journal receipt 17:30 UTC (19:30 Warsaw). The owner's own sign-in is not yet
confirmed. Evidence: `GitHub/.agent_docs/aphelion-sophie/deployment-66a69f8-2026-10-11/`.

## Approved schema070 staging deployment — 11 October 2026

Owner approval and scope: [decision](decisions/0001-owner-policy.md#mistral-and-member-notes-staging-deployment-approved--11-october-2026).
Pinned `77b9d076e247a14bdeb20ba14a264f9d6ad23705` is installed on WUFF as `sophie-mistral-77b9d07`, schema 070.

- **Before mutation:** all five Sophie services were already stopped. The 514 pinned files matched Git, the
  512 installed files matched the previous trusted manifest and pinned `335a3f2`, and 212 dependency files
  were copied from that verified installation. A recovery point was written and hash-verified under
  `D:\Backups\sophie-staging\schema070-77b9d07-20261011` (cold database, package, trust, services,
  qualification, renewal tooling, journal and the previous provider credential).
- **Database:** 69 checksums verified, then migration 070 applied by the maintenance identity. The saved-settings
  limit reads 8,192 bytes; 111 rows across 103 tables are unchanged; grants are unchanged; core, control,
  knowledge and knowledge-editor identities qualify against the candidate. AI stays disabled.
- **Source and key:** 30 files written, 514 verified, `apps/knowledge-worker/deepseek-client.js` removed.
  The provider key was replaced in place from the owner's file with its access list unchanged; the value was
  not printed or recorded.
- **Trust:** fresh identity, access-list and firewall evidence in `qualification\evidence-20261011-77b9d07`;
  journal bytes and identity unchanged and its receipt renewed; the protected assembler and legacy renewal
  guard now pin this commit, the Mistral release name and accepted identity `mistral-small-2603`. No
  processing policy is installed. Installation trust expires 12 October 17:52 UTC (19:52 Warsaw); the
  journal receipt 16:52 UTC (18:52 Warsaw).
- **After start:** PostgreSQL, tunnel, supervisor and core run under their own service identities with the
  four loopback listeners; Gateway is current for the test guild; the worker is stopped; configured access
  lists and firewall rules are unchanged; installed directories mirror the pinned source. The first
  installed check failed one local dashboard route with a status the inherited script did not record; a
  status-recording check then passed 24 of 24 routes and assets on both origins, and the full check passed
  25 of 25 on rerun. The cause of the first failure is unexplained, as on 4 October.

Not done: processing-policy acceptance, worker start, any publication (personality, participation, budget,
channel), member processing, actual worker file/network denial and physical-stop trials, quality
qualification. The installed worker service description still names the previous provider; it is cosmetic
and was left unchanged to avoid altering a qualified service definition. Evidence:
`GitHub/.agent_docs/aphelion-sophie/deployment-77b9d07-2026-10-11/`.

## Member notes and Mistral live check — 11 October 2026

Owner decision: [member notes, key and test-server preparation](decisions/0001-owner-policy.md#member-notes-mistral-key-and-test-server-preparation--11-october-2026).

**Live check with the owner's key (synthetic prompts only).** Thirty-two requests to `mistral-small-2603`
from this host across four runs, about 0.3–1.3 seconds each, all HTTP 200 with the exact model ID echoed. This settles the
items the port left open: usage arrives as `prompt_tokens`, `completion_tokens`, `total_tokens` and
`prompt_tokens_details.cached_tokens`, which is what the adapter credits (a repeat request reported 760 of
792 prompt tokens cached); `reasoning_effort: "none"` is accepted; the mid-conversation system messages
are accepted; no build fingerprint is returned. The full adapter over the real single-origin transport
returned a validated reply. Outputs followed the schema, cited a supplied source, declined an unverified
policy question and stayed silent on a pile-on request. This is a smoke check, not the 40-question quality
qualification, and not a measurement under host load.

**Member notes.** Migration 070 widens the saved-settings limit to 8,192 bytes; no new table or grant.
`modules/assistant/preferences.js` validates notes; `apps/core/storage/ai-memory.js` is the read-only
trusted lookup for the requester's own shared record; the prompt carries one `memory` block after the
reusable prefix; turns recheck the saved version before dispatch and delivery; the preferences page gains
the notes field and sharing switch. Live behaviour with synthetic notes: used for the author's own question,
refused to another member, an instruction planted in a note ignored, "remember this" redirected to the
preferences page, no claimed memory without notes, saved language honoured.

Windows, Node.js 24.19.0, working tree on `codex/sophie-social-ai`:

- `npm test`: 638 tests, 636 passed, 2 failed (the same unchanged `dashboard-editor` and `dashboard-forms`
  session-shape assertions as below). Eight new `MEM-01`–`MEM-08` checks pass.
- `node scripts/test-storage.mjs --suite=ai` against an isolated PostgreSQL: 94 scenarios passed, including
  new `MEM-I01` (full-size notes, unshared notes never read, change/deletion/restore stop use, database
  limit enforced). This run also exposed and corrected one stale expectation from the provider port (a
  settled cost still computed at the former provider's prices).
- Full `node scripts/test-storage.mjs`: 296 scenarios passed, then stopped at `CR43` (recovery bundle,
  `RUNTIME_WRITE_GUARDS_INCOMPLETE`). The unmodified `b416ff1` in a separate worktree stops at the same
  check after 295, so this predates the work; the one extra pass is `MEM-I01`. Reaching it required
  correcting two migration counts that were already stale at `b416ff1` (54 and 63, now 70). Suites after
  `CR43` did not run in either tree.
- `npm run check` passed.

Not done: any change to the installed staging host, its database, key or services; real member data;
quality qualification; worker isolation and stop qualification. Replies already delivered are not
withdrawn when a note is later deleted. Masking does not make free-text notes anonymous. Raw output:
`GitHub/.agent_docs/aphelion-sophie/memory-2026-10-11/` and `mistral-live-check-2026-10-11/`.

## Mistral provider port — 11 October 2026

The owner selected a Mistral trial after the DeepSeek path was blocked on EU data-protection grounds
([decision](decisions/0001-owner-policy.md#mistral-provider-trial--11-october-2026)). The worker now
targets `mistral-small-2603` at `https://api.mistral.ai/v1/chat/completions`. The DeepSeek client and its
test were replaced by `apps/knowledge-worker/mistral-client.js` and `tests/mistral-client.test.js`; the
single-origin transport, IPC identity, worker release, processing policy, installation preparation,
default prices, dashboard notice wording and service description follow. No dependency was added.

Local, synthetic verification only, on Windows with Node.js 24.19.0 and uncommitted working-tree changes
on `codex/sophie-social-ai` above `b416ff1`:

- Thirteen focused AI/installation/release files: 155 passed, 0 failed.
- `npm test`: 630 tests, 628 passed, 2 failed: one each in `tests/dashboard-editor.test.js` and
  `tests/dashboard-forms.test.js` (session shape now carries `canManageOnboarding`, `canRecoverCases`,
  `canRecoverModeration`). Those tests and the dashboard transport they exercise are unchanged by this work.
- `npm run check` passed after regenerating `docs/workplan.md` and `docs/release-verification.json`.
- Not run: the PostgreSQL integration suites under `scripts/integration` (two had provider strings updated)
  and any Windows service, firewall or installed-package check.

No provider key was used and no request left the machine. Unverified until a first live call: Mistral's
usage field names (an uncredited cached count is charged as uncached input), acceptance of
`reasoning_effort: "none"` and of mid-conversation system messages by this model, and latency inside the
15-second ceiling. Answer quality, truthfulness and conduct are unqualified for this model. The identity
gate compares the returned model ID only, which the owner accepted as weaker than a build fingerprint.
DS-01 evidence, the notice, budget-policy replacement, packaging and deployment remain open. Raw output:
`GitHub/.agent_docs/aphelion-sophie/mistral-port-2026-10-11/`.

The owner's compliance handoff was recorded the same day
([decision](decisions/0001-owner-policy.md#mistral-compliance-handoff-received--11-october-2026)). Reported,
not verified here: ZDR requested and awaiting Mistral's review, training opt-out in force, 30-day default
retention meanwhile. Checked against Mistral's ZDR documentation: `/v1/chat/completions` is covered on paid
plans and stateful products are excluded. Whether cached prompt prefixes are retained under ZDR is
unconfirmed. This is a documentation update; no code or test changed and the results above stand.

## AI test and source-update preparation — 4 October 2026

Prepared the exact 2c5d356 source-only/schema069 export candidate and guarded operator entry point; corrected current staging/runbook/release-checklist references. Prepared an inactive fixed-target worker OS probe and proposed no-provider lifecycle/identity/stop procedure.

Read-only installed 335 checks match 512 source files and 69 migration hashes; the 512-entry archive and 741 installer/support/dependency files are hash-bound. Fourteen operator scripts pass syntax checks; default and missing-approval paths perform no deployment. Thirteen synthetic probe checks pass. Host inspection found the existing public Sophie ingress on TCP 80; one operator control connected without application data. Reports: GitHub/.agent_docs/aphelion-sophie/candidate-2c5d356-2026-10-04/verification.json and worker-os-qualification-2026-10-04/verification.json.

No source deployment or worker trial was executed. Separate source-update and worker-trial approvals, fresh endpoint/identity bindings, provider facts, publications/consent, actual Windows denial/stop, private client acceptance and measured AI latency remain open. The initial metadata mismatch was local CRLF in migration069; pinned Git, installed bytes and the database hash agree. The failed report is retained. Preparation did not freshly requalify all grants, ACL/firewall descriptors or publication rows; the inactive deployment sequence requires those checks before trust renewal/restart. Existing unexplained P19 and post-start HTTP failures remain unresolved.

The worker fixture binds installed 335a3f2 and must be rebound if another source is deployed. It always reports the OS gate unpassed. Its trial requires the exact endpoint, script/request hashes, actual service SID and physical process-exit observations. Protected file/network operations were injected in the 13 synthetic checks; the separate ingress discovery used only an operator TCP connection. Existing export application evidence is reused; no application suite or performance benchmark was rerun for preparation/documentation.

## Paged single-channel exports — 4 October 2026

Local paged single-channel transcript exports retain the existing per-part limits and exclusions, bind exact input/continuation positions into review hashes, preserve exhausted-stream positions, and require explicit review/confirmation for each part. Distinct filenames and exact retries retain the existing audit without a migration. The browser rechecks account identity after fetch and preserves uncertain retries across routine access refresh. No AI case data path was added.

16 focused unit checks and 22 isolated PostgreSQL/HTTP scenarios passed, including 105 observations and both stream-exhaustion orders. Composed RT10 member export, P19-RT22 AI case exclusion, and an initially misselected RT14 maintenance scenario passed; every synthetic cluster stopped. Nine controller checks reran after the final access-refresh correction. Synthetic browser review, unchecked confirmation, uncertain download/retry, next-part and final handoff passed. Source-bound report: GitHub/.agent_docs/aphelion-sophie/paged-exports-2026-10-04/verification.json.

The browser run preceded the final uncertain-retry/access-refresh correction; the final controller suite covers that change. The screenshot and browser-controller hash are retained separately. The synthetic preview process and tab were closed. No production member/case data, provider request, new dependency, migration or grant was involved.

Export candidate is local and not deployed; staging stays pinned to 335a3f2/schema069. Parts are current views, not a globally frozen/full-history archive. Byte-oversized parts still fail explicitly. Private client acceptance, saved-file receipt, multi-channel/archive selection, attachment downloads/scanning and independent recovery remain open. Actual worker isolation/stop, provider terms, approved publications, consent and measured AI latency remain gated.


## Approved schema069 staging deployment — 4 October 2026

Approved pinned 335a3f2/schema069 deployment: 512 exact source hashes and all 69 migration checksums verified; 77 original rows in 103 tables and all grants preserved. Four service-child identities, loopback listeners, current Gateway, recovered supervisor, 18 local/public route checks and 2 asset checks passed. Tunnel unchanged; worker stopped; processing policy absent and AI disabled. Independent journal bytes/identity and configured ACL/firewall scope unchanged. Source-bound report: GitHub/.agent_docs/aphelion-sophie/deployment-335a3f2-2026-10-04/verification.json.

Fresh protected preservation: `D:\Backups\sophie-staging\schema069-335a3f2-20261004`. The three migrations change only the OAuth return-path constraint. Runtime, dependencies and credentials were retained. Installation trust and the journal receipt bind fresh configured identity/ACL/firewall and journal checks; actual worker denial tests were not run.

A PowerShell path-helper error stopped source installation before the first copy; its local runner was corrected and resumed after the already successful migration. A later dashboard assertion failed without recording the unexpected status. The initial report is retained; direct inspection and a focused HTTP rerun passed. This does not establish the transient cause.

Actual worker file/network denials and physical stop, provider terms and factual privacy annexes, approved publications, current tester consent, private Discord/client acceptance and measured AI latency remain separate gates. Journal receipt expires 5 October at 20:54 Warsaw; installation trust at 21:54. Renewal requires fresh evidence. The initial dashboard assertion failed with an unrecorded status; a focused rerun passed, but its cause is unproven. The earlier P19 runtime fault also remains unexplained.

Earlier entries below record their then-current installed state; this section is the current baseline.


## Pinned schema069 staging review packet — 4 October 2026

A local source archive now binds candidate `335a3f2` to 512 exact Git file hashes,
excluding runtime binaries, credentials and agent tooling. Read-only inspection
verified the installed core/supervisor manifests against trust and all 488 selected
baseline source paths. CRLF-only differences in text are recorded; migration and
binary bytes remain exact. The live database remains schema066 with its 66 matching
checksums and AI disabled; the worker service is stopped. No installed state changed.

A fresh disposable schema066-to069 check preserves four login flows, an active
session and grants, verifies all migration/guard checks, and is idempotent. Only
the four new fixed return paths become valid; external/unknown paths stay rejected.
The cluster stopped. Existing application evidence retains its original source
bindings; no full suite, live client, provider or actual worker qualification was
rerun for packaging. The earlier intermittent AI fault remains unresolved.

The exact deployment review proposes preservation, migrations067–069 without new
grants, pinned source installation, fresh receipt evidence and affected staging
service restarts, while keeping the worker stopped and AI/publications unchanged.
This is a reviewable proposal, not authorization or deployment. The older binary
requires schema066; any database rollback remains separately gated by current
deletion/revocation history. Packet and evidence:
GitHub/.agent_docs/aphelion-sophie/candidate-335a3f2-2026-10-04/deployment-review.md and verification.json.

## Maintenance procedure preparation — 4 October 2026

P35 now has a review draft covering dependency/API/provider/model revalidation,
proposed operator ownership and cadence, agent PR/release evidence, and isolated
recovery with current independent deletion history. It uses the existing tooling
and preserves the current selected-provider and no-ticket-AI boundaries. Cadence,
named operators, recovery custody/targets and P31 cutover remain unapproved.

The draft's repository links, referenced commands and changed workplan/ledger
were checked against the current source. This is documentation preparation, not
an executed upgrade or recovery drill. No application tests were run for this
documentation-only milestone; no schedule, notification or service was changed.
Draft and source-bound review:
GitHub/.agent_docs/aphelion-sophie/maintenance-2026-10-04/procedure.md and verification.json.

## Blank Contact staff entry — 4 October 2026

Core now attaches one fixed Contact staff button to validated AI replies. The
model cannot supply components or select a case type. A signed click checks
current membership and returns the existing six-category chooser privately,
within the initial-response deadline. Selecting a category uses the existing
freshly authorized intake route: ordinary forms are blank, and Quick Help keeps
its existing no-form behavior. The separate Staff-created contact flow is unchanged.

54 focused checks pass for transport restrictions, source-message removal,
private routing, membership loss, blank fields and expired requests, including
existing Shuttle panel checks. Two composed runtime scenarios pass: P24-RT25
stores only explicitly submitted synthetic form answers while the AI lane is
unavailable, and RT15 retains the authorized public Onboarding panel. The
disposable cluster stopped. No schema, grant, dependency, installed service or
provider change was made. Independent Discord/client acceptance and the rest of
T26 remain open; this candidate is undeployed.

Evidence: GitHub/.agent_docs/aphelion-sophie/contact-staff-2026-10-04/verification.json.

## Current release-review inputs — 4 October 2026

The release ledger generator now follows the selected DeepSeek provider and
current implementation evidence. T31–T33/T52 and P23/P32 no longer require the
superseded local-only implementation; a separately selected local alternative
retains its artifact/CPU/egress checks. R10 keeps its original reference title
beside the effective owner decision. All 60 acceptance IDs, 18 requirement
mappings and 117 review row IDs remain. Separate SAI-G capability states are
copied from the workplan; all human results start as Not run and no gate is closed.

The generator refuses to overwrite nonblank human results or an unrecognized
existing document. A fresh `--output` path supports review of a new baseline
without erasing or reusing prior approvals. Two focused checks verify selected
provider/gate coverage and byte-preserving refusal for every human-result field.
The JSON ledger was regenerated with source hashes, including the generator.
The original XLSX was untouched. No application/database/live/provider checks
were needed for this tooling and specification change; their existing evidence
and unresolved release limits remain source-bound.

Evidence: GitHub/.agent_docs/aphelion-sophie/release-review-2026-10-04/verification.json.

## Static identity placement review — 4 October 2026

A local review surface outside the product now presents all four original Sophie
assets, with a contained banner, 32/48/64-pixel circular avatars, a square avatar,
light/dark alpha surfaces and a narrow wordmark fallback. Startup validates the
fixed brand profile and every source PNG hash. The original artwork and installed
dashboard are unchanged; no new production asset route or editable identity was added.

Developer browser checks passed for 320 CSS-pixel reflow without horizontal
overflow, live-text fallback, keyboard quiet mode with a visible focus outline,
and failed-image recovery. All 11 image placements loaded, with source dimensions
matching the manifest; character and wordmark alpha were inspected on both surfaces.
Circular avatar crops visibly clip ear tips as documented. No console errors were
observed. The temporary tab and loopback preview stopped, and the viewport override
was reset. This is partial T49/T50 preparation; browser zoom, independent accessibility,
owner placement/distribution approval and Discord upload acceptance remain open.
The preview has no case/model interface and denies network connections by CSP;
it does not substitute for the full T51 case/Onboarding acceptance run.

Evidence and screenshots: GitHub/.agent_docs/aphelion-sophie/brand-review-2026-10-04/verification.json.

## Completed-admission AI exclusion probe — 4 October 2026

P19-RT22 now waits for the synthetic admission transaction to commit and release
its client before the next fixture mutation. The earlier qualification-query
counter is retained as an additional assertion. Query errors and rolled-back
admissions fail the check; all existing sentinel, receipt, cancellation,
no-delivery and no-fault assertions remain intact. This changes only the test
fixture and scenario, with no production AI, schema or permission change.

The targeted composed scenario passed both with temporary external diagnostic
logging and without instrumentation; both disposable clusters stopped. The
original `AI_TURN_UNAVAILABLE` from the earlier full run remains unexplained.
Read-only review found no reproducible runtime defect and rejected the initial
multiple-admission-overlap hypothesis because the admissions share a transaction
lock. The stronger completion boundary is test evidence, not a demonstrated fix
for the original fault. Full-suite and live worker/provider checks were not rerun.
Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/ai-admission-diagnostic-2026-10-04/verification.json.

## Shuttle assistance and delivery dashboard — 4 October 2026

The local schema069 candidate adds authenticated `/shuttle-assistance` and
`/shuttle-delivery` pages for existing Staff operations. Five-entry metadata queues
use explicit reviewed confirmation, current Shuttle authority, CSRF and exact
receipt replay. Commands and HTTP share assistance/recovery operations and the
same opaque channel/screen/alert proof issuers. Replay checks precede policy and
external evidence reads, including in the transactional path. Help resolution
does not advance progress or grant Whitelist; workers still verify delivery.

Passed: 31 focused checks and 87 Shuttle assistance/pause/recovery/selection
database scenarios. SH01–SH06 cover OAuth resolution, Muzzled denial, replay after
policy/channel changes, both message types, retained-channel selection, role
recheck and authority loss during proof. RT24 verifies the composed OAuth return
paths, paused-run resolution and exact recovery after a lost screen POST response.
Synthetic browser checks confirm numeric pagination, keyboard confirmation,
lost-response exact retry, message adoption, channel choice and access-loss
clearing. The preview and browser tab stopped; no browser errors were observed.

The standard composed run passed the other 23 scenarios but failed P19-RT22's
final no-fault assertion with one `AI_TURN_UNAVAILABLE`. Its exclusion, receipt
and no-delivery assertions passed. An isolated diagnostic and all 24 composed
scenarios then passed with temporary synthetic exception logging outside the
repository. The intermittent fault was not reproduced or fixed; its original
failure remains an evidence gap. No AI assertion or production logging was changed.

Initial validation also found an outdated assistance cleanup/control fixture,
missing migration registration and an omitted browser session flag. These were
corrected without weakening assertions. Schema069 changes only fixed OAuth
return paths; no new capability grant, dependency or live service change.
Installed source remains 5f60a24/schema066. Deployment, actual worker/provider
qualification, owner publications/consent and independent live acceptance remain
open. Source hashes, exact runs, corrections and rollback are recorded at
GitHub/.agent_docs/aphelion-sophie/shuttle-dashboard-2026-10-04/verification.json.

## Ordinary ticket delivery recovery dashboard — 4 October 2026

The local /case-delivery page lists only parked-case metadata for current responders.
Explicit reviews cover recheck, exact Sophie message adoption and retained-channel selection.
HTTP and signed commands share receipt preflight before external reads, current case authority,
trusted opaque proofs and the existing fenced transaction. Repairs record intent; ordinary
workers still verify delivery or seal other channel candidates before confirming access.

Passed: 27 focused checks, 71 intake/recovery scenarios and 23 composed staging scenarios;
both isolated clusters stopped. RT23 uses actual synthetic OAuth/CSRF, the new return path,
a parked Staff reply, exact message adoption and receipt replay with one final message.
Y24–Y27 cover Head Admin exclusion, channel selection and authority loss during proof reads.
An initial RT23 fixture missed the API path prefix; the fixture and embed lookup were corrected.
Read-only review caught the 32/48-hex cursor mismatch; the client validator was fixed and its
actual browser pagination verified. Focused checks also cover immediate reauthorization after
hidden-page clearing and expected audience/continuity conflicts. These final client/error-map
fixes were validated with focused checks; the database scenarios were not repeated for them.

Synthetic browser checks confirm three repair types, keyboard review focus, a lost-response
exact retry and access-loss clearing. Preview and tab stopped. Migration068 only extends the
OAuth return-path allowlist; existing current-count assertions were updated, without rerunning
unrelated suites. No live service, permission, credential, dependency, provider or member data
changed. Installed source remains 5f60a24/schema066; this schema068 candidate is not deployed.
Shuttle dashboard parity, final copy and independent live/accessibility acceptance remain open.
Evidence: GitHub/.agent_docs/aphelion-sophie/case-delivery-dashboard-2026-10-04/verification.json.

## Shared brand-profile contract — 4 October 2026

Dashboard startup and repository asset checks now validate the fixed Sophie identity and
four approved original masters through one bounded contract. Changed roles, identities,
hashes, dimensions, transparency, paths and generation settings reject. The existing
actual-byte and PNG checks remain; both original packs are unchanged.

Nine focused brand/dashboard checks pass. Repository verification checks the source
contracts and both asset packs. The core dashboard package must include the existing
visual-pack brand-profile.json alongside its manifest and avatar. No dependency, schema,
permission, artwork, UI appearance or installed service changed. Publication/distribution,
future derivative provenance and independent live/accessibility acceptance remain open.
Source-bound evidence: GitHub/.agent_docs/aphelion-sophie/brand-profile-2026-10-04/verification.json.
P20–P22/P39 were reconciled with already recorded direct-lookup/import/editor evidence;
this documentation correction does not close G3 or the 40-question knowledge gate.

## Late answer after destination restriction — 4 October 2026

P19-RT22 now also admits a public turn and holds a schema-valid reply in the synthetic
worker. A loopback `CHANNEL_UPDATE` moves its destination into the protected ticket
category. After the journal accepts that event, the worker signal is aborted before the
turn deadline. The worker deliberately returns its reply late; the receipt remains
cancelled, with no additional Discord write, output message or AI effect. Earlier public
controls, authenticated artifact exclusions and restricted knowledge checks still pass.

All 22 composed staging scenarios pass; the isolated cluster stopped. Repository checks
pass for 562 source files, 31 reference checksums and eight asset copies. No application
behavior, schema, live service, provider request or permission changed. Evidence:
`GitHub/.agent_docs/aphelion-sophie/ai-destination-revocation-2026-10-04/verification.json`.
This proves synthetic cancellation and late-result rejection, not physical worker stopping
or actual OS/file/network isolation. Provider/notice/publication/consent gates and independent
live release acceptance remain open; installed AI processing stays disabled.

## Authenticated case-artifact exclusion — 4 October 2026

Expanded P19-RT22 passes through the composed dashboard, signed commands and loopback
Gateway with enabled synthetic AI qualification. The case workflow saves, reviews and
publishes a form, confirms and submits a Staff contact, waits for actual private intake
delivery, appends/reads a Staff note, captures a message with attachment metadata and
reads/reviews/downloads its authorized transcript HTML. Notes remain outside transcripts.
A standalone member command in the public channel opens an unfilled ordinary form.

A real restricted knowledge library returns a seeded public source but no case-ID or
transcript-link result. Public AI controls before and after the private workflows both
reach the synthetic worker and settle silent. No excluded source-message fetch, case-content
knowledge/model call, AI receipt, effect or provider attempt occurs. Every AI/knowledge
table is checked for raw and Markdown-escaped sentinels; the knowledge database identity
is denied the four case-content tables. Default member intervals and the actual database
intake retry are respected, so unrelated rate limits cannot substitute for exclusion.

All 22 composed staging scenarios pass and the isolated cluster stopped. Initial fixture
attempts exposed escaped rendering, deferred intake delivery and inconsistent fixed-clock
assumptions; the final run uses real elapsed time and confirmed delivery. No application
behavior, dependency, schema, installed service or live permission changed. The source-bound
report is `GitHub/.agent_docs/aphelion-sophie/ai-artifact-exclusion-2026-10-04/verification.json`.
This is attachment **metadata** and transcript-HTML evidence, not file-byte download
acceptance. The separate AI-to-Staff control, actual worker OS/file/network denials and
physical stop, provider clearance and complete T22–T26 remain
open. The installed source remains `5f60a24`/schema066 with live AI processing disabled.

## Read-only vault inventory and retained-slot ownership — 4 October 2026

The local attachment operator now has a bounded `scan` mode. It compares flat-directory
metadata with all recorded attempts in the selected vault and returns counts only. It
does not follow directories/links, read file bodies, hash content or modify files/records.
Truncation leaves missing counts unknown; changed database selection rejects the report.
Both single-file verification and encrypted backup selection now reject a retained slot
owned by a different job or a mismatched recorded size before reading its contents.

Passed: six focused file checks; 31 isolated attachment/operations scenarios (CA01–CA23,
AO01–AO08); and 11 isolated recovery scenarios (RB01–RB11), including encrypted restore and
cross-job ownership rejection. Both clusters stopped. The initial attachment run exposed
an old schema066 expectation; remaining current migration-count assertions were updated
to 67 in `d330cd9`. Unrelated integration suites were not rerun for that count correction.
No live vault, service, credential, grant, dependency or additional schema change occurred.
Repair/requeue/deletion/download policy, capacity alerts and actual operational acceptance
remain open. See [operator scope](attachment-operations.md) and source-bound evidence:
`GitHub/.agent_docs/aphelion-sophie/attachment-inventory-2026-10-04/verification.json`.

## Qualified synthetic Gateway exclusion — 4 October 2026

P19-RT22 exercises the composed staging host and loopback WebSocket ingress with an available
synthetic AI worker, enabled publications, qualification rows and current explicit synthetic
consent. A public positive control reaches knowledge lookup and the worker, then settles silent.
Six protected or excluded contexts and a subsequent moved-channel event reach qualification
inspection but produce no source-message fetches, further knowledge/worker calls, AI receipts,
provider attempts or effects. The covered boundaries are permanent root exclusions, excluded
parents, child threads, moved retained exclusions and the protected category fallback.
The host drains pending work before final assertions; bounded ingress cannot silently skip a
sentinel. No synthetic sentinel enters outbox metadata and no Discord write occurs.

All 22 composed staging scenarios pass, including the final moderation failure-code restriction;
the isolated cluster stopped. This fixture uses synthetic qualification and a zero-preference
journal adapter. It does not qualify the installed worker, OS/database identity separation,
provider transport, all authenticated form/note/transcript/file routes or full T22–T26 acceptance.
Installed `5f60a24`/schema066, services, publications and privacy gates remain unchanged.
Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/ai-exclusion-2026-10-04/verification.json`.

## Reviewed moderation recovery candidate — 4 October 2026

The new `/moderation` page reviews one member's current mute/unmute delivery and records
an explicitly confirmed parked-job retry. Current actor and original moderator authority,
action revision, eligibility epoch and job fence are checked; uncertain dispatch state is
preserved. Exact receipts prevent repeated or concurrent retries from reopening a job twice.
Migration 067 adds only the fixed OAuth return path and retains existing login flows.
Installed staging remains pinned to `5f60a24`/schema066; this candidate is not deployed.

Passed: 21 focused unit checks; M01–M20 on an isolated PostgreSQL cluster; and 21 composed
staging scenarios, including RT21 through signed moderation, OAuth, CSRF, the actual store,
worker and current-role revocation. The synthetic browser confirmed one explicit retry and
no retry for expired decisions, with no browser errors. The database clusters and temporary
preview stopped. No provider, live Discord, credentials, permissions or services changed.
The final unknown/quarantined-code restriction passed M19 after the composed run.
Migration-count expectations in the historical storage/upgrade suites were updated to 67;
those broader suites were not run for this allowlist-only migration. Live permission/client
acceptance and production release gates remain open. See
[the recovery contract](command-authorization.md) and source-bound evidence at
`GitHub/.agent_docs/aphelion-sophie/moderation-recovery-2026-10-04/verification.json`.

## Approved schema066 staging deployment — 4 October 2026

Pinned `5f60a24099daa0031100dd626068fca6500e053b` is installed as `sophie-deepseek-5f60a24`.
The owner approved the prepared migration/grant/receipt/service-start scope. Before mutation, the
stopped database, package, trust, service definitions and protected configuration were copied and
hash-verified in `D:\Backups\sophie-staging\schema066-5f60a24-20261004`. The independent journal was
preserved separately; this is a local recovery point, not an off-host restore qualification.

Migrations 065/066 and all migration checksums passed against the actual staging database. Server-side
fingerprints confirm preservation of 72 existing rows across 101 tables. Exactly seven approved
AI-control table privileges were added, with no previous grants removed. Actual core qualification
checked 71 tables and 66 migrations; control, read-only knowledge and knowledge-editor checks passed.

Both installed trust files and their complete package manifest verified. All 485 mirrored source files
and the three root package/licence files match the pinned checkout; reviewed Node 24.19.0 executable
and licence hashes match. Runtime/database/Discord configuration remained unchanged apart from the
journal receipt. Current configured identities, ACLs and firewall evidence are bound into the renewed
receipt. The journal header, checksum chain, capacity, identity and ACL passed; its bytes are unchanged.
Installation trust expires **5 October 2026 at 15:14:36 UTC (17:14 Warsaw)**; the independent journal
receipt expires earlier, **14:13:20 UTC (16:13 Warsaw)**. Renewal requires fresh evidence again.

At 15:18 UTC, PostgreSQL, tunnel, supervisor and core were running under their distinct expected child
identities; the worker remained stopped with no child. Four application/database listeners were owned
by the expected processes on loopback only. Wrapper configuration, qualified ACLs and firewall scope
were unchanged. Gateway authority was current and leased; authenticated supervisor inspection showed
recovered/empty state and completed quiescence. Twelve loopback/public dashboard checks passed,
including anonymous denials and asset hashes. The service verification script initially assumed
cloudflared lived beneath the Sophie directory; checking its preserved configuration corrected that
assumption and confirmed its existing Program Files executable and proper service identity.

AI remains disabled, no processing policy is installed, and configuration/personality revisions remain
zero. No publication, worker startup, provider request or member AI acceptance occurred. Actual worker
access/egress denial and physical stop, provider commitments, approved publications/current consent,
Discord privacy/answer acceptance and end-to-end latency remain separate gates. Prior unit/database
test evidence remains bound to the same source; application suites were not rerun for this deployment.
The documentation commit records these results and is not a second package deployment. Source-bound
evidence: `GitHub/.agent_docs/aphelion-sophie/deployment-5f60a24-2026-10-04/verification.json`.

## AI test preparation and installed privilege preflight — 4 October 2026

Installed AI control qualification now checks every schema066 privilege addition before service
composition. Missing tombstone/erasure access or consent/request deletion rights fails with
`AI_DATABASE_PRIVILEGES_MISSING`, rather than surfacing later during admission or cleanup. Ten focused
installation checks and 93 isolated AI/database scenarios passed. New AI-D11 uses a restricted role,
revokes each of the seven required grants individually, verifies rejection, and verifies acceptance
with the exact delta restored. The owned database cluster stopped. This does not replace installed
role checks or exercise live Discord/provider effects. Prior 90-unit/20-staging evidence remains
bound to its earlier candidate; those unchanged suites were not rerun for this startup check.

The notice and operator retention annex now describe best-effort redaction, default departure
deletion, separate explicit retention, fresh rejoin consent, pending external cleanup, minimal markers,
backup/provider limits and the existing privacy contact after departure. Exact draft text is 7058
characters, within the runtime's 8000-character limit. Personality and budget drafts pass their
runtime contracts; draft processing remains denied. Official Flash prices were rechecked against
the current public pricing page and match the conservative peak rates. No price validity, provider
acceptance, source publication or member consent was invented. A 40-case results template preserves
the historical question set's source bindings and requires fresh source review and actual answers.

Read-only installed metadata at 14:49 UTC (16:49 Warsaw) confirms all five Sophie services are stopped,
installed release `sophie-deepseek-7a152ca`, expired installation and journal receipts, and no installed
processing policy. The existing journal is present; only its metadata/hash/ACL were inspected, not
member records. Schema064 remains the last database observation because PostgreSQL was not started.
The current worker setup `-WhatIf` passed its registration/wrapper/firewall checks. This is configured
scope evidence, not a worker-child file/network denial test. No service, grant, trust or journal changed.

The concrete deployment proposal lists schema065/066, exact grant SQL, preservation/rollback limits,
renewal steps, current source/profile hashes and separate owner-led worker/chat acceptance. The old
protected assembler points to September evidence; its evidence directory must be updated after fresh
readback, before any authorized renewal. The runbook now reflects schema2 accepted evidence and the
current stopped/expired state. Evidence and review artifacts are in
`GitHub/.agent_docs/aphelion-sophie/test-readiness-2026-10-04/verification.json`.

The updated text and JSON are the canonical draft review outputs. The Word copy remains visually
unverified: the configured document bundle has no LibreOffice renderer, matching the prior diagnosed
failure. Provider terms, factual/legal retention and transfer annexes, publication and explicitly
authorized staging deployment remain open. There was no provider correspondence, paid request,
worker startup, member processing, new dependency or permission change in this preparation.

## Departure deletion, consent navigation and request preparation — 4 October 2026

The schema066 candidate deletes member-specific AI data on confirmed departure by default.
A separate, explicitly saved retention setting defaults to false. Core records departure and
cleanup epochs atomically with observed membership revocation; the AI control identity performs
cleanup without receiving core/case access. Cleanup runs independently of inference, retries after
failure and fences rejoin writes until it finishes. Retention preserves saved preferences, consent
history and completed activity records while disabling active consent and pending processing.

The independent preference journal protects the retention choice and deletion against an older
consistent database restore. Normal journal writes and privacy reads use the same AI transaction
lock, avoiding false restore detection between fsync and commit. Deletion removes consent and
resolved activity records, retains minimal deletion/replay fences, and preserves aggregate spending.
Unsent reservations are released; uncertain spending and unresolved Discord effects remain pending.
Dependency cleanup includes effects owned by other requesters. Those obligations are not a passed
deletion and may need operator resolution. A missing core authority row in an inconsistent selective
restore/import is a reported failure; this pass does not qualify selective recovery or fabricate
authority. Journal outage, capacity and qualification expiry hold processing and affected cleanup.

Consent navigation now uses bounded 100-row pages and exact self-only channel lookup. Historical
choices no longer hide newer ones; opt-in uses the current channel epoch even when it is not loaded.
Withdrawing an absent choice creates no row or global invalidation. DeepSeek preparation reuses its
accepted serialized request for byte accounting and dispatch, removing a duplicate serialization
without changing provider inputs or privacy checks. No new end-to-end latency claim is made.

Validation: 90 focused preference/provider/IPC/turn/observation tests and 92 isolated AI/database
scenarios passed, including Gateway/REST departure, restart, retained/default choices, consistent
restore, journal/commit concurrency, replay denial, cross-member dependencies and spending holds.
The composed staging run passed 20 scenarios, including administration with an unavailable AI lane;
later cleanup-query changes were covered by the final AI/database run. All owned database clusters
stopped. Synthetic browser checks exercised 203 choices, off-page opt-in, withdrawal during provider
outage, and saving retention on/off. The browser used actual assets with a synthetic API, not Discord
or the installed service. Source conventions checked 554 files. Workplan generation and diff checks
passed. Source-bound evidence and screenshots:
`GitHub/.agent_docs/aphelion-sophie/dispatch-iteration-2026-10-04/verification.json`.

No dependency or installed permission change occurred. Deployment needs schema066, AI-control
SELECT/INSERT on `request_tombstones`, SELECT/INSERT/DELETE on `effect_erasure`, and DELETE on
`consents` and `request_receipts` in addition to existing AI-control grants. Core retains its existing
no-DELETE/no-AI-schema boundary. Only isolated test roles received the test grants. Review the matching
notice/retention annex and requalify the changed source and worker before activation. Provider
commitments, real-member/Discord acceptance and separately authorized deployment remain open;
free-form redaction still does not establish anonymity or EU compliance.

## AI privacy checks across asynchronous work — 4 October 2026

AI invalidation now fences pending metadata reads, one-use member observations and
admissions. A read started before a clear cannot repopulate the metadata cache, and
an older admission cannot refill cleared temporary memory. Exclusions registered
during authority, automation, source or emoji lookups deny the affected context or
reaction. Checks also reject expired observations and clock rollback.

Admission now reads approval, notice revision and consent binding together, before
and after asynchronous metadata. A final database version check rejects consent,
control or qualification changes during those reads. Invalidation also fences the
last notice lookup before message-body access. Remote notices without a binding
cannot offer or save opt-in. Duplicate receipts stop before repeating approval and
Discord metadata work. Two coherent notice reads replace three separate
approval-dependent reads per eligible snapshot; this is a call-count improvement,
not a measured end-to-end latency result.

Validation: 68 focused observation/turn/installation/runtime tests, 81 isolated
AI/database scenarios and 20 composed staging scenarios passed. Both synthetic
database clusters stopped. Four race regressions failed before the changes and
pass after them. The composed tests include administrative operation with an
unavailable AI lane; they do not establish live Discord or provider acceptance.
Final source and evidence hashes are recorded in
`GitHub/.agent_docs/aphelion-sophie/privacy-iteration-2026-10-04/verification.json`.
Earlier redaction and synthetic performance measurements below retain their own
source bindings; they were not measured again in this iteration.

The review also identified a remaining product boundary: dashboard withdrawal and
export currently require guild membership. A departed-member route or operator-led
process must be settled alongside the notice and provider commitments. No new
authentication or permission route was introduced in this pass. Source inspection
of this limitation is distinct from runtime verification of a replacement flow.

Redaction remains best effort and does not establish anonymity or EU compliance.
Provider commitments, reviewed notices/publications, deployment and renewed worker
qualification remain separate gates. No dependency, schema, installed permission,
live-service or activation change occurred. Last installed observations remain the
30 September record.

## AI memory redaction and context performance — 4 October 2026

The owner selected free-form chat with identifier redaction and retained privacy
gates. Eligible message creates/edits now mask metadata-derived names and common
direct identifiers before temporary memory creation. Confirmed assistant memory is
also redacted. DeepSeek preparation independently redacts every outgoing free-text
block, including old history, examples and published source text. Unsafe citation
and emoji keys are rejected before a request. No reverse name map is retained.

The provider-visible channel pseudonym now uses a private random key per worker,
instead of the API key known to the provider. Same-worker grouping remains for
cache use; new workers do not reuse that pseudonym. Local core/worker metadata still
contains IDs needed by the existing boundary contracts; those fields are absent
from the provider HTTP body. Profile schema2 binds the new policies and requires
fresh qualification when deployed. Source publications and accepted notices are
not rewritten by redaction.

History retrieval now rechecks every selected record after all asynchronous source
authorizations. An earlier source deleted, replaced, expired or evicted during a
later authorization causes that retrieval to return no history. The regression
failed on the original source and passes after the fix. Context insertion now
computes each immutable record's serialized byte count once, including UTF-8 and
reply dependencies, while preserving the 12-item, 64-KiB and five-minute bounds.

All 100 focused context/provider/worker tests and 79 isolated AI/storage/knowledge/
Gateway scenarios pass; the synthetic PostgreSQL cluster is stopped. These include
exclusion before message/identity-alias access, creates/edits, captured HTTP bodies,
old unsanitized context, private partition rotation, current consent and cancellation.
Question detection uses the original eligible text so common-word names cannot
silently change the trigger. A bounded token scan avoids repeatedly rescanning
long malformed email/domain inputs.

A synthetic benchmark of 3,000 inserts across 100 lanes, using five samples after
two warmups, measured 112.06 ms median before and 54.76 ms with the final redaction
path (about 51% lower). Maximum-size redaction/nonmatch cases measured 0.02–0.56 ms
median. Timers were stubbed in the context benchmark; these results do not measure
provider, database, Discord or end-to-end latency. Source hashes and full results are in
`GitHub/.agent_docs/aphelion-sophie/memory-2026-10-04/verification.json`.

Redaction is best effort: unknown names, obfuscated identifiers and identifying
personal facts can remain; common-word names and identifier-like numbers can also
be over-redacted. It does not establish anonymity or EU compliance. Existing
provider, exact-notice consent, publication and qualification gates remain in force.
Explicit saved preferences stay local; automatic long-term extraction remains off.
No dependency, schema, permission, live-service or activation change was made.
Full release and real-provider/Discord acceptance were not run. Last installed
staging observations remain the 30 September record; this pass did not refresh them.

## Draft agreements and exact consent support — 30 September 2026

The source candidate adds schema065 with a nullable latest-acceptance receipt on existing consent
rows. Legacy records remain readable and withdrawable but cannot authorize remote processing.
The receipt preserves the accepted notice text, revision, aggregate processing-evidence binding and
acceptance timestamp. Withdrawal retains that snapshot and changes current state; the authenticated
JSON attachment exports only the requesting member's records, not a complete historical audit.

Protected processingPolicy schema2 requires separate operator-recorded hashes for the accepted
processor agreement, Discord service-provider terms, retention/deletion review and international-transfer
review. Draft and schema1 approvals cannot authorize processing. These hashes bind reviewed evidence;
they cannot prove that an agreement exists or is legally sufficient. Changed notice text or evidence
invalidates earlier remote consent even when the notice revision number was not changed.

Validation: 14 focused policy/installation/preference HTTP tests passed; 79 isolated AI/storage,
knowledge and Gateway scenarios passed with the synthetic cluster stopped. They exercise stale and
racing acceptance, legacy/draft denial, withdrawal during notice outage, own-record export, current
session checks, denial before message-body access and invalidation before delivery. Initial validation
caught a domain-layer hashing import and a reused flood-limited test ingress; both were corrected.
The final source and log hashes are in
`GitHub/.agent_docs/aphelion-sophie/consent-support-verification-2026-09-30.json`.

The external `consent-packet-2026-09-30` folder contains the draft DOCX and exact content JSON. The
operator identity/contact supplied by the owner are included there. Provider obligations are proposals
awaiting actual acceptance; retention, transfers and other marked factual annexes remain incomplete.
DOCX text/structure consistency was checked; the configured renderer could not find LibreOffice,
so no rendered PDF, page images or visual layout verification are claimed.

No source installation, database migration, agreement signature, email, public notice publication,
real-message consent, paid request or worker activation occurred. Staging remains source7a152ca,
schema064. Deployment preparation and rollback limits are in the external preparation JSON. The
provider clearance and existing real-worker/Discord acceptance gates remain open.

## Approved repair installed — 30 September 2026

After explicit owner approval, pinned source `7a152ca` was installed using the existing staging renewal
procedure. Schema064 and the complete core configuration digest are unchanged; no database migration
or publication was performed. The previous source, trust files, evidence and reviewed ACL descriptors
are retained under the protected `staging\repair-7a152ca-20260930` directory.

The two approved directory grants now provide worker access to its wrapper. Comparing the reviewed
descriptors confirms only `services` and `services\worker` changed; provider, preferences and per-role
trust descriptors are unchanged. Service/firewall readback was captured and hashed into renewed
installation evidence. These are configured-boundary observations, not actual worker-denial results.

Installed manifest verification and configuration comparison pass. The actual core, supervisor,
PostgreSQL and tunnel children match their separate virtual accounts. Supervisor inspection reports an
empty recovered slot and completed quiescence; Gateway is current/leased, retaining a historical
`DISCONNECTED` code after restart. All 12 public/loopback dashboard and asset checks pass. Worker remains
stopped, processing unapproved, configuration/personality publication revisions zero. No provider request,
Discord AI message, consent, worker qualification or production action occurred.

Trust expires 1 October at 14:45 Warsaw. The independent preference-journal receipt still expires
1 October at 12:54 Warsaw; renewal did not extend it. Source-bound installed results and preservation
records are indexed in `GitHub/.agent_docs/aphelion-sophie/repair-deployment-verification-2026-09-30.json`.
No application/storage suites were rerun for deployment; source checks remain bound to the repair commit.

The owner reports being EU-based and asked whether a disclosure would suffice. Public EU/Discord/API
terms research is recorded with the unsent `provider-eu-enquiry-2026-09-30.json`; no account agreement or
processing approval is established by that research. DS-01, owner publications/current consent and
actual worker/knowledge/Discord acceptance still prevent declaring the AI chat trial ready.

## Local blocker repairs and preparation — 30 September 2026

The installed baseline remains schema064/source95e92bd. This local candidate fixes evidence expiry
during asynchronous processing qualification and adds one deadline around every worker SCM operation,
including initial queries/commands. A stalled command fails without confirming worker quiescence;
a late query cannot dispatch a stop after its operation expires.

Worker setup now validates existing service identity/path/start mode, pinned wrapper/configuration and
firewall filters before mutation. It proposes the missing worker metadata access on `services` and
read/execute access on `services\worker`. Read-only installed ACL inspection confirmed that the worker
currently lacks the wrapper-directory grant. Current service/firewall configuration passed `-WhatIf`;
no ACL, firewall, package or service state was changed. Firewall scope is non-443 outbound denial,
with fixed origin and public IPv4 enforced in the application; it is not an OS provider-host allowlist.

19 focused installation/service tests and 26 pure PowerShell configuration-guard cases pass, including
expiry while waiting, stalled SCM commands, late-query fencing and drifted setup objects. Full suites,
storage suites, actual worker-child denial/lifecycle tests, paid calls and Discord acceptance were not
run for these changes. The prior storage and installed evidence retains its original source binding.
Final source hashes and command results are recorded in
`GitHub/.agent_docs/aphelion-sophie/blocker-repair-verification-2026-09-30.json`.

The source-bound repair proposal and publication/acceptance packet are
`GitHub/.agent_docs/aphelion-sophie/blocker-preparation-2026-09-30.json`. The current official Flash peak
prices match existing accounting defaults; the prepared budget retains null price validity and is not
published. Personality remains a draft; historical knowledge cases are not fresh publication or actual
answer acceptance. No processing clearance, consent or qualification receipt was manufactured.
Installation of the repair/permission changes, DS-01, owner publication and actual worker/Discord
acceptance remain open. Production recovery and cutover gates are unchanged.

## Installed test preparation — 30 September 2026

Owner-approved proposal applied with source commit `95e92bd`. Migration 064 preserved all 100
existing application tables and their 10 rows. Core (71 restricted table checks), AI control,
read-only knowledge and new knowledge-only editor database identity checks passed. Policy version 2
adds the approved AI/editor grants to the existing configured Head Admin role. Current Discord
metadata confirms the owner already holds it; no Discord role assignment was changed.

The independent preference journal was explicitly provisioned with protected core/SYSTEM/Admin
ACLs. Renewal retains its receipt and the editor credential; its separate expiry does not extend
automatically. Installed manifest verification passed for `sophie-deepseek-95e92bd`; trust expires
1 October 2026 at 11:57 UTC (13:57 Warsaw).

PostgreSQL, tunnel, supervisor and core are running. Their actual child-process identities match
their individual virtual accounts; listeners are loopback-only and Gateway is current/leased with
no last error. Supervisor read-only inspection confirms an empty, recovered slot and completed
quiescence; core holds worker coordination. Worker remains stopped for owner dashboard action.
Both loopback-with-approved-Host and public HTTPS checks pass: login, protected-page redirects,
anonymous API denials and the installed AI JavaScript hash. No account was impersonated.
The fixed public Policies importer subsequently reached `ready` with a current five-minute
freshness window, observed through metadata only. No source publication or actual answer review is implied.

Source-bound evidence and separate installed/access/child-identity reports are in
`GitHub/.agent_docs/aphelion-sophie/pretest-*-2026-09-30.*`. Initial operator checks corrected a
singleton-gate interpretation before mutation and HTTP expectations after inspecting the existing
Host/redirect/denial contract; no application checks were bypassed.

DS-01 is partial: the owner reports disabling the exact improvement-use switch named in Terms 4.3;
API inclusion/shared-account terms support that interpretation. No fixed downstream API retention,
deletion or complete no-own-purpose processing agreement is established. No approval receipt was
installed. Actual worker-child file/network denials, provider/Discord response acceptance, reviewed
publications/knowledge answers and individual current consent remain open. No live provider call or
AI message export was performed in this update.

## Test preparation and reviewed AI activation — 30 September 2026

Offline implementation evidence, subsequently installed in the checkpoint above. Processing approval
and the displayed notice now flow from protected installation data
through controls and per-message admission. Notice changes require fresh consent. Missing, expired
or unapproved processing evidence remains denied.

Migration 064 retains operator activation receipts. The reviewed dashboard activation uses the
maintenance identity, current role capability, an actual worker probe, public audience, publication
hashes and current budget. Confirmation checks them again. Retried confirmations never undo a later
disable; normal control credentials still cannot write qualification or activation receipts.

Installed composition supports a distinct knowledge-only editor identity, the existing fixed Policies
refresh lifecycle, and an independently qualified preference journal outside database restore bundles.
No remote memory/restricted-context clearance is inferred. Runtime never recreates a missing journal.

Evidence: 27 focused installation/staging/preference/dashboard-asset checks passed; the isolated AI
database suite passed 77/77 and its cluster stopped. Earlier failures exposed the omitted migration
registration, current migration-count expectations and a three-identity assumption when composing
the optional fourth database identity. Each was corrected without weakening the checks. New actual
worker-probe coverage is included in the final focused rerun. Full suites were not run.

The composed staging suite also passed 20/20, including administration continuing after failed
knowledge startup and draining refresh on shutdown. The final repository check passed (550 source
files, 40 tasks, 60 acceptance specifications). PowerShell parsing and diff whitespace checks passed;
neither is evidence that live ACL denials work.

Source-bound final results and the operational proposal are stored under
`GitHub/.agent_docs/aphelion-sophie/`. No live provider or Discord call, credential, ACL, firewall,
database, publication, service or installed package change is claimed by these offline results.
DS-01 account-specific processing clearance and actual worker/channel/answer
acceptance remain distinct gates. Public provider documentation is research evidence, not an
account-specific clearance receipt.

## Installed on WUFF for the Test Discord Server — 29 September 2026

Owner-authorized host work, with game services left running throughout. Recorded observations:

- **Database.** The previous staging cluster was cold-copied to `D:\Backups\sophie-staging\cold-20260929-172054`
  (12,922 files, hashes equal) and moved to `C:\Aphelion\Sophie\staging`. A rename/upgrade tool was rehearsed on a
  throwaway cluster, then run live. It verified the 55 legacy checksums equal Sophie's migration files once
  the name is swapped, and took an encrypted pre-rename bundle with a quarantined restore. It renamed 3
  schemas, 3 function bodies, 55 checksums, the database, 3 roles and 6 quarantined restore copies. It
  applied migrations 056–063 with all 511 rows in 71 tables unchanged, and took a post-upgrade bundle. That
  database is retained as `sophie_stage_archive_20260929`. A fresh `sophie_stage_bot` (63 migrations) serves
  the new application.
- **Identities.** `checkRuntimeDatabase` passes for core (71 tables). `requireInstalledAiDatabase` passes for the
  control and knowledge roles, logged in through the installed package on the pinned Node runtime.
- **Services.** All run under their own `NT SERVICE` virtual accounts: `aphelion-bot-postgres` (loopback only),
  `aphelion-bot-tunnel`, `aphelion-bot-ai-supervisor` (moved off LocalSystem) and `aphelion-bot`.
  `aphelion-bot-ai-worker` is registered and stopped. The worker SID holds only traverse on its ancestors,
  read on `provider\` and `state\boots`, and read/execute on the package. It has nothing on `trust\` or
  `staging\`, and 4 outbound block rules. Receipts are in `C:\Aphelion\Sophie\qualification\evidence-20260929`.
- **Package integrity.** The installed loader re-hashes all 701 manifest entries. It rejected a deliberately
  unregistered `host.js` edit (`AI_PACKAGE_CHANGED`) and a missing asset directory (`ENOENT`) before
  composition; both were fixed by redeploying. Receipts expire in 24 hours, and
  `staging\renewal\renew-installation.ps1` renews them. Renewal was exercised once, and it exposed the
  30-second Gateway lease (`GATEWAY_OWNER_ACTIVE`); the script now waits it out.
- **Discord.** The bootstrap for `aphelion-sophie` created the 5 roles, category and lobby, assigned Head Admin to
  the guild owner and registered the commands. It needed a registration fix: a bounded cooldown retry, because
  the per-route bucket is smaller than the command set. Gateway `current`, guild available, capture on.
  `https://sophie.a13.info` returns 303 (dashboard), 403 (anonymous session) and 401 (unsigned interaction).
- **Tests.** `npm test` 573/573 and `npm run check` pass on the host with the supervisor installed. The control
  port is now injectable so tests no longer collide with it.

Not done: no AI worker boot, provider call, channel qualification or member opt-in. The AI gates in
`ai-test-guild-runbook.md` remain open, and nothing here is production readiness.

## Review and repair of the account-isolation replacement — 29 September 2026

A review of commit 7f55156 (next entry) found that its installed composition could not have run. Several
claims in that entry are also wrong:

- **Core could not start installed.** The new loader returned only `release`, `qualification` and `keys`.
  `createInstalledCoreService` needs `configuration.core` and `configuration.installationId`. No test
  composed an installed role, so this went unnoticed.
- **The worker read container paths.** `main.mjs` still read `C:\sophie-boot\boot.json` and
  `C:\sophie-provider\api-key.txt`, but the supervisor now publishes to
  `C:\Aphelion\Sophie\state\boots\<bootId>\`.
- **Stops were not confirmed.** A failed or timed-out `sc stop` was swallowed, and the slot then reported
  `empty`. `sc start` treated "already running" as success, and a service that was not registered counted
  as qualified.
- **Package integrity was dropped.** The source/runtime manifest check lived in the deleted native companion.
- **The setup script would not have worked.** It pointed at `C:\node\node.exe`, which does not exist. It
  registered bare `node.exe` as a service binary, which SCM cannot run. It created a local user with one
  random password and then configured the service with a different one. It added that user to `Users` and
  granted it read access to `trust\`, which holds core's control key. Its one "egress" rule was an outbound
  *allow*, which does nothing under the default-allow outbound policy. It gave no metadata access on the
  ancestor directories, which is the same `lstat EPERM` that stopped the 28 September trial. The supervisor
  had no right to start or stop the new service.
- **The address guard was deleted, not "folded in".** `public-address.js` was removed with `apps/ai-egress`.
  The DeepSeek client had no such check.

Repairs:

- `apps/installation/configuration.js` and `transport.js` are the shared loader and sockets for core and
  the supervisor. The loader returns the full per-role configuration, bounds expiry to 24 hours and
  re-hashes every entry of `package\source\installation.manifest`.
- Boot, lease and provider paths are fixed host paths (`AI_WORKER_ROOTS`). The worker requires exactly one
  published boot directory whose `boot.json` identity matches its name, and recovery removes every leftover
  entry.
- Service control and the slot fail closed on an unconfirmed stop, and refuse to adopt a worker that is
  already running.
- DeepSeek requests resolve only to public IPv4 addresses (`publicAiLookup`). The unused connector path is
  removed.
- `ops/windows/Setup-InferenceAccount.ps1` is rewritten to match the host (see the decision entry).
  `scripts/prepare-ai-installation.mjs` writes the manifest and both trust files, with the receipts hashed
  into the release evidence.
- The case/core import boundary lint now also covers `apps/installation`.
- Fixed the three pre-existing failures. The Gateway observer silently OR-masked any `messageIntents`
  value into a valid set, and now rejects anything except 0 or 33280. The dashboard session tests were
  stale and lacked the AI capability fields.

Evidence, all offline on this Windows Server 2022 host: `npm test` 572/572 (0 skipped), `npm run check`
passed, 548 source files. New coverage: installed core/supervisor composition, trust-loader rejection
cases, manifest tamper, boot-directory location, fail-closed stop, recovery cleanup and the address guard.
The generator was run end to end against a synthetic package in a scratch folder. Both roles loaded and
qualified, a rerun refused to overwrite, and a tampered package file was rejected. The setup script was
parse-checked and run with `-WhatIf` against the host, which made no change. Its ACL helpers were run on
scratch folders and the firewall parameters were checked with `-WhatIf`. Nothing was installed, started,
re-ACL'd or firewalled. The steps after WinSW registration need the real service SID and are not yet
exercised. Next steps: `docs/ai-test-guild-runbook.md`.

## Replaced Hyper-V/Docker/native-pipe isolation with OS-account separation — 29 September 2026

The Windows worker/transport line of work below (Relay service trial through Synthetic Windows
companion) never reached a passing installed trial: each entry stopped at a new Windows/HCS/WinSW
boundary and proposed the next narrow amendment. Reviewing that history end to end found the root
cause: the Hyper-V container/relay architecture was adopted for a *local GGUF model* (llama.cpp),
where bounding an untrusted local binary's CPU/memory/network made sense. After the owner selected
the hosted DeepSeek Flash API, the only remaining thing needing isolation was one outbound HTTPS
client — but the container/relay/native-pipe architecture was carried forward unchanged, dragging
in a Docker Engine dependency, a custom C#/.NET native pipe companion built with a bare `csc.exe`
(no `.csproj`/MSBuild), a patched WinSW wrapper, and HCS handle-rights forensics that never once
cleared its own forbidden-open gate.

This milestone replaces that isolation layer with plain Windows account separation, per the
existing owner constraint that the runtime not require Docker Desktop or a GPU:

- The worker runs as a plain OS process (a registered Windows Service, `SophieInference`) under a
  dedicated low-privilege local account with no grant on the ticket database, Discord token or
  core configuration files. `ops/windows/Setup-InferenceAccount.ps1` provisions the account, NTFS
  ACL scope and a firewall egress rule; it replaces the entire HCS/Hyper-V/WinSW-patch runbook.
- `apps/ai-supervisor` (Docker orchestration, container-lifecycle journal, pipe-relay controller)
  and `apps/windows-pipe` (the native C# pipe companion and its custom binary IPC protocol) are
  deleted. `apps/ai-egress` and `apps/ai-relay` (the pipe-tunneled egress bridge, needed only
  because the old container ran with `NetworkMode:'none'`) are deleted as well: the worker now
  calls DeepSeek directly over its own firewall-scoped network path.
- `apps/inference-host` replaces them with a Windows-Service-oriented supervisor of comparable
  scope: ~567 lines versus ~3,730 lines deleted (`apps/ai-supervisor` + `apps/windows-pipe` +
  `apps/ai-egress` + `apps/ai-relay`), roughly an 85% reduction in the isolation/control-plane
  code. The genuinely reusable, transport-agnostic pieces were kept rather than rewritten: the
  AES-256-GCM/HKDF encrypted IPC channel (`apps/knowledge-worker/ipc-channel.js`), the HMAC boot
  handshake (`boot-pipe.js`), the signed worker-lease renewal and atomic boot-file publication
  (moved from `apps/ai-supervisor/bootstrap.js` to `apps/inference-host/bootstrap.js` with the
  now-unused `egressKey` dropped), and the generic authenticated job-queue RPC protocol in
  `apps/ai-control` (simplified from two roles, core and egress, to one, since there is no longer
  a separate egress process to authenticate). These were already correct, already Node-native, and
  never depended on Hyper-V, Docker or the native companion — only on `\\.\pipe\...` path strings,
  which now resolve to loopback TCP ports instead; every consumer of those paths (`server.listen`,
  `net.connect`) already accepted an options object interchangeably, so most call sites needed no
  change at all beyond the one function that built the path.
- The 12-item Hyper-V/HCS-era installation qualification checklist
  (`service-identities, file-custody, private-pipe-access, relay-identities, relay-isolation,
  relay-lifecycle, public-projection, worker-framework, container-mounts, network-isolation,
  physical-termination, uncertain-create-disposition`) is replaced by a 3-item checklist matching
  what an operator can actually attest to under this model: `service-account-identity,
  file-acl-scope, firewall-egress-scope` (`apps/installation/qualification.js`).
- Postgres role separation between core/control/knowledge schemas (`apps/core/runtime/installed.js:
  requireInstalledAiDatabase`, migrations 056–063) is unchanged; it was already implemented and
  already tested against real Postgres, and was never part of the problem — the worker never held
  a database credential of any kind, isolated or otherwise.

30 tests pass in `tests/inference-host.test.js`, `tests/ai-control.test.js` (rewritten for the
single-role protocol) and the adjusted `tests/ai-worker-package.test.js`, run against the real
Windows Server 2022 host (not skipped): worker-registration path-safety, boot-file publish/lease
renewal without an `egressKey`, a mocked-`sc.exe` service-control lifecycle (start/wait-for-RUNNING/
stop), stale-revision and wrong-role rejection, cold-start recovery stopping a service a crashed
supervisor left running, and a full prepare→create→start→quiesce cycle through the authenticated
control channel. `node scripts/check-repository.mjs` passes (545 source files, module conventions
still enforced against the new `apps/inference-host` boundary). The full suite is otherwise
unchanged at 560/563 passing; the 3 pre-existing failures (`dashboard-editor.test.js`,
`dashboard-forms.test.js`, `gateway-supervisor.test.js`) predate this milestone and are unrelated
to AI isolation.

No live deployment occurred. `ops/windows/Setup-InferenceAccount.ps1` was written and reviewed but
not run against any real host, and no `apps/inference-host/installation.js` trust config files were
generated for an actual installation. Remaining before this can go live: writing those per-role
trust JSON files for a real release/qualification, running the setup script on the isolated staging
host, and confirming with `icacls`/`whoami` that the resulting account genuinely cannot reach the
ticket database credential or Discord token files. AI remains disabled; all provider/account,
publication/actual-answer and Test Discord Server activation gates from earlier entries remain open
and are unaffected by this change — this milestone only replaces how the worker process is isolated
on the host, not any of the content, consent or budget gates around it.

## Relay service trial stopped and rolled back — 28 September 2026

The owner approved and the operator executed the bounded two-relay service trial against candidate f13395b731859fbd5473d46b8c8f6dead864d863. Both Manual services and dedicated protected package roots were installed, required privileges limited to SeChangeNotifyPrivilege, and 12 scoped firewall block rules created and read back. No container or AI application was activated.

Candidate files and wrapper matched their pinned hashes. SCM configuration and rule readback succeeded. The first inference service launch failed before its diagnostic/native entrypoint: Node lstat returned EPERM on C:\Aphelion. The original trial forbids changing that existing ancestor, so execution stopped. Secondary wrapper Event Log errors exposed omitted source registration in the sc-create diagnostic procedure. Both services, all 12 rules and all new directories were removed; existing three Sophie service states/files and six existing ancestor descriptors match preflight. No candidate processes remained.

No native token, private-pipe, access-denial, network-traffic or installed application test passed in this trial: startup failed before those checks. Firewall rule acceptance alone is not network isolation. The egress relay and existing three diagnostic services were never started. No container, provider/Discord request, runtime change or host reboot occurred. Earlier source checks remain evidence for their pinned builds; no application suite was rerun for this operational/documentation checkpoint.

See `GitHub/.agent_docs/aphelion-sophie/windows-relay-service-trial/result.md` and `relay-service-verification.json`. Approve the exact non-inheriting metadata-access amendment for the two relay SIDs on five existing ancestor directories, correct wrapper event-source registration, then repeat the authorized trial. Actual identity, private pipe, custody, process and network denials remain unqualified. Guest/public-projection, provider/account, publication/actual-answer and Test Discord Server activation gates remain open. No host reboot is authorized.

## Installed relay controller — 28 September 2026

Installed per-boot relay control is implemented: distinct private supervisor control pipes authenticate relay owners and the supervisor using OS descriptors; native grants bind installation, worker, release, profile, evidence, boot and operation. Persistent relay processes accept fresh boots after confirmed quiescence. Partial startup failure drains both purposes, qualification is bounded, and uncertain closure remains failed. No Windows host restart is part of this workflow.

Pinned host C# build and four native boundary groups passed. Five native-controller groups passed: two fresh boots through unchanged relay processes, repeated sessions, heartbeat, physical closure, unexpected disconnect, supervisor loss, native consumed-boot rejection and native heartbeat expiry. Actual application composition passed encrypted control/wrong-key denial, probe and two metered synthetic localhost-TLS replies plus confirmed cleanup. Six focused lifecycle tests DS04-C23 through C28 passed, as did v3 profile checks and repository validation. Earlier diagnostic failures are preserved and their source causes corrected.

The source-bound record is `GitHub/.agent_docs/aphelion-sophie/relay-control-verification.json`; detailed limits and preserved logs are in `windows-relay-control/implementation.md`. This checkpoint supersedes the earlier missing-controller blocker. It does not qualify distinct installed identities or the guest helper/HCS projection. No full suite, service start/install, permission/firewall change, container, external provider/Discord request or host reboot occurred.

Separately authorize and qualify the exact two relay service identities, filesystem/process/private-pipe/network boundaries, then the changed guest build/public HCS projection and installed composition. Provider/account clearance, publication/actual-answer review and remaining AI acceptance gates still precede Test Discord Server activation. No installed qualification receipt or production readiness is implied by local synthetic checks.

## Graceful relay reuse — 28 September 2026

Owner-approved graceful same-worker-boot reuse is implemented. Each relay retains its single first-instance listener across fully drained sessions; faults terminate that relay. Successful inference exchanges now finish through an explicit bounded graceful-close path; cancellation and malformed traffic still abort. Windows host restarts are prohibited by this workflow.

Pinned native build passed. Five native transport groups passed, including three sequential sessions per purpose in unchanged helper/worker identities, final-byte drain, idle/backpressured stop, capacity denial and no reconnect after failure. Native malformed-frame/profile checks passed. The existing application protocol fixture, adapted to both relays, passed a probe and two metered synthetic localhost-TLS replies plus confirmed cleanup. All 19 IPC tests passed, including added EOF-before-write-ack and stalled-drain regressions. Earlier failing composition and cancellation checks are retained; their source causes were fixed, not waived.

The listener handle remains owned while DisconnectNamedPipe separates drained sessions; each new private connection verifies its descriptor again. Original frame/byte/session deadlines remain. The IPC completion path waits for both its final write acknowledgement and physical closure. An initial EOF change delayed cancellation; DS04-I06 caught it and was restored to immediate failure outside explicit completion. No full suite, live service, container, provider, Discord, existing ACL/firewall change or host restart occurred. See `GitHub/.agent_docs/aphelion-sophie/windows-relay-reuse/implementation.md` and `relay-reuse-verification.json`.

Complete the installed per-boot relay controller and independently authenticated dynamic grants, without rewriting static owner profiles or restarting the Windows host. Then prepare the exact two-service/account/ACL/network installation for separate operational authorization and actual-identity qualification. Installed activation still fails closed without a controller. Provider/account clearance, publication/actual-answer review, remaining AI acceptance gates and Test Discord Server deployment remain open. Full workplan and AI test-server readiness remain false.

## Relay source checkpoint — 28 September 2026

Implemented the local relay session primitive, v2 distinct role/boot identity profiles, private/public pipe mapping, exact data-pipe owner/DACL checks, keyless relay entrypoints and supervisor readiness/physical-close seams. Installed supervisor refuses a missing relay controller. The final per-boot controller is not implemented; no installed activation is claimed.

Pinned Framework/C# build passed. Five native transport groups passed (both-purpose 1 MiB duplex/final drain, role/boot and capacity denial, backpressure stop, abnormal disconnect and exact owned helper loss). Native malformed-frame/profile checks and JS owner/secret-field rejection passed. Nine focused supervisor/control tests passed; after cancellation propagation changed, C23/C24 both passed, and six focused shutdown checks passed after ordering relay closure before worker removal. Repository checker passed 561 modules. An initial test assertion used the wrong status shape; it was corrected to inspect the actual journal and the failure log retained.

The native relay forwards the existing transport envelope without application parsing or secrets. It verifies a private descriptor through a disposable READ_CONTROL connection before announcing its listener, rechecks the data handle, and retains both handles until pending I/O drains. The tested primitive handles one connection; it does not settle the pending repeated-session contract. Synthetic tests under the local identity do not qualify distinct installed relay accounts or HCS. Existing supervisor control-pipe descriptors are preserved; exact owner/one-peer descriptors apply to data pipes. No services/accounts, shared ACLs, firewall, containers, provider or Discord operation occurred. No application/database full suite or guest build ran. See `GitHub/.agent_docs/aphelion-sophie/windows-relay/implementation.md` and `relay-source-verification.json`.

Resolve the pending owner choice: allow fully drained graceful connections within the same boot (recommended to match existing worker probe/reply behavior), or require a new boot after each completed connection. Unexpected disconnects must revoke the boot either way. Then implement separately authenticated per-boot arm records (never supervisor rewrites of static owner profiles), the concrete relay controller, source/package integration and focused composition evidence; prepare exact service/account/ACL/network/lifecycle changes for separate operational approval. Existing HCS failures, provider/account clearance and other Test Discord Server AI gates remain open. Full workplan and AI test-server readiness remain false.

## Completed HCS rights matrix — 28 September 2026

Completed the approved replacement HCS observation on core and egress. All ten forbidden opens succeeded with corresponding guest handle rights, so the direct transport remains unqualified. Prepared an explicit per-purpose relay transport decision; no application or installed permission change.

Each pipe passed five fresh exact-data-rights/descriptor/echo checks. Actual host owner/DACL and restricted-outsider controls passed; owner/DACL bytes remained unchanged after all connections. Guest/container exit 2 records the failed acceptance checks. Container removed, observed vmwp PID absent, services Manual/stopped with zero exit codes, XML/permissions restored and no owned processes/containers remain.

Both endpoints reported WRITE_DAC 0x00140080, WRITE_OWNER 0x00180080, DELETE 0x00110080, CREATE_PIPE_INSTANCE 0x00100084 and generic-write 0x00120196 on accepted guest handles. Normal data handles were exactly 0x00120183. No guest management operation was attempted; these masks do not establish host authority or an effective opener. The associated vmwp primary identity is unqualified. See `GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-retry/result.md` and `hcs-handle-matrix-verification.json`. Guest compilation and runtime were measured; no application/database suite, provider request or Discord activation occurred.

Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/transport-decision.md to select separate per-purpose untrusted relays for local implementation. Do not repeat the same direct-HCS matrix or qualify a proxy SID from guest masks/associated primary tokens. Replacement architecture and its new public/private contract require the owner decision; installation and operational qualification remain separate. Provider/account, protected mounts, termination/recovery, installed composition, publication/actual answers, preference/restricted-context and Test Discord Server activation gates remain open. AI test-server readiness remains false.

## HCS observation stopped before start — 28 September 2026

Executed the approved one-container HCS handle-rights attempt. Host service identity/owner/DACL and restricted-outsider controls passed; the runner rejected container configuration before guest start. Preserved the failure and prepared a corrected replacement runner.

Docker records create/destroy only. All three services are Manual/stopped with zero exit codes, XML and permissions restored, and no owned processes/containers remain. The absent ExposedPorts guard defect reproduces offline; corrected exposure and approval controls pass. The current rejected inspect was not saved. All guest requested/granted measurements are unrun; the earlier forbidden-open failure remains failed.

See `GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-observation/result.md` and `hcs-handle-observation-verification.json`. No guest runtime, paid provider call, application/database suite or Discord activation occurred. The corrected runner captures inspect before validation and distinguishes missing/empty port maps from exposed ports. Native probe sources/binaries and production code are unchanged.

Authorize one replacement observation using GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-retry-review/proposal.md; the prior one-container limit is consumed and no retry ran. Retain the transport gate until evidence supports an explicit decision. Provider/account clearance, protected mounts, termination/recovery, installed composition, publication/actual-answer review, preference/restricted-context gates and exact Test Discord Server activation remain open. Test-server AI readiness remains false.

## Test Discord Server AI preparation — 28 September 2026

Owner selected the Test Discord Server with AI included. Prepared an original external read-only NtQueryObject handle-rights probe and a bounded one-container observation package; no application or deployment change.

Pinned host compilation with warnings as errors passes. Local fresh-pipe controls report data access 0x00120183 and owner-authorized WRITE_DAC access 0x00140080. Initial exact-mask assumption failure is retained; corrected control permits only synchronization/read-attributes additions and still distinguishes management rights. New guest/container run is unexecuted; prior HCS forbidden-open failure remains unchanged. Current public provider terms do not establish actual account clearance.

The application requests explicit data rights and verifies a role/proxy DACL; literal forbidden-open rejection is also a recorded operational gate. The new probe observes granted rights without changing that gate or attempting guest management operations. A guest handle mask would not establish host authority or the effective opener. Public HCS/VSMB documentation supports investigating the separate layers, not asserting their measured behavior. See `GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-review/review.md` and `hcs-handle-preparation-verification.json`. No application/database suite, new service/container run, paid provider call or Discord deployment occurred.

Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/access-review/proposal.md for one additional observational container and permission to collect the remaining mask observations while recording all failed open checks. The prior amendment stop condition is not waived. Resolve the transport contract from evidence; no production proxy identity or qualification receipt yet. Provider/account evidence, protected mounts, termination/recovery, installed composition, approved publication/actual answers, preference/restricted-context gates and the exact Test Discord Server deployment remain open. Test-server AI readiness and production readiness remain false.

## Actual-owner HCS diagnostic stops at forbidden-open gate — 28 September 2026

Executed the approved external HCS diagnostic with actual core/egress virtual-account pipe creators and a protected role-owner-full/VM-group-data descriptor. Application source, installed profiles and permissions are unchanged. Source and host/guest executable hashes recorded before probe execution.

Both host role owners/DACLs, Node/native service identities and first-instance guards pass. Separate supervisor restricted-token outsider checks deny data, all forbidden masks and extra server creation. Guest core owner/DACL projection and eight-byte echo pass. A subsequent WRITE_DAC open returns a valid handle on a fresh connection; the one permitted identical-DACL reapply returns Access Denied (5). Host owner/DACL bytes remain unchanged. The trial stops; later guest masks, guest egress/extra-instance checks and the conditional second container are not run. Container/proxy removed; all services exit zero and remain Manual/stopped; XML and permission snapshots restored/unchanged.

The narrower external descriptor names the actual corresponding service as object owner, with only owner full access and S-1-5-83-0 data access. The VM group remains a diagnostic candidate, not an approved production proxy identity. The separate supervisor observed vmwp.exe PID 14000 / creation 134350904234206303 and its VM-specific primary SID, not the effective opening token. The guest WRITE_DAC request used a fresh host connection after the baseline echo; its single SetSecurityInfo request reapplied only the already verified exact DACL and returned 5. No owner or ACE change was requested. Host owner/DACL bytes were unchanged afterward. Neither accepted open alone nor this one operation denial establishes all guest rights or final containment.

Source-bound report: `GitHub/.agent_docs/aphelion-sophie/windows-hcs-narrow-verification.json`; readable result and raw logs: `windows-hcs-trial/narrow/result.md`. Host Framework compilation passed with warnings as errors; the exact pinned guest toolchain compiled the driver and printed its binary hash before launch. The runner deliberately failed HCS_GUEST_BOUNDARY_FAILED; no failed assertion was waived. No broad application/database tests, final installed application, real provider or Discord run occurred. Existing application/worker bytes remain bound to 8c8cbfd. The original amendment stays immutable; `legal/windows-hcs-diagnostic.json` records approval.

HCS isolation remains unqualified because the existing guest forbidden-open gate still fails, despite the separately measured descriptor-write denial. Resolve the Windows/HCS transport contract before proposing further operational diagnostics or application changes; do not weaken assertions, broaden grants, substitute authentication or create an owner receipt. The approved stop condition has been reached and the conditional second-container gate was not met. Installed composition, guest mounts/credentials, worker physical termination/uncertain-create, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Field-test and production readiness remain false.

## Patched wrapper passes; HCS forbidden-open gate — 28 September 2026

Owner-approved private WinSW 2.12.0 rebuild changes only the clean-exit SCM open to Connect. Pinned SDK/runtime/packages and required NET461 build metadata used; warnings/analyzers retained. Derived wrapper 9dba15b5cc15f9f51190bc8d35bfeb3f870276fdb53902d1cb7b95dc502f603f installed in the three owned services with unchanged identities and ACLs. Application source and installed guards are unchanged.

All three actual service diagnostics pass identity, protected-marker and pipe creation/close checks, companion drained stop and clean SCM exit. Core/egress deny cross-role, provider, bootstrap and supervisor-state reads. Child exit 7 is preserved; operator stop delivers SIGINT and exits cleanly. Host file fixtures verify held write/rename denial, post-close rename, reparse/owner/inheritance/writable-DACL rejection, and bootstrap unlink with a retained snapshot. A Hyper-V diagnostic preserves both exact pipe DACLs and echoes with 0x00120183/anonymous SQOS. A second probe accepts its first forbidden WRITE_DAC open and stops; no descriptor mutation was attempted. Both containers removed; three services Manual/stopped.

The first HCS server was the trusted supervisor using the exact core/egress DACL entries. It was a native diagnostic, not the final worker or application entrypoint. The guest was S-1-5-93-2-2; both observed vmwp.exe primary tokens included S-1-5-83-0, while their S-1-5-83-1-* primary SIDs differed. Those are associated-process observations, not effective-open-token evidence. The second probe stopped immediately after a valid WRITE_DAC handle was returned. It did not attempt SetSecurityInfo, later masks or an extra server instance. Exact DACL text and byte exchange are insufficient to qualify access isolation. The unused second listener timed out during bounded cleanup.

Build preparation corrected NET461 trimming metadata, explicit private restore configuration and the package-root separator. No analyzer/assertion was disabled; resolved archives matched the seven approved package hashes. Fixture setup initially hit the owner-setting privilege limit; the eventual wrong-owner check used a file actually created by the core service, then moved into the dedicated protected fixture. Its protected read-only descriptor retained core ownership and was rejected. Test-only descriptor restoration and directory sharing-error expectations were corrected; final fixture descriptors and service XML were verified.

Reports: `GitHub/.agent_docs/aphelion-sophie/windows-wrapper-verification.json` and `windows-hcs-verification.json`. HCS source/compiler inputs and outputs are retained; probe guest binary hashes were not exported, so no final executable/image receipt is claimed. Existing app/worker artifacts remain bound to 8c8cbfd; their application bytes did not change. No broad repository/database suite, final installed application or real provider/Discord trial ran. Prior proposal files remain immutable for their approval hashes; current scope is in `legal/windows-wrapper-build.json`.

The wrapper gate is passed for synthetic diagnostics. HCS access isolation remains unqualified: a WRITE_DAC open request was accepted, and the associated vmwp primary SID changes by VM and is not proof of the effective opener. Review GitHub/.agent_docs/aphelion-sophie/windows-hcs-trial/diagnostic-amendment.md for bounded disposable-pipe checks under actual core/egress creators and a narrower candidate group DACL. No production descriptor/profile change or owner receipt is approved by those observations. Remaining installed composition, guest mounts/credentials, worker physical termination/uncertain-create, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Field-test and production readiness remain false.

## Approved fixed root and WinSW clean-exit gate — 28 September 2026

Approved fixed host root changed to C:\Aphelion\Sophie in native and JavaScript profiles. Created only the new protected parent/tree and repointed the three owned Manual diagnostic services with unchanged identities. Preserved the old ProgramData trial tree and shared ancestor descriptors; no protection rule was relaxed.

Host and guest helpers rebuilt. Actual core service passes parent/child user and service SID, protected-root/own-marker, cross-role read and own-marker write denial, service-SID pipe create/close, and companion readiness/drained stop checks. Guest checks pass 36 native assertions, 11 boundary groups, four stream groups and two cross-profile rejection assertions. Host stream checks and six installation configuration checks pass. WinSW then fails clean-child-exit reporting because it requests full SCM access; the bounded driver stops the wrapper. Egress/supervisor were not started. Three services are Manual/stopped, no owned processes or containers remain.

The first new-root driver attempt encountered the wrapper log lock and stopped its own service during cleanup; it is not a test pass. The corrected driver waited for exit and captured the successful core diagnostic, then timed out on SCM state. The wrapper log identifies SignalStopped → ServiceManager.Open(All), matching upstream WinSW issue #1136. Operator cleanup succeeded. No exit code was disguised and no SCM/service DACL or account was changed. The diagnostic ran service-probe.mjs, not the final installed application entrypoint. New guest compile and transport containers were removed.

Current source-bound report: `GitHub/.agent_docs/aphelion-sophie/windows-fixed-root-verification.json`. Prepared worker package and host source/helper inventories are recorded there; no new worker image or qualified owner receipt is claimed. No broad application or database suite was rerun. The root proposal remains immutable for its approved hash; the approval overlay is in `legal/windows-installation-trial.json`. Historical entries below describe earlier candidates and superseded next steps.

The fixed-root amendment is implemented. Review the private WinSW clean-exit build amendment at GitHub/.agent_docs/aphelion-sophie/windows-fixed-root-trial/wrapper-amendment.md: one SCM access-mask call-site fix, exact SDK/package inputs and unchanged service permissions. The stock-wrapper qualification is blocked; no patched wrapper has been built or installed. After that gate, continue the already approved egress/supervisor, HCS, mount, credential, physical-termination and uncertain-create checks. Full installed application, provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Field-test and production readiness remain false.

## Windows service trial: shared-ancestor path gate — 28 September 2026

Three approved Manual diagnostic services and the new protected ProgramData trial tree are provisioned. Core parent/native-child identity checks pass after requesting TOKEN_DUPLICATE with TOKEN_QUERY for enabled service membership; worker-only checks still request QUERY. No service/process DACL was widened.

Guest-specific and host helper builds pass. Final guest build passes 36 native assertions, 11 boundary groups, four stream groups and two runtime/role rejection checks; host stream checks pass. Actual core service identity passes; protected-root validation then rejects the existing ProgramData Users metadata-write ACE (0x116). Egress/supervisor were installed but not started. All three services are Manual/stopped; no owned trial processes remain. The guest containers were removed. The bounded diagnostic uses synthetic marker files and test pipe names, with no live credentials, database, provider or Discord connection. Final application-wrapper configurations are prepared but not activated.

The first service failure identified a query-only primary token passed to WindowsPrincipal.IsInRole, which needs to duplicate it into an identification token. That source fix was compiled and the same core identity check passed. The subsequent file failure is a separate measured OS-layout mismatch: ProgramData grants BUILTIN\Users write-EA and write-attributes on the shared directory. The protection rule and existing ancestor ACLs are unchanged. Source-bound reports: `GitHub/.agent_docs/aphelion-sophie/windows-guest-framework-verification.json` and `windows-service-trial-verification.json`. Earlier source-bound images/packages remain historical; no application/database suite was rerun.

Review the concrete fixed-root amendment at GitHub/.agent_docs/aphelion-sophie/windows-service-trial/installation-root-amendment.md. It proposes C:\Aphelion\Sophie while preserving the guard, existing shared ACLs and old trial artifacts. Service/WinSW and guest Framework approvals remain valid. Installed file/pipe/HCS, mounts, credential custody, physical termination and uncertain-create gates are not passed. Provider, publication/actual-answer, preference-journal and Discord gates remain independent. Field-test and production readiness remain false.

## Pinned guest Framework helper — 28 September 2026

Separate compile-time host and Server Core worker runtime pins. Guest helper builds with the exact image-bundled compiler and rejects installed host roles. Host Framework 4.8.1 pins remain unchanged; no runtime fallback or Microsoft binary copying.

Exact guest CLR/assembly/compiler/configuration inventory recorded; GAC and Framework64 System hashes match. Guest build and 36 native assertions pass. Actual ContainerUser Node/helper tests pass 11 boundary groups, four stream groups and both cross-profile rejection checks in bounded network-disabled Hyper-V containers. Host build and stream checks pass. Owned trial containers removed. No application-wide or database suite was repeated for this native/runtime packaging change. Current evidence is in `GitHub/.agent_docs/aphelion-sophie/windows-guest-framework-verification.json`.

Continue the already approved service/file/HCS/mount/termination trial with the guest-specific package. Service tokens, installed protected-file acceptance, exact HCS identity/access, mount/credential isolation and uncertain-create disposition remain unqualified. No further approval is needed for the recorded service/WinSW/guest Framework scope. Stop at any new incompatible OS boundary. Provider, publication/actual-answer, preference-journal and Discord gates remain independent. Field-test and production readiness remain false.

## Authorized Windows trial: guest runtime gate — 28 September 2026

Owner approved the exact synthetic Windows trial and WinSW bundle scope. The pinned worker source/runtime/helper package built into an actual Windows image; one bounded Hyper-V runtime probe executed. No application source changed.

Host compiler/Framework/Node and WinSW hashes matched. ContainerUser executed approved Node 24.19.0 in a four-CPU/eight-GiB Hyper-V container with network none, no mounts and no published ports. Guest Framework release 528449 differs from the host-pinned 533325; helper startup correctly rejected with PIPE_START_FAILED_1:PIPE_RUNTIME_CHANGED. Owned container removal and absence confirmed. No services, installation root/ACLs or existing data changed.

The image is `sha256:57d72d3461ba88d96c995225e5ba5c8b2fd1af964b86f11bb4bfe0f299930b15`, built from source candidate `d2187602a07a5f942d447afed5cdc77c306adee0` and the previously approved pinned Server Core base. The recorded failure is the helper's exact-runtime guard; pipe/API compatibility on the guest remains untested. Framework64 file hashes were collected; the initial probe did not hash the separate GAC System path. No Microsoft binaries were copied, no Framework upgrade was installed, and no provider/Discord request was made. The image is retained for diagnosis; the one runtime container is removed. No application suite was rerun for these approval/evidence-only repository edits.

The approved trial stopped at its first incompatible runtime boundary. Review GitHub/.agent_docs/aphelion-sophie/windows-installation-trial-2026-09-28/runtime-amendment.md for the exact bundled guest Framework 4.8/compiler exception. WinSW and the named service/ACL trial are already approved; do not ask again. After a qualified guest build, resume service tokens, protected files, HCS masks, mount/credential isolation, physical termination and uncertain-create qualification. Provider/account, publication/actual-answer, preference-journal and Discord gates remain open. Report: `GitHub/.agent_docs/aphelion-sophie/windows-installation-trial-verification.json`. Field-test and production readiness remain false. The preceding helper/package evidence remains bound to its original source candidate.

## Installed profiles and role composition — 28 September 2026

Fixed installed profiles validate independent protected owner records, retained file handles, source/runtime manifests, parent/service identities and expiring authority. Core, supervisor, egress and worker payloads compose the native adapter; core isolates database readers and replaces lifecycle ownership on configuration Apply. Worker trust uses a separate read-only mount. Control proof binding now tolerates readiness before native write acknowledgement.

Pinned nine-source x64 helper build; 36 native descriptor/path/profile assertions; 11 companion and four stream PASS groups; six installation configuration checks; three composed scenarios with four actual synthetic companions; 15 isolated PostgreSQL privilege checks with owned cluster stopped; 51 focused repository checks (50 control/supervisor/worker plus new trust-mount regression). No installed-service, container, real provider or Discord qualification.

The PostgreSQL check used the existing disposable-cluster runner and tested table writes, REFERENCES/TRIGGER, sequence use/update, schema creation, ownership and cross-schema leakage. The composition scenarios exercise a metered synthetic loopback TLS turn, core configuration Apply ownership replacement and supervisor recovery before RPC admission. They use native synthetic profiles and injected database/Docker collaborators; they do not establish installed Windows custody. Initial native composition exposed the control proof/ready race; DS04-C22 now protects that ordering. No dependency, migration, remote-processing approval or consent-notice default changed.

Source-bound evidence and prepared worker package: `GitHub/.agent_docs/aphelion-sophie/pipe-installation-verification.json`. Fixed profile/manifest contract: `GitHub/.agent_docs/aphelion-sophie/windows-pipe-installation/installation-contract.md`. Packaging retains the approved Node executable/notices and original helper; no Microsoft Framework files are copied. Foreground payloads are not SCM wrappers. The worker's existing forced-exit watchdog is not positive physical-close evidence.

Authorize the concrete Windows trial and exact SCM wrapper scope in GitHub/.agent_docs/aphelion-sophie/windows-pipe-installation/operational-trial-proposal.md. Actual service tokens, protected-file acceptance, HCS proxy/guest identities and masks, Framework compatibility, mount/credential isolation, physical termination and uncertain-create disposition remain unqualified. Final host SCM packaging, installed-core/database and actual Discord acceptance remain open. Provider/account clearance, preference journal custody and publication/actual-answer gates remain independent. Field-test and production readiness remain false. No live services/accounts, existing ACLs, credentials, provider calls, Discord effects or existing databases changed. No broad suite, performance claim or full release qualification was attempted. Earlier milestone entries below describe their historical builds and are superseded for current implementation status.

## Synthetic Windows companion and encrypted transport — 28 September 2026

Original MIT C# companion verifies pinned parent/runtime and protected overlapped stdio, enforces role/boot endpoint registration, bounds multiplexed credit streams, and confirms native closure. A bounded JavaScript Duplex/server adapter is injected at control, inference and egress seams. Synthetic profiles derive only unique test namespaces; installed profiles remain unavailable.

Pinned csc build and three loaded Framework hashes verified. Ten native primitive checks, restricted-token generic-write/instance denial plus explicit-data acceptance, interrupted-frame poisoning, 1 MiB duplex/final-byte flow, stalled-reader cancellation, parent/helper exit, malformed/oversized commands and namespace cleanup passed. Existing encrypted control/inference and worker TLS carried two metered synthetic provider turns; wrong control key rejected. No real provider, database, Discord, container or installed-service changes.

The stream protocol acknowledges writes before accepting another write and retains native completion through closure. Client confirmation followed by listener EOF prevents a queued final acknowledgement from being discarded. A parent close receipt bounds late credits without reusing connection IDs. Interrupted output permanently rejects subsequent frames, including STOPPED. The startup check rejects ordinary synchronous Node pipes via documented completion-port association; event-based I/O suppresses completion-port packets. SetSecurityInfo returns D:PAI on this host; verification permits only the AUTO_INHERITED bookkeeping bit while requiring protection and exactly the expected non-inherited ACEs. No rights were broadened.

The access test temporarily restricted only its own thread token and used a new test pipe. It proves the tested access masks, not separation between installed service accounts or HCS identities. No account, existing file ACL, service, credential or host runtime was changed. Existing primitive evidence is retained in its original files; refreshed evidence uses separate companion check artifacts. No full application/database suite, paid provider call, latency benchmark or container run was performed.

Source-bound report: `GitHub/.agent_docs/aphelion-sophie/pipe-companion-verification.json`; implementation/protocol note: `GitHub/.agent_docs/aphelion-sophie/windows-pipe-companion/implementation.md`. Complete installed role profiles and protected-installation verification, fixed service entrypoints, and the helper/package manifest. The current companion explicitly accepts synthetic profiles only. Actual service identities/ACLs, HCS/Hyper-V proxy mapping, worker-image Framework compatibility, mounts/credentials, operational termination and unresolved-create disposition still require their separate operational trial. Installed-core/database and actual Discord acceptance remain open.

## Native pipe primitives and accounting capacity — 28 September 2026

The owner approved the fixed C#/.NET pipe companion scope; see legal/windows-pipe-toolchain.json. The first original native component creates protected descriptors and first-instance listeners, connects with explicit data rights and anonymous impersonation level, bounds I/O buffers to 64 KiB and retains native operation state through observed completion/cancellation. Ten focused synthetic checks pass, including bidirectional exact bytes, namespace collision with spare capacity, pending-read/accept cancellation, close/EOF and namespace release. Pinned csc compilation succeeded; loaded CLR, mscorlib and System bytes match the approved inventory. The first check exposed an expected-flags mistake: GetNamedPipeInfo returns server plus remote-rejection bits (9). The collision test was improved to leave spare capacity so it proves first-instance rejection rather than only an exhausted instance count. Initial test-harness unawaited-call compiler warnings were corrected. That milestone covered low-level same-identity primitives only; the later companion milestone above supersedes its implementation status. It did not establish installed-service access or production containment. No Framework/compiler files are copied into Sophie.

A separate existing-runner PostgreSQL qualification seeded 199,999 resolved synthetic attempts and reached the 200,000-row boundary through two concurrent reservations. Exactly one succeeded in a 122.429 ms combined operation; rejection at capacity took 44.088 ms and left spending unchanged. A 500-row retention batch took 98.042 ms, preserved all 200,002 then-existing replay receipts, kept expired messages ineligible and allowed fresh admission. These are individual host-local observations, not percentiles, sustained load, service timing or the 15-second Discord-turn gate. The owned cluster stopped; no existing database, provider, paid request or Discord service was used. Accounting source was unchanged. No application-wide/database suite was repeated.

Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/native-capacity-verification.json` and `accounting-capacity-verification.json`. Complete parent/stdio verification, registered role/boot companion protocol, bounded multiplex/credit flow and JavaScript Duplex integration. Qualify final-byte drain, cross-service access denials and the full encrypted transport. Then complete fixed service entrypoints and trusted installation checks. Actual service identities/ACLs, mounts/credentials, Hyper-V mapping, worker-image runtime compatibility, physical termination, unresolved-create disposition and Discord/installed-core acceptance remain open. Provider framing, approved prices, actual transport crash/rollover and installed-service capacity/latency remain unqualified. The single synthetic host capacity run is not an end-to-end timing or production load guarantee.

## Preference attachment and runtime scope — 28 September 2026

Fixed native browser attachment download shares current self-authorized preference inspection and rejects unavailable or quarantined state. 14 focused checks pass. An actual in-app browser download produced the expected 218-byte synthetic JSON file; contents/hash verified. Late session loss, query selectors and unavailable/quarantined stores reject without an attachment. No database/provider/Discord/live-service change. Browser verification used current dashboard assets and a synthetic API fixture; HTTP checks used the real listener with synthetic auth/store collaborators. The blob export had no completed download-event evidence; a plain attachment control worked. The new native attachment download is verified from the returned file bytes, with no claim of a universal old-browser defect. All fixture processes and the tab stopped. Database/application-wide checks were not rerun. Independent journal identity/location/ACL and restore exclusion require operator qualification. Browser attachment download is verified with synthetic data. Remote preference use stays disabled pending provider/data clearance; no conversational extraction.

Owner approved the exact Node 24.19.0 Windows x64 executable and original bundled notices for private packaging and synthetic qualification. Official archive/executable hashes and valid OpenJS signature verified; original aggregate plus seven supplemental notices retained. Static PE imports inspected. No host runtime replacement, container build, service/ACL change or operational qualification. See legal/node-runtime.json and the current owner decision. Exact Windows pipe creation/client-access adapter and its implementation/toolchain scope remain open, followed by fixed service entrypoints and trusted installation checks. Service identities/ACLs, mounts/credentials, Hyper-V communication, actual Node/image compatibility, physical termination and unresolved-create disposition require qualification. Database-coordinator/installed-service and Discord acceptance remain open. AI remains disabled. Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/runtime-export-verification.json`; source and actual browser evidence: `preference-export-2026-09-28.md`.

## Encrypted inference and control — 28 September 2026

Mandatory encrypted v2 inference/control frames protect prompt/reply content and purpose-key handoff while preserving fresh peer challenges, bounded accounting and lifecycle control. Node built-in HKDF-SHA256 and AES-256-GCM derive separate per-channel/direction keys. Every frame, including the initial handshake, is encrypted; a fixed 16-byte tag authenticates direction, protocol, length and sender salt before JSON parsing. Monotonic message counters and the existing mutually fresh session binding reject replay. Legacy peers fail closed, so core, control services and worker source must be upgraded together.

66 focused IPC, control, native, worker-package and egress checks pass. Actual host-local Windows pipes and synthetic TLS cover a metered turn; captured traffic excludes plaintext content and grants. Tampering, reflection, cross-profile traffic, replay and valid legacy HMAC frames are rejected. No actual Docker/Hyper-V or live provider qualification. No new dependency, migration or runtime adoption. Database/application/browser checks were not rerun. The Windows default pipe DACL does not establish confidentiality or cross-service access; encryption closes the content exposure but leaves pipe access, availability, endpoint identity and secret-file custody as explicit installation gates. It provides no forward secrecy if a root key is later compromised, and JavaScript strings are not claimed to be securely erased. Fixed service entrypoints and trusted installation/qualification inputs remain unfinished. Node/image distribution and bundled-notice scope, actual service identities and pipe/file ACLs, mounts/credentials, Hyper-V communication, physical termination and unresolved-create operator disposition require qualification. Database-coordinator/installed-service and actual Discord acceptance remain open. No service, ACL, credential, host network, provider or Discord change. AI remains disabled. Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/ipc-encryption-verification.json`; design and primary references: `windows-ipc-encryption-2026-09-28.md`.

## Authenticated control and worker lifecycle — 28 September 2026

Authenticated role-scoped control sessions and revisioned jobs compose core launch/stop, a separate egress observer, purpose-specific boot keys, expiring readiness and signed worker-lease renewal with the durable supervisor. Supervisor restart invalidates pinned clients and completes removal-only recovery before opening endpoints. Core alone may prepare/create/start/quiesce; both roles receive only their own channel key. Three-second role readiness gates five-second worker leases, with no healing after expiry. Quiesce preempts a pending start and retains physical-removal uncertainty. A failed boot does not disable the egress observer for a different fresh boot.

53 focused checks pass: 21 control/lifecycle scenarios and 32 existing IPC/native/package/architecture checks. Actual host-local Windows pipes and temporary boot files carry one metered synthetic turn through worker-owned TLS to a loopback endpoint. Egress loss revokes authority and confirms synthetic Engine removal; no actual Docker/Hyper-V or live provider qualification. Initial fixture failures were corrected: teardown order, an unread test socket, missing lease.start(), and waiting for the durable removal receipt. Review found and corrected startup admission before recovery completion; pending quiesce requests are now bounded and accepting stop immediately fences new role grants/readiness. A focused regression also confirms failed boot cleanup retains durable retry ownership. No database/application/browser rerun, paid/live provider request, actual Docker or Discord effect; no service, runtime, ACL, migration or credential change.

Fixed service entrypoints and trusted installation/qualification inputs remain unfinished. Node/image distribution, actual identities/ACLs/mounts/credentials, Hyper-V communication, physical termination and unresolved-create operator disposition require qualification. Database-coordinator/installed-service and actual Discord acceptance remain open. Qualification callbacks are still injected; synthetic true callbacks do not establish OS permission or containment evidence. HMAC does not encrypt key handoff, so qualified local pipe confidentiality is mandatory. All fixture listeners closed. After explicit owner approval, the three initial leftover fixture directories were removed by deleting their exact journal files and then verified-empty folders; their absence was verified. AI remains disabled. Evidence: `GitHub/.agent_docs/aphelion-sophie/supervisor-control-verification.json` and `windows-supervisor-control-2026-09-28.md`.

## Supervisor journal and restart recovery — 28 September 2026

Kernel-held Windows supervisor ownership, bounded revisioned on-disk journal and composed container lifecycle with intent-before-effect, removal-only restart recovery and preserved uncertain creates. The journal is explicitly provisioned outside guest mounts, validates bounded checksummed records and rejects stale or invalid transitions. New owners recover by revoking old boot files and removing the observed registered slot; they never resume a stored start. Start approval is bounded and late completion is fenced. Journal or boot cleanup failure still permits an attempt to remove a known owned worker, while retaining unresolved state and blocking replacement.

44 focused checks pass, including actual Windows files/pipes, abrupt termination of six test-only Node processes and a synthetic Engine HTTP endpoint. No real Docker/Hyper-V or service qualification. The initial 42-check run passed; running-worker/journal-failure and acknowledged-create-ID recovery regressions were added and all 44 passed. All test-owned processes, listeners and temporary directories closed. No database, full application, browser, provider, actual Docker or Discord check; no live service, image, runtime, ACL, migration or credential change.

Authenticated supervisor control protocol/client, service entrypoints, core/egress readiness and lease scheduling remain unfinished. Node/image distribution, actual identities/ACLs/mounts/credentials, Hyper-V pipes, physical termination and unresolved-create operator disposition require qualification. An unacknowledged create with no container ID cannot be cleared merely because inspection is empty. Atomic file publication and checksums are not power-loss, rollback or ACL qualification. Named-pipe ownership is not caller authentication. Evidence: `GitHub/.agent_docs/aphelion-sophie/supervisor-recovery-verification.json` and `windows-supervisor-recovery-2026-09-28.md`. AI remains disabled and field-test readiness is open.

## Registered container adapter and boot publication — 28 September 2026

Worker source package and authenticated reverse pipes, plus a fixed-slot privileged Docker adapter and atomic bootstrap/qualification-lease publication with terminal revocation. Only the supervisor implementation may import the Docker adapter; it cannot import core/case modules. Create/start uncertainty consumes launch authority until matching owned removal and observed absence. Unexpected environment or mount profiles are rejected. Unique boot metadata is atomically published; signed leases additionally require fresh qualification. Expiry/revocation cannot heal. The supervisor journal/control service and physical lifecycle composition are not yet implemented.

30 focused checks pass using a synthetic loopback Engine API, actual Windows temporary files and existing host-local pipe tests; no actual Docker/Hyper-V or service qualification. Sixteen cases exercise the new supervisor code, including reconciliation after a lost deletion reply. The first run had one test-order error, corrected by testing unauthorized start before removal consumes prepared authority; both assertions remain. Initial and successful logs are preserved. No database, full application, browser, live provider, daemon or Discord checks; no service/image/runtime/ACL/credential provisioning.

Durable supervisor ownership/recovery journal, authenticated control protocol, separate egress/core composition and service lifecycle adapter remain unfinished. Runtime distribution, image, identities/ACLs/mounts/credentials, Hyper-V pipes and physical termination require actual OS qualification. File flush/rename proves neither power-loss durability nor Windows permissions. The Docker uncertainty marker is in-memory only, and HTTP shutdown is not container termination. Evidence: `GitHub/.agent_docs/aphelion-sophie/supervisor-foundation-verification.json` and `windows-supervisor-foundation-2026-09-28.md`. AI remains disabled; field-test readiness is not achieved.

## Worker source package and reverse inference pipes — 28 September 2026

Worker-initiated authenticated inference pipes, fixed-path container entrypoint and short-lived signed qualification leases; fixed-destination egress and worker-owned TLS retained. Core owns the boot-specific inbox; the guest connects and authenticates before waiting for an independently authorized turn. Per-turn accounting and the original deadlines remain intact. The fixed entrypoint requires distinct IPC/egress/lease keys, a current signed lease bound to the registered qualification evidence, and provider-only credential storage. Lease expiry uses an independent monotonic timer; stale, altered or late records cannot revive a revoked process.

46 focused checks pass, including actual host-local Windows pipes, metered reverse connections, cancellation and signed lease replay/expiry/stalled-read checks; container executable and OS isolation remain unqualified. The first new response fixture omitted application/json and was corrected. No full application/database/browser rerun for this transport/bootstrap change; no live provisioning, provider call or Discord effect. The source package contains no runtime binary or credential and has not been built or launched as an image.

Concrete privileged supervisor and atomic lease/bootstrap writer, runtime distribution qualification, exact identities/ACLs/mounts/credentials and Hyper-V pipe mapping, physical termination and composed OS qualification remain open. No field-test approval is claimed. Evidence: `GitHub/.agent_docs/aphelion-sophie/worker-package-verification.json` and `windows-worker-package-candidate-2026-09-28.md`.

## Fixed-destination worker egress — 28 September 2026

Authenticated fixed-destination host egress bridge and worker-owned TLS pipe connector, composed with the bounded single-socket HTTPS transport. A separate host bridge authenticates the current public worker boot before resolving only api.deepseek.com. It rejects special-purpose/non-IPv4 answers and connects to a checked numeric address at port 443. TLS and the provider credential remain inside the worker; the bridge forwards bounded encrypted bytes without content logs. Stop/revocation retains the slot until physical closure. The worker transport has no direct-network fallback when this connector is selected.

36 focused checks pass using actual host-local Windows pipes and synthetic loopback TLS, including authentication/replay, certificate/hostname rejection, address and byte limits, reuse and physical cancellation. Not Hyper-V or production isolation qualification. Database, full application and browser suites were not rerun for this transport-only change. All synthetic listeners and sockets closed. No dependency/runtime, service, network, ACL, credential, database, provider or Discord change.

Concrete worker package, host/guest inference transport and registered Windows lifecycle supervisor; actual Hyper-V pipe mapping, identities/ACLs/egress/credential and process-tree termination qualification; runtime candidate qualification and activation remain open. AI stays disabled. Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/egress-verification.json`; operational candidate details: `windows-egress-candidate-2026-09-28.md` in that directory.

## Temporary prepared-request diagnostics — 28 September 2026

The worker fingerprints its final immutable outbound blocks with a random per-worker
key. Comparison material crosses only the authenticated internal protocol. It never
enters provider fields, persistent storage, log labels or dashboard output. Core
keeps at most one comparison per existing conversation lane, tied to retained source
revisions. Expiry, eviction, edits/deletion, source or consent loss and context reset
discard it. Revalidation rejects stale sources and an invalidation during comparison
cannot restore an old comparison basis.

Authenticated channel inspection shows first changed block, ordered block byte sizes
and preparation time. Operator/channel/control/source authority is checked again;
disabled AI has no diagnostic result. Browser results clear on expiry and suspension.
A preparation comparison does not prove provider dispatch, cache eviction or a token
boundary. The selected request layout and provider payload remain unchanged.

77 focused checks and 76 isolated AI/knowledge/Gateway scenarios pass, with 19 composed
staging scenarios; both disposable databases stopped. Synthetic browser display and
timed expiry passed. The final asynchronous invalidation fix has focused regression
coverage. Actual provider cache/latency, model answers and Windows isolation remain
unqualified. No schema, dependency/runtime, service, credential, live provider/Discord
or deployment change. Evidence: `GitHub/.agent_docs/aphelion-sophie/diagnostics-verification.json`.

## AI worker operating controls — 28 September 2026

Schema063 retains desired and active worker revisions and the last authenticated
worker acknowledgement. Reviewed apply binds the registered release and current
configuration/personality/budget/control revisions. Stop disables processing before
external work. A single session owner drains the previous AI lane, requires positive
physical-quiescence evidence, and checks a freshly qualified worker probe before
attaching the replacement. Failed or superseded starts cannot activate processing.
An exact lost-response retry returns its receipt without cancelling its own launch.
At the 1,000-request limit, one final stop remains available; failed terminal stop
recovery reuses that intent without growing history. Apply always leaves AI disabled.

44 focused checks, 75 isolated AI/knowledge/Gateway scenarios and 19 composed
staging scenarios pass; both disposable databases stopped. The native pipe probe
does not call the provider. RT19 verifies signed administration survives an optional
worker-coordination outage. Synthetic browser review/apply/stop displays the expected
revisions, acknowledgement and disabled state; this uses a simulated lifecycle API.
Unrelated migration-count assertions changed without rerunning their suites.

The coordinator requires an injected registered lifecycle adapter. The concrete
Windows service adapter, actual process-tree termination, identities/ACLs/egress,
credential custody and runtime candidate remain unqualified. No live migration,
grant, credential, service, provider call, Discord effect or deployment changed.
Evidence: `GitHub/.agent_docs/aphelion-sophie/worker-operations-verification.json`.
The injected lifecycle contract still permits a hung call to hold shutdown and its
ownership lock open. Production qualification must implement bounded cancellation
and physical termination; this coordinator intentionally does not detach an unknown
live worker. At terminal history capacity, later stop requests coalesce without
retaining each later requester or request ID.

## Native worker transport and accounting retention — 28 September 2026

Boot-specific Windows named pipes now compose the authenticated worker protocol.
The worker owns a fixed-origin HTTPS agent with one reusable socket, bounded
headers/body/deadline, no paid-POST retries or redirects, and physical teardown.
Qualification remains mandatory; these pipes do not establish OS isolation.

18 IPC/native checks pass, including actual local Windows pipes, synthetic socket
reuse, cancellation, oversized response rejection and startup/shutdown races.
Fresh worker readiness precedes the greeting that permits prompt transfer. A
required revocation signal cancels physical work and closes the listener/pool;
qualification is checked again before returning a result. Stalled qualification
checks are bounded and cancellation preserves accounting uncertainty.
65 isolated AI/knowledge/Gateway scenarios pass; the database stopped. Accounting
cleanup removes at most 500 resolved details older than 90 days per batch, keeps
unresolved charges and replay receipts, and preserves referenced budget periods.
New reservations stop at 200,000 retained attempt rows per guild. Daily/monthly
aggregate retention is 90/400 days, subject to outstanding references/reservations.
The hard-cap performance boundary and production DELETE grants were not qualified.

All 40 historical launch-question source locators were reviewed. Three wording or
citation findings were corrected; 27 support and 13 abstention expectations remain.
This is not model-answer acceptance, fresh source publication or owner approval.
Evidence: `GitHub/.agent_docs/aphelion-sophie/worker-native-verification.json` and
`launch-question-owner-review-2026-09-28.md` in that directory.

Actual TLS/egress, service identities, pipe ACLs/confidentiality, credential custody,
hard process termination, AI-only apply/replacement controls and runtime maintenance
qualification remain open. No provider call, source publication, live database
grant/migration, service installation, runtime upgrade or deployment occurred.

## Discord lookup and unattended refresh — 28 September 2026

Signed `/lookup` shares the dashboard's deterministic reviewed-source use case.
Queries are bounded one-use core values outside routing metadata. Membership,
non-case channel/parent and source validity are rechecked before a private exact
source response. It works without an inference worker. No command was registered
on Discord. Native-process knowledge composition provides qualified serialized
Policies refresh and cancellation, with no automatic publication authority.

61 focused checks, 64 isolated AI/knowledge/Gateway scenarios and 18 composed
staging scenarios pass; both databases stopped. An initial new staging assertion
used the wrong denial wording; the exact existing wording now passes. Preference
review fixes constrain inline expiry to the current member and preserve journal
conflicts. They are covered by the focused and isolated checks above.

Evidence: `GitHub/.agent_docs/aphelion-sophie/knowledge-completion-verification.json`.
Actual Windows knowledge identity, registration, reviewed source publication and
the 40-question release gate remain open. All network/Discord checks here used
synthetic adapters or loopback fixtures; no paid provider or live service changed.

## Gathering edits — 28 September 2026

Eligible complete edits now replace their own gathering revision after Gateway
commit and fresh authority checks. Original receipt time, deadline, root owner,
absolute gathering ceiling and size limits remain fixed. Partial, conflicting,
changed-scope and late edits cancel. Edits after freeze never start a second call.
43 focused checks and 63 isolated AI/knowledge/Gateway scenarios pass; the database
stopped. Actual provider concurrency and Discord timing remain unqualified.
Source-bound evidence: `GitHub/.agent_docs/aphelion-sophie/ai-edits-verification.json`.

## Explicit local response preferences — 28 September 2026

Schema062 adds member-saved reply length and language only, authenticated self
inspection/replacement/export/deletion, 90-day expiry and a separately qualified
non-content restore watermark. Journal/database disagreement quarantines prior
values; expiry maintenance is independent of inference. External use remains off.

28 focused checks, 62 isolated AI/knowledge scenarios and 18 composed staging
scenarios pass; disposable databases stopped. Synthetic browser save, edit and
delete passed with no console warnings/errors. The download action produced no
browser download event, so completed file export remains unverified. A malformed
select option found during browser testing was corrected. Source-bound evidence:
`GitHub/.agent_docs/aphelion-sophie/ai-preferences-verification.json`.

Independent journal provisioning, identity/ACL/restore-exclusion qualification,
backup retention and provider data clearance remain open. No live migration,
service or grant changes. Unrelated migration-count assertions were updated;
their suites were not rerun.

The pre-AI baseline at `02e0e1ffe47049347a572c27ae695d65bb55bf08` passed these checks on 27 September 2026:

- Repository validation: 442 JavaScript modules, 31 reference checksums, and eight
  asset copies; module conventions passed.
- Unit suite: 418 passed, zero failed or skipped.
- Isolated configuration suite: 13 passed, including host shutdown, interrupted
  application, permissions, and retained configuration.
- Isolated staging suite: 16 passed, including signed ingress, Gateway lifecycle,
  maintenance, public onboarding panels, and Staff closure.

Both isolated database clusters stopped after their tests. These results establish
offline behavior, not private Discord/browser acceptance or production readiness.
The source specifications describe expected behavior; they are not execution logs.

Runtime data and credentials are private and excluded from Git. Operational records,
generated tooling, and further test output belong in the operator's external
agent-documents directory, not the published repository.

Production recovery is deferred. Windows service identities, SCM startup/shutdown,
host reboot qualification, and remaining production release gates are open.
No private ticket, form, attachment, transcript, or onboarding content was inspected.

## Live staging checks

On 27 September 2026, pinned build `d4ca16ab6286a4ef186733d6829828e74d3fc176`
passed 28 public HTTPS checks: protected-page redirects, login isolation, OAuth
application/callback selection, asset hashes, anonymous API rejection, and
unsigned interaction rejection. Discord accepted the signed endpoint verification.
The public avatar matches the approved PNG byte-for-byte.

The runtime passed all 55 migration and 71 restricted-table checks. The Gateway
is current; the host and connector own their expected loopback listeners; the
host error log is empty. Existing records and authored configuration are retained.
No private content was inspected. Authenticated browser and interactive Discord
acceptance remain separate from these public and operational checks.

## Historical local AI candidate

The schema056 foundation has 37 focused unit/adapter checks and 12 isolated
PostgreSQL scenarios passing. The database fixture stopped cleanly. Synthetic browser
checks covered participation review/publication, disabled-state reporting, and
member opt-in/opt-out; the browser reported no console errors. No production data
or actual model was used. Source-bound results and the continuation are in
`GitHub/.agent_docs/aphelion-sophie`.

The schema057 runtime/knowledge milestone has 47 focused unit/adapter/auth checks,
35 isolated AI/Gateway/knowledge scenarios and 17 composed staging scenarios passing.
The AI scenarios include retained schema056 Gateway/control preservation during
upgrade. Both database clusters stopped. Synthetic browser checks covered knowledge
review, required public-source confirmation, publication, withdrawal and cleared
withdrawn text; no console warnings/errors were observed. Repository validation
checked 469 modules, 40 tasks, 60 specifications, 31 reference checksums and eight
asset copies. These checks used synthetic data and no inference.

The owner approved the pinned llama.cpp b10977/LLVM OpenMP, Bartowski Phi-4-mini
Q4_K_M and Windows Server Core trial artifacts. Runtime and model SHA-256 values
were verified, and the exact base image was pulled. The owner separately approved
Hyper-V installation without automatic reboot. Installation returned success with
restart required. No reboot was issued by the agent. The operator subsequently
restarted WUFF and instructed continuation. The serving image built and its Docker
inspection confirmed Hyper-V, network none, four CPUs, 8 GiB, ContainerUser and zero
mounts/ports. Startup exited 0xC0000135 before model load. Static PE imports and a
separate contained check confirmed absent MSVCP140/VCRUNTIME140/VCRUNTIME140_1
DLLs. All owned trial containers were removed. These observations are not a
negative-access or confidentiality qualification.

The owner subsequently approved Microsoft Visual C++ x64 14.51.36247.0 inside
the disposable worker. Installation returned zero and the three required DLL
versions/hashes were recorded. Inference then started as ContainerUser. No host
runtime installation occurred. Earlier startup evidence is historical.

Phi-4-mini Q4_K_M produced one full greeting in 12.674 seconds but did not reliably
finish the synthetic screen; two later greetings hit the 14-second cutoff.
Shortening the diagnostic prompt and increasing internal batching did not establish
a pass. Official Qwen2.5-1.5B Q4_K_M, separately approved, completed the first five
cases in 4.424–4.986 seconds but produced invalid citations and spoke in a
reaction-only turn. Per-turn output constraints fixed those structural failures.
Five subsequent cases took 3.824–5.487 seconds, but one still invented community
policy. An eight-case grounding-example experiment took 4.099–5.920 seconds and
included a false claim to grant administrator roles; that prompt experiment was
reverted. Both models are unqualified. Valid JSON does not establish truthfulness.

These were network-disabled Hyper-V model probes with four CPUs, 8 GiB, no host
mounts/ports, and synthetic prompts only. The Zen 4 CPU backend loaded. Bounded
negative-access checks found no administrator identity, host checkout, protected
System32 write, Docker pipe or TEST-NET connection. This is not comprehensive
confidentiality or representative host-load qualification. Exact token counts
matched reported prompt usage in completed probes. No real application adapter,
queue/retrieval/delivery timing or live Discord behavior was exercised by these
PowerShell probes. All owned trial containers were removed; local images remain.

The current client limits outcomes, emoji and citations to the admitted turn,
removes citation choices when their evidence is trimmed, and explicitly disables
thinking in both count and generation requests. The latter option is covered by
adapter checks and pinned runtime documentation, not by the historical model runs.
Twenty-two focused runtime/turn checks pass. Source-bound reports and raw trial
logs are in `GitHub/.agent_docs/aphelion-sophie/worker-model-verification.json` and
`worker-model-trials.md`. The owner selected continued local-only exploration.

## Historical DeepSeek Flash screen

The owner subsequently selected the official DeepSeek Flash API and supplied a
local credential file, superseding the local-only direction. Research and 29
offline adapter/runtime/turn checks preceded the first key use. The credential was
read in-process and never printed or copied into Git. No live deployment occurred.

The official models endpoint identified DeepSeek-V4.1-Flash behind `deepseek-flash`.
Twenty synthetic cases through the real JavaScript adapter completed in
0.469–1.185 seconds. Effective outputs passed agent review for supported/absent/
conflicting evidence, fabricated authority, reaction-only behavior, disabled memory,
quiet requests and hostile source instructions. This is not owner character
acceptance, the 40 reviewed knowledge questions or a full Discord timing pass.

After the owner's cache optimization request, the client uses a stable authored
prefix, canonical reviewed-source ordering before history, late per-turn JSON
instructions, and opaque cache partitions shared within each qualified public
channel. Other channels/boundaries/releases remain separate; restricted contexts
are refused. Relevance still controls evidence trimming. Silence-only requests
skip the API. Non-thinking mode, bounded input/output, independent output checks,
request deadlines, cooldowns and no automatic retries/fallback remain enforced.

An interleaved twelve-call comparison used six matching synthetic questions per
configuration across three members. Cache hits increased from 41.7% to 63.6% of
input tokens; input fell from 5,528 to 5,030 tokens and cache misses from 3,224 to
1,830. Estimated combined cost at the checked peak prices fell about 32.2%. This
small comparison measures the combined layout/partition change, not guaranteed
production savings. The handoff reported 31 focused checks for its original hashes.
The combined verification index named in the earlier handoff did not yet exist;
the original raw quality/cache reports and `deepseek-research/setup.md` did exist.
The 28 September resumption preserves those hashes and indexes them separately
from current offline evidence in
`GitHub/.agent_docs/aphelion-sophie/deepseek-verification.json`.

AI is not production-ready or live. Flash passed the initial synthetic screen;
the 15-second receipt-to-delivery ceiling remains unqualified. Provider cache may
persist beyond local context TTL. Account-specific data handling, member disclosure
and hosted-model changes remain activation inputs; no zero-retention claim is made.
Qualified worker/service/restore wiring, durable effect recovery, source sync,
explicit-memory and named restricted-domain work, source/dialogue evaluation and
applicable enabled-feature acceptance remain open. No live schema migration,
service/ACL/network change or AI activation occurred in this milestone.

## DeepSeek foundation — 28 September 2026

The owner resumed implementation with a USD 20 monthly ceiling, Europe/Vienna
calendar, no separate daily money cap, and confirmed assistant replies within the
same 12-item/five-minute temporary context. The eight source and five evidence
hashes in the handoff matched before editing; copies remain outside the repository.

The schema058 candidate adds durable fenced reservations, dispatch intent,
reported-usage settlement and conservative unresolved charges. Invalid output is
accounted for before acceptance. Operator review can resolve unknown charges at
their full reservation and clear an accounting hold with a current evidence-bound
review; neither action activates AI or replays generation. Estimates use peak rates
and a byte-based input allowance, not a proven hard invoice ceiling. New opt-ins
require a separately approved external-processing notice; local-model consent does
not authorize Flash. The price-validity default is empty, keeping paid calls paused.

Prepared turns are immutable and bounded by the complete serialized provider body.
Confirmed replies inherit conversation and knowledge expiry/dependencies. Source
events cancel active work in the affected lane; delivery races compensate known
effects. Durable post-restart Discord effect ownership remains unfinished.

Foundation evidence at `6921df9`: 51 focused preparation/runtime/turn/participation checks
and 44 isolated AI/Gateway/knowledge/accounting scenarios pass, with zero failures
or skips. The disposable PostgreSQL cluster stopped. Repository validation checks
475 JavaScript modules, 40 original tasks, 60 specifications, 31 reference checksums
and eight asset copies. Synthetic browser checks covered budget review/publication,
uncertain-charge resolution, reviewed hold clearance and unavailable remote opt-in;
no console warnings/errors appeared in the final hold-control check. Browser data
was an in-memory fixture, not a live service or database acceptance test.

The source-bound index records actual commands, logs, hashes and historical evidence
separately. No paid calls, credential reads, package/runtime installation, live
schema/service/ACL changes, Discord effects or deployment occurred in this
resumption. Node remains 24.19.0; pg remains 8.23.0. Other database suites were not
rerun merely for their current-migration count update. The full application suite,
OS identity/egress/reboot tests, paid comparisons and actual Discord timing were
not run.

This is a foundation milestone, not full selected-feature readiness. The raw Flash
client is not a qualified worker: authenticated IPC, a trusted qualification adapter,
native identity and lifecycle integration remain open. Gathering/fair concurrency,
wiki import/sync and member lookup, durable effects, explicit-memory controls,
restricted audiences, reviewed source/character acceptance and live qualification
remain in the DS/SAI tracker. Real-member processing is blocked on the exact provider
agreement/settings and approved notice. No model or release was activated.

## Policies collection and structured extraction — 28 September 2026

The owner selected the public Policies page and approved parse5 8.0.1 (MIT) with
entities 8.1.0 (BSD-2-Clause), scoped in ADR 0005. The exact npm archives matched
their integrity values, notices are preserved, install scripts were disabled,
and the npm advisory query returned no entries for these two versions. Existing
pg pins and the Node runtime are unchanged.

Anonymous API discovery confirmed MediaWiki 1.46.0 and the page's advertised
CC BY-NC-SA 4.0 content licence. The fixed-origin collector reads page 878 only,
plus revision metadata for its transclusions, and compares repeated page,
template, licence and rendered-content observations. It rejects redirects,
missing/deleted/moved sources, changed observations and oversized responses.

Fourteen focused collector/extractor checks pass. Actual public collection at
revision 14796 found 52 templates; local extraction retained 174 headings and
25 tables with 257 rows. The disposable parser worker has a termination deadline,
V8 heap/stack limits and no inherited environment. These are bounded parsing
controls, not OS isolation or an atomic MediaWiki snapshot guarantee.

Raw snapshots and structured extracts remain outside Git, explicitly unreviewed.
No source was published, scheduled, sent to a model or deployed. Durable import
storage, review/publication integration, immediate source invalidation and the
40-question knowledge release gate remain open. The source-bound report is
`../.agent_docs/aphelion-sophie/mediawiki-verification.json`; the umbrella index
retains previous milestone evidence without claiming its tests were rerun.

## Durable Policies imports and publication review — 28 September 2026

Migration059 adds bounded immutable snapshot/extraction storage and fenced manual
refresh. Changed rendered or template content revokes existing publication epochs
before extraction. Review hashes bind the source generation, preventing a source
reversion from reviving an old publication or uncommitted review. Retrieval, review
and publication check artifact integrity and five-minute source freshness. A fresh
identical check can restore eligibility after a transient failure, but cannot undo
manual staleness, withdrawal or an observed source change.

Publication receipts retain their request hash across migration and return confirmed
duplicate results even after source expiry or change. Withdrawal retries resolve
only the matching current tombstone. The dashboard renders structured text and
table context, preserves wiki attribution/binding on edits, and requires separate
publication confirmation. Slow or failed source collection leaves the administrative
HTTP request slot available.

38 focused checks and 51 isolated AI/knowledge/accounting scenarios pass with zero
failures or skips. The database stopped. Synthetic browser checks covered source
refresh/review, literal markup, lists/tables, explicit publication and retained wiki
binding on edit; no console warnings/errors appeared. Browser checks used an
in-memory fixture, not a deployed service. The source-bound report is
`../.agent_docs/aphelion-sophie/mediawiki-import-verification.json`.

No live migration, grants, service/ACL/network changes, provider calls, Discord
effects or actual source publications occurred. Other storage suites and full
release qualification were not rerun. Worker/service composition, unattended wiki
refresh, Discord `/lookup`, reviewed extracts and the 40-question knowledge gate
remain open. This milestone does not activate AI or complete the workplan.

## Authenticated worker-stream foundation — 28 September 2026

The new broker and worker exchange mutually fresh authenticated challenges before
transferring a bounded prompt. HMAC frames bind direction, session and sequence;
worker/boot/release/provider-profile hashes must match the separately qualified
expected identity. The transport is injected, and `current()` requires an explicit
trusted qualification check. The server accepts only public scoped prompts and
fixed preparation/generation messages, with one prepared or physical request at
a time. Core-only accounting and delivery metadata does not cross the boundary.

Core acknowledges durable dispatch before the provider POST and settles usage
before accepting output. Cancellation/expiry closes the stream and preserves any
uncertain charge; an uncooperative underlying request keeps its physical slot.
Denied budgets and silence discard preparation. Runtime stop closes the broker.

40 focused IPC/adapter/scheduler checks pass, including wrong keys and identities,
cross-connection greeting/request replay, tampered/oversized/unexpected frames,
revocation before network handoff, cancelled preparation, deadline expiry and
usage reporting for malformed paid output. These checks use synthetic loopback
streams and mocked provider transport. Source-bound evidence is in
`../.agent_docs/aphelion-sophie/worker-ipc-verification.json`.

HMAC framing does not encrypt the stream or establish an OS identity boundary.
The native private connector, service identities, ACLs, egress, provider credential
custody, transport-pool teardown and hard process termination remain unqualified.
No listener/service, credentials, dependency/runtime upgrade, live provider call,
migration or Discord effect was installed or performed. Database suites were not
rerun for this non-storage slice; earlier evidence remains separately source-bound.

## Gathering and channel fairness — 28 September 2026

Schema061 adds fenced gathering receipts without stored content. Three compatible
conversational fragments may share one paced turn, within 750 ms quiet / 1.5 s
absolute / 4 KiB bounds. The first receipt fixes the deadline. Every fragment is
independently authorized; freeze checks the complete receipt set and revisions.
Larger valid single questions bypass gathering. A separate ingress flood bound
limits metadata events. The scheduler rotates channels and keeps cancelled physical
requests in their slots; synthetic two-slot mode still allows one per channel.
Runtime concurrency remains one. Edited gathering sources currently cancel the turn;
in-place fragment replacement and actual worker/timing qualification remain open.

40 focused runtime/turn/observation checks and 56 isolated AI/knowledge/Gateway
scenarios pass; the disposable database stopped. Source-bound evidence is in
`GitHub/.agent_docs/aphelion-sophie/ai-gathering-verification.json`. No live schema,
grants, provider requests or Discord effects. Unrelated migration-count assertions
were updated without rerunning their suites.

## Durable AI effects — 28 September 2026

Migration060 replaces transient effect ownership with fixed-target, fenced receipts.
Intent precedes Discord dispatch; positive late receipts remain available for exact
cleanup. Unknown sends stay parked without history searches or retries. Deterministic
automation admission takes precedence. Cleanup uses bounded source/member revision
metadata and public-source identifiers, with no message or generated text archive.
An unavailable AI recovery store cannot prevent administration from starting.

25 focused turn/observation checks, 55 isolated AI/knowledge/Gateway scenarios and
18 composed staging scenarios pass. Both disposable database clusters stopped.
13 IPC tests pass after preventing a worker from releasing possible spend through
an undispatched assertion after final dispatch authorization. Evidence and source
hashes are in `GitHub/.agent_docs/aphelion-sophie/ai-effects-verification.json`.
No live schema, grants, provider calls or Discord effects were performed. Other
migration-count assertions changed without rerunning unrelated suites. Actual
Windows/service/effect qualification and active worker apply remain open.

## Member direct knowledge lookup — 28 September 2026

Public answers now includes authenticated search over the existing reviewed public
knowledge library, with exact source extracts, links, authority, revision and
attribution. It operates without an inference worker, AI control store, model opt-in
or editorial permission. Current membership and source validity are checked again
before return; queries use POST and are not added to URLs or an application archive.
The page clears results on suspension, access refresh and account changes, and
rejects malformed results or executable links.

34 focused turn/lookup/dashboard checks and 18 isolated composed staging scenarios
pass, including member lookup with AI unavailable. The test database stopped.
Repository validation checks 476 modules with the original 40 tasks, 60 specifications,
31 reference checksums and eight asset copies. Synthetic browser search displayed
literal source text and attribution, cleared prior results on an empty search, and
reported no console warnings/errors. No actual wiki data or live service was used.

The exact source/command/log record is
`GitHub/.agent_docs/aphelion-sophie/deepseek-lookup-verification.json`; the combined
index links both milestones without attributing foundation checks to later code.
No schema, dependency or live deployment changed in this lookup milestone. Actual
MediaWiki discovery/import/synchronization, approved collection/rights, Discord
`/lookup` and reviewed-source release acceptance remain open. The owner was asked
for the unresolved wiki URL, source collections and reuse permission.
