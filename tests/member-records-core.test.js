import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationFacts, changelogLine, entryLabel, entryText, observeMember } from '../modules/member-records/index.js';
import { createDiscordTransport, memberRecordWriteAllowed } from '../apps/core/discord/transport.js';
import { createMemberRecordIngress } from '../apps/core/discord/member-record-ingress.js';
import { planMemberRecordBackfill } from '../apps/core/operator/member-record-backfill.js';
import { productionConfiguration } from '../apps/core/runtime/production-configuration.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { createAiObservations } from '../apps/core/discord/ai-observations.js';
import { createGuildState } from '../apps/core/discord/guild-state.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';

// Synthetic data only; every ID is made up.
const ids = n => `1${String(n).padStart(17, '0')}`;
const GUILD = ids(1), FORUM = ids(60), CHANGELOG = ids(61), POST = ids(62), MEMBER = ids(12);
const TAG_IDS = { 'In server': ids(80), Left: ids(81), Whitelisted: ids(82), Muzzled: ids(83), Staff: ids(84), Watch: ids(85) };
const AT = Date.UTC(2026, 9, 30, 15, 0);
const NO_ROLES = { crew: false, whitelist: false, muzzled: false, staff: false, leadOps: false };
const profile = (change = {}) => ({ username: 'vexthecat', displayName: 'Vex', present: true, roles: { ...NO_ROLES, crew: true }, joinedAtMs: AT - 1e9,
  joinCount: 1, lastLeftAtMs: null, earlierNames: [], note: null, ...change });

test('MR-16 a member change becomes the next profile and its entries', () => {
  const same = observeMember(profile(), { present: true, roles: { crew: true }, username: 'vexthecat', globalName: 'Vex', nick: null }, AT);
  assert.deepEqual(same.events, []); assert.equal(same.changed, false, 'an unrelated update changes nothing');
  const roles = observeMember(profile(), { present: true, roles: { crew: true, whitelist: true, muzzled: true }, username: 'vexthecat', globalName: 'Vex' }, AT);
  assert.deepEqual(roles.events.map(event => event.kind), ['whitelist.granted', 'muzzled']);
  assert.equal(roles.events[0].bySophie, false);
  assert.deepEqual(observeMember(profile(), { present: true, roles: { crew: true, whitelist: true }, username: 'vexthecat', globalName: 'Vex' }, AT,
    { whitelistBySophie: true }).events, [], 'Sophie\'s own grant is entered by its confirmation');
  const lost = observeMember(profile({ roles: { ...NO_ROLES, whitelist: true, muzzled: true } }), { present: true, roles: {}, username: 'vexthecat', globalName: 'Vex' }, AT);
  assert.deepEqual(lost.events.map(event => event.kind), ['whitelist.lost', 'unmuzzled']);
  const left = observeMember(profile({ roles: { ...NO_ROLES, whitelist: true } }), { present: false, roles: {} }, AT);
  assert.deepEqual(left.events, [{ kind: 'left', hadWhitelist: true }]);
  assert.equal(left.profile.present, false); assert.equal(left.profile.lastLeftAtMs, AT); assert.deepEqual(left.profile.roles, NO_ROLES);
  const back = observeMember(left.profile, { present: true, roles: { crew: true }, username: 'vexthecat', globalName: 'Vex', joinedAtMs: AT + 5 }, AT + 10);
  assert.deepEqual(back.events, [{ kind: 'joined', joinCount: 2 }]); assert.equal(back.profile.joinedAtMs, AT + 5);
  const unknown = observeMember({ ...left.profile, joinCount: null }, { present: true, roles: {}, username: 'vexthecat', globalName: 'Vex' }, AT);
  assert.deepEqual(unknown.events, [{ kind: 'joined', joinCount: null }], 'joins from before the record stay uncounted');
  const renamed = observeMember(profile(), { present: true, roles: { crew: true }, username: 'vexy', globalName: 'Vex', nick: 'Captain Vex' }, AT);
  assert.deepEqual(renamed.events, [{ kind: 'name.changed', from: 'Vex (@vexthecat)', to: 'Captain Vex (@vexy)' }]);
  assert.deepEqual(renamed.profile.earlierNames, ['vexthecat', 'Vex']);
  assert.equal(renamed.profile.username, 'vexy'); assert.equal(renamed.profile.displayName, 'Captain Vex');
});

