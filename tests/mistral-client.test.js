import test from 'node:test';
import assert from 'node:assert/strict';
import { createMistralClient, mistralUsage, MISTRAL_MODEL } from '../apps/knowledge-worker/mistral-client.js';
import { firstChangedAiBlock,firstChangedAiComparison,validateAiComparison } from '../apps/knowledge-worker/prompt-contract.js';
import { createMeteredAiWorker } from '../apps/core/runtime/ai-provider.js';
import { aiBudgetPeriods, aiUsageCostNanos, DEFAULT_AI_BUDGET } from '../modules/assistant/budget.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';
import { redactAiIdentifiers } from '../apps/knowledge-worker/redaction.js';

const key = 'synthetic-test-key-not-a-secret';
const output = { kind: 'reply', text: 'Hello!', purpose: 'conversation', support: 'current_conversation', citations: [] };
function prompt({ history = [], sources = [], answerOnly = false, outcomes = ['reply','silent'] } = {}) {
  return { ...buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello Sophie',
    decision: { outcomes, answerOnly }, config: { emojis: [{ key: 'celebrate' }] } }, history, sources }),
    workerDomain: 'public', restricted: false, requesterId: '404', releaseHash: 'a'.repeat(64),
    boundary: { guildId: '101', channelId: '202', boundaryEpoch: 1, continuity: 'synthetic-epoch' } };
}
function completion(change = {}) {
  return { model: MISTRAL_MODEL, choices: [{ finish_reason: 'stop',
    message: { role: 'assistant', content: JSON.stringify(output) } }], usage: { prompt_tokens: 100, completion_tokens: 25,
    total_tokens: 125, prompt_tokens_details: { cached_tokens: 64 }, unsafe: 'never report' }, ...change };
}
function fixture({ response = () => new Response('\n \n' + JSON.stringify(completion()), { headers: { 'content-type': 'application/json' } }), ...options } = {}) {
  let now = 1000; const calls = [], usage = [];
  const client = createMistralClient({ apiKey: key, clock: () => now, onUsage: value => usage.push(value),
    acceptedFingerprints: [MISTRAL_MODEL],
    fetchImpl: async (url, init) => { calls.push({ url, ...init, body: JSON.parse(init.body) }); return response(init); }, ...options });
  return { client, calls, usage, time: value => { now = value; }, generate: payload => client.generate(payload ?? prompt(), { signal: new AbortController().signal, deadline: now + 14000 }) };
}

test('SAI AT-04/12 Mistral Small uses the fixed EU provider, reasoning off, JSON mode, private cache partition and redacted usage', async () => {
  const f = fixture(); assert.deepEqual(await f.generate(), output);
  const call = f.calls[0]; assert.equal(call.url, 'https://api.mistral.ai/v1/chat/completions'); assert.equal(call.body.model, 'mistral-small-2603');
  assert.equal(call.redirect, 'error'); assert.equal(call.headers.authorization, `Bearer ${key}`);
  assert.deepEqual(Object.keys(call.body).sort(), ['max_tokens','messages','model','prompt_cache_key','reasoning_effort','response_format','stream','temperature']);
  assert.equal(call.body.reasoning_effort, 'none'); assert.deepEqual(call.body.response_format, { type: 'json_object' });
  assert.equal(call.body.max_tokens, 384); assert.equal(call.body.stream, false); assert.match(call.body.prompt_cache_key, /^[a-f0-9]{64}$/u);
  const wire = JSON.stringify(call.body); for (const forbidden of [key, 'requesterId', 'releaseHash', 'guildId', 'channelId', 'boundaryEpoch']) assert.equal(wire.includes(forbidden), false);
  assert.deepEqual(f.usage, [{ model: MISTRAL_MODEL, fingerprint: null, milliseconds: 0, prompt_tokens: 100,
    completion_tokens: 25, total_tokens: 125, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 }]);
});

