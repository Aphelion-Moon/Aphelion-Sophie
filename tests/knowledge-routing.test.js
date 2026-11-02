import test from 'node:test';
import assert from 'node:assert/strict';
import { routeQuestion } from '../apps/knowledge/routing.js';
import { familyOf } from '../apps/knowledge/source-family.js';
import { codeSearchTerms } from '../apps/knowledge/code-search.js';
import { buildAiPrompt } from '../apps/knowledge-worker/prompt.js';
import { defaultAiContexts } from '../modules/assistant/participation.js';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const support = { name: 'support', ...defaultAiContexts().support, game: 'ss14-wolfgate' };

test('KR-01 a chat question is routed to development only by unmistakable developer words; /lookup is mixed', () => {
  for (const text of ['Did CI pass on my PR?', 'Did CI pass on the latest Wolfgate pull request?', 'how do I run the CI checks locally before I open a PR to Wolfgate?',
    'the CI failed again', 'why is it failing CI', 'Where is MimePowersSystem in the Wolfgate code?', 'How are pipes handled in the Meridian Rift codebase?',
    'Where is `AlphaSystem` defined?', 'what does Resources/Prototypes/ships.yml set', 'is there a GitHub for Wolfgate?', 'how is gas mining coded?'])
    assert.equal(routeQuestion(text, support), 'development', text);
  for (const text of ['What is CI?', 'what does combat intent mean', 'Do I need to use CI before attacking someone on Wolfgate?', 'what happens if I fail to use CI?',
    'how do I check if someone has CI on', 'is PvP allowed near TSF/PDV outposts?', 'what does code red mean?', 'is the code red alert serious?', 'she/her pronouns please',
    'Can I kill someone who hacked their way into my ship?', 'When is the next Wolfgate event?', 'how does the cloning system work', 'and does Wolfgate use it too?'])
    assert.equal(routeQuestion(text, support), 'gameplay', text);
  assert.equal(routeQuestion('What is CI?', null), 'mixed');
  assert.equal(routeQuestion('Did CI pass on my PR?'), 'mixed');
  assert.throws(() => routeQuestion('x'.repeat(4001), support), /KNOWLEDGE_QUERY_INVALID/);
  assert.deepEqual(codeSearchTerms('Where is `AlphaSystem` defined?'), ['AlphaSystem'], 'code search reads the shared code words unchanged');
});

test('KR-02 source families follow where a document came from', () => {
  const cases = [[['code-abcdefabcdef', 'https://github.com/a/b/blob/c/d.cs'], 'development'], [['gh-wolfgate-aaaaaa', 'https://github.com/VanguardControl/Wolfgate'], 'development'],
    [['gh-wolfgate-recent-bbbbbb', 'https://github.com/VanguardControl/Wolfgate/pulls'], 'general'], [['site-docs-cccccc', 'https://meridian.a13.info/docs/developer/ci/'], 'development'],
    [['site-docs-dddddd', 'https://meridian.a13.info/docs/'], 'development'], [['site-roadmap-eeeeee', 'https://meridian.a13.info/roadmap/'], 'general'],
    [['site-faq-ffffff', 'https://meridian.a13.info/faq/'], 'gameplay'], [['guide-wolfgate-roadmap-aaaaaa', 'https://panel.a13.info/guide/wolfgate'], 'general'],
    [['guide-r6-bbbbbb', 'https://panel.a13.info/guide/wolfgate#RuleR6'], 'gameplay'], [['wiki-ci-cccccc', 'https://meridian-wiki.a13.info/wiki/CI'], 'gameplay'],
    [['glossary-ci', 'https://github.com/pulls'], 'gameplay']];
  for (const [[documentId, url], family] of cases) assert.equal(familyOf({ documentId, url }), family, documentId);
});

test('KR-03 evidence names its source and game, and a question with no evidence is told not to answer from general knowledge', () => {
  const request = text => ({ character: DRAFT_PERSONALITY, userId: '404', text, decision: { outcomes: ['reply', 'silent'], answerOnly: false }, config: { emojis: [] }, context: support });
  const source = (id, game) => ({ id, title: 'Synthetic', heading: 'Synthetic › Rule', authority: 'reference', sourceRevision: 'synthetic-1', text: 'Synthetic rule text.', game });
  const built = buildAiPrompt({ request: request('What does R6 say?'), history: [], sources: [source('guide-r6-aaaaaa.r1.s0', 'ss14-upstream'),
    source('wiki-ci-bbbbbb.r1.s0', 'ss13-meridian'), source('glossary-ci.r1.s0', null), source('code-abcdefabcdef.r1.s0', undefined)] });
  const evidence = built.messages.filter(message => message.content.startsWith('Approved evidence')).map(message => JSON.parse(message.content.split('\n').slice(1).join('\n')));
  assert.deepEqual(evidence.map(item => [item.id, item.source, item.game ?? null]), [['code-abcdefabcdef.r1.s0', 'public code on GitHub', null],
    ['glossary-ci.r1.s0', 'Aphelion owner publication', null], ['guide-r6-aaaaaa.r1.s0', 'Wolfgate Guidebook', 'upstream SS14 ruleset, not Wolfgate or Meridian Rift rules'],
    ['wiki-ci-bbbbbb.r1.s0', 'Meridian Rift wiki', 'SS13 Meridian Rift']]);
  assert.match(built.messages[0].content, /never present a passage from one game, or from an upstream SS14 ruleset, as another game's rule/u);
  const contract = built => built.messages[built.contractMessageIndex].content;
  assert.doesNotMatch(contract(built), /No approved evidence matched/u);
  for (const text of ['What is CI?', 'sophie how far does a safe zone reach', 'when is the next event'])
    assert.match(contract(buildAiPrompt({ request: request(text), history: [], sources: [] })), /No approved evidence matched this message\./u, text);
  assert.doesNotMatch(contract(buildAiPrompt({ request: request('thanks, that helped!'), history: [], sources: [] })), /No approved evidence matched/u);
});