test('MR-17 entries, rejoins and changelog lines read plainly and link to the entry', () => {
  assert.equal(entryText({ kind: 'joined', atMs: AT, joinCount: null }), '**Joined** · 30 Oct 2026, 15:00 UTC · rejoined (earlier joins not recorded)');
  assert.equal(entryLabel({ kind: 'joined', joinCount: null }), 'Joined · rejoined (earlier joins not recorded)');
  assert.equal(changelogLine({ kind: 'left', atMs: AT, hadWhitelist: true }, { guildId: GUILD, userId: MEMBER, username: 'vex_the*cat', threadId: POST, messageId: ids(63) }),
    `\`30 Oct 2026, 15:00 UTC\` **Left or removed** · <@${MEMBER}> (vex\\_the\\*cat) · [entry](https://discord.com/channels/${GUILD}/${POST}/${ids(63)})`);
  assert.throws(() => changelogLine({ kind: 'left', atMs: AT }, { guildId: GUILD, userId: 'everyone', username: null, threadId: POST, messageId: ids(63) }));
});

test('MR-18 application facts read the current form and older combined forms, never the age check', () => {
  const facts = applicationFacts([{ label: 'Do you agree to an age check?', value: ['Yes'] }, { label: 'What is your date of birth? Month and year only', value: '04/1998' },
    { label: 'What is your BYOND ckey and/or SS14 username?', value: 'BYOND: Vex_Cat, SS14: VexCat' }], AT);
  assert.deepEqual([facts.birth.status, facts.birth.month, facts.birth.year, facts.games.ckey, facts.games.ss14], ['month', 4, 1998, 'vexcat', 'VexCat']);
  const older = applicationFacts([{ label: 'Your BYOND ckey and date of birth', value: 'vexcat 3/2001' }], AT);
  assert.deepEqual([older.birth.year, older.birth.month, older.games.ckey], [2001, 3, 'vexcat']);
});

test('MR-19 production may open and tidy record posts in the records forum only, quietly', async () => {
  assert.equal(memberRecordWriteAllowed('POST', `/channels/${FORUM}/threads`, {}, FORUM), true);
  assert.equal(memberRecordWriteAllowed('POST', `/channels/${ids(64)}/threads`, {}, FORUM), false, 'another forum');
  assert.equal(memberRecordWriteAllowed('PATCH', `/channels/${POST}`, { archived: true }, FORUM), true);
  for (const body of [{ permission_overwrites: [] }, { archived: true, parent_id: ids(9) }, { topic: 'x' }, {}, null, []])
    assert.equal(memberRecordWriteAllowed('PATCH', `/channels/${POST}`, body, FORUM), false, JSON.stringify(body));
  assert.equal(memberRecordWriteAllowed('PATCH', `/channels/${POST}`, { archived: true }, null), false, 'no forum, no allowance');
  const calls = [];
  const transport = (recordForumId = FORUM) => createDiscordTransport({ guildId: GUILD, token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true,
    scope: 'activity-ai', recordForumId, fetch: async (url, init) => {
      calls.push([init.method, new URL(url).pathname + new URL(url).search, init.body ? JSON.parse(init.body) : null]);
      if (new URL(url).pathname.endsWith('/threads')) return new Response(JSON.stringify({ id: POST }), { status: 201, headers: { 'content-type': 'application/json' } });
      if (new URL(url).pathname.endsWith('/requests')) return Response.json({ guild_join_requests: [{ id: ids(70), user_id: MEMBER, application_status: 'APPROVED',
        reviewed_at: '2026-10-30T13:02:00.000Z', actioned_by_user: { id: ids(71), username: 'someone' }, interview_channel_id: ids(72), user: { id: MEMBER, email: 'x@example.test' },
        form_responses: [{ field_type: 'MULTIPLE_CHOICE', label: 'Age check?', response: 0, choices: ['Yes', 'No'] }] }] });
      return Response.json({ id: ids(65) });
    } });
  const quiet = { parse: [], users: [], roles: [], replied_user: false };
  const body = { name: `vex · ${MEMBER}`, auto_archive_duration: 1440, applied_tags: [TAG_IDS['In server']], message: { content: `<@${MEMBER}>`, allowed_mentions: quiet, flags: 4 } };
  assert.deepEqual(await transport().createMemberRecordThread(body), { id: POST });
  for (const bad of [{ ...body, message: { ...body.message, allowed_mentions: { ...quiet, users: [MEMBER] } } }, { ...body, message: { ...body.message, content: '@everyone' } },
    { ...body, permission_overwrites: [] }, { ...body, name: 'x'.repeat(101) }, { ...body, message: { ...body.message, flags: 0 } }])
    await assert.rejects(transport().createMemberRecordThread(bad), /INVALID_DISCORD_PAYLOAD/);
  await assert.rejects(transport(null).createMemberRecordThread(body), /DISCORD_SCOPE_REFUSED/);
  await assert.rejects(transport().editMemberRecordThread(POST, { archived: true, locked: true }), /INVALID_DISCORD_PAYLOAD/);
  await assert.rejects(transport().editMemberRecordThread(FORUM, { archived: true }), /DISCORD_SCOPE_REFUSED/, 'never the forum itself');
  await transport().createMemberRecordMessage(POST, 'a'.repeat(24), 'Ledger');
  assert.deepEqual(calls.at(-1), ['POST', `/api/v10/channels/${POST}/messages`, { content: 'Ledger', allowed_mentions: quiet, flags: 4, nonce: 'a'.repeat(24), enforce_nonce: true }]);
  await assert.rejects(transport().createMemberRecordMessage(POST, 'a'.repeat(24), `<@&${ids(5)}>`), /INVALID_DISCORD_PAYLOAD/);
  // A role write or channel change stays refused in production even with the forum configured.
  await assert.rejects(transport().changeMemberRole(MEMBER, ids(6), false), /DISCORD_SCOPE_REFUSED/);
  const [request] = await transport().getApprovedJoinRequests();
  assert.deepEqual(request, { id: ids(70), userId: MEMBER, status: 'APPROVED', reviewedAtMs: Date.UTC(2026, 9, 30, 13, 2), approvedBy: ids(71),
    formResponses: [{ field_type: 'MULTIPLE_CHOICE', label: 'Age check?', response: 0, choices: ['Yes', 'No'] }] });
  assert.ok(!JSON.stringify(request).includes(ids(72)) && !JSON.stringify(request).includes('example.test'), 'no interview, no other fields');
  assert.match(calls.at(-1)[1], /\/requests\?status=APPROVED&limit=50$/);
});

