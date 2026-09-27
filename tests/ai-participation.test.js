import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAiConfiguration, defaultParticipation, canonicalParticipation, participationDecision, questionCandidate, isQuiet } from '../modules/assistant/participation.js';
import { validateAiOutput, renderAiReply } from '../modules/assistant/output.js';

const event = (fields = {}) => ({ addressed: false, question: false, directedToOther: false, now: 1000, ...fields });
const decide = (mode, fields, profile = {}) => participationDecision({ ...defaultParticipation(mode), ...profile }, event(fields));
const source = { id: 'guide', url: 'https://example.test/approved', attribution: 'Synthetic authors', rights: 'Synthetic fixture' };
const answer = { kind: 'reply', text: 'The approved guide says to use the arrivals door.', purpose: 'answer', support: 'provided_sources', citations: ['guide'] };
const options = { outcomes: ['reply', 'react', 'silent'], answerOnly: false, sources: [source], emojiKeys: ['celebrate'] };

test('SAI AT-01/03 five modes constrain initiative independently from content and consent', () => {
  assert.equal(decide('ignore', { addressed: true }).infer, false);
  assert.equal(decide('addressed').context, false);
  assert.deepEqual(decide('addressed', { addressed: true }).outcomes, ['reply', 'silent']);
  assert.equal(decide('questions').infer, false);
  assert.equal(decide('questions', { question: true }).answerOnly, true);
  assert.deepEqual(decide('reactive').outcomes, ['react', 'silent']);
  assert.equal(decide('reactive', { addressed: true }).outcomes.includes('reply'), true);
  assert.deepEqual(decide('conversational').outcomes, ['reply', 'silent']);
  assert.equal(decide('conversational', { directedToOther: true }).infer, false);
  assert.equal(decide('questions', { question: true }, { proactiveRepliesPerHour: 0 }).infer, false);
});

test('SAI AT-06 bounded channel policy rejects escalation fields, duplicate channels and extended deadlines', () => {
  const configuration = { schemaVersion: 1, enabled: false, deadlineMs: 15000,
    channels: [{ channelId: '123', profile: defaultParticipation('questions') }], emojis: [{ key: 'celebrate', id: null, name: '🎉' }] };
  assert.deepEqual(canonicalAiConfiguration(configuration), configuration);
  for (const change of [{ deadlineMs: 15001 }, { bypassConsent: true }, { channels: [...configuration.channels, ...configuration.channels] },
    { emojis: [{ key: 'save', id: null, name: '✅' }] }, { emojis: [{ key: 'bad', id: null, name: 'hello👍' }] }]) {
    assert.throws(() => canonicalAiConfiguration({ ...configuration, ...change }));
  }
  assert.throws(() => canonicalParticipation({ ...defaultParticipation(), evaluationIntervalMs: 0 }));
  assert.throws(() => canonicalParticipation({ ...defaultParticipation(), privateSources: true }));
});

test('SAI AT-16 quiet hours suppress proactive behavior while explicit requests remain available', () => {
  const profile = { ...defaultParticipation('conversational'), quietHours: { startMinute: 22 * 60, endMinute: 7 * 60, utcOffsetMinutes: 120 } };
  const at = Date.UTC(2026, 8, 27, 21);
  assert.equal(isQuiet(profile, at), true);
  assert.equal(participationDecision(profile, event({ now: at })).infer, false);
  assert.equal(participationDecision(profile, event({ now: at, addressed: true })).infer, true);
  assert.equal(isQuiet(profile, Date.UTC(2026, 8, 27, 10)), false);
});

test('SAI AT-12 question candidates do not turn self-reported confidence into an unsolicited answer', () => {
  assert.equal(questionCandidate('Where is arrivals'), true);
  assert.equal(questionCandidate('Please help with this'), true);
  assert.equal(questionCandidate('We arrived safely.'), false);
  assert.deepEqual(validateAiOutput(answer, { ...options, answerOnly: true }), answer);
  assert.deepEqual(validateAiOutput({ ...answer, support: 'general_knowledge', citations: [] }, { ...options, answerOnly: true }), { kind: 'silent' });
  assert.throws(() => validateAiOutput({ ...answer, confidence: 0.99 }, options));
  assert.throws(() => validateAiOutput({ ...answer, citations: ['hidden-staff'] }, options));
});

test('SAI AT-12/19 only one permitted outcome survives strict output validation', () => {
  for (const bad of [{ kind: 'react', emojiKey: 'unknown' }, { kind: 'silent', text: 'hidden' },
    { ...answer, reasoning: 'private' }, { ...answer, destination: '999' }, { ...answer, text: 'x'.repeat(1601) },
    { ...answer, citations: [] }, { kind: 'reply', text: 'raw fallback' }]) assert.throws(() => validateAiOutput(bad, options));
  assert.throws(() => validateAiOutput(answer, { ...options, outcomes: ['react', 'silent'] }));
  assert.deepEqual(validateAiOutput({ kind: 'react', emojiKey: 'celebrate' }, options), { kind: 'react', emojiKey: 'celebrate' });
});

test('SAI AT-12 rendering disables pings and renders only canonical source links', () => {
  const output = renderAiReply({ ...answer, text: '@everyone <@&123> see https://unreviewed.test/x' }, [source]);
  assert.equal(output.content.includes('https://unreviewed.test'), false);
  assert.equal(output.content.includes('<@'), false);
  assert.equal(output.content.endsWith('<https://example.test/approved>'), true);
  assert.ok(output.content.includes('Synthetic authors · Synthetic fixture'));
  assert.deepEqual(output.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.equal(output.flags, 4);
});
