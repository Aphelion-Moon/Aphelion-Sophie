# The Shuttle Activity

Scope: P40–P44. Owner decisions: "The Shuttle becomes an Activity" (21 October 2026, D1–D10), "Shuttle Activity
application and hostname", "Shuttle Activity: SDK, testers and the ticket switch" and "Shuttle Activity second pass:
moments, viewscreens and arrival links" (22 October 2026), all in
[0001](decisions/0001-owner-policy.md). Scenes: [shuttle-activity-scenes.md](shuttle-activity-scenes.md). Sounds:
[shuttle-activity-sounds.md](shuttle-activity-sounds.md). Closed screen: [shuttle-activity-closed-screen.md](shuttle-activity-closed-screen.md).

The Shuttle as a Discord Activity: an animated ASCII visual novel in which Sophie, as a radio voice, reads the published
Shuttle copy stop by stop, ending at a pressure door that opens once Discord confirms Whitelist. It shows the same copy
and keeps the same rules as the channel Shuttle. No AI is involved anywhere in it, and it holds no ticket or case data.

## How it fits together

```
Discord client ──frame──▶ <app>.discordsays.com ──URL mapping──▶ onboarding.a13.info ──tunnel──▶ core (loopback)
      │                                                                                        │
      └─ Embedded App SDK (in the page): ready, authorize, authenticate, presence, layout/heat ──┘
```

Only core holds the Discord token, so the Activity's server is a listener inside core, off unless the runtime
configuration has an `activity` block:

```json
"activity": { "origin": "https://onboarding.a13.info", "port": 38125, "status": "testing" }
```

It needs the dashboard's OAuth configuration (the same application and client secret) and a port of its own.

| Piece | Where |
|---|---|
| Listener: client files and JSON routes | `apps/core/http/activity.js` |
| Sign-in and bearer tokens | `apps/core/security/activity-auth.js`, `exchangeActivity` in `apps/core/discord/oauth.js` |
| Tester gate | `shuttle.activity.test` in `apps/core/security/authorization.js` |
| Activity runs | `apps/core/storage/shuttle-activity.js`, migration `074-shuttle-activity-runs.sql` |
| Run view, stop scenes, configuration | `modules/onboarding/activity.js` |
| Moments and viewscreens (format) | `modules/onboarding/activity-media.js`; content in `content/shuttle-activity/moments.json` and `viewscreens/`, written by `scripts/author-shuttle-viewscreens.mjs` |
| Layout editor (scene per stop, moments, arrival list) | `modules/onboarding/activity-layout.js`, `apps/core/storage/activity-layout.js`, migration `075-activity-layouts.sql`, `apps/core/http/activity-layout.js`, dashboard page `/activity` |
| Channel links | `apps/core/discord/activity-channels.js` |
| Shipped content core reads at start | `apps/activity/content.js` |
| Rules post | `modules/onboarding/activity-post.js`, `/whitelist post`, banner provenance in `content/shuttle-activity/rules-post-banner.json` |
| Client | `apps/activity/client/` (page, controller, presenter, markdown, sound, SDK adapter), `apps/activity/scene-*.js` |
| Files the client may load | `apps/activity/client-assets.js` (page, module graph, SDK, font, scenes, viewscreens, moments, sounds; pinned hashes checked) |
| SDK | `apps/activity/vendor/embedded-app-sdk/`, pinned in `legal/embedded-app-sdk.json` by `scripts/vendor-embedded-sdk.mjs` |

## Routes

All on the Activity host only (others get 421). Responses are JSON with `Cache-Control: no-store`; refusals are fixed
words, never codes, IDs or messages.

| Route | What it does |
|---|---|
| `GET /api/config` | The public application ID the SDK needs, and the server ID for channel links. |
| `POST /api/session` `{code, instanceId}` | Exchanges the Discord code (no redirect URI; only `identify` and `rpc.activities.write`), checks the instance with the bot token (this server, this member in it) and that the member is present, then issues a one-hour in-memory bearer token. The Discord access token is returned once for the SDK and never stored. 60 sign-ins a minute at most. |
| `POST /api/session/end` | Forgets the token. |
| `GET /api/shuttle` | What to show: `closed`, `unavailable`, `elsewhere`, `unpublished`, `ready` (with the stops) or `run`. A run carries the current stop's moments, `channels` (channels its copy names that the member can see) and, once Whitelist is confirmed, `arrival`. |
| `POST /api/shuttle/board` `{requestId}` | Starts a run, or resumes the current Activity run. |
| `POST /api/shuttle/act` `{requestId, action, expectedVersion}` | `advance`, `back` or `retry` (Check) on the current Activity run. |