test('MR-20 the ingress keeps only who, roles, names and the discussion fields', () => {
  const ingress = createMemberRecordIngress({ guildId: GUILD });
  const member = ingress.prepare({ t: 'GUILD_MEMBER_ADD', d: { guild_id: GUILD, user: { id: MEMBER, username: 'vex', global_name: 'Vex', email: 'x@example.test', avatar: 'a' },
    nick: null, roles: [ids(4), 'junk'], joined_at: '2026-10-30T15:00:00.000Z', premium_since: null } });
  assert.deepEqual({ ...member }, { kind: 'member', type: 'GUILD_MEMBER_ADD', userId: MEMBER, bot: false, present: true, roleIds: [ids(4)],
    username: 'vex', globalName: 'Vex', nick: null, joinedAtMs: AT });
  assert.ok(Object.isFrozen(member));
  assert.equal(ingress.prepare({ t: 'GUILD_MEMBER_ADD', d: { guild_id: ids(2), user: { id: MEMBER } } }), null, 'another server');
  const message = ingress.prepare({ t: 'MESSAGE_CREATE', d: { guild_id: GUILD, channel_id: POST, id: ids(66), content: 'Noted.', author: { id: ids(7), username: 'staffer' },
    attachments: [{ id: ids(67), filename: 'a.png', content_type: 'image/png', size: 10, url: 'https://cdn.example.test/a.png' }], timestamp: '2026-10-30T15:00:00.000Z', embeds: [{}] } });
  assert.deepEqual(message.attachments, [{ filename: 'a.png', contentType: 'image/png', size: 10 }]);
  assert.equal(message.content, 'Noted.'); assert.equal(message.authorName, 'staffer');
  assert.equal(ingress.prepare({ t: 'MESSAGE_UPDATE', d: { guild_id: GUILD, channel_id: POST, id: ids(66), embeds: [] } }), null, 'an embed-only edit');
  assert.deepEqual(ingress.prepare({ t: 'MESSAGE_DELETE_BULK', d: { guild_id: GUILD, channel_id: POST, ids: [ids(66), ids(68)] } }).messageIds, [ids(66), ids(68)]);
  assert.equal(ingress.prepare({ t: 'TYPING_START', d: { guild_id: GUILD } }), null);
});

