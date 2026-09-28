import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWikiExtractor } from '../apps/knowledge/extraction.js';
const input = html => ({ html, htmlHash: createHash('sha256').update(html).digest('hex') });
function all(blocks) {
  return blocks.flatMap(block => [block, ...all(block.blocks ?? []), ...(block.items ?? []).flatMap(item => all(item.blocks)),
    ...(block.rows ?? []).flatMap(row => row.cells.flatMap(cell => all(cell.blocks)))]);
}

test('DS07-X01: worker retains policy negation, exceptions, anchors, Unicode and nested numbered lists', async () => {
  const html = '<div><h2 id="rule">Rule &amp; scope <span id="RULE-01">RULE-01</span></h2><p>Do <b>not</b> allow this, except for <i>three</i> units. ≤ 5.</p><ol start="3" reversed><li value="7">First exception<ul><li>Nested qualification</li></ul></li></ol></div>';
  const result = await createWikiExtractor().extract(input(html)), list = all(result.blocks);
  assert.equal(result.reviewed, false); assert.equal(result.extractorRevision, 'mediawiki-structured-v1');
  assert.deepEqual(list.find(item => item.kind === 'heading').anchors, ['rule','RULE-01']);
  assert.deepEqual(result.sourceAnchors, ['RULE-01','rule']);
  assert.ok(list.some(item => item.text === 'Do not allow this, except for three units. ≤ 5.'));
  const ordered = list.find(item => item.kind === 'list' && item.ordered);
  assert.equal(ordered.start, 3); assert.equal(ordered.reversed, true); assert.equal(ordered.items[0].value, 7);
  assert.ok(list.some(item => item.text === 'Nested qualification'));
  assert.equal((await createWikiExtractor().extract(input(html))).extractHash, result.extractHash);
});

test('DS07-X02: tables keep caption, headers, scopes, row/column spans and complete cell blocks', async () => {
  const result = await createWikiExtractor().extract(input('<table><caption>Limits in metres</caption><tr><th scope="col" colspan="2">Maximum</th></tr><tr><th scope="row" rowspan="2">Exception</th><td><p>Not more than 5 m</p><ul><li>Unless qualified</li></ul></td></tr><tr><td>Other</td></tr></table>'));
  const table = result.blocks[0]; assert.equal(table.caption, 'Limits in metres');
  assert.equal(table.rows[0].cells[0].header, true); assert.equal(table.rows[0].cells[0].scope, 'col'); assert.equal(table.rows[0].cells[0].columnSpan, 2);
  assert.equal(table.rows[1].cells[0].rowSpan, 2); assert.equal(table.rows[1].cells[1].header, false);
  assert.ok(all(table.rows[1].cells[1].blocks).some(item => item.text === 'Unless qualified'));
});

test('DS07-X03: active HTML stays inert and decoded markup stays literal text', async () => {
  const result = await createWikiExtractor().extract(input('<script>throw Error("executed")</script><style>.secret {}</style><iframe src="http://127.0.0.1/"></iframe><p>&lt;script&gt;literal&lt;/script&gt; &copy; &amp; <a href="javascript:alert(1)">visible wording</a></p>'));
  assert.deepEqual(result.excludedElements, ['iframe','script','style']);
  assert.equal(result.blocks[0].blocks[0].text, '<script>literal</script> © & visible wording');
  assert.equal(JSON.stringify(result).includes('javascript:'), false); assert.equal(JSON.stringify(result).includes('127.0.0.1'), false);
});

test('DS07-X04: preformatted spacing and deeply wrapped headings remain structured', async () => {
  const result = await createWikiExtractor().extract(input('<pre>A  B\n  C</pre><span><span><h3 id="x">Nested heading</h3></span></span><p>After</p>'));
  assert.equal(result.blocks[0].text, 'A  B\n  C'); assert.equal(result.blocks[0].kind, 'preformatted');
  assert.ok(all(result.blocks).some(item => item.kind === 'heading' && item.text === 'Nested heading'));
});

test('DS07-X05: rejects oversized HTML, corrupt snapshot hashes, excessive depth, empty and unsupported structures', async () => {
  const extractor = createWikiExtractor();
  await assert.rejects(extractor.extract({ ...input('<p>Text</p>'), htmlHash: 'a'.repeat(64) }), /WIKI_SNAPSHOT_INVALID/);
  await assert.rejects(extractor.extract(input('x'.repeat(786433))), /WIKI_SNAPSHOT_INVALID/);
  await assert.rejects(extractor.extract(input('<div>'.repeat(130) + 'text' + '</div>'.repeat(130))), /WIKI_TREE_LIMIT/);
  await assert.rejects(extractor.extract(input('<script>inert</script>')), /WIKI_TEXT_EMPTY/);
  await assert.rejects(extractor.extract(input('<table><tr><td rowspan="0">Unbounded span</td></tr></table>')), /WIKI_TABLE_UNSUPPORTED/);
  await assert.rejects(extractor.extract(input('<table><tr><style>.unexpected {}</style><td>Retained cell</td></tr></table>')), /WIKI_TABLE_UNSUPPORTED/);
  assert.equal((await extractor.extract(input('<p>Worker can be reused after failure.</p>'))).reviewed, false);
});

test('DS07-X06: cancellation, hard worker timeout and capacity release prevent concurrent parser work', async () => {
  const extractor = createWikiExtractor(), controller = new AbortController();
  const pending = extractor.extract({ ...input('<p>Bounded</p>'), signal: controller.signal });
  await assert.rejects(extractor.extract(input('<p>Second</p>')), /WIKI_EXTRACTION_BUSY/);
  controller.abort(); await assert.rejects(pending, /WIKI_EXTRACTION_CANCELLED/);
  await assert.rejects(extractor.extract({ ...input('<p>Already cancelled</p>'), signal: controller.signal }), /WIKI_EXTRACTION_CANCELLED/);
  await assert.rejects(extractor.extract({ ...input('<div>'.repeat(120) + 'body' + '</div>'.repeat(120)), timeoutMs: 1 }), /WIKI_EXTRACTION_TIMEOUT/);
  assert.ok((await extractor.extract(input('<p>Fresh worker</p>'))).extractHash);
});
