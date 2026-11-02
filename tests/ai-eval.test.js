import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, evaluateAsserts, forbiddenRows, goldHit, goldMatches, sourceLabels, summarize } from '../scripts/lib/ai-eval/asserts.mjs';
import { documentsForLoad, goldPassages, passagesOf } from '../scripts/lib/ai-eval/snapshot.mjs';
import { prepareTurn, runTurn } from '../scripts/lib/ai-eval/turn.mjs';
import { DRAFT_PERSONALITY } from '../modules/assistant/personality.js';

const NOW = Date.UTC(2026, 10, 2, 12);
const doc = (id, url, sections, extra = {}) => ({ id, title: extra.title ?? id, kind: 'wiki-page', authority: 'policy', url, rights: 'Synthetic rights',
  attribution: 'Synthetic author', sourceRevision: 'synthetic-1', dependencyHash: 'a'.repeat(64), fetchedAt: NOW - 1000, validUntil: NOW + 1000,
  aliases: [], sections: sections.map(([heading, text]) => ({ heading, text })), ...extra });
// A synthetic stand-in for the CI collision: a game rule, a developer page and a Wolfgate escalation rule share the word.
const corpus = [
  doc('wiki-antagonist-policy', 'https://meridian-wiki.a13.info/wiki/Antagonist_Policy', [['Antagonist Policy › Combat Indicator (CI) CI-01', 'Synthetic: signal combat with the indicator first.'],
    ['Antagonist Policy › Combat State CI-02', 'Synthetic: combat state follows the indicator.']]),
  doc('site-docs-tests', 'https://meridian.a13.info/docs/tests', [['Required Tests (Continuous Integration)', 'Synthetic: CI runs the unit tests on each pull request.']], { kind: 'website', authority: 'reference' }),
  doc('guide-conflict-one', 'https://panel.a13.info/guide/wolfgate#MonolithRuleConflictOneRandomDeathmatch', [['Conflict Rule 1', 'Synthetic: declare escalation in local chat.']], { kind: 'guidebook' }),
  doc('owner-glossary-ci', 'https://example.test/glossary/ci', [['Combat Indicator (CI) on Meridian Rift', 'Synthetic glossary text.'], ['CI on Wolfgate', 'Synthetic: Wolfgate uses Conflict Rule 1.']],
    { kind: 'owner-publication', validUntil: null, aliases: ['CI', 'combat intent'] }),
];

test('AE-01 evaluation labels read a passage address independently of the code under test', () => {
  assert.deepEqual(sourceLabels({ url: 'https://meridian.a13.info/docs/tests' }), { family: 'development', game: 'ss13-meridian' });
  assert.deepEqual(sourceLabels({ url: 'https://github.com/VanguardControl/Wolfgate/blob/master/README.md' }), { family: 'development', game: 'ss14-wolfgate' });
  assert.deepEqual(sourceLabels({ url: 'https://meridian-wiki.a13.info/wiki/Policies' }), { family: 'gameplay', game: 'ss13-meridian' });
  assert.equal(sourceLabels({ url: 'https://panel.a13.info/guide/wolfgate#MonolithRuleConflictOneRandomDeathmatch' }).game, 'ss14-wolfgate');
  assert.equal(sourceLabels({ url: 'https://panel.a13.info/guide/wolfgate#MonolithRuleset' }).game, 'ss14-wolfgate');
  for (const anchor of ['RuleR6', 'RuleR11-1', 'RuleC14', 'MRPRuleset', 'FrontierRuleset', 'CoreRules', 'RoleplayRules'])
    assert.equal(sourceLabels({ url: `https://panel.a13.info/guide/wolfgate#${anchor}` }).game, 'ss14-upstream', anchor);
  for (const anchor of ['WFRuleConflictFiveDeclaringWar', 'BasicLore', 'Piloting']) assert.equal(sourceLabels({ url: `https://panel.a13.info/guide/wolfgate#${anchor}` }).game, 'ss14-wolfgate', anchor);
  assert.equal(sourceLabels({ url: 'https://example.test/glossary/ci', game: 'both' }).game, 'both');
  assert.deepEqual(sourceLabels({ url: 'not a url' }), { family: 'gameplay', game: null });
});

