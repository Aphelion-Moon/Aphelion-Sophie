import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineMarkdown, markdownTree, safeLink } from '../apps/dashboard/markdown.js';

test('Discord static preview handles emphasis, underline, strike, code, quotes, lists, links and spoilers', () => {
  assert.deepEqual(inlineMarkdown('**bold** __under__ ~~gone~~ *italic* `**code**` ||hidden||').filter(x => typeof x !== 'string').map(x => x.tag), ['strong', 'u', 's', 'em', 'code', 'spoiler']);
  assert.deepEqual(markdownTree('> quote\n- first\n- second\n```js\n<img>\n```').map(x => x.tag), ['blockquote', 'ul', 'pre']);
  assert.equal(inlineMarkdown('[Guide](https://example.test/guide)')[0].href, 'https://example.test/guide');
  assert.equal(inlineMarkdown('https://example.test/guide.')[0].href, 'https://example.test/guide');
  assert.deepEqual(inlineMarkdown('\\*literal\\*'), ['*literal*']);
  assert.deepEqual(inlineMarkdown('***both***')[0], { tag: 'strong-em', children: ['both'] });
});
test('preview treats HTML and unsafe links as text and never emits remote images or executable nodes', () => {
  const input = '<img src=x onerror=alert(1)> [bad](javascript:alert(1)) ![image](https://example.test/image.png)';
  const tree = markdownTree(input);
  assert.equal(tree[0].children[0].startsWith('<img src=x'), true);
  assert.equal(JSON.stringify(tree).includes('"tag":"img"'), false);
  assert.equal(safeLink('javascript:alert(1)'), null); assert.equal(safeLink('https://user:password@example.test'), null);
  assert.equal(safeLink('//example.test'), null);
});
