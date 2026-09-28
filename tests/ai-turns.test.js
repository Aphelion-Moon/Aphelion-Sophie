import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiIngress } from '../apps/core/discord/ai-ingress.js';
import { createAiTurns } from '../apps/core/discord/ai-turns.js';
import { createAiContext } from '../apps/knowledge-worker/context.js';
import { defaultParticipation } from '../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { renderAiReply } from '../modules/assistant/output.js';
import { createAiControlsHttp } from '../apps/core/http/ai-controls.js';
import { createAiKnowledgeHttp } from '../apps/core/http/ai-knowledge.js';
import { createAiMessages } from '../apps/core/discord/ai-messages.js';
import { createDashboardApi } from '../apps/dashboard/api.js';
import { createKnowledgeLookupHttp } from '../apps/core/http/knowledge-lookup.js';

function packet(change = {}) { return { t: 'MESSAGE_CREATE', d: { guild_id: '101', channel_id: '202', id: '303', author: { id: '404', bot: false }, type: 0, content: 'Synthetic hello', mentions: [], ...change } }; }
test('SAI AT-02 ingress metadata never touches message content before trusted admission', () => {
  const ingress = createAiIngress({ guildId: '101', botUserId: '505', clock: () => 1000 });
  const raw = packet(); Object.defineProperty(raw.d, 'content', { get() { assert.fail('excluded sentinel must not be read'); } });
  const proof = ingress.prepare(raw); assert.equal(ingress.inspect(proof).channelId, '202'); ingress.discard(proof);
  assert.throws(() => ingress.content(proof), /AI_EVENT_UNTRUSTED/);
  assert.equal(ingress.prepare(packet({ author: { id: '404', bot: true } })), null);
  assert.throws(() => ingress.inspect({}), /AI_EVENT_UNTRUSTED/);
});

test('SAI AT-02 forwards, attachments and cross-channel replies cannot expand model context', () => {
  const ingress = createAiIngress({ guildId: '101', botUserId: '505', clock: () => 1000 });
  for (const change of [{ message_snapshots: [{}] }, { attachments: [{}] }, { message_reference: { channel_id: '999' } },
    { content: 'https://discord.com/channels/101/999/888' }]) assert.equal(ingress.content(ingress.prepare(packet(change))), null);
  const embedded = { author: { id: '505' } }; Object.defineProperty(embedded, 'content', { get() { assert.fail('quoted text must not be read'); } });
  assert.equal(ingress.content(ingress.prepare(packet({ type: 19, message_reference: { channel_id: '202' }, referenced_message: embedded }))).addressed, true);
});

const request = (fields = {}) => ({ guildId: '101', channelId: '202', userId: '404', messageId: '303', receivedAt: 1000, deadline: 16000,
  text: 'Synthetic hello', inputRevision: 'original', profile: defaultParticipation('conversational'),
  config: { emojis: [] }, character: structuredClone(DRAFT_PERSONALITY),
  binding: { boundaryEpoch: 1, workerDomain: 'public', releaseHash: 'a'.repeat(64), consentEpoch: 1 },
  decision: { context: true, infer: true, outcomes: ['reply', 'silent'], proactive: true, answerOnly: false }, ...fields });

test('SAI AT-03 context is channel/domain-bound, reauthorized per source and removed after opt-out', async () => {
  let now = 1000; const context = createAiContext({ clock: () => now }), first = request();
  context.remember(first);
  const second = request({ messageId: '304' });
  assert.equal((await context.history(second, async () => true)).length, 1);
  assert.equal((await context.history({ ...second, channelId: '999' }, async () => true)).length, 0);
  assert.equal((await context.history({ ...second, binding: { ...second.binding, workerDomain: 'head' } }, async () => true)).length, 0);
  assert.equal((await context.history(second, async () => false)).length, 0);
  context.remember(first); context.invalidate({ userId: first.userId }); assert.equal(context.status().messages, 0);
  context.remember(first); now = 400000; assert.equal(context.status().messages, 0);
});

