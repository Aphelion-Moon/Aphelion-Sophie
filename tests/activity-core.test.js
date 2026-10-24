import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { ContractError } from '../contracts/validation.js';
import { activityRunView, activityStopScene, activityStops, validateActivityConfiguration } from '../modules/onboarding/activity.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { createActivityAuth, ACTIVITY_SESSION_MS } from '../apps/core/security/activity-auth.js';
import { createCorePrincipals } from '../apps/core/security/principals.js';
import { createDiscordOAuth } from '../apps/core/discord/oauth.js';
import { DiscordError, createDiscordTransport } from '../apps/core/discord/transport.js';
import { createActivityHttpServer } from '../apps/core/http/activity.js';
import { createActivityStation } from '../apps/core/discord/activity-station.js';
import { stagingConfiguration } from './fixtures/staging.js';
import { GUILD, USER, OTHER, NOW, publication } from './fixtures/domain.js';

const APP = '100000000000000012', INSTANCE = 'i-1700000000000000000-gc-1-2';
const ORIGIN = 'https://onboarding.example.test';
const activityConfiguration = (changes = {}) => ({ origin: ORIGIN, port: 38125, status: 'testing', ...changes });
const session = (changes = {}) => ({ id: 'activity.1', guildId: GUILD, userId: USER, definitionId: publication.id, definitionVersion: publication.version,
  eligibilityEpoch: 1, mode: 'qualification', stepIndex: 0, status: 'active', version: 0, nonce: 'n1', grantAccessEpoch: null, helpPaused: false, ...changes });
const actorObservation = (userId, changes = {}) => ({ guildId: GUILD, userId, known: true, observedAt: NOW, present: true, roleIds: [], bot: false,
  timedOut: false, administrator: false, guildOwner: false, highestRolePosition: 0, ...changes });

test('T-ACT-CORE-01 configuration: origin, port and status are bounded; the runtime needs the dashboard OAuth and a free port', () => {
  validateActivityConfiguration(activityConfiguration());
  for (const changes of [{ origin: 'http://onboarding.example.test' }, { origin: `${ORIGIN}/app` }, { port: 80 }, { status: 'closed' }, { extra: true }]) {
    assert.throws(() => validateActivityConfiguration(activityConfiguration(changes)), error => error.code === 'ACTIVITY_CONFIGURATION_INVALID' || error.code === 'INVALID_INTEGER');
  }
  const runtime = { ...stagingConfiguration('a'.repeat(64)), activity: activityConfiguration() };
  validateStagingRuntime(runtime);
  assert.throws(() => validateStagingRuntime({ ...runtime, activity: activityConfiguration({ port: runtime.dashboardPort }) }), error => error.code === 'RUNTIME_PORT_CONFLICT');
  assert.throws(() => validateStagingRuntime({ ...runtime, dashboard: null }), error => error.code === 'ACTIVITY_CONFIGURATION_INVALID');
});

test('T-ACT-CORE-02 run view: published pages, stop scenes, and Whitelist confirmed only for a finished run Discord still shows', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(stop => activityStopScene(stop, 5)), ['departure-lounge', 'baggage-hall', 'boarding-cabin', 'viewport', 'pressure-door']);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(stop => activityStopScene(stop, 7)),
    ['departure-lounge', 'baggage-hall', 'boarding-cabin', 'viewport', 'baggage-hall', 'boarding-cabin', 'pressure-door']);
  assert.equal(activityStopScene(0, 1), 'departure-lounge');
  assert.equal(activityStops(publication).length, 5);
  const reading = activityRunView({ session: session({ stepIndex: 2, version: 4 }), publication, whitelist: false });
  assert.deepEqual(reading.pages, [publication.stages[2].body]);
  assert.equal(reading.status, 'reading'); assert.equal(reading.version, 4); assert.equal(reading.whitelist, 'none');
  const pending = activityRunView({ session: session({ stepIndex: 4, status: 'role_pending', grantAccessEpoch: 1 }), publication, whitelist: false });
  assert.equal(pending.status, 'pending'); assert.equal(pending.whitelist, 'requested');
  assert.equal(activityRunView({ session: session({ stepIndex: 4, status: 'complete' }), publication, whitelist: true }).whitelist, 'confirmed');
  assert.equal(activityRunView({ session: session({ stepIndex: 4, status: 'complete' }), publication, whitelist: false }).whitelist, 'none');
  assert.throws(() => activityRunView({ session: session({ definitionVersion: 2 }), publication, whitelist: false }), error => error.code === 'DEFINITION_MISMATCH');
});

function fakeAuth({ now = () => NOW, instance = id => ({ application_id: APP, instance_id: id, location: { guild_id: GUILD }, users: [USER] }), observe = actorObservation } = {}) {
  const identities = new WeakMap();
  return createActivityAuth({ applicationId: APP, guildId: GUILD, clock: now, enabled: () => true,
    oauth: { async exchangeActivity(code) { const proof = Object.freeze({}); identities.set(proof, code); return { proof, accessToken: 'access-token-synthetic', expiresIn: 600, scopes: ['identify'] }; },
      resolveIdentity: proof => ({ guildId: GUILD, userId: identities.get(proof) }) },
    instances: async id => instance(id), discord: { observeActor: async userId => observe(userId) } });
}