test('SAI AT-13 an addressed turn tells the model to reply; the rebuilt schema message keeps the prompt guidance', async () => {
  const addressed = { ...buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello Sophie',
    decision: { outcomes: ['reply','silent'], answerOnly: false, proactive: false }, config: { emojis: [] } }, history: [], sources: [] }),
    workerDomain: 'public', restricted: false, requesterId: '404', releaseHash: 'a'.repeat(64),
    boundary: { guildId: '101', channelId: '202', boundaryEpoch: 1, continuity: 'synthetic-epoch' } };
  const f = fixture(); await f.generate(addressed);
  const schema = f.calls[0].body.messages.at(-2);
  assert.equal(schema.role, 'system'); assert.match(schema.content, /addressed you directly\. Reply/u);
  assert.match(schema.content, /Use support provided_sources only with supporting citations/u); assert.match(schema.content, /"oneOf"/u);
  const ambient = fixture(); await ambient.generate(prompt());
  assert.doesNotMatch(ambient.calls[0].body.messages.at(-2).content, /addressed you directly/u);
});

test('DS-02 unqualified backend policy prevents even the first paid dispatch', async () => {
  // An empty list, a mutable alias or another model never authorizes the pinned model.
  for (const acceptedFingerprints of [[], ['mistral-small-latest'], ['mistral-large-2512']]) {
    const f = fixture({ acceptedFingerprints });
    await assert.rejects(f.generate(), /AI_WORKER_UNAVAILABLE/);
    assert.equal(f.calls.length, 0);
  }
});

test('SAI AT-03 public cache shares only within a channel/authority/release boundary; authored prefix remains stable', async () => {
  const f = fixture(), original = prompt(); await f.generate(original); await f.generate(original);
  assert.equal(f.calls[0].body.prompt_cache_key, f.calls[1].body.prompt_cache_key);
  await f.generate({ ...original, requesterId: '405' }); assert.equal(f.calls[0].body.prompt_cache_key, f.calls.at(-1).body.prompt_cache_key);
  for (const changed of [{ ...original, boundary: { ...original.boundary, channelId: '203' } },
    { ...original, boundary: { ...original.boundary, boundaryEpoch: 2 } }, { ...original, releaseHash: 'b'.repeat(64) }]) {
    await f.generate(changed); assert.notEqual(f.calls[0].body.prompt_cache_key, f.calls.at(-1).body.prompt_cache_key);
  }
  const reactive = prompt({ outcomes: ['react','silent'] });
  assert.deepEqual(original.messages.slice(0, 7), reactive.messages.slice(0, 7));
  assert.notDeepEqual(original.messages[7], reactive.messages[7]);
  const otherWorker = fixture(); await otherWorker.generate(original);
  assert.notEqual(f.calls[0].body.prompt_cache_key, otherWorker.calls[0].body.prompt_cache_key, 'a new worker must not reuse the provider-visible pseudonym');
  assert.equal(f.client.profileHash, otherWorker.client.profileHash, 'the release profile describes the policy, not a private random seed');
});

test('DS-08 direct-identifier redaction covers structured identifiers without claiming free-text anonymity', () => {
  const identifiers = ['<@123456789012345678>', '<@!123456789012345678>', '<@&123456789012345678>', '<#123456789012345678>',
    '<:nickname:123456789012345678>', '<a:nickname:123456789012345678>', '</command:123456789012345678>',
    '123456789012345678', 'alice+test@example.invalid', 'https://example.invalid/people/alice?token=private',
    'www.example.invalid/alice', 'example.invalid/people/alice', '//example.invalid/path', '@alice_handle', '+31 (0)6 1234 5678', '203.0.113.42', '2001:db8::1234',
    '::ffff:192.0.2.1', 'fe80::abcd%eth0', '12345678-abcd-abcd-abcd-123456789abc'];
  for (const identifier of identifiers) {
    const redacted = redactAiIdentifiers(`Before ${identifier} after`);
    assert.equal(redacted.includes(identifier), false, identifier);
    assert.ok(redacted.startsWith('Before ') && redacted.endsWith(' after'), identifier);
    assert.equal(redactAiIdentifiers(redacted), redacted, 'a second egress pass is idempotent');
  }
  assert.equal(redactAiIdentifiers('Alice Smith and @alice_handle', ['Alice Smith']), '[member] and [handle]');
  assert.equal(redactAiIdentifiers('A.*[B] says hi', ['A.*[B]']), '[member] says hi', 'aliases are literal, never executable patterns');
  assert.equal(redactAiIdentifiers('１２３４５６７８９０１２３４５６７８'), '[id]');
  assert.equal(redactAiIdentifiers('alice\u200b@example.invalid'), '[email]');
  const ordinary = 'Use port 443, 12 items, 2026-10-04 at 12:30, 2026-10-04T12:30:00Z and version 1.2.3.';
  assert.equal(redactAiIdentifiers(ordinary), ordinary);
  const indirect = 'I am the only person with this unusual job in my village.';
  assert.equal(redactAiIdentifiers(indirect), indirect, 'redaction cannot establish anonymity of personal facts');
});

