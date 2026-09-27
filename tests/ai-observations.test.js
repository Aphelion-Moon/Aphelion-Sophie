import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiObservations } from '../apps/core/discord/ai-observations.js';
import { createAiGateway } from '../apps/core/discord/ai-gateway.js';
import { createAiIngress } from '../apps/core/discord/ai-ingress.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';

function fixture() {
  let now = 1000, stamp = 'live.1', excluded = false, reads = 0;
  const bits = String(PERMISSIONS.viewChannel | PERMISSIONS.sendMessages | PERMISSIONS.readHistory | PERMISSIONS.addReactions);
  const members = { '505': { user: { id: '505', bot: true }, roles: [] }, '404': { user: { id: '404', bot: false }, roles: [] } };
  const channel = { id: '202', guild_id: '101', type: 0, parent_id: '606', permission_overwrites: [] };
  const roles = [{ id: '101', permissions: bits, position: 0 }], source = { id: '303', channelId: '202', authorId: '404', type: 0, revision: 'original', bot: false, webhook: false };
  const transport = { getChannel: async () => { reads++; return structuredClone(channel); }, getGuild: async () => ({ id: '101', owner_id: '808' }), getRoles: async () => structuredClone(roles),
    getMember: async id => structuredClone(members[id] ?? null), getAiSourceMetadata: async () => structuredClone(source), getAutomationSource: async () => ({ ...source, reactions: [] }) };
  const observed = [];
  const observations = createAiObservations({ pool: { query: async () => ({ rowCount: excluded ? 1 : 0 }) }, transport,
    authorityStore: { registerPolicy: async () => {}, observeWithPresence: async observation => { observed.push(observation); return { presenceEpoch: 1, grant: { capabilityEpoch: 3 } }; } },
    mapping: { guildId: '101', botUserId: '505', muzzled: '909' }, protectedCategoryId: '707', capabilityPolicy: { version: 1 },
    observer: { readAiContinuity: async () => stamp }, clock: () => now });
  return { observations, transport, members, channel, source, roles, observed, event: { guildId: '101', channelId: '202', userId: '404', messageId: '303' },
    exclude: () => { excluded = true; }, reads: () => reads, time: value => { now = value; }, invalidate: () => { stamp += '.2'; } };
}

test('SAI AT-02 real observation adapter excludes registered cases before Discord message access', async () => {
  const f = fixture(); f.exclude(); assert.equal(await f.observations.inspectContext(f.event), null); assert.equal(f.reads(), 0);
  const moved = fixture(); moved.channel.parent_id = '707'; moved.transport.getAiSourceMetadata = async () => assert.fail('case source must not be fetched');
  assert.equal(await moved.observations.inspectContext(moved.event), null);
});

test('SAI AT-03 observations bind actual permissions, source revision and retained member presence', async () => {
  const f = fixture(), context = await f.observations.inspectContext(f.event), member = await f.observations.inspectMember(f.event);
  assert.equal(context.restricted, false); assert.equal(context.canReply, true); assert.equal(member.presenceEpoch, 1); assert.equal(member.accessEpoch, 3);
  assert.equal(await f.observations.inspectMember(f.event), null);
  f.roles[0].permissions = String(PERMISSIONS.viewChannel | PERMISSIONS.readHistory); f.invalidate();
  assert.equal(await f.observations.inspectContext(f.event), null);
  assert.equal(f.observed[0].roleIds.length, 0);
});

test('SAI AT-03 changed audience invalidates cached metadata and unknown/missing source denies', async () => {
  const f = fixture(), first = await f.observations.inspectContext(f.event);
  f.channel.permission_overwrites = [{ id: '999', type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' }]; f.invalidate();
  const second = await f.observations.inspectContext(f.event); assert.notEqual(second.audienceHash, first.audienceHash);
  f.transport.getAiSourceMetadata = async () => null; assert.equal(await f.observations.inspectContext(f.event), null);
  f.members['404'].communication_disabled_until = new Date(20000).toISOString(); f.invalidate();
  assert.equal(await f.observations.inspectContext(f.event), null);
});

test('SAI AT-05 a private channel with individual bot and member grants remains restricted', async () => {
  const f = fixture();
  f.channel.permission_overwrites = [
    { id: '101', type: 0, allow: '0', deny: String(PERMISSIONS.viewChannel) },
    ...['505','404'].map(id => ({ id, type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' })),
  ];
  const observed = await f.observations.inspectContext(f.event);
  assert.equal(observed.eligible,true); assert.equal(observed.restricted,true);
});

test('SAI AT-07 Gateway handoff is bounded, commit-dependent and detached from slow AI', async () => {
  let release; const held = new Promise(resolve => { release = resolve; }), seen = [], invalidations = [];
  const ingress = createAiIngress({ guildId: '101', botUserId: '505', clock: () => 1000 });
  const turns = { handle: async proof => { seen.push(ingress.inspect(proof)); await held; }, invalidate: filter => invalidations.push(filter), stop: async () => {} };
  const bridge = createAiGateway({ ingress, turns, onFault: () => assert.fail('unexpected fault') });
  const packet = id => ({ t: 'MESSAGE_CREATE', d: { guild_id: '101', id, channel_id: '202', author: { id: '404' }, type: 0 } });
  const rejected = bridge.prepare(packet('300')); bridge.committed(rejected, false);
  const accepted = ['301','302','303','304'].map(id => bridge.prepare(packet(id)));
  assert.equal(bridge.prepare(packet('305')), null); accepted.forEach(proof => bridge.committed(proof, true));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(seen.length, 4);
  bridge.prepare({ t: 'MESSAGE_DELETE', d: { guild_id: '101', channel_id: '202', id: '301' } });
  assert.deepEqual(invalidations.at(-1), { channelId: '202', messageId: '301' });
  release(); await bridge.stop(); assert.equal(bridge.prepare(packet('306')), null);
});
