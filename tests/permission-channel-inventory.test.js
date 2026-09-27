import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionChannelInventory } from '../apps/core/discord/permission-channel-inventory.js';
import { GUILD, STAFF, LEAD, NOW } from './fixtures/domain.js';

function fixture() {
  const state = { now: NOW, calls: [], roles: [{ id: STAFF, position: 2, managed: false, permissions: '16', name: 'SYNTHETIC_ROLE_NAME' }],
    channels: [{ id: '101', type: 0, guild_id: GUILD, parent_id: '102', topic: `sophie:case:v1:${'a'.repeat(48)}`, name: 'SYNTHETIC_CASE_NAME', permission_overwrites: [] },
      { id: '102', type: 4, parent_id: null, topic: 'SYNTHETIC_PRIVATE_TOPIC', permission_overwrites: [] },
      { id: '103', type: 0, parent_id: null, topic: 'SYNTHETIC_OTHER_TOPIC', permission_overwrites: [] }] };
  const request = { binding: { operationId: 'a'.repeat(64), generation: 1, candidateHash: 'b'.repeat(64), controlHash: 'c'.repeat(64) },
    channelIds: ['101'], categoryIds: ['102'], roleIds: [STAFF, LEAD] };
  const adapter = createPermissionChannelInventory({ clock: () => state.now, transport: { guildId: GUILD,
    getRoles: async () => { state.calls.push('roles'); return structuredClone(state.roles); },
    getGuildChannels: async () => { state.calls.push('channels'); return structuredClone(state.channels); } } });
  return { state, request, adapter };
}
test('maintenance inventory projects only selected and marked channel metadata without names or arbitrary topics', async () => {
  const { state, request, adapter } = fixture(), proof = await adapter.read(request), snapshot = adapter.snapshot(proof, request);
  assert.deepEqual(state.calls, ['roles', 'channels']); assert.deepEqual(snapshot.channels.map(row => row.id), ['101', '102']);
  assert.deepEqual(Object.keys(proof), ['sha256']);
  assert.equal(JSON.stringify(snapshot).includes('SYNTHETIC_'), false);
  assert.equal(snapshot.channels[0].marker, `sophie:case:v1:${'a'.repeat(48)}`);
  snapshot.channels[0].id = '999'; assert.equal(adapter.snapshot(proof, request).channels[0].id, '101');
});
test('proofs reject serialization, different maintenance bindings, changed selectors and expiry', async () => {
  const { state, request, adapter } = fixture(), proof = await adapter.read(request);
  await assert.rejects(async () => adapter.snapshot({ ...proof }, request), /PERMISSION_INVENTORY_UNTRUSTED/);
  assert.throws(() => adapter.snapshot(proof, { ...request, binding: { ...request.binding, generation: 2 } }), /PERMISSION_INVENTORY_UNTRUSTED/);
  assert.throws(() => adapter.snapshot(proof, { ...request, channelIds: [] }), /PERMISSION_INVENTORY_UNTRUSTED/);
  state.now += 5001; assert.throws(() => adapter.snapshot(proof, request), /MEMBERSHIP_STALE/);
});
test('caller mutation during I/O cannot change the selectors certified by a proof', async () => {
  const { request, adapter } = fixture(), original = structuredClone(request), pending = adapter.read(request);
  request.channelIds.push('103'); request.binding.generation++;
  const proof = await pending;
  assert.deepEqual(adapter.snapshot(proof, original).channels.map(row => row.id), ['101', '102']);
  assert.throws(() => adapter.snapshot(proof, request), /PERMISSION_INVENTORY_UNTRUSTED/);
});
test('reordered records, role names and equivalent overwrite numbers preserve metadata fingerprints', async () => {
  const { state, request, adapter } = fixture();
  state.channels[0].permission_overwrites = [{ id: GUILD, type: 0, allow: '0', deny: '16' }, { id: STAFF, type: 0, allow: '16', deny: '0' }];
  const before = await adapter.read(request);
  state.channels[0].permission_overwrites.reverse(); state.channels[0].permission_overwrites[0].allow = '00016';
  state.channels.reverse(); state.roles[0].name = 'Changed synthetic name';
  assert.equal((await adapter.read(request)).sha256, before.sha256);
  state.channels.find(row => row.id === '101').permission_overwrites[0].allow = '32';
  assert.notEqual((await adapter.read(request)).sha256, before.sha256);
});
test('duplicate IDs, foreign guilds, invalid overwrites and oversized responses fail closed', async () => {
  for (const change of [s => s.channels.push(s.channels[0]), s => { s.channels[0].guild_id = '999'; },
    s => { s.channels[0].permission_overwrites = [{ id: STAFF, type: 0, allow: '16', deny: '16' }]; },
    s => { s.channels = Array(501).fill(s.channels[0]); }, s => s.roles.push(s.roles[0])]) {
    const { state, request, adapter } = fixture(); change(state); await assert.rejects(adapter.read(request));
  }
});
