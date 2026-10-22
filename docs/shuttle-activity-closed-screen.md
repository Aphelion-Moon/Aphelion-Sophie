# Shuttle Activity closed screen

Scope: P40 (owner decisions of 21 October 2026: D8 tester gate, and "Shuttle Activity application and hostname").
Until the Activity opens, every launch shows one static "not boarding yet" page at `onboarding.a13.info`.

## What it is

| Path | What it is |
|---|---|
| `apps/activity/closed.html` | The page: a small departures sign, "Not boarding yet", and a pointer back to the Shuttle in the server. No scripts. |
| `apps/activity/closed-host.js` | The request handler and loopback listener. |
| `apps/activity/closed-host.mjs` | Entry point: checks the bundled font against its pin, then listens on `127.0.0.1:38124`. |
| `tests/activity-closed-host.test.js` | Real HTTP requests against the listener. |

It serves exactly two paths: `/` (also `/index.html`) and `/fonts/CozetteVector.woff2`. Every other path is 404,
methods other than GET and HEAD are 405, and hosts other than `onboarding.a13.info` (and its own loopback address)
are 421. Responses carry a strict content security policy (`default-src 'none'`, inline styles and the font only),
`nosniff` and `no-referrer`. It holds no Discord token, uses no database, reads no request content and logs nothing
but its start line. No AI is involved.

## Running it

```bash
node apps/activity/closed-host.mjs
```

It must run on the host whose `sophie-staging` connector routes `onboarding.a13.info` to `http://127.0.0.1:38124`.
Port 38123 is the connector's metrics listener.

On the host it runs as the Manual service `aphelion-bot-activity` under `NT SERVICE\aphelion-bot-activity`, using
Sophie's pinned Node runtime and the same WinSW wrapper as the other `aphelion-bot` services. Install or update it from
an elevated PowerShell 7:

```powershell
.\ops\windows\Setup-ActivityService.ps1 -WhatIf
.\ops\windows\Setup-ActivityService.ps1
Restart-Service aphelion-bot-activity
```

The script copies five committed files (the page, handler, entry point, font and `legal/DEPENDENCIES.json`) into
`C:\Aphelion\Sophie\activity\source`, refusing uncommitted changes or a font that doesn't match its pin, and writes a
manifest of their hashes and the source commit to `C:\Aphelion\Sophie\activity\manifest.json`. The account can read
its own copy, run the Node runtime (granted per file, because the runtime's files carry their own protected
permissions) and write only `C:\Aphelion\Sophie\logs\activity`. Like the other services it is Manual, so it does
not start by itself after the host restarts.

## Status (22 October 2026)

- Built and tested on loopback (`npm test` 700 passed; a local start, request and stop of the entry script passed).
- Routed: `sophie-staging` tunnel configuration version 3 sends `onboarding.a13.info` to `http://127.0.0.1:38124`,
  and a proxied CNAME points the hostname at the tunnel. Version 2 is backed up in `.local/cloudflare/`.
- Running as the Manual service `aphelion-bot-activity` since 22 October 2026 (owner approved), from commit
  `b9f7c11` per its manifest. The first start failed because the account could not run `node.exe`; the session
  copy had already been stopped, so the closed screen was down for about a minute until it was restarted. The setup
  now grants the runtime files directly, and the second handover left a gap of a few seconds.
- Public HTTPS checks: `/` returns 200 with "Not boarding yet", the font returns 200 with its pinned size, other
  paths return 404; `sophie.a13.info` still answers as before (303 to sign-in, interactions POST-only).
- Not checked: the page as Discord shows it inside the Activity frame.

## What replaces it

The Activity itself is served by core on its own loopback port (38125) once deployed; see
[the Shuttle Activity](shuttle-activity.md). The route for `onboarding.a13.info` then moves from 38124 to 38125. This
service stays installed (Manual) so the route can be pointed back at it to roll back.

## Rollback

Stop the service (`Stop-Service aphelion-bot-activity`); to remove it, run
`C:\Aphelion\Sophie\services\activity\aphelion-bot-activity.exe uninstall`. Restore tunnel configuration version 2 from
the backup (or delete the `onboarding.a13.info` rule in the dashboard) and delete the `onboarding.a13.info` DNS record. Disabling Activities in the Developer Portal removes
the Launch command. No data is involved.
