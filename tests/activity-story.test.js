import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseMarkdown, renderMarkdown } from '../apps/activity/client/markdown.js';
import { CHUNK_LIMIT, momentFor, transmissionChunks } from '../apps/activity/client/presenter.js';
import { loadActivityContent } from '../apps/activity/content.js';
import { activityStopScene } from '../modules/onboarding/activity.js';
import { headingKey } from '../modules/onboarding/activity-media.js';
import { paginateStaticText } from '../modules/onboarding/presentation.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const story = JSON.parse(await readFile(new URL('../content/onboarding/story-definition.json', import.meta.url), 'utf8'));
const original = JSON.parse(await readFile(new URL('../content/onboarding/definition.json', import.meta.url), 'utf8'));

/** Just enough of a document to render into and read back. */
function fakeDocument() {
  const node = tag => ({ tag, className: '', children: [], dataset: {}, attributes: {}, append(...kids) { this.children.push(...kids); }, setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener() {} });
  return { createElement: node, createDocumentFragment: () => node('#fragment'), createTextNode: text => ({ tag: '#text', text }) };
}
const textOf = item => item.tag === '#text' ? item.text : item.children.map(textOf).join('');
const find = (item, predicate, found = []) => { if (predicate(item)) found.push(item); for (const child of item.children ?? []) find(child, predicate, found); return found; };

test('T-ACT-MD-02 signs render as posted notices and named lines as people talking', () => {
  const tree = parseMarkdown('> **NOTICE · 18+ ONLY**\n> You have to be 18.\n> No second chances.\n\n**Rook:** (( hey ))\n**Pip:** (( hi ))\n\n> just a quote\n\n**Bold** opener, not a line');
  const out = renderMarkdown(fakeDocument(), tree, { onLink() {} });
  const [sign] = find(out, item => item.className === 'md-notice');
  assert.equal(sign.tag, 'aside'); assert.equal(sign.attributes['aria-label'], 'Notice: 18+ ONLY');
  assert.equal(textOf(find(sign, item => item.className === 'md-notice-label')[0]), '18+ ONLY');
  assert.match(textOf(sign), /You have to be 18\.[\s\S]*No second chances\./); assert.doesNotMatch(textOf(sign), /NOTICE/);
  const lines = find(out, item => item.className === 'md-line');
  assert.deepEqual(lines.map(line => line.dataset.speaker), ['rook', 'pip']);
  assert.deepEqual(lines.map(textOf), ['Rook (( hey ))', 'Pip (( hi ))']);
  assert.equal(find(out, item => item.tag === 'blockquote').length, 1, 'an ordinary quote stays a quote');
  assert.equal(find(out, item => item.className === 'md-line').length, 2, 'a bold opener alone is not dialogue');
});

test('T-ACT-STORY-01 story pages: each section opens its own page, pages stay short, and every page stages its own section', async () => {
  const content = await loadActivityContent(root);
  story.stages.forEach((stage, index) => {
    const chunks = transmissionChunks(paginateStaticText(stage.body)), moments = content.defaults.stages[stage.id] ?? {};
    const sections = [...stage.body.matchAll(/^# (.+)$/gm)].length;
    assert.equal(chunks.filter(chunk => /^# /.test(chunk)).length, sections, `${stage.id}: every section opens a page`);
    for (const chunk of chunks) assert.ok(chunk.length <= CHUNK_LIMIT || !chunk.includes('\n\n'), `${stage.id}: page within ${CHUNK_LIMIT}`);
    const stopScene = activityStopScene(index, story.stages.length);
    chunks.forEach((chunk, i) => {
      const heading = /^# (.+)$/m.exec(chunk);
      const moment = momentFor(chunks, i, moments);
      if (heading && moment.beat !== 'none') {
        // The scene stages the beat of the heading on this very page, and that beat is one its scene draws.
        assert.ok(content.sceneBeats.get(moment.scene ?? stopScene).includes(moment.beat), `${stage.id}: ${heading[1]}`);
      }
    });
  });
  // Every section heading but the boarding call has a moment, in both the story and the original copy.
  for (const draft of [story, original]) {
    for (const stage of draft.stages) {
      for (const [, heading] of stage.body.matchAll(/^# (.+)$/gm)) {
        if (heading === 'Boarding call') continue;
        const key = headingKey(heading);
        assert.ok(Object.hasOwn(content.defaults.stages[stage.id], key), `${draft.id} ${stage.id}: ${heading}`);
      }
    }
  }
});

test('T-ACT-STORY-02 Feedback is a two-way street is staged on its own page in both drafts', async () => {
  const content = await loadActivityContent(root);
  for (const draft of [story, original]) {
    const stage = draft.stages.at(-1), chunks = transmissionChunks(paginateStaticText(stage.body));
    const staged = chunks.map((_, i) => momentFor(chunks, i, content.defaults.stages.disembarking).beat);
    assert.ok(staged.includes('feedback'), `${draft.id}: ${staged.join(',')}`);
  }
});