Every Shuttle request resolves the member through core principals, reads Discord afresh and authorizes again in the
store. A click keeps one `requestId` through its retries; receipts make a repeat change nothing.

The dashboard serves the layout editor at `GET /api/activity-layout` and `POST /api/activity-layout/publish`
`{requestId, expectedVersion, document}` (guidance publishers, `shuttle.publish`, with the dashboard's session and
CSRF checks).

## Channel links

Channel references in a stop's copy (`<#id>` mentions and `#channel-name` text) become chips, and after Whitelist is
confirmed the arrival screen lists "Now open to you": the curated list from the layout editor, or, without one, the
channels the final stop names. Core keeps only text, announcement and forum channels the member can view at that
moment, computed from their current roles and the channel's overwrites (`channelPermissions`), with the channel list
cached for at most 15 seconds. A hidden channel's name never reaches the client. If Discord cannot be read, the run
shows no chips and an empty arrival list, and the Shuttle carries on. A chip opens
`https://discord.com/channels/<server>/<channel>` through the SDK; if Discord does not open it, the Activity says which
channel to look for instead.

## Layout editor

Dashboard → Shuttle → Activity layout (`/activity`), for guidance publishers. For each published stop: the scene
(default by position), and per section heading a moment (a beat the chosen scene draws, or the plain scene) with an
optional viewscreen and an optional scene for that section (its beat must then be one that scene draws). Plus the curated arrival list: up to 12 channel IDs with notes of up to 120 characters. Each
publish is a numbered version with who published it and a digest; a stale version or a reused request key is refused,
beats must belong to the chosen scene and stops must be published stages. Until a layout is published, the shipped
defaults in `content/shuttle-activity/moments.json` apply. A layout is presentation only: it never changes a run, a
permission or the copy.

## Who gets in

- **Testing** (`status: "testing"`): the server owner and current holders of the lead ops role. Read from Discord on
  every request; removing the role closes the Activity for that member on their next request. Everyone else sees
  "Not boarding yet".
- **Open** (`status: "open"`): every member who may use the Shuttle. Muzzled or timed-out members see a fixed
  "can't board right now" notice.

## Station counts and the boarding pass

From the last stop on (and once a run is pending or finished), core adds two things to the signed-in member's own run
view: `station`, the server's approximate member and online counts (`GET /guilds/{id}?with_counts=true`, cached for
five minutes), and `pass`, that member's own nickname, global name or username and the date they joined (a fresh
member read, cached for 60 seconds per member). Both are read by core with the bot token, kept only in memory, never
stored, logged or sent to anyone else. If Discord cannot be read the fields are left out (fault codes
`ACTIVITY_STATION_UNAVAILABLE` and `ACTIVITY_PASS_UNAVAILABLE`) and the Shuttle carries on. Scenes can show only the
counts (`{crew}`, `{online}`); no member detail ever enters a scene.

## Runs

An Activity run is an ordinary Shuttle session with the same domain rules, nonce rotation, receipts and Whitelist grant
effect as the channel Shuttle, but no Onboarding channel or case (so no case quota). `shuttle_activity_runs` marks which
sessions the Activity drives.

- A member whose current run belongs to a channel is told to finish it there (`elsewhere`).
- A run from an earlier membership, or on withdrawn guidance, never continues: boarding starts a fresh run.
- The last Continue requests Whitelist; the client polls and shows "requested" until Discord confirms the role, then
  the door opens. A finished run is shown as arrived only while Discord still shows Whitelist.

## The client

Splash ("press any key"), then the menu, both inside a terminal window drawn in the animated hangar's console, which
fills the window (no reading column on the main page). The menu numbers its choices (1 to 9 pick one) and ends with
the Tip of the Round. The hangar's Shuttle Link panel says only what the server last reported (ready, not boarding yet, finish in your channel, held, arrived, no
signal). Each stop has its scene and ambience; Sophie's transmissions on the `COMMON · 145.9` radio are the stop's
published pages split into screen-sized pieces (every character, in order). A new piece starts at every heading, so
each section opens a page of its own and the scene stages exactly the section being read.

