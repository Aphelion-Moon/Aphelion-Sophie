import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { createSourceReader } from './http.js';
import { SITE_EXTRACTOR_REVISION } from '../html-extractor.js';
import { blocksToSections, cleanText, documentIdBase, packDocuments } from './sectioning.js';

// Owner decision, 12 October 2026: the public main website (a13.info itself is still behind Cloudflare Access).
export const SITE_SOURCE = Object.freeze({
  collection: 'site', prefix: 'site', origin: 'https://meridian.a13.info', sitemap: 'https://meridian.a13.info/sitemap.xml',
  seeds: ['/docs/'], crawlPrefixes: ['/docs/'], maxPages: 120,
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/giu, (match, name) => name[0] === '#'
  ? String.fromCodePoint(Number.parseInt(name[1] === 'x' ? name.slice(2) : name.slice(1), name[1] === 'x' ? 16 : 10)) : entities[name.toLowerCase()] ?? match);

/** robots.txt Disallow prefixes for every user agent. */
export function robotsDisallow(text) {
  const prefixes = []; let applies = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/u, '').trim(), [key, ...rest] = line.split(':'), value = rest.join(':').trim();
    if (/^user-agent$/iu.test(key)) applies = value === '*';
    else if (applies && /^disallow$/iu.test(key) && value.startsWith('/')) prefixes.push(value);
  }
  return prefixes;
}

export function createWebsiteCollector({ fetchImpl = fetch, extractor, clock = Date.now }) {
  requireCondition(extractor && typeof extractor.extract === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const reader = createSourceReader({ fetchImpl, origins: [SITE_SOURCE.origin], prefix: 'SITE' });
  const canonical = value => { const url = new URL(value, SITE_SOURCE.origin); url.hash = ''; url.search = ''; return url; };
  return Object.freeze({ collection: SITE_SOURCE.collection, prefix: SITE_SOURCE.prefix,
    async collect({ signal }) {
      const robots = await reader.text(`${SITE_SOURCE.origin}/robots.txt`, { signal, allowMissing: true, maxBytes: 65536 });
      const disallowed = robots ? robotsDisallow(robots.text) : [];
      const sitemap = await reader.text(SITE_SOURCE.sitemap, { signal, maxBytes: 1048576 });
      const queue = [...sitemap.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/giu)].map(match => decode(match[1]))
        .concat(SITE_SOURCE.seeds.map(path => SITE_SOURCE.origin + path));
      const seen = new Set(), visited = new Set(), entries = [], skipped = [];
      while (queue.length && visited.size < SITE_SOURCE.maxPages) {
        requireCondition(!signal.aborted, 'SITE_SYNC_CANCELLED');
        let url; try { url = canonical(queue.shift()); } catch { skipped.push('SITE_URL_INVALID'); continue; }
        if (url.origin !== SITE_SOURCE.origin || seen.has(url.pathname) || disallowed.some(prefix => url.pathname.startsWith(prefix))) continue;
        seen.add(url.pathname);
        try {
          const page = await reader.text(url, { signal, maxBytes: 786432 });
          requireCondition(/text\/html/iu.test(page.type), 'SITE_RESPONSE_INVALID');
          const final = canonical(page.url);
          if (visited.has(final.pathname)) continue;
          visited.add(final.pathname); seen.add(final.pathname);
          if (SITE_SOURCE.crawlPrefixes.some(prefix => final.pathname.startsWith(prefix)))
            for (const match of page.text.matchAll(/href="([^"#?]+)"/giu)) {
              const path = decode(match[1]);
              if (SITE_SOURCE.crawlPrefixes.some(prefix => path.startsWith(prefix))) queue.push(SITE_SOURCE.origin + path);
            }
          const extraction = await extractor.extract({ html: page.text, htmlHash: sha256(page.text), mode: 'site', signal, timeoutMs: 5000 });
          requireCondition(extraction.extractorRevision === SITE_EXTRACTOR_REVISION, 'SITE_EXTRACTION_FAILED');
          const heading = /<title[^>]*>([^<]{1,300})<\/title>/iu.exec(page.text);
          const title = cleanText(decode(heading?.[1] ?? '')).replace(/\s*[|·–—-]\s*Meridian.*$/iu, '') || final.pathname;
          const sections = blocksToSections(extraction.blocks, title);
          const content = sha256(JSON.stringify(sections));
          const packed = packDocuments({ idBase: documentIdBase(SITE_SOURCE.prefix, final.pathname, final.pathname), title, kind: 'website',
            authority: final.pathname.startsWith('/lore') ? 'lore' : 'reference', url: final.href,
            rights: 'Published by the Aphelion project on meridian.a13.info', attribution: `Meridian Rift website: ${title}`,
            sourceRevision: `site:${final.pathname}:${content.slice(0, 16)}`, fetchedAt: clock(), sections, maxParts: 4 });
          if (packed.documents.length) entries.push({ idBase: packed.documents[0].id, sourceRevision: packed.documents[0].sourceRevision, documents: packed.documents });
          else skipped.push('EMPTY');
        } catch (error) {
          if (signal.aborted) throw error;
          skipped.push(/^(?:SITE|WIKI)_[A-Z_]+$/u.test(error?.message) ? error.message : 'SITE_PAGE_FAILED');
        }
      }
      requireCondition(entries.length > 0, 'SITE_SOURCE_UNAVAILABLE');
      return { entries, listed: visited.size, skipped: skipped.length, truncated: 0, complete: skipped.length === 0 };
    } });
}