test('DS-08 bounded token scanning handles long email and domain nonmatches', { timeout: 1000 }, () => {
  const text = 'a'.repeat(32000);
  for (const suffix of ['', '/profile']) assert.equal(redactAiIdentifiers(text + suffix, ['Alice']), text + suffix);
  for (const suffix of ['@', '@invalid', '.invalid/profile']) assert.equal(redactAiIdentifiers(text + suffix, ['Alice']).includes(text), false);
});

test('DS-08 final provider projection redacts old context, replies, authoring and source text before captured HTTP dispatch', async () => {
  const marker = 'synthetic.member@example.invalid', id = '123456789012345678';
  const payload = prompt({ history: [{ userId: '404', text: `${marker} <@${id}>` }, { kind: 'assistant', text: `Earlier: ${marker}` }],
    sources: [{ id: 'guide.r1.s0', text: `Published text can contain ${marker}.` }] });
  const mutable = structuredClone(payload);
  mutable.messages[0].content += `\nAuthored sample ${marker}`;
  mutable.messages.at(-1).content = `Contact ${marker}, +31 6 1234 5678 or https://example.invalid/people/alice`;
  mutable.requesterId = id; mutable.boundary.guildId = '223456789012345678'; mutable.boundary.channelId = '323456789012345678';
  const f = fixture(); await f.generate(mutable);
  const wire = JSON.stringify(f.calls[0].body);
  for (const value of [marker, id, mutable.boundary.guildId, mutable.boundary.channelId, '+31 6 1234 5678', 'example.invalid/people/alice'])
    assert.equal(wire.includes(value), false, value);
  assert.ok(wire.includes('[email]') && wire.includes('[phone]') && wire.includes('[link]'));
  assert.ok(mutable.messages[0].content.includes(marker), 'sanitization never mutates the source publication');
  assert.equal(JSON.stringify(f.usage).includes(marker), false);
});

test('DS-08 identifier-bearing citation and emoji keys fail before a provider request', async () => {
  const f = fixture(), id = '123456789012345678';
  await assert.rejects(f.generate(prompt({ sources: [{ id, text: 'Synthetic public source' }] })), /AI_REMOTE_IDENTIFIER_REJECTED/);
  const payload = structuredClone(prompt()); payload.outputContract.emojiKeys = [id];
  await assert.rejects(f.generate(payload), /AI_REMOTE_IDENTIFIER_REJECTED/);
  assert.equal(f.calls.length, 0);
});

