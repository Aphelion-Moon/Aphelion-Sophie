import test from 'node:test';
import assert from 'node:assert/strict';
import { aiCommandNames, capabilityBlock } from '../modules/assistant/capabilities.js';
import { canonicalAiConfiguration, canonicalAiDirectory, defaultAiContexts, defaultParticipation } from '../modules/assistant/participation.js';
import { checkedReplyOutput, checkReply, claimedNumbers, citedText } from '../modules/assistant/reply-checks.js';
import { renderAiReply } from '../modules/assistant/output.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { createAiTurns } from '../apps/core/discord/ai-turns.js';
import { createAiContext } from '../apps/knowledge-worker/context.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const RULES = '1528112081172172901';
const directory = [{ name: 'rules', channelId: RULES, purpose: 'Server rules' }];

test('CAP-01 the manifest names her real commands, staff commands only for staff, the owner\'s channels and what she cannot do', () => {
  assert.deepEqual(aiCommandNames({ name: 'support' }), ['sophie', 'lookup']);
  assert.deepEqual(aiCommandNames({ name: 'staff' }), ['sophie', 'lookup', 'whitelist', 'member']);
  const block = capabilityBlock({ context: { name: 'support' }, directory });
  assert.match(block, /\/sophie: Choose whether Sophie talks with you, and manage what she keeps\./u);
  assert.match(block, /\/lookup: Find a reviewed public source without AI generation\./u);
  assert.match(block, /#rules: Server rules/u); assert.doesNotMatch(block, /\/whitelist|\/member/u);
  assert.match(block, /You cannot moderate.*play music.*build and test results\./u);
  assert.match(block, /Whitelist comes only from finishing the Shuttle Activity/u);
  assert.match(capabilityBlock({ context: { name: 'staff' } }), /\/whitelist: .*\n\/member: /u);
  assert.match(capabilityBlock(), /None is listed, so name no channel\./u);
  const request = { character: DRAFT_PERSONALITY, userId: '404', text: 'Where are the rules?', decision: { outcomes: ['reply', 'silent'], answerOnly: false },
    config: { emojis: [], directory }, context: { name: 'support', ...defaultAiContexts().support } };
  const system = buildAiPrompt({ request, history: [], sources: [] }).messages[0].content;
  assert.ok(system.includes(capabilityBlock({ context: request.context, directory })), 'the prompt carries the manifest');
  assert.match(system, /Never judge an incident a member describes/u);
});

test('CAP-02 the channel directory is optional bounded configuration', () => {
  const base = { schemaVersion: 2, enabled: false, deadlineMs: 15000, channels: [], emojis: [], contexts: defaultAiContexts() };
  assert.equal(Object.hasOwn(canonicalAiConfiguration(base), 'directory'), false, 'a configuration without one keeps its form');
  const listed = canonicalAiConfiguration({ ...base, directory: [{ name: 'tickets', channelId: '1528112081172172902', purpose: ' Open a ticket ' }, ...directory] });
  assert.deepEqual(listed.directory.map(entry => [entry.name, entry.purpose]), [['rules', 'Server rules'], ['tickets', 'Open a ticket']]);
  for (const bad of [[{ ...directory[0], name: 'Rules' }], [{ ...directory[0], name: '#rules' }], [{ ...directory[0], channelId: '12' }], [{ ...directory[0], purpose: ' ' }],
    [{ ...directory[0], purpose: 'x'.repeat(161) }], [{ ...directory[0], purpose: 'two\nlines' }], [directory[0], directory[0]], [{ ...directory[0], extra: 1 }],
    Array.from({ length: 17 }, (_, index) => ({ ...directory[0], name: `c${index}` }))]) assert.throws(() => canonicalAiDirectory(bad), /AI_DIRECTORY_INVALID|INVALID/u);
  assert.throws(() => canonicalAiConfiguration({ ...base, schemaVersion: 1, directory }), /AI_CONFIGURATION_INVALID/u);
});

test('CAP-03 a sentence naming an unlisted channel or command is removed; listed, cited, quoted and chatty ones stay', () => {
  const check = (text, options = {}) => checkReply(text, { commands: ['sophie', 'lookup'], directory, ...options });
  assert.deepEqual(check('Read #rules first. Ask in #🎶-music for songs. Use /music to queue one. Try /sophie /srs.'),
    { text: 'Read #rules first. Try /sophie /srs.', removed: { references: 2, verdicts: 0, numbers: 0 }, total: 2 });
  assert.equal(check('Post in #wolfgate-dev.', { cited: 'Ask in #wolfgate-dev on Discord.' }).total, 0, 'a cited passage names it');
  assert.equal(check('Type /looc to talk.', { said: 'what does /looc do?' }).total, 0, 'the member named the command');
  assert.equal(check('PR #123 and issue #7 are open; and/or C# both work; see docs/README.md.').total, 0);
  assert.equal(check('```\n#not-a-channel /notacommand\n```').total, 0, 'code is left alone');
  assert.equal(check('Ask in #wolfgate-dev.').text, null);
});

test('CAP-04 an incident is not judged; what happens to someone and a promise to report are never said', () => {
  const said = 'A guy blew up my ship without saying a word. That\'s RDM, right?';
  const text = 'For Wolfgate, that\'s definitely RDM. Conflict Rule 1 needs escalation in chat first. They\'ll probably get banned. I\'ll report them. In game, press F1.';
  assert.deepEqual(checkReply(text, { said }), { text: 'Conflict Rule 1 needs escalation in chat first. In game, press F1.', removed: { references: 0, verdicts: 3, numbers: 0 }, total: 3 });
  assert.equal(checkReply('No, that\'s against the rules in a safe zone.', { said: 'can I fight in a safe zone?' }).total, 0, 'a rule answer to a question is not a verdict');
  assert.equal(checkReply('If they never escalated, that\'s RDM under Conflict Rule 1.', { said }).total, 0, 'the rule, stated conditionally');
  assert.equal(checkReply('I\'ll let the admins know.', { said: 'hello' }).total, 1);
});

test('CAP-05 in an answer from sources every number must come from a cited passage or the members', () => {
  const cited = 'After activating CI, wait at least five seconds before combat. Safe Zones extend 256m.';
  const sourced = { cited, sourced: true, said: 'what is CI? I have 2 ships' };
  assert.deepEqual(claimedNumbers('Wolfgate has three Safe Zones and a 256-meter radius.'), [256], 'a count of what the sentence lists is not a claim');
  assert.deepEqual(claimedNumbers('You get three formal warnings before a ban; wait 5 seconds; it runs on Space Station 14.'), [5, 3]);
  assert.equal(checkReply('Wait 5 seconds. Safe Zones reach 256 meters. Both of your 2 ships count.', sourced).total, 0, 'digits match words and the member\'s numbers');
  assert.equal(checkReply('You get three formal warnings before a ban.', sourced).total, 1);
  assert.equal(checkReply('About 250 meters.', sourced).total, 1, 'a rounded figure is not what the rule says');
  assert.equal(checkReply('You get three formal warnings before a ban.', { ...sourced, sourced: false }).total, 0, 'only answers from sources are checked');
  assert.equal(checkReply('1. Turn CI on.\n2. Wait.', sourced).total, 0, 'list markers are layout');
  assert.equal(citedText({ citations: ['a'] }, [{ id: 'a', title: 'T', heading: 'H', text: 'X' }, { id: 'b', text: 'Y' }]), 'T\nH\nX');
});

test('CAP-06 a reply keeps what passes; nothing left gives the owner\'s wording for that check, or silence', async () => {
  const reply = { kind: 'reply', text: 'Saved! Ask in #🎶-music.', purpose: 'answer', support: 'general_knowledge', citations: [], memories: [{ scope: 'channel', about: [], text: 'x' }] };
  const fallback = async kind => `fallback ${kind}`;
  assert.deepEqual((await checkedReplyOutput(reply, { remembered: false, fallback })).output,
    { ...reply, text: 'fallback check', purpose: 'conversation', support: 'current_conversation', citations: [] });
  assert.equal((await checkedReplyOutput({ ...reply, text: 'Saved!' }, { remembered: false, fallback })).output.text, 'fallback claim');
  assert.deepEqual((await checkedReplyOutput(reply, { remembered: false })).output, { kind: 'silent', memories: reply.memories });
  const kept = await checkedReplyOutput({ ...reply, text: 'Hello there.' }, { remembered: false, fallback });
  assert.equal(kept.output.text, 'Hello there.'); assert.deepEqual(kept.removed, { claims: 0, references: 0, verdicts: 0, numbers: 0, labels: 0 });});

test('CAP-07 a listed channel renders as a channel link; others stay text', () => {
  const rendered = renderAiReply({ kind: 'reply', text: 'See #rules or #Rules, not #rulesx or C#rules.', purpose: 'answer', support: 'general_knowledge', citations: [] }, [], { channels: directory });
  assert.equal(rendered.content, `See <#${RULES}> or <#${RULES}>, not #rulesx or C#rules.`);
  assert.deepEqual(rendered.allowed_mentions.parse, []);
  assert.throws(() => renderAiReply({ kind: 'reply', text: 'x', purpose: 'answer', support: 'general_knowledge', citations: [] }, [], { channels: [{ name: 'x', channelId: 'abc' }] }), /AI_DIRECTORY_INVALID/u);
});

test('CAP-08 a delivered turn loses unlisted channels and verdicts, links listed channels and says so in fixed codes', async () => {
  const run = async text => {
    const sent = [], traces = [];
    const request = { guildId: '101', channelId: '202', userId: '404', messageId: '303', receivedAt: 1000, deadline: 16000,
      text: 'Someone shot me on Wolfgate, where do I go?', inputRevision: 'original', profile: defaultParticipation('addressed'),
      config: { emojis: [], directory }, character: structuredClone(DRAFT_PERSONALITY), binding: { boundaryEpoch: 1, workerDomain: 'public', releaseHash: 'a'.repeat(64), consentEpoch: 1 },
      decision: { context: true, infer: true, outcomes: ['reply', 'silent'], proactive: false, answerOnly: false } };
    const turns = createAiTurns({ admission: { admit: async () => request, revalidate: async () => true, revalidateSource: async () => true, beginDelivery: async () => true, settle: async () => {} },
      scheduler: { submit: async input => ({ state: 'completed', result: { kind: 'reply', text, purpose: 'answer', support: 'general_knowledge', citations: [] }, input }), cancel() {}, disable() {} },
      context: createAiContext({ clock: () => 1000 }), knowledge: { lookup: async () => [], current: async () => true },
      messages: { reply: async (_request, payload) => { sent.push(payload); return { id: '606' }; }, react: async () => assert.fail('no reaction'), typing: async () => {} },
      clock: () => 1000, trace: code => traces.push(code), checkFallback: async () => 'Synthetic check fallback.' });
    assert.deepEqual(await turns.handle({}), { state: 'delivered' }); await turns.stop();
    return { content: sent[0].content, traces };
  };
  const mixed = await run('That\'s definitely RDM. Read #rules, then ask in #help-desk. In game, press F1.');
  assert.equal(mixed.content, 'In game, press F1.', 'the verdict goes, and so does the sentence that also names an unlisted channel');
  assert.ok(mixed.traces.includes('AI_OUTPUT_VERDICT_REMOVED') && mixed.traces.includes('AI_OUTPUT_REFERENCE_REMOVED'));
  const linked = await run('Read #rules. In game, press F1.');
  assert.equal(linked.content, `Read <#${RULES}>. In game, press F1.`); assert.equal(linked.traces.some(code => code.endsWith('_REMOVED')), false);
  assert.equal((await run('Ask in #help-desk.')).content, 'Synthetic check fallback.');
});
