import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionHttpServer } from '../apps/core/discord/interaction-http.js';
import { syntheticInteractions } from './fixtures/interactions.js';

async function setup(options = {}) {
  const signed = syntheticInteractions();
  const replies = [], faults = [], calls = [];
  const server = createInteractionHttpServer({ verifier: signed.verifier,
    commands: { execute: async command => { calls.push(command); return 'recorded'; } },
    respond: async (envelope, result) => replies.push({ envelope, result }), enabled: () => true,
    onFault: code => faults.push(code), ...options });
  const address = await server.listen();
  const request = (payload = signed.payload(), overrides = {}) => {
    const input = signed.signed(payload);
    return fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': input.signature, 'X-Signature-Timestamp': input.timestamp },
      body: input.body, ...overrides });
  };
  return { server, signed, replies, faults, calls, request, address };
}

test('T01 loopback receiver validates signatures before acknowledging or dispatching', async () => {
  const fixture = await setup();
  try {
    assert.equal(fixture.address.host, '127.0.0.1');
    const ping = await fixture.request(fixture.signed.payload({ type: 1 }));
    assert.deepEqual(await ping.json(), { type: 1 });
    const invalid = await fixture.request(undefined, { body: '{}' });
    assert.equal(invalid.status, 401);
    assert.equal(fixture.calls.length, 0);
    const response = await fixture.request();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { type: 5, data: { flags: 64 } });
    await fixture.server.drain();
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.replies[0].result, 'recorded');
  } finally { await fixture.server.close(); }
});

test('T59 a busy endpoint defers one command promptly and admits no waiting backlog', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const fixture = await setup({ commands: { execute: () => blocked } });
  try {
    const first = await fixture.request();
    assert.equal((await first.json()).type, 5);
    const second = await fixture.request();
    const declined = await second.json();
    assert.equal(declined.type, 4); assert.match(declined.data.content, /busy/);
    assert.deepEqual(declined.data.allowed_mentions, { parse: [] });
    release('recorded'); await fixture.server.drain();
    assert.equal(fixture.replies.length, 1);
  } finally { release('unavailable'); await fixture.server.close(); }
});

test('T01 disabled commands, wrong routes, compressed and oversized bodies have no side effects', async () => {
  const fixture = await setup({ enabled: () => false });
  try {
    assert.match((await (await fixture.request()).json()).data.content, /disabled/);
    assert.equal((await fixture.request(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await fixture.request(undefined, { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } })).status, 415);
    assert.equal((await fixture.request(undefined, { body: Buffer.alloc(262_145) })).status, 413);
    assert.equal((await fetch(`http://${fixture.address.host}:${fixture.address.port}/other`)).status, 404);
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.server.close(); }
});

test('T24 execution and response failures emit stable codes, never the underlying error', async () => {
  const fixture = await setup({ commands: { execute: async () => { throw new Error('synthetic private diagnostic'); } },
    respond: async () => { throw new Error('synthetic response credential'); } });
  try {
    await (await fixture.request()).json(); await fixture.server.drain();
    assert.deepEqual(fixture.faults, ['INTERACTION_EXECUTION_UNAVAILABLE', 'INTERACTION_RESPONSE_UNAVAILABLE']);
  } finally { await fixture.server.close(); }
});
