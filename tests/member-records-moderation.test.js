import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGELOG_OPENING, MESSAGE_MAX, changelogLine, entryLabel, entryParts, entryText, moderationEventId, quietEntry, renderHeader, requireModerationRow }
  from '../modules/member-records/index.js';
import { createCentralIdentity } from '../apps/core/storage/central-identity.js';
import { createMemberRecordModerationFeed } from '../apps/core/discord/member-record-moderation.js';
import { createDiscordTransport } from '../apps/core/discord/transport.js';

// Synthetic data only; every ID, name and text is made up.
const ids = n => `1${String(n).padStart(17, '0')}`;
const GUILD = ids(1), FORUM = ids(60), POST = ids(62), MEMBER = ids(12);
const AT = Date.UTC(2026, 9, 1, 10, 0);
const REV = 'a'.repeat(32), REV2 = 'b'.repeat(32);
const ban = (change = {}) => ({ scope: 'role', roles: ['Captain', 'Security Officer'], admin: 'TestAdmin', reason: 'Synthetic reason', roundId: 7,
  expiresAt: AT + 86_400_000, appliesToAdmins: false, edited: false, lifted: false, lifts: [], ...change });
const note = (change = {}) => ({ type: 'note', admin: 'TestAdmin', text: 'Synthetic note text', severity: 'minor', secret: false, seen: null, roundId: 3,
  expiresAt: null, edited: false, editedBy: null, deleted: null, ...change });
const message = (n, change = {}) => ({ at: AT + n * 60_000, action: n === 0 ? 'Ticket Opened' : 'Reply', from: n % 2 ? 'testadmin' : 'testplayer',
  to: n % 2 ? 'testplayer' : null, text: `Synthetic message ${n}`, ...change });
const ticket = (change = {}) => ({ roundId: 5, number: 2, urgent: false, outcome: 'resolved', handledBy: 'testadmin', closedAt: AT + 600_000, messagesOmitted: 0,
  messages: [message(0), message(1), { at: AT + 600_000, action: 'Resolved', from: 'testadmin', to: null, text: 'Resolved by TestAdmin' }], ...change });
const entry = (kind, record, extra = {}) => ({ kind, atMs: AT, game: 'ss13', serverId: 'meridian-main', sourceKey: 'ban.4', recordKind: kind.slice(5), record, ...extra });
const row = (change = {}) => ({ discordId: MEMBER, serverId: 'meridian-main', game: 'ss13', sourceKey: 'ban.4', recordKind: 'ban', occurredAtMs: AT, final: true,
  revision: REV, detail: ban(), present: true, ...change });

