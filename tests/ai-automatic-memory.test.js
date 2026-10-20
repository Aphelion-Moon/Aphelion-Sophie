import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalEditedMemory, encodeMemory, renderMemory, validateMemoryProposals, validateStoredMemory } from '../modules/assistant/memories.js';
import { renderAiReply, validateAiOutput } from '../modules/assistant/output.js';
import { createAiOutputSchema } from '../apps/knowledge-worker/prompt-contract.js';
import { aiSpeakerLabels, buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { createProcessingApproval } from '../modules/assistant/processing-policy.js';
import { createAiTurns } from '../apps/core/discord/ai-turns.js';
import { createAiContext } from '../apps/knowledge-worker/context.js';
import { defaultParticipation } from '../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const labels = ['Member 1', 'Member 2'];
const request = (fields = {}) => ({ guildId: '101', channelId: '202', userId: '404', messageId: '303', receivedAt: 1000, deadline: 16000,
  text: 'Synthetic hello', inputRevision: 'original', profile: defaultParticipation('conversational'),
  config: { emojis: [] }, character: structuredClone(DRAFT_PERSONALITY),
  binding: { boundaryEpoch: 1, workerDomain: 'public', releaseHash: 'a'.repeat(64), consentEpoch: 1 },
  decision: { context: true, infer: true, outcomes: ['reply', 'silent'], proactive: true, answerOnly: false }, ...fields });
const reply = { kind: 'reply', text: 'Hi!', purpose: 'conversation', support: 'current_conversation', citations: [] };
const contract = { outcomes: ['reply', 'silent'], answerOnly: false, sources: [], emojiKeys: [] };

test('MEM-01 memory proposals are bounded, labelled and name only their subjects', () => {
  const valid = validateMemoryProposals([{ scope: 'member', about: ['Member 2'], text: ' Member 2 uses they/them ' },
    { scope: 'channel', about: ['Member 1', 'Member 2'], text: 'Member 1 and Member 2 ran a karaoke night' }], labels);
  assert.equal(valid[0].text, 'Member 2 uses they/them');
  for (const bad of [
    [{ scope: 'member', about: ['Member 3'], text: 'unknown label' }],
    [{ scope: 'member', about: ['Member 1', 'Member 2'], text: 'two subjects for one member memory' }],
    [{ scope: 'channel', about: ['Member 1'], text: 'Member 2 was there too' }],
    [{ scope: 'member', about: ['Member 1'], text: 'braces {1} are reserved' }],
    [{ scope: 'member', about: ['Member 1'], text: 'x'.repeat(201) }],
    [{ scope: 'member', about: ['Member 1'], text: 'line\nbreak' }],
    [{ scope: 'member', about: ['Member 1'], text: 'extra', extra: true }],
    Array(3).fill({ scope: 'channel', about: [], text: 'three is too many' }),
  ]) assert.throws(() => validateMemoryProposals(bad, labels), /AI_OUTPUT_INVALID/);
});

test('MEM-02 any outcome may carry memories only when the turn offered labels; replies never send them', () => {
  const memories = [{ scope: 'member', about: ['Member 1'], text: 'Member 1 likes moths' }];
  assert.deepEqual(validateAiOutput({ kind: 'silent', memories }, { ...contract, memoryLabels: labels }).memories[0].text, 'Member 1 likes moths');
  assert.deepEqual(validateAiOutput({ ...reply, memories: [] }, { ...contract, memoryLabels: labels }), reply);
  assert.throws(() => validateAiOutput({ ...reply, memories }, contract), /AI_OUTPUT_INVALID/);
  const answerOnly = validateAiOutput({ ...reply, memories }, { ...contract, answerOnly: true, memoryLabels: labels });
  assert.equal(answerOnly.kind, 'silent'); assert.equal(answerOnly.memories.length, 1);
  const output = validateAiOutput({ ...reply, memories }, { ...contract, memoryLabels: labels });
  assert.equal(renderAiReply(output, []).content.includes('moths'), false);
});

test('MEM-03 the generation schema offers optional memories with the turn labels only', () => {
  const plain = createAiOutputSchema({ outcomes: ['reply', 'silent'], answerOnly: false, sourceIds: [], emojiKeys: [] });
  assert.equal(JSON.stringify(plain).includes('memories'), false);
  const schema = createAiOutputSchema({ outcomes: ['reply', 'silent'], answerOnly: false, sourceIds: [], emojiKeys: [], memoryLabels: labels });
  for (const shape of schema.oneOf) {
    assert.equal(shape.required.includes('memories'), false);
    assert.deepEqual(shape.properties.memories.items.properties.about.items.enum, labels);
  }
  assert.throws(() => createAiOutputSchema({ outcomes: ['silent'], answerOnly: false, sourceIds: [], emojiKeys: [], memoryLabels: ['Alice'] }), /AI_OUTPUT_CONTRACT_INVALID/);
});

test('MEM-04 stored memories hold placeholders, never labels or names, and render per reader', () => {
  const [proposal] = validateMemoryProposals([{ scope: 'channel', about: ['Member 2', 'Member 1'], text: 'Member 1 beat Member 2 at chess' }], labels);
  const stored = encodeMemory(proposal, label => ({ 'Member 1': '404', 'Member 2': '505' })[label]);
  assert.deepEqual(stored, { scope: 'channel', subjects: ['505', '404'], text: '{2} beat {1} at chess' });
  assert.equal(renderMemory(stored, id => id === '404' ? 'you' : null), 'you beat a member at chess');
  assert.throws(() => validateStoredMemory({ ...stored, text: '{3} was here' }), /AI_MEMORY_INVALID/);
  assert.throws(() => encodeMemory(proposal, () => undefined), /INVALID|AI_MEMORY/);
  assert.equal(canonicalEditedMemory('  Prefers she/her  '), 'Prefers she/her');
  assert.throws(() => canonicalEditedMemory('{1} rewrite'), /AI_MEMORY_INVALID/);
});

test('MEM-05 the prompt says memory is off unless the turn may remember, and shows memories by label', () => {
  const history = [{ kind: 'member', userId: '505', text: 'hi', messageId: '300' }];
  const off = buildAiPrompt({ request: request(), history, sources: [] });
  assert.match(off.messages[0].content, /Automatic learning is off/u); assert.equal(off.outputContract.memoryLabels, undefined);
  const memories = [{ id: 'a', scope: 'member', subjects: ['505'], text: 'likes moths' },
    { id: 'b', scope: 'channel', subjects: ['505', '999'], text: '{1} and {2} built a shuttle' }];
  const on = buildAiPrompt({ request: request(), history, sources: [], memories });
  assert.match(on.messages[0].content, /You have a memory/u);
  assert.deepEqual(on.outputContract.memoryLabels, ['Member 1', 'Member 2']);
  const block = on.messages.find(message => message.content.startsWith('Sophie remembers'));
  assert.match(block.content, /Member 1 and a member built a shuttle/u); assert.equal(block.content.includes('999'), false);
  assert.ok(on.trimGroups.some(group => group[0] === on.messages.indexOf(block)));
  assert.deepEqual([...aiSpeakerLabels(request(), history)], [['505', 'Member 1'], ['404', 'Member 2']]);
});

test('MEM-06 automatic memory needs an accepted policy that declares it; older bindings are unchanged', async () => {
  const review = { status: 'accepted', processorAgreement: '1'.repeat(64), discordServiceProviderTerms: '2'.repeat(64), retentionAndDeletion: '3'.repeat(64), internationalTransfers: '4'.repeat(64) };
  const base = { schemaVersion: 2, provider: 'mistral', domain: 'public', approved: true, evidenceHash: '5'.repeat(64), validUntil: 9e12, noticeRevision: 3, noticeText: 'Synthetic notice', review };
  const digest = value => value;
  const without = createProcessingApproval({ policy: base, qualified: async () => true, digest, clock: () => 1 });
  const withMemory = createProcessingApproval({ policy: { ...base, automaticMemory: true }, qualified: async () => true, digest, clock: () => 1 });
  assert.equal(await without.automaticMemory(), false); assert.equal(await withMemory.automaticMemory(), true);
  assert.equal((await without.notice()).binding, JSON.stringify(['mistral', 3, 'Synthetic notice', '5'.repeat(64), ...['1', '2', '3', '4'].map(c => c.repeat(64))]));
  assert.notEqual((await withMemory.notice()).binding, (await without.notice()).binding);
  assert.throws(() => createProcessingApproval({ policy: { ...base, automaticMemory: false }, qualified: async () => true, digest }), /AI_PROCESSING_POLICY_INVALID/);
  const draft = createProcessingApproval({ policy: { ...base, automaticMemory: true, review: { ...review, status: 'draft' } }, qualified: async () => true, digest, clock: () => 1 });
  assert.equal(await draft.automaticMemory(), false);
});

function memoryTurns({ enabled = true, output, current = true } = {}) {
  const recorded = [], touched = [], states = [], sent = [];
  const admission = { admit: async () => request(), revalidate: async () => true, revalidateSource: async () => true,
    beginDelivery: async () => true, settle: async (_request, state) => states.push(state) };
  const scheduler = { submit: async input => ({ state: 'completed', result: output, input }), cancel() {}, disable() {} };
  const remembered = [{ id: 'm1', scope: 'member', subjects: ['404'], text: 'likes moths' }];
  const memories = { enabled: async () => enabled, forPrompt: async () => remembered, current: async () => current,
    touch: async items => touched.push(items), record: async value => { recorded.push(value); return value.memories.length; } };
  const messages = { reply: async (_req, payload) => { sent.push(payload); return { id: '606' }; }, react: async () => assert.fail('no reaction') };
  const turns = createAiTurns({ admission, scheduler, context: createAiContext({ clock: () => 1000 }), knowledge: { lookup: async () => [], current: async () => true },
    messages, clock: () => 1000, memories });
  return { turns, recorded, touched, states, sent };
}

test('MEM-07 a finished turn stores what Sophie chose to remember, masked and by user ID; used memories are kept longer', async () => {
  const output = { ...reply, memories: [{ scope: 'member', about: ['Member 1'], text: 'Member 1 is reachable at moth@example.invalid' }] };
  const f = memoryTurns({ output });
  assert.deepEqual(await f.turns.handle({}), { state: 'delivered' });
  assert.deepEqual(f.recorded[0].memories, [{ scope: 'member', subjects: ['404'], text: '{1} is reachable at [email]' }]);
  assert.equal(f.recorded[0].channelId, '202'); assert.equal(f.touched[0][0].id, 'm1');
  assert.equal(f.sent[0].content.includes('moth'), false);
  await f.turns.stop();
});

test('MEM-08 no memory is kept or offered while disabled, and a stale memory stops delivery', async () => {
  const off = memoryTurns({ enabled: false, output: reply });
  assert.deepEqual(await off.turns.handle({}), { state: 'delivered' });
  assert.equal(off.recorded.length, 0); assert.equal(off.touched.length, 0); await off.turns.stop();
  const stale = memoryTurns({ output: reply, current: false });
  assert.deepEqual(await stale.turns.handle({}), { state: 'cancelled' });
  assert.equal(stale.sent.length, 0); assert.equal(stale.recorded.length, 0); await stale.turns.stop();
});
