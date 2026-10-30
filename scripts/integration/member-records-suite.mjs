import assert from 'node:assert/strict';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { createMemberRecordIngress } from '../../apps/core/discord/member-record-ingress.js';
import { createMemberRecordDispatcher } from '../../apps/core/discord/member-records.js';
import { createMemberRecordStore, recordSophieWhitelist } from '../../apps/core/storage/member-records.js';
import { planMemberRecordBackfill, planDepartedMemberRecords } from '../../apps/core/operator/member-record-backfill.js';
import { inTransaction } from '../../apps/core/storage/transaction.js';
import { createMemberRecordReconciler } from '../../apps/core/discord/member-record-reconciler.js';
import { mapping, CREW, WHITELIST, MUZZLED, BOT } from '../../tests/fixtures/discord.js';
import { GUILD, USER, OTHER, STAFF, NOW } from '../../tests/fixtures/domain.js';
import { APPLICATION } from '../../tests/fixtures/interactions.js';
import { gatewayEvent, readyEvent, guildEvent } from '../../tests/fixtures/gateway.js';
import { resetCoreState, resetTables } from '../../tests/fixtures/reset.js';

// Synthetic data only; every ID is made up.
const FORUM = '100000000000000601', CHANGELOG = '100000000000000602', THIRD = '100000000000000603', FOURTH = '100000000000000604';
const TAG_IDS = { 'In server': '100000000000000611', Left: '100000000000000612', Whitelisted: '100000000000000613', Muzzled: '100000000000000614',
  Staff: '100000000000000615', Watch: '100000000000000616' };
const REQUEST = '100000000000000621', APPROVER = '100000000000000622', EVENT_HOST = '100000000000000640';
// Ordinary channels for a leaver's message links: a public one, a ticket channel in the protected category, a thread in a
// ticket channel, and one of Sophie's excluded case channels.
const PROTECTED = '100000000000000631', GENERAL = '100000000000000632', TICKET = '100000000000000633', TICKET_THREAD = '100000000000000634', CASE = '100000000000000635';
const CHANNELS = new Map([[GENERAL, '100000000000000630'], [TICKET, PROTECTED], [TICKET_THREAD, TICKET], [CASE, ''], ['100000000000000630', ''], [PROTECTED, '']]);

/** A small stand-in for Discord's forum: posts, Sophie's messages (deduplicated by nonce, as Discord does), tags, archiving. */
function simulatedForum() {
  let next = 900000000000000000n;
  const id = () => String(++next);
  const threads = new Map([[CHANGELOG, { name: 'Sophie\'s changelog', tags: [], archived: true, ownerId: BOT, messages: [] }]]);
  const calls = [];
  let failNext = null, approved = [];
  const failing = (method, effect = false) => { if (failNext?.method !== method) return null; const fault = failNext; failNext = null; return { ...fault, effect }; };
  const error = code => Object.assign(new Error(code), { code });
  const open = threadId => { const thread = threads.get(threadId); if (!thread) throw error('DISCORD_RESOURCE_MISSING'); if (thread.archived) throw error('DELIVERY_UNCERTAIN'); return thread; };
  const transport = {
    guildId: GUILD,
    async createMemberRecordThread(body) {
      calls.push(['thread', body.name]);
      const fault = failing('thread');
      if (fault && !fault.afterEffect) throw error(fault.code);
      const threadId = id();
      threads.set(threadId, { name: body.name, tags: [...body.applied_tags], archived: false, ownerId: BOT, messages: [{ id: threadId, content: body.message.content, nonce: null }] });
      if (fault) throw error(fault.code);
      return { id: threadId };
    },
    async editMemberRecordThread(threadId, body) {
      calls.push(['edit-thread', threadId, Object.keys(body).sort().join(',')]);
      const thread = threads.get(threadId); if (!thread) return null;
      if (thread.archived && body.archived !== false) throw error('DELIVERY_UNCERTAIN');
      if (body.archived !== undefined) thread.archived = body.archived;
      if (body.name !== undefined) thread.name = body.name;
      if (body.applied_tags !== undefined) thread.tags = [...body.applied_tags];
      return { id: threadId };
    },
    async createMemberRecordMessage(channelId, nonce, content) {
      calls.push(['post', channelId]);
      const thread = open(channelId);
      const fault = failing('post');
      if (fault && !fault.afterEffect) throw error(fault.code);
      let message = thread.messages.find(item => item.nonce === nonce);
      if (!message) { message = { id: id(), content, nonce }; thread.messages.push(message); }
      if (fault) throw error(fault.code);
      return { id: message.id };
    },
    async editMemberRecordMessage(channelId, messageId, content) {
      calls.push(['edit', channelId]);
      const message = open(channelId).messages.find(item => item.id === messageId); if (!message) return null;
      message.content = content; return { id: messageId };
    },
    async getChannel(channelId) {
      const thread = threads.get(channelId);
      if (!thread && CHANNELS.has(channelId)) return { id: channelId, parent_id: CHANNELS.get(channelId) || null };
      return thread ? { id: channelId, parent_id: FORUM, applied_tags: [...thread.tags], thread_metadata: { archived: thread.archived } } : null;
    },
    members: [],
    async getMemberRecordMembers({ after }) { calls.push(['members']); return structuredClone(transport.members.filter(member => BigInt(member.userId) > BigInt(after))); },
    audit: [], roleAudit: [],
    async getRoleUpdateAudit() { calls.push(['role-audit']); return structuredClone(transport.roleAudit); },
    async getRoles() { calls.push(['roles']); return [{ id: CREW, name: 'Crew', position: 1 }, { id: WHITELIST, name: 'Whitelisted', position: 2 },
      { id: MUZZLED, name: 'Muzzled', position: 3 }, { id: STAFF, name: 'Staff', position: 5 }, { id: EVENT_HOST, name: 'Event Host', position: 4 }]; },
    async getMessageDeleteAudit() { calls.push(['audit']); return structuredClone(transport.audit); },
    async getRecordChannelMap() { calls.push(['channel-map']); return [...CHANNELS].map(([channelId, parentId]) => ({ channelId, parentId: parentId || null, deleted: false })); },
    async getRecordUser(userId) { calls.push(['user', userId]); return { username: `user${userId.slice(-3)}`, globalName: null, bot: false }; },
    async getMemberRecordThreads() { calls.push(['search']); return [...threads].filter(([key]) => key !== CHANGELOG).map(([key, thread]) => ({ id: key, name: thread.name, ownerId: thread.ownerId })); },
    async getApprovedJoinRequests() { calls.push(['requests']); return structuredClone(approved); },
  };
  return { transport, threads, calls, fail: fault => { failNext = fault; }, approve: list => { approved = list; },
    posts: () => [...threads].filter(([key]) => key !== CHANGELOG), changelog: () => threads.get(CHANGELOG).messages.map(item => item.content) };
}