test('DS-08 confirmed assistant history inherits earliest source expiry through repeated replies', async () => {
  let now = 1000; const context = createAiContext({ clock: () => now }), first = request();
  context.remember(first);
  now = 200000;
  const second = request({ messageId: '304', receivedAt: now, deadline: now + 15000 });
  const history = await context.history(second, async () => true); context.remember(second);
  context.rememberReply(second, { id: '605', text: 'Earlier reply' }, history, []);
  now = 250000;
  const third = request({ messageId: '305', receivedAt: now, deadline: now + 15000 });
  const next = await context.history(third, source => context.current(source, async () => true, async () => true));
  assert.equal(next.find(source => source.kind === 'assistant').expiresAt, 301000);
  context.remember(third); context.rememberReply(third, { id: '606', text: 'Later paraphrase' }, next, []);
  now = 301001;
  const retained = await context.history(request({ messageId: '306' }), async () => true);
  assert.equal(retained.some(source => source.kind === 'assistant'), false);
  assert.equal(retained.some(source => source.messageId === '304'), true);
});

test('DS-08 withdrawal, consent loss and source edits invalidate derived replies without reading excluded content', async () => {
  const context = createAiContext({ clock: () => 2000 }), first = request(), second = request({ messageId: '304', userId: '405' });
  context.remember(first);
  const history = await context.history(second, async () => true);
  context.rememberReply(second, { id: '605', text: 'A source-backed reply' }, history, [{ id: 'guide.r1.s0', text: 'Synthetic public evidence' }]);
  const reply = (await context.history(request({ messageId: '306' }), async () => true)).find(item => item.kind === 'assistant');
  assert.equal(await context.current(reply, async () => true, async () => false), false);
  assert.equal(await context.current(reply, async item => item.userId !== '404', async () => true), false);
  context.invalidate({ messageId: '605' });
  assert.equal(await context.current(reply, async () => true, async () => true), false);
  context.invalidate({ messageId: '303' }); assert.equal(context.status().messages, 0);
});

test('DS-08 assistant replies share the twelve-item capacity and zero-context returns no old records', async () => {
  const context = createAiContext({ clock: () => 2000 });
  for (let index = 0; index < 12; index++) context.remember(request({ messageId: String(700 + index) }));
  const last = request({ messageId: '711' });
  context.rememberReply(last, { id: '800', text: 'Confirmed reply' }, [], []);
  assert.equal(context.status().messages, 12);
  assert.equal((await context.history(request({ messageId: '999' }), async () => true)).at(-1).kind, 'assistant');
  assert.deepEqual(await context.history(request({ profile: { ...last.profile, contextMessages: 0 } }), async () => true), []);
  context.clear(); assert.equal(context.status().messages, 0);
});

function turnsFixture() {
  let now = 1000, eligible = true; const sent = [], states = [], modelCalls = [];
  const value = request(), output = { kind: 'reply', text: 'Hello!', purpose: 'conversation', support: 'current_conversation', citations: [] };
  const admission = { admit: async () => value, revalidate: async () => eligible, revalidateSource: async () => eligible,
    beginDelivery: async () => eligible, settle: async (_request, state) => states.push(state) };
  const scheduler = { submit: async input => { modelCalls.push(input); return { state: 'completed', result: output }; }, cancel() {}, disable() {} };
  const knowledge = { lookup: async () => [], current: async () => true };
  const messages = { reply: async (req, payload) => { sent.push({ req, payload }); return { id: '606' }; }, react: async () => assert.fail('no permitted reaction'), remove: async () => sent.push('removed') };
  const turns = createAiTurns({ admission, scheduler, context: createAiContext({ clock: () => now }), knowledge, messages, clock: () => now });
  return { turns, scheduler, admission, knowledge, messages, value, output, sent, states, modelCalls, time: at => { now = at; }, revoke: () => { eligible = false; } };
}

test('SAI AT-12 one turn delivers one validated reply to the fixed destination', async () => {
  const f = turnsFixture(); assert.deepEqual(await f.turns.handle({}), { state: 'delivered' });
  assert.equal(f.modelCalls.length, 1); assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].req.channelId, '202'); assert.equal(f.sent[0].req.deadline, 16000);
  assert.deepEqual(f.sent[0].payload.allowed_mentions.parse, []); assert.deepEqual(f.states, ['delivered']);
});

