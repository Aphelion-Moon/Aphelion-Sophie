# The Shuttle Activity

Scope: P40–P44. Owner decisions: "The Shuttle becomes an Activity" (21 October 2026, D1–D10), "Shuttle Activity
application and hostname", and "Shuttle Activity: SDK, testers and the ticket switch" (22 October 2026), all in
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
| Rules post | `modules/onboarding/activity-post.js`, `/whitelist post`, banner provenance in `content/shuttle-activity/rules-post-banner.json` |
| Client | `apps/activity/client/` (page, controller, presenter, markdown, sound, SDK adapter), `apps/activity/scene-*.js` |
| Files the client may load | `apps/activity/client-assets.js` (page, module graph, SDK, font, scenes, sounds; pinned hashes checked) |
| SDK | `apps/activity/vendor/embedded-app-sdk/`, pinned in `legal/embedded-app-sdk.json` by `scripts/vendor-embedded-sdk.mjs` |

## Routes

All on the Activity host only (others get 421). Responses are JSON with `Cache-Control: no-store`; refusals are fixed
words, never codes, IDs or messages.

| Route | What it does |
|---|---|
| `GET /api/config` | The public application ID the SDK needs. |
| `POST /api/session` `{code, instanceId}` | Exchanges the Discord code (no redirect URI; only `identify` and `rpc.activities.write`), checks the instance with the bot token (this server, this member in it) and that the member is present, then issues a one-hour in-memory bearer token. The Discord access token is returned once for the SDK and never stored. 60 sign-ins a minute at most. |
| `POST /api/session/end` | Forgets the token. |
| `GET /api/shuttle` | What to show: `closed`, `unavailable`, `elsewhere`, `unpublished`, `ready` (with the stops) or `run`. |
| `POST /api/shuttle/board` `{requestId}` | Starts a run, or resumes the current Activity run. |
| `POST /api/shuttle/act` `{requestId, action, expectedVersion}` | `advance`, `back` or `retry` (Check) on the current Activity run. |

Every Shuttle request resolves the member through core principals, reads Discord afresh and authorizes again in the
store. A click keeps one `requestId` through its retries; receipts make a repeat change nothing.

## Who gets in

- **Testing** (`status: "testing"`): the server owner and current holders of the lead ops role. Read from Discord on
  every request; removing the role closes the Activity for that member on their next request. Everyone else sees
  "Not boarding yet".
- **Open** (`status: "open"`): every member who may use the Shuttle. Muzzled or timed-out members see a fixed
  "can't board right now" notice.

## Runs

An Activity run is an ordinary Shuttle session with the same domain rules, nonce rotation, receipts and Whitelist grant
effect as the channel Shuttle, but no Onboarding channel or case (so no case quota). `shuttle_activity_runs` marks which
sessions the Activity drives.

- A member whose current run belongs to a channel is told to finish it there (`elsewhere`).
- A run from an earlier membership, or on withdrawn guidance, never continues: boarding starts a fresh run.
- The last Continue requests Whitelist; the client polls and shows "requested" until Discord confirms the role, then
  the door opens. A finished run is shown as arrived only while Discord still shows Whitelist.

## The client

Splash ("press any key"), then a game-style menu over the animated hangar. Each stop has its scene and ambience;
Sophie's transmissions are the stop's published pages split into screen-sized pieces (every character, in order).
Settings: music, ambience, radio and effect levels, sound on/off, motion, typed or instant text, text size. Keyboard:
arrows, Enter/Space, Escape. Landscape overlays the transmission on the scene; portrait stacks it. Presence shows the
stop number only. Links in the copy open through Discord's own confirmation, and only https links are links.

Console logs are not forwarded to Discord (`disableConsoleLogOverride`). Nothing is stored in the browser except the
member's settings.

## Rules post and the opening

`/whitelist post` (Guidance publishers) posts the launch post: the departures banner, editable title, body and button
wording (dashboard wording editor, group "Shuttle Activity rules post"), and one **Board the Shuttle** button. The
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
`status` back to `testing` restores the channel Shuttle for new runs. Migration 074 only adds a table; Activity runs are
ordinary sessions and their Whitelist outcomes stand.

## Status (22 October 2026)

Built and tested offline on branch `docs/shuttle-activity-plan`; previewed in a local harness with a fake API. Not
deployed, not run inside Discord's frame, not checked on mobile clients.

Not built yet: moving an in-progress channel run into the Activity at the same step; a text version reachable from the
rules post; the title screen's section registry (Station log, Codex); a transmission log; the per-stop scene picker in
the Shuttle editor.