- **The story (fourth pass, 22 October 2026).** The guidance itself is written as a story in a casual voice: Sophie,
  a tired dispatcher on the radio, talks the member through five stops while two companions, Rook (a returning
  veteran) and Pip (a first-timer), travel with them: they meet at the bags, board and sit together, learn on the
  deck, and part at the door. The scene shows, Sophie and the companions tell, and in-world signs pin down the
  must-know facts. The source is `content/onboarding/story.md`; `node scripts/build-onboarding-story.mjs` turns it
  into `content/onboarding/story-definition.json` (a draft Shuttle definition with Discord-sized messages) and a
  preview. It is static, authored copy with no AI, and members see it only once a guidance publisher publishes it as
  a new Shuttle version in the dashboard editor. `tests/onboarding-story.test.js` checks the meaning checklist (every
  rule and fact the old text carried), message sizes, and a list of banned phrasings.
- **Signs and lines.** A quote block whose first line is a bold `NOTICE · …` label shows as a sign card, and a line
  opening with a bold `Name:` shows as a dialogue line with a name tag. Discord shows the same Markdown as a quote and
  bold names.

- **Pacing.** Each event plays a cue sheet (`cueSheet` in `presenter.js`) so pieces filter in: a new stop sounds the
  departure, wipes to the new scene (after a skippable 1.5 s ride between stops when motion is on), cross-fades the
  ambience, then the roger beep, then Sophie and the text. Sophie's radio (static, voice meter, ticks) runs for about
  half the page's typing time at the chosen speed (`speechMs`: normal speed when text shows at once), from 2 s to 6 s,
  then trails off over 1.5 s while the meter shrinks; music ducks about 6 dB under her. Pressing Next during a cue
  sheet skips to the text.
- **Layout.** On the main page the hangar fills the window, and the page lays its splash prompt and menu over the
  scene's `menu` slot (the inside of the terminal window) from the live cell size. While reading, a column on the left
  holds the status window and Sophie's transmission; the scene has the rest of the window to itself (on phones it sits
  above the column, below the menu button). The menu button is fixed to the window's top right corner.
- **Depth.** Standing objects (signs, desks, carts, seats, the shuttle's hull, vending machines) are drawn in front of
  people: anyone walking past goes behind them.
- **Status window.** A fixed-size box: Sophie's radio standing by (name, callsign and a voice meter that moves while
  she speaks; she is not depicted), or, while the section being read has extra material, that material instead. V
  switches back to the radio for that section. At the last stop and on arrival, when no extra material is showing, it
  shows the member's own **boarding pass** instead of the radio: their server display name, "In the server since"
  their join date, and their Whitelist status. Station announcements lie over its bottom edge for a few seconds.
- **Station board.** Disembarking's scene shows the server's approximate member and online counts.
- **Moments.** A section heading can stage a beat in the scene and name a viewscreen for the status window: original
  ASCII art with https link cards (`moments.json`, or the published layout). A key starting with `~` is a phrase, so the
  page containing it stages the moment (kept for the published copy, where Ten Thousand follows the page that links
  the comic; the story gives it a section of its own). A moment can also name a scene of its own, so a section
  changes scene behind the usual wipe, with that scene's announcement and ambience (each section of Board the Shuttle
  has its own). Scenes play their own event sounds (the THUMP, the shutter, a stamp). Clearance adds "The HoP is
  processing your ID card…" with a stamp.
- **Section counter.** The scene's section strip counts the stop's top-level sections; the page dots in the reading
  column count pages.
