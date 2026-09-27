import assert from 'node:assert/strict';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createDiscordRoles } from '../../apps/core/discord/roles.js';
import { createDiscordTransport } from '../../apps/core/discord/transport.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { BOT, CREW, MUZZLED, WHITELIST, mapping } from '../../tests/fixtures/discord.js';

const scope = { guildId: GUILD, userId: USER };
/** Synthetic membership metadata only. These checks create no invitations or case audience writes. */
export async function runCaseParticipantAuthoritySuite(cluster, run) {
  const scenario = (name, work) => run(name, async () => work(await onboardingWorkflow(cluster)));
  const epoch = async f => Number((await f.rows('actor_authority')).find(row => row.user_id === USER).presence_epoch);
  async function gateway(f) {
    const journal = createGatewayJournal({ pool: f.pool, mapping, clock: () => f.clock.now });
    const { lease } = await journal.acquire('participant-journal'); await journal.identify(lease);
    const sessionId = 'synthetic-participant-session';
    await journal.ready(lease, { sessionId, resumeUrl: 'wss://gateway.discord.gg/', sequence: 1 });
    let sequence = 1;
    const send = change => journal.dispatch(lease, { sessionId, sequence: ++sequence, change });
    await send({ kind: 'guild', available: true });
    const readContinuity = () => journal.readContinuity(lease), clock = () => f.clock.now;
    const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-participant-token', fetch: f.discord.fetch, clock, enabled: () => true });
    const roles = createDiscordRoles({ transport, mapping, clock, readContinuity });
    const auth = createCoreAuthorization({ principals: f.identities.verifier, discord: roles, policy: f.policy,
      authorityStore: createActorAuthorityStore({ pool: f.pool, clock }), clock, readContinuity,
      isAuthorityCurrent: async () => (await readContinuity()) !== null });
    return { journal, lease, sessionId, send, auth, sequence: () => sequence };
  }

  await scenario('PA01 participant resolution returns only current membership and never creates an invitation or operator', async f => {
    const grant = await f.authorization.resolveCaseParticipant(scope); assert.deepEqual(grant, { ...scope, presenceEpoch: 1 });
    assert.equal(await f.authorization.authorizeCaseParticipant(grant), true);
    assert.equal(await f.authorization.authorize('case.manage', grant, { guildId: GUILD, type: 'staff-contact', openerId: OTHER }), false);
    for (const table of ['case_reservations', 'case_provisions', 'case_intakes', 'outbox']) assert.equal((await f.rows(table)).length, 0);
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });

  await scenario('PA02 ordinary role, Muzzled and Whitelist changes preserve membership bindings while revoking old Staff authority', async f => {
    f.discord.state.members.set(USER, [STAFF]); const actor = await f.actor(), grant = await f.authorization.resolveCaseParticipant(scope);
    for (const roles of [[CREW], [MUZZLED], [CREW, WHITELIST]]) {
      f.discord.state.members.set(USER, roles); assert.equal(await f.authorization.authorizeCaseParticipant(grant), true); assert.equal(await epoch(f), grant.presenceEpoch);
    }
    assert.equal(await f.authorization.authorize('case.manage', actor, { guildId: GUILD, type: 'staff-contact', openerId: OTHER }), false);
  });

  await scenario('PA03 observed departure durably invalidates the old binding and rejoining needs a new one', async f => {
    const first = await f.authorization.resolveCaseParticipant(scope); f.discord.state.members.delete(USER);
    assert.equal(await f.authorization.authorizeCaseParticipant(first), false); const absent = await epoch(f);
    assert.equal(await f.authorization.resolveCaseParticipant(scope), null); assert.equal(await epoch(f), absent);
    f.discord.state.members.set(USER, [CREW]); assert.equal(await f.authorization.authorizeCaseParticipant(first), false);
    const next = await f.authorization.resolveCaseParticipant(scope); assert.ok(next.presenceEpoch > first.presenceEpoch);
    assert.equal(await f.authorization.authorizeCaseParticipant(next), true);
  });

  await scenario('PA04 absent and bot identities cannot become recipients and malformed or foreign bindings fail before lookup', async f => {
    assert.equal(await f.authorization.resolveCaseParticipant({ guildId: GUILD, userId: '100000000000000098' }), null);
    assert.equal(await f.authorization.resolveCaseParticipant({ guildId: GUILD, userId: BOT }), null);
    const before = f.discord.state.calls.length;
    await assert.rejects(f.authorization.resolveCaseParticipant({ ...scope, guildId: OTHER }), /FOREIGN_GUILD/);
    await assert.rejects(f.authorization.authorizeCaseParticipant({ ...scope, presenceEpoch: 1, caseId: 'forged' }));
    await assert.rejects(f.authorization.authorizeCaseParticipant({ ...scope, guildId: OTHER, presenceEpoch: 1 }), /FOREIGN_GUILD/);
    assert.equal(f.discord.state.calls.length, before);
  });

  await scenario('PA05 a Gateway removal invalidates an authority-only identity even before the member journal knew it', async f => {
    const g = await gateway(f), grant = await g.auth.resolveCaseParticipant(scope);
    assert.equal((await f.rows('members')).some(row => row.user_id === USER), false);
    const removed = { kind: 'member', userId: USER, present: false, roleIds: [], bot: false, timedOut: false };
    await g.send(removed); const after = await epoch(f); assert.ok(after > grant.presenceEpoch);
    const duplicate = await g.journal.dispatch(g.lease, { sessionId: g.sessionId, sequence: g.sequence(), change: removed });
    assert.equal(duplicate.duplicate, true); assert.equal(await epoch(f), after);
    await g.send({ ...removed, present: true, roleIds: [CREW] });
    assert.equal(await g.auth.authorizeCaseParticipant(grant), false);
    assert.equal(await g.auth.authorizeCaseParticipant(await g.auth.resolveCaseParticipant(scope)), true);
    const actor = await g.auth.resolveActor(f.verified(f.payload({ member: { user: { id: OTHER } } })));
    assert.equal((await f.rows('members')).some(row => row.user_id === OTHER), false);
    await g.send({ ...removed, userId: OTHER });
    // REST can see a fast return before the add event; the old Staff grant must already be revoked.
    assert.equal(await g.auth.authorize('case.manage', actor, { guildId: GUILD, type: 'staff-contact', openerId: USER }), false);
  });

  await scenario('PA06 Gateway role and authority changes revoke Staff grants without revoking independent participant membership', async f => {
    const g = await gateway(f), grant = await g.auth.resolveCaseParticipant(scope);
    const actor = await g.auth.resolveActor(f.verified(f.payload({ member: { user: { id: OTHER } } })));
    await g.send({ kind: 'role', roleId: CREW, deleted: false }); await g.send({ kind: 'authority' });
    assert.equal(await g.auth.authorizeCaseParticipant(grant), true); assert.equal(await epoch(f), grant.presenceEpoch);
    assert.equal(await g.auth.authorize('case.manage', actor, { guildId: GUILD, type: 'staff-contact', openerId: USER }), false);
  });

  await scenario('PA07 an uninterrupted resume preserves membership but a new Identify or guild gap revokes prior bindings', async f => {
    const g = await gateway(f), grant = await g.auth.resolveCaseParticipant(scope);
    await g.journal.pause(g.lease, 'DISCONNECTED'); await assert.rejects(g.auth.authorizeCaseParticipant(grant), /AUTHORITY_UNCERTAIN/);
    await g.journal.resume(g.lease); await g.send({ kind: 'resumed' }); assert.equal(await g.auth.authorizeCaseParticipant(grant), true);
    await g.send({ kind: 'guild', available: false }); await assert.rejects(g.auth.authorizeCaseParticipant(grant), /AUTHORITY_UNCERTAIN/);
    await g.send({ kind: 'guild', available: true }); assert.equal(await g.auth.authorizeCaseParticipant(grant), false);
    const afterGap = await g.auth.resolveCaseParticipant(scope); await g.journal.pause(g.lease, 'DISCONNECTED'); await g.journal.identify(g.lease);
    await g.journal.ready(g.lease, { sessionId: g.sessionId, resumeUrl: 'wss://gateway.discord.gg/', sequence: 1 });
    await g.send({ kind: 'guild', available: true }); assert.equal(await g.auth.authorizeCaseParticipant(afterGap), false);
  });

  await scenario('PA08 an in-flight membership result is rejected when continuity changes after its observation is recorded', async f => {
    let version = 'synthetic-participant-before'; const authority = createActorAuthorityStore({ pool: f.pool, clock: () => f.clock.now });
    const auth = createCoreAuthorization({ principals: f.identities.verifier, discord: f.discord.roles, policy: f.policy, clock: () => f.clock.now,
      isAuthorityCurrent: () => true, readContinuity: () => version, authorityStore: { ...authority,
        observeWithPresence: async (...args) => { const result = await authority.observeWithPresence(...args); version = 'synthetic-participant-after'; return result; } } });
    await assert.rejects(auth.resolveCaseParticipant(scope), /OBSERVATION_INVALIDATED/);
    assert.equal((await f.rows('case_reservations')).length, 0);
  });

  await scenario('PA09 failed or out-of-order presence observations cannot partially advance authority or erase revocation', async f => {
    const grant = await f.authorization.resolveCaseParticipant(scope), authority = createActorAuthorityStore({ pool: f.pool, clock: () => f.clock.now });
    const original = (await f.rows('actor_authority')).find(row => row.user_id === USER);
    await assert.rejects(authority.observeWithPresence({ ...original.observation, observedAt: original.observation.observedAt - 1 }, f.policy.version), /OBSERVATION_OUT_OF_ORDER/);
    f.discord.state.members.delete(USER); await f.admin.query('REVOKE UPDATE ON sophie_core.actor_authority FROM sophie_test_core');
    try { await assert.rejects(f.authorization.authorizeCaseParticipant(grant), { code: '42501' }); }
    finally { await f.admin.query('GRANT UPDATE ON sophie_core.actor_authority TO sophie_test_core'); }
    assert.deepEqual((await f.rows('actor_authority')).find(row => row.user_id === USER), original);
    assert.equal(await f.authorization.authorizeCaseParticipant(grant), false); assert.ok(await epoch(f) > grant.presenceEpoch);
    await assert.rejects(cluster.knowledgePool.query('SELECT presence_epoch FROM sophie_core.actor_authority'), { code: '42501' });
  });

  await scenario('PA10 presence migration preserves existing Staff grants without inventing case invitations', async f => {
    const actor = await f.actor(OTHER), prior = (await f.rows('actor_authority')).map(({ presence_epoch, ...rest }) => rest);
    await f.admin.query("ALTER TABLE sophie_core.actor_authority DROP COLUMN presence_epoch; DELETE FROM sophie_migrations.applied WHERE id = '026-case-participant-presence.sql'");
    assert.deepEqual(await migrateCore(f.admin), { migrations: 58 });
    const rows = await f.rows('actor_authority'); assert.deepEqual(rows.map(({ presence_epoch, ...rest }) => rest), prior); assert.equal(rows.every(row => Number(row.presence_epoch) === 1), true);
    assert.equal(await f.authorization.authorize('case.manage', actor, { guildId: GUILD, type: 'staff-contact', openerId: USER }), true);
    assert.equal((await f.rows('case_reservations')).length, 0); assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  });
}
