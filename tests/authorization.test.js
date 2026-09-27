import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapabilityPolicy, requireConfiguredCapability, requireModerationTarget } from '../platform/authorization/actor-policy.js';
import { GUILD, OTHER, USER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { MUZZLED } from './fixtures/discord.js';
import { syntheticInteractions } from './fixtures/interactions.js';

const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
  grants: { 'member.mute': [], 'member.unmute': [], 'shuttle.publish': [], 'case.registry': [] } };
const actor = (overrides = {}) => ({ guildId: GUILD, userId: OTHER, known: true, observedAt: NOW, present: true,
  roleIds: [STAFF], bot: false, timedOut: false, administrator: false, guildOwner: false, highestRolePosition: 8, ...overrides });

test('T01/T04 signed interaction bytes authenticate identity without trusting its role array', () => {
  const fixtures = syntheticInteractions();
  const verified = fixtures.mint({ member: { user: { id: OTHER }, roles: [STAFF, LEAD], permissions: '8' } });
  assert.deepEqual(fixtures.verifier.resolvePrincipal(verified), { guildId: GUILD, userId: OTHER });
  assert.equal(Object.hasOwn(verified, 'roles'), false);
  assert.equal(Object.hasOwn(verified, 'permissions'), false);
  assert.throws(() => fixtures.verifier.resolvePrincipal({ ...verified }), /UNTRUSTED_PRINCIPAL/);
  const request = fixtures.signed(fixtures.payload());
  assert.throws(() => fixtures.verifier.verify({ ...request, body: Buffer.concat([request.body, Buffer.from(' ')]) }), /INTERACTION_SIGNATURE_INVALID/);
  assert.throws(() => fixtures.verifier.verify({ ...request, signature: '00'.repeat(64) }), /INTERACTION_SIGNATURE_INVALID/);
});

test('T01 signatures do not override guild, application, installation and command binding', () => {
  const fixtures = syntheticInteractions();
  for (const overrides of [{ application_id: USER }, { guild_id: USER }, { context: 1 },
    { authorizing_integration_owners: { '1': OTHER } }, { type: 5 },
    { data: { type: 1, name: 'shell', options: [] } }, { member: { user: { id: OTHER, bot: true } } }]) {
    assert.throws(() => fixtures.mint(overrides));
  }
  const badOptions = fixtures.payload(); badOptions.data.options[0].type = 3;
  assert.throws(() => fixtures.verifier.verify(fixtures.signed(badOptions)), /INTERACTION_OPTIONS_INVALID/);
});

test('T01 signature timestamps, principal lifetimes and body sizes are bounded', () => {
  let now = NOW;
  const fixtures = syntheticInteractions({ clock: () => now });
  for (const seconds of [-301, 6]) {
    assert.throws(() => fixtures.verifier.verify(fixtures.signed(fixtures.payload(), String(Math.floor((now + seconds * 1_000) / 1_000)))), /INTERACTION_TIMESTAMP_INVALID/);
  }
  const verified = fixtures.mint();
  now += 300_001;
  assert.throws(() => fixtures.verifier.resolvePrincipal(verified), /UNTRUSTED_PRINCIPAL/);
  assert.throws(() => fixtures.verifier.verify({ body: Buffer.alloc(262_145), signature: '', timestamp: '' }), /INTERACTION_BODY_INVALID/);
  assert.deepEqual(fixtures.verifier.verify(fixtures.signed(fixtures.payload({ type: 1 }))), { kind: 'ping' });
});

test('T04 empty capability maps and Administrator fail closed; only selected roles work', () => {
  assert.doesNotThrow(() => validateCapabilityPolicy(policy));
  assert.throws(() => requireConfiguredCapability(policy, 'member.mute', actor({ administrator: true }), NOW), /OPERATION_DENIED/);
  const enabled = { ...policy, grants: { ...policy.grants, 'member.mute': [STAFF] } };
  assert.doesNotThrow(() => requireConfiguredCapability(enabled, 'member.mute', actor(), NOW));
  for (const overrides of [{ roleIds: [LEAD] }, { roleIds: [STAFF, MUZZLED] }, { bot: true }, { timedOut: true }]) {
    assert.throws(() => requireConfiguredCapability(enabled, 'member.mute', actor(overrides), NOW), /OPERATION_DENIED/);
  }
  assert.throws(() => validateCapabilityPolicy({ ...policy, grants: { ...policy.grants, 'member.mute': [GUILD] } }), /INVALID_CAPABILITY_MAP/);
});

