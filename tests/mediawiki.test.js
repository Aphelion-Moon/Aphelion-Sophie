import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaWikiCollector, POLICIES_SOURCE } from '../apps/knowledge/mediawiki.js';

const NOW = 1790596800000;
const page = (title = 'Policies', pageid = 878, ns = 0, revid = 12) => ({ title, pageid, ns, contentmodel: 'wikitext', lastrevid: revid,
  revisions: [{ revid, sha1: 'a'.repeat(40), timestamp: '2026-09-28T00:00:00Z' }] });
function fixture(change = () => {}) {
  const calls = []; let parses = 0, dependencies = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin + url.pathname, POLICIES_SOURCE.endpoint);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.authorization, undefined); assert.equal(options.headers.cookie, undefined);
    assert.equal(url.searchParams.has('redirects'), false); assert.equal(url.searchParams.has('rvslots'), false);
    calls.push({ url: url.href, options });
    let value;
    if (url.searchParams.get('meta') === 'siteinfo') value = { query: { general: { server: 'https://meridian-wiki.a13.info', scriptpath: '', articlepath: '/wiki/$1', wikiid: 'wiki_meridian', generator: 'MediaWiki 1.46.0' }, rightsinfo: { url: POLICIES_SOURCE.licenceUrl, text: 'CC BY-NC-SA 4.0' } } };
    else if (url.searchParams.get('action') === 'parse') { parses++; value = { parse: { title: 'Policies', pageid: 878, revid: 12,
      text: '<h2 id="A">Synthetic policy</h2><p>Do not remove the exception.</p><script src="https://evil.invalid/script"></script>',
      templates: [{ ns: 10, title: 'Template:Policy', exists: true }], parsewarnings: [] } }; }
    else if (url.searchParams.has('titles')) { dependencies++; value = { query: { pages: [page('Template:Policy', 11, 10, 20)] } }; }
    else value = { query: { pages: [page()] } };
    await change(value, { calls, parses, dependencies, options, url });
    return Response.json(value);
  };
  return { calls, fetchImpl, collector: createMediaWikiCollector({ fetchImpl, clock: () => NOW }) };
}

test('DS07-W01: one-page anonymous collection retains immutable, unattributed-to-model rendered evidence', async () => {
  const f = fixture(), value = await f.collector.collectPolicies();
  assert.equal(value.approved, false); assert.equal(value.page.revision, 12); assert.equal(value.dependencies[0].revision, 20);
  assert.equal(value.site.rights.url, POLICIES_SOURCE.licenceUrl); assert.equal(value.fetchedAt, NOW);
  assert.match(value.snapshotHash, /^[a-f0-9]{64}$/u); assert.match(value.html, /Do not remove the exception/);
  assert.ok(Object.isFrozen(value.dependencies[0])); assert.ok(Object.isFrozen(value.source));
  assert.equal(f.calls.length, 8); assert.equal((await f.collector.collectPolicies()).snapshotHash, value.snapshotHash);
  assert.equal(f.calls.some(call => call.url.includes('evil.invalid')), false);
});

test('DS07-W02: a template-only edit and rendered change alter snapshot identity without changing the article revision', async () => {
  const first = await fixture().collector.collectPolicies();
  const second = await fixture(value => {
    if (value.query?.pages?.[0]?.ns === 10) { value.query.pages[0].lastrevid = 21; value.query.pages[0].revisions[0].revid = 21; }
    if (value.parse) value.parse.text += '<p>Additional exception.</p>';
  }).collector.collectPolicies();
  assert.equal(first.page.revision, second.page.revision); assert.notEqual(first.dependencyHash, second.dependencyHash);
  assert.notEqual(first.htmlHash, second.htmlHash); assert.notEqual(first.snapshotHash, second.snapshotHash);
});

test('DS07-W03: rejects template, rendered, article and licence changes during a read', async () => {
  for (const change of [
    (value, state) => { if (state.dependencies === 2 && value.query?.pages?.[0]?.ns === 10) value.query.pages[0] = page('Template:Policy', 11, 10, 21); },
    (value, state) => { if (value.parse && state.parses === 2) value.parse.text += ' changed'; },
    (value, state) => { if (state.parses === 2 && value.query?.pages?.[0]?.ns === 0) value.query.pages[0] = page('Policies', 878, 0, 13); },
    (value, state) => { if (state.parses === 2 && value.query?.rightsinfo) value.query.rightsinfo.text = 'Changed rights'; },
  ]) await assert.rejects(fixture(change).collector.collectPolicies(), /WIKI_SOURCE_CHANGED/);
});

