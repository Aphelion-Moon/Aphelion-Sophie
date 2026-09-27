// Static Discord-style preview. No HTML, embeds, image fetching or mention resolution.
export function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

export function inlineMarkdown(text, depth = 0) {
  if (depth > 8) return [text];
  const result = []; let plain = '';
  const flush = () => { if (plain) result.push(plain); plain = ''; };
  for (let index = 0; index < text.length;) {
    const rest = text.slice(index);
    if (rest[0] === '\\' && rest.length > 1 && /[\\*_~|`\[\]()<>#-]/.test(rest[1])) { plain += rest[1]; index += 2; continue; }
    const link = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest);
    const url = link && safeLink(link[2]);
    if (url) { flush(); result.push({ tag: 'a', href: url, children: inlineMarkdown(link[1], depth + 1) }); index += link[0].length; continue; }
    const automatic = /^(?:<(https?:\/\/[^\s<>]+)>|(https?:\/\/[^\s<>]+))/.exec(rest);
    if (automatic) {
      const label = automatic[1] ?? automatic[2].replace(/[.,!?;:)]+$/, ''), href = safeLink(label);
      if (href) { flush(); result.push({ tag: 'a', href, children: [label] }); index += automatic[1] ? automatic[0].length : label.length; continue; }
    }
    let found = false;
    for (const [mark, tag] of [['`', 'code'], ['***', 'strong-em'], ['___', 'u-em'], ['**', 'strong'], ['__', 'u'], ['~~', 's'], ['||', 'spoiler'], ['*', 'em'], ['_', 'em']]) {
      if (!rest.startsWith(mark)) continue;
      // Underscores inside identifiers are literal in Discord.
      if (mark === '_' && /\w/.test(text[index - 1] ?? '') && /\w/.test(rest[1] ?? '')) continue;
      let end = rest.indexOf(mark, mark.length);
      while (end > 0 && rest[end - 1] === '\\') end = rest.indexOf(mark, end + mark.length);
      if (end <= mark.length) continue;
      flush(); const inner = rest.slice(mark.length, end);
      result.push({ tag, children: tag === 'code' ? [inner] : inlineMarkdown(inner, depth + 1) });
      index += end + mark.length; found = true; break;
    }
    if (!found) { plain += text[index]; index++; }
  }
  flush(); return result;
}

export function markdownTree(text) {
  const lines = String(text).slice(0, 5_000).replace(/\r\n?/g, '\n').split('\n'), blocks = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const code = []; i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ tag: 'pre', children: [{ tag: 'code', children: [code.join('\n')] }] }); continue;
    }
    const list = /^\s*(?:([-*]) |(\d+)\. )/.exec(line);
    if (list) {
      const tag = list[2] ? 'ol' : 'ul', children = [];
      while (i < lines.length) {
        const item = /^\s*(?:([-*]) |(\d+)\. )(.*)$/.exec(lines[i]);
        if (!item || (item[2] ? 'ol' : 'ul') !== tag) break;
        children.push({ tag: 'li', children: inlineMarkdown(item[3]) }); i++;
      }
      blocks.push({ tag, children }); continue;
    }
    if (line.startsWith('>>> ')) { blocks.push({ tag: 'blockquote', children: inlineMarkdown([line.slice(4), ...lines.slice(i + 1)].join('\n')) }); break; }
    if (line.startsWith('> ')) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith('> ')) quote.push(lines[i++].slice(2));
      blocks.push({ tag: 'blockquote', children: inlineMarkdown(quote.join('\n')) }); continue;
    }
    // Discord embed descriptions support inline formatting; heading/subtext styling
    // varies between Discord clients, so preview these as readable structured text.
    const heading = /^(#{1,3}) (.*)$/.exec(line), subtext = line.startsWith('-# ');
    blocks.push({ tag: heading ? `h${heading[1].length + 3}` : subtext ? 'small' : 'p',
      children: inlineMarkdown(heading ? heading[2] : subtext ? line.slice(3) : line || '\n') }); i++;
  }
  return blocks;
}

export function renderMarkdown(document, text) {
  const root = document.createElement('div'); root.className = 'discord-markdown';
  const append = (parent, tree) => { for (const item of tree) {
    if (typeof item === 'string') { parent.append(document.createTextNode(item)); continue; }
    const tag = item.tag === 'spoiler' ? 'button' : item.tag === 'strong-em' ? 'strong' : item.tag === 'u-em' ? 'u' : item.tag;
    const element = document.createElement(tag);
    if (item.href) { element.href = item.href; element.target = '_blank'; element.rel = 'noopener noreferrer'; }
    if (item.tag === 'spoiler') {
      element.type = 'button'; element.className = 'spoiler'; element.setAttribute('aria-expanded', 'false');
      element.setAttribute('aria-label', 'Reveal spoiler');
      element.addEventListener('click', () => { const shown = element.classList.toggle('revealed'); element.setAttribute('aria-expanded', String(shown)); element.setAttribute('aria-label', shown ? 'Hide spoiler' : 'Reveal spoiler'); });
    }
    if (item.tag.endsWith('-em')) { const emphasis = document.createElement('em'); append(emphasis, item.children); element.append(emphasis); }
    else append(element, item.children);
    parent.append(element);
  } };
  append(root, markdownTree(text)); return root;
}
