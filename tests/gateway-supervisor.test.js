import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayClosePolicy, gatewayDiscovery, parseGatewayFrame } from '../apps/core/discord/gateway-protocol.js';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { GUILD, NOW } from './fixtures/domain.js';
import { readyEvent, guildEvent, gatewayEvent } from './fixtures/gateway.js';
import { discoveryResponse, settle, supervisorFixture, SYNTHETIC_GATEWAY_TOKEN } from './fixtures/gateway-supervisor.js';

test('message intents are added only by the explicit capture composition and cannot be arbitrary', async t => {
  assert.throws(() => supervisorFixture({ journalOverrides: { messageIntents: 1 } }), /GATEWAY_INTENTS_INVALID/);
  const f = supervisorFixture({ journalOverrides: { messageIntents: 33280 } }); t.after(() => f.supervisor.stop());
  await f.start(); const socket = await f.hello(); assert.equal(socket.sent[0].d.intents, 33283);
});

test('Gateway discovery uses one fixed authenticated route and rejects unsafe destinations and shard counts', async () => {
  const calls = [];
  const transport = createDiscordTransport({ guildId: GUILD, token: SYNTHETIC_GATEWAY_TOKEN, clock: () => NOW,
    enabled: () => true, fetch: async (url, request) => { calls.push({ url, request }); return Response.json(discoveryResponse()); } });
  assert.equal(gatewayDiscovery(await transport.getGatewayBot()).remaining, 999);
  assert.equal(calls[0].url, 'https://discord.com/api/v10/gateway/bot');
  assert.equal(calls[0].request.method, 'GET'); assert.equal(calls[0].request.redirect, 'error');
  assert.throws(() => gatewayDiscovery({ ...discoveryResponse(), url: 'wss://elsewhere.invalid/' }), /INVALID_GATEWAY_URL/);
  assert.throws(() => gatewayDiscovery({ ...discoveryResponse(), shards: 2 }), /GATEWAY_SHARDING_UNSUPPORTED/);
  assert.throws(() => gatewayDiscovery({ ...discoveryResponse(), session_start_limit: { remaining: 0 } }), /INVALID_INTEGER/);
  for (const data of ['{', 'null', '[]', '{"op":99}', JSON.stringify({ op: 0, s: -1 }), ' '.repeat(1_048_577), new Uint8Array(3)]) {
    assert.throws(() => parseGatewayFrame(data));
  }
  for (const code of [4004, 4010, 4011, 4012, 4013, 4014]) assert.equal(gatewayClosePolicy(code).fatal, true);
  for (const code of [1000, 1001, 4007, 4009]) assert.equal(gatewayClosePolicy(code).resume, false);
  assert.equal(gatewayClosePolicy(4008).waitMs, 60_000);
});

test('supervisor sends minimal Identify, gates on heartbeat ACK, answers server requests and stops all timers', async t => {
  const f = supervisorFixture(); t.after(() => f.supervisor.stop());
  const { done } = await f.start(); const socket = await f.hello();
  assert.deepEqual(socket.sent, [{ op: 2, d: { token: SYNTHETIC_GATEWAY_TOKEN, intents: 3,
    properties: { os: 'windows', browser: 'Sophie', device: 'Sophie' } } }]);
  assert.deepEqual(f.urls, ['wss://gateway.discord.gg/?v=10&encoding=json']);
  socket.receive(readyEvent()); socket.receive(guildEvent()); await settle();
  assert.equal(await f.observer.isCurrent(), false);
  await f.advance(999); assert.equal(socket.sent.length, 1);
  await f.advance(1); assert.deepEqual(socket.sent.at(-1), { op: 1, d: 2 });
  socket.receive({ op: 11 }); assert.equal(await f.observer.isCurrent(), true);
  socket.receive({ op: 1, d: null }); assert.deepEqual(socket.sent.at(-1), { op: 1, d: 2 });
  socket.receive({ op: 11 });
  assert.equal((await f.supervisor.readStatus()).phase, 'current');
  await f.supervisor.stop(); assert.equal((await done).phase, 'stopped');
  assert.deepEqual(socket.closeCodes, [3000]); assert.equal(await f.observer.isCurrent(), false);
  assert.equal(f.pending.size, 0);
  assert.throws(() => f.supervisor.start('second'), /GATEWAY_ALREADY_STARTED/);
});

