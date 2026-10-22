import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideCollector, GUIDE_SOURCE } from '../apps/knowledge/sources/guide.js';
import { createGithubCollector } from '../apps/knowledge/sources/github.js';
import { canonicalKnowledgeDocument } from '../modules/assistant/knowledge.js';
import { SYNC_PREFIXES } from '../apps/knowledge/mirror.js';

const signal = new AbortController().signal;
const respond = (body, { status = 200, type = 'application/json' } = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
const commit = 'c'.repeat(40);
const index = (change = {}) => ({ server: 'wolfgate', name: 'Aphelion', repo: 'VanguardControl/Wolfgate', ref: 'main', commit, rulesRoot: 'ActiveRules',
  roadmap: [{ name: 'Current version', items: [{ name: 'Synthetic medicine', description: 'Wounds on body parts.', state: 'Complete' }] }],
  entries: {
    ActiveRules: { title: 'Server rules', parent: null, children: ['RuleOne'], rule: true, text: '# Server rules\nFollow these rules.' },
    RuleOne: { title: 'No griefing', parent: 'ActiveRules', children: [], rule: true, text: 'Do not destroy the station without a reason.' },
    UpstreamRules: { title: 'Frontier ruleset', parent: null, children: [], rule: true, text: 'An upstream ruleset kept for reference.' },
    NewPlayer: { title: 'New? Start here!', parent: null, children: [], rule: false, text: '## Welcome\nYou have begun your shift.' },
  }, ...change });

test('the Guidebook collector marks only the active ruleset as policy and links each entry', async () => {
  const urls = [];
  const collector = createGuideCollector({ fetchImpl: async url => { urls.push(String(url)); return respond(index()); }, clock: () => Date.parse('2026-10-23T00:00:00Z') });
  const result = await collector.collect({ signal });
  const docs = result.entries.flatMap(entry => entry.documents ?? []);
  assert.deepEqual(urls, [GUIDE_SOURCE.index]);
  const byTitle = Object.fromEntries(docs.map(doc => [doc.title, doc]));
  assert.equal(byTitle['Wolfgate Guidebook: No griefing'].authority, 'policy');
  assert.equal(byTitle['Wolfgate Guidebook: Server rules'].authority, 'policy');
  assert.equal(byTitle['Wolfgate Guidebook: Frontier ruleset'].authority, 'reference', 'other rulesets stay reference');
  assert.equal(byTitle['Wolfgate Guidebook: New? Start here!'].authority, 'reference');
  assert.equal(byTitle['Wolfgate Guidebook: No griefing'].url, 'https://panel.a13.info/guide/wolfgate#RuleOne');
  assert.match(byTitle['Wolfgate Guidebook: Roadmap'].sections[0].text, /Synthetic medicine \(Complete\): Wounds on body parts\./u);
  assert.ok(docs.every(doc => doc.kind === 'guidebook' && doc.id.startsWith('guide-') && doc.sourceRevision.includes(commit)));
  const again = await collector.collect({ signal, known: new Map(result.entries.map(entry => [entry.idBase, entry.sourceRevision])) });
  assert.ok(again.entries.every(entry => entry.unchanged), 'an unchanged build is not re-read');
  assert.ok(SYNC_PREFIXES.includes('guide'));
});

test('the Guidebook collector refuses another server, repository or a malformed index', async () => {
  for (const change of [{ server: 'other' }, { repo: 'Someone/Fork' }, { commit: 'main' }, { entries: [] }, { rulesRoot: '../x' }]) {
    const collector = createGuideCollector({ fetchImpl: async () => respond(index(change)) });
    await assert.rejects(collector.collect({ signal }), /GUIDE_(SOURCE_SCOPE_CHANGED|RESPONSE_INVALID)/);
  }
  const html = createGuideCollector({ fetchImpl: async () => respond('<html>challenge</html>', { type: 'text/html' }) });
  await assert.rejects(html.collect({ signal }), /GUIDE_RESPONSE_INVALID/);
});

test('only a Guidebook document may link to an entry fragment', () => {
  const doc = { id: 'guide-x-abc123', title: 'Wolfgate Guidebook: X', kind: 'guidebook', authority: 'reference', url: 'https://panel.a13.info/guide/wolfgate#Entry_1',
    rights: 'r', attribution: 'a', sourceRevision: 's', dependencyHash: 'a'.repeat(64), fetchedAt: 1000, validUntil: 1000 + 86400000, aliases: [], sections: [{ heading: 'X', text: 'Text' }] };
  assert.equal(canonicalKnowledgeDocument(doc).url, doc.url);
  assert.throws(() => canonicalKnowledgeDocument({ ...doc, url: 'https://panel.a13.info/guide/wolfgate#<script>' }), /KNOWLEDGE_URL_INVALID/);
  assert.throws(() => canonicalKnowledgeDocument({ ...doc, kind: 'website', url: 'https://meridian.a13.info/docs#part' }), /KNOWLEDGE_URL_INVALID/);
});

test('the GitHub token goes only to the API, and Wolfgate joins with the licence its LEGAL.md states', async () => {
  const token = `github_pat_${'A'.repeat(82)}`, seen = [];
  const repo = (owner, name, license) => ({ name, fork: false, private: false, archived: false, owner: { login: owner }, default_branch: 'main', license, created_at: '2026-01-01T00:00:00Z' });
  const fetchImpl = async (url, init) => {
    seen.push({ origin: url.origin, auth: init.headers.authorization ?? null });
    const path = url.pathname;
    if (path === '/orgs/Aphelion-Moon/repos') return respond([repo('Aphelion-Moon', 'Meridian-Rift', { spdx_id: 'AGPL-3.0' })]);
    if (path === '/repos/VanguardControl/Wolfgate') return respond(repo('VanguardControl', 'Wolfgate', null));
    if (path.endsWith('/readme')) return respond({ encoding: 'base64', size: 10, content: Buffer.from('# Readme').toString('base64') });
    if (url.origin === 'https://raw.githubusercontent.com') return respond('', { status: 404, type: 'text/plain' });
    if (/\/(releases|issues|pulls)$/u.test(path)) return respond([]);
    return respond({ message: 'Not Found' }, { status: 404 });
  };
  const result = await createGithubCollector({ fetchImpl, token, clock: () => Date.parse('2026-10-23T00:00:00Z') }).collect({ signal });
  const docs = result.entries.flatMap(entry => entry.documents);
  const wolfgate = docs.find(doc => doc.title === 'Wolfgate repository');
  assert.ok(wolfgate, 'Wolfgate is synced'); assert.equal(wolfgate.rights, 'AGPL-3.0-or-later for later contributions, MIT for earlier ones (see LEGAL.md)');
  assert.match(wolfgate.sections[0].text, /used by the Aphelion community/u);
  assert.ok(seen.filter(item => item.origin === 'https://api.github.com').every(item => item.auth === `Bearer ${token}`));
  assert.ok(seen.filter(item => item.origin !== 'https://api.github.com').every(item => item.auth === null), 'raw file reads carry no token');
  assert.throws(() => createGithubCollector({ fetchImpl, token: 'not-a-token' }), /GITHUB_TOKEN_INVALID/);
  const anonymous = []; await createGithubCollector({ fetchImpl: async (url, init) => { anonymous.push(init.headers.authorization ?? null); return fetchImpl(url, init); } }).collect({ signal });
  assert.ok(anonymous.every(value => value === null));
});
