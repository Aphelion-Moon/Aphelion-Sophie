# Isolated Discord setup

This is the setup path for a **new test application and private test guild with
synthetic content only**. It is not production release approval. The host is a
foreground Windows process. The owner-provided test guild now has verified roles,
channels and commands, and a foreground host with dedicated database/HTTPS is running.
See [current staging operations](staging-operations.md) for its state and safe controls.

Scope: P07/P09/P26/P27; partial T03–T07/T13–T16/T18/T22/T36/T57 evidence. See
[verification](verification.md) for the actual offline checks and open gates.

## Prepare the isolated resources

Use Node 24.19.0 and the pinned dependencies (`npm ci --ignore-scripts --omit=optional`).
The existing PostgreSQL 17.11 binary review permits isolated synthetic testing;
production distribution review remains open. Use a separately approved, empty
local test cluster, its own data directory and unused loopback port. Do not use
the game/wiki cluster, its credentials or the temporary integration-test cluster.

An operator must provide these inputs before live setup:

- A separate Discord application, its bot user ID, public verification key and
  bot token; a private test guild and consenting testers. Keep the token local,
  out of chat, Git, screenshots and logs.
- Distinct Crew, Muzzled, Whitelist, Staff and Head Admin roles, and a private case
  category, either created by the bootstrap below or mapped manually. The stable `leadOps` identifier maps to Head Admin. Review the proposed
  capability grants in the template; ordinary Staff never gain Head Admin contact
  access. List any externally owned roles under `externallyOwnedRoleIds`.
- A bot role above Crew/Muzzled/Whitelist, with Manage Roles, Manage Channels,
  View Channel, Send Messages, Read Message History, Embed Links, Attach Files
  and Add Reactions. Child-thread inspection may require Manage Threads.
  Do not grant Administrator. Discord guild owners/Administrators can bypass
  channel overwrites; use ordinary test accounts for privacy acceptance.
- Human admission before inviting members. Configure public-channel access around
  Crew so removing Crew while Muzzled has the intended effect. The application
  changes its owned roles; it does not rewrite unrelated channels or BYOND roles.
- Server Members privileged intent; also Message Content when `captureEnabled`
  is true. The host requests GUILDS + GUILD_MEMBERS (3), plus GUILD_MESSAGES and
  MESSAGE_CONTENT (33283 total) for capture. Enable only the required intents.
- Approved staging HTTPS ingress to the two loopback listeners, with exact Origin,
  unmodified interaction body/signature headers, bounded requests and no request
  body, authorization, cookie, OAuth-code or query-string logging. Choosing,
  installing or reconfiguring that ingress is a separate operator action.

Install the application only into the test guild with `bot` and
`applications.commands` scopes. Configure the Interactions Endpoint URL to reach
`POST /discord/interactions` on the interaction listener. Configure the OAuth
redirect to `<dashboard.origin>/auth/callback`; the dashboard uses `identify` and
checks guild membership via core's bot identity. The dashboard needs HTTPS for its
Secure cookies. Do not expose the loopback listeners directly to the LAN.