/** Member records (P56) on real PostgreSQL, through the real Gateway journal; Discord is simulated. */
export async function runMemberRecordsSuite(cluster, run) {
  const pool = cluster.corePool, admin = cluster.adminPool;
  let now, journal, observer, connection, sequence, forum, store, dispatcher, faults;
  const rows = async (table, order = '1') => (await admin.query(`SELECT * FROM sophie_core.${table} ORDER BY ${order}`)).rows;
  const send = (type, data) => observer.accept(connection, gatewayEvent(++sequence, type, data));
  const user = (userId, username, globalName = null) => ({ id: userId, username, global_name: globalName });
  const join = (userId, username, roles = [CREW], globalName = null) => send('GUILD_MEMBER_ADD', { guild_id: GUILD, user: user(userId, username, globalName), nick: null, roles,
    joined_at: new Date(now).toISOString() });
  const update = (userId, username, roles, globalName = null, nick = null) => send('GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: user(userId, username, globalName), nick, roles,
    joined_at: new Date(NOW).toISOString() });
  const leave = (userId, username) => send('GUILD_MEMBER_REMOVE', { guild_id: GUILD, user: user(userId, username) });
  async function drain(limit = 30) {
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await dispatcher.runOnce('member-records');
      if (result.status === 'idle') return results;
      results.push(result);
    }
    assert.fail('member records did not settle');
  }
  const due = () => admin.query('UPDATE sophie_core.member_records SET due_at = clock_timestamp()');
  const application = (userId = USER) => ({ id: REQUEST, userId, status: 'APPROVED', reviewedAtMs: NOW - 60_000, approvedBy: APPROVER, formResponses: [
    { field_type: 'MULTIPLE_CHOICE', label: 'Do you agree to an age check?', response: 0, choices: ['Yes', 'No'] },
    { field_type: 'TEXT_INPUT', label: 'What is your date of birth? Month and year only, MM/YYYY', response: '04/1998', choices: [] },
    { field_type: 'TEXT_INPUT', label: 'What is your BYOND ckey and/or SS14 username?', response: 'BYOND: VexCat', choices: [] }] });

  const scenario = (name, work) => run(name, async () => {
    await admin.query("UPDATE sophie_core.discord_backoff SET until_at = '-infinity', paused = false");
    await resetCoreState(admin);
    await resetTables(admin, 'sophie_core.member_record_messages, sophie_core.member_record_events, sophie_core.member_records, sophie_core.case_exclusions');
    now = NOW; faults = [];
    journal = createGatewayJournal({ pool, mapping, clock: () => now, reconcileMembers: false,
      memberRecords: createMemberRecordIngress({ guildId: GUILD, protectedCategoryId: PROTECTED }), onMemberRecordFault: code => faults.push(code) });
    observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: () => now });
    await observer.acquire('gateway-worker');
    ({ connection } = await observer.beginIdentify());
    await observer.accept(connection, readyEvent());
    observer.heartbeatAcknowledged(connection, 45_000);
    await observer.accept(connection, guildEvent()); sequence = 2;
    forum = simulatedForum(); forum.approve([application()]);
    store = createMemberRecordStore({ pool, clock: () => now, guildId: GUILD, forumId: FORUM, changelogThreadId: CHANGELOG });
    dispatcher = createMemberRecordDispatcher({ store, transport: forum.transport, botUserId: BOT, tagIds: TAG_IDS, protectedCategoryId: PROTECTED, enabled: async () => true, clock: () => now });
    await work();
  });

  await scenario('MRS-01 a join opens a record, and core opens the post: header, ledger, application, two reserved, entries, changelog, archived', async () => {
    assert.equal(observer.intents, 3 | 33280, 'member records read the Staff discussion');
    await join(USER, 'vexthecat', [CREW], 'Vex');
    const [record] = await rows('member_records');
    assert.equal(record.thread_id, null); assert.equal(record.background, false); assert.equal(record.profile.joinCount, 1);
    assert.deepEqual((await drain()).map(result => result.status), ['settled']);
    const posts = forum.posts(); assert.equal(posts.length, 1);
    const [threadId, post] = posts[0];
    assert.equal(post.name, `vexthecat · Vex · ${USER}`); assert.deepEqual(post.tags, [TAG_IDS['In server']]); assert.equal(post.archived, true);
    const contents = post.messages.map(message => message.content);
    assert.match(contents[0], /^## Vex \(@vexthecat\)/); assert.match(contents[0], /\*\*Born:\*\* 04\/1998/); assert.match(contents[0], /SS13, Meridian Rift: vexcat/);
    assert.match(contents[1], /^\*\*Ledger\*\* · 2 automatic entries/);
    assert.match(contents[2], /^\*\*Access application\*\* · approved/); assert.match(contents[2], /04\/1998/);
    assert.match(contents[3], /Reserved by Sophie: game records/); assert.equal(contents[4], '-# Reserved by Sophie.');
    assert.match(contents[5], /^\*\*Joined\*\* · .* · first join$/); assert.equal(contents.length, 6);
    assert.ok(contents[1].includes(`/${threadId}/${post.messages[5].id})`) && contents[1].includes(`/${threadId}/${post.messages[2].id})`), 'the ledger links both');
    const changelog = forum.changelog();
    assert.equal(changelog.length, 2); assert.match(changelog[0], /\*\*Access application\*\* · <@100000000000000002> \(vexthecat\) · \[entry\]/);
    assert.match(changelog[1], /\*\*Joined · first join\*\*/);
    assert.equal(forum.threads.get(CHANGELOG).archived, false, 'the changelog was woken to write');
    const [delivered] = await rows('member_records');
    assert.equal(delivered.thread_id, threadId); assert.equal(delivered.delivered_revision, delivered.revision); assert.equal(delivered.application.status, 'found');
    assert.ok((await rows('member_record_events')).every(event => event.message_id && event.changelog_message_id));
    assert.deepEqual((await rows('case_exclusions', 'channel_id')).map(row => row.channel_id), [FORUM, CHANGELOG], 'never an AI context');
    assert.deepEqual(await drain(), [], 'nothing left to do');
    assert.ok(!forum.calls.some(([kind]) => kind === 'edit-thread' && false));
  });

  await scenario('MRS-02 roles, names, a leave and a rejoin become entries; the header, tags and title follow', async () => {
    await join(USER, 'vexthecat', [CREW], 'Vex'); await drain();
    now += 60_000; await update(USER, 'vexthecat', [CREW, WHITELIST, MUZZLED], 'Vex');
    now += 60_000; await update(USER, 'vexy', [CREW, WHITELIST, MUZZLED], 'Vex', 'Captain Vex');
    now += 60_000; await update(USER, 'vexy', [CREW, WHITELIST, MUZZLED], 'Vex', 'Captain Vex');
    await drain();
    const [threadId, post] = forum.posts()[0];
    const entries = post.messages.slice(5).map(message => message.content);
    assert.deepEqual(entries.map(text => text.split(' · ')[0]), ['**Joined**', '**Whitelist given**', '**Muzzled**', '**Name changed**']);
    assert.ok(entries[3].endsWith('Vex \\(\\@vexthecat\\) → Captain Vex \\(\\@vexy\\)'), entries[3]);
    assert.equal(post.name, `vexy · Captain Vex · ${USER}`); assert.deepEqual(post.tags, [TAG_IDS['In server'], TAG_IDS.Whitelisted, TAG_IDS.Muzzled]);
    assert.match(post.messages[0].content, /\*\*Earlier names:\*\* vexthecat, Vex/); assert.match(post.messages[0].content, /1 mute on record/);
    assert.equal(post.archived, true, 'archived again after Sophie woke it');
    // A Watch tag Staff set stays through Sophie's own changes.
    post.tags.push(TAG_IDS.Watch);
    now += 60_000; await leave(USER, 'vexy'); await drain();
    assert.deepEqual(post.tags, [TAG_IDS.Left, TAG_IDS.Watch]);
    assert.match(post.messages.at(-1).content, /^\*\*Left or removed\*\* · .* · Whitelist ends; a fresh Shuttle run is needed to regain it\n-# No recent messages on record\.$/);
    assert.match(post.messages[0].content, /\*\*Status:\*\* Left or removed/);
    now += 60_000; await join(USER, 'vexy', [CREW], 'Vex'); await drain();
    // A rejoin drops the server nickname, which is a name change too.
    assert.match(post.messages.at(-2).content, /^\*\*Joined\*\* · .* · join 2$/); assert.match(post.messages.at(-1).content, /^\*\*Name changed\*\*/);
    assert.equal((await rows('member_record_events')).filter(event => event.kind === 'application').length, 1, 'the same application is not entered twice');
    assert.equal(forum.posts().length, 1); assert.equal(threadId, (await rows('member_records'))[0].thread_id);
    assert.equal(forum.changelog().length, 8, 'every entry has its changelog line: application, joined, Whitelist, Muzzled, name, left, joined, name');
    assert.match(post.messages[1].content, /^\*\*Ledger\*\* · 8 automatic entries/);
  });

  await scenario('MRS-03 Sophie\'s own Whitelist is one entry with its reading time, not a second one from the role', async () => {
    await join(USER, 'vexthecat'); await drain();
    await admin.query(`INSERT INTO sophie_core.outbox (guild_id, operation_id, user_id, kind, effect, status, lease_owner, lease_until)
      VALUES ($1, 'grant.synthetic.1', $2, 'whitelist.grant', $3, 'leased', 'synthetic', clock_timestamp() + interval '1 minute')`,
    [GUILD, USER, { guildId: GUILD, userId: USER, operationId: 'grant.synthetic.1', kind: 'whitelist.grant' }]);
    now += 1_000; await update(USER, 'vexthecat', [CREW, WHITELIST]);
    assert.equal((await rows('member_record_events')).some(event => event.kind === 'whitelist.granted'), false);
    const timing = { focusedMs: 845_000, pages: 23, wallMs: 3_130_000, fromStop: 0 };
    for (let index = 0; index < 2; index += 1) await inTransaction(pool, client => recordSophieWhitelist(client, { guildId: GUILD, userId: USER, operationId: 'grant.synthetic.1', atMs: now, timing }));
    await inTransaction(pool, client => recordSophieWhitelist(client, { guildId: GUILD, userId: OTHER, operationId: 'grant.synthetic.2', atMs: now, timing }));
    assert.equal((await rows('member_records')).length, 1, 'no record is opened for a grant');
    await drain();
    const post = forum.posts()[0][1];
    assert.match(post.messages.at(-1).content, /^\*\*Whitelist granted by Sophie\*\* · .* · 14m 05s focused \(52m 10s from boarding\) · 23 pages$/);
    assert.equal(post.messages.filter(message => /^\*\*Whitelist/.test(message.content)).length, 1);
    assert.deepEqual(post.tags, [TAG_IDS['In server'], TAG_IDS.Whitelisted]);
  });

  await scenario('MRS-04 an uncertain creation or post is found again, never made twice', async () => {
    await join(USER, 'vexthecat');
    forum.fail({ method: 'thread', code: 'DELIVERY_UNCERTAIN', afterEffect: true });
    assert.deepEqual((await drain()).map(result => [result.status, result.code]), [['retry', 'DELIVERY_UNCERTAIN']]);
    assert.equal((await rows('member_records'))[0].create_started, true);
    await due(); forum.fail({ method: 'post', code: 'DELIVERY_UNCERTAIN', afterEffect: true });
    assert.deepEqual((await drain()).map(result => result.status), ['retry']);
    await due(); await drain();
    assert.equal(forum.posts().length, 1, 'one post');
    assert.equal(forum.calls.filter(([kind]) => kind === 'thread').length, 1);
    const post = forum.posts()[0][1];
    assert.equal(post.messages.length, 6, 'header, four reserved, one entry: the retried post was the same message');
    forum.fail({ method: 'post', code: 'RATE_LIMITED' });
    now += 1_000; await update(USER, 'vexy', [CREW]);
    const [limited] = await drain(); assert.deepEqual([limited.status, limited.code], ['retry', 'RATE_LIMITED']);
    const [waiting] = await rows('member_records'); assert.equal(waiting.last_error_code, 'RATE_LIMITED'); assert.ok(waiting.due_at > new Date());
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = true');
    await due(); assert.deepEqual(await drain(), [], 'nothing is claimed while delivery is paused');
    await admin.query('UPDATE sophie_core.discord_backoff SET paused = false');
    await drain(); assert.match(post.messages.at(-1).content, /^\*\*Name changed\*\*/);
    // A post creation Discord rate-limited made nothing: the record waits without counting a failure or searching later.
    await join(THIRD, 'later');
    forum.fail({ method: 'thread', code: 'RATE_LIMITED' });
    assert.deepEqual((await drain()).map(result => [result.status, result.code]), [['retry', 'RATE_LIMITED']]);
    const limitedJoin = (await rows('member_records')).find(row => row.user_id === THIRD);
    assert.deepEqual([limitedJoin.create_started, limitedJoin.attempts, limitedJoin.thread_id], [false, 0, null]);
    await due(); const searches = forum.calls.length; await drain();
    assert.ok(!forum.calls.slice(searches).some(([kind]) => kind === 'search'), 'no search for a post that was never made');
    assert.equal(forum.posts().length, 2);
    // A request the delivery gate refused never left: it is asked again in a moment, and the record still settles.
    forum.fail({ method: 'post', code: 'DISCORD_TRANSPORT_DISABLED' });
    now += 1_000; await update(USER, 'vexier', [CREW]);
    assert.deepEqual((await drain()).map(result => result.status), ['settled']);
    assert.match(post.messages.at(-1).content, /^\*\*Name changed\*\* · .*vexier/u);
  });

  await scenario('MRS-05 Staff discussion in a record post is copied; other channels and Sophie\'s own messages are not, and a failure never stops the Gateway', async () => {
    await join(USER, 'vexthecat'); await drain();
    const threadId = forum.posts()[0][0];
    const message = (type, id, content, author = STAFF, channel = threadId) => send(type, { guild_id: GUILD, channel_id: channel, id, content,
      author: { id: author, username: 'staffer' }, attachments: [], timestamp: new Date(now).toISOString() });
    await message('MESSAGE_CREATE', '100000000000000701', 'Seems fine.');
    await message('MESSAGE_UPDATE', '100000000000000701', 'Seems fine, watch the ckey.');
    await send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: threadId, id: '100000000000000701' });
    await message('MESSAGE_CREATE', '100000000000000702', 'Elsewhere.', STAFF, THIRD);
    await message('MESSAGE_CREATE', '100000000000000703', 'Sophie herself.', BOT);
    const copied = await rows('member_record_messages', 'sequence');
    assert.deepEqual(copied.map(row => [row.kind, row.content, row.author_id, row.user_id]),
      [['create', 'Seems fine.', STAFF, USER], ['update', 'Seems fine, watch the ckey.', STAFF, USER], ['delete', null, null, USER]]);
    await admin.query("ALTER TABLE sophie_core.member_record_messages ADD CONSTRAINT synthetic_failure CHECK (content IS DISTINCT FROM 'boom')");
    try {
      await message('MESSAGE_CREATE', '100000000000000704', 'boom');
      assert.deepEqual(faults, ['23514']);
      await message('MESSAGE_CREATE', '100000000000000705', 'After.');
      assert.equal((await rows('member_record_messages')).length, 4);
      assert.equal(Number((await rows('gateway_lifecycle'))[0].sequence), sequence, 'the Gateway recorded every dispatch');
      assert.equal(await observer.isCurrent(), true);
    } finally { await admin.query('ALTER TABLE sophie_core.member_record_messages DROP CONSTRAINT synthetic_failure'); }
  });

  await scenario('MRS-06 the backfill adopts Staff test-run posts, opens the rest behind live work, and runs once', async () => {
    const staffPost = '100000000000000801';
    forum.threads.set(staffPost, { name: `staffer · ${OTHER}`, tags: [TAG_IDS['In server'], TAG_IDS.Staff], archived: true, ownerId: BOT, messages: [
      { id: staffPost, content: 'old header' }, ...['802', '803', '804', '805', '806'].map(tail => ({ id: `100000000000000${tail}`, content: `old ${tail}` }))] });
    const staffRun = { members: { [OTHER]: { threadId: staffPost, createdAt: new Date(NOW - 3_600_000).toISOString(), ledgerLinked: true,
      messages: { header: staffPost, ledger: '100000000000000802', application: '100000000000000803', games: '100000000000000804', spare: '100000000000000805', opened: '100000000000000806' } } } };
    const members = [{ userId: OTHER, bot: false, username: 'staffer', globalName: null, nick: null, roleIds: [STAFF], joinedAtMs: NOW - 9e9 },
      { userId: THIRD, bot: false, username: 'quiet', globalName: null, nick: null, roleIds: [CREW], joinedAtMs: NOW - 8e9 },
      { userId: BOT, bot: true, username: 'sophie', globalName: null, nick: null, roleIds: [], joinedAtMs: NOW }];
    const plan = planMemberRecordBackfill({ members, approved: new Map(), recorded: new Set(await store.recordedMembers()), staffRun, mapping, now });
    for (const item of plan) assert.deepEqual(await store.open(item), { opened: true });
    for (const item of plan) assert.deepEqual(await store.open(item), { opened: false }, 'a second run opens nothing');
    now += 1_000; await join(FOURTH, 'newcomer');
    forum.approve([]);
    await drain();
    assert.deepEqual(forum.calls.filter(([kind]) => kind === 'thread').map(([, name]) => name), [`newcomer · ${FOURTH}`, `quiet · ${THIRD}`], 'the live join first; the Staff post is not opened again');
    const adopted = forum.threads.get(staffPost);
    assert.match(adopted.messages[0].content, /^## @staffer/); assert.match(adopted.messages[0].content, /Opened in the Staff test run/);
    assert.match(adopted.messages[1].content, /^\*\*Ledger\*\* · 1 automatic entry/); assert.equal(adopted.messages[2].content, '-# Reserved by Sophie: the access application. None on record: Discord holds no approved application for this member.');
    assert.equal(adopted.messages.length, 6, 'nothing new posted in the adopted post'); assert.equal(adopted.archived, true);
    const quiet = forum.posts().find(([, post]) => post.name.startsWith('quiet'))[1];
    assert.match(quiet.messages[5].content, /^\*\*Record opened\*\* · .* · already in the server, joined <t:/);
    assert.match(quiet.messages[0].content, /earlier joins not recorded/);
    assert.equal(forum.changelog().length, 3, 'one line per entry: the newcomer, the adopted post, the backfilled one');
    assert.equal((await rows('member_records')).length, 3);
  });

  await scenario('MRS-07 Staff Watch is an entry and the tag; a person who has left gets a Left post', async () => {
    await join(USER, 'vexthecat'); await drain();
    const post = forum.posts()[0][1];
    assert.equal(await store.setWatch({ userId: USER, watch: true, by: STAFF, interactionId: '100000000000000901' }), 'recorded');
    assert.equal(await store.setWatch({ userId: USER, watch: true, by: STAFF, interactionId: '100000000000000902' }), 'unchanged');
    assert.equal(await store.setWatch({ userId: OTHER, watch: true, by: STAFF, interactionId: '100000000000000903' }), 'missing');
    await drain();
    assert.deepEqual(post.tags, [TAG_IDS['In server'], TAG_IDS.Watch]);
    assert.ok(post.messages.at(-1).content.startsWith('**Watch on** by <@100000000000000004> · '));
    assert.ok(forum.changelog().at(-1).includes('**Watch on** · <@100000000000000002>'));
    assert.equal(await store.setWatch({ userId: USER, watch: false, by: STAFF, interactionId: '100000000000000904' }), 'recorded');
    await drain();
    assert.deepEqual(post.tags, [TAG_IDS['In server']]); assert.ok(post.messages.at(-1).content.startsWith('**Watch off**'));
    const plan = planDepartedMemberRecords({ people: [{ userId: THIRD, source: 'records', user: { username: 'gone', globalName: null, bot: false } }],
      current: new Set([USER]), recorded: new Set(await store.recordedMembers()), approved: new Map(), mapping, now });
    for (const item of plan) await store.open(item);
    await drain();
    const gone = forum.posts().find(([, item]) => item.name.startsWith('gone'))[1];
    assert.deepEqual(gone.tags, [TAG_IDS.Left]); assert.equal(gone.archived, true);
    assert.ok(gone.messages[0].content.includes('**Status:** Left or removed')); assert.match(gone.messages[5].content, /not in the server; known from Sophie's earlier records/);
    // If they come back, the record continues.
    now += 1_000; await join(THIRD, 'gone'); await drain();
    assert.ok(gone.messages.at(-1).content.startsWith('**Joined** · ') && gone.messages.at(-1).content.endsWith(' · rejoined (earlier joins not recorded)')); assert.deepEqual(gone.tags, [TAG_IDS['In server']]);
  });

  await scenario('MRS-08 a leave carries its exact time and links to the five latest messages Staff may open', async () => {
    await join(USER, 'vexthecat'); await drain();
    const [threadId, post] = forum.posts()[0];
    await admin.query('INSERT INTO sophie_core.case_exclusions (guild_id, channel_id) VALUES ($1, $2)', [GUILD, CASE]);
    const say = (channel, tail, author = USER) => { now += 1_000; return send('MESSAGE_CREATE', { guild_id: GUILD, channel_id: channel, id: `1000000000000007${tail}`,
      content: 'hello', author: { id: author, username: 'someone' }, attachments: [], timestamp: new Date(now).toISOString() }); };
    await say(GENERAL, 10);
    assert.equal((await rows('member_records'))[0].recent_messages.length, 0, 'nothing kept from a channel whose place is unknown');
    await store.recordChannels(await forum.transport.getRecordChannelMap());
    for (const [channel, tail] of [[GENERAL, 11], [TICKET, 12], [GENERAL, 13], [CASE, 14], [TICKET_THREAD, 15], [GENERAL, 16], [GENERAL, 17], [GENERAL, 18], [GENERAL, 19]]) await say(channel, tail);
    await say(threadId, 20); await say(GENERAL, 21, OTHER);
    const [kept] = await rows('member_records');
    assert.deepEqual(kept.recent_messages.map(item => item.messageId.slice(-2)), ['19', '18', '17', '16', '13', '11'],
      'IDs only, newest first; never tickets, threads under them, case channels or record posts');
    assert.ok(kept.recent_messages.every(item => Object.keys(item).sort().join() === 'atMs,channelId,messageId'), 'no content in the leave links');
    assert.deepEqual((await rows('member_messages', 'message_id')).map(row => row.message_id.slice(-2)), ['11', '13', '16', '17', '18', '19'], 'text kept only where allowed');
    now += 60_000; const leftAt = now; await leave(USER, 'vexthecat'); await drain();
    const entry = post.messages.at(-1).content;
    assert.ok(entry.startsWith('**Left or removed** · ') && entry.includes(`(<t:${Math.floor(leftAt / 1000)}:f>)`), entry);
    const linked = [...entry.matchAll(/discord\.com\/channels\/\d+\/(\d+)\/(\d+)\)/g)].map(match => match[2].slice(-2));
    assert.deepEqual(linked, ['19', '18', '17', '16', '13'], 'five, never a ticket channel, a thread in one, or a case channel');
    assert.ok(post.messages[0].content.includes(`last left <t:${Math.floor(leftAt / 1000)}:f>`), 'the header shows the date and time');
  });

  await scenario('MRS-09 a new application replaces the old one in message 3, and an entry keeps the earlier one as it was', async () => {
    await join(USER, 'vexthecat'); await drain();
    now += 60_000; await leave(USER, 'vexthecat'); await drain();
    forum.approve([{ ...application(), id: '100000000000000623', reviewedAtMs: now, formResponses: [
      { field_type: 'TEXT_INPUT', label: 'What is your date of birth? Month and year only, MM/YYYY', response: '05/1999', choices: [] }] }]);
    now += 60_000; await join(USER, 'vexthecat'); await drain();
    const [threadId, post] = forum.posts()[0];
    assert.ok(post.messages[2].content.includes('05/1999') && !post.messages[2].content.includes('04/1998'), 'message 3 holds the new application');
    assert.ok(post.messages[0].content.includes('**Born:** 05/1999'), 'the header reads the new one');
    const at = post.messages.findIndex(message => message.content.startsWith('**Access application replaced** · '));
    assert.ok(at > 4, 'an entry below the reserved messages');
    assert.ok(post.messages[at + 1].content.startsWith('**Earlier access application** · approved') && post.messages[at + 1].content.includes('04/1998'));
    assert.ok(post.messages[1].content.includes(`/${threadId}/${post.messages[at].id})`), 'the ledger links the replacement');
    assert.ok(forum.changelog().some(line => line.includes('**Access application replaced**')));
    const [record] = await rows('member_records'); assert.equal(record.application.requestId, '100000000000000623');
  });

  await scenario('MRS-10 the regular check opens missing records, notices offline changes and leaves, and distrusts a list that drops many', async () => {
    await join(USER, 'vexthecat'); await join(OTHER, 'other'); await drain();
    const member = (userId, username, roles) => ({ userId, bot: false, username, globalName: null, nick: null, roleIds: roles, joinedAtMs: NOW - 9e9 });
    forum.transport.members = [member(USER, 'vexthecat', [CREW, MUZZLED]), member(THIRD, 'quiet', [CREW]), { ...member(BOT, 'sophie', []), bot: true }];
    forum.approve([]);
    now += 3_600_000;
    const reconciler = createMemberRecordReconciler({ store, transport: forum.transport, mapping, enabled: async () => true, clock: () => now });
    assert.deepEqual({ ...await reconciler.runDue('check') }, { status: 'reconciled', opened: 1, changed: 1, left: 1, departed: 0, textCleared: 0 });
    assert.deepEqual(await reconciler.runDue('check'), { status: 'idle' }, 'not again before six hours');
    await drain();
    const named = name => forum.posts().find(([, item]) => item.name.startsWith(name))[1];
    assert.ok(named('other').messages.at(-1).content.includes('left while she was offline and the exact time is not known'));
    assert.ok(named('vexthecat').messages.at(-1).content.startsWith('**Muzzled**'));
    assert.ok(named('quiet').messages[5].content.startsWith('**Record opened**'));
    for (const tail of ['41', '42', '43', '44', '45', '46']) await join(`1000000000000006${tail}`, `extra${tail}`);
    forum.transport.members = [];
    now += 7 * 3_600_000;
    assert.deepEqual({ ...await reconciler.runDue('check') }, { status: 'failed', code: 'MEMBER_RECORD_RECONCILE_SUSPICIOUS' });
    assert.equal((await rows('member_record_events')).filter(event => event.kind === 'left').length, 1, 'no leave recorded from a list that drops many');
  });

  await scenario('MRS-11 deleted and edited messages are entered in the author\'s post, with who deleted them from the audit log', async () => {
    await join(USER, 'vexthecat'); await drain();
    const post = forum.posts()[0][1], ledgerBefore = post.messages[1].content, changelogBefore = forum.changelog().length;
    await store.recordChannels(await forum.transport.getRecordChannelMap());
    const say = (channel, tail, content) => { now += 1_000; return send('MESSAGE_CREATE', { guild_id: GUILD, channel_id: channel, id: `1000000000000008${tail}`,
      content, author: { id: USER, username: 'vexthecat' }, attachments: tail === '02' ? [{ id: '100000000000000899', filename: 'proof.png', content_type: 'image/png', size: 5 }] : [],
      timestamp: new Date(now).toISOString() }); };
    await say(GENERAL, '01', 'first words'); await say(GENERAL, '02', 'second @everyone'); await say(GENERAL, '03', 'third'); await say(GENERAL, '04', 'fourth');
    await say(TICKET, '05', 'ticket text');
    assert.equal((await rows('member_messages')).length, 4, 'nothing kept from the ticket channel');
    // An edit, with the text before and after.
    now += 1_000; await send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: GENERAL, id: '100000000000000801', content: 'first words, edited',
      author: { id: USER, username: 'vexthecat' }, attachments: [], timestamp: new Date(now - 5_000).toISOString(), edited_timestamp: new Date(now).toISOString() });
    // A link preview resends the message unchanged: no entry.
    await send('MESSAGE_UPDATE', { guild_id: GUILD, channel_id: GENERAL, id: '100000000000000801', content: 'first words, edited',
      author: { id: USER, username: 'vexthecat' }, attachments: [], timestamp: new Date(now - 5_000).toISOString(), edited_timestamp: new Date(now).toISOString() });
    await drain();
    const edited = post.messages.at(-1).content;
    assert.ok(edited.startsWith('**Message edited** · ') && edited.includes('> first words\n**After**\n> first words, edited'), edited);
    // The author deletes one: entered after a short wait, as most likely theirs.
    now += 1_000; await send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: GENERAL, id: '100000000000000802' });
    assert.deepEqual((await drain()).map(result => result.status), ['deferred'], 'waits for the audit log');
    now += 20_000; await due(); await drain();
    const own = post.messages.at(-1).content;
    assert.ok(own.startsWith('**Message deleted** · ') && own.includes('most likely by the author') && own.includes('> second \\@everyone') && own.includes('attachments: proof.png'), own);
    // A moderator deletes another: the audit log names them.
    forum.transport.audit = [{ bulk: false, byUserId: STAFF, targetId: USER, channelId: GENERAL, count: 1, createdAtMs: now + 1_000 }];
    now += 1_000; await send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: GENERAL, id: '100000000000000801' });
    now += 20_000; await due(); await drain();
    assert.ok(post.messages.at(-1).content.includes(`deleted by <@${STAFF}> (audit log)`) && post.messages.at(-1).content.includes('> first words, edited'));
    // Text older than 30 days is cleared; a purge is one entry; a ticket deletion is never entered.
    await admin.query("UPDATE sophie_core.member_messages SET content = NULL, content_cleared = true WHERE message_id IN ('100000000000000803', '100000000000000804')");
    forum.transport.audit = [{ bulk: true, byUserId: STAFF, targetId: GENERAL, channelId: GENERAL, count: 2, createdAtMs: now + 1_000 }];
    now += 1_000; await send('MESSAGE_DELETE_BULK', { guild_id: GUILD, channel_id: GENERAL, ids: ['100000000000000803', '100000000000000804'] });
    await send('MESSAGE_DELETE', { guild_id: GUILD, channel_id: TICKET, id: '100000000000000805' });
    now += 20_000; await due(); await drain();
    const purge = post.messages.at(-1).content;
    assert.ok(purge.startsWith('**2 messages deleted** · ') && purge.includes(`deleted by <@${STAFF}>`) && purge.split('Text no longer kept').length === 3, purge);
    assert.equal((await rows('member_record_events')).filter(event => event.kind === 'message.deleted').length, 3);
    assert.equal(post.messages[1].content, ledgerBefore, 'deletions and edits stay out of the ledger');
    assert.equal(forum.changelog().length, changelogBefore, 'and out of the changelog');
    // The synthetic IDs date from 2015: past 30 days and past a year, so text and authors are cleared, and rows stay.
    assert.deepEqual(await store.expireMessages(), { textCleared: 2, authorsCleared: 4 });
    assert.ok((await rows('member_messages')).every(row => row.content === null && row.author_id === null && row.channel_id === null));
  });

  await scenario('MRS-12 role changes are entries naming the roles and who changed them; the header lists the roles', async () => {
    await join(USER, 'vexthecat', [CREW]); await drain();
    const post = forum.posts()[0][1];
    assert.ok(post.messages[0].content.includes('**Roles:** Crew'));
    forum.transport.roleAudit = [{ byUserId: OTHER, targetId: USER, added: [STAFF, EVENT_HOST], removed: [], createdAtMs: now + 1_000 }];
    now += 1_000; await update(USER, 'vexthecat', [CREW, STAFF, EVENT_HOST]);
    assert.deepEqual((await drain()).map(result => result.status), ['deferred'], 'waits for the audit log');
    now += 20_000; await due(); await drain();
    assert.equal(post.messages.at(-1).content.split(' · ')[0], '**Roles changed**');
    assert.ok(post.messages.at(-1).content.endsWith(`by <@${OTHER}> (audit log)\nAdded: Staff, Event Host`), post.messages.at(-1).content);
    assert.ok(post.messages[0].content.includes('**Roles:** Staff, Event Host, Crew'), 'highest first');
    assert.ok(post.messages[1].content.includes('Roles changed') && forum.changelog().at(-1).includes('**Roles changed**'));
    // No audit entry: said so. Whitelist and Muzzled keep their own entries, not a second one here.
    now += 1_000; await update(USER, 'vexthecat', [CREW, STAFF, WHITELIST]);
    now += 20_000; await due(); await drain();
    const [removedEntry, whitelistEntry] = post.messages.slice(-2).map(message => message.content);
    assert.ok(removedEntry.includes('who changed them is not in the audit log\nRemoved: Event Host') || whitelistEntry.includes('who changed them is not in the audit log\nRemoved: Event Host'));
    assert.equal(post.messages.filter(message => message.content.startsWith('**Roles changed**')).length, 2);
    assert.ok(post.messages.some(message => message.content.startsWith('**Whitelist given**')));
    // A record from before role IDs were kept takes them silently.
    await admin.query("UPDATE sophie_core.member_records SET profile = profile - 'roleIds'");
    now += 1_000; await update(USER, 'vexthecat', [CREW, STAFF, WHITELIST, EVENT_HOST]);
    assert.equal((await rows('member_record_events')).filter(event => event.kind === 'roles.changed').length, 2, 'no entry for the first role IDs');
    assert.deepEqual((await rows('member_records'))[0].profile.roleIds, [STAFF, CREW, WHITELIST, EVENT_HOST].sort());
  });
}
