// Builds the story-voice Shuttle draft (owner direction of 22 October 2026) from content/onboarding/story.md: five
// stages, each with Discord-sized message segments, the editor document to publish, and a preview. Nothing is
// published here: the dashboard editor or the host-only command (docs/shuttle-publishing.md) does that.
// Usage: node scripts/build-onboarding-story.mjs
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { paginateStaticText } from '../modules/onboarding/presentation.js';

const root = new URL('../', import.meta.url);
const sourcePath = 'content/onboarding/story.md';
const original = await readFile(new URL(sourcePath, root));
const text = original.toString('utf8').replaceAll('\r\n', '\n').replace(/^<!--[\s\S]*?-->\n/, '');
const parts = text.split(/^=== /m).filter(Boolean).map(part => {
  const newline = part.indexOf('\n'), [id, title] = part.slice(0, newline).split(' | ').map(value => value.trim());
  return { id, title, body: part.slice(newline + 1).trim() };
});
// The five stages only: publications have no entry text, and the launch post is the welcome.
const ids = ['the-brochure', 'pack-your-bags', 'board-the-shuttle', 'admire-the-lights', 'disembarking'];
if (parts.map(part => part.id).join() !== ids.join()) throw new Error('STORY_SOURCE_PARTS_CHANGED');
const result = {
  schemaVersion: 1, id: 'shuttle-story-draft', version: 2, status: 'draft',
  source: { path: sourcePath, sha256: createHash('sha256').update(original).digest('hex'), preserved: false },
  reviewRequired: ['Owner review of the story wording, including the casual rules and signs', 'Publish as a new Shuttle version'],
  changes: ['Story voice: Sophie, Rook and Pip, with must-know facts on in-world signs', 'A boarding call and a Ten Thousand section; the Get Whitelisted heading is shortened',
    'Names what you do, never a button only one surface has', 'Every point of the original guidance is kept (tests/onboarding-story.test.js)'],
  stages: parts.map(({ id, title, body }) => ({ id, title, body, messages: paginateStaticText(body) })),
};
await writeFile(new URL('content/onboarding/story-definition.json', root), `${JSON.stringify(result, null, 2)}\n`);
// The Shuttle editor's draft document for the same stages: what the editor, or the host-only command, saves and publishes.
const draft = { helpPauses: false, stages: result.stages.map(({ id, title, body }) => ({ id, title, body })) };
await writeFile(new URL('content/onboarding/story-draft.json', root), `${JSON.stringify(draft, null, 2)}\n`);
const preview = ['# Shuttle story draft', '', 'For owner review. Not published. Edit content/onboarding/story.md and rebuild.', '',
  `Source SHA-256: \`${result.source.sha256}\`.`, ''];
for (const page of result.stages) {
  preview.push(`## ${page.title}`, '', `${page.messages.length} Discord message segment(s).`, '');
  page.messages.forEach((message, index) => preview.push(`### Message ${index + 1}`, '', message, '', '---', ''));
}
await writeFile(new URL('content/onboarding/story-preview.md', root), `${preview.join('\n').replace(/[ \t]+$/gm, '').trimEnd()}\n`);
console.log(`Built story Shuttle: ${result.stages.length} stages.`);