test('T-ACT-CORE-03 sign-in needs a running instance in this server with the member in it, and tokens expire', async () => {
  let time = NOW;
  const auth = fakeAuth({ now: () => time, observe: userId => actorObservation(userId, { observedAt: time }) });
  const signed = await auth.signIn({ code: USER, instanceId: INSTANCE });
  assert.match(signed.token, /^[a-f0-9]{64}$/); assert.equal(signed.accessToken, 'access-token-synthetic'); assert.equal(signed.expiresIn, 3600);
  const proof = await auth.authenticate(signed.token);
  assert.deepEqual(await auth.resolvePrincipal(proof), { guildId: GUILD, userId: USER });
  await assert.rejects(auth.signIn({ code: OTHER, instanceId: INSTANCE }), error => error.code === 'ACTIVITY_INSTANCE_INVALID');
  await assert.rejects(auth.signIn({ code: USER, instanceId: 'bad/instance' }), error => error.code === 'ACTIVITY_INSTANCE_INVALID');
  for (const instance of [() => null, id => ({ application_id: APP, instance_id: id, location: { guild_id: '100000000000000077' }, users: [USER] }),
    id => ({ application_id: '100000000000000078', instance_id: id, location: { guild_id: GUILD }, users: [USER] })]) {
    await assert.rejects(fakeAuth({ instance }).signIn({ code: USER, instanceId: INSTANCE }), error => error.code === 'ACTIVITY_INSTANCE_INVALID');
  }
  await assert.rejects(fakeAuth({ observe: userId => actorObservation(userId, { present: false, roleIds: [] }) }).signIn({ code: USER, instanceId: INSTANCE }),
    error => error.code === 'OPERATION_DENIED');
  time += ACTIVITY_SESSION_MS;
  await assert.rejects(auth.authenticate(signed.token), error => error.code === 'ACTIVITY_SESSION_INVALID');
  await assert.rejects(auth.resolvePrincipal(proof), error => error.code === 'UNTRUSTED_PRINCIPAL');
  time = NOW;
  const other = await auth.signIn({ code: USER, instanceId: INSTANCE });
  auth.signOut(other.token);
  await assert.rejects(auth.authenticate(other.token), error => error.code === 'ACTIVITY_SESSION_INVALID');
  await assert.rejects(auth.resolvePrincipal(Object.freeze({ guildId: GUILD, userId: USER })), error => error.code === 'UNTRUSTED_PRINCIPAL');
});

test('T-ACT-CORE-04 core principals try interactions, then the dashboard, then the Activity', async () => {
  const untrusted = { async resolvePrincipal() { throw new ContractError('UNTRUSTED_PRINCIPAL'); } };
  const activity = { async resolvePrincipal() { return { guildId: GUILD, userId: USER }; } };
  assert.deepEqual(await createCorePrincipals({ interactions: untrusted, dashboard: untrusted, activity }).resolvePrincipal({}), { guildId: GUILD, userId: USER });
  await assert.rejects(createCorePrincipals({ interactions: untrusted, dashboard: untrusted }).resolvePrincipal({}), error => error.code === 'UNTRUSTED_PRINCIPAL');
  const broken = { async resolvePrincipal() { throw new ContractError('AUTHORITY_UNCERTAIN'); } };
  await assert.rejects(createCorePrincipals({ interactions: untrusted, dashboard: broken, activity }).resolvePrincipal({}), error => error.code === 'AUTHORITY_UNCERTAIN');
});

test('T-ACT-CORE-05 the Activity code exchange sends no redirect URI and accepts only identify and presence scopes', async () => {
  const calls = [];
  const reply = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  const oauthFor = scope => createDiscordOAuth({ configuration: { guildId: GUILD, applicationId: APP, version: 1, origin: 'https://dashboard.example.test' },
    clientSecret: 'synthetic-client-secret', clock: () => NOW, enabled: () => true,
    fetch: async (url, options) => { calls.push({ url, body: options.body }); return url.endsWith('/token') ?
      reply({ token_type: 'Bearer', scope, access_token: 'synthetic-access-token-0001', expires_in: 604800 }) : reply({ id: USER }); } });
  const result = await oauthFor('rpc.activities.write identify').exchangeActivity('code123');
  assert.deepEqual(result.scopes, ['identify', 'rpc.activities.write']); assert.equal(result.accessToken, 'synthetic-access-token-0001');
  const body = new URLSearchParams(calls[0].body);
  assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('code'), 'code123'); assert.equal(body.has('redirect_uri'), false);
  for (const scope of ['identify guilds', 'rpc.activities.write', 'identify identify']) await assert.rejects(oauthFor(scope).exchangeActivity('code123'), error => error.code === 'OAUTH_RESPONSE_INVALID');
});

