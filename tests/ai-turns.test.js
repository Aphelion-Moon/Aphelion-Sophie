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
