import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalOnboardingDraft, reviewOnboardingDraft, requireEditorRequestId } from '../modules/onboarding/authoring.js';
import { draftDocument, editorRequestId } from './fixtures/onboarding-authoring.js';
import { publication } from './fixtures/domain.js';

test('incomplete authored pages can be saved as bounded drafts but cannot be published', () => {
  const draft = draftDocument(); draft.stages[0].title = ''; draft.stages[0].body = '';
  assert.deepEqual(canonicalOnboardingDraft(draft), draft);
  const result = reviewOnboardingDraft(publication.id, 2, draft);
  assert.equal(result.valid, false); assert.equal(result.publication, null); assert.deepEqual(result.pages, []); assert.deepEqual(result.errors, ['INVALID_STATIC_TITLE']);
});

test('drafts reject executable settings, oversized text, invalid Unicode and unsupported workflow shapes', () => {
  assert.throws(() => canonicalOnboardingDraft({ ...draftDocument(), execute: 'anything' }), /INVALID_FIELDS/);
  for (const body of ['x'.repeat(5_001), '\u0000', '\ud800']) {
    const draft = draftDocument(); draft.stages[0].body = body; assert.throws(() => canonicalOnboardingDraft(draft), /INVALID_STATIC_COPY/);
  }
  assert.throws(() => canonicalOnboardingDraft({ ...draftDocument(), stages: [] }), /INVALID_SHUTTLE_STEPS/);
  assert.throws(() => requireEditorRequestId('../session'), /SHUTTLE_EDITOR_REQUEST_INVALID/); requireEditorRequestId(editorRequestId());
});

test('static draft review uses the actual publication and pagination contracts without mutating source copy', () => {
  const draft = draftDocument(); draft.stages[0].body = '<script>synthetic text</script>\n\n' + 'Approved static text. '.repeat(150).trim();
  const before = structuredClone(draft), review = reviewOnboardingDraft(publication.id, 2, draft);
  assert.equal(review.valid, true); assert.equal(review.publication.version, 2); assert.deepEqual(draft, before);
  assert.ok(review.pages[0].segments.length > 1); assert.ok(review.pages[0].segments.every(text => text.length <= 1_800));
  assert.equal(review.pages[0].segments[0].startsWith('<script>'), true); // Plain data, never rendered as executable HTML.
  review.publication.stages[0].body = 'Changed'; assert.deepEqual(draft, before);
});

test('one to twenty reordered steps retain their stable identities and reject excessive total bytes', () => {
  const document = draftDocument(); document.stages = document.stages.slice(0, 1);
  assert.equal(reviewOnboardingDraft(publication.id, 2, document).valid, true);
  document.stages = Array.from({ length: 20 }, (_, i) => ({ id: `step-${i}`, title: `Step ${i}`, body: 'Synthetic guidance.' })).reverse();
  const review = reviewOnboardingDraft(publication.id, 2, document);
  assert.equal(review.valid, true); assert.deepEqual(review.publication.stages, document.stages);
  assert.throws(() => canonicalOnboardingDraft({ ...document, stages: [...document.stages, { id: 'extra', title: '', body: '' }] }), /INVALID_SHUTTLE_STEPS/);
  const oversized = { ...document, stages: document.stages.map(stage => ({ ...stage, body: '界 '.repeat(2500) })) };
  assert.throws(() => canonicalOnboardingDraft(oversized), /SHUTTLE_DOCUMENT_TOO_LARGE/);
});

test('duplicate stage IDs and unsplittable copy fail publication review even when their drafts are structurally bounded', () => {
  const duplicate = draftDocument(); duplicate.stages[1].id = duplicate.stages[0].id;
  assert.deepEqual(reviewOnboardingDraft(publication.id, 1, duplicate).errors, ['DUPLICATE_SHUTTLE_STEPS']);
  const long = draftDocument(); long.stages[0].body = 'x'.repeat(1_801);
  assert.deepEqual(reviewOnboardingDraft(publication.id, 1, long).errors, ['STATIC_COPY_BLOCK_TOO_LONG']);
});