test('DS-06 three compatible fragments freeze into one request with the first deadline and all dependencies', async () => {
  const f=turnsFixture(),parts=[0,1,2].map(index=>request({messageId:String(303+index),text:`fragment ${index}`,receivedAt:1000+index,
    gather:{rootId:'303',owner:'synthetic',until:2500,quietUntil:1000}}));
  let next=0,freezes=0,dependencies;
  f.admission.admit=async()=>parts[next++];
  f.admission.freezeGather=async(root,fragments)=>{freezes++;assert.equal(root.messageId,'303');assert.equal(fragments.length,3);return true;};
  f.messages.reply=async(_request,_payload,history)=>{dependencies=history;return {id:'606'};};
  const result=await Promise.all([f.turns.handle({}),f.turns.handle({}),f.turns.handle({})]);
  assert.equal(result.filter(item=>item.state==='delivered').length,1);assert.equal(result.filter(item=>item.state==='gathered').length,2);
  assert.equal(freezes,1);assert.equal(f.modelCalls.length,1);assert.equal(f.modelCalls[0].deadline,16000);
  const content=f.modelCalls[0].payload.messages.at(-1).content;
  for(let index=0;index<3;index++)assert.equal(content.includes(`fragment ${index}`),true);
  assert.deepEqual(dependencies.map(item=>item.messageId),['304','305']);await f.turns.stop();
});

test('DS-06 an edited gathering source cancels before generation without renewing its deadline', async () => {
  const f=turnsFixture();f.value.gather={rootId:'303',owner:'synthetic',until:2500,quietUntil:1750};
  f.admission.freezeGather=async()=>assert.fail('cancelled batch must not freeze');
  const work=f.turns.handle({});await new Promise(resolve=>setImmediate(resolve));
  f.turns.invalidate({channelId:'202',messageId:'303'});assert.equal((await work).state,'cancelled');assert.equal(f.modelCalls.length,0);
});

test('DS-06 a committed eligible edit replaces its fragment once without moving the root deadline', async () => {
  const f=turnsFixture();f.value.gather={rootId:'303',owner:'synthetic',until:2500,quietUntil:1750};
  f.admission.replaceGather=async(_proof,prior)=>({...prior,text:'Corrected fragment',inputRevision:'edited',gather:{...prior.gather,quietUntil:1000}});
  f.admission.freezeGather=async(root,parts)=>{assert.equal(root.inputRevision,'edited');assert.equal(parts[0].text,'Corrected fragment');return true;};
  const work=f.turns.handle({});await new Promise(resolve=>setImmediate(resolve));
  const filter={channelId:'202',messageId:'303'};assert.equal(f.turns.prepareEdit(filter),true);
  assert.deepEqual(await f.turns.edit({},filter),{state:'gathered'});
  assert.equal((await work).state,'delivered');assert.equal(f.modelCalls.length,1);assert.equal(f.modelCalls[0].deadline,16000);
  assert.match(f.modelCalls[0].payload.messages.at(-1).content,/Corrected fragment/);
  assert.doesNotMatch(f.modelCalls[0].payload.messages.at(-1).content,/Synthetic hello/);await f.turns.stop();
});

test('DS-06 overlapping edits or an edit after freeze cannot launch replacement inference', async()=>{
  const f=turnsFixture();f.value.gather={rootId:'303',owner:'synthetic',until:2500,quietUntil:1750};
  f.admission.freezeGather=async()=>assert.fail('ambiguous revision must not freeze');
  const work=f.turns.handle({});await new Promise(resolve=>setImmediate(resolve));
  const filter={channelId:'202',messageId:'303'};assert.equal(f.turns.prepareEdit(filter),true);assert.equal(f.turns.prepareEdit(filter),false);
  assert.equal((await work).state,'cancelled');assert.equal(f.modelCalls.length,0);assert.equal(f.turns.prepareEdit(filter),false);
});

test('SAI AT-03/13 revocation or expired retrieval prevents model admission and late generated replies', async () => {
  const staleRetrieval = turnsFixture(); staleRetrieval.knowledge.lookup = async () => { staleRetrieval.time(16000); return []; };
  await staleRetrieval.turns.handle({}); assert.equal(staleRetrieval.modelCalls.length, 0); assert.equal(staleRetrieval.sent.length, 0);
  const late = turnsFixture(); late.scheduler.submit = async () => { late.time(16000); return { state: 'completed', result: late.output }; };
  await late.turns.handle({}); assert.equal(late.sent.length, 0);
  const revoked = turnsFixture(); revoked.scheduler.submit = async () => { revoked.revoke(); return { state: 'completed', result: revoked.output }; };
  await revoked.turns.handle({}); assert.equal(revoked.sent.length, 0);
});