- **Title sections.** Station log (this run's transmissions), Codex (a fixed glossary), Settings and Credits. "?" shows
  the keys; L opens the log.
- **Settings:** volume, music, ambience, radio and effect levels, sound on/off, motion, typed or instant text, text
  speed, text size.
- **Input:** arrows, 1 to 9 on the main menu, Enter/Space, Backspace, Escape, swipe on touch screens; 44 px tap targets
  (40 px on phones).
- Presence shows "Riding the Arrivals Shuttle" and the stop number only. Links in the copy open through Discord's own
  confirmation, and only https links are links. `:wink:`-style shortcodes show as emoji; `@name` is styled text.

Console logs are not forwarded to Discord (`disableConsoleLogOverride`). Nothing is stored in the browser except the
member's settings.

## Rules post and the opening

`/whitelist post` (Guidance publishers) posts the launch post: the departures banner, editable title, body and button
wording (dashboard wording editor, group "Shuttle Activity rules post"), and one **Board the Shuttle** button. The
default wording is in Sophie's voice: what the Shuttle is (five short stops, a bit of reading, no quiz), that finishing
it requests the Whitelist role, the real button name, what to do if the button does nothing, and where to ask. Wording
already edited in the dashboard still wins over the defaults. The
button answers with LAUNCH_ACTIVITY and records nothing; the Activity signs the member in and checks access itself.

At the opening (`status: "open"`), the Shuttle entry button and `/whitelist start` also launch the Activity, so new runs
stop opening Onboarding channels. Channel runs already in progress carry on in their channels.

## Deploying (each step needs recorded owner approval)

1. Re-register commands so `/whitelist post` appears.
2. Install a core build with migration 074 and the `activity` block (`status: "testing"`, port 38125).
3. Switch the tunnel route for `onboarding.a13.info` from the closed screen (38124) to core (38125); keep the closed
   screen service installed for rollback.
4. Testers check sign-in, every stop, Whitelist and the door on Windows desktop, web, iOS and Android.
5. The opening: set `status: "open"` and post the launch post in the rules channel.

## Rollback

Point the tunnel route back at the closed screen (38124), or remove the `activity` block (the listener stops). Setting
`status` back to `testing` restores the channel Shuttle for new runs. Migrations 074 and 075 only add tables; Activity
runs are ordinary sessions and their Whitelist outcomes stand, and a published layout is presentation only (an older
build ignores it).

## Status (22 October 2026)

Deployed in testing (owner approval): core release `sophie-mistral-b6af5d8` (schema 074) serves the Activity on
`127.0.0.1:38125`, `onboarding.a13.info` routes to it (tunnel configuration version 4), and `/whitelist post` is
registered. Public HTTPS checks passed. Steps 1–3 of "Deploying" are done; see the decision log entry "Shuttle Activity
deployed in testing" for the record, including a 3 min 43 s outage caused by four SDK files missing from Git.

The owner tested `a723a49` in the test Discord ("It does appear to work"). The second pass (moments, viewscreens,
arrival links, the layout editor and migration 075) is installed (schema 075); the layout pass that followed the owner's review
(reading column, fixed status window, re-laid scenes) is installed as `sophie-mistral-2063a50`. The third pass (a
detailed station, centring fixes, the conveyor belt with Wolfgate and disposals, a scene per Board the Shuttle
section, the rebuilt viewport and door, the station board and boarding pass, radio length tied to the page) is built
and tested offline, with the held seam fix `21a0575`, and installed as `sophie-mistral-0d446fe` (source-only, 14:26 UTC). See verification.md. No Activity
layout is published yet, so the shipped defaults apply.

The fourth pass (the story: section-aligned pages, progress conditions, actors who enter, act and leave, sign cards
and dialogue lines, the story copy as a draft definition, and 17 new sounds the owner auditioned and approved) is
installed as `sophie-mistral-135f2a6` (source-only, 16:11 UTC, owner approval). SC-07 (the launch roll), picked
afterwards and approved by the owner, followed as `sophie-mistral-a620ce0` (source-only, 16:20 UTC). The story copy
is published as Shuttle version 3 (17:00 UTC). The owner had it published with the host-only publishing command,
installed as `sophie-mistral-cf0c125`; see [Publishing from the server](shuttle-publishing.md). New runs, in the
Activity and in channels, read the story; runs already in progress keep version 2.

The fifth pass (the owner's picks from a design picker for nearly every asset, walk-behind depth, mothroaches, the
BLASTWAVE fire cycle, the full-page title screen with the menu in a terminal window, the launch post's new wording,
and story fixes: no button name for the last step, no unused entry part) is built and tested offline. It is not
installed, and its story copy is not published yet; both need owner approval.

Not yet checked: mobile clients, and whether Discord opens `discord.com/channels` links inside the app.

Not built yet: moving an in-progress channel run into the Activity at the same step; a text version reachable from the
rules post.
