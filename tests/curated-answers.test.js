import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalAnswer, requireAnswerName } from '../modules/answers/index.js';

test('T45 public authored answers are bounded literal data with no case import or executable fields', () => {
  const value = { title: 'Synthetic public answer', text: '@everyone ${literal} <script>\n🛰️', source: 'Synthetic public authored reference' };
  assert.deepEqual(canonicalAnswer(value), value);
  for (const input of [{ ...value, caseId: 'ticket' }, { ...value, template: 'execute()' }, { ...value, text: 'a'.repeat(4001) },
    { ...value, text: '\ud800' }, { ...value, source: '' }, { ...value, title: 'a\nb' }, { ...value, text: '\0' }]) assert.throws(() => canonicalAnswer(input), /ANSWER_INPUT_INVALID/);
  for (const name of ['../name','Name','', 'a'.repeat(41)]) assert.throws(() => requireAnswerName(name), /ANSWER_INPUT_INVALID/);
  assert.doesNotThrow(() => requireAnswerName('public-help'));
});
