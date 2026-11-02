import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KNOWLEDGE_DRAFT_FORMAT, KNOWLEDGE_DRAFT_LIMITS, readKnowledgeDraft } from '../apps/dashboard/knowledge-draft.js';
import { canonicalKnowledgeDocument } from '../modules/assistant/knowledge.js';
import { createDashboardPresentation } from '../apps/core/http/dashboard-assets.js';

const draft = (overrides = {}) => ({ format: KNOWLEDGE_DRAFT_FORMAT, id: 'wolfgate-escalation', title: 'Wolfgate: declaring escalation', authority: 'reference',
  url: 'https://discord.com/channels/900000000000000001/900000000000000105', rights: 'Synthetic staff posts, owner approved', attribution: 'Synthetic staff',
  sourceRevision: 'Synthetic harvest 2026-11-02', aliases: ['CR 1', 'escalation'], sections: [{ heading: 'Declaring escalation', text: 'Declare it in local, shortband or broadband chat.' }], ...overrides });
const read = value => readKnowledgeDraft(JSON.stringify(value));
// The same content as the server would receive it after review.
const served = value => { const { format, ...rest } = value; return { ...rest, kind: 'owner-publication', dependencyHash: 'a'.repeat(64), fetchedAt: 1_790_000_000_000, validUntil: null }; };
const sections = (count, length) => Array.from({ length: count }, (_, index) => ({ heading: `Section ${index + 1}`, text: 'x'.repeat(length) }));

test('a draft file fills every editor field and nothing else', () => {
  const result = read(draft());
  assert.equal(result.ok, true);
  const { format, ...fields } = draft();
  assert.deepEqual(result.draft, fields);
  assert.deepEqual(read(draft({ url: '', rights: '', attribution: '', sourceRevision: '' })).ok, true);
});

test('draft limits match the publication limits of modules/assistant/knowledge.js', () => {
  const L = KNOWLEDGE_DRAFT_LIMITS;
  const largest = draft({ title: 't'.repeat(L.title), aliases: Array.from({ length: L.aliases }, (_, index) => `${index}`.padEnd(L.alias, 'a')),
    sections: sections(L.sections, L.totalText / L.sections).map(section => ({ ...section, heading: section.heading.padEnd(L.heading, 'h') })) });
  assert.equal(read(largest).ok, true); assert.doesNotThrow(() => canonicalKnowledgeDocument(served(largest)));
  assert.equal(read(draft({ sections: sections(L.totalText / L.sectionText, L.sectionText) })).ok, true);
  const over = {
    sections: draft({ sections: sections(L.sections + 1, 10) }), sectionText: draft({ sections: sections(1, L.sectionText + 1) }),
    totalText: draft({ sections: [...sections(L.totalText / L.sectionText, L.sectionText), { heading: 'One more', text: 'x' }] }),
    noSections: draft({ sections: [] }), emptyText: draft({ sections: [{ heading: 'Empty', text: '  ' }] }), heading: draft({ sections: [{ heading: 'h'.repeat(L.heading + 1), text: 'x' }] }),
    aliases: draft({ aliases: Array.from({ length: L.aliases + 1 }, (_, index) => `alias ${index}`) }), alias: draft({ aliases: ['a'.repeat(L.alias + 1)] }),
    duplicateAlias: draft({ aliases: ['CI', 'CI'] }), title: draft({ title: 't'.repeat(L.title + 1) }), emptyTitle: draft({ title: ' ' }),
    id: draft({ id: 'Wolfgate' }), longId: draft({ id: 'a'.repeat(49) }), authority: draft({ authority: 'rumour' }),
    control: draft({ sections: [{ heading: 'Bell', text: 'ring \u0007' }] }), url: draft({ url: 'http://example.test/' }), fragment: draft({ url: 'https://example.test/#part' }),
    credentials: draft({ url: 'https://user:pass@example.test/' }), port: draft({ url: 'https://example.test:8443/' }), rights: draft({ rights: 'r'.repeat(L.rights + 1) }),
  };
  for (const [name, value] of Object.entries(over)) {
    assert.equal(read(value).ok, false, name);
    assert.throws(() => canonicalKnowledgeDocument(served(value)), undefined, name);
  }
});

test('a draft is refused when the editor could not carry it faithfully or it is not a draft', () => {
  const refused = {
    notJson: '{', array: '[]', otherFormat: JSON.stringify(draft({ format: 'something-else' })), extraField: JSON.stringify(draft({ notes: 'x' })),
    missingField: JSON.stringify((({ aliases, ...rest }) => rest)(draft())), titleBreak: JSON.stringify(draft({ title: 'Two\nlines' })),
    headingBreak: JSON.stringify(draft({ sections: [{ heading: 'Two\r\nlines', text: 'x' }] })), aliasBreak: JSON.stringify(draft({ aliases: ['one\ntwo'] })),
    untrimmedAlias: JSON.stringify(draft({ aliases: [' CI'] })), sectionShape: JSON.stringify(draft({ sections: [{ heading: 'h', text: 'x', extra: 1 }] })),
    sectionNull: JSON.stringify(draft({ sections: [null] })), invalidUrl: JSON.stringify(draft({ url: 'not a url' })), unpaired: JSON.stringify(draft({ title: 'Broken \ud800' })),
    tooLarge: ' '.repeat(KNOWLEDGE_DRAFT_LIMITS.fileBytes + 1), notText: null,
  };
  for (const [name, text] of Object.entries(refused)) {
    const result = readKnowledgeDraft(text);
    assert.equal(result.ok, false, name); assert.equal(typeof result.problem, 'string', name);
  }
  // Line breaks inside a section's text are kept.
  assert.equal(read(draft({ sections: [{ heading: 'Steps', text: 'One.\n\nTwo.' }] })).draft.sections[0].text, 'One.\n\nTwo.');
});

test('the knowledge page offers Open draft file and serves its reader', async () => {
  const html = await readFile(new URL('../apps/dashboard/ai-knowledge.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../apps/dashboard/ai-knowledge-app.js', import.meta.url), 'utf8');
  assert.match(html, /<button id="open-draft">Open draft file<\/button><input id="draft-file" type="file" accept="\.json,application\/json" hidden>/u);
  assert.match(app, /import \{ KNOWLEDGE_DRAFT_LIMITS, readKnowledgeDraft \} from '\.\/knowledge-draft\.js';/u);
  // Opening a draft only fills the editor: it calls no review or publish route.
  const open = app.slice(app.indexOf('async function openDraft'), app.indexOf('const sourceNames'));
  assert.ok(open.includes('readKnowledgeDraft(') && !/knowledgeReview|knowledgePublish|approved-public/u.test(open));
  const presentation = await createDashboardPresentation(), asset = presentation.get('/dashboard/knowledge-draft.js');
  assert.equal(asset.contentType, 'text/javascript; charset=utf-8');
  assert.deepEqual(asset.bytes, await readFile(new URL('../apps/dashboard/knowledge-draft.js', import.meta.url)));
});
