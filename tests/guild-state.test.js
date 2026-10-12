import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGuildState } from '../apps/core/discord/guild-state.js';

const sf = n => `11000000000000${String(n).padStart(5, '0')}`;
const GUILD = sf(1); const BOT = sf(2); const OWNER = sf(3); const ALICE = sf(10); const BOB = sf(11);
const ROLE_A = sf(100); const ROLE_B = sf(101); const ROLE_C = sf(102); const CHAN = sf(200); const THREAD = sf(201); const CAT = sf(202);
const create = (options = {}) => createGuildState({ guildId: GUILD, botUserId: BOT, ...options });
const dispatch = (t, d, s = 1) => ({ op: 0, t, s, d });
const role = (id, extra = {}) => ({ id, permissions: '1024', position: 1, ...extra });
const user = (id, bot = false) => ({ id, username: 'synthetic', bot });
const guildCreate = (extra = {}) => dispatch('GUILD_CREATE', {
  id: GUILD, owner_id: OWNER, roles: [role(ROLE_A), role(ROLE_B, { permissions: 8, position: 2 })],
  channels: [{ id: CHAN, type: 0, parent_id: CAT, permission_overwrites: [{ id: ROLE_A, type: 0, allow: '1024', deny: '2048' }] }, { id: CAT, type: 4 }],
  threads: [{ id: THREAD, type: 11, parent_id: CHAN }],
  members: [{ user: user(ALICE), roles: [ROLE_A, ROLE_B, ROLE_A, 'bogus'], joined_at: '2026-01-01T00:00:00.000Z', communication_disabled_until: null }],
  emojis: [{ id: sf(300), name: 'sophie', roles: [ROLE_A] }, { id: sf(301), name: 'gone', available: false }], ...extra });
const ready = (extra) => { const state = create(); state.accept(guildCreate(extra)); return state; };

test('GS-01 READY clears all state and bumps the session; RESUMED changes nothing', () => {
  const state = ready();
  state.accept(dispatch('MESSAGE_CREATE', { id: sf(500), guild_id: GUILD, channel_id: CHAN, author: user(ALICE) }));
  assert.equal(state.ready(), true); assert.equal(state.session(), 0);
  state.accept(dispatch('RESUMED', {}));
  assert.equal(state.ready(), true);
  state.accept(dispatch('READY', { user: user(BOT, true), guilds: [{ id: GUILD, unavailable: true }] }));
  assert.equal(state.ready(), false); assert.equal(state.session(), 1);
  assert.deepEqual(state.status(), { ready: false, session: 1, roles: 0, channels: 0, members: 0, messages: 0 });
  assert.equal(state.guild(), null); assert.equal(state.emoji(sf(300)), null); assert.equal(state.member(ALICE), undefined);
});

test('GS-02 GUILD_CREATE populates guild, roles, channels, threads, members and emojis and sets ready', () => {
  const state = ready();
  assert.equal(state.ready(), true);
  assert.deepEqual(state.guild(), { id: GUILD, ownerId: OWNER });
  assert.deepEqual(state.roles(), [{ id: ROLE_A, permissions: '1024', position: 1 }, { id: ROLE_B, permissions: '8', position: 2 }]);
  assert.deepEqual(state.channel(CHAN), { id: CHAN, type: 0, parentId: CAT, overwrites: [{ id: ROLE_A, type: 0, allow: '1024', deny: '2048' }] });
  assert.deepEqual(state.channel(CAT), { id: CAT, type: 4, parentId: null, overwrites: [] });
  assert.deepEqual(state.channel(THREAD), { id: THREAD, type: 11, parentId: CHAN, overwrites: [] });
  assert.equal(state.channel(sf(999)), null);
  assert.deepEqual(state.member(ALICE), { userId: ALICE, bot: false, roles: [ROLE_A, ROLE_B], joinedAt: Date.parse('2026-01-01T00:00:00.000Z'), timedOutUntil: null });
  assert.deepEqual(state.emoji(sf(300)), { id: sf(300), name: 'sophie', available: true, roles: [ROLE_A] });
  assert.equal(state.emoji(sf(301)).available, false);
  assert.equal(state.emoji(sf(302)), null);
  assert.deepEqual(state.status(), { ready: true, session: 0, roles: 2, channels: 3, members: 1, messages: 0 });
});

