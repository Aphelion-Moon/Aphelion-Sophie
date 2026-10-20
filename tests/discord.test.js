import test from 'node:test';
import assert from 'node:assert/strict';
import { requireOwnedRoleChange, validateRoleMapping } from '../modules/membership/discord-policy.js';
import { createDiscordTransport, createDiscordRateLimits } from '../apps/core/discord/transport.js';
import { createDiscordRoles } from '../apps/core/discord/roles.js';
import { createRoleDispatcher } from '../apps/core/discord/dispatcher.js';
import { GUILD, NOW, USER } from './fixtures/domain.js';
import { BOT, BOT_ROLE, BYOND_ROLE, CREW, WHITELIST, mapping, roleList, simulatedDiscord } from './fixtures/discord.js';

const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
function transportWith(fetch, options = {}) {
  return createDiscordTransport({ guildId: GUILD, token: 'synthetic-test-token-not-a-secret', clock: () => NOW, enabled: () => true, fetch, ...options });
}

test('T21 role mapping rejects everyone, overlapping roles and another bot ownership', () => {
  assert.doesNotThrow(() => validateRoleMapping(mapping));
  assert.throws(() => validateRoleMapping({ ...mapping, crew: GUILD }), /ROLE_OWNERSHIP_CONFLICT/);
  assert.throws(() => validateRoleMapping({ ...mapping, crew: mapping.staff }), /ROLE_OWNERSHIP_CONFLICT/);
  assert.throws(() => validateRoleMapping({ ...mapping, externallyOwnedRoleIds: [WHITELIST] }), /ROLE_OWNERSHIP_CONFLICT/);
});

test('T21 role writes use a single-role endpoint and preserve external roles', async () => {
  const { state, roles } = simulatedDiscord();
  const prepared = await roles.prepare(USER);
  await roles.change(prepared.context, 'add_whitelist');
  assert.deepEqual(new Set(state.members.get(USER)), new Set([CREW, BYOND_ROLE, WHITELIST]));
  assert.deepEqual(state.calls.filter(call => call.method !== 'GET'), [{ method: 'PUT', path: `/api/v10/guilds/${GUILD}/members/${USER}/roles/${WHITELIST}` }]);
  await assert.rejects(roles.change(prepared.context, 'add_whitelist'), /UNTRUSTED_ROLE_CONTEXT/);
});

test('T21 unowned, managed, deleted and equal-position roles cannot be changed', async () => {
  const { roles } = simulatedDiscord();
  const { context } = await roles.prepare(USER);
  assert.throws(() => requireOwnedRoleChange(context, mapping, 'add_staff', NOW), /ROLE_CHANGE_NOT_OWNED/);
  for (const changed of [
    context.roles.map(role => role.id === WHITELIST ? { ...role, managed: true } : role),
    context.roles.filter(role => role.id !== WHITELIST),
    context.roles.map(role => role.id === WHITELIST ? { ...role, position: 10 } : role),
  ]) assert.throws(() => requireOwnedRoleChange({ ...context, roles: changed }, mapping, 'add_whitelist', NOW), /ROLE_CONFIGURATION_INVALID|ROLE_HIERARCHY_BLOCKED/);
});

test('T21 current Manage Roles and role context freshness are required', async () => {
  const { roles } = simulatedDiscord();
  const { context } = await roles.prepare(USER);
  const noPermissions = context.roles.map(role => ({ ...role, permissions: '0' }));
  assert.throws(() => requireOwnedRoleChange({ ...context, roles: noPermissions }, mapping, 'add_whitelist', NOW), /BOT_PERMISSION_MISSING/);
  assert.throws(() => requireOwnedRoleChange({ ...context, botTimedOut: true }, mapping, 'add_whitelist', NOW), /BOT_PERMISSION_MISSING/);
  assert.throws(() => requireOwnedRoleChange(context, mapping, 'add_whitelist', NOW + 5_001), /MEMBERSHIP_STALE/);
  await assert.rejects(roles.change({ ...context }, 'add_whitelist'), /UNTRUSTED_ROLE_CONTEXT/);
});

