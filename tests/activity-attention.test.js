import test from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_MS, createAttention } from '../apps/activity/client/attention.js';
import { createShuttleApi } from '../apps/activity/client/api.js';

const meter = () => { let t = 1_000; const attention = createAttention({ now: () => t }); return { attention, at: ms => { t += ms; } }; };

test('T-ACT-ATT-01 focused time counts only while a stop is read, seen, focused, not picture-in-picture and recently touched', () => {
  // Owner request, 25 October 2026: "only count time when people are actually interacting with / focused on the activity".
  const { attention, at } = meter();
  attention.input(); at(5_000);
  assert.equal(attention.take(), 0, 'nothing before a stop is being read');
  attention.set('reading', true); at(10_000);
  assert.equal(attention.take(), 10_000);
  for (const [key, off, on] of [['visible', false, true], ['focused', false, true], ['pip', true, false]]) {
    attention.input(); attention.set(key, off); at(30_000); attention.set(key, on); at(1_000);
    assert.equal(attention.take(), 1_000, `${key}: only the second after it came back`);
  }
  // Idle: counting stops when the idle window ran out, not when it is noticed.
  attention.input(); at(IDLE_MS + 300_000);
  assert.equal(attention.take(), IDLE_MS);
  at(5_000); attention.input(); at(2_000);
  assert.equal(attention.take(), 2_000, 'the next input starts it again');
  // Input is focus: some frames never report it.
  attention.set('focused', false); attention.input(); at(3_000);
  assert.equal(attention.take(), 3_000);
  // Time from a request core never applied counts towards the next one.
  at(4_000); const taken = attention.take(); attention.restore(taken); at(1_000);
  assert.equal(attention.take(), 5_000);
  attention.set('reading', false); at(60_000); assert.equal(attention.take(), 0);
});

test('T-ACT-ATT-02 Continue carries the stop’s focused time and pages, and a retry sends the same body once', async () => {
  const bodies = []; let failures = 1;
  const api = createShuttleApi({ randomBytes: count => new Uint8Array(count).fill(171), wait: async () => {},
    fetch: async (path, options) => {
      if (path === '/api/session') return new Response(JSON.stringify({ token: 'a'.repeat(64), accessToken: 'x', scopes: ['identify'] }), { status: 200 });
      bodies.push(JSON.parse(options.body));
      if (failures-- > 0) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ run: { stop: 1 } }), { status: 200 });
    } });
  await api.signIn({ code: 'c', instanceId: 'i-1' });
  await api.act('advance', 4, { ms: 12_345, pages: 3 });
  assert.equal(bodies.length, 2); assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0].attention, { ms: 12_345, pages: 3 });
  bodies.length = 0; await api.act('back', 5);
  assert.equal(Object.hasOwn(bodies[0], 'attention'), false);
});