test('T-ACT-CORE-06 the instance lookup is a fixed bot route; an ended instance is absent', async () => {
  const seen = [];
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic.bot.token.value.0001', clock: () => NOW, enabled: () => true,
    fetch: async (url, options) => { seen.push([url, options.method]); return url.endsWith('missing') ?
      new Response(JSON.stringify({ code: 10_000 }), { status: 404 }) : new Response(JSON.stringify({ instance_id: 'i-1' }), { status: 200 }); } });
  assert.deepEqual(await transport.getActivityInstance(APP, 'i-1'), { instance_id: 'i-1' });
  assert.equal(await transport.getActivityInstance(APP, 'missing'), null);
  assert.deepEqual(seen[0], [`https://discord.com/api/v10/applications/${APP}/activity-instances/i-1`, 'GET']);
  await assert.rejects(transport.getActivityInstance(APP, '../users/@me'), error => error.code === 'ACTIVITY_INSTANCE_INVALID');
});

async function server(overrides = {}) {
  const calls = [], assets = new Map([['/', { body: Buffer.from('<!doctype html><title>Shuttle</title>'), type: 'text/html; charset=utf-8', etag: '"page"' }],
    ['/apps/activity/client/app.js', { body: Buffer.from('export {};'), type: 'text/javascript; charset=utf-8', etag: '"app"' }]]);
  const fakes = {
    async describe(input) { calls.push(['describe', input]); return { state: 'ready', mode: 'qualification', stops: [], whitelist: 'none' }; },
    async board(input) { calls.push(['board', input]); return { run: { stop: 0 } }; },
    async act(input) { calls.push(['act', input]); return { run: { stop: 1 }, queued: input.action === 'advance' }; },
    async reset(input) { calls.push(['reset', input]); return { duplicate: false, reset: true }; },
    ...overrides.store };
  // As the real store does: the capability checks (none here), then the member's observation, then the use case.
  const store = Object.fromEntries(Object.entries(fakes).map(([name, use]) =>
    [name, async ({ observe, ...input }) => use({ ...input, ...(observe ? { observation: await observe() } : {}) })]));
  let woken = 0;
  const http = createActivityHttpServer({ configuration: activityConfiguration(), applicationId: APP, guildId: GUILD, port: 38125, assets, channels: overrides.channels ?? null, enabled: async () => true, onFault: (code, context) => { calls.push(['fault', code]); if (context) calls.push(['fault-context', context]); },
    onTrace: (code, context) => calls.push(['trace', code, context]),
    wake: () => { woken++; }, clock: () => NOW, pause: async () => {},
    auth: { signIn: async input => { calls.push(['signIn', input]); return { token: 'a'.repeat(64), accessToken: 'x', scopes: ['identify'], expiresIn: 3600 }; },
      authenticate: async token => { if (token !== 'a'.repeat(64)) throw new ContractError('ACTIVITY_SESSION_INVALID'); return { guildId: GUILD, userId: USER }; },
      signOut: () => calls.push(['signOut']), ...overrides.auth },
    authorization: { resolveActor: async proof => ({ actorFor: proof.userId }) },
    discord: { observe: async userId => ({ observed: userId }) }, store, ...overrides.server });
  const address = await http.listen(0);
  // node:http rather than fetch, which cannot set the Host header the listener checks.
  const request = (path, { method = 'GET', body, token = 'a'.repeat(64), host = 'onboarding.example.test', headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const sent = httpRequest({ host: '127.0.0.1', port: address.port, path, method, headers: { host, ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => { const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode, headers: { get: name => response.headers[name.toLowerCase()] ?? null }, json: async () => JSON.parse(text), text }); });
    });
    sent.on('error', reject); sent.end(payload ?? undefined);
  });
  return { http, calls, request, woken: () => woken };
}

