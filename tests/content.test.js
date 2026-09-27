import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { paginateStaticText } from '../modules/onboarding/presentation.js';

const root = new URL('../', import.meta.url);
const draft = JSON.parse(await readFile(new URL('content/onboarding/definition.json', root), 'utf8'));

test('T19 supplied policy copy remains a draft with intact source provenance', async () => {
  const bytes = await readFile(new URL(draft.source.path, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), draft.source.sha256);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.stages.length, 5);
  assert.match(draft.stages[0].body, /You have already been age-checked once/);
  assert.match(draft.stages[4].body, /Get Whitelisted/);
});

test('T19/T51 draft message splits preserve all words and have bounded lengths', () => {
  for (const page of [draft.entry, ...draft.stages]) {
    assert.deepEqual(page.messages, paginateStaticText(page.body));
    assert.ok(page.messages.every(message => message.length > 0 && message.length <= 1_800));
    assert.equal(page.messages.join(' ').replace(/\s+/g, ' '), page.body.replace(/\s+/g, ' '));
    assert.doesNotMatch(page.body, /React to|By reacting|tick and untick/);
  }
});

test('T51 unsupported oversized static blocks fail instead of being silently truncated', () => {
  assert.throws(() => paginateStaticText('x'.repeat(2_000)), { code: 'STATIC_COPY_BLOCK_TOO_LONG' });
});