test('T04 custom roles grant only their selected capabilities without Staff or lead ops membership', () => {
  const custom = ['701', '702', '703'];
  const configured = { ...policy, grants: { ...policy.grants, 'shuttle.publish': custom, 'answers.publish': ['704'] } };
  for (const id of custom) {
    assert.doesNotThrow(() => requireConfiguredCapability(configured, 'shuttle.publish', actor({ roleIds: [id] }), NOW));
    assert.throws(() => requireConfiguredCapability(configured, 'member.mute', actor({ roleIds: [id] }), NOW), /OPERATION_DENIED/);
    assert.throws(() => requireConfiguredCapability(configured, 'answers.publish', actor({ roleIds: [id] }), NOW), /OPERATION_DENIED/);
  }
  for (const roleIds of [[STAFF], [LEAD], [], ['701', MUZZLED]]) {
    assert.throws(() => requireConfiguredCapability(configured, 'shuttle.publish', actor({ roleIds }), NOW), /OPERATION_DENIED/);
  }
});

test('T04 custom capability grants reject ambiguous, malformed or unbounded role selections', () => {
  for (const roles of [[GUILD], [MUZZLED], ['701', '701'], Array.from({ length: 51 }, (_, i) => String(701 + i)), '701', null]) {
    assert.throws(() => validateCapabilityPolicy({ ...policy, grants: { ...policy.grants, 'shuttle.publish': roles } }), /INVALID_CAPABILITY_MAP/);
  }
  for (const roles of [[701], ['moderator'], [''], [null]]) {
    assert.throws(() => validateCapabilityPolicy({ ...policy, grants: { ...policy.grants, 'shuttle.publish': roles } }), /INVALID_DISCORD_ID/);
  }
  assert.doesNotThrow(() => validateCapabilityPolicy({ ...policy,
    grants: { ...policy.grants, 'shuttle.publish': Array.from({ length: 50 }, (_, i) => String(701 + i)) } }));
});

test('T53 moderation rejects self, peers, owner, administrator and bot targets', () => {
  const target = actor({ userId: USER, roleIds: [], highestRolePosition: 1 });
  assert.doesNotThrow(() => requireModerationTarget(actor(), target, NOW));
  for (const overrides of [{ userId: OTHER }, { highestRolePosition: 8 }, { highestRolePosition: 9 }, { guildOwner: true }, { administrator: true }, { bot: true }]) {
    assert.throws(() => requireModerationTarget(actor(), { ...target, ...overrides }, NOW), /MODERATION_TARGET_DENIED/);
  }
});

test('T04/T45 curated answer publication is optional, closed-key configuration and denied by default', () => {
  assert.throws(() => requireConfiguredCapability(policy, 'answers.publish', actor(), NOW), /OPERATION_DENIED/);
  for (const extras of [{ 'answers.publish': [STAFF] }, { 'answers.publish': [STAFF], 'case.forms.publish': [LEAD] }]) {
    const configured = { ...policy, grants: { ...policy.grants, ...extras } };
    assert.doesNotThrow(() => requireConfiguredCapability(configured, 'answers.publish', actor(), NOW));
    assert.throws(() => requireConfiguredCapability(configured, 'answers.publish', actor({ roleIds: [STAFF, MUZZLED] }), NOW), /OPERATION_DENIED/);
  }
  assert.throws(() => validateCapabilityPolicy({ ...policy, grants: { ...policy.grants, 'answers.read': [STAFF] } }), /INVALID_FIELDS/);
});
