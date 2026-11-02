import test from 'node:test';
import assert from 'node:assert/strict';
import { answeredOutput, checkedReplyOutput, withoutMemberLabels } from '../modules/assistant/reply-checks.js';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../modules/assistant/personality.js';
import { defaultAiContexts, defaultParticipation } from '../modules/assistant/participation.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { redactAiIdentifiers } from '../apps/knowledge-worker/redaction.js';
import { markOutdatedSections, WIKI_OUTDATED_NOTE } from '../apps/knowledge/sources/wiki.js';
import { createAiTurns } from '../apps/core/discord/ai-turns.js';
import { createAiContext } from '../apps/knowledge-worker/context.js';

test('REP-01 turn labels never reach a member: addressing is dropped, naming becomes you or another member', () => {
  const own = { own: 'Member 2' };
  for (const [text, expected] of [['Congrats, Member 2!', 'Congrats!'], ['I don\'t have mute tools, Member 2.', 'I don\'t have mute tools.'], ['Hey Member 1, welcome!', 'Hey, welcome!'],
    ['Member 2, here is the thing.', 'Here is the thing.'], ['You\'re Member 2, the red panda.', 'You\'re the red panda.'],
    ['Member 1 said that earlier. Member 2 is right though.', 'Another member said that earlier. You are right though.'], ['Member 2\'s ship is fine.', 'Your ship is fine.'],
    ['I asked Member 1 about it.', 'I asked another member about it.'], ['No labels here.', 'No labels here.']])
    assert.equal(withoutMemberLabels(text, own).text, expected, text);
  assert.equal(withoutMemberLabels('Got it, Member 2! Member 1 was here.', own).replaced, 2);
});

test('REP-02 the delivered reply carries no label; an addressed silence gets the owner\'s wording, a proactive one stays silent', async () => {
  const reply = { kind: 'reply', text: 'Welcome back, Member 1!', purpose: 'conversation', support: 'current_conversation', citations: [] };
  const checked = await checkedReplyOutput(reply, { remembered: false, own: 'Member 1' });
  assert.equal(checked.output.text, 'Welcome back!'); assert.equal(checked.removed.labels, 1);
  const silent = { kind: 'silent', memories: [{ scope: 'channel', about: [], text: 'x' }] }, wording = async name => `wording ${name}`;
  assert.deepEqual((await answeredOutput(silent, { addressed: true, contextName: 'staff', wording })).output,
    { kind: 'reply', text: 'wording staff', purpose: 'conversation', support: 'current_conversation', citations: [], memories: silent.memories });
  assert.equal((await answeredOutput(silent, { addressed: false, wording })).output, silent);
  assert.equal((await answeredOutput(silent, { addressed: true })).output, silent, 'no wording keeps the silence');
  assert.equal((await answeredOutput(reply, { addressed: true, wording })).output, reply);
  const run = async proactive => {
    const sent = [], traces = [], states = [];
    const request = { guildId: '101', channelId: '202', userId: '404', messageId: '303', receivedAt: 1000, deadline: 16000, text: 'Sophie, play some music',
      inputRevision: 'original', profile: defaultParticipation('addressed'), config: { emojis: [] }, character: structuredClone(DRAFT_PERSONALITY),
      context: { name: 'chat', ...defaultAiContexts().chat }, binding: { boundaryEpoch: 1, workerDomain: 'public', releaseHash: 'a'.repeat(64), consentEpoch: 1 },
      decision: { context: true, infer: true, outcomes: ['reply', 'silent'], proactive, answerOnly: false } };
    const turns = createAiTurns({ admission: { admit: async () => request, revalidate: async () => true, revalidateSource: async () => true, beginDelivery: async () => true,
      settle: async (_request, state) => states.push(state) },
      scheduler: { submit: async input => ({ state: 'completed', result: { kind: 'silent' }, input }), cancel() {}, disable() {} },
      context: createAiContext({ clock: () => 1000 }), knowledge: { lookup: async () => [], current: async () => true },
      messages: { reply: async (_request, payload) => { sent.push(payload); return { id: '606' }; }, react: async () => assert.fail('no reaction'), typing: async () => {} },
      clock: () => 1000, trace: code => traces.push(code), silentFallback: async name => `Synthetic ${name} template.` });
    const result = await turns.handle({}); await turns.stop();
    return { result, sent, traces };
  };
  const addressed = await run(false);
  assert.deepEqual(addressed.result, { state: 'delivered' }); assert.equal(addressed.sent[0].content, 'Synthetic chat template.');
  assert.ok(addressed.traces.includes('AI_TURN_SILENT_ADDRESSED'));
  const proactive = await run(true);
  assert.deepEqual(proactive.result, { state: 'silent' }); assert.equal(proactive.sent.length, 0);
});

