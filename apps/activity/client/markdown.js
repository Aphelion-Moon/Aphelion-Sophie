/**
 * The subset of Discord markdown the published Shuttle copy uses, parsed to a small tree and built as DOM nodes
 * (P43). No HTML is ever parsed or injected: every character of the copy ends up in a text node. Links open through
 * Discord's own confirmation (openExternalLink), and only https links become links at all. Channel names and mentions
 * become channel chips only for channels core reported the member can see; otherwise they stay plain text.
 */

const MENTIONS = Object.freeze({ '@': '@member', '@!': '@member', '@&': '@role', '#': '#channel' });
/** A few common shortcodes, as Discord shows them. Anything else stays as written. */
export const EMOJI = Object.freeze({
  wink: '😉', smile: '😄', slight_smile: '🙂', grin: '😁', blush: '😊', joy: '😂', sweat_smile: '😅', upside_down: '🙃', thinking: '🤔',
  heart: '❤️', wave: '👋', tada: '🎉', sparkles: '✨', rocket: '🚀', star: '⭐', stars: '🌠', milky_way: '🌌', rainbow: '🌈',
  rainbow_flag: '🏳️‍🌈', transgender_flag: '🏳️‍⚧️', warning: '⚠️', white_check_mark: '✅', x: '❌', eyes: '👀', pray: '🙏',
  thumbsup: '👍', '+1': '👍', point_right: '👉', camera: '📷', wolf: '🐺', seal: '🦭', fish: '🐟', bell: '🔔', lock: '🔒',
  information_source: 'ℹ️', exclamation: '❗', question: '❓', no_entry: '⛔', partying_face: '🥳',
});
const CHANNEL_BEFORE = /[\s(*_>]/;

export function safeLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

const INLINE_PAIRS = [['**', 'strong'], ['__', 'underline'], ['~~', 'strike'], ['||', 'spoiler'], ['*', 'em'], ['_', 'em']];

/** Inline nodes of one line of text. */
export function parseInline(text) {
  const nodes = [];
  let plain = '';
  const flush = () => { if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; } };
  for (let i = 0; i < text.length;) {
    const rest = text.slice(i), after = i === 0 || /\s/.test(text[i - 1]);
    if (rest[0] === '\\' && rest.length > 1 && /[\\*_~|`#>\-[\]()<:]/.test(rest[1])) { plain += rest[1]; i += 2; continue; }
    let match;
    if ((match = /^`([^`]+)`/.exec(rest))) { flush(); nodes.push({ type: 'code', text: match[1] }); i += match[0].length; continue; }
    if ((match = /^\[([^\]\n]{1,200})\]\(<?(https?:\/\/[^\s)>]+)>?\)/.exec(rest)) && safeLink(match[2])) {
      flush(); nodes.push({ type: 'link', href: safeLink(match[2]), children: parseInline(match[1]) }); i += match[0].length; continue;
    }
    if ((match = /^<(https:\/\/[^\s>]+)>/.exec(rest)) && safeLink(match[1])) {
      flush(); nodes.push({ type: 'link', href: safeLink(match[1]), children: [{ type: 'text', text: match[1] }] }); i += match[0].length; continue;
    }
    if ((match = /^https:\/\/[^\s<]+[^\s<.,:;"')\]!?]/.exec(rest)) && safeLink(match[0])) {
      flush(); nodes.push({ type: 'link', href: safeLink(match[0]), children: [{ type: 'text', text: match[0] }] }); i += match[0].length; continue;
    }
    if ((match = /^<(@!|@&|@|#)(\d{1,20})>/.exec(rest))) {
      flush(); nodes.push({ type: 'mention', text: MENTIONS[match[1]], ...(match[1] === '#' ? { channel: match[2] } : {}) }); i += match[0].length; continue;
    }
    if ((i === 0 || CHANNEL_BEFORE.test(text[i - 1])) && (match = /^#([a-z0-9][a-z0-9_-]{0,99})/i.exec(rest))) {
      flush(); nodes.push({ type: 'channel', name: match[1].toLowerCase(), text: match[0] }); i += match[0].length; continue;
    }
    if (after && (match = /^@([A-Za-z0-9_][A-Za-z0-9_.]{1,31})/.exec(rest))) {
      const name = match[1].replace(/\.+$/, '');
      flush(); nodes.push({ type: 'at', text: `@${name}` }); i += 1 + name.length; continue;
    }
    if ((match = /^<a?:(\w{1,32}):\d{1,20}>/.exec(rest))) { flush(); nodes.push({ type: 'text', text: EMOJI[match[1]] ?? `:${match[1]}:` }); i += match[0].length; continue; }
    if ((match = /^:([a-z0-9_+-]{1,32}):/.exec(rest)) && Object.hasOwn(EMOJI, match[1])) { flush(); nodes.push({ type: 'text', text: EMOJI[match[1]] }); i += match[0].length; continue; }
    if ((match = /^<t:(-?\d{1,13})(?::[tTdDfFR])?>/.exec(rest))) { flush(); nodes.push({ type: 'time', seconds: Number(match[1]) }); i += match[0].length; continue; }
    const pair = INLINE_PAIRS.find(([marker]) => rest.startsWith(marker));
    if (pair) {
      const [marker, type] = pair;
      const close = rest.indexOf(marker, marker.length + 1);
      if (close > marker.length - 1 && rest.slice(marker.length, close).trim()) {
        flush(); nodes.push({ type, children: parseInline(rest.slice(marker.length, close)) }); i += close + marker.length; continue;
      }
    }
    plain += rest[0]; i += 1;
  }
  flush();
  return nodes;
}

function inlineLines(lines) {
  return lines.flatMap((line, index) => [...(index ? [{ type: 'break' }] : []), ...parseInline(line)]);
}

/** Block nodes: headings, subtext, quotes, lists, fenced code and paragraphs. */
export function parseMarkdown(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = [];
  const endParagraph = () => { if (paragraph.length) { blocks.push({ type: 'paragraph', children: inlineLines(paragraph) }); paragraph = []; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    if (/^\s*```/.test(line)) {
      endParagraph();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: 'codeblock', text: code.join('\n') });
      continue;
    }
    if (line.trim() === '') { endParagraph(); continue; }
    if ((match = /^(#{1,3}) (.+)$/.exec(line))) { endParagraph(); blocks.push({ type: 'heading', level: match[1].length, children: parseInline(match[2]) }); continue; }
    if ((match = /^-# (.+)$/.exec(line))) { endParagraph(); blocks.push({ type: 'subtext', children: parseInline(match[1]) }); continue; }
    if (/^>>> /.test(line)) { endParagraph(); blocks.push({ type: 'quote', children: parseMarkdown([line.slice(4), ...lines.slice(i + 1)].join('\n')) }); break; }
    if (/^> /.test(line) || line === '>') {
      endParagraph();
      const quoted = [];
      for (; i < lines.length && (/^> /.test(lines[i]) || lines[i] === '>'); i++) quoted.push(lines[i].slice(2));
      i--; blocks.push({ type: 'quote', children: parseMarkdown(quoted.join('\n')) });
      continue;
    }
    if (/^\s*(?:[-*]|\d{1,3}\.) /.test(line)) {
      endParagraph();
      const ordered = /^\s*\d/.test(line), items = [];
      for (; i < lines.length && /^\s*(?:[-*]|\d{1,3}\.) /.test(lines[i]); i++) {
        const item = /^(\s*)(?:[-*]|\d{1,3}\.) (.*)$/.exec(lines[i]);
        items.push({ depth: Math.min(2, Math.floor(item[1].length / 2)), children: parseInline(item[2]) });
      }
      i--; blocks.push({ type: 'list', ordered, start: ordered ? Number(/\d+/.exec(line)[0]) : 1, items });
      continue;
    }
    paragraph.push(line);
  }
  endParagraph();
  return blocks;
}

/** The channel a channel node or mention names, if core reported it as visible to the member. */
function channelOf(node, channels) {
  if (node.type === 'channel') return channels[`#${node.name}`] ?? null;
  return node.channel ? channels[`<#${node.channel}>`] ?? null : null;
}

/** Plain text of a tree, for screen readers and tests. */
export function plainText(nodes, channels = {}) {
  return nodes.map(node => {
    if ((node.type === 'channel' || node.type === 'mention') && channelOf(node, channels)) return `#${channelOf(node, channels).name}`;
    if (['text', 'code', 'codeblock', 'mention', 'channel', 'at'].includes(node.type)) return node.text;
    if (node.type === 'break') return '\n';
    if (node.type === 'time') return new Date(node.seconds * 1000).toUTCString();
    if (node.type === 'list') return node.items.map(item => plainText(item.children, channels)).join('\n');
    const inner = plainText(node.children ?? [], channels);
    return ['paragraph', 'heading', 'subtext', 'quote'].includes(node.type) ? `${inner}\n` : inner;
  }).join('');
}

/**
 * Builds DOM nodes for a tree. `onLink(href)` opens a link and `onChannel({ id, name })` a channel chip; nothing
 * navigates the Activity's own frame. `channels` maps '#name' and '<#id>' to channels the member can see.
 */
export function renderMarkdown(document, nodes, { onLink, channels = {}, onChannel = null }) {
  const fragment = document.createDocumentFragment();
  const element = (tag, className, children) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const child of children ?? []) node.append(child);
    return node;
  };
  const inline = list => list.map(node => {
    switch (node.type) {
      case 'text': return document.createTextNode(node.text);
      case 'break': return document.createElement('br');
      case 'code': return element('code', null, [document.createTextNode(node.text)]);
      case 'channel': case 'mention': {
        const channel = channelOf(node, channels);
        if (channel && onChannel) {
          const chip = element('button', 'md-channel', [document.createTextNode(`#${channel.name}`)]);
          chip.type = 'button'; chip.addEventListener('click', event => { event.stopPropagation(); onChannel(channel); });
          return chip;
        }
        return node.type === 'channel' ? document.createTextNode(node.text) : element('span', 'md-mention', [document.createTextNode(node.text)]);
      }
      case 'at': return element('span', 'md-at', [document.createTextNode(node.text)]);
      case 'time': return element('time', null, [document.createTextNode(new Date(node.seconds * 1000).toLocaleString())]);
      case 'strong': return element('strong', null, inline(node.children));
      case 'em': return element('em', null, inline(node.children));
      case 'underline': return element('span', 'md-underline', inline(node.children));
      case 'strike': return element('s', null, inline(node.children));
      case 'spoiler': return element('span', 'md-spoiler', inline(node.children));
      case 'link': {
        // The arrow is real text after the label, so the typewriter types it last (a CSS ::after showed before the label).
        const arrow = element('span', 'md-link-arrow', [document.createTextNode('↗')]);
        arrow.setAttribute('aria-hidden', 'true');
        const link = element('a', 'md-link', [...inline(node.children), arrow]);
        link.href = node.href; link.rel = 'noopener noreferrer'; link.target = '_blank';
        link.addEventListener('click', event => { event.preventDefault(); onLink(node.href); });
        return link;
      }
      default: return document.createTextNode('');
    }
  });
  for (const block of nodes) {
    switch (block.type) {
      case 'heading': fragment.append(element(`h${block.level + 1}`, 'md-heading', inline(block.children))); break;
      case 'subtext': fragment.append(element('p', 'md-subtext', inline(block.children))); break;
      case 'codeblock': fragment.append(element('pre', null, [element('code', null, [document.createTextNode(block.text)])])); break;
      case 'quote': {
        // A quote whose first line is a bold "NOTICE · ..." label is a sign posted in the scene: the must-know facts.
        const label = noticeLabel(block.children);
        if (label === null) { fragment.append(element('blockquote', null, [renderMarkdown(document, block.children, { onLink, channels, onChannel })])); break; }
        const [first, ...others] = block.children, after = first.children.slice(1);
        while (after[0]?.type === 'break') after.shift();
        const body = after.length ? [{ ...first, children: after }, ...others] : others;
        const sign = element('aside', 'md-notice', [element('p', 'md-notice-label', [document.createTextNode(label)]), renderMarkdown(document, body, { onLink, channels, onChannel })]);
        sign.setAttribute('aria-label', `Notice: ${label}`);
        fragment.append(sign); break;
      }
      case 'list': {
        const list = element(block.ordered ? 'ol' : 'ul', null, block.items.map(item => element('li', item.depth ? `md-depth-${item.depth}` : null, inline(item.children))));
        if (block.ordered && block.start !== 1) list.start = block.start;
        fragment.append(list); break;
      }
      default: {
        // Lines that each open with a bold "Name:" are people talking: one line each, with the speaker's name tag.
        const lines = linesOf(block.children);
        if (!lines.every(line => speakerOf(line) !== null)) { fragment.append(element('p', null, inline(block.children))); break; }
        fragment.append(element('div', 'md-dialogue', lines.map(line => {
          const name = speakerOf(line), rest = line.slice(1);
          if (rest[0]?.type === 'text') rest[0] = { ...rest[0], text: rest[0].text.replace(/^\s+/, '') };
          const row = element('p', 'md-line', [element('span', 'md-speaker', [document.createTextNode(name)]), document.createTextNode(' '), ...inline(rest)]);
          row.dataset.speaker = name.toLowerCase();
          return row;
        })));
      }
    }
  }
  return fragment;
}

/** The label of a posted sign: a quote opening with a bold "NOTICE · ..." line; null for an ordinary quote. */
function noticeLabel(children) {
  const lead = children[0]?.type === 'paragraph' ? children[0].children[0] : null;
  const text = lead?.type === 'strong' && lead.children.length === 1 && lead.children[0].type === 'text' ? lead.children[0].text : '';
  return text.startsWith('NOTICE · ') && text.length > 9 ? text.slice(9) : null;
}
/** A paragraph's inline nodes split at its line breaks. */
const linesOf = children => children.reduce((lines, node) => { if (node.type === 'break') lines.push([]); else lines.at(-1).push(node); return lines; }, [[]]);
/** The speaker of a dialogue line ("**Rook:** ..."), or null. */
function speakerOf(line) {
  const lead = line[0];
  const text = lead?.type === 'strong' && lead.children.length === 1 && lead.children[0].type === 'text' ? lead.children[0].text : '';
  return /^[A-Z][A-Za-z]{1,15}:$/.test(text) && line.length > 1 ? text.slice(0, -1) : null;
}
