# Dashboard authentication backend

Scope: P05/P06/P09, prerequisites for P08/P13/P17; partial T01/T03/T04/T05/T22/T36 evidence. This slice adds an authentication backend and a loopback HTTP listener. The optional [Shuttle authoring API](shuttle-authoring.md), [ticket-form authoring API](case-form-authoring.md) and [transcript read API](case-transcripts.md) share this listener and authorization. The optional [Shuttle browser editor](dashboard-ui.md) and [ticket-form browser editor](dashboard-forms.md) supply the two configuration workspaces; transcript browser navigation remains incomplete. No service, public endpoint, real OAuth application, credential or new dependency was added.

## Ownership and protocol

`apps/core/discord/oauth.js` implements the documented confidential-client authorization-code flow with the fixed Discord authorization/token/identity endpoints. The sole scope is `identify`; the sole callback is the configured HTTPS origin plus `/auth/callback`. Configuration is bounded data containing guild ID, application ID, origin and version. The client secret is injected separately into core memory. No browser input can choose a provider, scope or callback. An optional returnTo path must match a fixed dashboard route; migration 046 binds it to the one-use server-side flow. External and arbitrary return targets are rejected. Requests use native fetch through a narrow injected adapter, reject redirects, have a five-second deadline and cap provider responses at 16 KiB. Unexpected responses are denied, with no automatic token-exchange retry. See the [Discord OAuth2 documentation](https://docs.discord.com/developers/topics/oauth2) for the provider contract; simulated compatibility is not live acceptance.

`apps/core/security/dashboard-auth.js` creates independent random 256-bit state and browser-binding values. Migration 019 stores their SHA-256 digests in a five-minute flow. A matching state and HttpOnly browser cookie must consume the flow durably before any provider exchange. Competing callbacks, cancellation, expiration and replay cannot start a second exchange. Failure after consumption requires a fresh login, including an uncertain commit or provider response. Process-local claims cannot be serialized or recreated after a restart.

After the exchange, the fixed bot-role adapter verifies current membership of the configured guild and rejects absent members and bots. The provider supplies identity only; profile roles and permissions confer no capability. Access tokens, refresh tokens and profile fields are discarded after this exchange. They are not stored in PostgreSQL or logs, refreshed, or passed to knowledge/inference. No ticket, onboarding-session, form, message or attachment is read by authentication.

The application session uses a newly generated 256-bit cookie; only its SHA-256 digest, identity, policy version and expiry are persisted. A successful current-session check renews expiry up to one hour ahead, bounded by twelve hours from login. Expired or revoked sessions cannot renew; hidden pages do not send periodic keepalives. Successful login rotates the existing browser session. Logout revokes the local session; it does not revoke the user's Discord authorization. External OAuth revocation is not polled because provider tokens are not retained. Current membership, current capabilities, local expiry/revocation and configuration version remain the application access controls.

## Shared authorization

`apps/core/security/principals.js` combines exactly the signed-interaction verifier and browser-session resolver. Both produce opaque, process-local proofs for the same core authorizer. Neither serialized identities nor stored token digests can authenticate a request. Browser proofs expire after five minutes and re-read current session state on every resolution.

`apps/core/security/authorization.js` checks the original principal before and after current Discord capability checks. Logout or session revocation during a permission check denies the protected operation. Existing role/authority epochs, Gateway continuity, Head Admin audiences, hierarchy and Muzzled rules still apply. Login alone grants no Staff permission. Every future dashboard read/mutation must use this shared authorizer and the existing core use cases; hiding controls is insufficient.

Logout prevents new browser operations. An action already committed to the outbox uses its retained operator grant and current authority checks; logout does not retroactively cancel that durable action. Recovered sessions establish identity only, never fresh capability or permission evidence. This is not the independent recovery watermark required by T58.

## HTTP boundary

`apps/core/http/dashboard-auth.js` binds only `127.0.0.1` when explicitly started and exposes four fixed routes:

| Route | Result |
|---|---|
| `GET /auth/start` | Create browser-bound state and redirect to the fixed provider |
| `GET /auth/callback` | Consume the exact callback and issue a fresh local session |
| `GET /auth/session` | Revalidate session/current member and return identity, CSRF proof and current editing capability |
| `POST /auth/logout` | Check same-origin CSRF proof and revoke the local session |

Session and binding cookies use `__Host-` names, Path `/`, Secure, HttpOnly and SameSite=Lax, with no Domain attribute. No insecure-cookie development exception exists. POST requires the exact configured Origin plus an `X-CSRF-Token` derived using HMAC-SHA256 with the session secret and a fixed domain separator. The CSRF proof is not an authentication credential and is never substituted for the cookie.

The listener requires the exact configured Host, rejects ambiguous credentials and extra callback parameters, disallows bodies on authentication routes and compressed input everywhere, and limits headers, connection count and read time. The optional authoring POST routes accept only bounded UTF-8 JSON; authentication routes still reject bodies. The listener admits one operation without a waiting backlog. Responses prohibit caching, MIME sniffing, framing and referrer disclosure; no CORS access is enabled. Errors expose fixed text, and the fault callback receives only a stable code. It must not be combined with raw request, query-string, cookie or provider-body logging.

TLS termination, hostname ownership, proxy forwarding/access controls and provider registration remain deployment work. A trusted proxy must preserve the configured Host and prevent insecure public access; forwarded headers do not establish authentication here. Loopback tests manually supply cookies and a synthetic HTTPS Host. They do not test browser Secure-cookie behavior, TLS, actual redirects or Discord compatibility. The success redirect opens the shell when the optional presentation is composed; it grants no editing capability.

## Bounded storage and operational limits

Migration 019 adds immutable versioned auth policies, a guild login deadline, at most 64 flow slots per guild and at most 256 session slots per guild. The development limits are one login start per two seconds, five minutes per flow, one hour ahead per active session, a twelve-hour absolute limit and eight active sessions per identity. A ninth login rotates the oldest active session for that identity. Completed/expired/replaced flows and expired/revoked/replaced sessions can reuse slots. A newer policy invalidates older sessions/flows and makes their slots reusable; an older process cannot reactivate the old policy. Editing an existing version is denied.

Only ephemeral authentication slots are recycled. Case records, audits, attachments, transcripts and channel exclusions retain their separate indefinite-retention policy. Core needs SELECT/INSERT/UPDATE on the four new tables, not DELETE; knowledge has no core-schema access. No provider secret, browser secret, profile body or role snapshot is added to auth storage.

These limits bound resources; they are not a complete public denial-of-service defense. Production requires reviewed ingress limits, availability/capacity monitoring, policy/secret rotation procedures and a tested recovery gate. The global sign-in cadence and 64-flow pool must be reviewed against expected traffic. Provider failure or rate limiting consumes that login attempt without retrying it; the user must start again.

## Evidence and rollback

Six contract tests cover origin/cookie constraints, fixed provider routes/scopes, opaque identities, response bounds, redacted failures, disabled/expired proofs and explicit principal resolution. O01–O16 use actual PostgreSQL with a simulated provider and Discord metadata. They exercise callback replay/races, cancellation, non-members, expiry, CSRF, session rotation/capacity, immutable policy changes, current audiences, logout during a mutation, shared command/browser authorization, rollback and uncertain commits, and database privileges. O14–O16 additionally use actual loopback HTTP. S27 recreates auth services across database restarts and verifies session retention, consumed callbacks, fresh authority and durable logout. See [verification](verification.md) for actual execution evidence.

Live OAuth/TLS/browser tests, full HTTP/Discord use-case parity, public ingress, Windows identities/ACLs and off-host recovery remain release gates. No full application acceptance specification is marked passed from this partial evidence.

Rollback: close the owned listener, keep migration 019 and retained state, and revert only compatible application files. Do not lower a registered policy version or restore old sessions from a backup to bypass revocation. No destructive down migration is provided. All exercised databases and listeners are isolated synthetic test resources and are stopped afterward; existing game/wiki services remain untouched.

## Optional browser presentation

The [Shuttle editor](dashboard-ui.md) can be composed with the same listener using its fixed `presentation` asset map and `authoring` service. Both remain absent by default. The public shell contains no private guidance. `/auth/session` includes a current `canEditShuttle` boolean when authoring is present; every subsequent route still authorizes independently. Browser transport sends an empty logout POST with CSRF. Synthetic browser review is separate from real OAuth, TLS and Secure-cookie acceptance.

The optional `formAuthoring` service adds seven fixed `/api/ticket-forms/*` routes and the current `canEditForms` session hint. It uses the same request bounds, authentication and CSRF checks with the explicit `case.forms.publish` capability. It exposes authored configuration only, never submitted answers or case content. The [form browser editor](dashboard-forms.md) now uses this interface with explicit saved-copy review and exact uncertain-request recovery.