test('DS07-W04: rejects deletion, moves, redirects, scope changes and API continuation instead of silently expanding scope', async () => {
  for (const change of [
    value => { if (value.query?.pages?.[0]?.ns === 0) value.query.pages[0].missing = true; },
    value => { if (value.query?.pages?.[0]?.ns === 0) value.query.pages[0].title = 'Moved policies'; },
    value => { if (value.query?.pages?.[0]) value.query.pages[0].redirect = true; },
    value => { if (value.query?.rightsinfo) value.query.rightsinfo.url = 'https://example.invalid/license'; },
    value => { if (value.parse) value.parse.templates[0].ns = 0; },
    value => { if (value.parse) value.parse.templates[0].exists = false; },
    value => { value.continue = { continue: 'more' }; },
    value => { value.error = { info: 'SYNTHETIC_SECRET_DO_NOT_LOG' }; },
  ]) await assert.rejects(fixture(change).collector.collectPolicies(), error => /^WIKI_[A-Z_]+$/u.test(error.message));
});

test('DS07-W05: rejects unknown/missing revision metadata, duplicate templates, parse warnings and excessive dependencies', async () => {
  for (const change of [
    value => { if (value.query?.pages?.[0]) delete value.query.pages[0].revisions[0].sha1; },
    value => { if (value.parse) value.parse.templates.push(value.parse.templates[0]); },
    value => { if (value.parse) value.parse.templates = Array.from({ length: 65 }, (_, i) => ({ ns: 10, title: `Template:T${i}`, exists: true })); },
    value => { if (value.parse) value.parse.parsewarnings.push('Incomplete rendering'); },
    value => { if (value.query?.pages?.[0]?.ns === 10) value.query.pages = []; },
    value => { if (value.query?.pages?.[0]?.ns === 10) value.query.pages[0].title = 'Template:Other'; },
  ]) await assert.rejects(fixture(change).collector.collectPolicies(), error => /^WIKI_[A-Z_]+$/u.test(error.message));
});

test('DS07-W06: response limits, HTTP failure, invalid encoding and upstream errors do not leak content', async () => {
  let cancelled = 0;
  const responses = [
    () => new Response('upstream secret', { status: 503 }),
    () => new Response('bad json secret', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }),
    () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1048577)); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } }),
    () => { throw new Error('secret in transport diagnostic'); },
  ];
  for (const response of responses) await assert.rejects(createMediaWikiCollector({ fetchImpl: async () => response(), clock: () => NOW }).collectPolicies(), error => /^WIKI_[A-Z_]+$/u.test(error.message));
  assert.equal(cancelled, 1);
});

test('DS07-W07: cancellation before/during reads and one active collector prevent excess work', async () => {
  const aborted = new AbortController(); aborted.abort(); const first = fixture();
  await assert.rejects(first.collector.collectPolicies({ signal: aborted.signal }), /WIKI_IMPORT_EXPIRED/); assert.equal(first.calls.length, 0);
  const controller = new AbortController();
  const second = fixture((_value, state) => { if (state.parses === 1) controller.abort(); });
  await assert.rejects(second.collector.collectPolicies({ signal: controller.signal }), /WIKI_IMPORT_EXPIRED/); assert.equal(second.calls.length, 3);
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const held = fixture(async (_value, state) => { if (state.calls.length === 1) { entered(); await new Promise(resolve => { release = resolve; }); } });
  const pending = held.collector.collectPolicies(); await ready;
  await assert.rejects(held.collector.collectPolicies(), /WIKI_IMPORT_BUSY/); release(); await pending;
  await held.collector.collectPolicies();
});

test('DS07-W08: dependency queries batch at fifty and canonicalize server order', async () => {
  const f = fixture((value, state) => {
    if (value.parse) value.parse.templates = Array.from({ length: 52 }, (_, i) => ({ ns: 10, title: `Template:T${String(i).padStart(2, '0')}`, exists: true })).reverse();
    if (state.url.searchParams.has('titles')) value.query.pages = state.url.searchParams.get('titles').split('|').map((title, i) => page(title, i + 1, 10, 20)).reverse();
  });
  const snapshot = await f.collector.collectPolicies(); assert.equal(snapshot.dependencies.length, 52); assert.equal(f.calls.length, 10);
  assert.equal(snapshot.dependencies[0].title, 'Template:T00'); assert.equal(snapshot.dependencies.at(-1).title, 'Template:T51');
  assert.deepEqual(f.calls.filter(call => call.url.includes('titles=')).map(call => new URL(call.url).searchParams.get('titles').split('|').length), [50, 2, 50, 2]);
});
