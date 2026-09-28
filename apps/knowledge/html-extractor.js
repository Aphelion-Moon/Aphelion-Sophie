import { parseFragment } from 'parse5';
import { requireCondition } from '../../contracts/validation.js';
import { MEDIAWIKI_EXTRACTOR_REVISION } from '../../modules/assistant/knowledge.js';

export const EXTRACTOR_REVISION = MEDIAWIKI_EXTRACTOR_REVISION;
const ignored = new Set(['script','style','template','noscript','iframe','object','embed','svg','canvas','input','button','select','textarea']);
const blocks = new Set(['address','article','aside','blockquote','div','dl','dt','dd','fieldset','figcaption','figure','footer','header','main','nav','p','pre','section']);
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value ?? null;
const children = node => node.childNodes ?? [];
const anchors = node => {
  const result = [];
  function walk(item) { const id = attr(item, 'id'); if (id) result.push(id); children(item).forEach(walk); }
  walk(node); return result;
};

/** Call only inside extraction-worker.js. This is text extraction, never HTML sanitization or source approval. */
export function extractMediaWikiHtml(html) {
  requireCondition(typeof html === 'string' && html.isWellFormed() && Buffer.byteLength(html) <= 786432, 'WIKI_HTML_LIMIT');
  const tree = parseFragment(html, { scriptingEnabled: false });
  const pending = [{ node: tree, depth: 0 }]; let nodes = 0;
  const sourceAnchors = [];
  while (pending.length) {
    const { node, depth } = pending.pop();
    requireCondition(++nodes <= 60000 && depth <= 128, 'WIKI_TREE_LIMIT');
    const id = attr(node, 'id'); if (id) { requireCondition(id.length <= 512 && sourceAnchors.length < 6000, 'WIKI_ANCHOR_LIMIT'); sourceAnchors.push(id); }
    children(node).forEach(child => pending.push({ node: child, depth: depth + 1 }));
  }
  const excluded = new Set(); let characters = 0, blockCount = 0;
  const checkText = value => {
    requireCondition(value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), 'WIKI_TEXT_INVALID');
    characters += value.length; requireCondition(characters <= 524288, 'WIKI_TEXT_LIMIT'); return value;
  };
  const skip = node => { if (!ignored.has(node.tagName)) return false; excluded.add(node.tagName); return true; };
  function inline(node, preserveWhitespace = false) {
    if (skip(node)) return '';
    if (node.nodeName === '#text') return preserveWhitespace ? node.value : node.value.replace(/\s+/gu, ' ');
    if (node.tagName === 'br') return '\n';
    return children(node).map(child => inline(child, preserveWhitespace)).join('');
  }
  const hasBlock = node => children(node).some(item => blocks.has(item.tagName) || ['table','ul','ol'].includes(item.tagName) || /^h[1-6]$/u.test(item.tagName ?? '') || hasBlock(item));
  function output(node) {
    const result = []; let run = '';
    const add = value => { requireCondition(++blockCount <= 6000, 'WIKI_BLOCK_LIMIT'); result.push(value); };
    const flush = () => { if (run.trim()) add({ kind: 'text', text: checkText(run.trim()) }); run = ''; };
    for (const child of children(node)) {
      if (skip(child) || child.nodeName === '#comment') continue;
      if (/^h[1-6]$/u.test(child.tagName ?? '')) {
        flush(); add({ kind: 'heading', level: Number(child.tagName[1]), anchors: anchors(child), text: checkText(inline(child).trim()) });
      } else if (child.tagName === 'table') {
        flush(); const rows = []; let caption = null;
        function tableRows(parent) {
          for (const row of children(parent)) {
            if (row.tagName === 'caption') { requireCondition(caption === null, 'WIKI_TABLE_UNSUPPORTED'); caption = checkText(inline(row).trim()); }
            else if (['thead','tbody','tfoot'].includes(row.tagName)) tableRows(row);
            else if (row.tagName === 'tr') {
              requireCondition(children(row).every(cell => ['td','th'].includes(cell.tagName) || cell.nodeName === '#comment' ||
                cell.nodeName === '#text' && !cell.value.trim()), 'WIKI_TABLE_UNSUPPORTED');
              const cells = children(row).filter(cell => ['td','th'].includes(cell.tagName)).map(cell => {
                const span = name => { const raw = attr(cell, name) ?? '1'; requireCondition(/^\d{1,3}$/u.test(raw) && Number(raw) >= 1 && Number(raw) <= 100, 'WIKI_TABLE_UNSUPPORTED'); return Number(raw); };
                return { header: cell.tagName === 'th', scope: attr(cell, 'scope'), anchors: anchors(cell), rowSpan: span('rowspan'), columnSpan: span('colspan'), blocks: output(cell) };
              });
              requireCondition(cells.length > 0 && cells.length <= 32 && rows.length < 500, 'WIKI_TABLE_LIMIT'); rows.push({ anchors: anchors(row), cells });
            } else requireCondition(row.nodeName === '#comment' || row.nodeName === '#text' && !row.value.trim(), 'WIKI_TABLE_UNSUPPORTED');
          }
        }
        tableRows(child); requireCondition(rows.length > 0, 'WIKI_TABLE_UNSUPPORTED');
        add({ kind: 'table', anchors: anchors(child), caption, rows });
      } else if (child.tagName === 'ul' || child.tagName === 'ol') {
        flush();
        const number = value => { if (value === null) return null; requireCondition(/^-?\d{1,6}$/u.test(value), 'WIKI_LIST_UNSUPPORTED'); return Number(value); };
        const items = [];
        for (const item of children(child)) {
          if (item.tagName === 'li') items.push({ value: number(attr(item, 'value')), blocks: output(item) });
          else requireCondition(item.nodeName === '#comment' || item.nodeName === '#text' && !item.value.trim(), 'WIKI_LIST_UNSUPPORTED');
        }
        add({ kind: 'list', ordered: child.tagName === 'ol', start: number(attr(child, 'start')), reversed: attr(child, 'reversed') !== null, items });
      } else if (child.tagName === 'pre') {
        flush(); add({ kind: 'preformatted', text: checkText(inline(child, true)), anchors: anchors(child) });
      } else if (blocks.has(child.tagName)) {
        flush(); const nested = output(child);
        // Preserve grouping so review can see qualifications beside their body.
        if (nested.length) add({ kind: 'group', element: child.tagName, anchors: attr(child, 'id') ? [attr(child, 'id')] : [], blocks: nested });
      } else {
        // Inline containers may wrap headings or tables. Keep their structure instead of flattening away those boundaries.
        if (hasBlock(child)) {
          flush(); result.push(...output(child));
        } else run += inline(child);
      }
    }
    flush(); return result;
  }
  const extracted = output(tree);
  requireCondition(extracted.length > 0 && characters > 0, 'WIKI_TEXT_EMPTY');
  return { extractorRevision: EXTRACTOR_REVISION, reviewed: false, blocks: extracted, sourceAnchors: [...new Set(sourceAnchors)].sort(), excludedElements: [...excluded].sort(), characters, nodes };
}