test('T21 a misconfigured community role cannot grant moderation privileges', async () => {
  const { roles } = simulatedDiscord();
  const { context } = await roles.prepare(USER);
  for (const permissions of ['8', String(1n << 28n), String(1n << 34n)]) {
    const changed = { ...context, roles: context.roles.map(role => role.id === CREW ? { ...role, permissions } : role) };
    assert.throws(() => requireOwnedRoleChange(changed, mapping, 'add_crew', NOW), /ROLE_CONFIGURATION_INVALID/);
    assert.doesNotThrow(() => requireOwnedRoleChange(changed, mapping, 'remove_crew', NOW));
  }
});

test('T21 the authenticated token must belong to the configured bot identity', async () => {
  const { state, roles } = simulatedDiscord();
  state.before = call => call.path === '/api/v10/users/@me' ? response({ id: USER, bot: false }) : null;
  await assert.rejects(roles.prepare(USER), /DISCORD_AUTHORIZATION_FAILED/);
  assert.equal(state.calls.some(call => call.method !== 'GET'), false);
});

test('T20 only an explicit unknown-member response represents departure', async () => {
  const unknown = createDiscordRoles({ transport: transportWith(async () => response({ code: 10007 }, 404)), mapping, clock: () => NOW, readContinuity: () => 'synthetic' });
  assert.equal((await unknown.observe(USER)).present, false);
  for (const [status, code] of [[404, 10004], [403, 50001], [500, 0]]) {
    const unavailable = createDiscordRoles({ transport: transportWith(async () => response({ code }, status)), mapping, clock: () => NOW, readContinuity: () => 'synthetic' });
    await assert.rejects(unavailable.observe(USER), /DISCORD_RESOURCE_MISSING|DISCORD_AUTHORIZATION_FAILED|DISCORD_UNAVAILABLE/);
  }
});

test('T20 malformed identities and missing role arrays fail closed', async () => {
  for (const value of [{ user: { id: BOT }, roles: [] }, { user: { id: USER } }, { user: { id: USER }, roles: ['not-an-id'] }]) {
    const roles = createDiscordRoles({ transport: transportWith(async () => response(value)), mapping, clock: () => NOW, readContinuity: () => 'synthetic' });
    await assert.rejects(roles.observe(USER), /DISCORD_RESPONSE_INVALID|INVALID_DISCORD_ID/);
  }
});

test('T18 rate limits honour fractional retry-after and prevent calls to a cooled route', async () => {
  let now = NOW; let calls = 0; const waits = [];
  // A frozen clock never ends a cooldown, so a short wait is observed but cannot release the call.
  const rest = transportWith(async () => { calls++; return response({ retry_after: 65.5, global: false }, 429, { 'Retry-After': '66' }); },
    { clock: () => now, wait: async ms => { waits.push(ms); } });
  await assert.rejects(rest.getMember(USER), error => error.code === 'RATE_LIMITED' && error.retryAfterMs === 66_000);
  assert.deepEqual(waits, []);
  now += 65_000;
  await assert.rejects(rest.getMember(USER), error => error.code === 'RATE_LIMITED' && error.retryAfterMs === 1_000);
  assert.deepEqual(waits, [1_000]);
  assert.equal(calls, 1);
});

test('T18 global limits stop other routes and reset-after pauses an exhausted successful route', async () => {
  let calls = 0;
  const global = transportWith(async () => { calls++; return response({ retry_after: 2, global: true }, 429); }, { wait: async () => {} });
  await assert.rejects(global.getMember(USER), /RATE_LIMITED/);
  await assert.rejects(global.getRoles(), /RATE_LIMITED/);
  assert.equal(calls, 1);
  const local = transportWith(async () => { calls++; return response(roleList(), 200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '1.5' }); }, { wait: async () => {} });
  await local.getRoles();
  await assert.rejects(local.getRoles(), error => error.retryAfterMs === 1_500);
  assert.equal(calls, 2);
});