test('SAI AT-03/12 cache layout stabilizes reviewed source order before history without changing relevance-based trimming', () => {
  const a = { id: 'a.r1.s0', text: 'Alpha source' }, z = { id: 'z.r1.s0', text: 'Zeta source' };
  const first = prompt({ sources: [z,a], history: [{ userId: '404', text: 'A changing conversation' }] });
  const second = prompt({ sources: [a,z], history: [{ userId: '405', text: 'A different conversation' }] });
  assert.deepEqual(first.messages.slice(0, 9), second.messages.slice(0, 9));
  assert.deepEqual(first.sourceMessages.map(source => source.id), ['a.r1.s0','z.r1.s0']);
  const aIndex = first.sourceMessages.find(source => source.id === a.id).index;
  const zIndex = first.sourceMessages.find(source => source.id === z.id).index;
  assert.deepEqual(first.trimGroups.slice(-2), [[aIndex],[zIndex]]);
  assert.equal(first.contractMessageIndex, first.messages.length - 2);
});

test('SAI AT-02/04 remote adapter rejects unapproved/private lanes and malformed prompt metadata before network use', async () => {
  const f = fixture(), original = prompt();
  for (const changed of [{ ...original, restricted: true }, { ...original, restricted: undefined }, { ...original, workerDomain: 'staff' },
    { ...original, requesterId: undefined }, { ...original, boundary: undefined }, { ...original, sourceMessages: [{ id: 'x', index: 2 }] }]) {
    await assert.rejects(f.generate(changed));
  }
  assert.equal(f.calls.length, 0);
});

test('SAI AT-12 JSON mode is independently validated; empty, truncated, tool, reasoning and invented-source outputs are rejected', async () => {
  for (const changed of [
    { finish_reason: 'length', message: { role: 'assistant', content: JSON.stringify(output) } },
    ...['', 'not JSON', JSON.stringify({ ...output, citations: ['invented'], support: 'provided_sources' }),
      JSON.stringify({ kind: 'react', emojiKey: 'not-approved' }), JSON.stringify({ ...output, extra: 'denied' })].map(content => ({ finish_reason: 'stop', message: { role: 'assistant', content } })),
    { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output), tool_calls: [{}] } },
    { finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output), reasoning_content: 'private reasoning' } },
  ]) {
    const f = fixture({ response: () => Response.json(completion({ choices: [changed] })) });
    await assert.rejects(f.generate(), /^Error: AI_WORKER_UNAVAILABLE$/u); assert.equal(f.calls.length, 1);
  }
  await assert.rejects(fixture().generate(prompt({ outcomes: ['react','silent'] })), /AI_WORKER_UNAVAILABLE/u);
});

