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
Port 38123 is the connector's metrics listener. Installing it as a long-running service is a production change and
needs recorded operator approval, like the existing `aphelion-bot` services.

## Status (22 October 2026)

- Built and tested on loopback (`npm test` 700 passed; a local start, request and stop of the entry script passed).
- Routed: `sophie-staging` tunnel configuration version 3 sends `onboarding.a13.info` to `http://127.0.0.1:38124`,
  and a proxied CNAME points the hostname at the tunnel. Version 2 is backed up in `.local/cloudflare/`.
- Running as a process of the coding session, not as a service: it stops when that session ends or the host
  restarts. Making it a Manual service alongside the `aphelion-bot` services (`ops/windows/Setup-StagingServices.ps1`)
  needs operator approval.
- Public HTTPS checks: `/` returns 200 with "Not boarding yet", the font returns 200 with its pinned size, other
  paths return 404; `sophie.a13.info` still answers as before (303 to sign-in, interactions POST-only).
- Not checked: the page as Discord shows it inside the Activity frame.

## Rollback

Stop the host. Restore tunnel configuration version 2 from the backup (or delete the `onboarding.a13.info` rule in
the dashboard) and delete the `onboarding.a13.info` DNS record. Disabling Activities in the Developer Portal removes
the Launch command. No data is involved.
