import test from 'node:test';
import assert from 'node:assert/strict';
import { caseIntakePages, intakeTextParts, renderCaseIntakeMessage, validateCaseIntakePayload } from '../modules/tickets/intake-messages.js';
import { syntheticCaseForm, syntheticCaseValues } from './fixtures/case-intake.js';
import { casePolicy } from './fixtures/cases.js';
import { STAFF, LEAD } from './fixtures/domain.js';

test('retained form rendering is bounded, ordered and reconstructs escaped text without truncation', () => {
  const form = syntheticCaseForm(); form.fields = Array.from({ length: 5 }, (_, index) => ({ ...form.fields[0], id: `field${index}`, maxLength: 4_000 }));
  const values = form.fields.map(field => ({ id: field.id, kind: 'text', value: '*'.repeat(4_000) }));
  const pages = caseIntakePages({ caseType: form.caseType, form, formVersion: 2, answers: values }); assert.equal(pages.length, 16);
  for (const [index, page] of pages.entries()) {
    const payload = renderCaseIntakeMessage({ id: index.toString(16).padStart(32, '0'), page, caseType: form.caseType, policy: casePolicy });
    assert.doesNotThrow(() => validateCaseIntakePayload(payload, index.toString(16).padStart(32, '0')));
    assert.equal(payload.embeds[0].description.length <= 4_096, true);
    assert.deepEqual(payload.allowed_mentions.roles, index === pages.length - 1 ? [STAFF] : []);
  }
  for (let index = 0; index < 5; index++) {
    const text = pages.slice(index * 3, index * 3 + 3).map(page => page.description.slice('Submitted response:\n'.length, -'\n\nEnd of response part.'.length)).join('');
    assert.equal(text.replaceAll('\\*', '*'), values[index].value);
  }
});

test('intake pagination preserves Unicode and escaped Markdown units including boundary whitespace', () => {
  const value = '  \n' + '🛰️*'.repeat(700) + '\n  ', parts = intakeTextParts(value);
  assert.equal(parts.every(part => part.isWellFormed() && part.length <= 3_500), true);
  assert.equal(parts.join('').replaceAll('\\*', '*'), value);
  assert.throws(() => intakeTextParts('\ud800'));
});

test('Quick Help emits only its notice while Head Admin forms target lead ops and preserve the selected label', () => {
  const pages = caseIntakePages({ caseType: 'quick-help', form: null, formVersion: null, answers: [] }); assert.equal(pages.length, 1);
  const form = syntheticCaseForm('head-admin-contact'), values = syntheticCaseValues();
  const head = caseIntakePages({ caseType: form.caseType, form, formVersion: 1, answers: values });
  assert.equal(head[1].description.includes('First synthetic option'), true);
  const message = renderCaseIntakeMessage({ id: 'a'.repeat(32), page: head.at(-1), caseType: form.caseType, policy: casePolicy });
  assert.deepEqual(message.allowed_mentions.roles, [LEAD]); assert.equal(message.content.includes(STAFF), false);
});

test('intake payloads cannot add attachments, extra embeds, user mentions, controls or unbounded content', () => {
  const id = 'a'.repeat(32), payload = renderCaseIntakeMessage({ id, page: { kind: 'answer', title: 'Synthetic question', description: 'Synthetic answer' }, caseType: 'admin-help', policy: casePolicy });
  for (const changed of [{ ...payload, attachments: [] }, { ...payload, embeds: [payload.embeds[0], payload.embeds[0]] },
    { ...payload, allowed_mentions: { ...payload.allowed_mentions, users: [STAFF] } }, { ...payload, content: '@everyone' },
    { ...payload, embeds: [{ ...payload.embeds[0], description: 'x'.repeat(4_097) }] }, { ...payload, components: [{}] }]) assert.throws(() => validateCaseIntakePayload(changed, id));
});
