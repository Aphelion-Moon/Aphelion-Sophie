import { createHash } from 'node:crypto';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { canonicalKnowledgeDocument, SYNCED_KNOWLEDGE_KINDS } from '../../../modules/assistant/knowledge.js';

/** Synced text is retrieved per section, so sections stay small enough to be specific. */
export const SECTION_CHARS = 1800;
export const SYNC_VALIDITY_MS = 7 * 86400000;
const DOCUMENT_SECTIONS = 16, DOCUMENT_CHARS = 30000;
const sha = value => createHash('sha256').update(value).digest('hex');

/** Removes control characters a knowledge document refuses and collapses runs of blank lines. */
export function cleanText(value) {
  return String(value).replace(/\r\n?/gu, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '')
    .replace(/[ \t ]+/gu, ' ').replace(/ *\n */gu, '\n').replace(/\n{3,}/gu, '\n\n').trim();
}

const clip = (value, limit) => { const text = cleanText(value).replace(/\s+/gu, ' '); return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`; };

/** Stable lower-case identifier: prefix, readable slug and a short hash of the stable source key. */
export function documentIdBase(prefix, name, key) {
  requireCondition(/^[a-z]{2,6}$/u.test(prefix), 'KNOWLEDGE_SYNC_INVALID');
  const slug = String(name).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 30).replace(/-+$/u, '');
  return `${prefix}-${slug ? `${slug}-` : ''}${sha(`${prefix}:${key}`).slice(0, 6)}`;
}

/** Extracted HTML blocks (see html-extractor.js) to heading/text sections. Headings h1–h3 start a section. */
export function blocksToSections(blocks, title) {
  const sections = []; let current = { heading: title, lines: [] }, path = [];
  const line = value => { const text = cleanText(value); if (text) current.lines.push(text); };
  function cells(cell) { return cleanText(flatten(cell.blocks).join(' ')).replace(/\s+/gu, ' '); }
  function flatten(items) {
    const out = [];
    for (const block of items) {
      if (block.kind === 'text' || block.kind === 'preformatted' || block.kind === 'heading') out.push(block.text);
      else if (block.kind === 'group') out.push(...flatten(block.blocks));
      else if (block.kind === 'list') block.items.forEach(item => out.push(...flatten(item.blocks)));
      else if (block.kind === 'table') block.rows.forEach(row => out.push(row.cells.map(cells).join(' | ')));
    }
    return out;
  }
  function walk(items, depth) {
    for (const block of items) {
      if (block.kind === 'heading') {
        if (block.level <= 3) {
          if (current.lines.length) sections.push(current);
          path = [...path.slice(0, Math.max(0, block.level - 2)), block.text].filter(Boolean);
          current = { heading: [title, ...path].join(' › '), lines: [] };
        } else line(`${block.text}:`);
      } else if (block.kind === 'text' || block.kind === 'preformatted') line(block.text);
      else if (block.kind === 'group') walk(block.blocks, depth + 1);
      else if (block.kind === 'list') block.items.forEach((item, index) => {
        const text = cleanText(flatten(item.blocks).join(' ')).replace(/\s+/gu, ' ');
        if (text) line(`${block.ordered ? `${(block.start ?? 1) + index}.` : '-'} ${text}`);
      });
      else if (block.kind === 'table') {
        if (block.caption) line(block.caption);
        block.rows.forEach(row => { const text = row.cells.map(cells).filter(Boolean).join(' | '); if (text) line(text); });
      }
    }
  }
  walk(blocks, 0);
  if (current.lines.length) sections.push(current);
  return sections.map(section => ({ heading: section.heading, text: section.lines.join('\n') }));
}

/** GitHub Markdown to sections. Formatting is reduced to plain text; links keep their visible text only. */
export function markdownToSections(markdown, title) {
  requireCondition(typeof markdown === 'string', 'KNOWLEDGE_SYNC_INVALID');
  const text = markdown.replace(/<!--[\s\S]*?-->/gu, '').replace(/```[\s\S]*?```/gu, block => block.length > 1500 ? '' : block.replace(/```[^\n]*/gu, ''));
  const sections = []; let current = { heading: title, lines: [] }, path = [];
  for (const raw of text.split('\n')) {
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(raw);
    if (heading && heading[1].length <= 3) {
      if (current.lines.some(item => item.trim())) sections.push(current);
      // Markdown's top level is #, unlike wiki HTML where the page title is the only h1.
      const level = heading[1].length, name = inline(heading[2]);
      path = [...path.slice(0, level - 1), name].filter(Boolean);
      current = { heading: [title, ...path].join(' › '), lines: [] };
      continue;
    }
    current.lines.push(heading ? `${inline(heading[2])}:` : inline(raw.replace(/^\s*[*+]\s+/u, '- ').replace(/^\s*>\s?/u, '')));
  }
  if (current.lines.some(item => item.trim())) sections.push(current);
  return sections.map(section => ({ heading: section.heading, text: cleanText(section.lines.join('\n')) })).filter(section => section.text);
}