test('GS-03 events and GUILD_CREATE for another guild are ignored', () => {
  const state = ready();
  const other = sf(777);
  state.accept(dispatch('GUILD_CREATE', { id: other, owner_id: BOT, roles: [], channels: [] }));
  state.accept(dispatch('GUILD_ROLE_CREATE', { guild_id: other, role: role(ROLE_C) }));
  state.accept(dispatch('GUILD_MEMBER_ADD', { guild_id: other, user: user(BOB), roles: [] }));
  state.accept(dispatch('GUILD_DELETE', { id: other }));
  state.accept(dispatch('CHANNEL_DELETE', { guild_id: other, id: CHAN }));
  assert.equal(state.ready(), true); assert.equal(state.guild().id, GUILD);
  assert.equal(state.roles().length, 2); assert.equal(state.member(BOB), undefined); assert.notEqual(state.channel(CHAN), null);
});

test('GS-04 malformed or unavailable GUILD_CREATE leaves the state not ready and never throws', () => {
  const state = ready();
  assert.doesNotThrow(() => state.accept(guildCreate({ roles: 'nope' })));
  assert.equal(state.ready(), false);
  state.accept(guildCreate()); assert.equal(state.ready(), true);
  assert.doesNotThrow(() => state.accept(guildCreate({ channels: {} })));
  assert.equal(state.ready(), false);
  state.accept(guildCreate()); assert.equal(state.ready(), true);
  state.accept(dispatch('GUILD_CREATE', { id: GUILD, unavailable: true }));
  assert.equal(state.ready(), false);
  state.accept(guildCreate()); state.accept(dispatch('GUILD_DELETE', { id: GUILD }));
  assert.equal(state.ready(), false);
});

test('GS-05 GUILD_UPDATE changes the owner and replaces roles only when roles is an array', () => {
  const state = ready();
  state.accept(dispatch('GUILD_UPDATE', { id: GUILD, owner_id: BOB }));
  assert.equal(state.guild().ownerId, BOB); assert.equal(state.roles().length, 2);
  state.accept(dispatch('GUILD_UPDATE', { id: GUILD, owner_id: BOB, roles: [role(ROLE_C, { position: 5 })] }));
  assert.deepEqual(state.roles(), [{ id: ROLE_C, permissions: '1024', position: 5 }]);
});

test('GS-06 role create, update and delete; delete also strips the role from cached members', () => {
  const state = ready();
  state.accept(dispatch('GUILD_ROLE_CREATE', { guild_id: GUILD, role: role(ROLE_C, { permissions: '32' }) }));
  assert.equal(state.roles().length, 3);
  state.accept(dispatch('GUILD_ROLE_UPDATE', { guild_id: GUILD, role: role(ROLE_C, { permissions: '64', position: 9 }) }));
  assert.deepEqual(state.roles().find(item => item.id === ROLE_C), { id: ROLE_C, permissions: '64', position: 9 });
  assert.equal(state.roles().length, 3);
  state.accept(dispatch('GUILD_ROLE_DELETE', { guild_id: GUILD, role_id: ROLE_A }));
  assert.equal(state.roles().some(item => item.id === ROLE_A), false);
  assert.deepEqual(state.member(ALICE).roles, [ROLE_B]);
  state.accept(dispatch('GUILD_ROLE_CREATE', { guild_id: GUILD, role: { id: sf(103), permissions: 'x', position: 1 } }));
  assert.equal(state.roles().length, 2);
});