test('T-ACT-CORE-07 the listener serves only listed files, with a strict page policy, and refuses other hosts', async () => {
  const { http, request } = await server();
  try {
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'; script-src 'self'/);
    assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await request('/', { headers: { 'if-none-match': '"page"' } })).status, 304);
    assert.equal((await request('/apps/activity/client/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await request('/apps/core/runtime/staging.js')).status, 404);
    assert.equal((await request('/', { host: 'evil.example.test' })).status, 421);
    assert.equal((await request('/', { method: 'POST', body: {} })).status, 405);
  } finally { await http.close(); }
});

test('T-ACT-CORE-08 API routes: bearer sign-in, fresh member context, closed shapes and fixed outcome words', async () => {
  const { http, calls, request, woken } = await server();
  try {
    const signed = await request('/api/session', { method: 'POST', token: null, body: { code: 'c0de', instanceId: INSTANCE } });
    assert.equal(signed.status, 200); assert.equal((await signed.json()).token, 'a'.repeat(64));
    assert.equal((await request('/api/session', { method: 'POST', token: null, body: { code: 'c0de', instanceId: INSTANCE, extra: 1 } })).status, 400);
    assert.equal((await request('/api/shuttle', { token: null })).status, 401);
    assert.deepEqual(await (await request('/api/shuttle', { token: 'b'.repeat(64) })).json(), { error: 'signin' });
    const shown = await request('/api/shuttle');
    assert.equal(shown.status, 200); assert.equal(shown.headers.get('cache-control'), 'no-store');
    assert.deepEqual(calls.find(([name]) => name === 'describe')[1], { actor: { actorFor: USER }, observation: { observed: USER } });
    assert.equal((await request('/api/shuttle/board', { method: 'POST', body: { requestId: 'f'.repeat(32) } })).status, 200);
    const moved = await request('/api/shuttle/act', { method: 'POST', body: { requestId: 'e'.repeat(32), action: 'advance', expectedVersion: 3 } });
    assert.deepEqual(await moved.json(), { run: { stop: 1 } }); assert.equal(woken(), 1);
    await request('/api/shuttle/act', { method: 'POST', body: { requestId: 'd'.repeat(32), action: 'back', expectedVersion: 4 } });
    assert.equal(woken(), 1);
    assert.equal((await request('/api/shuttle/act', { method: 'POST', body: 'not an object' })).status, 400);
    assert.equal((await request('/api/shuttle/act', { method: 'POST', body: { requestId: 'd'.repeat(32) }, headers: { 'content-type': 'text/plain' } })).status, 400);
    // Reset journey: the member's own fresh context, a closed body, and only whether something was reset.
    const reset = await request('/api/shuttle/reset', { method: 'POST', body: { requestId: 'c'.repeat(32) } });
    assert.deepEqual(await reset.json(), { reset: true });
    assert.deepEqual(calls.find(([name]) => name === 'reset')[1], { actor: { actorFor: USER }, observation: { observed: USER }, requestId: 'c'.repeat(32) });
    assert.equal((await request('/api/shuttle/reset', { method: 'POST', body: { requestId: 'c'.repeat(32), userId: '1' } })).status, 400);
    assert.equal((await request('/api/session/end', { method: 'POST' })).status, 204);
    assert.equal((await request('/api/unknown')).status, 404);
    assert.deepEqual(await (await request('/api/config', { token: null })).json(), { applicationId: APP, guildId: GUILD });
  } finally { await http.close(); }
});

test('T-ACT-CORE-10 a database lock timeout is retried; one that persists alerts with who was affected and the request', async () => {
  // PG 55P03 (lock_timeout), 40001 and 40P01 are raised before COMMIT: the work rolled back and is safe to send again.
  let tries = 0;
  const lockError = () => Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
  const busy = await server({ store: { async act(input) { if (++tries < 3) throw lockError(); return { run: { stop: 1 }, queued: false, input }; } } });
  try {
    const response = await busy.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'advance', expectedVersion: 1 } });
    assert.equal(response.status, 200); assert.equal(tries, 3);
    assert.deepEqual(busy.calls.filter(([name]) => name.startsWith('fault')), [], 'a retried lock is not an error');
  } finally { await busy.http.close(); }
  const stuck = await server({ store: { async act() { throw lockError(); } } });
  try {
    const response = await stuck.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'advance', expectedVersion: 1 } });
    assert.equal(response.status, 503);
    assert.deepEqual(stuck.calls.filter(([name]) => name === 'fault'), [['fault', 'ACTIVITY_REQUEST_UNAVAILABLE_PG_55P03']]);
    // The alert learns the member and the request; the log line also where the request was and how it failed.
    assert.deepEqual(stuck.calls.filter(([name]) => name === 'fault-context'), [['fault-context', { userId: USER, request: 'POST /api/shuttle/act (advance)',
      stage: 'asked:v1', phase: 'transaction', cause: 'PG_55P03', retried: 'transaction>PG_55P03/transaction>PG_55P03/transaction>PG_55P03', tries: 4, ms: 0 }]]);
  } finally { await stuck.http.close(); }
});

test('T-ACT-CORE-09 refusals map to fixed words; transient Discord reads are retried; anything unexpected logs one code', async () => {
  let attempts = 0;
  const outcomes = { ACTIVITY_CLOSED: [403, 'closed'], SHUTTLE_ELSEWHERE: [409, 'elsewhere'], STALE_SHUTTLE_CONTROL: [409, 'stale'], OPERATION_DENIED: [403, 'denied'],
    ACTIVITY_INSTANCE_INVALID: [403, 'instance'] };
  for (const [code, [status, word]] of Object.entries(outcomes)) {
    const { http, request } = await server({ store: { async describe() { throw new ContractError(code); } } });
    try { const response = await request('/api/shuttle'); assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: word }); }
    finally { await http.close(); }
  }
  const flaky = await server({ store: { async describe() { if (++attempts < 3) throw new ContractError('OBSERVATION_INVALIDATED'); return { state: 'closed' }; } } });
  try { assert.deepEqual(await (await flaky.request('/api/shuttle')).json(), { state: 'closed' }); assert.equal(attempts, 3); }
  finally { await flaky.http.close(); }
  const broken = await server({ store: { async describe() { throw new Error('secret detail'); } } });
  try {
    const response = await broken.request('/api/shuttle');
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'unavailable' });
    // The log names the kind of failure, never its message (owner request, 24 October 2026).
    assert.deepEqual(broken.calls.filter(([name]) => name === 'fault'), [['fault', 'ACTIVITY_REQUEST_UNAVAILABLE_ERROR']]);
  } finally { await broken.http.close(); }
  const sqlFailure = Object.assign(new Error('insert violates check constraint on user 100000000000000012'), { code: '23514' });
  for (const [thrown, logged] of [[new ContractError('CAPABILITY_POLICY_IMMUTABLE'), 'ACTIVITY_REQUEST_UNAVAILABLE_CAPABILITY_POLICY_IMMUTABLE'],
    [sqlFailure, 'ACTIVITY_REQUEST_UNAVAILABLE_PG_23514'], [new TypeError('x of undefined'), 'ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR'],
    [Object.assign(new Error('secret'), { code: 'not a code 123' }), 'ACTIVITY_REQUEST_UNAVAILABLE_ERROR'],
    [new ContractError('A_VERY_LONG_CONTRACT_CODE_THAT_GOES_ON_AND_ON'), 'ACTIVITY_REQUEST_UNAVAILABLE_A_VERY_LONG_CONTRACT_CODE_THAT_GOES'.slice(0, 64)]]) {
    const failing = await server({ store: { async describe() { throw thrown; } } });
    try {
      assert.equal((await failing.request('/api/shuttle')).status, 503);
      const faults = failing.calls.filter(([name]) => name === 'fault').map(([, code]) => code);
      assert.deepEqual(faults, [logged]); assert.ok(faults.every(code => /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)), 'the log writer accepts it');
    } finally { await failing.http.close(); }
  }
});

