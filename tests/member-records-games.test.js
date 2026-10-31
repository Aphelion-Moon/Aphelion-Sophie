import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_MAX, RESERVED, renderGames, requireGames } from '../modules/member-records/index.js';
import { createCentralIdentity, createCentralIdentityPool } from '../apps/core/storage/central-identity.js';
import { createMemberRecordGamesFeed } from '../apps/core/discord/member-record-games.js';
import { createDiscordTransport } from '../apps/core/discord/transport.js';

// Synthetic data only; every ID and name is made up.
const ids = n => `1${String(n).padStart(17, '0')}`;
const GUILD = ids(1), FORUM = ids(60), POST = ids(62), MEMBER = ids(12);
const GUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const AT = Date.UTC(2026, 9, 31, 9, 0);
const server = (kind, change = {}) => ({ kind, server: kind === 'ss13' ? 'Meridian Rift' : 'Wolfgate', accountId: kind === 'ss13' ? 'vexwolf' : GUID,
  displayName: kind === 'ss13' ? 'Vex_Wolf' : 'VexWolf', linkedAtMs: AT, conflict: false, characters: [], ...change });

test('MR-30 the games message: linked accounts, characters with the selected one in bold, and not linked where there is none', () => {
  const text = renderGames({ status: 'linked', servers: [server('ss13', { characters: [{ slot: 3, name: 'Ada Vance', selected: true }, { slot: 1, name: 'Rook', selected: false }] })] });
  assert.equal(text, [
    '**Game records** · verified links held by Symphony, checked every 15 minutes',
    '',
    '**SS13 · Meridian Rift**',
    `Account: \`vexwolf\` (key Vex\\_Wolf) · linked <t:${AT / 1000}:D>`,
    'Characters (2, selected in bold): **Ada Vance**, Rook',
    '',
    '**SS14 · Wolfgate**',
    'Not linked',
  ].join('\n'));
  assert.match(renderGames({ status: 'none' }, { ckey: 'vexwolf', ss14: 'Vex' }), /\*\*SS13 · Meridian Rift\*\*\nNot linked · the application named vexwolf\n\n\*\*SS14 · Wolfgate\*\*\nNot linked · the application named Vex$/);
  assert.match(renderGames({ status: 'linked', servers: [server('ss14')] }), /Account: VexWolf · `0f8fad5b-d9cb-469f-a165-70867728950e` · linked/);
  assert.match(renderGames({ status: 'linked', servers: [server('ss14', { displayName: null })] }), /Account: name not seen yet · `0f8f/);
  assert.match(renderGames({ status: 'linked', servers: [server('ss13')] }), /Characters: none saved/);
});

test('MR-31 the application is compared, never trusted; conflicts and extra servers are named', () => {
  const both = { status: 'linked', servers: [server('ss13', { conflict: true }), server('ss14')] };
  const text = renderGames(both, { ckey: 'someoneelse', ss14: 'vexwolf' });
  assert.match(text, /⚠ Linked differently on another server of this game/);
  assert.match(text, /-# The application named someoneelse here\./);
  assert.ok(!text.includes('The application named vexwolf'), 'an SS14 name matching the link, ignoring case, is not called out');
  assert.match(renderGames({ status: 'linked', servers: [server('ss13'), server('ss13', { accountId: 'other' })] }), /-# Also linked on 1 more SS13 server\./);
});

test('MR-32 player-typed names cannot mention, format or overflow: 200 long names still fit one message', () => {
  const many = Array.from({ length: 200 }, (_, index) => ({ slot: index + 1, name: `@everyone **${'Zz'.repeat(40)}** ${index}`, selected: index === 7 }));
  const text = renderGames({ status: 'linked', servers: [server('ss13', { characters: many, conflict: true }), server('ss14', { characters: many })] }, { ckey: 'x', ss14: 'y' });
  assert.ok(text.length <= MESSAGE_MAX, String(text.length));
  assert.ok(!/(?<!\\)@everyone/.test(text) && text.includes('\\@everyone'));
  assert.match(text, /Characters \(200, selected in bold\): .*\+\d+ more/);
  assert.ok(!text.includes('<@') && !/(?<!\\)\*\*@/.test(text));
});

test('MR-33 only the shapes the central database gives are accepted', () => {
  for (const bad of [null, {}, { status: 'maybe' }, { status: 'linked' }, { status: 'linked', servers: [{ kind: 'ss15', accountId: 'x', characters: [] }] },
    { status: 'linked', servers: [server('ss13', { accountId: 'Not A Ckey!' })] }, { status: 'linked', servers: [server('ss13', { characters: 'Ada' })] }])
    assert.throws(() => requireGames(bad), /MEMBER_RECORD_GAMES_INVALID/, JSON.stringify(bad));
  assert.equal(requireGames({ status: 'none' }).status, 'none');
  assert.equal(RESERVED.games, '-# Reserved by Sophie: game records for Meridian Rift (SS13) and Wolfgate (SS14).', 'what existing posts show until the feed reads them');
});

test('MR-34 the central pool is loopback, read-only and its own identity', () => {
  const ok = { host: '127.0.0.1', port: 5490, database: 'aphelion_central', user: 'sophie_central_reader', password: 'x'.repeat(43) };
  const pool = createCentralIdentityPool(ok, () => {});
  assert.equal(pool.options.options, '-c default_transaction_read_only=on'); assert.equal(pool.options.ssl, false);
  pool.end();
  for (const [change, code] of [[{ host: 'localhost' }, /LOOPBACK_DATABASE_REQUIRED/], [{ database: 'sophie_prod_main' }, /INVALID_DATABASE_IDENTITY/],
    [{ user: 'central_owner' }, /INVALID_DATABASE_IDENTITY/], [{ password: 'short' }, /DATABASE_PASSWORD_REQUIRED/]])
    assert.throws(() => createCentralIdentityPool({ ...ok, ...change }, () => {}), code);
});

test('MR-35 the reader maps identity.member_game_records rows and refuses what is not a member', async () => {
  const rows = [{ discord_id: MEMBER, servers: [{ server_id: 'meridian-main', server: 'Meridian Rift', kind: 'ss13', account_id: 'vexwolf', display_name: 'Vex_Wolf',
    linked_at: '2026-10-31T09:00:00+00:00', conflict: false, characters: [{ slot: 1, name: 'Ada Vance', selected: true }, { slot: 2, name: '  ', selected: false }] }] }];
  const central = createCentralIdentity({ pool: { query: async sql => { assert.match(sql, /FROM identity\.member_game_records/); return { rows }; } } });
  const byUser = await central.readGameRecords();
  assert.deepEqual(byUser.get(MEMBER), { status: 'linked', servers: [{ kind: 'ss13', server: 'Meridian Rift', accountId: 'vexwolf', displayName: 'Vex_Wolf',
    linkedAtMs: AT, conflict: false, characters: [{ slot: 1, name: 'Ada Vance', selected: true }] }] });
  const bad = createCentralIdentity({ pool: { query: async () => ({ rows: [{ discord_id: 'everyone', servers: [] }] }) } });
  await assert.rejects(bad.readGameRecords(), /INVALID_DISCORD_ID/);
});

test('MR-36 the feed runs at start, then every 15 minutes; a failure waits a minute and stores nothing', async () => {
  let now = AT, reads = 0, stored = [];
  const central = { async readGameRecords() { reads += 1; if (reads === 2) throw Object.assign(new Error('down'), { code: 'CENTRAL_DATABASE_UNAVAILABLE' }); return new Map(); } };
  const store = { async setGames(map) { stored.push(map); return { changed: 0 }; } };
  const feed = createMemberRecordGamesFeed({ store, central, enabled: async () => true, clock: () => now });
  assert.deepEqual(await feed.runDue('games'), { status: 'fed', linked: 0, changed: 0 });
  now += 14 * 60_000; assert.deepEqual(await feed.runDue('games'), { status: 'idle' });
  now += 60_000; assert.deepEqual(await feed.runDue('games'), { status: 'failed', code: 'CENTRAL_DATABASE_UNAVAILABLE' });
  assert.equal(stored.length, 1);
  now += 30_000; assert.deepEqual(await feed.runDue('games'), { status: 'idle' });
  now += 30_000; assert.equal((await feed.runDue('games')).status, 'fed');
  const off = createMemberRecordGamesFeed({ store, central, enabled: async () => false, clock: () => now });
  assert.deepEqual(await off.runDue('games'), { status: 'disabled' });
});

test('MR-37 the games message passes the real transport check in production scope', async () => {
  const sent = [];
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    recordForumId: FORUM, fetch: async (url, init) => { sent.push(JSON.parse(init.body).content); return Response.json({ id: ids(65) }); } });
  const hostile = [{ slot: 1, name: '@here <@123> [x](https://x.test) # big', selected: true }];
  const text = renderGames({ status: 'linked', servers: [server('ss13', { characters: hostile, displayName: '@everyone' }), server('ss14', { displayName: '@here', characters: hostile })] },
    { ckey: 'here', ss14: '@everyone' });
  await transport.editMemberRecordMessage(POST, ids(66), text);
  assert.equal(sent[0], text);
});
