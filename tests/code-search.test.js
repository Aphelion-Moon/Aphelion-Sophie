import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSearchTerms, createCodeSearch, withCodeSearch } from '../apps/knowledge/code-search.js';

const token = `github_pat_${'B'.repeat(82)}`, ref = 'd'.repeat(40);
const respond = (body, { status = 200, type = 'application/json' } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
const file = Array.from({ length: 80 }, (_, index) => index === 40 ? 'public sealed partial class HydroponicsSystem : EntitySystem' : `// synthetic line ${index + 1}`).join('\n');

test('only questions that look like code produce search words, and IDs or redaction markers never do', () => {
  assert.equal(codeSearchTerms('Hi Sophie, how are you today?'), null);
  assert.deepEqual(codeSearchTerms('Where is `HydroponicsSystem` defined?'), ['HydroponicsSystem']);
  assert.deepEqual(codeSearchTerms('Which file sets up botany_tray.dm in the code?').slice(0, 1), ['botany_tray.dm']);
  assert.ok(codeSearchTerms('What does the GasMixer component do?').includes('GasMixer'));
  const terms = codeSearchTerms('In the code, why does [member] get 123456789012345678 from [id] and [email]?') ?? [];
  assert.ok(terms.every(term => !/\d{5,}/u.test(term) && !['member', 'id', 'email'].includes(term.toLowerCase())));
  assert.ok((codeSearchTerms('code '.repeat(10) + 'alpha beta gamma delta epsilon zeta eta theta') ?? []).length <= 5);
});

function fixture({ items, files = {}, perMinute = 8 } = {}) {
  let now = 1_000; const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization ?? null });
    if (url.origin === 'https://api.github.com') return respond({ total_count: items.length, items });
    const path = decodeURIComponent(url.pathname);
    return Object.hasOwn(files, path) ? respond(files[path], { type: 'text/plain' }) : respond('', { status: 404, type: 'text/plain' });
  };
  const search = createCodeSearch({ token, fetchImpl, clock: () => now, perMinute });
  return { search, calls, advance: ms => { now += ms; } };
}
const item = (fullName, path, extra = {}) => ({ path, repository: { full_name: fullName, fork: false, private: false }, url: `https://api.github.com/repositories/1/contents/${path}?ref=${ref}`, ...extra });

test('code search stays inside the allowlist, sends the token only to the API and returns cited line windows', async () => {
  const f = fixture({ items: [item('Someone/Else', 'x.cs'), item('Aphelion-Moon/Aphelion-Sophie', 'docs/verification.md'),
    item('VanguardControl/Wolfgate', 'Content.Server/Botany/HydroponicsSystem.cs'), item('Aphelion-Moon/Meridian-Rift', 'code/hydroponics.dm', { repository: { full_name: 'Aphelion-Moon/Meridian-Rift', fork: true } })],
    files: { [`/VanguardControl/Wolfgate/${ref}/Content.Server/Botany/HydroponicsSystem.cs`]: file } });
  const sources = await f.search.search({ text: 'Where is `HydroponicsSystem` defined?', game: 'ss14-wolfgate' });
  assert.equal(sources.length, 1);
  const [source] = sources;
  assert.match(source.id, /^code-[a-f0-9]{12}\.r1\.s0$/u);
  assert.equal(source.title, 'VanguardControl/Wolfgate: Content.Server/Botany/HydroponicsSystem.cs');
  assert.ok(source.text.includes('HydroponicsSystem : EntitySystem') && source.text.length <= 3500);
  assert.match(source.url, new RegExp(`^https://github\\.com/VanguardControl/Wolfgate/blob/${ref}/Content\\.Server/Botany/HydroponicsSystem\\.cs#L\\d+-L\\d+$`, 'u'));
  assert.equal(source.rights, 'AGPL-3.0-or-later for later contributions, MIT for earlier ones (see LEGAL.md)');
  const query = new URL(f.calls[0].url).searchParams.get('q');
  assert.equal(query, 'HydroponicsSystem repo:VanguardControl/Wolfgate');
  assert.equal(f.calls[0].auth, `Bearer ${token}`);
  assert.ok(f.calls.slice(1).every(call => call.auth === null && call.url.startsWith('https://raw.githubusercontent.com/VanguardControl/Wolfgate/')), 'only the allowed file is read, without the token');
  assert.equal(f.search.current(source), true); assert.equal(f.search.current({ ...source, publicationHash: 'e'.repeat(64) }), false);
  f.advance(10 * 60_000); assert.equal(f.search.current(source), false, 'a code source expires after ten minutes');
});

test('code search caches repeated questions, respects its rate limit and searches nothing for chat', async () => {
  const f = fixture({ items: [], perMinute: 4 });
  assert.deepEqual(await f.search.search({ text: 'hello there' }), []); assert.equal(f.calls.length, 0);
  await f.search.search({ text: 'Where is `AlphaSystem` defined?' }); await f.search.search({ text: 'Where is `AlphaSystem` defined?' });
  assert.equal(f.calls.length, 2, 'one query per scope, and a repeat within ten minutes is served from the cache');
  assert.deepEqual(f.calls.map(call => new URL(call.url).searchParams.get('q')), ['AlphaSystem org:Aphelion-Moon', 'AlphaSystem repo:VanguardControl/Wolfgate']);
  await f.search.search({ text: 'Where is `BetaSystem` defined?' });
  await assert.rejects(f.search.search({ text: 'Where is `GammaSystem` defined?' }), /CODE_SEARCH_LIMITED/);
  assert.throws(() => createCodeSearch({ token: null }), /GITHUB_TOKEN_INVALID/);
});

test('the knowledge wrapper adds code only where the context turns it on and checks code sources itself', async () => {
  const library = { lookup: async () => Array.from({ length: 6 }, (_, index) => ({ id: `wiki-a-abc123.r1.s${index}` })),
    current: async sources => { assert.ok(sources.every(source => !source.id.startsWith('code-'))); return true; }, currentReferences: async () => true };
  const code = { id: 'code-aaaaaaaaaaaa.r1.s0', publicationHash: 'f'.repeat(64) };
  let searched = 0, valid = true;
  const knowledge = withCodeSearch(library, { search: async () => { searched++; return [code]; }, current: () => valid });
  assert.equal((await knowledge.lookup('q', { context: { codeSearch: false } })).length, 6); assert.equal(searched, 0);
  const found = await knowledge.lookup('q', { context: { codeSearch: true, game: null } });
  assert.equal(found.length, 6); assert.equal(found.at(-1), code, 'code takes the place of the lowest-ranked passage');
  assert.equal(await knowledge.current(found, {}), true); valid = false; assert.equal(await knowledge.current(found, {}), false);
  const faults = [], failing = withCodeSearch(library, { search: async () => { throw new Error('CODE_SEARCH_LIMITED'); }, current: () => true }, code => faults.push(code));
  assert.equal((await failing.lookup('q', { context: { codeSearch: true } })).length, 6); assert.deepEqual(faults, ['AI_CODE_SEARCH_LIMITED']);
  assert.equal(withCodeSearch(library, null), library);
});