test('GS-07 channel and thread create, update and delete', () => {
  const state = ready();
  state.accept(dispatch('CHANNEL_CREATE', { guild_id: GUILD, id: sf(210), type: 0, parent_id: CAT, permission_overwrites: [{ id: sf(10), type: '1', allow: '0', deny: '1' }] }));
  assert.deepEqual(state.channel(sf(210)).overwrites, [{ id: sf(10), type: 1, allow: '0', deny: '1' }]);
  state.accept(dispatch('CHANNEL_UPDATE', { guild_id: GUILD, id: sf(210), type: 0, parent_id: null, permission_overwrites: [] }));
  assert.deepEqual(state.channel(sf(210)), { id: sf(210), type: 0, parentId: null, overwrites: [] });
  state.accept(dispatch('THREAD_CREATE', { guild_id: GUILD, id: sf(211), type: 11, parent_id: sf(210) }));
  state.accept(dispatch('THREAD_UPDATE', { guild_id: GUILD, id: sf(211), type: 12, parent_id: sf(210) }));
  assert.equal(state.channel(sf(211)).type, 12);
  state.accept(dispatch('THREAD_DELETE', { guild_id: GUILD, id: sf(211) }));
  state.accept(dispatch('CHANNEL_DELETE', { guild_id: GUILD, id: sf(210) }));
  assert.equal(state.channel(sf(211)), null); assert.equal(state.channel(sf(210)), null);
  // A channel whose overwrites no longer validate is dropped rather than kept stale.
  state.accept(dispatch('CHANNEL_UPDATE', { guild_id: GUILD, id: CHAN, type: 0, permission_overwrites: [{ id: 'bad', type: 0, allow: '0', deny: '0' }] }));
  assert.equal(state.channel(CHAN), null);
});