test('T-ACT-CORE-10 run views carry visible channel links, arrival channels only once confirmed, and a channel failure never blocks the Shuttle', async () => {
  const resolved = [], GENERAL = '100000000000000301', RIFT = '100000000000000302';
  const channels = { async resolve(input) {
    resolved.push(input);
    return { mentions: { '#general': { id: GENERAL, name: 'general' } }, arrival: input.arrival?.length ? [{ id: RIFT, name: 'meridian-rift', note: 'SS 13' }] : [] };
  } };
  const view = (changes, curated = []) => Object.defineProperty({ stop: 4, whitelist: 'none', pages: ['Say hi in #general.'], ...changes }, 'arrivalChannels', { value: curated, enumerable: false });
  let shown = view({});
  const { http, request } = await server({ channels, store: { async describe() { return { state: 'run', run: shown }; } } });
  try {
    let body = await (await request('/api/shuttle')).json();
    assert.deepEqual(body.run.channels, { '#general': { id: GENERAL, name: 'general' } });
    assert.equal(body.run.arrival, undefined); assert.equal(resolved.at(-1).arrival, null); assert.equal(resolved.at(-1).userId, USER);
    shown = view({ whitelist: 'confirmed' }, [{ channelId: RIFT, note: 'SS 13' }]);
    body = await (await request('/api/shuttle')).json();
    assert.deepEqual(body.run.arrival, [{ id: RIFT, name: 'meridian-rift', note: 'SS 13' }]);
    assert.equal(JSON.stringify(body).includes('arrivalChannels'), false);
    shown = view({ whitelist: 'confirmed' });
    assert.deepEqual((await (await request('/api/shuttle')).json()).run.arrival, [{ id: GENERAL, name: 'general' }], 'without a curated list, the final stop\'s channels');
  } finally { await http.close(); }
  const failing = await server({ channels: { async resolve() { throw new Error('discord down'); } },
    store: { async describe() { return { state: 'run', run: view({ whitelist: 'confirmed' }) }; } } });
  try {
    const body = await (await failing.request('/api/shuttle')).json();
    assert.deepEqual(body.run.channels, {}); assert.deepEqual(body.run.arrival, []);
    assert.deepEqual(failing.calls.filter(([name]) => name === 'fault'), [['fault', 'ACTIVITY_CHANNELS_UNAVAILABLE']]);
  } finally { await failing.http.close(); }
});

test('T-ACT-CORE-11 the station board and the member\'s own boarding pass come only at the last stop, cached, and never block the Shuttle', async () => {
  let counts = 0, members = 0, now = NOW;
  const transport = {
    async getGuildCounts() { counts++; return { id: GUILD, approximate_member_count: 1234, approximate_presence_count: 321 }; },
    async getMember(userId) { members++; return userId === USER ? { nick: null, joined_at: '2026-10-01T12:00:00.000Z', user: { username: 'synthetic', global_name: 'Synthetic Spacer' } } : null; },
  };
  const station = createActivityStation({ transport, guildId: GUILD, clock: () => now });
  assert.deepEqual(await station.station(), { crew: 1234, online: 321 });
  await station.station(); assert.equal(counts, 1, 'counts are cached');
  now += 300_001; await station.station(); assert.equal(counts, 2);
  assert.deepEqual(await station.pass(USER), { name: 'Synthetic Spacer', joined: '2026-10-01' });
  await station.pass(USER); assert.equal(members, 1);
  assert.equal(await station.pass(OTHER), null);
  const stops = [0, 1, 2, 3, 4].map(index => ({ id: `s${index}`, title: `Stop ${index + 1}`, scene: 'viewport' }));
  let shown = { stop: 1, status: 'reading', stops, whitelist: 'none', pages: ['x'] };
  const { http, request } = await server({ server: { station }, store: { async describe() { return { state: 'run', run: shown }; } } });
  try {
    let body = await (await request('/api/shuttle')).json();
    assert.equal(body.run.station, undefined); assert.equal(body.run.pass, undefined);
    shown = { ...shown, stop: 4 };
    body = await (await request('/api/shuttle')).json();
    assert.deepEqual(body.run.station, { crew: 1234, online: 321 }); assert.deepEqual(body.run.pass, { name: 'Synthetic Spacer', joined: '2026-10-01' });
  } finally { await http.close(); }
  const broken = { async station() { throw new Error('down'); }, async pass() { throw new Error('down'); } };
  const failing = await server({ server: { station: broken }, store: { async describe() { return { state: 'run', run: { stop: 4, status: 'reading', stops, whitelist: 'none', pages: ['x'] } }; } } });
  try {
    const body = await (await failing.request('/api/shuttle')).json();
    assert.equal(body.run.station, undefined); assert.equal(body.run.pass, undefined); assert.equal(body.run.stop, 4);
    assert.deepEqual(failing.calls.filter(([name]) => name === 'fault').map(([, code]) => code), ['ACTIVITY_STATION_UNAVAILABLE', 'ACTIVITY_PASS_UNAVAILABLE']);
  } finally { await failing.http.close(); }
});

