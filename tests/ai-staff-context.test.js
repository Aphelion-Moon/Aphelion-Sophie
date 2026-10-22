import test from 'node:test';
import assert from 'node:assert/strict';
import { aiRemoteLaneAllowed, aiWorkerPayload } from '../apps/knowledge-worker/ipc-contract.js';
import { createProcessingApproval } from '../modules/assistant/processing-policy.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { defaultAiContexts } from '../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const review = { status: 'accepted', processorAgreement: '1'.repeat(64), discordServiceProviderTerms: '2'.repeat(64), retentionAndDeletion: '3'.repeat(64), internationalTransfers: '4'.repeat(64) };
const policy = { schemaVersion: 2, provider: 'mistral', domain: 'public', approved: true, evidenceHash: '5'.repeat(64), validUntil: 9e12, noticeRevision: 4,
  noticeText: 'Synthetic notice', review, automaticMemory: true };
const digest = value => value;

test('a restricted channel reaches the provider only as a declared staff turn', () => {
  assert.equal(aiRemoteLaneAllowed({ workerDomain: 'public', restricted: false }), true);
  assert.equal(aiRemoteLaneAllowed({ workerDomain: 'public', restricted: true, staff: true }), true);
  for (const lane of [{ workerDomain: 'public', restricted: true }, { workerDomain: 'public', restricted: true, staff: false },
    { workerDomain: 'public', restricted: false, staff: true }, { workerDomain: 'local', restricted: true, staff: true }, {}])
    assert.equal(aiRemoteLaneAllowed(lane), false, JSON.stringify(lane));
});

test('the worker payload contract carries the staff flag only with a restricted lane', () => {
  const identity = { releaseHash: 'a'.repeat(64) };
  const payload = staff => ({ ...buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [] }, context: { name: 'staff', ...defaultAiContexts().staff } }, history: [], sources: [] }),
    workerDomain: 'public', releaseHash: 'a'.repeat(64), requesterId: '404', boundary: { guildId: '101', channelId: '202', continuity: 'synthetic', boundaryEpoch: 1 }, ...staff });
  assert.equal(aiWorkerPayload(payload({ restricted: true, staff: true }), identity).staff, true);
  assert.equal(Object.hasOwn(aiWorkerPayload(payload({ restricted: false }), identity), 'staff'), false);
  assert.throws(() => aiWorkerPayload(payload({ restricted: true }), identity), /AI_IPC_SCOPE_INVALID/);
  assert.throws(() => aiWorkerPayload(payload({ restricted: false, staff: true }), identity), /AI_IPC_SCOPE_INVALID/);
});

test('staff channels need an accepted policy that names them, and naming them changes what members accept', async () => {
  const without = createProcessingApproval({ policy, qualified: async () => true, digest, clock: () => 1 });
  const staff = createProcessingApproval({ policy: { ...policy, staffChannels: true }, qualified: async () => true, digest, clock: () => 1 });
  assert.equal(await without.staffChannels(), false); assert.equal(await staff.staffChannels(), true);
  assert.notEqual((await staff.notice()).binding, (await without.notice()).binding);
  assert.throws(() => createProcessingApproval({ policy: { ...policy, staffChannels: false }, qualified: async () => true, digest }), /AI_PROCESSING_POLICY_INVALID/);
  const expired = createProcessingApproval({ policy: { ...policy, staffChannels: true }, qualified: async () => true, digest, clock: () => 9e12 + 1 });
  assert.equal(await expired.staffChannels(), false);
  const unqualified = createProcessingApproval({ policy: { ...policy, staffChannels: true }, qualified: async () => false, digest, clock: () => 1 });
  assert.equal(await unqualified.staffChannels(), false);
});

test('in a staff channel Sophie is told not to repeat or act on case details', () => {
  const built = buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [] }, context: { name: 'staff', ...defaultAiContexts().staff } }, history: [], sources: [] });
  assert.match(built.messages[0].content, /This channel is a staff channel\. Staff may mention a case, report or ticket by mistake: never repeat, summarize or act on it/u);
  const support = buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [] }, context: { name: 'support', ...defaultAiContexts().support } }, history: [], sources: [] });
  assert.equal(support.messages[0].content.includes('Staff may mention'), false);
});