const productionInput = { guildId: GUILD, applicationId: ids(2), publicKeyHex: 'a'.repeat(64), botUserId: ids(3),
  roles: { crew: ids(4), muzzled: ids(5), whitelist: ids(6), staff: ids(7), leadOps: ids(8) }, protectedCategoryId: ids(9),
  dashboardOrigin: 'https://sophie.example.test', activityOrigin: 'https://onboarding.example.test', interactionPort: 38121, dashboardPort: 38122, activityPort: 38125 };

test('MR-21 the production configuration carries the records forum, validated', () => {
  assert.equal(Object.hasOwn(productionConfiguration(productionInput), 'memberRecords'), false, 'off unless configured');
  const memberRecords = { forumId: FORUM, changelogThreadId: CHANGELOG, tagIds: TAG_IDS };
  const configured = productionConfiguration({ ...productionInput, memberRecords });
  assert.deepEqual(configured.memberRecords, memberRecords); validateStagingRuntime(configured);
  for (const bad of [{ ...memberRecords, forumId: ids(9) }, { ...memberRecords, changelogThreadId: FORUM }, { ...memberRecords, tagIds: { ...TAG_IDS, Watch: undefined } },
    { forumId: FORUM, changelogThreadId: CHANGELOG }, { ...memberRecords, extra: true }])
    assert.throws(() => validateStagingRuntime({ ...configured, memberRecords: bad }), JSON.stringify(bad).slice(0, 80));
  assert.throws(() => validateStagingRuntime({ ...configured, aiChannelExceptions: [FORUM] }), 'the forum is never an AI channel');
});

test('MR-22 the backfill adopts the Staff test-run posts and opens everyone else behind live work', () => {
  const mapping = { guildId: GUILD, botUserId: ids(3), crew: ids(4), muzzled: ids(5), whitelist: ids(6), staff: ids(7), leadOps: ids(8) };
  const members = [
    { userId: ids(20), bot: false, username: 'staffer', globalName: null, nick: null, roleIds: [ids(7)], joinedAtMs: AT - 9e9 },
    { userId: ids(21), bot: false, username: 'member', globalName: 'Member', nick: null, roleIds: [ids(4), ids(6)], joinedAtMs: AT - 8e9 },
    { userId: ids(22), bot: true, username: 'otherbot', globalName: null, nick: null, roleIds: [], joinedAtMs: AT },
    { userId: ids(3), bot: true, username: 'sophie', globalName: null, nick: null, roleIds: [], joinedAtMs: AT },
    { userId: ids(23), bot: false, username: 'known', globalName: null, nick: null, roleIds: [], joinedAtMs: AT } ];
  const approved = new Map([[ids(21), { id: ids(70), userId: ids(21), status: 'APPROVED', reviewedAtMs: AT - 8e9 - 1, approvedBy: ids(8),
    formResponses: [{ field_type: 'PARAGRAPH', label: 'How did you find us?', response: 'A friend.', choices: [] }] }]]);
  const staffRun = { members: { [ids(20)]: { threadId: ids(40), createdAt: '2026-10-30T13:33:12.463Z', ledgerLinked: true,
    messages: { header: ids(40), ledger: ids(41), application: ids(42), games: ids(43), spare: ids(44), opened: ids(45) } } } };
  const plan = planMemberRecordBackfill({ members, approved, recorded: new Set([ids(23)]), staffRun, mapping, now: AT });
  assert.deepEqual(plan.map(item => item.userId), [ids(20), ids(21)], 'bots and recorded members skipped');
  const [staff, member] = plan;
  assert.deepEqual(staff.thread, { threadId: ids(40), messages: { header: ids(40), ledger: ids(41), application: ids(42), games: ids(43), spare: ids(44) } });
  assert.deepEqual(staff.events, [{ eventId: `opened.${ids(20)}`, kind: 'record.opened', atMs: Date.parse('2026-10-30T13:33:12.463Z'), detail: { joinedAtMs: AT - 9e9 }, messageId: ids(45) }]);
  assert.deepEqual(staff.application, { status: 'none' }); assert.equal(staff.profile.roles.staff, true);
  assert.equal(member.thread, null); assert.equal(member.background, true); assert.equal(member.profile.joinCount, null);
  assert.deepEqual(member.application, { status: 'found', requestId: ids(70), approvedAtMs: AT - 8e9 - 1, approvedBy: ids(8), answers: [{ label: 'How did you find us?', value: 'A friend.' }] });
  assert.deepEqual(member.events.map(event => event.kind), ['record.opened', 'application']);
  assert.deepEqual([member.profile.roles.crew, member.profile.roles.whitelist, member.profile.displayName], [true, true, 'Member']);
});