test('GS-08 member add, update and remove distinguish known-absent (null) from never seen (undefined)', () => {
  const state = ready();
  assert.equal(state.member(BOB), undefined);
  state.accept(dispatch('GUILD_MEMBER_ADD', { guild_id: GUILD, user: user(BOB, true), roles: [ROLE_A], joined_at: '2026-02-02T00:00:00.000Z' }));
  assert.deepEqual(state.member(BOB), { userId: BOB, bot: true, roles: [ROLE_A], joinedAt: Date.parse('2026-02-02T00:00:00.000Z'), timedOutUntil: null });
  state.accept(dispatch('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: user(BOB, true), roles: [], communication_disabled_until: '2030-01-01T00:00:00.000Z' }));
  assert.deepEqual(state.member(BOB).roles, []); assert.equal(state.member(BOB).timedOutUntil, Date.parse('2030-01-01T00:00:00.000Z'));
  state.accept(dispatch('GUILD_MEMBER_REMOVE', { guild_id: GUILD, user: user(BOB) }));
  assert.equal(state.member(BOB), null); assert.equal(state.member(sf(12)), undefined);
  state.accept(dispatch('GUILD_MEMBER_ADD', { guild_id: GUILD, user: user(BOB), roles: [] }));
  assert.equal(state.member(BOB).userId, BOB);
  state.accept(dispatch('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: user(ALICE), roles: 'not-an-array' }));
  state.accept(dispatch('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: 'x' }, roles: [] }));
  assert.deepEqual(state.member(ALICE).roles, [ROLE_A, ROLE_B]);
});

test('GS-09 GUILD_EMOJIS_UPDATE replaces the emoji set', () => {
  const state = ready();
  state.accept(dispatch('GUILD_EMOJIS_UPDATE', { guild_id: GUILD, emojis: [{ id: sf(310), name: 'new' }] }));
  assert.equal(state.emoji(sf(300)), null); assert.deepEqual(state.emoji(sf(310)), { id: sf(310), name: 'new', available: true, roles: [] });
});

test('GS-10 MESSAGE_CREATE records the message and the partial member that came with it', () => {
  const state = ready();
  state.accept(dispatch('MESSAGE_CREATE', { id: sf(500), guild_id: GUILD, channel_id: CHAN, author: user(BOB), member: { roles: [ROLE_B], joined_at: '2026-03-03T00:00:00.000Z' } }));
  assert.deepEqual(state.message(sf(500)), { channelId: CHAN, authorId: BOB, revision: 'original' });
  assert.deepEqual(state.member(BOB), { userId: BOB, bot: false, roles: [ROLE_B], joinedAt: Date.parse('2026-03-03T00:00:00.000Z'), timedOutUntil: null });
  state.accept(dispatch('MESSAGE_CREATE', { id: sf(501), guild_id: GUILD, channel_id: CHAN, author: user(sf(13)) }));
  assert.equal(state.member(sf(13)), undefined); assert.equal(state.message(sf(501)).authorId, sf(13));
  assert.equal(state.message(sf(502)), undefined);
});

test('GS-11 webhook messages do not create or change members', () => {
  const state = ready();
  state.accept(dispatch('MESSAGE_CREATE', { id: sf(510), guild_id: GUILD, webhook_id: sf(900), channel_id: CHAN, author: user(ALICE), member: { roles: [] } }));
  assert.deepEqual(state.member(ALICE).roles, [ROLE_A, ROLE_B]);
  assert.equal(state.message(sf(510)).authorId, ALICE);
});

test('GS-12 MESSAGE_UPDATE sets the revision only for known messages with an edited timestamp', () => {
  const state = ready();
  state.accept(dispatch('MESSAGE_CREATE', { id: sf(520), guild_id: GUILD, channel_id: CHAN, author: user(ALICE) }));
  state.accept(dispatch('MESSAGE_UPDATE', { id: sf(520), guild_id: GUILD, channel_id: CHAN, edited_timestamp: '2026-04-04T00:00:00.000000+00:00' }));
  assert.equal(state.message(sf(520)).revision, '2026-04-04T00:00:00.000000+00:00');
  state.accept(dispatch('MESSAGE_UPDATE', { id: sf(520), guild_id: GUILD, channel_id: CHAN, edited_timestamp: null }));
  assert.equal(state.message(sf(520)).revision, '2026-04-04T00:00:00.000000+00:00');
  state.accept(dispatch('MESSAGE_UPDATE', { id: sf(521), guild_id: GUILD, channel_id: CHAN, edited_timestamp: '2026-04-04T00:00:00.000000+00:00' }));
  assert.equal(state.message(sf(521)), undefined);
  state.accept(dispatch('MESSAGE_DELETE', { id: sf(520), guild_id: GUILD, channel_id: CHAN }));
  state.accept(dispatch('MESSAGE_UPDATE', { id: sf(520), guild_id: GUILD, channel_id: CHAN, edited_timestamp: '2026-05-05T00:00:00.000000+00:00' }));
  assert.equal(state.message(sf(520)), null);
});

test('GS-13 MESSAGE_DELETE and MESSAGE_DELETE_BULK mark messages deleted', () => {
  const state = ready();
  for (const n of [530, 531, 532]) state.accept(dispatch('MESSAGE_CREATE', { id: sf(n), guild_id: GUILD, channel_id: CHAN, author: user(ALICE) }));
  state.accept(dispatch('MESSAGE_DELETE', { id: sf(530), guild_id: GUILD, channel_id: CHAN }));
  state.accept(dispatch('MESSAGE_DELETE_BULK', { ids: [sf(531), sf(532), 'bogus'], guild_id: GUILD, channel_id: CHAN }));
  assert.deepEqual([530, 531, 532].map(n => state.message(sf(n))), [null, null, null]);
});

test('GS-14 message LRU evicts the oldest insertion and re-recording refreshes position', () => {
  const state = create({ messageCapacity: 3 });
  const post = n => state.accept(dispatch('MESSAGE_CREATE', { id: sf(n), guild_id: GUILD, channel_id: CHAN, author: user(ALICE) }));
  post(1000); post(1001); post(1002); post(1000); post(1003);
  assert.equal(state.message(sf(1001)), undefined);
  assert.notEqual(state.message(sf(1000)), undefined); assert.notEqual(state.message(sf(1002)), undefined); assert.notEqual(state.message(sf(1003)), undefined);
  assert.equal(state.status().messages, 3);
});

test('GS-15 member capacity evicts the oldest member', () => {
  const state = create({ memberCapacity: 2 });
  for (const id of [sf(20), sf(21), sf(22)]) state.accept(dispatch('GUILD_MEMBER_ADD', { guild_id: GUILD, user: user(id), roles: [] }));
  assert.equal(state.member(sf(20)), undefined); assert.notEqual(state.member(sf(21)), undefined); assert.equal(state.status().members, 2);
});

test('GS-16 rememberMember stores REST members, null as known-absent, and rejects mismatches', () => {
  const state = ready();
  state.rememberMember(BOB, { user: user(BOB), roles: [ROLE_B], joined_at: '2026-06-06T00:00:00.000Z' });
  assert.deepEqual(state.member(BOB).roles, [ROLE_B]);
  state.rememberMember(BOB, null); assert.equal(state.member(BOB), null);
  state.rememberMember(sf(14), { user: user(sf(15)), roles: [] }); assert.equal(state.member(sf(14)), undefined);
  state.rememberMember('bogus', null); state.rememberMember(sf(16), 'junk'); state.rememberMember(sf(17), undefined);
  assert.equal(state.member('bogus'), undefined); assert.equal(state.member(sf(16)), undefined); assert.equal(state.member(sf(17)), undefined);
  state.rememberMember(BOB, { user: user(BOB), roles: [ROLE_A] }); assert.deepEqual(state.member(BOB).roles, [ROLE_A]);
});

test('GS-17 accessors return copies that cannot mutate state', () => {
  const state = ready();
  state.accept(dispatch('MESSAGE_CREATE', { id: sf(540), guild_id: GUILD, channel_id: CHAN, author: user(ALICE) }));
  state.guild().ownerId = 'x'; state.roles()[0].permissions = 'x'; state.roles().pop();
  state.channel(CHAN).overwrites.push('x'); state.member(ALICE).roles.push('x'); state.emoji(sf(300)).roles.push('x'); state.message(sf(540)).revision = 'x';
  assert.equal(state.guild().ownerId, OWNER); assert.equal(state.roles().length, 2); assert.equal(state.roles()[0].permissions, '1024');
  assert.equal(state.channel(CHAN).overwrites.length, 1); assert.deepEqual(state.member(ALICE).roles, [ROLE_A, ROLE_B]);
  assert.deepEqual(state.emoji(sf(300)).roles, [ROLE_A]); assert.equal(state.message(sf(540)).revision, 'original');
  assert.equal(Object.isFrozen(state), true);
});

test('GS-18 accept never throws on garbage and leaves state intact', () => {
  const state = ready();
  const hostile = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  const garbage = [undefined, null, 0, 'GUILD_CREATE', [], {}, { op: 0 }, { op: 1, t: 'READY' }, { op: 0, t: 7, d: {} }, { op: 0, t: 'GUILD_CREATE' },
    { op: 0, t: 'GUILD_CREATE', d: null }, { op: 0, t: 'GUILD_CREATE', d: hostile }, hostile, { op: 0, t: 'MESSAGE_CREATE', d: { guild_id: GUILD } },
    { op: 0, t: 'MESSAGE_CREATE', d: { guild_id: GUILD, id: 1, channel_id: [], author: 'x', member: 5 } },
    { op: 0, t: 'GUILD_ROLE_CREATE', d: { guild_id: GUILD, role: 5 } }, { op: 0, t: 'GUILD_ROLE_DELETE', d: { guild_id: GUILD } },
    { op: 0, t: 'GUILD_MEMBER_ADD', d: { guild_id: GUILD, user: null, roles: null } }, { op: 0, t: 'GUILD_MEMBER_REMOVE', d: { guild_id: GUILD } },
    { op: 0, t: 'MESSAGE_DELETE_BULK', d: { guild_id: GUILD, ids: 'x' } }, { op: 0, t: 'CHANNEL_CREATE', d: { guild_id: GUILD, id: CHAN, type: 'x' } },
    { op: 0, t: 'GUILD_EMOJIS_UPDATE', d: { guild_id: GUILD, emojis: [null, 5, {}] } }, { op: 0, t: 'UNKNOWN_EVENT', d: { guild_id: GUILD } }];
  for (const item of garbage) assert.doesNotThrow(() => state.accept(item));
  assert.equal(state.ready(), false); // the hostile GUILD_CREATE was not ours; the earlier malformed one is the only thing that may flip it
  assert.deepEqual(state.guild(), { id: GUILD, ownerId: OWNER }); assert.equal(state.roles().length, 2); assert.equal(state.member(ALICE).userId, ALICE);
});

test('GS-19 construction requires Discord ids', () => {
  assert.throws(() => createGuildState({ guildId: '0123', botUserId: BOT }));
  assert.throws(() => createGuildState({ guildId: GUILD, botUserId: 5 }));
  assert.equal(createGuildState({ guildId: GUILD, botUserId: BOT }).session(), 0);
});
