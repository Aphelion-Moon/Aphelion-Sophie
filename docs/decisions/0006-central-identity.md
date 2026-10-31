# Central identity database

Status: owner approved on 31 October 2026.

The owner asked for one PostgreSQL database that Sophie and SSymphony both use going forward, filled with the members'
game account links and character names, and for each member record post (forum `1562315014998728727`, called
**#staff-intel** from now on) to show them. Owner decisions, same day: a new dedicated cluster; identity data now and
SSymphony's control tables at its cutover; a re-runnable sync until SSymphony writes there itself; the threads updated
through Sophie's own dispatcher.

## What exists

- Cluster `aphelion-central-postgres` (PostgreSQL 17.11, the build reviewed in [0003](0003-storage-dependencies.md),
  hash-verified copy in `C:\Aphelion\Central\pgsql`), 127.0.0.1:5490 only, its own `NT SERVICE` account, nightly dump.
  Database `aphelion_central`. Built from the `Aphelion-Central` repository, which also holds the schema, the sync job,
  the SSymphony control copy and the hand-off documents for the SSymphony and Sophie developers.
- Schema `identity`: servers, Discord accounts, game accounts, links as each server holds them, character slots, sync
  runs, and the views `current_links`, `link_conflicts` and `member_game_records`. Nothing is deleted from it; what a
  source no longer has is marked not present.
- Schema `symphony`: SSymphony's 22 control tables translated for PostgreSQL, empty until its cutover.

## What Sophie may do

Sophie reads `identity` as `sophie_central_reader`, a role that can only SELECT and whose every session is read-only,
through its own pool (`createCentralIdentityPool`, apps/core/storage/pool.js). Every 15 minutes the games feed
(apps/core/discord/member-record-games.js) reads `identity.member_game_records` and stores each record's wanted games
value (migration 085); the member records dispatcher edits the post's reserved games message when it changed, behind
live work, with the existing leases, nonces and backoff. The header's self-reported "Game accounts" stay as they are; the
games message compares the application's names with the links and says where they differ.

This amends [0001](0001-owner-policy.md) lines 9 and 23 and [0002](0002-storage-candidate.md) line 9 only as far as
reading goes. Account linking, the in-game Get Whitelisted step, the bridge tables in each game database and every
BYOND/SS14 role stay with SSymphony. Sophie writes nothing to the central database or any game database, adds no
Discord write beyond editing her own games message in her own record posts, and no AI reads any of it: the forum stays
a permanent case exclusion.

## Configuration

`core.centralDatabase` in `trust\core.json`: `{ host: "127.0.0.1", port: 5490, database: "aphelion_central", user:
"sophie_central_reader", password }`, password from `C:\Aphelion\Central\secrets\sophie_central_reader.json`. Optional:
without it core runs as before and the games messages keep their reserved text.