test('MR-23 no AI context can be a record post: the forum is excluded with everything under it', async () => {
  const bits = String(PERMISSIONS.viewChannel | PERMISSIONS.sendMessages | PERMISSIONS.readHistory);
  const guildState = createGuildState({ guildId: '101', botUserId: '505' });
  let sequence = 0; const dispatch = (t, d) => guildState.accept({ op: 0, t, s: ++sequence, d });
  dispatch('READY', {});
  dispatch('GUILD_CREATE', { id: '101', owner_id: '808', roles: [{ id: '101', permissions: bits, position: 0 }],
    channels: [{ id: '202', type: 0, parent_id: '606', permission_overwrites: [] }], members: [{ user: { id: '505', bot: true }, roles: [] }], emojis: [] });
  dispatch('MESSAGE_CREATE', { guild_id: '101', channel_id: '202', id: '303', author: { id: '404', bot: false }, type: 0, member: { roles: [] } });
  let reads = 0;
  const options = { pool: { query: async () => ({ rowCount: 0 }) }, guildState, mapping: { guildId: '101', botUserId: '505', muzzled: '909' },
    transport: { getMember: async () => { reads++; return null; } }, authorityStore: { registerPolicy: async () => {}, observeWithPresence: async () => ({ presenceEpoch: 1, grant: { capabilityEpoch: 1 } }) },
    protectedCategoryId: '707', capabilityPolicy: { version: 1 }, observer: { readAiContinuity: async () => 'live.1' }, clock: () => 1000 };
  const event = { guildId: '101', channelId: '202', userId: '404', messageId: '303' };
  assert.equal(await createAiObservations({ ...options, excludedParentIds: ['606'] }).inspectContext(event), null, 'a channel under the forum');
  assert.equal(await createAiObservations({ ...options, excludedParentIds: ['202'] }).inspectContext(event), null, 'the forum itself');
  assert.equal(reads, 0, 'refused before any Discord read');
  assert.throws(() => createAiObservations({ ...options, excludedParentIds: ['x'] }), /TRUSTED_ADAPTERS_REQUIRED/);
});

test('MR-24 /member watch carries only the member and on or off; Staff and Lead Ops only (case.manage), one change per state', async () => {
  // Owner direction, 30 October 2026: "All staff can use the member watch command."
  const { syntheticInteractions } = await import('./fixtures/interactions.js');
  const { createMemberWatch } = await import('../apps/core/discord/member-watch.js');
  const { activityAiCommandDefinitions } = await import('../apps/core/discord/command-registration.js');
  const domain = await import('./fixtures/domain.js');
  const identities = syntheticInteractions();
  const watchCommand = options => ({ data: { type: 1, name: 'member', options: [{ type: 1, name: 'watch', options }] } });
  const envelope = identities.mint(watchCommand([{ type: 6, name: 'member', value: domain.OTHER }, { type: 5, name: 'on', value: true }]));
  assert.deepEqual([envelope.command, envelope.subjectId, envelope.watch, envelope.targetId === envelope.userId], ['member.watch', domain.OTHER, true, true]);
  for (const options of [[{ type: 6, name: 'member', value: domain.OTHER }], [{ type: 6, name: 'member', value: domain.OTHER }, { type: 3, name: 'on', value: 'yes' }],
    [{ type: 6, name: 'member', value: '@everyone' }, { type: 5, name: 'on', value: true }], [{ type: 5, name: 'on', value: true }, { type: 5, name: 'on', value: false }]])
    assert.throws(() => identities.mint(watchCommand(options)));
  let allowed = false; const calls = [];
  const watch = createMemberWatch({ guildId: domain.GUILD, enabled: async () => true,
    authorization: { resolveActor: async () => ({ userId: envelope.userId }), authorize: async (capability, actor, scope) => {
      assert.equal(capability, 'case.manage'); assert.deepEqual(scope, { guildId: domain.GUILD, type: 'shuttle', openerId: envelope.userId }); return allowed; } },
    store: { setWatch: async input => { calls.push(input); return input.userId === domain.OTHER ? 'recorded' : 'missing'; } } });
  assert.equal(await watch.execute(envelope), 'denied'); assert.equal(calls.length, 0, 'nothing changes for a refused actor');
  allowed = true;
  assert.equal(await watch.execute(envelope), 'member_watch_on');
  assert.deepEqual(calls[0], { userId: domain.OTHER, watch: true, by: envelope.userId, interactionId: envelope.interactionId });
  const off = identities.mint(watchCommand([{ type: 6, name: 'member', value: domain.USER }, { type: 5, name: 'on', value: false }]));
  assert.equal(await watch.execute(off), 'member_watch_missing');
  assert.ok(activityAiCommandDefinitions().some(command => command.name === 'member' && command.options[0].name === 'watch'), 'registered in production');
  assert.equal(entryText({ kind: 'watched', atMs: AT, by: MEMBER }), `**Watch on** by <@${MEMBER}> · 30 Oct 2026, 15:00 UTC`);
  assert.equal(entryLabel({ kind: 'unwatched' }), 'Watch off');
});