test('AE-02 gold names passages by document, address and heading, as any or all', () => {
  const rows = [{ id: 'wiki-antagonist-policy.r7.s0', url: corpus[0].url, heading: corpus[0].sections[0].heading }];
  assert.equal(goldMatches(rows[0], { document: '^wiki-antagonist', heading: '\\(CI\\)' }), true);
  assert.equal(goldMatches(rows[0], { url: 'Antagonist_Policy', heading: 'CI-02' }), false);
  assert.equal(goldMatches(rows[0], {}), false);
  assert.equal(goldHit(rows, null), null);
  assert.equal(goldHit(rows, { any: [{ url: 'glossary' }, { url: 'Antagonist_Policy' }] }), true);
  assert.equal(goldHit(rows, { all: [{ url: 'glossary' }, { url: 'Antagonist_Policy' }] }), false);
  assert.deepEqual(forbiddenRows([{ url: corpus[1].url }, { url: corpus[0].url }], [{ family: 'development' }]).map(row => row.url), [corpus[1].url]);
  assert.equal(forbiddenRows([{ url: 'https://meridian-wiki.a13.info/wiki/Red_Server_Policy' }], [{ url: 'Red_Server' }]).length, 1);
});

const reply = (text, extra = {}) => ({ outcome: 'reply', support: 'provided_sources', citations: [], memoriesProposed: [], requesterLabel: 'Member 1',
  rendered: { content: text, embeds: [] }, sources: [], ...extra });

test('AE-03 asserts judge what a member would see, and an errored turn always fails', () => {
  assert.deepEqual(evaluateAsserts({ error: 'AI_WORKER_UNAVAILABLE' }, { forbidText: ['x'] }), { pass: false, failures: ['error: AI_WORKER_UNAVAILABLE'] });
  assert.equal(evaluateAsserts(reply('CI is the Combat Indicator.'), { requireText: ['Combat Indicator'], forbidText: ['continuous integration'] }).pass, true);
  assert.equal(evaluateAsserts(reply('CI means continuous integration.'), { forbidText: ['continuous integration'] }).pass, false);
  assert.equal(evaluateAsserts({ ...reply(''), outcome: 'silent', rendered: null }, { notOutcome: 'silent' }).pass, false);
  const pointer = { pointer: ['ahelp|admin help|F1'], noVerdict: true };
  assert.equal(evaluateAsserts(reply('Killing without escalation is covered by Conflict Rule 1. Press F1 to ahelp and staff will look at it.'), pointer).pass, true);
  for (const text of ["That's RDM, press F1 to ahelp.", 'Press F1; they will be banned for that.', "Press F1 and I'll report it for you."])
    assert.deepEqual(evaluateAsserts(reply(text), pointer).failures, ['judges the incident'], text);
  assert.deepEqual(evaluateAsserts(reply('Open a ticket.'), pointer).failures, ['no pointer matching ahelp|admin help|F1']);
  const sources = [{ id: 'a.r1.s0', url: corpus[0].url }, { id: 'b.r1.s0', url: corpus[2].url }, { id: 'c.r1.s0', url: corpus[1].url }];
  assert.equal(evaluateAsserts(reply('x', { sources, citations: ['b.r1.s0'] }), { requireCitationGame: 'ss14-wolfgate', requireCitationUrl: ['MonolithRule'] }).pass, true);
  assert.deepEqual(evaluateAsserts(reply('x', { sources, citations: ['a.r1.s0'] }), { requireCitationGame: 'ss14-wolfgate', forbidCitationUrl: ['Antagonist'] }).failures,
    ['cites Antagonist', 'no citation from ss14-wolfgate']);
  assert.deepEqual(evaluateAsserts(reply('x', { sources }), { forbidSourceFamily: 'development' }).failures, ['given a development passage']);
  assert.equal(evaluateAsserts(reply('Saved! I will remember that.'), { claimNeedsMemory: true }).pass, false);
  assert.equal(evaluateAsserts(reply('Saved!', { memoriesProposed: [{ scope: 'member', about: ['Member 1'], text: 'x' }] }), { claimNeedsMemory: true, memoryAboutRequester: true }).pass, true);
  assert.equal(evaluateAsserts(reply('x', { memoriesProposed: [{ scope: 'member', about: ['Member 2'], text: 'x' }] }), { memoryAboutRequester: true }).pass, false);
  assert.equal(evaluateAsserts(reply('a\n-# one <https://a.test/1>\n-# two <https://a.test/2>'), { minLinks: 2 }).pass, true);
});