test('MR-40 a game ban: who, duration, roles, round, lifts and the reason quoted literally', () => {
  const [text] = entryParts(entry('game.ban', ban({ lifts: [{ role: 'Captain', at: AT + 3_600_000, by: 'OtherAdmin' }] })));
  assert.match(text, /^\*\*Meridian Rift role ban\*\* · 1 Oct 2026, 10:00 UTC · by TestAdmin\n/);
  assert.match(text, /Duration: until <t:\d+:f> \(2 Oct 2026, 10:00 UTC\)/);
  assert.match(text, /Roles: Captain, Security Officer/);
  assert.match(text, /-# round 7/);
  assert.match(text, /Lifted for Captain by OtherAdmin/);
  assert.match(text, /\*\*Reason\*\*\n> Synthetic reason$/);
  assert.match(entryParts(entry('game.ban', ban({ scope: 'server', roles: [], expiresAt: null, lifted: true, lifts: [{ role: null, at: AT, by: 'x' }] })))[0],
    /\*\*Meridian Rift ban\*\*.*\nDuration: permanent\n[\s\S]*\*\*Lifted\*\* by x/);
  assert.equal(entryLabel(entry('game.ban', ban())), 'Meridian Rift role ban');
  assert.equal(entryText(entry('game.ban', ban())), entryParts(entry('game.ban', ban()))[0]);
});

test('MR-41 a game note: type, secret marker, severity, deletion; Wolfgate names its game', () => {
  const [text] = entryParts(entry('game.note', note({ secret: true, deleted: { by: 'OtherAdmin', at: AT + 1 } }), { game: 'ss14' }));
  assert.match(text, /^\*\*Wolfgate note\*\* · secret · 1 Oct 2026, 10:00 UTC · by TestAdmin\n-# severity minor · round 3\n\*\*Deleted in game\*\* by OtherAdmin/);
  assert.match(text, /> Synthetic note text$/);
  assert.equal(entryLabel(entry('game.note', note({ secret: true }))), 'Meridian Rift note (secret)');
  assert.equal(entryLabel(entry('game.note', note({ type: 'watchlist' }))), 'Meridian Rift watchlist entry');
  assert.match(entryParts(entry('game.note', note({ type: 'message', seen: false })))[0], /admin message[\s\S]*not yet seen by the player/);
});

test('MR-42 an admin help ticket is its full transcript; closing lines are not quoted; it stays out of the ledger and changelog', () => {
  const parts = entryParts(entry('game.ticket', ticket(), { sourceKey: 'ticket.5.2' }));
  assert.equal(parts.length, 1);
  assert.match(parts[0], /^\*\*Meridian Rift admin help\*\* · ticket #2, round 5 · opened 1 Oct 2026, 10:00 UTC\nResolved by testadmin · <t:\d+:f> \(1 Oct 2026, 10:10 UTC\) · 3 messages\n/);
  assert.match(parts[0], /-# 1 Oct 2026, 10:00 UTC · Ticket Opened · testplayer\n> Synthetic message 0\n-# 1 Oct 2026, 10:01 UTC · Reply · testadmin → testplayer\n> Synthetic message 1/);
  assert.match(parts[0], /-# 1 Oct 2026, 10:10 UTC · Resolved · testadmin$/);
  assert.equal(quietEntry('game.ticket'), true); assert.equal(quietEntry('game.changed', { recordKind: 'ticket' }), true);
  assert.equal(quietEntry('game.ban'), false); assert.equal(quietEntry('game.changed', { recordKind: 'note' }), false);
  assert.equal(quietEntry('message.deleted'), true);
  assert.match(entryParts(entry('game.ticket', ticket({ outcome: 'open', handledBy: null, closedAt: null })))[0], /Not closed in game; the round has ended/);
});

test('MR-43 a long ticket fills at most 20 messages and says how many were left out; every part fits Discord', () => {
  const long = Array.from({ length: 300 }, (_, n) => message(n, { text: `${'Synthetic words '.repeat(60)}${n}` }));
  const parts = entryParts(entry('game.ticket', ticket({ messages: long, messagesOmitted: 5 })));
  assert.equal(parts.length, 20);
  assert.ok(parts.every(part => part.length <= MESSAGE_MAX), parts.map(part => part.length).join());
  assert.match(parts.at(-1), /-# \d+ more messages not shown here; the full ticket is in the game database\.$/);
});

test('MR-44 changes: a lift, a reworded reason, a deleted note, more ticket messages, a removal', () => {
  const change = (recordKind, before, after, extra = {}) => ({ kind: 'game.changed', atMs: AT, game: 'ss13', recordKind, before, after, present: true, wasPresent: true, ...extra });
  const lifted = entryParts(change('ban', ban(), ban({ lifted: true, lifts: [{ role: null, at: AT, by: 'OtherAdmin' }], reason: 'Reworded' })))[0];
  assert.match(lifted, /^\*\*Meridian Rift role ban updated\*\* · 1 Oct 2026, 10:00 UTC\n\*\*Lifted\*\* by OtherAdmin[\s\S]*\*\*Reason now\*\*\n> Reworded$/);
  assert.match(entryParts(change('note', note(), note({ deleted: { by: 'OtherAdmin', at: null } })))[0], /\*\*Deleted in game\*\* by OtherAdmin$/);
  const more = entryParts(change('ticket', ticket({ outcome: 'resolved' }), ticket({ outcome: 'resolved', messages: [...ticket().messages, message(5, { action: 'Reply' })] })))[0];
  assert.match(more, /Reply · testadmin → testplayer\n> Synthetic message 5$/);
  assert.match(entryParts(change('ban', ban(), ban(), { present: false }))[0], /No longer in the game database/);
  assert.match(entryParts(change('ban', ban(), ban(), { wasPresent: false }))[0], /Back in the game database\.$/);
  assert.match(entryParts(change('ban', ban(), ban({ edited: true, editedBy: 'x' })))[0], /\nEdited in game by x\.$/);
  assert.match(entryParts(change('note', note(), note()))[0], /\n-# Details changed in the game database\.$/);
  assert.equal(entryLabel(change('note', note(), note())), 'Meridian Rift note updated');
});

test('MR-45 hostile text in reasons, notes, names and tickets cannot mention, format or link, and passes the real transport', async () => {
  const hostile = '@everyone <@123> <@&456> **bold** [x](https://x.test) # big\n> quote';
  const parts = [
    ...entryParts(entry('game.ban', ban({ admin: '@here', reason: hostile, roles: ['@everyone'] }))),
    ...entryParts(entry('game.note', note({ admin: '<@123>', text: hostile }))),
    ...entryParts(entry('game.ticket', ticket({ messages: [message(0, { from: '@everyone', text: hostile })] }))),
  ];
  for (const text of parts) {
    assert.ok(!/(?<!\\)@(everyone|here)/.test(text), text);
    assert.ok(!/(?<!\\)<@/.test(text) && !/(?<!\\)\[x\]/.test(text), text);
  }
  const sent = [];
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    recordForumId: FORUM, fetch: async (url, init) => { sent.push(JSON.parse(init.body).content); return Response.json({ id: ids(65) }); } });
  for (const text of parts) await transport.createMemberRecordMessage(POST, 'a'.repeat(24), text);
  assert.deepEqual(sent, parts);
});

test('MR-46 rows from the central view are checked; entry IDs are stable and distinct per change', async () => {
  assert.equal(requireModerationRow(row()).sourceKey, 'ban.4');
  for (const bad of [{ discordId: 'everyone' }, { serverId: 'Meridian Main' }, { game: 'ss15' }, { sourceKey: 'ban.x' }, { sourceKey: 'note.4' },
    { revision: 'zz' }, { final: 'yes' }, { detail: [] }, { occurredAtMs: -1 }])
    assert.throws(() => requireModerationRow(row(bad)), /MEMBER_RECORD_MODERATION_INVALID|INVALID_DISCORD_ID/, JSON.stringify(bad));
  assert.equal(moderationEventId('meridian-main', 'ticket.5.2'), 'gm.meridian-main.ticket.5.2');
  assert.equal(moderationEventId('wolfgate', 'note.3', { mark: 'r', revision: REV2 }), 'gm.wolfgate.note.3.rbbbbbbbb');
  assert.notEqual(moderationEventId('wolfgate', 'note.3', { mark: 'x', revision: REV2 }), moderationEventId('wolfgate', 'note.3', { mark: 'r', revision: REV2 }));
  assert.throws(() => moderationEventId('wolfgate', 'note.3', { mark: 'q', revision: REV2 }), /MEMBER_RECORD_MODERATION_INVALID/);
  const central = createCentralIdentity({ pool: { query: async sql => {
    assert.match(sql, /FROM identity\.member_moderation/);
    return { rows: [{ discord_id: MEMBER, server_id: 'wolfgate', kind: 'ss14', source_key: 'roleban.9', record_kind: 'ban', occurred_at_ms: String(AT), final: true,
      revision: REV, detail: ban(), present: true }] };
  } } });
  assert.deepEqual(await central.readModerationRecords(), [row({ serverId: 'wolfgate', game: 'ss14', sourceKey: 'roleban.9' })]);
});

test('MR-47 the moderation feed runs at start, then every 15 minutes; a failure waits a minute and enters nothing', async () => {
  let now = AT, reads = 0; const entered = [];
  const central = { async readModerationRecords() { reads += 1; if (reads === 2) throw Object.assign(new Error('down'), { code: 'CENTRAL_DATABASE_UNAVAILABLE' }); return [row()]; } };
  const store = { async enterModeration(rows) { entered.push(rows); return { entered: 1, changed: 0, skipped: 0 }; } };
  const feed = createMemberRecordModerationFeed({ store, central, enabled: async () => true, clock: () => now });
  assert.deepEqual(await feed.runDue('moderation'), { status: 'fed', read: 1, entered: 1, changed: 0, skipped: 0 });
  now += 14 * 60_000; assert.deepEqual(await feed.runDue('moderation'), { status: 'idle' });
  now += 60_000; assert.deepEqual(await feed.runDue('moderation'), { status: 'failed', code: 'CENTRAL_DATABASE_UNAVAILABLE' });
  assert.equal(entered.length, 1);
  now += 60_000; assert.equal((await feed.runDue('moderation')).status, 'fed');
  assert.deepEqual(await createMemberRecordModerationFeed({ store, central, enabled: async () => false, clock: () => now }).runDue('moderation'), { status: 'disabled' });
});

test('MR-48 the header counts game moderation per game; the changelog line and opening fit', () => {
  const header = renderHeader({ userId: MEMBER, username: 'synthetic', displayName: null, present: true, roles: {}, joinedAtMs: AT, joinCount: 1, lastLeftAtMs: null,
    shuttle: null, mutes: 0, application: null, earlierNames: [], note: null, updatedAtMs: AT,
    gameModeration: { ss13: { ban: 1, note: 2, ticket: 3 }, ss14: { ban: 0, note: 0, ticket: 1 } } });
  assert.match(header, /\*\*Moderation:\*\* no mutes on record · Meridian Rift: 1 ban, 2 notes, 3 admin helps · Wolfgate: 1 admin help\n/);
  assert.match(renderHeader({ userId: MEMBER, username: 'synthetic', displayName: null, present: true, roles: {}, joinedAtMs: AT, joinCount: 1, lastLeftAtMs: null,
    shuttle: null, mutes: 0, application: null, earlierNames: [], note: null, updatedAtMs: AT }), /\*\*Moderation:\*\* no mutes on record\n/);
  assert.match(changelogLine(entry('game.note', note()), { guildId: GUILD, userId: MEMBER, username: 'synthetic', threadId: POST, messageId: ids(70) }), /\*\*Meridian Rift note\*\*/);
  assert.ok(CHANGELOG_OPENING.length <= MESSAGE_MAX, String(CHANGELOG_OPENING.length));
  assert.match(CHANGELOG_OPENING, /Meridian Rift and Wolfgate bans, unbans, notes/);
});