test('MR-25 people who have left get a record too: approved applicants and members Sophie saw, opened as Left', async () => {
  const { planDepartedMemberRecords } = await import('../apps/core/operator/member-record-backfill.js');
  const mapping = { guildId: GUILD, botUserId: ids(3) };
  const approved = new Map([[ids(30), { id: ids(70), userId: ids(30), status: 'APPROVED', reviewedAtMs: AT - 5e9, approvedBy: null, formResponses: [] }]]);
  const people = [{ userId: ids(30), source: 'application', user: { username: 'gone', globalName: 'Gone', bot: false } },
    { userId: ids(31), source: 'records', user: null }, { userId: ids(32), source: 'records', user: { username: 'here', globalName: null, bot: false } },
    { userId: ids(33), source: 'records', user: { username: 'abot', globalName: null, bot: true } }, { userId: ids(30), source: 'records', user: null }];
  const plan = planDepartedMemberRecords({ people, current: new Set([ids(32)]), recorded: new Set(), approved, mapping, now: AT });
  assert.deepEqual(plan.map(item => item.userId), [ids(30), ids(31)], 'present members, bots and repeats skipped');
  const [applicant, seen] = plan;
  assert.deepEqual([applicant.profile.present, applicant.profile.joinedAtMs, applicant.profile.displayName, applicant.application.status], [false, null, 'Gone', 'found']);
  assert.deepEqual(applicant.events.map(event => event.kind), ['record.opened', 'application']);
  assert.equal(entryText({ kind: 'record.opened', atMs: AT, ...applicant.events[0].detail }),
    '**Record opened** · 30 Oct 2026, 15:00 UTC · not in the server; known from an approved application. Join and leave dates before this are not recorded.');
  assert.deepEqual([seen.profile.username, seen.application.status, seen.events[0].detail.source], [null, 'none', 'records']);
});

test('MR-26 a leave gives its date and time and at most five message links; a replaced application keeps the earlier one', async () => {
  const { entryParts, RECENT_MESSAGES_SHOWN } = await import('../modules/member-records/index.js');
  const recent = Array.from({ length: 7 }, (_, index) => ({ channelId: ids(50), messageId: ids(90 + index), atMs: AT - index * 1000 }));
  const text = entryText({ kind: 'left', atMs: AT, hadWhitelist: false }, { guildId: GUILD, recent });
  assert.ok(text.startsWith(`**Left or removed** · 30 Oct 2026, 15:00 UTC (<t:${AT / 1000}:f>)`));
  assert.equal(text.split('\n').filter(line => line.startsWith('- ')).length, RECENT_MESSAGES_SHOWN);
  assert.ok(text.includes(`[message](https://discord.com/channels/${GUILD}/${ids(50)}/${ids(90)})`) && text.includes(`<#${ids(50)}>`));
  assert.ok(entryText({ kind: 'left', atMs: AT, noticed: true }).includes('the exact time is not known'));
  assert.equal(entryText({ kind: 'left', atMs: AT }).split('\n').length, 1, 'an entry from before message links has none');
  const parts = entryParts({ kind: 'application.replaced', atMs: AT, approvedAtMs: AT - 1000, approvedBy: ids(8),
    previous: { approvedAtMs: AT - 9e9, approvedBy: null, answers: [{ label: 'What is your date of birth?', value: '04/1998' }] } });
  assert.equal(parts.length, 2); assert.ok(parts[0].startsWith('**Access application replaced** · ') && parts[0].includes(`by <@${ids(8)}>`));
  assert.ok(parts[1].startsWith('**Earlier access application** · approved') && parts[1].includes('04/1998'));
  assert.equal(entryLabel({ kind: 'application.replaced' }), 'Access application replaced');
});
