import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGatewayChange, validateGatewayUrl } from '../contracts/gateway.js';
import { projectGatewayDispatch } from '../apps/core/discord/gateway-projection.js';
import { createGatewayObserver } from '../apps/core/discord/gateway-observer.js';
import { GUILD, USER, OTHER, NOW } from './fixtures/domain.js';
import { mapping, WHITELIST, simulatedDiscord } from './fixtures/discord.js';
import { simulatedCases, casePlan } from './fixtures/cases.js';
import { gatewayConfiguration, gatewayEvent, readyEvent, guildEvent } from './fixtures/gateway.js';
import { APPLICATION } from './fixtures/interactions.js';

test('Gateway projection retains only relevant metadata and ignores unknown dispatch bodies entirely', () => {
  const raw = gatewayEvent(3, 'GUILD_MEMBER_UPDATE', { guild_id: GUILD, user: { id: USER }, roles: [WHITELIST] });
  Object.defineProperty(raw.d, 'unrelated', { get() { throw new Error('UNRELATED_FIELD_READ'); } });
  assert.deepEqual(projectGatewayDispatch(raw, gatewayConfiguration, NOW), { sequence: 3,
    change: { kind: 'member', userId: USER, present: true, roleIds: [WHITELIST], bot: false, timedOut: false } });
  const ignored = gatewayEvent(4, 'MESSAGE_CREATE');
  Object.defineProperty(ignored, 'd', { get() { throw new Error('IGNORED_BODY_READ'); } });
  assert.deepEqual(projectGatewayDispatch(ignored, gatewayConfiguration, NOW), { sequence: 4, change: { kind: 'ignored' } });
  assert.deepEqual(projectGatewayDispatch(gatewayEvent(5, 'GUILD_MEMBER_REMOVE', { guild_id: OTHER, user: { id: USER } }), gatewayConfiguration, NOW),
    { sequence: 5, change: { kind: 'ignored' } });
  assert.throws(() => validateGatewayChange({ kind: 'ignored', arbitrary: true }), /INVALID_FIELDS/);
});

test('Gateway READY binds identity and destinations; a guild snapshot must contain configured roles', () => {
  projectGatewayDispatch(readyEvent(), gatewayConfiguration, NOW);
  projectGatewayDispatch(guildEvent(), gatewayConfiguration, NOW);
  for (const mutate of [raw => { raw.d.user.id = OTHER; }, raw => { raw.d.application.id = OTHER; }, raw => { raw.d.guilds = []; }]) {
    const raw = readyEvent(); mutate(raw);
    assert.throws(() => projectGatewayDispatch(raw, gatewayConfiguration, NOW), /GATEWAY_IDENTITY_MISMATCH|GATEWAY_GUILD_MISSING/);
  }
  const raw = guildEvent(); raw.d.roles = [];
  assert.throws(() => projectGatewayDispatch(raw, gatewayConfiguration, NOW), /ROLE_CONFIGURATION_INVALID/);
  for (const url of ['https://gateway.discord.gg/', 'wss://discord.gg/', 'wss://gateway.discord.gg.evil.invalid/',
    'wss://user@gateway.discord.gg/', 'wss://gateway.discord.gg/?token=invalid', 'wss://gateway.discord.gg/elsewhere']) {
    assert.throws(() => validateGatewayUrl(url), /INVALID_GATEWAY_URL/);
  }
  validateGatewayUrl('wss://gateway-us-east1-b.discord.gg/');
});

test('REST metadata cannot survive a continuity change during the read or before a role write', async () => {
  let version = 'first';
  const discord = simulatedDiscord({ readContinuity: () => version });
  discord.state.before = call => { if (call.path.endsWith(`/members/${USER}`)) version = 'second'; };
  await assert.rejects(discord.roles.observe(USER), /OBSERVATION_INVALIDATED/);
  discord.state.before = null;
  const { context } = await discord.roles.prepare(USER);
  version = 'third';
  await assert.rejects(discord.roles.change(context, 'add_whitelist'), /OBSERVATION_INVALIDATED/);
  assert.equal(discord.state.calls.filter(call => call.method !== 'GET').length, 0);
  version = null;
  await assert.rejects(discord.roles.observe(USER), /OBSERVATION_UNAVAILABLE/);
  let now = NOW, reads = 0;
  const slow = simulatedDiscord({ clock: () => now, readContinuity: () => {
    if (++reads === 2) now += 5_001;
    return 'unchanged-version';
  } });
  await assert.rejects(slow.roles.observe(USER), /MEMBERSHIP_STALE/);
});