function inline(value) {
  return value.replace(/!\[[^\]]*\]\([^)]*\)/gu, '').replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1').replace(/<[^>]+>/gu, '')
    .replace(/[*_]{1,3}([^*_\n]+)[*_]{1,3}/gu, '$1').replace(/`([^`\n]+)`/gu, '$1').replace(/^\s*\|?\s*:?-{3,}.*$/gu, '');
}

/** Splits a long section at paragraph, line or sentence boundaries into parts of at most SECTION_CHARS. */
export function splitSection({ heading, text }) {
  const pieces = [], value = cleanText(text);
  let rest = value;
  while (rest.length > SECTION_CHARS) {
    const window = rest.slice(0, SECTION_CHARS);
    const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. ') + 1, window.lastIndexOf(' ')]
      .find(index => index > SECTION_CHARS / 3) ?? SECTION_CHARS;
    pieces.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces.filter(Boolean).map((piece, index) => ({ heading: clip(index === 0 ? heading : `${heading} (continued ${index + 1})`, 160), text: piece }));
}

/**
 * Packs sections into canonical documents: idBase, idBase-p2, … Returns at most maxParts documents and reports whether
 * text was left out. dependencyHash is the content digest, so unchanged content can be recognised across syncs.
 */
export function packDocuments({ idBase, title, kind, authority, url, rights, attribution, sourceRevision, fetchedAt, aliases = [], sections, maxParts = 8 }) {
  requireCondition(SYNCED_KNOWLEDGE_KINDS.includes(kind) && /^[a-z][a-z0-9-]{0,44}$/u.test(idBase), 'KNOWLEDGE_SYNC_INVALID'); requireInteger(fetchedAt, 1); requireInteger(maxParts, 1, 9);
  const parts = sections.flatMap(splitSection).filter(section => section.text);
  if (!parts.length) return { documents: [], truncated: false };
  const groups = []; let group = [], size = 0;
  for (const section of parts) {
    if (group.length && (group.length >= DOCUMENT_SECTIONS || size + section.text.length > DOCUMENT_CHARS)) { groups.push(group); group = []; size = 0; }
    group.push(section); size += section.text.length;
  }
  if (group.length) groups.push(group);
  const cleanTitle = clip(title, 180), cleanAliases = [...new Set(aliases.map(alias => clip(alias, 100)).filter(Boolean))].slice(0, 20);
  const documents = groups.slice(0, maxParts).map((sectionsOfPart, index) => {
    const partTitle = index === 0 ? cleanTitle : `${cleanTitle} (part ${index + 1})`;
    const content = { title: partTitle, url, authority, aliases: cleanAliases, sections: sectionsOfPart };
    return canonicalKnowledgeDocument({ id: index === 0 ? idBase : `${idBase}-p${index + 1}`, title: partTitle, kind, authority, url, rights: clip(rights, 300),
      attribution: clip(attribution, 500), sourceRevision: clip(sourceRevision, 160), dependencyHash: sha(JSON.stringify(content)),
      fetchedAt, validUntil: fetchedAt + SYNC_VALIDITY_MS, aliases: cleanAliases, sections: sectionsOfPart });
  });
  return { documents, truncated: groups.length > maxParts };
}