test('SAI AT-13 uncertain sends are parked and never retried; late effects receive exact compensation', async () => {
  const uncertain = turnsFixture(); let attempts = 0; uncertain.messages.reply = async () => { attempts++; throw Error('network'); };
  assert.deepEqual(await uncertain.turns.handle({}), { state: 'uncertain' }); assert.equal(attempts, 1);
  const late = turnsFixture(); late.messages.reply = async () => { late.time(16001); return { id: '606' }; };
  assert.deepEqual(await late.turns.handle({}), { state: 'cancelled' }); assert.deepEqual(late.sent, ['removed']);
});

test('DS-08/09 source invalidation cancels dependent active work and settlement races compensate known effects', async () => {
  const f = turnsFixture(), cancelled = [];
  f.scheduler.cancel = id => cancelled.push(id);
  let finish;
  f.scheduler.submit = () => new Promise(resolve => { finish = resolve; });
  const task = f.turns.handle({});
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  f.turns.invalidate({ channelId: '202', messageId: '999' });
  assert.deepEqual(cancelled, ['303']);
  finish({ state: 'cancelled' }); await task;
  const race = turnsFixture();
  race.admission.settle = async () => { race.revoke(); };
  assert.deepEqual(await race.turns.handle({}), { state: 'cancelled' });
  assert.equal(race.sent.at(-1), 'removed');
  const unavailable = turnsFixture();
  unavailable.admission.settle = async () => { unavailable.knowledge.current = async () => { throw Error('authority unavailable'); }; };
  assert.deepEqual(await unavailable.turns.handle({}), { state: 'cancelled' });
  assert.equal(unavailable.sent.at(-1), 'removed');
});

test('DS-08 a delivered derivative expires with its knowledge source', async () => {
  let now = 1000; const context = createAiContext({ clock: () => now }), source = request();
  context.remember(source);
  context.rememberReply(source, { id: '606', text: 'Confirmed answer' }, [], [{ id: 'guide.r1.s0', validUntil: 1500 }]);
  now = 1500;
  assert.equal((await context.history(request({ messageId: '307' }), async () => true)).some(item => item.kind === 'assistant'), false);
});

test('DS-08 idle context schedules eviction at its earliest expiry and clears its timer on stop', () => {
  let now = 1000, next, cleared = 0;
  const context = createAiContext({ clock: () => now, setTimer: (callback, delay) => { next = { callback, delay }; return next; }, clearTimer: value => { if (value) cleared++; } });
  const source = request(); context.remember(source);
  assert.equal(next.delay, 300000);
  context.rememberReply(source, { id: '606', text: 'Confirmed' }, [], [{ id: 'guide.r1.s0', validUntil: 2000 }]);
  assert.equal(next.delay, 1000);
  now = 2000; next.callback(); assert.equal(next.delay, 299000);
  now = 301000; next.callback(); assert.equal(context.status().messages, 0);
  context.clear(); assert.ok(cleared >= 3);
});

test('SAI AT-12/13 transport fixes destination/nonce, refuses unsafe mentions and stops expired sends', async () => {
  let now = 1000; const calls = [];
  const transport = createDiscordTransport({ guildId: '101', token: 'synthetic-test-token-not-a-secret', clock: () => now, enabled: async () => true,
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ id: '606', author: { id: '505' } }), { status: 200 }); } });
  const payload = renderAiReply({ kind: 'reply', text: 'Hello @everyone', purpose: 'conversation', support: 'general_knowledge', citations: [] }, []);
  await transport.createAiMessage('202', '303', payload, 16000);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://discord.com/api/v10/channels/202/messages');
  assert.deepEqual(sent.message_reference, { message_id: '303', channel_id: '202', fail_if_not_exists: true });
  assert.equal(sent.enforce_nonce, true); assert.equal(sent.nonce, '303'); assert.deepEqual(sent.allowed_mentions.parse, []);
  await assert.rejects(transport.createAiMessage('202', '303', { ...payload, allowed_mentions: { parse: ['everyone'] } }, 16000));
  now = 16000; await assert.rejects(transport.createAiMessage('202', '303', payload, 16000), /AI_DEADLINE_EXPIRED/);
  assert.equal(calls.length, 1);
});

