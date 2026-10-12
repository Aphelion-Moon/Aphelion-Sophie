import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreAuthorization } from '../apps/core/security/authorization.js';
import { GUILD, OTHER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { MUZZLED } from './fixtures/discord.js';

// Owner decision, 12 October 2026: dashboard views may reuse a role observation for up to 1.5 s within one Gateway
// continuity stamp; actions and any other principal always read Discord afresh.
function fixture() {
  let now = NOW, stamp = 'continuity-1', present = true, reads = 0;
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [], 'member.unmute': [], 'shuttle.publish': [], 'case.registry': [] } };
  const discord = { guildId: GUILD, observeActor: async userId => {
    reads++;
    return { guildId: GUILD, userId, known: true, observedAt: now, present, roleIds: present ? [STAFF] : [], bot: false, timedOut: false,
      administrator: false, guildOwner: false, highestRolePosition: present ? 8 : 0 };
  } };
  const authorityStore = { registerPolicy: async () => {},
    observe: async observation => ({ guildId: GUILD, userId: observation.userId, capabilityEpoch: 1, policyVersion: 1 }) };
  const principals = { resolvePrincipal: async proof => ({ guildId: proof.guildId, userId: proof.userId }) };
  const authorization = createCoreAuthorization({ principals, discord, authorityStore, policy, clock: () => now,
    isAuthorityCurrent: async () => true, readContinuity: async () => stamp });
  return { authorization, reads: () => reads, advance: ms => { now += ms; }, leave: () => { present = false; }, dispatch: () => { stamp += '.next'; },
    view: Object.freeze({ guildId: GUILD, userId: OTHER, view: true }), action: Object.freeze({ guildId: GUILD, userId: OTHER }) };
}
const scope = { guildId: GUILD };

test('DA-VIEW-01 a view reuses the role observation it just made instead of reading Discord twice', async () => {
  const f = fixture();
  const actor = await f.authorization.resolveActor(f.view, { reuse: true });
  assert.equal(await f.authorization.authorize('answers.read', actor, scope), true);
  assert.equal(f.reads(), 1);
  await f.authorization.resolveActor(f.view, { reuse: true }); assert.equal(f.reads(), 1);
  // Routes that do not opt in (case, contact, configuration) resolve afresh even for a GET.
  await f.authorization.resolveActor(f.view); assert.equal(f.reads(), 2);
});

test('DA-VIEW-02 actions always read Discord, and see a removal a reused view would not', async () => {
  const f = fixture();
  const viewer = await f.authorization.resolveActor(f.view, { reuse: true }); f.leave();
  // The accepted trade-off: within 1.5 s and without a Gateway event, a view still sees the previous roles.
  assert.equal(await f.authorization.authorize('answers.read', viewer, scope), true); assert.equal(f.reads(), 1);
  await assert.rejects(f.authorization.resolveActor(f.action), /OPERATION_DENIED/); assert.equal(f.reads(), 2);
});

test('DA-VIEW-04 case and configuration capabilities read Discord afresh even for a view, and absence is never reused', async () => {
  const f = fixture();
  const viewer = await f.authorization.resolveActor(f.view, { reuse: true }); assert.equal(f.reads(), 1);
  await f.authorization.authorize('case.manage', viewer, { guildId: GUILD, type: 'staff-report', openerId: null }); assert.equal(f.reads(), 2);
  await f.authorization.authorize('permissions.publish', viewer, {}); assert.equal(f.reads(), 3);
  f.leave(); f.advance(1_501); await assert.rejects(f.authorization.resolveActor(f.view, { reuse: true }), /OPERATION_DENIED/);
  await assert.rejects(f.authorization.resolveActor(f.view, { reuse: true }), /OPERATION_DENIED/); assert.equal(f.reads(), 5);
});

test('DA-VIEW-03 reuse ends after 1.5 s or on any Gateway dispatch', async () => {
  const f = fixture();
  const viewer = await f.authorization.resolveActor(f.view, { reuse: true });
  f.advance(1_501); assert.equal(await f.authorization.authorize('answers.read', viewer, scope), true); assert.equal(f.reads(), 2);
  f.dispatch(); assert.equal(await f.authorization.authorize('answers.read', viewer, scope), true); assert.equal(f.reads(), 3);
  f.leave(); f.advance(1_501); assert.equal(await f.authorization.authorize('answers.read', viewer, scope), false); assert.equal(f.reads(), 4);
});
