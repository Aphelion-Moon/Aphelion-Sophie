import { requireCondition, requireInteger } from '../../../contracts/validation.js';

export const SYNC_USER_AGENT = 'SophieKnowledge/0.2 (Aphelion community assistant; public source sync)';

/**
 * Anonymous GET of a fixed allowlisted origin. Follows at most three same-origin redirects, caps the body, and turns
 * every failure into a fixed code so upstream text, headers or URLs never reach logs or the dashboard.
 */
export function createSourceReader({ fetchImpl = fetch, origins, prefix }) {
  requireCondition(typeof fetchImpl === 'function' && Array.isArray(origins) && origins.length > 0 && /^[A-Z]+$/u.test(prefix), 'TRUSTED_ADAPTERS_REQUIRED');
  const allowed = new Set(origins.map(origin => new URL(origin).origin));
  async function read(input, { signal, accept, maxBytes = 1048576, allowMissing = false, headers = {} }) {
    requireInteger(maxBytes, 1, 4194304);
    let url = new URL(input);
    for (let hop = 0; ; hop++) {
      requireCondition(url.protocol === 'https:' && allowed.has(url.origin) && !url.username && !url.password, `${prefix}_SOURCE_SCOPE_CHANGED`);
      const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal,
        headers: { accept, 'user-agent': SYNC_USER_AGENT, ...(hop === 0 ? headers : {}) } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get('location');
        requireCondition(hop < 3 && typeof location === 'string', `${prefix}_RESPONSE_INVALID`);
        url = new URL(location, url); continue;
      }
      if (allowMissing && response.status === 404) { await response.body?.cancel().catch(() => {}); return null; }
      // A rate limit is a 429, or a 403 that says so (GitHub: no requests remaining, or a retry-after). Any other 403 is a
      // refusal of that resource, named apart so the log says which (owner log review, 25 October 2026: an hourly
      // GITHUB_RATE_LIMITED with a token configured).
      if (response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
        await response.body?.cancel().catch(() => {}); throw new Error(`${prefix}_RATE_LIMITED`);
      }
      if (response.status === 403) { await response.body?.cancel().catch(() => {}); throw new Error(`${prefix}_FORBIDDEN`); }
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new Error(`${prefix}_RESPONSE_INVALID`); }
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) { await response.body?.cancel().catch(() => {}); throw new Error(`${prefix}_RESPONSE_LIMIT`); }
      const reader = response.body?.getReader(); requireCondition(reader, `${prefix}_RESPONSE_INVALID`);
      const chunks = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength; if (length > maxBytes) throw new Error(`${prefix}_RESPONSE_LIMIT`); chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      return { url: url.href, type: response.headers.get('content-type') ?? '', text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) };
    }
  }
  return Object.freeze({
    async text(url, options) { return read(url, { accept: 'text/html,text/plain,text/markdown,application/xml;q=0.9,*/*;q=0.1', ...options }); },
    async json(url, options) {
      const result = await read(url, { accept: 'application/json', ...options });
      if (result === null) return null;
      requireCondition(/json/iu.test(result.type), `${prefix}_RESPONSE_INVALID`);
      try { return JSON.parse(result.text); } catch { throw new Error(`${prefix}_RESPONSE_INVALID`); }
    },
  });
}

/** Maps any thrown value to a fixed code with the collector's prefix. */
export function sourceErrorCode(error, prefix, signal) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (new RegExp(`^${prefix}_[A-Z_]+$`, 'u').test(message) || /^(?:WIKI|SITE|GITHUB|GUIDE)_[A-Z_]+$/u.test(message)) return message;
  return signal?.aborted ? `${prefix}_SYNC_CANCELLED` : `${prefix}_SYNC_FAILED`;
}