test('SAI AT-06 control HTTP binds mutations to the authenticated actor and rejects extra authority fields', async () => {
  const calls = [], actor = { userId: '123', guildId: '101' }, proof = {};
  const http = createAiControlsHttp({ auth: { authenticate: async input => { calls.push(input); return { proof }; }, resolvePrincipal: async received => assert.equal(received, proof) },
    authorization: { resolveActor: async received => { assert.equal(received, proof); return actor; } }, controls: { disable: async input => { assert.equal(input.actor, actor); return { disabled: true }; } } });
  const request = { path: '/api/ai/disable', method: 'POST', query: new URLSearchParams(), body: {}, credentials: { csrfToken: 'synthetic' } };
  assert.equal((await http.execute(request)).disabled, true); assert.equal(calls[0].method, 'POST');
  await assert.rejects(http.execute({ ...request, body: { actor: { userId: '999' } } }), /AI_INPUT_INVALID/);
  assert.equal(calls.length, 1);
});

test('SAI AT-07 dashboard session preserves explicit AI access flags and denies malformed flags', async () => {
  const session = { userId: '123', guildId: '101', csrfToken: 'a'.repeat(64), canEditOnboarding: false, canEditForms: false,
    canControlAi: true, canEditPersonality: false, aiAvailable: true };
  const api = createDashboardApi({ document: null, fetch: async () => new Response(JSON.stringify(session)) });
  assert.equal((await api.session()).canControlAi, true); assert.equal((await api.session()).canEditPersonality, false);
  session.aiAvailable = 'yes'; await assert.rejects(api.session(), /unavailable/);
});

test('SAI AT-07/19 typing is brief, fixed to an admitted addressed turn and cannot survive revocation', async () => {
  let eligible = true; const calls = [];
  const messages = createAiMessages({ botUserId: '505', clock: () => 1000, revalidate: async () => eligible, canReact: async () => false,
    effects: Object.fromEntries(['claim','begin','note','cleanup','removed'].map(name => [name, async () => assert.fail('typing must not claim a social effect')])),
    transport: { indicateAiTyping: async (...values) => calls.push(values) } });
  const addressed = request({ decision: { ...request().decision, proactive: false } });
  await messages.typing(addressed); assert.deepEqual(calls, [['202',2000]]);
  await assert.rejects(messages.typing(request()),/AI_TYPING_UNAVAILABLE/);
  eligible = false; await assert.rejects(messages.typing(addressed),/AI_DELIVERY_REVOKED/); assert.equal(calls.length,1);
  const f = turnsFixture(); f.value.decision.proactive = false;
  f.messages.typing = async () => { f.revoke(); };
  f.scheduler.submit = async input => { assert.equal(await input.beforeExecute(),false); return { state: 'cancelled' }; };
  assert.deepEqual(await f.turns.handle({}),{ state: 'cancelled' }); assert.equal(f.sent.length,0);
});

test('SAI AT-06/08 knowledge HTTP requires current publication authority and explicit public-source confirmation', async () => {
  const actor = { userId: '123', guildId: '101' }, proof = {}; let allowed = true, writes = 0;
  const http = createAiKnowledgeHttp({ auth: { authenticate: async () => ({ proof }), resolvePrincipal: async () => ({}) },
    authorization: { resolveActor: async () => actor, authorize: async capability => { assert.equal(capability,'ai.knowledge.publish'); return allowed; } },
    knowledge: { publish: async input => { assert.equal(input.actor,actor); writes++; return { revision: 1 }; } } });
  const req = { path: '/api/ai/knowledge/publish', method: 'POST', query: new URLSearchParams(), credentials: {},
    body: { expectedEpoch: 0, document: {}, reviewHash: 'a'.repeat(64), requestId: 'b'.repeat(64), confirmed: true, approvedPublic: true } };
  await assert.rejects(http.execute({ ...req, body: { ...req.body, approvedPublic: false } }),/KNOWLEDGE_CONFIRMATION_REQUIRED/);
  await assert.rejects(http.execute({ ...req, body: { ...req.body, actor: {} } }),/KNOWLEDGE_INPUT_INVALID/);
  allowed = false; await assert.rejects(http.execute(req),/OPERATION_DENIED/); assert.equal(writes,0);
  allowed = true; assert.equal((await http.execute(req)).revision,1); assert.equal(writes,1);
});