Discord's official contracts: [guild command registration](https://docs.discord.com/developers/interactions/application-commands#create-guild-application-command),
[signed interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding#receiving-an-interaction),
[Gateway intents](https://docs.discord.com/developers/events/gateway#gateway-intents).

## Let Sophie create its test resources

The owner requested automatic setup inside the isolated test guild. Copy
`config/staging-seed.example.json` to `.local/staging-seed.json` and fill in the
test guild/application/public key, the **current guild owner's user ID**, ports
and planned dashboard origin. This requires no role/category IDs. The bot derives
its own user ID from Discord and verifies application/guild/owner identity. Use
`dashboardOrigin: null` if HTTPS is not chosen yet, then explicitly configure the
dashboard in the generated runtime JSON later.

After creating the application/guild and inviting the test bot with the permissions
above, preview the concrete operation without a token or network connection:

```powershell
node apps/core/bootstrap-staging.mjs plan --seed .local/staging-seed.json
```

Once the operator has reviewed and authorized that plan, populate
`SOPHIE_DISCORD_TOKEN` locally and run with the exact test guild ID:

```powershell
node apps/core/bootstrap-staging.mjs apply --seed .local/staging-seed.json --confirm-guild <TEST_GUILD_ID>
```

It creates five uniquely marked **zero-permission** Sophie Test roles, a bot-private
case category and a test lobby visible to Crew/Staff/Head Admin. It assigns only the
new Head Admin role to the verified guild owner, then registers the five commands.
It writes `.local/staging.<TEST_GUILD_ID>.json` and
`.local/staging-bootstrap.<TEST_GUILD_ID>.json`; use the generated configuration
path in the remaining commands below. Existing roles/channels are not rewritten,
deleted, adopted by name or repositioned. The bot must already have the required
permissions and be above its new roles; it cannot elevate its own managed role.
If Discord's hierarchy blocks creation/assignment, an operator must correct the
bot-role placement. Do not grant Administrator to bypass the check.

Discord can return the same numeric position for several roles. Sophie deliberately
requires the bot's position to be strictly greater than its owned target roles,
matching its runtime role-delivery policy. If bootstrap reports
`ROLE_HIERARCHY_BLOCKED`, move the bot's managed role to the top of the test guild's
role list and save, then resume with the same seed and receipt. An already observed
role is verified and reused; do not delete the receipt or recreate the role.

The receipt is saved before each create and retains returned IDs before verification.
Normal reruns verify and reuse those IDs; owner role assignment and command upserts
are idempotent. Explicit rate-limit rejection can be retried after the cooldown.
An ambiguous create with no returned ID stops as `STAGING_BOOTSTRAP_UNCERTAIN`;
do not delete the receipt or run again with a new marker to conceal the uncertainty.
Inspect the isolated guild and reconcile the unknown effect with the operator.
Changed permissions/names/ownership also stop rather than silently modifying them.

One local lock excludes simultaneous setup processes. After a crash, first verify
that the old process is stopped, preserve/review the receipt, then remove only its
stale `.lock` file before retrying. This is not proof of hard power-loss durability.
A different existing output configuration is preserved and causes an error; manual
configuration edits are never overwritten by a rerun.

The bootstrap cannot create its own Discord application/token, invite itself,
enable privileged intents, supply HTTPS/database resources, configure the developer
portal's endpoint/redirect, or approve/publish final content. Those remain operator
steps. [Discord role creation](https://docs.discord.com/developers/resources/guild#create-guild-role)
and [channel creation](https://docs.discord.com/developers/resources/guild#create-guild-channel)
are fixed operations; there is no arbitrary server-setup command route.

## Local configuration

If using the manual mapping path, copy `config/staging.example.json` to `.local/staging.json`. Replace every angle-bracket
placeholder, including repeated IDs. The example intentionally fails validation
until filled in. Verify the two ports are unused. Keep `attachmentsAllowed: false`:
this host captures message observations and file-reference status but does not run
attachment acquisition. It rejects enabling attachment permissions through this
configuration. No AI service or AI credential is used.
The approved transcript-export audience is `current-readers`, including members.
`exportPolicy` enables exact confirmed exports with the implementation's bounded
single-channel scope. It does not permit file downloads or bypass case/child access.

The public key belongs in the configuration; the bot token and OAuth client secret
belong only in the foreground process environment as `SOPHIE_DISCORD_TOKEN` and
`SOPHIE_OAUTH_CLIENT_SECRET`. Populate them using an operator-approved secret
mechanism that does not echo them or leave literal secrets in shell history.
`dashboard: null` permits command-only testing, but a fresh database then has no
UI for publishing Shuttle guidance or forms. Start with the dashboard enabled.

Versions in capability/case/OAuth policies are immutable bindings. Do not edit a
saved policy under the same version or blindly increment it to bypass an error;
review any subsequent policy migration. Keep technical role keys stable.

These commands are offline: they validate configuration and preview the fixed
five guild commands without connecting to Discord or a database.

```powershell
node apps/core/staging.mjs check --config .local/staging.json
node apps/core/staging.mjs commands --config .local/staging.json
```

The bot retains Manage Roles through its guild role. Bootstrap does not put that
permission in channel overwrites, because Discord restricts setting it there to
administrators. Channel creation accepts Discord's `201 Created` response. See the
[guild API](https://github.com/discord/discord-api-docs/blob/main/developers/resources/guild.mdx#create-guild-channel)
and [official OpenAPI specification](https://github.com/discord/discord-api-spec/blob/main/specs/openapi.json).

## Dedicated database

On the approved isolated cluster, use its existing maintenance login to create
two **new** non-superuser identities and one **new** database. Example names below
are exact local staging names, not production resources. In an interactive `psql`
session, set unique passwords using `\password` (at least 24 characters) without
putting passwords in SQL or command arguments.

```sql
CREATE ROLE sophie_stage_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE sophie_stage_core LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password sophie_stage_owner
\password sophie_stage_core
CREATE DATABASE sophie_stage_bot OWNER sophie_stage_owner;
REVOKE ALL ON DATABASE sophie_stage_bot FROM PUBLIC;
GRANT CONNECT ON DATABASE sophie_stage_bot TO sophie_stage_core;
```

Create ignored local maintenance/runtime JSON files, `.local/staging-owner.json`
and `.local/staging-core.json`, with exactly `host`, `port`, `database`, `user`,
`password`. Use host `127.0.0.1`, the isolated cluster port, database
`sophie_stage_bot`, and the corresponding identity. Restrict filesystem access to
the operator; never print or commit these files. The runtime identity must not
inherit the owner role. The database and login must start with `sophie_stage_`.

Apply migrations explicitly using the maintenance file:

```powershell
node apps/core/staging.mjs migrate --config .local/staging.json --database .local/staging-owner.json --confirm-database sophie_stage_bot
```

Then connect as `sophie_stage_owner` **to sophie_stage_bot** and grant the runtime
only these privileges. Repeat the table grant after any reviewed future migration
that adds tables; the runtime never migrates its own database.

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA sophie_core TO sophie_stage_core;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA sophie_core TO sophie_stage_core;
GRANT USAGE ON SCHEMA sophie_migrations TO sophie_stage_core;
GRANT SELECT ON sophie_migrations.applied TO sophie_stage_core;
```

Startup checks privileges and all 32 migration hashes before opening listeners.
An owner/superuser credential, table DELETE/TRUNCATE, core schema CREATE, writable
migration metadata or missing/altered migration fails closed. Do not grant the
knowledge/inference identities access to either credentials or core records.

## Explicit registration and start

After the operator has authorized the test-guild connection and populated secrets,
replace `<GUILD_ID>` below with the configured ID. Registration verifies bot and
application identity, then upserts only `shuttle`, `ticket`, `answer`, `mute` and `unmute`
in that guild. It does not bulk-replace commands. If interrupted, rerun the same
command after any reported rate-limit window; it may have applied a subset.

```powershell
node apps/core/staging.mjs commands --config .local/staging.json --confirm-guild <GUILD_ID>
node apps/core/staging.mjs start --config .local/staging.json --database .local/staging-core.json --confirm-guild <GUILD_ID>
```

The host binds only `127.0.0.1`. A `started` event means listeners opened; wait for
health `current: true` before testing. Signed Discord PING works before Gateway
readiness so the endpoint can be verified. Commands, authenticated dashboard
operations and workers remain disabled without current Gateway continuity.
The worker loop is sequential, bounded and non-overlapping. Gateway halt closes
the delivery gate and terminates the foreground host; Ctrl+C drains work and
closes both listeners and the Gateway before ending the database pool.
Wait at least 31 seconds after the old process stops before starting its replacement:
the existing 30-second Gateway ownership lease is retained until expiry. An early
replacement fails closed with `GATEWAY_OWNER_ACTIVE`; never clear that lease by hand.

Sign into the dashboard as the configured Head Admin test account. Save, review
and explicitly publish **synthetic** five-stage Shuttle guidance and whichever
ticket forms are being tested. A new database contains no published copy; entry
will remain unavailable until publication. The repository owner's source copy is
not automatically published. All publication and intake operations remain human
and deterministic.

## First live checks and stopping point

Record results against this build. Initial signed PING, unsigned/forged signature
rejection and guild command registration now have live evidence; the following
complete workflow and permission sequences remain **pending**:

1. Valid signed PING succeeds; invalid signatures fail. All five commands are
   guild scoped. An unauthorized ordinary member cannot mute or publish.
2. A newly admitted test member receives Crew. Muzzled removes Crew and prevents
   Shuttle completion/Whitelist delivery; unmute reconciles Crew. Verify unrelated
   roles remain unchanged. Existing-member bulk cutover/backfill is not provided.
3. Complete all five Shuttle pages; observe Whitelist, duplicate-click behavior,
   help pause/resume and no grant while Muzzled. Remove Whitelist and test leave/
   rejoin: the old session must not restore access; a fresh run is required.
4. Create Quick Help and a published form ticket. Verify opener, Staff, Head Admin,
   explicit participant and unrelated-member access with separate test accounts.
   Head Admin contact excludes ordinary Staff. Check close/reopen and role-loss
   revocation, not merely whether a channel appears in the client.
5. Capture synthetic create/edit/delete events and view the authenticated
   [transcript route](case-transcripts.md). Check escaped text, coverage gaps and
   denial after logout/role loss. Files remain status-only, not downloadable.
6. Stop and restart the foreground process. Verify retained progress, reconciliation
   and disabled operations during loss of Gateway continuity. Review parked
   delivery issues using the commands; never force database flags to hide them.

Stop after this isolated setup/acceptance pass. Preserve retained records on stop
or rollback; do not delete the database, lower policy versions or restore roles
from a snapshot. Revert application files only to a compatible build after stopping
the process. Remove test command registrations only as a separately authorized
Discord operation. There is no automatic uninstall or destructive down migration.

Production still requires the existing G2/recovery gates, approved form/copy and
closed audiences, Windows service identities/ACLs, ingress/runtime distribution
review, independent backups/control watermark, live permissions and owner release
approval. Downloads/exports, attachment operator tooling, full Staff/dashboard
parity and periodic member reconciliation are not part of this staging host.
Unrelated Gateway dispatches can conservatively invalidate in-flight proofs;
retrying under quiet conditions is not evidence of production throughput.
