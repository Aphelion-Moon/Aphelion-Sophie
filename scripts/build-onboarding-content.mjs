import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { paginateStaticText } from '../modules/onboarding/presentation.js';

const root = new URL('../', import.meta.url);
const sourcePath = 'Sophie-Implementation-Plans-v1.1/shuttle-onboarding.md';
const original = await readFile(new URL(sourcePath, root));
const normalized = original.toString('utf8').replaceAll('\r\n', '\n');
const markers = ['Rules page entry:', 'The Brochure:', 'Pack Your Bags:', 'Board The Shuttle:', 'Admire the lights:', 'Disembarking'];
const ids = ['the-brochure', 'pack-your-bags', 'board-the-shuttle', 'admire-the-lights', 'disembarking'];
const titles = ['The Brochure', 'Pack Your Bags', 'Board the Shuttle', 'Admire the Lights', 'Disembarking'];
const positions = markers.map(marker => {
  const pattern = new RegExp(`^${marker}\\s*$`, 'gm');
  const matches = [...normalized.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('SHUTTLE_SOURCE_MARKERS_CHANGED');
  return matches[0].index;
});
if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) throw new Error('SHUTTLE_SOURCE_ORDER_CHANGED');
const blocks = positions.map((position, index) => normalized.slice(position + markers[index].length, positions[index + 1]).trim());
const replacements = [
  ['use the reaction at the end of each page to continue. The final reaction grants your **Whitelist** role.', 'choose Continue at the end of each page. Completing the final acknowledgement requests your **Whitelist** role automatically.'],
  ['You can repeat this process at any time, but you will need to tick and untick the reaction roles again.', 'You can repeat the Shuttle at any time to review the latest published guidance. Your existing Whitelist access stays in place.'],
  [':book: **React to begin at #the-brochure .**', '**Choose Start Shuttle to begin The Brochure.**'],
  [':luggage: **React to continue to #pack-your-bags .**', '**Choose Continue to open Pack Your Bags.**'],
  [':rocket: **React to continue to #board-the-shuttle .**', '**Choose Continue to open Board the Shuttle.**'],
  [':milky_way: **React to continue and #admire-the-lights .**', '**Choose Continue to open Admire the Lights.**'],
  [':airplane_arriving: **React to continue to #disembarking .**', '**Choose Continue to open Disembarking.**'],
  ['By reacting below, you confirm that:', 'By choosing Complete Shuttle, you confirm that:'],
  [':white_check_mark: **React to receive the Whitelist role and gain access to our game servers.**', '**Choose Complete Shuttle to request your Whitelist role. Access is confirmed after the role is applied.**'],
];
let converted = blocks.join('\n\n@@SHUTTLE_BLOCK@@\n\n');
for (const [before, after] of replacements) {
  if (!converted.includes(before)) throw new Error('SHUTTLE_SOURCE_COPY_CHANGED');
  converted = converted.replace(before, after);
}
converted = converted.split('\n').filter(line => !line.startsWith('> ### Disclaimer:') && !line.startsWith('> ### I\'m already looking')).join('\n');
const adapted = converted.split('\n\n@@SHUTTLE_BLOCK@@\n\n').map(text => text.trim());
if (adapted.length !== 6) throw new Error('SHUTTLE_SOURCE_BLOCKS_CHANGED');
const result = {
  schemaVersion: 1, id: 'shuttle-initial-draft', version: 1, status: 'draft',
  source: { path: sourcePath, sha256: createHash('sha256').update(original).digest('hex'), preserved: true },
  reviewRequired: ['Approve button wording and message pagination', 'Resolve channel/user references using approved Discord IDs', 'Validate staging interactions and permissions before publication'],
  changes: ['Replace legacy reactions/channel-unlocking directions with deterministic button wording', 'Remove the obsolete client-cache workaround; retain the separate game-linking instruction', 'Keep all five policy pages and final acknowledgements; repeat visits preserve existing access'],
  entry: { body: adapted[0], messages: paginateStaticText(adapted[0]) },
  stages: ids.map((id, index) => ({ id, title: titles[index], body: adapted[index + 1], messages: paginateStaticText(adapted[index + 1]) })),
};
await mkdir(new URL('content/onboarding/', root), { recursive: true });
await writeFile(new URL('content/onboarding/definition.json', root), `${JSON.stringify(result, null, 2)}\n`);
const preview = [
  '# Shuttle presentation draft', '',
  'For owner review. No content has been published to Discord. Policy paragraphs come from the supplied source; legacy reaction/channel-unlocking directions are adapted to buttons. Channel and user references still need approved IDs.', '',
  `Original source SHA-256: \`${result.source.sha256}\`. The original file is unchanged.`, '',
];
for (const page of [{ title: 'Rules entry', ...result.entry }, ...result.stages]) {
  preview.push(`## ${page.title}`, '', `${page.messages.length} proposed Discord message segment(s).`, '');
  page.messages.forEach((message, index) => preview.push(`### Message ${index + 1}`, '', message, '', '---', ''));
}
await writeFile(new URL('content/onboarding/preview.md', root), `${preview.join('\n').replace(/[ \t]+$/gm, '').trimEnd()}\n`);
console.log(`Built draft Shuttle: ${result.stages.length} stages; source unchanged.`);