test('SAI AT-12 byte budget removes whole optional evidence and its citation choices, preserving mandatory policy/question', async () => {
  const source = { id: 'guide.r1.s0', text: 'Synthetic evidence '.repeat(210) };
  const payload = prompt({ sources: [source] });
  const f = fixture({ maxPromptBytes: 5632, response: () => Response.json(completion({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"kind":"silent"}' } }] })) });
  assert.deepEqual(await f.generate(payload), { kind: 'silent' });
  const sent = f.calls[0].body.messages;
  assert.deepEqual(sent[0], payload.messages[0]); assert.deepEqual(sent.at(-1), payload.messages.at(-1));
  assert.equal(sent.some(message => message.content.includes('Synthetic evidence')), false);
  const schema = JSON.parse(sent.at(-2).content.split('\n').at(-1));
  assert.equal(schema.oneOf.some(branch => branch.properties.support?.const === 'provided_sources'), false);
  const mandatory = structuredClone(payload); mandatory.messages[0].content = '🦊'.repeat(5000);
  const tooLarge = fixture({ maxPromptBytes: 4096 }); await assert.rejects(tooLarge.generate(mandatory), /AI_CONTEXT_LIMIT/u);
  assert.equal(tooLarge.calls.length, 0);
});

test('SAI AT-12 silence-only and unsupported proactive turns do not spend an API request', async () => {
  const f = fixture();
  assert.deepEqual(await f.generate(prompt({ answerOnly: true })), { kind: 'silent' });
  assert.deepEqual(await f.generate(prompt({ outcomes: ['silent'] })), { kind: 'silent' });
  assert.equal(f.calls.length, 0); assert.equal(f.usage.length, 0);
  const wrongModel = fixture({ response: () => Response.json(completion({ model: 'unselected-model' })) });
  await assert.rejects(wrongModel.generate(), /AI_WORKER_UNAVAILABLE/u);
});

test('SAI AT-13 rate limits cool down without retries and credential failures remain blocked', async () => {
  const limited = fixture({ response: () => new Response('do not expose provider details', { status: 429, headers: { 'retry-after': '60' } }) });
  await assert.rejects(limited.generate(), /AI_WORKER_UNAVAILABLE/u); await assert.rejects(limited.generate(), /AI_WORKER_UNAVAILABLE/u);
  assert.equal(limited.calls.length, 1); assert.equal(limited.client.status().cooldownUntil, 61000);
  limited.time(61001); await assert.rejects(limited.generate()); assert.equal(limited.calls.length, 2);
  for (const status of [401,402,403]) {
    const failed = fixture({ response: () => new Response('private error', { status }) });
    await assert.rejects(failed.generate()); failed.time(500000); await assert.rejects(failed.generate());
    assert.equal(failed.calls.length, 1); assert.equal(failed.client.status().credentialBlocked, true);
  }
});

test('SAI AT-13 external abort cancels the HTTP call; deadline/size failures cannot return a late result', async () => {
  const controller = new AbortController(); let started;
  const began = new Promise(resolve => { started = resolve; });
  const client = createMistralClient({ apiKey: key, acceptedFingerprints: [MISTRAL_MODEL], fetchImpl: async (_url, { signal }) => {
    started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('secret transport detail')), { once: true }));
  } });
  // Two requests may be in flight; a third is refused rather than queued.
  const job = client.generate(prompt(), { signal: controller.signal, deadline: Date.now() + 14000 });
  const second = client.generate(prompt(), { signal: controller.signal, deadline: Date.now() + 14000 });
  await began; await assert.rejects(client.generate(prompt(), { signal: new AbortController().signal, deadline: Date.now() + 14000 }), /AI_WORKER_UNAVAILABLE/u);
  controller.abort(); await assert.rejects(job, /^Error: AI_DEADLINE_EXPIRED$/u); await assert.rejects(second, /^Error: AI_DEADLINE_EXPIRED$/u);
  assert.equal(client.status().active, 0);
  // A cancelled request is not a provider failure: the next request is not paused.
  assert.equal(client.status().cooldownUntil <= Date.now(), true);
  const late = fixture({ response: () => { late.time(15001); return Response.json(completion()); } });
  await assert.rejects(late.generate(), /AI_DEADLINE_EXPIRED/u);
  const large = fixture({ response: () => new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }) });
  await assert.rejects(large.generate(), /AI_WORKER_UNAVAILABLE/u);
});

test('DS-02 preparation freezes the full outbound request and exposes only safe block diagnostics', async () => {
  const f = fixture({ maxPromptBytes: 5632 }), payload = prompt(), first = f.client.prepare(payload), second = f.client.prepare(payload);
  assert.equal(first.serialized, second.serialized);
  assert.equal(first.bytes, Buffer.byteLength(first.serialized)); assert.ok(first.bytes <= 5632);
  assert.throws(() => { first.body.messages[0].content = 'tampered'; }, TypeError);
  assert.throws(() => first.contract.sourceIds.push('invented'), TypeError);
  assert.equal(firstChangedAiBlock(first, second), null);
  assert.equal(firstChangedAiComparison(first.comparison,second.comparison),null);
  assert.deepEqual(validateAiComparison(first.comparison),first.comparison);
  assert.throws(()=>validateAiComparison({...first.comparison,text:'unexpected conversation archive'}),/AI_DIAGNOSTICS_INVALID/);
  assert.throws(()=>validateAiComparison({...first.comparison,blocks:[{kind:'question',digest:'not a keyed fingerprint',bytes:20}]}),/AI_DIAGNOSTICS_INVALID/);
  assert.notDeepEqual(fixture().client.prepare(payload).comparison.blocks,first.comparison.blocks,'worker boots must not share guessable comparison fingerprints');
  const changed = structuredClone(payload); changed.messages.at(-1).content = 'Different synthetic question';
  assert.equal(firstChangedAiBlock(first, f.client.prepare(changed)), 'question');
  assert.equal(firstChangedAiComparison(first.comparison,f.client.prepare(changed).comparison),'question');
  assert.equal(JSON.stringify(first.diagnostics).includes('Hello Sophie'), false);
  assert.equal(JSON.stringify(first.body).includes('diagnostics'), false);
  for(const block of first.comparison.blocks)assert.equal(first.serialized.includes(block.digest),false);
  await f.client.generatePrepared(first, { signal: new AbortController().signal, deadline: 15000 });
  assert.equal(JSON.stringify(f.calls[0].body), first.serialized);
  await assert.rejects(f.client.generatePrepared(first, { signal: new AbortController().signal, deadline: 15000 }), /AI_PREPARATION_UNTRUSTED/);
});