test('REP-03 a character example may say it answers from general knowledge; one without stays small talk', () => {
  assert.equal(Object.hasOwn(canonicalPersonality(DRAFT_PERSONALITY).examples[0], 'support'), false, 'a character without it keeps its form');
  const character = { core: 'Synthetic core.', examples: [{ member: 'What is a protogen?', sophie: 'A synthetic answer.', support: 'general_knowledge' }, { member: 'Hi', sophie: 'Hello!' }] };
  assert.deepEqual(canonicalPersonality(character), character);
  for (const bad of [{ ...character.examples[0], support: 'provided_sources' }, { ...character.examples[0], support: null }, { ...character.examples[1], extra: 'x' }])
    assert.throws(() => canonicalPersonality({ ...character, examples: [bad] }), /AI_PERSONALITY_INVALID/u);
  const request = { character, userId: '404', text: 'Hi', decision: { outcomes: ['reply', 'silent'], answerOnly: false }, config: { emojis: [] } };
  const replies = buildAiPrompt({ request, history: [], sources: [] }).messages.filter(message => message.role === 'assistant').map(message => JSON.parse(message.content));
  assert.deepEqual(replies.map(reply => [reply.purpose, reply.support]), [['answer', 'general_knowledge'], ['conversation', 'current_conversation']]);
  const system = buildAiPrompt({ request, history: [], sources: [] }).messages[0].content;
  assert.match(system, /Joke about yourself, never about facts of the game, the server, code or people\./u);
  assert.match(system, /marked out of date on the wiki may no longer be true/u);
});

test('REP-04 faces in the character survive redaction; handles, addresses and IDs do not', () => {
  assert.equal(redactAiIdentifiers('A visor emote: ^w^, >:3, @_@, @w@, owo'), 'A visor emote: ^w^, >:3, @_@, @w@, owo');
  assert.equal(redactAiIdentifiers('ping @alice_handle or mail a.b@example.invalid, id 123456789012345678'), 'ping [handle] or mail [email], id [id]');
});

test('REP-05 a section the wiki flags as out of date says so in its heading; a flagged opening marks the whole page', () => {
  const banner = reason => `This page needs to be reviewed/updated. REASON: ${reason} PRIORITY: Medium Body text.`;
  const sections = text => [{ heading: 'Page', text: 'Opening.' }, { heading: 'Page › Intents', text }, { heading: 'Page › Other', text: 'Fine.' }];
  const one = markOutdatedSections(sections(banner('This has been woefully out of date ever since TG removed intents.')));
  assert.equal(one.page, false); assert.deepEqual(one.sections.map(section => section.heading), ['Page', `Page › Intents${WIKI_OUTDATED_NOTE}`, 'Page › Other']);
  const whole = markOutdatedSections([{ heading: 'Chain of Command', text: banner('This page is prolly outdated and not reflective of how we handle it') }, { heading: 'Chain of Command › Ranks', text: 'x' }]);
  assert.equal(whole.page, true); assert.ok(whole.sections.every(section => section.heading.endsWith(WIKI_OUTDATED_NOTE)));
  assert.ok(markOutdatedSections([{ heading: 'Shadowlings', text: 'This antagonist has been removed from the game. This page is archived for historical purposes.' }]).page);
  const styling = markOutdatedSections(sections(banner('Broken links need to be fixed, styling needs to be improved')));
  assert.equal(styling.page, false); assert.equal(styling.sections.some(section => section.heading.endsWith(WIKI_OUTDATED_NOTE)), false);
  const long = markOutdatedSections([{ heading: 'H'.repeat(160), text: banner('Outdated Information') }]).sections[0].heading;
  assert.ok(long.length <= 140 && long.endsWith(`…${WIKI_OUTDATED_NOTE}`), 'room for " (continued n)" within 160');
});
