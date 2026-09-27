import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiScheduler } from '../apps/knowledge-worker/scheduler.js';
import { createLlamaClient } from '../apps/knowledge-worker/llama-client.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function pending() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const request = (id, fields = {}) => ({ id, member: id, receivedAt: Date.now(), deadline: Date.now() + 15000, proactive: false, payload: id, ...fields });

test('SAI AT-13 bounded scheduler rejects duplicate/member flooding and never overlaps inference', async () => {
  const first = pending(), started = [];
  const scheduler = createAiScheduler({ execute: async payload => { started.push(payload); if (payload === 'a') await first.promise; return { kind: 'silent' }; } });
  const a = scheduler.submit(request('a')); await tick();
  assert.deepEqual(await scheduler.submit(request('a')), { state: 'duplicate' });
  assert.deepEqual(await scheduler.submit(request('aa', { member: 'a' })), { state: 'busy' });
  const b = scheduler.submit(request('b')), c = scheduler.submit(request('c')), d = scheduler.submit(request('d'));
  assert.deepEqual(await scheduler.submit(request('e')), { state: 'busy' });
  assert.deepEqual(started, ['a']); first.resolve();
  assert.equal((await a).state, 'completed'); await Promise.all([b, c, d]); await tick();
  assert.deepEqual(started, ['a', 'b', 'c', 'd']); assert.equal(scheduler.status().active, false);
});

test('SAI AT-07/13 disable completes callers promptly but holds an uncooperative worker slot', async () => {
  const held = pending(); let calls = 0;
  const scheduler = createAiScheduler({ execute: async () => { calls++; return held.promise; } });
  const a = scheduler.submit(request('a')); await tick(); const b = scheduler.submit(request('b'));
  scheduler.disable(); assert.equal((await a).state, 'disabled'); assert.equal((await b).state, 'disabled');
  assert.equal(scheduler.status().cancelling, true); assert.throws(() => scheduler.resume(), /AI_WORKER_NOT_STOPPED/);
  assert.equal((await scheduler.submit(request('c'))).state, 'disabled'); assert.equal(calls, 1);
  held.resolve({ kind: 'silent' }); await tick(); scheduler.resume(); assert.equal(scheduler.status().disabled, false);
});

test('SAI AT-13 expired turns reserve delivery time and do not begin inference', async () => {
  const scheduler = createAiScheduler({ execute: async () => assert.fail('expired work must not execute') });
  const now = Date.now(); assert.equal((await scheduler.submit(request('a', { receivedAt: now - 14000, deadline: now + 1000 }))).state, 'expired');
  assert.throws(() => scheduler.submit(request('b', { receivedAt: now, deadline: now + 15001 })), /AI_DEADLINE_INVALID/);
});

test('SAI AT-03 queued input is reauthorized immediately before model ingestion', async () => {
  const held = pending(), started = []; let permitted = true;
  const scheduler = createAiScheduler({ execute: async payload => { started.push(payload); if (payload === 'a') await held.promise; return { kind: 'silent' }; } });
  const first = scheduler.submit(request('a')); await tick();
  const second = scheduler.submit(request('b', { beforeExecute: async () => permitted }));
  permitted = false; held.resolve(); await first;
  assert.equal((await second).state, 'cancelled'); assert.deepEqual(started, ['a']);
});

test('SAI AT-13 active deadline cancels and discards a late result without starting another worker', async () => {
  const held = pending(); let signal;
  const scheduler = createAiScheduler({ deliveryReserveMs: 100, execute: async (_payload, context) => { signal = context.signal; return held.promise; } });
  const now = Date.now(), job = scheduler.submit(request('a', { receivedAt: now, deadline: now + 140 }));
  assert.deepEqual(await job, { state: 'expired' }); assert.equal(signal.aborted, true);
  assert.equal(scheduler.status().active, true); held.resolve('late private output'); await tick(); assert.equal(scheduler.status().active, false);
});

