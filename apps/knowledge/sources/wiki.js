import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { MEDIAWIKI_EXTRACTOR_REVISION } from '../../../modules/assistant/knowledge.js';
import { createSourceReader } from './http.js';
import { blocksToSections, cleanText, documentIdBase, packDocuments } from './sectioning.js';

// Owner decision, 12 October 2026: every article of the Meridian wiki is synced and published automatically.
export const WIKI_SOURCE = Object.freeze({
  collection: 'wiki', prefix: 'wiki', origin: 'https://meridian-wiki.a13.info', endpoint: 'https://meridian-wiki.a13.info/api.php',
  wikiId: 'wiki_meridian', licenceUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', namespace: 0,
  // Instrument song sheets: large, not prose, and mostly third-party works.
  excludedPrefixes: ['Songs/'], maxWikitextBytes: 400000, maxPages: 600,
});
const sha256 = value => createHash('sha256').update(value).digest('hex');
const policyCategories = /^(?:polic(?:y|ies)|rules?)$/iu, loreCategories = /^lore$/iu;

export const wikiPageUrl = title => `${WIKI_SOURCE.origin}/wiki/${encodeURIComponent(title.replaceAll(' ', '_')).replace(/%2F/giu, '/').replace(/%3A/giu, ':')}`;

/**
 * Lists every article and its current revision, then parses only pages whose revision the mirror does not hold yet.
 * Returns entries for the mirror: { idBase, sourceRevision, documents } or { idBase, sourceRevision, unchanged: true }.
 */
export function createWikiCollector({ fetchImpl = fetch, extractor, clock = Date.now }) {
  requireCondition(extractor && typeof extractor.extract === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const reader = createSourceReader({ fetchImpl, origins: [WIKI_SOURCE.origin], prefix: 'WIKI' });
  async function api(parameters, signal) {
    const url = new URL(WIKI_SOURCE.endpoint);
    url.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...parameters }).toString();
    const value = await reader.json(url, { signal, maxBytes: 4194304 });
    requireCondition(value && typeof value === 'object' && !value.error, 'WIKI_RESPONSE_INVALID');
    return value;
  }
  return Object.freeze({ collection: WIKI_SOURCE.collection, prefix: WIKI_SOURCE.prefix,
    async collect({ signal, known = new Map() }) {
      const general = (await api({ action: 'query', meta: 'siteinfo', siprop: 'general|rightsinfo' }, signal)).query;
      requireCondition(general?.general?.server === WIKI_SOURCE.origin && general.general.wikiid === WIKI_SOURCE.wikiId &&
        general.general.articlepath === '/wiki/$1' && general.rightsinfo?.url === WIKI_SOURCE.licenceUrl, 'WIKI_SOURCE_SCOPE_CHANGED');
      const rights = `${cleanText(general.rightsinfo.text) || 'CC BY-NC-SA 4.0'} (${WIKI_SOURCE.licenceUrl})`;
      const pages = []; let next = null;
      do {
        const value = await api({ action: 'query', generator: 'allpages', gapnamespace: String(WIKI_SOURCE.namespace), gapfilterredir: 'nonredirects',
          gaplimit: '500', prop: 'info|revisions', rvprop: 'ids', ...(next ? { gapcontinue: next } : {}) }, signal);
        for (const page of value.query?.pages ?? []) {
          requireCondition(Number.isSafeInteger(page.pageid) && page.pageid > 0 && typeof page.title === 'string' && Number.isSafeInteger(page.lastrevid), 'WIKI_RESPONSE_INVALID');
          pages.push({ pageId: page.pageid, title: page.title, revision: page.lastrevid, length: page.length });
        }
        next = value.continue?.gapcontinue ?? null;
        requireCondition(pages.length <= WIKI_SOURCE.maxPages, 'WIKI_SOURCE_LIMIT');
      } while (next);
      requireCondition(pages.length > 0, 'WIKI_SOURCE_UNAVAILABLE');
      const entries = [], skipped = []; let truncated = 0;
      for (const page of pages.sort((a, b) => a.pageId - b.pageId)) {
        requireCondition(!signal.aborted, 'WIKI_SYNC_CANCELLED');
        const idBase = documentIdBase(WIKI_SOURCE.prefix, page.title, page.pageId), sourceRevision = `wiki:page:${page.pageId}:r${page.revision}`;
        if (WIKI_SOURCE.excludedPrefixes.some(prefix => page.title.startsWith(prefix)) || page.length > WIKI_SOURCE.maxWikitextBytes) { skipped.push('EXCLUDED'); continue; }
        if (known.get(idBase) === sourceRevision) { entries.push({ idBase, sourceRevision, unchanged: true }); continue; }
        try {
          const parsed = (await api({ action: 'parse', pageid: String(page.pageId), prop: 'text|revid|categories|displaytitle',
            disableeditsection: '1', disablelimitreport: '1', disabletoc: '1' }, signal)).parse;
          requireCondition(parsed?.pageid === page.pageId && typeof parsed.text === 'string' && Number.isSafeInteger(parsed.revid), 'WIKI_RENDER_INVALID');
          const extraction = await extractor.extract({ html: parsed.text, htmlHash: sha256(parsed.text), mode: 'mediawiki', signal, timeoutMs: 5000 });
          requireCondition(extraction.extractorRevision === MEDIAWIKI_EXTRACTOR_REVISION, 'WIKI_EXTRACTION_FAILED');
          const categories = (parsed.categories ?? []).map(item => String(item.category ?? '').replaceAll('_', ' '));
          const authority = categories.some(name => policyCategories.test(name)) ? 'policy' : categories.some(name => loreCategories.test(name)) ? 'lore' : 'reference';
          const display = cleanText(String(parsed.displaytitle ?? '').replace(/<[^>]*>/gu, ''));
          const revision = `wiki:page:${page.pageId}:r${parsed.revid}`;
          const packed = packDocuments({ idBase, title: page.title, kind: 'wiki-page', authority, url: wikiPageUrl(page.title), rights,
            attribution: `Meridian Wiki contributors; history: ${WIKI_SOURCE.origin}/index.php?curid=${page.pageId}&action=history`,
            sourceRevision: revision, fetchedAt: clock(), aliases: display && display !== page.title ? [display] : [],
            sections: blocksToSections(extraction.blocks, page.title) });
          if (packed.truncated) truncated++;
          if (packed.documents.length) entries.push({ idBase, sourceRevision: revision, documents: packed.documents });
          else skipped.push('EMPTY');
        } catch (error) {
          if (signal.aborted) throw error;
          // One unreadable page never blocks the rest; a page already held keeps its published text until it expires.
          skipped.push(/^WIKI_[A-Z_]+$/u.test(error?.message) ? error.message : 'WIKI_PAGE_FAILED');
          if (known.has(idBase)) entries.push({ idBase, sourceRevision: known.get(idBase), unchanged: true });
        }
      }
      return { entries, listed: pages.length, skipped: skipped.length, truncated };
    } });
}
