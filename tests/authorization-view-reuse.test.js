import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreAuthorization } from '../apps/core/security/authorization.js';
import { GUILD, OTHER, STAFF, LEAD, NOW } from './fixtures/domain.js';
import { MUZZLED } from './fixtures/discord.js';

// Owner decision, 24 October 2026 (replacing that of 12 October): each request observes its actor once, afresh, and its own
// capability checks reuse that observation for up to 1.5 s while the authority stamp is unchanged; any member, role,
// channel or guild change (or a reconnect) moves the stamp and ends it. Presence-bound checks record afresh.
function fixture() {
  let now = NOW, stamp = 'authority-1', present = true, reads = 0;
  const policy = { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: MUZZLED,
    grants: { 'member.mute': [], 'member.unmute': [], 'shuttle.publish': [], 'case.registry': [] } };
  const discord = { guildId: GUILD, observeActor: async userId => {
    reads++;
    return { guildId: GUILD, userId, known: true, observedAt: now, present, roleIds: present ? [STAFF] : [], bot: false, timedOut: false,
      administrator: false, guildOwner: false, highestRolePosition: present ? 8 : 0 };
  } };
  const authorityStore = { registerPolicy: async () => {},
    observe: async observation => ({ guildId: GUILD, userId: observation.userId, capabilityEpoch: 1, policyVersion: 1 }),
    observeWithPresence: async observation => ({ grant: { guildId: GUILD, userId: observation.userId, capabilityEpoch: 1, policyVersion: 1 }, presenceEpoch: 1 }),
    recordedAuthority: async () => ({ capabilityEpoch: 1, policyVersion: 1, latestPolicyVersion: 1 }) };
  const principals = { resolvePrincipal: async proof => ({ guildId: proof.guildId, userId: proof.userId }) };
  const authorization = createCoreAuthorization({ principals, discord, authorityStore, policy, clock: () => now,
    isAuthorityCurrent: async () => true, readContinuity: async () => stamp });
  return { authorization, reads: () => reads, advance: ms => { now += ms; }, leave: () => { present = false; }, change: () => { stamp += '.next'; },
    proof: Object.freeze({ guildId: GUILD, userId: OTHER }) };
}
const self = { guildId: GUILD, userId: OTHER };

test('DA-REUSE-01 one request observes the member once: its actor, then every capability check it makes', async () => {
  const f = fixture();
  const actor = await f.authorization.resolveActor(f.proof);
  assert.equal(await f.authorization.authorize('shuttle.self', actor, self), true);
  assert.equal(await f.authorization.authorize('ai.self', actor, self), true);
  assert.equal(f.reads(), 1);
  // The next request observes its actor afresh, once.
  const next = await f.authorization.resolveActor(f.proof); assert.equal(f.reads(), 2);
  assert.equal(await f.authorization.authorize('shuttle.self', next, self), true); assert.equal(f.reads(), 2);
  // Staff administration, not yet in production, still observes once per check.
  assert.equal(await f.authorization.authorize('permissions.publish', actor, {}), false, 'a denial is still a denial');
  assert.equal(f.reads(), 3);
});

test('DA-REUSE-02 a change to the member (or any role, channel or guild change) ends reuse, so a removal is seen at once', async () => {
  const f = fixture();
  const actor = await f.authorization.resolveActor(f.proof);
  f.leave(); f.change();
  assert.equal(await f.authorization.authorize('shuttle.self', actor, self), false); assert.equal(f.reads(), 2);
  // An absence is never reused: every later check reads again.
  await assert.rejects(f.authorization.resolveActor(f.proof), /OPERATION_DENIED/); assert.equal(f.reads(), 3);
});

test('DA-REUSE-03 reuse ends after 1.5 s', async () => {
  const f = fixture();
  const actor = await f.authorization.resolveActor(f.proof);
  f.advance(1_500); assert.equal(await f.authorization.authorize('shuttle.self', actor, self), true); assert.equal(f.reads(), 1);
  f.advance(1); assert.equal(await f.authorization.authorize('shuttle.self', actor, self), true); assert.equal(f.reads(), 2);
});

test('DA-REUSE-04 presence-bound checks (case reads, invitations, AI consent) record afresh', async () => {
  const f = fixture();
  const actor = await f.authorization.resolveActor(f.proof); assert.equal(f.reads(), 1);
  await f.authorization.aiMemberPresence(actor); assert.equal(f.reads(), 2);
  await f.authorization.resolveCaseParticipant(self); assert.equal(f.reads(), 3);
});