test('T-ACT-CORE-12 one member cannot crowd out the rest: a budget per member before Discord, and Discord busy is not a fault', async () => {
  // A burst of eight, then 'slow' (429) with a pause to wait; the clock here never moves, so nothing refills.
  const { http, calls, request } = await server();
  try {
    for (let i = 0; i < 8; i++) assert.equal((await request('/api/shuttle')).status, 200, `request ${i + 1}`);
    const refused = await request('/api/shuttle');
    assert.equal(refused.status, 429); assert.deepEqual(await refused.json(), { error: 'slow' }); assert.equal(refused.headers.get('retry-after'), '2');
    assert.equal(calls.filter(([name]) => name === 'describe').length, 8, 'the ninth never reached the store or Discord');
    assert.deepEqual(calls.filter(([name]) => name === 'fault'), []);
  } finally { await http.close(); }
  // At most two of one member's requests at a time: a third waits for nothing, it is refused; once one ends, room again.
  let releaseAll; const gate = new Promise(resolve => { releaseAll = resolve; });
  const slow = await server({ store: { async describe() { await gate; return { state: 'ready' }; } } });
  try {
    const first = slow.request('/api/shuttle'), second = slow.request('/api/shuttle');
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await slow.request('/api/shuttle')).status, 429);
    releaseAll(); assert.equal((await first).status, 200); assert.equal((await second).status, 200);
    assert.equal((await slow.request('/api/shuttle')).status, 200, 'finished requests free their place');
  } finally { await slow.http.close(); }
  // Discord's own "not now" asks the Activity to try again later, with no alert; so do the channel links when Discord is busy.
  for (const code of ['DISCORD_BUSY', 'RATE_LIMITED', 'DISCORD_UNAVAILABLE']) {
    const busy = await server({ server: { discord: { observe: async () => { throw new DiscordError(code, 250); } } } });
    try {
      const response = await busy.request('/api/shuttle');
      assert.equal(response.status, 503, code); assert.deepEqual(await response.json(), { error: 'retry' });
      assert.deepEqual(busy.calls.filter(([name]) => name === 'fault'), [], code);
    } finally { await busy.http.close(); }
  }
  const channels = { async resolve() { throw new DiscordError('DISCORD_BUSY', 250); } };
  const quiet = await server({ channels, store: { async describe() { return { state: 'run', run: { whitelist: 'none', pages: [], stops: [], stop: 0, status: 'reading' } }; } } });
  try {
    const response = await quiet.request('/api/shuttle');
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).run.channels, {});
    assert.deepEqual(quiet.calls.filter(([name]) => name === 'fault'), [], 'a busy channel read is not a fault');
  } finally { await quiet.http.close(); }
});

test('T-ACT-CORE-13 members arriving together share one Discord read of the channel directory and the station counts', async () => {
  const { createActivityChannels } = await import('../apps/core/discord/activity-channels.js');
  let guildReads = 0, listReads = 0, countReads = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const transport = {
    async getGuild() { guildReads++; await held; return { id: GUILD, owner_id: OTHER }; },
    async getGuildChannels() { listReads++; await held; return [{ id: '100000000000000777', type: 0, name: 'general', position: 0, permission_overwrites: [] }]; },
    async getGuildCounts() { countReads++; await held; return { id: GUILD, approximate_member_count: 10, approximate_presence_count: 3 }; },
    async getMember() { return null; },
  };
  const roles = { async prepare() { return { context: { roles: [{ id: GUILD, permissions: String(1n << 10n) }], memberRoleIds: [] } }; } };
  const channels = createActivityChannels({ transport, roles, guildId: GUILD, clock: () => NOW });
  const station = createActivityStation({ transport, guildId: GUILD, clock: () => NOW });
  const waiting = [...Array(5)].map(() => channels.resolve({ userId: USER, pages: ['See #general.'] }));
  const counted = [...Array(5)].map(() => station.station());
  release();
  for (const found of await Promise.all(waiting)) assert.deepEqual(found.mentions['#general'], { id: '100000000000000777', name: 'general' });
  for (const value of await Promise.all(counted)) assert.deepEqual(value, { crew: 10, online: 3 });
  assert.deepEqual([guildReads, listReads, countReads], [1, 1, 1]);
});

