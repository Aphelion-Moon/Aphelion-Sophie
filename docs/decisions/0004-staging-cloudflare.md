# Staging Cloudflare ingress

Status: owner approved isolated staging use on 20 September 2026.

The owner selected `sophie.a13.info`, supplied temporary Cloudflare API access and
explicitly approved the installed **cloudflared 2026.7.3 Windows amd64** binary as
an Apache-2.0 infrastructure exception for isolated Sophie staging. This includes
use of the existing compiled distribution under its original bundled terms, not
copying or relicensing its code. Sophie's original code remains MIT. Production
distribution, redistribution and service installation are not approved here.

The installed executable's SHA-256 is
`8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841`, matching the
official release asset digest. Keep this version/hash pinned, retain the upstream
licence notice, disable automatic updates, and use a separate foreground connector.
Do not alter an existing tunnel or install a Windows service.

Use a new remotely managed tunnel with only these ingress rules, in order:

- `sophie.a13.info`, exact `/discord/interactions` path → `http://127.0.0.1:38121`.
- `sophie.a13.info`, other paths → `http://127.0.0.1:38122`.
- All other traffic → HTTP 404.

The dashboard origin is `https://sophie.a13.info`, with OAuth callback
`https://sophie.a13.info/auth/callback`. Core still verifies Discord signatures,
OAuth state, sessions, origin, CSRF and current authorization. Disable connector
debug/access logging; never log request bodies, cookies, credentials or query strings.
Keep tunnel credentials in the ignored, operator-restricted local staging directory.
No case data is sent to an AI service. All content used during staging is synthetic.

Before setup, the supplied token verified successfully, the `a13.info` zone was
active and no DNS record existed for the selected hostname. These read-only checks
are not evidence that ingress is running. Record actual activation and live checks
separately; all production release gates remain open.

Sources: [pinned upstream licence](https://github.com/cloudflare/cloudflared/blob/2026.7.3/LICENSE),
[release](https://github.com/cloudflare/cloudflared/releases/tag/2026.7.3),
[Cloudflare API setup](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel-api/).
