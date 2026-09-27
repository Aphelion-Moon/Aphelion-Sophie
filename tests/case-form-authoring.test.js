import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCaseForm, canonicalCaseFormDraft, caseFormModal } from '../modules/tickets/intake.js';
import { reviewCaseFormDraft, requireFormEditorRequestId } from '../modules/tickets/form-authoring.js';
import { syntheticCaseForm } from './fixtures/case-intake.js';

test('incomplete bounded form copy can be saved but never becomes a valid runtime form', () => {
  const empty = { caseType: 'admin-help', title: '', fields: [] };
  assert.deepEqual(canonicalCaseFormDraft(empty), empty); assert.equal(reviewCaseFormDraft(empty).valid, false);
  for (const change of [form => { form.title = ''; }, form => { form.fields[0].label = ''; },
    form => { form.fields[1].options = []; }, form => { form.fields[1].options[0].label = ''; }]) {
    const form = syntheticCaseForm(); change(form); assert.deepEqual(canonicalCaseFormDraft(form), form);
    assert.equal(reviewCaseFormDraft(form).valid, false); assert.equal(reviewCaseFormDraft(form).preview, null); assert.throws(() => canonicalCaseForm(form));
  }
});

test('form drafts reject unsupported structure, unstable identifiers, unsafe strings and excessive sizes', () => {
  for (const change of [form => { form.fields[0].id = ''; }, form => { form.fields[1].id = form.fields[0].id; },
    form => { form.fields[1].options[1].value = form.fields[1].options[0].value; }, form => { form.fields[0].kind = 'file'; },
    form => { form.caseType = 'quick-help'; }, form => { form.grantRoles = []; }, form => { form.fields[0].condition = 'script'; },
    form => { form.title = '\ud800'; }, form => { form.title = '\u0000'; }, form => { form.title = 'a\nb'; },
    form => { form.fields[0].maxLength = 4_001; }, form => { form.fields[0].description = 'x'.repeat(101); },
    form => { form.fields = Array.from({ length: 6 }, (_, i) => ({ ...form.fields[0], id: `field_${i}` })); },
    form => { form.fields[1].options = Array.from({ length: 26 }, (_, i) => ({ value: `value_${i}`, label: 'Option' })); }]) {
    const form = syntheticCaseForm(); change(form); assert.throws(() => canonicalCaseFormDraft(form));
  }
  for (const value of ['../id', 'A'.repeat(64), 'a'.repeat(63), 123]) assert.throws(() => requireFormEditorRequestId(value), /CASE_FORM_EDITOR_REQUEST_INVALID/);
});

test('authored form review shares runtime presentation without a submit handle, answers or executable preview', () => {
  const form = syntheticCaseForm(); form.title = '<script>Synthetic copy</script>'; const source = structuredClone(form);
  const review = reviewCaseFormDraft(form), modal = caseFormModal({ form, token: 'a'.repeat(48) });
  const { custom_id, ...presentation } = modal.data; assert.ok(custom_id); assert.deepEqual(review.preview, presentation);
  assert.equal(review.valid, true); assert.equal(Object.hasOwn(review.preview, 'custom_id'), false); assert.deepEqual(form, source);
  review.form.fields[0].label = 'Changed'; review.preview.components[1].component.options[0].label = 'Changed'; assert.deepEqual(form, source);
});

test('draft normalization fixes key order and preserves exact text and choice order without sharing mutable input', () => {
  const form = syntheticCaseForm(); form.title = '  Synthetic copy  '; form.fields.reverse(); const reversed = Object.fromEntries(Object.entries(form).reverse());
  const fixed = canonicalCaseFormDraft(reversed); assert.equal(JSON.stringify(fixed), JSON.stringify(form));
  fixed.fields[0].options.reverse(); assert.notDeepEqual(fixed, form); assert.equal(form.fields[0].options[0].value, 'first');
});