test('T-ACT-CORE-14 the game buttons come only with Whitelist as Discord shows it now, with the info channels the member can see', async () => {
  const asked = [];
  const channels = {
    async resolve() { return { mentions: {}, arrival: [] }; },
    async named({ userId, names }) { asked.push([userId, names]); return { 'ss13-info': { id: '100000000000000801', name: 'ss13-info' } }; },
  };
  const ready = whitelist => ({ store: { async describe() { return { state: 'ready', mode: 'refresh', stops: [], whitelist: whitelist ? 'confirmed' : 'none' }; } },
    server: { discord: { observe: async userId => ({ observed: userId, whitelist }) } } });
  const yes = await server({ channels, ...ready(true) });
  try {
    const body = await (await yes.request('/api/shuttle')).json();
    assert.deepEqual(body.games, { channels: { 'ss13-info': { id: '100000000000000801', name: 'ss13-info' } } });
    assert.deepEqual(asked, [[USER, ['ss13-info', 'ss14-info']]]);
  } finally { await yes.http.close(); }
  const no = await server({ channels, ...ready(false) });
  try { assert.equal((await (await no.request('/api/shuttle')).json()).games, undefined, 'no Whitelist, no buttons'); }
  finally { await no.http.close(); }
  // A run carries them on the run; a failed channel read still offers the quick-connect buttons, without channels.
  const failing = { ...channels, async named() { throw new DiscordError('DISCORD_BUSY', 250); } };
  const run = await server({ channels: failing, store: { async describe() { return { state: 'run', run: { whitelist: 'confirmed', status: 'boarded', pages: [], stops: [], stop: 0 } }; } },
    server: { discord: { observe: async userId => ({ observed: userId, whitelist: true }) } } });
  try {
    const body = await (await run.request('/api/shuttle')).json();
    assert.deepEqual(body.run.games, { channels: {} }); assert.equal(body.games, undefined);
    assert.deepEqual(run.calls.filter(([name]) => name === 'fault'), []);
  } finally { await run.http.close(); }
});

test('T-ACT-CORE-15 at the end of the ride the member\'s own role change can overtake the channel reads: tried again, then quiet', async () => {
  // Sophie has just granted Whitelist; the member update makes a role read in flight OBSERVATION_INVALIDATED.
  const arrivalRun = { whitelist: 'confirmed', status: 'boarded', pages: ['Head to #general.'], stops: [], stop: 0, arrivalChannels: [] };
  const describe = { async describe() { return { state: 'run', run: structuredClone(arrivalRun) }; } };
  let tries = 0;
  const once = { async resolve() { if (++tries === 1) throw new ContractError('OBSERVATION_INVALIDATED'); return { mentions: { '#general': { id: '100000000000000777', name: 'general' } }, arrival: [] }; },
    async named() { return {}; } };
  const retried = await server({ channels: once, store: describe, server: { discord: { observe: async userId => ({ observed: userId, whitelist: true }) } } });
  try {
    const body = await (await retried.request('/api/shuttle')).json();
    assert.equal(tries, 2); assert.deepEqual(body.run.arrival, [{ id: '100000000000000777', name: 'general' }], 'the second read gives the arrival channels');
    assert.deepEqual(retried.calls.filter(([name]) => name === 'fault'), []);
  } finally { await retried.http.close(); }
  for (const code of ['OBSERVATION_INVALIDATED', 'MEMBERSHIP_STALE']) {
    const always = { async resolve() { throw new ContractError(code); }, async named() { throw new ContractError(code); } };
    const quiet = await server({ channels: always, store: describe, server: { discord: { observe: async userId => ({ observed: userId, whitelist: true }) } } });
    try {
      const response = await quiet.request('/api/shuttle');
      assert.equal(response.status, 200, code); const body = await response.json();
      assert.deepEqual([body.run.arrival, body.run.games], [[], { channels: {} }], code);
      assert.deepEqual(quiet.calls.filter(([name]) => name === 'fault'), [], `${code}: no alert`);
    } finally { await quiet.http.close(); }
  }
  // Anything else still alerts.
  const broken = await server({ channels: { async resolve() { throw new TypeError('x'); }, async named() { return {}; } }, store: describe });
  try { await broken.request('/api/shuttle'); assert.deepEqual(broken.calls.filter(([name]) => name === 'fault'), [['fault', 'ACTIVITY_CHANNELS_UNAVAILABLE']]); }
  finally { await broken.http.close(); }
});