test('missed heartbeat pauses admission and resumes from the committed cursor; old socket callbacks are inert', async t => {
  const f = supervisorFixture(); t.after(() => f.supervisor.stop());
  await f.start(); const socket = await f.hello();
  socket.receive(readyEvent()); socket.receive(guildEvent()); await settle();
  await f.advance(1_000); socket.receive({ op: 11 });
  await f.advance(4_000); assert.equal(await f.observer.isCurrent(), true);
  await f.advance(4_000); assert.equal(await f.observer.isCurrent(), false);
  assert.equal((await f.supervisor.readStatus()).code, 'GATEWAY_HEARTBEAT_MISSED');
  await f.advance(1_250); const replacement = await f.hello();
  assert.deepEqual(replacement.sent[0], { op: 6, d: { token: SYNTHETIC_GATEWAY_TOKEN, session_id: 'synthetic-gateway-session', seq: 2 } });
  assert.equal(f.stats().discoveryCalls, 1);
  socket.receive(gatewayEvent(99, 'IGNORED_EVENT')); socket.receive({ op: 11 });
  replacement.receive(gatewayEvent(3, 'RESUMED')); await settle();
  await f.advance(1_000); replacement.receive({ op: 11 }); assert.equal(await f.observer.isCurrent(), true);
  assert.equal(f.calls.some(call => call.sequence === 99), false);
});

test('nonresumable invalid sessions use a fresh Identify; resumable failures use the stored resume URL', async t => {
  const f = supervisorFixture(); t.after(() => f.supervisor.stop());
  await f.start(); const socket = await f.hello();
  const ready = readyEvent(); ready.d.resume_gateway_url = 'wss://gateway-us-east1-b.discord.gg/';
  socket.receive(ready); socket.receive(guildEvent()); await settle();
  socket.receive({ op: 9, d: true }); await settle(); await f.advance(2_000);
  const resumed = await f.hello(); assert.equal(resumed.sent[0].op, 6);
  assert.equal(f.urls.at(-1), 'wss://gateway-us-east1-b.discord.gg/?v=10&encoding=json');
  resumed.receive({ op: 9, d: false }); await settle(); await f.advance(2_250);
  const identified = await f.hello(); assert.equal(identified.sent[0].op, 2);
  assert.equal(f.stats().discoveryCalls, 2); assert.equal(f.calls.filter(x => x.kind === 'identify').length, 2);
});

test('fatal close codes and unexpected ACKs halt without leaking raw socket data or credentials', async () => {
  for (const fail of [s => s.serverClose(4014), s => s.receive({ op: 11 }), s => s.raw('{untrusted invalid body')]) {
    const f = supervisorFixture(); const { done } = await f.start(); const socket = await f.hello();
    fail(socket); const result = await done;
    assert.equal(result.phase, 'halted'); assert.equal(f.pending.size, 0);
    assert.equal(JSON.stringify(result).includes(SYNTHETIC_GATEWAY_TOKEN), false);
    assert.equal(JSON.stringify(result).includes('untrusted'), false);
    assert.equal(f.sockets.length, 1); assert.equal(await f.observer.isCurrent(), false);
  }
});

test('remote and durable Identify budgets defer connections or authentication without burning further attempts', async t => {
  const discovery = discoveryResponse(); discovery.session_start_limit.remaining = 0; discovery.session_start_limit.reset_after = 20_000;
  const remote = supervisorFixture({ discovery }); t.after(() => remote.supervisor.stop());
  await remote.start(); await remote.advance(20_999);
  assert.equal(remote.sockets.length, 0); assert.equal(remote.stats().discoveryCalls, 1);
  await remote.advance(1); assert.equal(remote.stats().discoveryCalls, 2);
  const local = supervisorFixture({ journalOverrides: { reserveIdentify: async () => ({ waitMs: 60_000 }) } });
  t.after(() => local.supervisor.stop()); await local.start(); const socket = await local.hello();
  assert.equal(socket.sent.length, 0); assert.equal((await local.supervisor.readStatus()).code, 'GATEWAY_IDENTIFY_LIMIT');
  await local.advance(60_999); assert.equal(local.sockets.length, 1);
  await local.advance(1); assert.equal(local.sockets.length, 2);
});