test('T18 a short cooldown is waited out instead of failing the caller, and a long one still fails at once', async () => {
  let now = NOW; let calls = 0; const waits = [];
  const rest = transportWith(async () => { calls++; return response(roleList(), 200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '0.4' }); },
    { clock: () => now, wait: async ms => { waits.push(ms); now += ms; } });
  await rest.getRoles();
  await rest.getRoles();
  assert.deepEqual(waits, [400]); assert.equal(calls, 2);
  const long = transportWith(async () => { calls++; return response(roleList(), 200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '5' }); },
    { clock: () => now, wait: async () => assert.fail('NO_LONG_WAIT') });
  await long.getRoles();
  await assert.rejects(long.getRoles(), error => error.code === 'RATE_LIMITED' && error.retryAfterMs === 5_000);
  assert.equal(calls, 3);
});

test('T18 transports sharing one registry respect each other\'s buckets; buckets follow the major channel', async () => {
  const limits = createDiscordRateLimits(); let calls = 0;
  const exhausted = async () => { calls++; return response({ id: '1' }, 200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '30', 'X-RateLimit-Bucket': 'channel-read' }); };
  const first = transportWith(exhausted, { limits, wait: async () => assert.fail('NO_LONG_WAIT') });
  const second = transportWith(exhausted, { limits, wait: async () => assert.fail('NO_LONG_WAIT') });
  await first.getChannel('1001');
  // Another lane on the same token does not spend the bucket again and earn a real 429.
  await assert.rejects(second.getChannel('1001'), /RATE_LIMITED/);
  // A different channel is a different bucket; one busy case channel does not stall the others.
  await second.getChannel('1002');
  assert.equal(calls, 2);
  // Unrelated transports keep their own registries.
  await transportWith(exhausted).getChannel('1001');
  assert.equal(calls, 3);
});

test('T18 concurrent requests on one transport queue behind each other instead of failing busy', async () => {
  let active = 0, peak = 0, calls = 0;
  const rest = transportWith(async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return response(roleList());
  });
  await Promise.all([rest.getRoles(), rest.getRoles(), rest.getRoles()]);
  assert.equal(calls, 3); assert.equal(peak, 1);
});

test('T18 the request count covers sent requests only, for timing diagnostics', async () => {
  let now = NOW;
  const rest = transportWith(async () => response(roleList(), 200, { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset-After': '5' }), { clock: () => now });
  assert.equal(rest.requestCount(), 0);
  await rest.getRoles();
  // A cooled route fails before sending, so it is not counted.
  await assert.rejects(rest.getRoles(), /RATE_LIMITED/);
  assert.equal(rest.requestCount(), 1);
});

test('T18 Shuttle render diagnostics are fixed codes with outcome, time, request count and queue wait only', async () => {
  const { createOnboardingDispatcher } = await import('../apps/core/discord/onboarding-dispatcher.js');
  const traces = []; let count = 3;
  const dispatcher = createOnboardingDispatcher({ enabled: async () => true, trace: code => traces.push(code), requestCount: () => count,
    outbox: { claim: async () => ({ claim: { guildId: GUILD, operationId: 'synthetic-op', owner: 'worker', fence: 1 }, userId: USER, kind: 'shuttle.render', parked: false, waitedMs: 1_234 }),
      requireDeliveryReady: async () => {}, renew: async () => {} },
    store: { inspectOnboardingRender: async () => { count += 2; return { settled: true }; } },
    roles: { guildId: GUILD, observe: async () => ({}) }, messages: { guildId: GUILD } });
  assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'settled' });
  assert.equal(traces.length, 1);
  assert.match(traces[0], /^SHUTTLE_RENDER_SETTLED_\d{1,5}MS_2CALLS_1234WAITMS$/);
  assert.match(traces[0], /^[A-Z][A-Z0-9_]{2,63}$/);
});

test('T18 malformed rate limits halt retries, rather than immediately retrying', async () => {
  for (const body of [{ retry_after: -1 }, { retry_after: 100_000 }, null, []]) {
    const rest = transportWith(async () => response(body, 429));
    await assert.rejects(rest.getRoles(), /DISCORD_RATE_LIMIT_INVALID/);
    await assert.rejects(rest.getMember(USER), /DISCORD_RATE_LIMIT_INVALID/);
  }
});

test('T18 redirect, oversized response and uncertain write errors are bounded and redacted', async () => {
  const redirect = transportWith(async () => new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } }));
  await assert.rejects(redirect.getRoles(), /DISCORD_RESPONSE_INVALID/);
  const oversized = transportWith(async () => response([], 200, { 'Content-Length': '9999999' }));
  await assert.rejects(oversized.getRoles(), /DISCORD_RESPONSE_INVALID/);
  const unknownWrite = transportWith(async () => { throw new Error('untrusted transport body and token'); });
  await assert.rejects(unknownWrite.changeMemberRole(USER, WHITELIST, true), error =>
    error.code === 'DELIVERY_UNCERTAIN' && !JSON.stringify(error).includes('token') && !error.cause);
  await assert.rejects(unknownWrite.getRoles(), /DISCORD_UNAVAILABLE/);
});