test('T-ACT-CORE-16 a refused or quietly retried request is logged with who, where in the Shuttle and how it failed; the log line has its time', async () => {
  // Owner report, 24 October 2026: a member's final Continue was refused on every press and nothing recorded where or why.
  const finalStop = { run: { stop: 4, stops: [{}, {}, {}, {}, {}], status: 'reading', version: 4, whitelist: 'none' } };
  const stale = await server({ store: { async describe() { return structuredClone(finalStop); }, async act() { throw new ContractError('MEMBERSHIP_STALE'); } } });
  try {
    await stale.request('/api/shuttle');
    const response = await stale.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'advance', expectedVersion: 4 } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'retry' });
    assert.deepEqual(stale.calls.filter(([name]) => name === 'fault'), [], 'a transient refusal is not an alert');
    assert.deepEqual(stale.calls.filter(([name]) => name === 'trace'), [['trace', 'ACTIVITY_REQUEST_RETRY', { userId: USER, request: 'POST /api/shuttle/act (advance)',
      stage: 'stop5/5:reading:v4:asked:v4', phase: 'transaction', cause: 'MEMBERSHIP_STALE',
      retried: 'transaction>MEMBERSHIP_STALE/transaction>MEMBERSHIP_STALE/transaction>MEMBERSHIP_STALE', tries: 4, ms: 0 }]]);
  } finally { await stale.http.close(); }
  // A refusal with an outcome word says so; a request that never got past the session check says that too.
  const stale409 = await server({ store: { async act() { throw new ContractError('STALE_SHUTTLE_CONTROL'); } } });
  try {
    await stale409.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'back', expectedVersion: 2 } });
    await stale409.request('/api/shuttle', { token: 'b'.repeat(64) });
    assert.deepEqual(stale409.calls.filter(([name]) => name === 'trace').map(([, code, context]) => [code, context.phase, context.cause]),
      [['ACTIVITY_REQUEST_STALE', 'transaction', 'STALE_SHUTTLE_CONTROL'], ['ACTIVITY_REQUEST_SIGNIN', 'session', 'ACTIVITY_SESSION_INVALID']]);
  } finally { await stale409.http.close(); }
  // A queued grant is noted with where the run now is.
  const queued = await server({ store: { async act() { return { run: { stop: 4, stops: [{}, {}, {}, {}, {}], status: 'pending', version: 5 }, queued: true }; } } });
  try {
    await queued.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'advance', expectedVersion: 4 } });
    assert.deepEqual(queued.calls.filter(([name]) => name === 'trace').map(([, code, context]) => [code, context.stage]), [['ACTIVITY_GRANT_QUEUED', 'stop5/5:pending:v5:asked:v4']]);
  } finally { await queued.http.close(); }

  // The host line: UTC time, prefix, code, then the bounded detail the runtime formats.
  const { installedLogLine } = await import('../apps/installation/host.js');
  const { logDetail } = await import('../apps/core/runtime/staging.js');
  const detail = logDetail({ userId: USER, request: 'POST /api/shuttle/act (advance)', stage: 'stop5/5:reading:v4', phase: 'transaction', cause: 'MEMBERSHIP_STALE', tries: 4, ms: 5321 });
  assert.equal(detail, `user=${USER} request=POST:/api/shuttle/act:advance stage=stop5/5:reading:v4 phase=transaction cause=MEMBERSHIP_STALE tries=4 ms=5321`);
  assert.equal(installedLogLine('AI_INSTALLED_ROLE_TRACE', 'ACTIVITY_REQUEST_RETRY', detail, new Date(Date.UTC(2026, 9, 24, 14, 28, 3, 512))),
    `2026-10-24T14:28:03.512Z AI_INSTALLED_ROLE_TRACE ACTIVITY_REQUEST_RETRY ${detail}\n`);
  // Free text never reaches the line: a value outside the vocabulary is left out, and a detail that is not key=value pairs is dropped.
  assert.equal(logDetail({ userId: USER, cause: 'secret detail\nnext line' }), `user=${USER}`);
  assert.equal(installedLogLine('P', 'CODE_X', 'not pairs; DROP TABLE', new Date(0)), '1970-01-01T00:00:00.000Z P CODE_X\n');
  assert.equal(installedLogLine('P', 'lower case', null, new Date(0)), '1970-01-01T00:00:00.000Z P\n');
});

test('T-ACT-CORE-17 core\'s Discord gate shut for a moment (Gateway not current) is tried again and answered quietly, never alerted', async () => {
  // Owner report, 24 October 2026: an alert ACTIVITY_REQUEST_UNAVAILABLE_DISCORD_TRANSPORT_DISABLED for a member who noticed nothing.
  let tries = 0;
  const brief = await server({ server: { authorization: { resolveActor: async proof => { if (++tries < 3) throw new ContractError('DISCORD_TRANSPORT_DISABLED'); return { actorFor: proof.userId }; } } } });
  try {
    const response = await brief.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'advance', expectedVersion: 0 } });
    assert.equal(response.status, 200); assert.equal(tries, 3);
    assert.deepEqual(brief.calls.filter(([name]) => name === 'fault'), []);
  } finally { await brief.http.close(); }
  const shut = await server({ server: { authorization: { resolveActor: async () => { throw new ContractError('DISCORD_TRANSPORT_DISABLED'); } } } });
  try {
    const response = await shut.request('/api/shuttle/act', { method: 'POST', body: { requestId: 'r'.repeat(32), action: 'advance', expectedVersion: 0 } });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'retry' });
    assert.deepEqual(shut.calls.filter(([name]) => name === 'fault'), [], 'no alert');
    assert.deepEqual(shut.calls.filter(([name]) => name === 'trace').map(([, code, context]) => [code, context.phase, context.cause, context.tries]),
      [['ACTIVITY_REQUEST_RETRY', 'actor', 'DISCORD_TRANSPORT_DISABLED', 4]], 'still logged');
  } finally { await shut.http.close(); }
});
