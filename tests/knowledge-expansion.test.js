import test from 'node:test';
import assert from 'node:assert/strict';
import { acronymCandidates, phraseWords, queryPhrases } from '../apps/knowledge/query-expansion.js';

test('KX-01 question phrases are every run of one to four words, split as aliases are normalised', () => {
  const phrases = queryPhrases('What does combat-intent mean on Wolfgate?');
  for (const phrase of ['combat', 'combat intent', 'what does combat intent', 'intent mean on wolfgate']) assert.ok(phrases.includes(phrase), phrase);
  assert.ok(!phrases.includes('what does combat intent mean'), 'at most four words');
  assert.deepEqual(phraseWords("Wizard's Den / IC-in-OOC"), ['wizard', 's', 'den', 'ic', 'in', 'ooc']);
  assert.equal(queryPhrases('word '.repeat(500)).length, 4, 'repeated words collapse');
  assert.ok(queryPhrases(Array.from({ length: 200 }, (_, index) => `w${index}`).join(' ')).length <= 200, 'bounded');
});

test('KX-02 capitals and a one-word message are heading terms; rule codes, game names and chat are not', () => {
  assert.deepEqual(acronymCandidates('What is CI?'), ['CI']);
  assert.deepEqual(acronymCandidates('rdm?'), ['RDM']);
  assert.deepEqual(acronymCandidates('what does PMS mean in the CI rules'), ['PMS', 'CI']);
  assert.deepEqual(acronymCandidates('what does CR 1 say'), [], 'a rule code is handled as a code');
  assert.deepEqual(acronymCandidates('is SS14 different from SS13? LOL'), []);
  assert.deepEqual(acronymCandidates('WHAT IS THE NLR'), ['NLR'], 'shouting keeps only the term');
  assert.deepEqual(acronymCandidates('what is rdm'), [], 'lower case in a sentence is left to the glossary aliases');
  assert.equal(acronymCandidates('AA BB CC DD EE').length, 3);
});