test('AE-04 diagnosis says where a failure lies', () => {
  const hit = { goldInSnapshot: true, goldHit: true, forbidden: 0 }, miss = { goldInSnapshot: true, goldHit: false, forbidden: 0 };
  const all = { passed: 3, runs: 3 }, none = { passed: 0, runs: 3 }, some = { passed: 1, runs: 3 };
  assert.equal(diagnose({ gold: true, retrieval: miss, oracle: none, endToEnd: all }), 'pass');
  assert.equal(diagnose({ gold: true, retrieval: hit, oracle: all, endToEnd: some }), 'flaky');
  assert.equal(diagnose({ gold: true, retrieval: { ...miss, goldInSnapshot: false }, oracle: none, endToEnd: none }), 'coverage');
  assert.equal(diagnose({ gold: true, retrieval: miss, oracle: all, endToEnd: none }), 'retrieval');
  assert.equal(diagnose({ gold: true, retrieval: { ...hit, forbidden: 1 }, oracle: all, endToEnd: none }), 'retrieval');
  assert.equal(diagnose({ gold: true, retrieval: hit, oracle: all, endToEnd: none }), 'interference');
  assert.equal(diagnose({ gold: true, retrieval: hit, oracle: none, endToEnd: none }), 'model');
  assert.equal(diagnose({ gold: true, retrieval: hit, oracle: some, endToEnd: none }), 'flaky');
  assert.equal(diagnose({ gold: true, retrieval: miss }), 'retrieval');
  assert.equal(diagnose({ gold: true, retrieval: hit }), 'retrieved');
  assert.equal(diagnose({ gold: false, retrieval: { goldInSnapshot: null, goldHit: null, forbidden: 0 }, endToEnd: none }), 'undetermined');
  assert.deepEqual(summarize([{ class: 'a', diagnosis: 'pass' }, { class: 'a', diagnosis: 'model' }, { diagnosis: 'pass' }]),
    { cases: 3, byDiagnosis: { pass: 2, model: 1 }, byClass: { a: { cases: 2, pass: 1, model: 1 }, unclassified: { cases: 1, pass: 1 } } });
});

test('AE-05 a snapshot loads fresh, with overlays replacing documents and importer documents relabelled', () => {
  const importer = doc('meridian-policies', 'https://meridian-wiki.a13.info/wiki/Policies', [['Core Rules', 'Synthetic core rules.']], { kind: 'mediawiki' });
  const overlay = { ...corpus[3], title: 'CI: Combat Indicator' };
  const loaded = documentsForLoad([...corpus, importer], NOW, [overlay]);
  assert.deepEqual(loaded.map(item => item.id), ['guide-conflict-one', 'meridian-policies', 'owner-glossary-ci', 'site-docs-tests', 'wiki-antagonist-policy']);
  assert.equal(loaded.find(item => item.id === 'meridian-policies').kind, 'owner-publication');
  assert.equal(loaded.find(item => item.id === 'owner-glossary-ci').title, 'CI: Combat Indicator');
  assert.equal(loaded.find(item => item.id === 'owner-glossary-ci').validUntil, null);
  for (const item of loaded) { assert.equal(item.fetchedAt, NOW); assert.ok(item.validUntil === null || item.validUntil > NOW); }
  assert.throws(() => documentsForLoad([{ ...corpus[0], sections: [] }], NOW), /KNOWLEDGE_DOCUMENT_INVALID/);
});