function llamaFixture({ tokens = [1, 2, 3], response = { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"kind":"silent"}', reasoning_content: 'must not deliver' } }] } } = {}) {
  const calls = [];
  const client = createLlamaClient({ endpoint: 'http://127.0.0.1:12345', apiKey: 'synthetic'.repeat(8), modelId: 'reviewed-model',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ path: url.pathname, body, redirect: options.redirect });
      const value = url.pathname === '/apply-template' ? { prompt: 'exact templated prompt' } : url.pathname === '/tokenize' ? { tokens } : response;
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    } });
  const generate = () => client.generate({ messages: [{ role: 'system', content: 'Sophie' }, { role: 'user', content: 'Synthetic hello' }] },
    { signal: new AbortController().signal, deadline: Date.now() + 14000 });
  return { calls, generate };
}

test('SAI AT-12 local adapter counts the runtime template and parses only final structured output', async () => {
  const f = llamaFixture(); assert.deepEqual(await f.generate(), { kind: 'silent' });
  assert.deepEqual(f.calls.map(call => call.path), ['/apply-template', '/tokenize', '/v1/chat/completions']);
  assert.equal(f.calls.at(-1).body.stream, false); assert.equal(f.calls.at(-1).body.cache_prompt, false);
  assert.equal(f.calls.every(call => call.redirect === 'error'), true);
});

test('SAI AT-12 input over budget is refused before generation; truncation/tools/raw fallback are rejected', async () => {
  const large = llamaFixture({ tokens: Array(4000).fill(1) }); await assert.rejects(large.generate(), /AI_CONTEXT_LIMIT/);
  assert.equal(large.calls.length, 2);
  for (const choice of [
    { finish_reason: 'length', message: { role: 'assistant', content: '{"kind":"silent"}' } },
    { finish_reason: 'stop', message: { role: 'assistant', content: '<think>secret</think>hello' } },
    { finish_reason: 'stop', message: { role: 'assistant', content: '{"kind":"silent"}', tool_calls: [{}] } },
  ]) await assert.rejects(llamaFixture({ response: { choices: [choice] } }).generate());
});

test('SAI AT-04 local runtime endpoint cannot become arbitrary egress or credential forwarding', () => {
  for (const endpoint of ['https://api.example.test/', 'https://10.0.0.1.evil.example/', 'https://192.168.1.1.attacker.test/', 'http://10.0.0.1/', 'http://localhost:1234/', 'http://127.0.0.1:1234/other', 'http://user:secret@127.0.0.1/']) {
    assert.throws(() => createLlamaClient({ endpoint, apiKey: 'synthetic'.repeat(8), modelId: 'model' }), /AI_WORKER_ENDPOINT_INVALID/);
  }
});

test('SAI AT-12 over-budget context drops whole old messages and retains the policy and current question', async () => {
  const prompt = buildAiPrompt({ request: { character: DRAFT_PERSONALITY, decision: { outcomes: ['reply','silent'], answerOnly: false }, config: { emojis: [] },
    userId: '1', text: 'Current question must remain complete' }, history: [{ userId: '2', text: 'Old conversation '.repeat(300) }], sources: [] });
  const original = structuredClone(prompt); let finalMessages, attempts = 0, tooLarge;
  const client = createLlamaClient({ endpoint: 'http://127.0.0.1:12345', apiKey: 'synthetic'.repeat(8), modelId: 'reviewed-model',
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      if (url.pathname === '/apply-template') { attempts++; tooLarge = body.messages.some(item => item.content.includes('Old conversation'));
        return Response.json({ prompt: body.messages.map(item => item.content).join('\n') }); }
      if (url.pathname === '/tokenize') return Response.json({ tokens: Array(tooLarge ? 4100 : 1000).fill(1) });
      finalMessages = body.messages; return Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"kind":"silent"}' } }] });
    } });
  assert.deepEqual(await client.generate(prompt,{ signal: new AbortController().signal, deadline: Date.now()+14000 }),{ kind: 'silent' });
  assert.equal(attempts,2); assert.deepEqual(prompt,original);
  assert.deepEqual(finalMessages[0],original.messages[0]); assert.deepEqual(finalMessages.at(-1),original.messages.at(-1));
  assert.equal(finalMessages.some(item => item.content.includes('Old conversation')),false);
  await assert.rejects(client.generate({ ...prompt, trimGroups: [[0]] },{ signal: new AbortController().signal, deadline: Date.now()+14000 }),/AI_PROMPT_INVALID/);
});