test('DS-02 current permission loss after preparation or dispatch intent prevents network handoff', async () => {
  for (const revokeAfterIntent of [false, true]) {
    const f = fixture(); let allowed = revokeAfterIntent, intents = 0;
    await assert.rejects(f.client.generatePrepared(f.client.prepare(prompt()), { signal: new AbortController().signal, deadline: 15000,
      beforeDispatch: async () => allowed, recordDispatch: async () => { intents++; allowed = false; return true; } }));
    assert.equal(f.calls.length, 0); assert.equal(intents, revokeAfterIntent ? 1 : 0);
  }
});

test('DS-03 rejected and late output still reports valid paid usage before acceptance', async () => {
  for (const invalid of ['not JSON', JSON.stringify({ kind: 'tool' })]) {
    const receipts = [], f = fixture({ response: () => Response.json(completion({ choices: [{ finish_reason: 'length', message: { role: 'assistant', content: invalid } }] })) });
    await assert.rejects(f.client.generatePrepared(f.client.prepare(prompt()), { signal: new AbortController().signal, deadline: 15000,
      recordResponse: async receipt => receipts.push(receipt) }));
    assert.equal(receipts.length, 1); assert.equal(receipts[0].usage.total_tokens, 125); assert.equal(f.usage.length, 1);
  }
  const receipts = [], late = fixture({ response: () => { late.time(15001); return Response.json(completion()); } });
  await assert.rejects(late.client.generatePrepared(late.client.prepare(prompt()), { signal: new AbortController().signal, deadline: 15000,
    recordResponse: async receipt => receipts.push(receipt) }));
  assert.equal(receipts[0].usage.total_tokens, 125);
});

test('DS-03 missing, inconsistent and malformed usage remains unknown rather than a cheap success', () => {
  const valid = completion().usage;
  for (const changed of [undefined, {}, { ...valid, total_tokens: 1 },
    { ...valid, completion_tokens: -1 }, { ...valid, prompt_tokens: '100' }, { ...valid, completion_tokens: 0.5 }]) assert.equal(mistralUsage(changed), null);
  assert.deepEqual(mistralUsage(valid), { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125, prompt_cache_hit_tokens: 64, prompt_cache_miss_tokens: 36 });
  // An absent, malformed or impossible cached counter is charged as uncached input, never as a discount.
  for (const details of [undefined, null, {}, { cached_tokens: 101 }, { cached_tokens: -1 }, { cached_tokens: 6.5 }, { cached_tokens: '64' }]) {
    const usage = mistralUsage({ ...valid, prompt_tokens_details: details });
    assert.equal(usage.prompt_cache_hit_tokens, 0); assert.equal(usage.prompt_cache_miss_tokens, 100);
  }
  assert.equal(mistralUsage({ ...valid, prompt_cache_hit_tokens: 100 }).prompt_cache_hit_tokens, 64, 'another provider\'s counter names are ignored');
});