test('DS-07 direct lookup requires current membership and source authority without an inference dependency', async () => {
  const actor = { guildId: '101', userId: '202' }, proof = {}; let allowed = true, sourceCurrent = true, calls = 0, revoke = false;
  const source = { id: 'guide.r1.s0', title: 'Public guide', heading: 'Arrival', text: 'Blue lights.', url: 'https://example.test/guide',
    authority: 'reference', rights: 'Synthetic', attribution: 'Synthetic author', sourceRevision: '1', validUntil: null, publicationHash: 'private implementation field' };
  const http = createKnowledgeLookupHttp({ clock: () => 1000,
    auth: { authenticate: async () => ({ proof }), resolvePrincipal: async p => assert.equal(p, proof) },
    authorization: { resolveActor: async () => actor, authorize: async (capability, candidate) => { assert.equal(capability, 'answers.read'); assert.equal(candidate, actor); return allowed; } },
    knowledge: { lookup: async (query, request) => { assert.equal(query, 'arrival'); assert.equal(request.guildId, '101'); calls++; if (revoke) allowed = false; return [source]; }, current: async () => sourceCurrent } });
  const input = { path: '/api/knowledge/lookup', method: 'POST', query: new URLSearchParams(), body: { query: 'arrival' }, credentials: {} };
  const result = await http.execute(input); assert.equal(result.sources[0].text, source.text); assert.equal('publicationHash' in result.sources[0], false);
  await assert.rejects(http.execute({ ...input, body: { ...input.body, guildId: '999' } }), /KNOWLEDGE_INPUT_INVALID/);
  allowed = false; await assert.rejects(http.execute(input), /OPERATION_DENIED/); assert.equal(calls, 1);
  allowed = true; sourceCurrent = false; await assert.rejects(http.execute(input), /KNOWLEDGE_SOURCE_STALE/);
  sourceCurrent = true; revoke = true; await assert.rejects(http.execute(input), /OPERATION_DENIED/);
});

test('DS07-K07 import HTTP exposes fixed read/refresh operations only to current publishers', async () => {
  const actor = { userId: '123', guildId: '101' }, proof = {}; let allowed = true, calls = 0, invalidations = 0;
  const http = createAiKnowledgeHttp({ auth: { authenticate: async () => ({ proof }), resolvePrincipal: async () => ({}) },
    authorization: { resolveActor: async () => actor, authorize: async () => allowed }, invalidate: () => { invalidations++; },
    knowledge: { refreshPolicies: async input => { assert.deepEqual(input,{ actor }); calls++; return { publishedAutomatically: false }; },
      policiesStatus: async () => ({ available: true, state: 'pending' }), policiesSnapshot: async input => ({ snapshotHash: input.snapshotHash, reviewed: false }) } });
  const request = { path: '/api/ai/knowledge/refresh-policies', method: 'POST', body: {}, query: new URLSearchParams(), credentials: {} };
  await assert.rejects(http.execute({ ...request, body: { url: 'https://example.invalid/private' } }),/KNOWLEDGE_INPUT_INVALID/);
  allowed = false; await assert.rejects(http.execute(request),/OPERATION_DENIED/); assert.equal(calls,0);
  allowed = true; assert.equal((await http.execute(request)).publishedAutomatically,false); assert.equal(calls,1); assert.equal(invalidations,1);
  assert.equal((await http.execute({ ...request, method: 'GET', path: '/api/ai/knowledge/policies-status', body: null })).state,'pending');
  assert.equal((await http.execute({ ...request, method: 'GET', path: '/api/ai/knowledge/policies-snapshot', body: null, query: new URLSearchParams({ snapshotHash: 'a'.repeat(64) }) })).reviewed,false);
});
