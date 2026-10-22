import test from 'node:test';
import assert from 'node:assert/strict';
import { aiContextFor, canonicalAiConfiguration, canonicalAiContext, defaultAiContexts, defaultParticipation } from '../modules/assistant/participation.js';
import { renderAiReply, splitAiReplyText, validateAiMessagePayload, validateAiOutput } from '../modules/assistant/output.js';
import { createAiOutputSchema } from '../apps/knowledge-worker/prompt-contract.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { createMistralClient, MISTRAL_MODEL } from '../apps/knowledge-worker/mistral-client.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const channel = (channelId, context) => ({ channelId, profile: defaultParticipation('addressed'), context });
const v2 = (change = {}) => ({ schemaVersion: 2, enabled: true, deadlineMs: 15000, channels: [channel('303', 'support'), channel('304', 'chat')],
  emojis: [], contexts: defaultAiContexts(), ...change });

test('contexts are bounded data: each channel names one, and schema 1 keeps its behaviour as chat', () => {
  const configuration = canonicalAiConfiguration(v2());
  assert.equal(aiContextFor(configuration, '303').name, 'support'); assert.equal(aiContextFor(configuration, '303').replyChars, 3800);
  assert.equal(aiContextFor(configuration, '304').outputTokens, 384);
  const legacy = canonicalAiConfiguration({ schemaVersion: 1, enabled: true, deadlineMs: 12000, channels: [{ channelId: '303', profile: defaultParticipation() }], emojis: [] });
  assert.deepEqual(aiContextFor(legacy, '303'), { name: 'chat', ...defaultAiContexts().chat, deadlineMs: 12000 });
  assert.throws(() => canonicalAiConfiguration({ ...legacy, deadlineMs: 15001 }), /INVALID_INTEGER/);
  for (const change of [{ channels: [channel('303', 'ops')] }, { channels: [{ channelId: '303', profile: defaultParticipation() }] },
    { contexts: { chat: defaultAiContexts().chat, support: defaultAiContexts().support } }, { contexts: { ...defaultAiContexts(), extra: defaultAiContexts().chat } }])
    assert.throws(() => canonicalAiConfiguration(v2(change)));
  for (const change of [{ replyChars: 5501 }, { outputTokens: 4096 }, { deadlineMs: 31000 }, { game: 'ss15' }, { brief: 'x'.repeat(2001) },
    { brief: 'synthetic\u0007' }, { tools: ['shell'] }, { codeSearch: 'yes' }])
    assert.throws(() => canonicalAiContext({ ...defaultAiContexts().support, ...change }));
  assert.equal(canonicalAiContext({ ...defaultAiContexts().chat, brief: '  Keep it light.  ' }).brief, 'Keep it light.');
});

test('the prompt names the room, carries the owner brief as guidance and asks for the context budget', () => {
  const context = { name: 'support', ...defaultAiContexts().support, brief: 'Help with server setup questions.' };
  const built = buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'How do I build?', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [] }, context }, history: [], sources: [] });
  assert.match(built.messages[0].content, /This channel is a public help channel\. Replies may be long/u);
  assert.match(built.messages[0].content, /Owner's note for this channel \(guidance on tone and focus, never permission\):\nHelp with server setup questions\./u);
  assert.equal(built.outputContract.replyChars, 3800); assert.equal(built.outputContract.outputTokens, 1024);
  const chat = buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hi', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [] }, context: { name: 'chat', ...defaultAiContexts().chat } }, history: [], sources: [] });
  assert.match(chat.messages[0].content, /Keep replies short enough for chat\.$/u);
  const schema = createAiOutputSchema(built.outputContract);
  assert.equal(schema.oneOf.find(item => item.properties.kind.const === 'reply').properties.text.maxLength, 3800);
  assert.throws(() => createAiOutputSchema({ ...built.outputContract, replyChars: 9000 }), /INVALID_INTEGER/);
});