test('case proofs and prepared writes cannot survive a changed continuity version', async () => {
  let version = 'first';
  const discord = simulatedCases({ readContinuity: () => version });
  const context = await discord.channels.prepare(casePlan);
  const proof = await discord.channels.create(context, casePlan);
  const prepared = await discord.channels.prepare(casePlan);
  version = 'second';
  await assert.rejects(discord.channels.verification.candidate(proof, casePlan), /OBSERVATION_INVALIDATED/);
  await assert.rejects(discord.channels.setAudience(prepared, proof, casePlan, false), /OBSERVATION_INVALIDATED/);
  assert.equal(discord.state.calls.filter(call => call.method === 'PATCH').length, 0);
});

function observerFixture(capacity = 2) {
  let now = NOW, current = false, block = null, cursor = 0;
  const calls = [];
  const journal = {
    acquire: async () => ({ lease: {}, resume: null }), pause: async () => { current = false; },
    identify: async () => {}, resume: async () => ({ sessionId: 'synthetic-gateway-session', sequence: cursor }),
    ready: async (_, record) => { cursor = record.sequence; }, renew: async () => {},
    dispatch: async (_, record) => { if (block) await block; calls.push(record); cursor = record.sequence; current = true; },
    readContinuity: async () => current ? `journal.${cursor}` : null,
  };
  const observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: () => now, capacity });
  return { observer, calls, block: promise => { block = promise; }, advance: ms => { now += ms; } };
}

test('observer rejects stale connection callbacks, expires heartbeat health and serializes bounded work', async () => {
  const fixture = observerFixture(); const { observer } = fixture;
  await observer.acquire('worker'); const { connection } = await observer.beginIdentify();
  await observer.accept(connection, readyEvent()); await observer.accept(connection, guildEvent());
  assert.equal(await observer.isCurrent(), false);
  observer.heartbeatAcknowledged(connection, 10_000); assert.equal(await observer.isCurrent(), true);
  let release; fixture.block(new Promise(resolve => { release = resolve; }));
  const first = observer.accept(connection, gatewayEvent(3, 'IGNORED_EVENT'));
  const second = observer.accept(connection, gatewayEvent(4, 'IGNORED_EVENT'));
  assert.equal(await observer.isCurrent(), false);
  release(); await Promise.all([first, second]);
  assert.deepEqual(fixture.calls.map(record => record.sequence), [2, 3, 4]);
  fixture.advance(10_000); assert.equal(await observer.isCurrent(), false);
  const next = await observer.beginResume();
  assert.throws(() => observer.accept(connection, gatewayEvent(5, 'RESUMED')), /GATEWAY_CONNECTION_STALE/);
  await observer.accept(next.connection, gatewayEvent(5, 'RESUMED'));
  observer.heartbeatAcknowledged(next.connection, 10_000); assert.equal(await observer.isCurrent(), true);
});

test('queue overflow halts the observer without exposing raw failures or retaining unlimited work', async () => {
  const { observer, block } = observerFixture(1);
  await observer.acquire('worker'); const { connection } = await observer.beginIdentify();
  await observer.accept(connection, readyEvent()); await observer.accept(connection, guildEvent());
  observer.heartbeatAcknowledged(connection, 10_000);
  let release; block(new Promise(resolve => { release = resolve; }));
  const first = observer.accept(connection, gatewayEvent(3, 'IGNORED_EVENT'));
  const second = observer.accept(connection, gatewayEvent(4, 'IGNORED_EVENT'));
  const result = Promise.allSettled([first, second]);
  release(); const outcomes = await result;
  assert.equal(outcomes[1].status, 'rejected');
  assert.equal(outcomes[1].reason.message, 'GATEWAY_PROCESSING_FAILED');
  assert.equal(await observer.isCurrent(), false);
});