test('DS-10 an unpinned returned model holds subsequent calls while preserving its spending receipt', async () => {
  const f = fixture({ response: () => Response.json(completion({ model: 'mistral-small-latest' })) });
  await assert.rejects(f.generate()); assert.equal(f.usage.length, 1); assert.equal(f.client.status().identityBlocked, true);
  f.time(100000); await assert.rejects(f.generate()); assert.equal(f.calls.length, 1);
});

test('DS-03 metered dispatch settles rejected output and releases only positively undispatched work', async () => {
  for (const revoked of [false,true]) {
    const f=fixture({response:()=>Response.json(completion({choices:[{finish_reason:'length',message:{role:'assistant',content:'incomplete'}}]}))});
    const events=[]; let permitted=true;
    const accounting={ reserve:async input=>{events.push(['reserve',input.bytes]);return {messageId:'303'};},
      dispatch:async()=>{events.push(['dispatch']);if(revoked)permitted=false;return true;},
      settle:async(_token,usage)=>{events.push(['settle',usage.total_tokens]);return true;},
      finish:async(_token,possible)=>events.push(['finish',possible]) };
    const worker=createMeteredAiWorker({worker:{...f.client,current:async()=>true},accounting});
    await assert.rejects(worker.generate({...prompt(),local:{messageId:'303'}},{signal:new AbortController().signal,deadline:15000,beforeDispatch:async()=>permitted}));
    assert.deepEqual(events.map(item=>item[0]),revoked?['reserve','dispatch','finish']:['reserve','dispatch','settle','finish']);
    assert.equal(events.at(-1)[1],!revoked); assert.equal(f.calls.length,revoked?0:1);
  }
});

test('DS-03 Vienna month boundaries and daylight-saving rollover use the named calendar', () => {
  assert.deepEqual(aiBudgetPeriods(Date.parse('2026-03-31T21:59:59Z')),{month:'2026-03',day:'2026-03-31'});
  assert.deepEqual(aiBudgetPeriods(Date.parse('2026-03-31T22:00:00Z')),{month:'2026-04',day:'2026-04-01'});
  assert.deepEqual(aiBudgetPeriods(Date.parse('2026-10-25T00:30:00Z')),aiBudgetPeriods(Date.parse('2026-10-25T01:30:00Z')));
  assert.equal(aiUsageCostNanos(mistralUsage(completion().usage),DEFAULT_AI_BUDGET),21360n);
  assert.equal(aiUsageCostNanos({...mistralUsage(completion().usage),total_tokens:0},DEFAULT_AI_BUDGET),null);
});

test('evidence names its heading, so a passage can be matched to the rule it is', () => {
  const value = prompt({ sources: [{ id: 'wiki-policies.r3.s6', title: 'Policies', heading: 'Policies › Core Rules › CR 1: The Social Contract CR-01 (Core Rule 1)',
    authority: 'policy', sourceRevision: 'wiki:page:878:r1:f3', text: 'Act with the maturity expected in an adult community.' }] });
  const evidence = value.messages.find(message => message.content.startsWith('Approved evidence'));
  assert.match(JSON.parse(evidence.content.slice(evidence.content.indexOf('\n') + 1)).heading, /CR 1: The Social Contract/u);
});

test('MEM-09 a turn that may remember returns Sophie\'s memories from the worker; one that may not rejects them', async () => {
  const remembering = { ...output, memories: [{ scope: 'member', about: ['Member 1'], text: 'Member 1 likes moths' }] };
  const respond = () => new Response(JSON.stringify(completion({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(remembering) } }] })),
    { headers: { 'content-type': 'application/json' } });
  const payload = { ...prompt(), ...buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello Sophie',
    decision: { outcomes: ['reply', 'silent'], answerOnly: false }, config: { emojis: [] } }, history: [], sources: [], memories: [] }) };
  const f = fixture({ response: respond });
  assert.deepEqual((await f.generate(payload)).memories, remembering.memories);
  assert.match(JSON.stringify(f.calls[0].body.messages), /memories/u);
  await assert.rejects(fixture({ response: respond }).generate(), /AI_WORKER_UNAVAILABLE/);
});
