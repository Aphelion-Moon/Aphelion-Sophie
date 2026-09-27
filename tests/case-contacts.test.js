import test from 'node:test';
import assert from 'node:assert/strict';
import { caseContactReply, contactRecipientIds, parseContactControl } from '../modules/tickets/contacts.js';
import { canonicalCaseForm, PUBLIC_CASE_TYPES, parseCaseIntakeControl } from '../modules/tickets/intake.js';
import { createFormController, FORM_CATEGORIES } from '../apps/dashboard/form-controller.js';
import { createSyntheticFormApi } from './fixtures/dashboard-forms.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { contactEntryPayload, contactSelectionPayload, contactControlPayload } from './fixtures/case-contacts.js';
import { syntheticCaseForm } from './fixtures/case-intake.js';
import { USER, OTHER } from './fixtures/domain.js';

test('signed contact selection preserves the Staff actor and discards resolved roles and source message content', () => {
  const f = syntheticInteractions(), payload = contactSelectionPayload(f, [USER]);
  payload.data.id = 42; payload.data.resolved = { members: { [USER]: { roles: ['999'], content: 'Synthetic untrusted metadata' } } };
  payload.message.content = 'Synthetic source message';
  const envelope = f.verifier.verify(f.signed(payload));
  assert.equal(envelope.command, 'ticket.contact.select'); assert.equal(envelope.userId, OTHER); assert.equal(envelope.targetId, OTHER);
  assert.deepEqual(envelope.recipientIds, [USER]); assert.equal(JSON.stringify(envelope).includes('Synthetic'), false);
  assert.equal(Object.isFrozen(envelope.recipientIds), true); assert.throws(() => envelope.recipientIds.push(OTHER));
  assert.throws(() => f.verifier.resolvePrincipal({ ...envelope }), /UNTRUSTED_PRINCIPAL/);
  for (const values of [[], [USER, USER], ['0'], Array.from({ length: 21 }, (_, index) => String(index + 1))]) {
    assert.throws(() => contactRecipientIds(values)); const bad = contactSelectionPayload(f, values); assert.throws(() => f.verifier.verify(f.signed(bad)));
  }
  for (const data of [{ ...payload.data, component_type: 6 }, { ...payload.data, custom_id: 'unreviewed' }, { ...payload.data, extra: true }])
    assert.throws(() => f.verifier.verify(f.signed({ ...payload, data })));
});

test('contact controls carry routing only and public entry cannot bypass audience confirmation', () => {
  const f = syntheticInteractions(), token = 'ab'.repeat(24);
  for (const action of ['confirm', 'cancel', 'destination']) {
    const envelope = f.verifier.verify(f.signed(contactControlPayload(f, action, token)));
    assert.equal(envelope.command, `ticket.contact.${action}`); assert.equal(envelope.userId, OTHER);
  }
  for (const value of ['sophie:contact:v1:confirm:start', 'sophie:contact:v1:destination:1', 'sophie:contact:v2:cancel:' + token]) assert.throws(() => parseContactControl(value));
  assert.equal(f.verifier.verify(f.signed(contactEntryPayload(f))).command, 'ticket.contact.start');
  assert.equal(f.verifier.verify(f.signed(contactEntryPayload(f, 'contacts'))).command, 'ticket.contact.queue');
  assert.equal(PUBLIC_CASE_TYPES.includes('staff-contact'), false);
  assert.throws(() => parseCaseIntakeControl('sophie:ticket:v1:open:staff-contact'));
  assert.deepEqual(canonicalCaseForm(syntheticCaseForm('staff-contact')), syntheticCaseForm('staff-contact'));
});

test('contact review exposes the exact bounded audience with explicit confirmation and no automatic user ping', () => {
  const token = 'ab'.repeat(24), select = caseContactReply({ state: 'select' });
  assert.equal(select.components[0].components[0].max_values, 20);
  const review = caseContactReply({ state: 'review', token, openerId: OTHER, recipientIds: [USER] });
  assert.match(review.content, /retained case history/); assert.match(review.content, /Staff and lead ops/);
  assert.ok(review.content.includes(USER)); assert.equal(review.content.includes(`<@${USER}>`), false);
  assert.deepEqual(review.components[0].components.map(button => parseContactControl(button.custom_id).command), ['ticket.contact.confirm', 'ticket.contact.cancel']);
  assert.equal(JSON.stringify(review).includes('presenceEpoch'), false);
  assert.throws(() => caseContactReply({ state: 'queue', items: Array(6).fill({ token }), next: null }));
});

test('Staff-contact configuration uses an independent reviewed browser category with no intake data', async () => {
  const f = createSyntheticFormApi(); let sequence = 0;
  const controller = createFormController({ api: f.api, onChange: () => {}, newRequestId: () => (++sequence).toString(16).padStart(64, '0') });
  await controller.start(); await controller.selectResource('staff-contact');
  controller.updateTitle('Synthetic Staff contact'); controller.addField(); controller.updateField(0, 'label', 'Synthetic authored question');
  await controller.save(); await controller.review(); assert.equal(controller.snapshot().review.valid, true); await controller.publish();
  assert.equal(FORM_CATEGORIES.length, 7); assert.equal(f.state.records.get('staff-contact').publications.length, 1);
  assert.equal(f.state.records.get('player-report').publications.length, 0); assert.equal(f.state.records.get('admin-help').publications.length, 1);
  assert.equal(Object.hasOwn(controller.snapshot(), 'answers'), false);
});