test('AE-06 gold passages for the oracle are shaped as the lookup returns them', () => {
  const passages = passagesOf(documentsForLoad(corpus, NOW).map(document => ({ document, publicationHash: 'b'.repeat(64) })));
  assert.equal(passages.length, 6);
  assert.deepEqual(Object.keys(passages[0]).sort(), ['attribution', 'authority', 'epoch', 'exact', 'heading', 'id', 'publicationHash', 'rights', 'sourceRevision', 'text', 'title', 'url', 'validUntil']);
  assert.deepEqual(goldPassages(passages, { any: [{ document: 'owner-glossary-ci' }, { heading: '\\(CI\\)' }] }).map(row => row.id),
    ['owner-glossary-ci.r1.s0', 'owner-glossary-ci.r1.s1', 'wiki-antagonist-policy.r1.s0']);
  assert.deepEqual(goldPassages(passages, { all: [{ document: 'owner-glossary-ci' }, { url: 'MonolithRule' }] }).map(row => row.id), ['owner-glossary-ci.r1.s0', 'guide-conflict-one.r1.s0']);
  assert.equal(goldPassages(passages, { any: [{ url: '.' }] }).length, 6);
  assert.deepEqual(goldPassages(passages, null), []);
});

test('AE-07 an evaluated turn runs the real prompt, validation and rendering around the injected model call', async () => {
  const passages = passagesOf(documentsForLoad(corpus, NOW).map(document => ({ document, publicationHash: 'b'.repeat(64) })));
  const sources = goldPassages(passages, { any: [{ document: 'owner-glossary-ci' }] });
  const item = { id: 'wg-ci', context: 'support', game: 'ss14-wolfgate', text: 'What is CI on Wolfgate?' };
  const options = { guildId: '100000000000000101', character: DRAFT_PERSONALITY, configuration: null, now: NOW };
  const { payload } = prepareTurn(item, sources, options);
  assert.match(payload.messages[0].content, /usually about SS14 and Wolfgate/u);
  assert.equal(payload.messages.filter(message => message.content.startsWith('Approved evidence')).length, 2);
  let seen = null;
  const record = await runTurn(item, sources, { ...options, generate: async value => { seen = value; return { kind: 'reply', text: 'Wolfgate uses Conflict Rule 1 instead of CI.', purpose: 'answer', support: 'provided_sources', citations: ['owner-glossary-ci.r1.s1'] }; } });
  assert.equal(seen.boundary.continuity, 'evaluation');
  assert.equal(record.outcome, 'reply'); assert.equal(record.requesterLabel, 'Member 1');
  assert.match(record.rendered.content, /Conflict Rule 1[\s\S]*<https:\/\/example\.test\/glossary\/ci>/u);
  assert.equal(evaluateAsserts(record, { support: 'provided_sources', requireText: ['Conflict Rule 1'], forbidText: ['continuous integration'] }).pass, true);
  assert.equal((await runTurn(item, sources, { ...options, generate: async () => { throw new Error('AI_WORKER_UNAVAILABLE'); } })).error, 'AI_WORKER_UNAVAILABLE');
  assert.equal((await runTurn(item, sources, { ...options, generate: async () => ({ kind: 'reply', text: '' }) })).validation, 'AI_OUTPUT_INVALID');
  assert.equal((await runTurn({ ...item, context: 'nowhere' }, sources, { ...options, generate: async () => null })).error, 'AI_EVAL_CONTEXT_INVALID');
});
