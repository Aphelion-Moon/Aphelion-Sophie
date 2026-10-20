import assert from 'node:assert/strict';
import test from 'node:test';
import { caseCategoryId, caseChannelPayload, requireCaseChannel, sameOverwrites, shuttleChannelName, validateCasePolicy } from '../modules/tickets/channel-policy.js';
import { channelPermissions, PERMISSIONS, permissionBits } from '../platform/authorization/discord-permissions.js';
import { GUILD, USER, OTHER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { BOT, BOT_ROLE, CREW, MUZZLED, roleList } from './fixtures/discord.js';
import { casePlan, casePolicy, CATEGORY, simulatedCases } from './fixtures/cases.js';

function permissions(userId, roleIds, overwrites, roles = roleList()) {
  return channelPermissions({ guildId: GUILD, userId, roleIds,
    roles: roles.map(({ id, permissions }) => ({ id, permissions })), overwrites });
}
const view = (userId, roleIds, rows, roles) => !!(permissions(userId, roleIds, rows, roles) & PERMISSIONS.viewChannel);

test('case audiences distinguish Head Admins, Staff Report, requester and reported subject', () => {
  for (const type of ['admin-help', 'staff-report', 'head-admin-contact']) {
    const rows = caseChannelPayload({ ...casePlan, type }, casePolicy, false).permission_overwrites;
    assert.equal(view(USER, [STAFF], rows), true); // Staff retains access to their own request.
    assert.equal(view(OTHER, [STAFF], rows), type !== 'head-admin-contact');
    assert.equal(view(OTHER, [LEAD], rows), true);
    assert.equal(view(OTHER, [CREW], rows), false);
    assert.equal(view(OTHER, [], rows), false);
  }
});

test('sealed case channels exclude ordinary humans; Discord Administrator and owner bypass remains explicit', () => {
  const rows = caseChannelPayload(casePlan, casePolicy, true).permission_overwrites;
  assert.equal(view(USER, [LEAD, STAFF], rows), false);
  assert.equal(view(BOT, [BOT_ROLE], rows), true);
  const roles = roleList(); roles.find(role => role.id === LEAD).permissions = String(PERMISSIONS.administrator);
  assert.equal(view(OTHER, [LEAD], rows, roles), true);
  assert.equal(channelPermissions({ guildId: GUILD, userId: OTHER, ownerId: OTHER, roleIds: [],
    roles: roleList().map(({ id, permissions }) => ({ id, permissions })), overwrites: rows }), -1n);
});

test('role allow wins combined role denies, member deny wins last, attachment restriction beats base permission', () => {
  const rows = caseChannelPayload(casePlan, casePolicy, false).permission_overwrites;
  rows.push({ id: MUZZLED, type: 0, allow: '0', deny: String(PERMISSIONS.viewChannel) });
  assert.equal(view(OTHER, [STAFF, MUZZLED], rows), true);
  rows.push({ id: OTHER, type: 1, allow: '0', deny: String(PERMISSIONS.viewChannel) });
  assert.equal(view(OTHER, [STAFF, MUZZLED], rows), false);
  const roles = roleList(); roles.find(role => role.id === CREW).permissions = String(PERMISSIONS.attachFiles);
  assert.equal(permissions(USER, [CREW], rows, roles) & PERMISSIONS.attachFiles, 0n);
  const enabled = caseChannelPayload(casePlan, { ...casePolicy, attachmentsAllowed: true }, false).permission_overwrites;
  assert.equal(permissions(USER, [], enabled) & PERMISSIONS.attachFiles, PERMISSIONS.attachFiles);
});

test('case ACL verification rejects extra audiences, foreign parents and permissive unknown fields', () => {
  const payload = caseChannelPayload(casePlan, casePolicy, false);
  const channel = { id: '300000000000000001', guildId: GUILD, type: 0, parentId: CATEGORY,
    marker: payload.topic, overwrites: payload.permission_overwrites };
  requireCaseChannel(channel, casePlan, casePolicy, false);
  assert.equal(sameOverwrites([...channel.overwrites].reverse(), channel.overwrites), true);
  assert.throws(() => requireCaseChannel({ ...channel, parentId: OTHER }, casePlan, casePolicy, false), /CASE_CHANNEL_ACL_MISMATCH/);
  assert.throws(() => requireCaseChannel({ ...channel, overwrites: [...channel.overwrites,
    { id: OTHER, type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' }] }, casePlan, casePolicy, false), /CASE_CHANNEL_ACL_MISMATCH/);
  assert.throws(() => sameOverwrites([...channel.overwrites, channel.overwrites[0]], channel.overwrites), /INVALID_CHANNEL_OVERWRITES/);
  assert.throws(() => caseChannelPayload(casePlan, { ...casePolicy, staff: LEAD }, false), /CASE_CONFIGURATION_INVALID/);
  assert.throws(() => caseChannelPayload({ ...casePlan, openerId: BOT }, casePolicy, false), /CASE_CONFIGURATION_INVALID/);
  assert.throws(() => caseChannelPayload({ ...casePlan, arbitraryAudience: OTHER }, casePolicy, false), /INVALID_FIELDS/);
  assert.throws(() => permissionBits(1024), /INVALID_PERMISSION_BITS/);
});

test('case observations and write contexts are opaque, bound to one plan and short lived', async () => {
  let now = NOW;
  const discord = simulatedCases({ clock: () => now });
  await assert.rejects(discord.channels.create({}, casePlan), /CASE_CONTEXT_UNTRUSTED/);
  const prepared = await discord.channels.prepare(casePlan);
  const proof = await discord.channels.create(prepared, casePlan);
  await discord.channels.verification.channel(proof, casePlan, true);
  await assert.rejects(discord.channels.verification.candidate({ ...proof }, casePlan), /CASE_OBSERVATION_UNTRUSTED/);
  await assert.rejects(discord.channels.verification.candidate(proof, { ...casePlan, id: 'another-case' }), /CASE_OBSERVATION_UNTRUSTED/);
  await assert.rejects(discord.channels.create(prepared, casePlan), /CASE_CONTEXT_UNTRUSTED/);
  now += 5_001;
  await assert.rejects(discord.channels.verification.candidate(proof, casePlan), /MEMBERSHIP_STALE/);
  assert.equal(discord.state.calls.filter(call => call.method === 'POST').length, 1);
});

test('case adapter checks token identity, parent category and bot permission before writes', async () => {
  for (const failure of ['identity', 'category', 'permission', 'parent-permission', 'responder-role']) {
    const discord = simulatedCases();
    if (failure === 'identity') discord.state.before = call => call.path.endsWith('/users/@me') ? new Response(JSON.stringify({ id: OTHER, bot: true })) : null;
    if (failure === 'category') discord.state.channels.get(CATEGORY).type = 0;
    if (failure === 'permission') discord.state.roles.find(role => role.id === BOT_ROLE).permissions = String(PERMISSIONS.manageRoles);
    if (failure === 'parent-permission') discord.state.channels.get(CATEGORY).permission_overwrites = [{ id: BOT, type: 1, allow: '0', deny: String(PERMISSIONS.manageChannels) }];
    if (failure === 'responder-role') discord.state.roles = discord.state.roles.filter(role => role.id !== LEAD);
    await assert.rejects(discord.channels.prepare(casePlan), /DISCORD_AUTHORIZATION_FAILED|CASE_CATEGORY_INVALID|BOT_PERMISSION_MISSING|CASE_CONFIGURATION_INVALID/);
    assert.equal(discord.state.calls.filter(call => call.method !== 'GET').length, 0);
  }
});

const SHUTTLE_CATEGORY = '100000000000000021';
const shuttlePlan = Object.freeze({ ...casePlan, type: 'shuttle' });
function shuttleCases(policy) {
  const discord = simulatedCases({ policy });
  discord.state.channels.set(SHUTTLE_CATEGORY, { id: SHUTTLE_CATEGORY, guild_id: GUILD, type: 4, parent_id: null, topic: null, permission_overwrites: [] });
  discord.state.usernames = new Map([[USER, 'synthetic_member']]);
  return discord;
}
async function created(discord, plan) {
  const proof = await discord.channels.create(await discord.channels.prepare(plan), plan);
  await discord.channels.verification.channel(proof, plan, true);
  return discord.state.channels.get(proof.channelId);
}

test('Shuttle channels are titled after the opener\'s Discord username and use the configured Shuttle category', async () => {
  const policy = { ...casePolicy, shuttleCategoryId: SHUTTLE_CATEGORY };
  const shuttle = await created(shuttleCases(policy), shuttlePlan);
  assert.equal(shuttle.name, "synthetic_member's Shuttle"); assert.equal(shuttle.parent_id, SHUTTLE_CATEGORY);
  const ticket = await created(shuttleCases(policy), casePlan);
  assert.equal(ticket.name, `case-${casePlan.token.slice(0, 12)}`); assert.equal(ticket.parent_id, CATEGORY);
  // Without a separate category, Shuttle channels stay with the other cases.
  assert.equal((await created(shuttleCases(casePolicy), shuttlePlan)).parent_id, CATEGORY);
  // An unknown username falls back to the opaque case name.
  const unnamed = shuttleCases(policy); unnamed.state.usernames.clear();
  assert.equal((await created(unnamed, shuttlePlan)).name, `case-${casePlan.token.slice(0, 12)}`);
  const payload = caseChannelPayload(shuttlePlan, policy, false);
  const channel = { id: '300000000000000001', guildId: GUILD, type: 0, parentId: SHUTTLE_CATEGORY, marker: payload.topic, overwrites: payload.permission_overwrites };
  requireCaseChannel(channel, shuttlePlan, policy, false);
  assert.throws(() => requireCaseChannel({ ...channel, parentId: CATEGORY }, shuttlePlan, policy, false), /CASE_CHANNEL_ACL_MISMATCH/);
});

test('Shuttle category and channel names are bounded', async () => {
  assert.throws(() => validateCasePolicy({ ...casePolicy, shuttleCategoryId: CATEGORY }), /CASE_CONFIGURATION_INVALID/);
  assert.throws(() => validateCasePolicy({ ...casePolicy, shuttleCategoryId: 'not-an-id' }), /INVALID_ID|INVALID/);
  assert.equal(caseCategoryId({ ...casePolicy, shuttleCategoryId: SHUTTLE_CATEGORY }, 'admin-help'), CATEGORY);
  for (const value of [null, '', 'x'.repeat(33), 'line\nbreak', 'zero​width', 42]) assert.equal(shuttleChannelName(value), null);
  assert.equal(shuttleChannelName('a.b_c'), "a.b_c's Shuttle");
  const discord = shuttleCases(casePolicy), body = { type: 0, parent_id: CATEGORY, topic: `sophie:case:v1:${casePlan.token}`, permission_overwrites: [] };
  for (const name of ['general', "two words's Shuttle\n", "x's Shuttle extra", 7]) {
    await assert.rejects(discord.transport.createCaseTextChannel({ ...body, name }), /INVALID_CASE_CHANNEL_REQUEST/);
  }
});

test('a create overtaken by its own channel event is read again, never reported uncertain or created twice', async () => {
  let stamp = 1;
  const discord = simulatedCases({ readContinuity: () => `synthetic-continuity-${stamp}` });
  // As live: this bot's CHANNEL_CREATE advances the authority stamp while the POST response is being certified.
  discord.state.afterWrite = call => { if (call.method === 'POST') stamp++; };
  const proof = await discord.channels.create(await discord.channels.prepare(casePlan), casePlan);
  await discord.channels.verification.channel(proof, casePlan, true);
  assert.equal(discord.state.calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(discord.state.calls.at(-1).method === 'GET', 'the new channel was read afresh');
});

test('independent reads overlap; reads of one bucket and all writes stay in order', async () => {
  const discord = simulatedCases(); let active = 0, peak = 0, memberActive = 0, memberPeak = 0;
  discord.state.before = async call => {
    const member = /\/members\//u.test(call.path);
    active++; peak = Math.max(peak, active); if (member) { memberActive++; memberPeak = Math.max(memberPeak, memberActive); }
    await new Promise(resolve => setTimeout(resolve, 5)); active--; if (member) memberActive--; return null;
  };
  await discord.roles.prepare(USER);
  assert.ok(peak >= 2, 'roles and a member read overlapped'); assert.equal(memberPeak, 1, 'member reads share a bucket and stay serial');
});