test('T01 disabled transport and dispatcher perform no requests or claims', async () => {
  let used = false;
  const rest = transportWith(async () => { used = true; }, { enabled: () => false });
  await assert.rejects(rest.getMember(USER), /DISCORD_TRANSPORT_DISABLED/);
  const dispatcher = createRoleDispatcher({ outbox: { claim: () => { used = true; } }, store: {}, discord: {}, enabled: () => false });
  assert.deepEqual(await dispatcher.runOnce('worker'), { status: 'disabled' });
  assert.equal(used, false);
});

test('T18 metadata read expiry cannot be hidden by stamping the response completion time', async () => {
  let now = NOW;
  const rest = transportWith(async () => { now += 5_001; return response({ user: { id: USER }, roles: [CREW] }); }, { clock: () => now });
  const roles = createDiscordRoles({ transport: rest, mapping, clock: () => now, readContinuity: () => 'synthetic' });
  await assert.rejects(roles.observe(USER), /MEMBERSHIP_STALE/);
});

test('T18 actor observations share only the bot identity check and always read member roles afresh', async () => {
  let now = NOW, continuity = 'synthetic-continuity-1';
  const { state, roles } = simulatedDiscord({ clock: () => now, readContinuity: () => continuity });
  const identity = () => state.calls.filter(call => call.path === '/api/v10/users/@me').length;
  const member = () => state.calls.filter(call => call.path === `/api/v10/guilds/${GUILD}/members/${USER}`).length;
  await roles.observeActor(USER);
  now += 1_000;
  state.members.set(USER, []);
  assert.deepEqual((await roles.observeActor(USER)).roleIds, [], 'a role removal is seen without a gateway event');
  assert.equal(identity(), 1, 'the identity check is shared inside its window'); assert.equal(member(), 2);
  await roles.observeActor(USER); await roles.observeActor(USER);
  assert.equal(identity(), 1); assert.equal(member(), 4);
  now += 1_000;
  await roles.observeActor(USER);
  assert.equal(identity(), 2, 'an expired identity check is repeated');
  continuity = 'synthetic-continuity-2';
  await roles.observeActor(USER);
  assert.equal(identity(), 3, 'a gateway dispatch ends sharing');
  let failing = true;
  state.before = call => failing && call.path === '/api/v10/users/@me' ? (failing = false, response({ code: 0 }, 500)) : null;
  continuity = 'synthetic-continuity-3';
  await assert.rejects(roles.observeActor(USER), /DISCORD_UNAVAILABLE/);
  await roles.observeActor(USER);
  assert.equal(identity(), 5, 'a failed identity check is never shared');
});
