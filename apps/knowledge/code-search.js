import { createHash } from 'node:crypto';
import { requireCondition } from '../../contracts/validation.js';
import { createSourceReader } from './sources/http.js';
import { GITHUB_SOURCE, requireGithubToken } from './sources/github.js';

/**
 * Code questions (owner decision, 23 October 2026): in contexts with code search on, Sophie may read the community's
 * public code. No model decides what is fetched: words that look like code (identifiers, file names, quoted names) are
 * taken from the member's already redacted message, searched with GitHub code search inside a fixed allowlist, and at
 * most two line windows join the turn's sources. Nothing is cloned, executed or followed beyond these two origins.
 */
export const CODE_SEARCH_SCOPE = Object.freeze({
  organisations: [GITHUB_SOURCE.organisation], repositories: [...GITHUB_SOURCE.extraRepositories],
  // A context's game narrows the search to that game's code.
  games: { 'ss14-wolfgate': ['VanguardControl/Wolfgate'], 'ss13-meridian': ['Aphelion-Moon/Meridian-Rift'] },
  // Sophie's own docs are internal engineering records, as in the documentation sync.
  excludedPaths: [/^Aphelion-Moon\/Aphelion-Sophie\/docs\//u],
});
export const CODE_SOURCE_LIFETIME_MS = 10 * 60_000;
const MAX_RESULTS = 2, WINDOW_LINES = 30, WINDOW_CHARS = 3_500, FILE_BYTES = 393_216;
const sha = value => createHash('sha256').update(value).digest('hex');
const CODE_HINT = /\b(?:code|coded|function|method|proc|class|struct|component|system|prototype|file|repo|repository|variable|define[ds]?|implement(?:ed|s)?|source|yaml|yml|config|datum|verb|signal|event)\b/iu;
const STOP = new Set(['where', 'what', 'which', 'when', 'does', 'that', 'this', 'with', 'from', 'have', 'there', 'their', 'they', 'about', 'would', 'could',
  'should', 'into', 'your', 'sophie', 'please', 'code', 'file', 'repo', 'repository', 'function', 'method', 'class', 'defined', 'implemented', 'source', 'find',
  'show', 'tell', 'know', 'game', 'server', 'work', 'works', 'make', 'made', 'used', 'using', 'thing', 'how', 'why', 'the', 'and', 'for', 'are', 'can']);
const TERM = /^[A-Za-z_][A-Za-z0-9_.\/-]{1,59}$/u;
const LICENCES = { ...GITHUB_SOURCE.licences };

/** The search words for a message, or null when it does not look like a question about code. */
export function codeSearchTerms(text) {
  requireCondition(typeof text === 'string' && text.length <= 4000, 'AI_INPUT_INVALID');
  const quoted = [...text.matchAll(/`([^`\n]{2,60})`/gu)].map(match => match[1].trim());
  const words = text.replace(/`[^`\n]*`/gu, ' ').split(/[^A-Za-z0-9_.\/-]+/u).filter(Boolean);
  const identifier = word => /[a-z][A-Z]|_[A-Za-z]|^[A-Z][a-z]+[A-Z]/u.test(word) || /\.(?:cs|dm|dme|yml|yaml|ftl|js|ts|py|json|xml|toml|md)$/iu.test(word) || /[a-z]\/[a-z]/iu.test(word);
  const specific = [...quoted, ...words.filter(identifier)];
  if (!specific.length && !CODE_HINT.test(text)) return null;
  // Never search with something that looks like an ID, a number or a redaction marker.
  const usable = word => TERM.test(word) && !/\d{5,}/u.test(word) && !/^(?:member|email|phone|id)$/iu.test(word);
  const plain = words.filter(word => word.length >= 4 && !STOP.has(word.toLowerCase()) && !identifier(word));
  const terms = [...new Set([...specific, ...plain].map(word => word.replace(/^[./-]+|[./-]+$/gu, '')).filter(usable))].slice(0, 5);
  return terms.length ? terms : null;
}

export function createCodeSearch({ token, fetchImpl = fetch, clock = Date.now, perMinute = 8 }) {
  requireCondition(requireGithubToken(token) !== null, 'GITHUB_TOKEN_INVALID');
  const reader = createSourceReader({ fetchImpl, origins: [GITHUB_SOURCE.api, GITHUB_SOURCE.raw], prefix: 'CODE' });
  const recent = [], cache = new Map(), issued = new Map();
  const allowed = fullName => typeof fullName === 'string' && (CODE_SEARCH_SCOPE.repositories.includes(fullName) ||
    CODE_SEARCH_SCOPE.organisations.includes(fullName.split('/')[0]));
  function throttle() {
    const now = clock();
    while (recent.length && now - recent[0] >= 60_000) recent.shift();
    if (recent.length >= perMinute) return false;
    recent.push(now); return true;
  }
  function windowAround(text, terms) {
    const lines = text.split(/\r?\n/u), lower = terms.map(term => term.toLowerCase());
    const hit = Math.max(0, lines.findIndex(line => lower.some(term => line.toLowerCase().includes(term))));
    let start = Math.max(0, hit - Math.floor(WINDOW_LINES / 3)), end = Math.min(lines.length, start + WINDOW_LINES);
    let body = lines.slice(start, end).join('\n');
    while (body.length > WINDOW_CHARS && end - 1 > hit) { end--; body = lines.slice(start, end).join('\n'); }
    return { start: start + 1, end, body: body.slice(0, WINDOW_CHARS) };
  }
  return Object.freeze({
    /** Sources for this turn (at most two), or none. Failures are reported by the caller as a fixed code. */
    async search({ text, game = null, signal = AbortSignal.timeout(8_000) }) {
      const terms = codeSearchTerms(text);
      if (terms === null) return [];
      const repositories = game === null ? null : CODE_SEARCH_SCOPE.games[game] ?? null;
      // GitHub's code search takes one scope per query (an org: and a repo: together are refused), so each is searched in turn.
      const scopes = repositories === null
        ? [...CODE_SEARCH_SCOPE.organisations.map(owner => `org:${owner}`), ...CODE_SEARCH_SCOPE.repositories.map(name => `repo:${name}`)]
        : repositories.map(name => `repo:${name}`);
      const key = JSON.stringify([terms, scopes]), cached = cache.get(key);
      if (cached && clock() - cached.at < CODE_SOURCE_LIFETIME_MS) return cached.sources;
      const words = terms.map(term => /[\s"]/u.test(term) ? `"${term}"` : term).join(' ');
      const items = [];
      for (const scope of scopes) {
        if (items.length >= MAX_RESULTS) break;
        if (!throttle()) { if (items.length) break; throw new Error('CODE_SEARCH_LIMITED'); }
        const found = await reader.json(`${GITHUB_SOURCE.api}/search/code?${new URLSearchParams({ q: `${words} ${scope}`, per_page: '5' })}`, { signal, maxBytes: 1048576,
          headers: { 'x-github-api-version': '2022-11-28', authorization: `Bearer ${token}`, accept: 'application/vnd.github.text-match+json' } });
        requireCondition(Array.isArray(found?.items), 'CODE_RESPONSE_INVALID');
        items.push(...found.items);
      }
      const sources = [];
      for (const item of items) {
        if (sources.length >= MAX_RESULTS) break;
        const fullName = item?.repository?.full_name, path = item?.path;
        if (!allowed(fullName) || item.repository.fork === true || item.repository.private === true || typeof path !== 'string' || !/^[A-Za-z0-9_.\/ -]{1,300}$/u.test(path)) continue;
        if (CODE_SEARCH_SCOPE.excludedPaths.some(pattern => pattern.test(`${fullName}/${path}`))) continue;
        const ref = new URL(String(item.url ?? 'https://invalid.invalid')).searchParams.get('ref');
        if (typeof ref !== 'string' || !/^[a-f0-9]{40}$/u.test(ref)) continue;
        const file = await reader.text(`${GITHUB_SOURCE.raw}/${fullName}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`, { signal, maxBytes: FILE_BYTES, allowMissing: true });
        if (!file?.text?.isWellFormed() || file.text.includes('\u0000')) continue;
        const { start, end, body } = windowAround(file.text, terms);
        if (!body.trim()) continue;
        const id = `code-${sha(`${fullName}/${path}@${ref}:${start}`).slice(0, 12)}.r1.s0`, publicationHash = sha(body);
        const source = { id, title: `${fullName}: ${path}`, heading: `Lines ${start}-${end}`, text: body, authority: 'reference',
          url: `${GITHUB_SOURCE.site}/${fullName}/blob/${ref}/${path.split('/').map(encodeURIComponent).join('/')}#L${start}-L${end}`,
          rights: LICENCES[fullName] ?? 'see the repository licence', attribution: `${fullName} on GitHub`, sourceRevision: `github:${fullName}:${path}@${ref.slice(0, 12)}`,
          publicationHash, epoch: 1, validUntil: clock() + CODE_SOURCE_LIFETIME_MS };
        issued.set(id, { publicationHash, validUntil: source.validUntil });
        sources.push(Object.freeze(source));
      }
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { at: clock(), sources });
      for (const [id, value] of issued) if (value.validUntil <= clock()) issued.delete(id);
      return sources;
    },
    /** A code source stays usable for ten minutes after it was read, unchanged. */
    current(source) {
      const value = issued.get(source?.id);
      return value !== undefined && value.publicationHash === source.publicationHash && clock() < value.validUntil;
    },
  });
}

/** Library knowledge plus code search for contexts that turn it on. Code sources never reach the library. */
export function withCodeSearch(knowledge, codeSearch, onFault = () => {}) {
  if (codeSearch === null) return knowledge;
  const isCode = source => typeof source?.id === 'string' && source.id.startsWith('code-');
  return Object.freeze({
    async lookup(text, request, recentText) {
      const found = await knowledge.lookup(text, request, recentText);
      if (request?.context?.codeSearch !== true) return found;
      let code = [];
      try { code = await codeSearch.search({ text, game: request.context.game ?? null }); }
      catch (error) { try { onFault(/^CODE_[A-Z_]+$/u.test(error?.message ?? '') ? `AI_${error.message}` : 'AI_CODE_SEARCH_UNAVAILABLE'); } catch { /* Diagnostics only. */ } }
      return [...found.slice(0, Math.max(0, 6 - code.length)), ...code];
    },
    async current(sources, request) {
      return sources.filter(isCode).every(source => codeSearch.current(source)) && await knowledge.current(sources.filter(source => !isCode(source)), request);
    },
    async currentReferences(sources, request) {
      return sources.filter(isCode).every(source => codeSearch.current(source)) && await knowledge.currentReferences(sources.filter(source => !isCode(source)), request);
    },
  });
}
