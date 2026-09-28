/** Render only the extractor's structured text, never its source HTML or embedded URLs. */
export function renderWikiReview(document, container, extraction) {
  let count = 0, characters = 0;
  const ensure = condition => { if (!condition) throw Error('WIKI_REVIEW_INVALID'); };
  const text = value => { ensure(typeof value === 'string'); characters += value.length; ensure(characters <= 524288); return value; };
  const element = name => { ensure(++count <= 20000); return document.createElement(name); };
  function render(blocks, parent, depth = 0) {
    ensure(Array.isArray(blocks) && depth <= 128);
    for (const block of blocks) {
      let node;
      if (block.kind === 'text' || block.kind === 'preformatted') {
        node = element(block.kind === 'text' ? 'p' : 'pre'); node.textContent = text(block.text);
      } else if (block.kind === 'heading') {
        ensure(Number.isInteger(block.level) && block.level >= 1 && block.level <= 6);
        node = element(`h${Math.min(6, Math.max(3, block.level + 1))}`); node.textContent = text(block.text);
      } else if (block.kind === 'group') {
        node = element('div'); render(block.blocks,node,depth + 1);
      } else if (block.kind === 'list') {
        ensure(typeof block.ordered === 'boolean' && Array.isArray(block.items));
        node = element(block.ordered ? 'ol' : 'ul');
        if (block.start !== null) { ensure(Number.isSafeInteger(block.start)); node.start = block.start; }
        if (block.reversed) node.reversed = true;
        for (const item of block.items) {
          const li = element('li'); if (item.value !== null) { ensure(Number.isSafeInteger(item.value)); li.value = item.value; }
          render(item.blocks,li,depth + 1); node.append(li);
        }
      } else if (block.kind === 'table') {
        node = element('table'); ensure(Array.isArray(block.rows));
        if (block.caption !== null) { const caption = element('caption'); caption.textContent = text(block.caption); node.append(caption); }
        const body = element('tbody'); node.append(body);
        for (const row of block.rows) {
          const tr = element('tr'); ensure(Array.isArray(row.cells));
          for (const cell of row.cells) {
            ensure(typeof cell.header === 'boolean'); const td = element(cell.header ? 'th' : 'td');
            for (const [name,value] of [['rowSpan',cell.rowSpan],['colSpan',cell.columnSpan]]) { ensure(Number.isInteger(value) && value >= 1 && value <= 100); td[name] = value; }
            if (['row','col','rowgroup','colgroup'].includes(cell.scope)) td.scope = cell.scope;
            render(cell.blocks,td,depth + 1); tr.append(td);
          }
          body.append(tr);
        }
      } else throw Error('WIKI_REVIEW_INVALID');
      parent.append(node);
    }
  }
  ensure(extraction?.reviewed === false);
  const fragment = document.createDocumentFragment(); render(extraction.blocks,fragment);
  container.replaceChildren(fragment);
}
