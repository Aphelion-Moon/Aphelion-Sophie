import { createHash } from 'node:crypto';
import { requireCondition, requireInteger } from '../../contracts/validation.js';

// Owner-selected collection. Adding pages, redirects or another origin requires a source-scope decision.
export const POLICIES_SOURCE = Object.freeze({
  id: 'meridian-policies', title: 'Policies', pageId: 878,
  url: 'https://meridian-wiki.a13.info/wiki/Policies',
  endpoint: 'https://meridian-wiki.a13.info/api.php',
  licenceUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  authority: 'policy',
});
const digest = value => createHash('sha256').update(value).digest('hex');
const jsonHash = value => digest(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validText = (text, max) => typeof text === 'string' && text.length > 0 && text.length <= max && text.isWellFormed() && !/[\u0000-\u001f\u007f]/u.test(text);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

async function boundedJson(response) {
  const reader = response.body?.getReader(); requireCondition(reader, 'WIKI_RESPONSE_INVALID');
  let length = 0; const chunks = [];
  try {
    requireCondition(response.ok && !response.redirected && response.headers.get('content-type')?.includes('application/json'), 'WIKI_RESPONSE_INVALID');
    const declared = response.headers.get('content-length');
    requireCondition(declared === null || /^\d+$/u.test(declared) && Number(declared) <= 1048576, 'WIKI_RESPONSE_LIMIT');
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; requireCondition(length <= 1048576, 'WIKI_RESPONSE_LIMIT'); chunks.push(value);
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    requireCondition(value && typeof value === 'object' && !value.error && !value.continue && !value.batchcomplete?.error, 'WIKI_RESPONSE_INVALID');
    return value;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function revision(page, expectedNamespace) {
  requireCondition(page && Number.isSafeInteger(page.pageid) && page.pageid > 0 && page.ns === expectedNamespace && validText(page.title, 255) &&
    !page.missing && !page.invalid && !page.redirect && ['wikitext', 'sanitized-css'].includes(page.contentmodel) &&
    Array.isArray(page.revisions) && page.revisions.length === 1, 'WIKI_SOURCE_UNAVAILABLE');
  const rev = page.revisions[0];
  requireCondition(Number.isSafeInteger(rev.revid) && rev.revid > 0 && rev.revid === page.lastrevid &&
    /^[a-f0-9]{40}$/u.test(rev.sha1) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/u.test(rev.timestamp), 'WIKI_REVISION_INVALID');
  return { pageId: page.pageid, title: page.title, revision: rev.revid, sha1: rev.sha1, timestamp: rev.timestamp, contentModel: page.contentmodel };
}

function rendered(value) {
  const parsed = value.parse;
  requireCondition(parsed?.pageid === POLICIES_SOURCE.pageId && parsed.title === POLICIES_SOURCE.title && Number.isSafeInteger(parsed.revid) &&
    typeof parsed.text === 'string' && parsed.text.length > 0 && parsed.text.isWellFormed() && Buffer.byteLength(parsed.text) <= 786432 &&
    Array.isArray(parsed.templates) && parsed.templates.length <= 64 && Array.isArray(parsed.parsewarnings) && parsed.parsewarnings.length === 0,
  'WIKI_RENDER_INVALID');
  const templates = parsed.templates.map(item => {
    requireCondition(item.ns === 10 && item.exists === true && validText(item.title, 255) && /^Template:/u.test(item.title) && !item.title.includes('|'), 'WIKI_DEPENDENCY_INVALID');
    return item.title;
  }).sort(compare);
  requireCondition(new Set(templates).size === templates.length, 'WIKI_DEPENDENCY_INVALID');
  return { revision: parsed.revid, html: parsed.text, templates };
}

/** Read-only anonymous collector. No core store, Discord token, inference, HTML execution or publication authority. */
export function createMediaWikiCollector({ fetchImpl = fetch, clock = Date.now } = {}) {
  requireCondition(typeof fetchImpl === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  let active = false;
  return Object.freeze({ async collectPolicies({ signal = new AbortController().signal, timeoutMs = 30000 } = {}) {
    requireInteger(timeoutMs, 1, 60000); requireCondition(!active, 'WIKI_IMPORT_BUSY');
    active = true;
    const fetchedAt = clock(), deadline = fetchedAt + timeoutMs;
    const abort = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const current = () => requireCondition(!abort.aborted && clock() < deadline, 'WIKI_IMPORT_EXPIRED');
    try {
      async function query(parameters) {
        current();
        const url = new URL(POLICIES_SOURCE.endpoint);
        url.search = new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', maxage: '0', smaxage: '0', ...parameters }).toString();
        const response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit', signal: abort,
          headers: { accept: 'application/json', 'user-agent': 'SophieKnowledge/0.1 (approved public Policies collection)' } });
        if (response.url && response.url !== url.href) { await response.body?.cancel().catch(() => {}); throw new Error('WIKI_RESPONSE_INVALID'); }
        const value = await boundedJson(response); current(); return value;
      }
      async function site() {
        const value = (await query({ action: 'query', meta: 'siteinfo', siprop: 'general|rightsinfo' })).query;
        requireCondition(value?.general?.server === new URL(POLICIES_SOURCE.endpoint).origin && value.general.scriptpath === '' &&
          value.general.articlepath === '/wiki/$1' && value.general.wikiid === 'wiki_meridian' && validText(value.general.generator, 100) &&
          value.rightsinfo?.url === POLICIES_SOURCE.licenceUrl && validText(value.rightsinfo.text, 300), 'WIKI_SOURCE_SCOPE_CHANGED');
        return { wikiId: value.general.wikiid, generator: value.general.generator, rights: { url: value.rightsinfo.url, text: value.rightsinfo.text } };
      }
      async function page() {
        const value = (await query({ action: 'query', pageids: String(POLICIES_SOURCE.pageId), prop: 'info|revisions', rvprop: 'ids|timestamp|sha1|contentmodel' })).query;
        requireCondition(Array.isArray(value?.pages) && value.pages.length === 1 && !value.redirects && !value.normalized, 'WIKI_SOURCE_UNAVAILABLE');
        const result = revision(value.pages[0], 0);
        requireCondition(result.pageId === POLICIES_SOURCE.pageId && result.title === POLICIES_SOURCE.title && result.contentModel === 'wikitext', 'WIKI_SOURCE_SCOPE_CHANGED');
        return result;
      }
      async function parse() {
        return rendered(await query({ action: 'parse', pageid: String(POLICIES_SOURCE.pageId), prop: 'text|revid|templates|parsewarnings',
          disableeditsection: '1', disablelimitreport: '1' }));
      }
      async function dependencies(titles) {
        const records = [];
        for (let start = 0; start < titles.length; start += 50) {
          const batch = titles.slice(start, start + 50);
          const value = (await query({ action: 'query', titles: batch.join('|'), prop: 'info|revisions', rvprop: 'ids|timestamp|sha1|contentmodel' })).query;
          requireCondition(Array.isArray(value?.pages) && value.pages.length === batch.length && !value.redirects && !value.normalized, 'WIKI_DEPENDENCY_INVALID');
          const rows = value.pages.map(item => revision(item, 10)).sort((a, b) => compare(a.title, b.title));
          requireCondition(same(rows.map(row => row.title), batch), 'WIKI_DEPENDENCY_INVALID'); records.push(...rows);
        }
        return records;
      }
      const identity = await site(), initialPage = await page(), initialRender = await parse();
      requireCondition(initialRender.revision === initialPage.revision, 'WIKI_SOURCE_CHANGED');
      const initialDependencies = await dependencies(initialRender.templates);
      const finalRender = await parse(), finalDependencies = await dependencies(finalRender.templates);
      const finalPage = await page(), finalIdentity = await site();
      requireCondition(same(identity, finalIdentity) && same(initialPage, finalPage) && same(initialDependencies, finalDependencies) &&
        same(initialRender, finalRender), 'WIKI_SOURCE_CHANGED');
      current();
      const htmlHash = digest(finalRender.html), dependencyHash = jsonHash(finalDependencies);
      // Repeated observations detect ordinary races, not an atomic server-side snapshot or a future freshness guarantee.
      const snapshot = { schema: 1, collection: POLICIES_SOURCE.id, source: POLICIES_SOURCE, site: identity,
        page: finalPage, dependencies: finalDependencies, dependencyHash, htmlHash, fetchedAt,
        html: finalRender.html, approved: false };
      return freeze({ ...snapshot, snapshotHash: jsonHash({ source: POLICIES_SOURCE, site: identity, page: finalPage, dependencyHash, htmlHash }) });
    } catch (error) {
      // Never propagate upstream response text, headers or URLs into dashboard/log error messages.
      throw new Error(/^WIKI_[A-Z_]+$/u.test(error?.message) ? error.message : abort.aborted ? 'WIKI_IMPORT_EXPIRED' : 'WIKI_IMPORT_FAILED');
    } finally { active = false; }
  } });
}
