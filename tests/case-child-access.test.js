import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseChildAccess } from '../apps/core/discord/case-child-access.js';
import { simulatedCases, casePlan, casePolicy } from './fixtures/cases.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';
import { BOT, BOT_ROLE } from './fixtures/discord.js';
import { GUILD, USER, NOW } from './fixtures/domain.js';

function fixture(type = 12) {
  const state = { now: NOW, stamp: 'synthetic-child-continuity-1' };
  const discord = simulatedCases({ clock: () => state.now, readContinuity: () => state.stamp });
  const scope = { guildId: GUILD, caseToken: casePlan.token, rootChannelId: '710000000000000001', channelId: '720000000000000001', userId: USER };
  discord.state.channels.set(scope.rootChannelId, { ...caseChannelPayload(casePlan, casePolicy, 'open'), id: scope.rootChannelId, guild_id: GUILD });
  discord.state.channels.set(scope.channelId, { id: scope.channelId, guild_id: GUILD, parent_id: scope.rootChannelId, type });
  for (const user of [USER, BOT]) discord.state.threadMembers.set(`${scope.channelId}:${user}`, { id: scope.channelId, user_id: user });
  const access = createCaseChildAccess({ guildId: GUILD, botUserId: BOT, transport: discord.transport, roles: discord.roles, clock: () => state.now });
  return { ...discord, time: state, scope, access };
}
test('private case threads require explicit current membership independently for the requester and bot', async () => {
  const f = fixture(), proof = await f.access.inspect(f.scope); assert.deepEqual(proof, {}); assert.equal(await f.access.verify(proof, f.scope), true);
  f.state.threadMembers.delete(`${f.scope.channelId}:${USER}`); await assert.rejects(f.access.inspect(f.scope), /DISCORD_RESOURCE_MISSING/);
  f.state.threadMembers.set(`${f.scope.channelId}:${USER}`, { id: f.scope.channelId, user_id: USER });
  f.state.threadMembers.delete(`${f.scope.channelId}:${BOT}`); await assert.rejects(f.access.inspect(f.scope), /DISCORD_RESOURCE_MISSING/);
  assert.equal(f.state.calls.every(call => call.method === 'GET' && !call.path.includes('/messages')), true);
});
test('public threads inherit current parent read permissions but ancestry, marker and guild must still match', async () => {
  const f = fixture(11); f.state.threadMembers.clear(); await f.access.inspect(f.scope);
  const parent = f.state.channels.get(f.scope.rootChannelId), child = f.state.channels.get(f.scope.channelId);
  child.parent_id = '99'; await assert.rejects(f.access.inspect(f.scope), /CASE_CHILD_ACCESS_DENIED/); child.parent_id = f.scope.rootChannelId;
  parent.topic = 'foreign marker'; await assert.rejects(f.access.inspect(f.scope), /CASE_CHILD_ACCESS_DENIED/); parent.topic = `sophie:case:v1:${casePlan.token}`;
  child.guild_id = '99'; await assert.rejects(f.access.inspect(f.scope), /CASE_CHILD_ACCESS_DENIED/); child.guild_id = GUILD;
  const overwrite = parent.permission_overwrites.find(entry => entry.id === USER); overwrite.allow = String(PERMISSIONS.viewChannel);
  await assert.rejects(f.access.inspect(f.scope), /CASE_CHILD_ACCESS_DENIED/);
});
test('Manage Threads can replace thread membership only after parent history access is verified', async () => {
  const f = fixture(); f.state.threadMembers.delete(`${f.scope.channelId}:${BOT}`);
  f.state.roles.find(role => role.id === BOT_ROLE).permissions = String(PERMISSIONS.manageThreads);
  await f.access.inspect(f.scope);
  const parent = f.state.channels.get(f.scope.rootChannelId); parent.permission_overwrites.find(entry => entry.id === BOT).allow = '0';
  await assert.rejects(f.access.inspect(f.scope), /CASE_CHILD_ACCESS_DENIED/);
});
test('child proofs are bound to identity and case and expire or fail when Gateway continuity changes', async () => {
  const f = fixture(11), proof = await f.access.inspect(f.scope);
  await assert.rejects(f.access.verify({}, f.scope), /UNTRUSTED_CASE_CHILD_ACCESS/);
  await assert.rejects(f.access.verify(proof, { ...f.scope, userId: '99' }), /UNTRUSTED_CASE_CHILD_ACCESS/);
  await assert.rejects(f.access.verify(proof, { ...f.scope, caseToken: 'f'.repeat(48) }), /UNTRUSTED_CASE_CHILD_ACCESS/);
  f.time.stamp = 'synthetic-child-continuity-2'; await assert.rejects(f.access.verify(proof, f.scope), /OBSERVATION_INVALIDATED/);
  f.time.stamp = 'synthetic-child-continuity-1'; f.time.now += 5001; await assert.rejects(f.access.verify(proof, f.scope), /MEMBERSHIP_STALE/);
});
test('foreign thread-member responses and an access change during inspection cannot certify a child', async () => {
  const f = fixture(); f.state.threadMembers.set(`${f.scope.channelId}:${USER}`, { id: f.scope.channelId, user_id: BOT });
  await assert.rejects(f.access.inspect(f.scope), /CASE_CHILD_ACCESS_DENIED/);
  f.state.threadMembers.set(`${f.scope.channelId}:${USER}`, { id: f.scope.channelId, user_id: USER });
  f.state.before = call => { if (call.path.endsWith(`/thread-members/${BOT}`)) f.time.stamp = 'synthetic-changed'; };
  await assert.rejects(f.access.inspect(f.scope), /OBSERVATION_INVALIDATED/);
});