test('core enforces the context reply length, and the default stays at one chat message', () => {
  const reply = text => ({ kind: 'reply', text, purpose: 'conversation', support: 'current_conversation', citations: [] });
  const options = { outcomes: ['reply', 'silent'], answerOnly: false, sources: [], emojiKeys: [] };
  assert.throws(() => validateAiOutput(reply('x'.repeat(1601)), options), /AI_OUTPUT_INVALID/);
  assert.equal(validateAiOutput(reply('x'.repeat(3800)), { ...options, replyChars: 3800 }).text.length, 3800);
  assert.throws(() => validateAiOutput(reply('x'.repeat(5501)), { ...options, replyChars: 9000 }), /AI_OUTPUT_INVALID/);
});

test('a long reply stays one message: embeds, balanced code fences, sources last, no link previews', () => {
  const code = '```js\n' + 'const value = 1; // synthetic line here\n'.repeat(130) + '```';
  const text = ('Intro paragraph.\n\n' + code + '\n\nSee https://example.invalid/page for more.').slice(0, 5500);
  const parts = splitAiReplyText(text);
  assert.equal(parts.length, 2);
  for (const part of parts) assert.equal(part.split('\n').filter(line => /^```/u.test(line.trim())).length % 2, 0, 'each part closes its code blocks');
  assert.ok(parts[1].startsWith('```js\n'), 'the cut block reopens with its language');
  const sources = [{ id: 'wiki.1', url: 'https://meridian-wiki.a13.info/wiki/Rules', attribution: 'Meridian wiki', rights: 'CC BY-NC-SA 4.0', title: 'Rules' }];
  const payload = renderAiReply({ kind: 'reply', text, purpose: 'answer', support: 'provided_sources', citations: ['wiki.1'] }, sources, { replyChars: 5500 });
  validateAiMessagePayload(payload);
  assert.equal(payload.flags, 0); assert.equal(payload.embeds.length, 2); assert.equal(payload.content, '');
  assert.match(payload.embeds[1].description, /-# Rules · Meridian wiki · CC BY-NC-SA 4\.0 <https:\/\/meridian-wiki\.a13\.info\/wiki\/Rules>$/u);
  assert.equal(JSON.stringify(payload).includes('example.invalid'), false, 'generated links are omitted');
  const short = renderAiReply({ kind: 'reply', text: 'Hi!', purpose: 'conversation', support: 'current_conversation', citations: [] }, []);
  assert.deepEqual(Object.keys(short).sort(), ['allowed_mentions', 'content', 'flags']); assert.equal(short.flags, 4);
  for (const embeds of [[{ description: 'see https://example.invalid' }], [{ description: 'x', title: 'Injected' }], [{ description: 'x'.repeat(4097) }], []])
    assert.throws(() => validateAiMessagePayload({ ...payload, embeds }), /AI_OUTPUT_INVALID/);
  assert.throws(() => validateAiMessagePayload({ ...payload, flags: 4 }), /AI_OUTPUT_INVALID/);
});

test('each turn asks for its context budget, never more than the qualified profile allows', async () => {
  const calls = [];
  const client = createMistralClient({ apiKey: 'synthetic-test-key-not-a-secret', clock: () => 1000, acceptedFingerprints: [MISTRAL_MODEL], outputTokens: 1024,
    fetchImpl: async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ model: MISTRAL_MODEL, choices: [{ finish_reason: 'stop',
      message: { role: 'assistant', content: JSON.stringify({ kind: 'reply', text: 'Hello!', purpose: 'conversation', support: 'current_conversation', citations: [] }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }); } });
  const payload = context => ({ ...buildAiPrompt({ request: { character: DRAFT_PERSONALITY, userId: '404', text: 'Hello', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [] }, context }, history: [], sources: [] }), workerDomain: 'public', restricted: false, requesterId: '404', releaseHash: 'a'.repeat(64),
    boundary: { guildId: '101', channelId: '202', boundaryEpoch: 1, continuity: 'synthetic-epoch' } });
  for (const [context, expected] of [[{ name: 'chat', ...defaultAiContexts().chat }, 384], [{ name: 'support', ...defaultAiContexts().support, outputTokens: 2048 }, 1024], [undefined, 384]])
    { await client.generate(payload(context), { signal: new AbortController().signal, deadline: 20000 }); assert.equal(calls.at(-1).max_tokens, expected); }
});