test('lease failure or a disabled operator gate closes the socket and prevents automatic retry', async () => {
  for (const type of ['lease', 'gate']) {
    const f = supervisorFixture(); const { done } = await f.start(); await f.hello();
    if (type === 'lease') f.journal.renew = async () => { throw new Error('synthetic lease failure'); };
    else f.disable();
    // Keep heartbeats alive until the independent ten-second renewal checks the gate.
    const socket = f.sockets[0]; socket.receive(readyEvent()); socket.receive(guildEvent()); await settle();
    for (const ms of [1_000, 4_000, 4_000]) { await f.advance(ms); if (type === 'lease') socket.receive({ op: 11 }); }
    await f.advance(1_000); const result = await done;
    assert.equal(result.phase, 'halted'); assert.equal(f.pending.size, 0); assert.equal(await f.observer.isCurrent(), false);
    assert.equal(f.sockets.length, 1);
  }
});

test('stop during a slow Identify reservation waits for its completion and never sends the late credential', async () => {
  let release;
  const f = supervisorFixture({ journalOverrides: { reserveIdentify: () => new Promise(resolve => { release = resolve; }) } });
  const { done } = await f.start(); const socket = await f.hello();
  let stopped = false; const stopping = f.supervisor.stop().then(() => { stopped = true; }); await settle();
  assert.equal(stopped, false); release({ waitMs: 0 }); await stopping; await done;
  assert.equal(socket.sent.length, 0); assert.equal(f.pending.size, 0);
});

test('handshake timeout, send flood and reconnect storms have bounded outcomes', async t => {
  const timeout = supervisorFixture(); t.after(() => timeout.supervisor.stop()); await timeout.start();
  await timeout.advance(15_000); assert.equal((await timeout.supervisor.readStatus()).code, 'GATEWAY_HELLO_TIMEOUT');
  const flood = supervisorFixture(); const { done } = await flood.start(); const socket = await flood.hello();
  for (let i = 0; i < 111; i++) socket.receive({ op: 1 });
  assert.equal((await done).phase, 'halted'); assert.equal(socket.sent.length, 110);
  const storm = supervisorFixture(); const run = await storm.start();
  for (let i = 0; i < 10; i++) {
    storm.sockets.at(-1).receive({ op: 7 }); await settle();
    if (i < 9) await storm.advance(Math.min(60_000, 1_000 * 2 ** i) + 250);
  }
  assert.equal((await run.done).code, 'GATEWAY_RETRY_LIMIT'); assert.equal(storm.sockets.length, 10);
  assert.equal(storm.pending.size, 0);
});

test('disconnect drains in-flight commits and resumes behind received but uncommitted dispatches', async t => {
  const f = supervisorFixture(); t.after(() => f.supervisor.stop());
  await f.start(); const socket = await f.hello();
  socket.receive(readyEvent()); socket.receive(guildEvent()); await settle();
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const dispatch = f.journal.dispatch;
  f.journal.dispatch = async (...args) => { if (args[1].sequence === 3) await blocked; return dispatch(...args); };
  socket.receive(gatewayEvent(3, 'IGNORED_EVENT')); await settle();
  socket.receive(gatewayEvent(4, 'IGNORED_EVENT')); socket.serverClose(1006); await settle();
  assert.equal(await f.observer.isCurrent(), false); assert.equal(f.sockets.length, 1);
  release(); await settle(); await f.advance(1_250); const resumed = await f.hello();
  assert.equal(resumed.sent[0].d.seq, 3);
  assert.equal(f.calls.some(call => call.sequence === 4), false);
});

test('shutdown wins over an earlier disconnect while its durable pause is still pending', async () => {
  const f = supervisorFixture(); const { done } = await f.start(); const socket = await f.hello();
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const pause = f.journal.pause; f.journal.pause = async (...args) => { await blocked; return pause(...args); };
  socket.serverClose(1006); await settle();
  const stopping = f.supervisor.stop(); release(); await stopping;
  assert.equal((await done).phase, 'stopped'); assert.equal(f.sockets.length, 1);
  assert.equal(f.pending.size, 0);
});
