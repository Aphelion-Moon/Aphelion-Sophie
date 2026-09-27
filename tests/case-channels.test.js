import assert from 'node:assert/strict';
import test from 'node:test';
import { caseChannelPayload, requireCaseChannel, sameOverwrites } from '../modules/tickets/channel-policy.js';
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
