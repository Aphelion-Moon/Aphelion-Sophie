// AI evaluation runner (workplan P55a, owner plan of 2 November 2026). Loads a pinned knowledge snapshot into a new
// disposable test cluster and runs each case in up to three modes:
//   retrieval  library.lookup on the snapshot: were the gold passages returned, and nothing the case forbids?
//   oracle     the gold passages handed straight to the real prompt, model call, validation and rendering
//   e2e        the real turn: retrieval, then the same path
// and labels each case pass, flaky, coverage, retrieval, interference or model (scripts/lib/ai-eval/asserts.mjs).
// Retrieval needs no secret and makes no network call. Model modes run only with --dry (prepared requests, no call) or
// with --live, --max-calls and --provider-key; a live run spends provider calls and needs an owner-recorded budget.
// Code search (GitHub) is not part of an evaluation run: it cannot be pinned. Writes only the --out file.
//
// node scripts/ai-eval.mjs --cases <cases.json> --snapshot <dir> --out <result.json>
//   [--mode retrieval|oracle|e2e|all] [--overlay <file or folder>[,<file or folder>]] [--only id1,id2] [--runs n]
//   [--character <personality.json>] [--configuration <ai-configuration.json>]
//   [--dry | --live --max-calls <n> --provider-key <file>]
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createKnowledgeLibrary } from '../apps/knowledge/library.js';
import { routeQuestion } from '../apps/knowledge/routing.js';
import { createMistralClient, MISTRAL_MODEL } from '../apps/knowledge-worker/mistral-client.js';
import { createMistralTransport } from '../apps/knowledge-worker/http-transport.js';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../modules/assistant/personality.js';
import { canonicalAiConfiguration } from '../modules/assistant/participation.js';
import { createTestCluster } from './lib/postgres-test-cluster.mjs';
import { diagnose, evaluateAsserts, forbiddenRows, goldHit, sourceLabels, summarize } from './lib/ai-eval/asserts.mjs';
import { documentsForLoad, draftDocument, goldPassages, loadDocuments, passagesOf, readSnapshot } from './lib/ai-eval/snapshot.mjs';
import { runTurn, prepareTurn } from './lib/ai-eval/turn.mjs';

const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const flag = name => args.includes(name);
const casesPath = option('--cases'), snapshotPath = option('--snapshot'), outPath = option('--out');
const mode = option('--mode') ?? 'retrieval';
if (!casesPath || !snapshotPath || !outPath || !['retrieval', 'oracle', 'e2e', 'all'].includes(mode)) {
  console.log('usage: node scripts/ai-eval.mjs --cases <file> --snapshot <dir> --out <file> [--mode retrieval|oracle|e2e|all] [--dry | --live --max-calls n --provider-key <file>]');
  process.exit(2);
}
const modelModes = mode === 'retrieval' ? [] : mode === 'all' ? ['oracle', 'e2e'] : [mode];
const dry = flag('--dry'), live = flag('--live'), maxCalls = Number(option('--max-calls') ?? 0);
if (modelModes.length && dry === live) throw new Error('AI_EVAL_MODEL_MODE_NEEDS_DRY_OR_LIVE');
if (live && !(Number.isSafeInteger(maxCalls) && maxCalls > 0 && option('--provider-key'))) throw new Error('AI_EVAL_LIVE_NEEDS_BUDGET_AND_KEY');

const read = async path => JSON.parse(await readFile(path, 'utf8'));
const only = option('--only')?.split(',') ?? null;
const cases = (await read(casesPath)).filter(item => !only || only.includes(item.id));
const { manifest, documents } = await readSnapshot(snapshotPath);
// Overlays: documents or owner drafts (a file, a list of files, or a folder of .json files), loaded after the snapshot.
const overlays = [];
for (const path of option('--overlay')?.split(',') ?? []) {
  const files = (await stat(path)).isDirectory() ? (await readdir(path)).filter(name => name.endsWith('.json')).sort().map(name => join(path, name)) : [path];
  for (const file of files) { const value = await read(file); overlays.push(...(Array.isArray(value) ? value : [value]).map(item => draftDocument(item, Date.now()))); }
}
const character = canonicalPersonality(option('--character') ? await read(option('--character')) : DRAFT_PERSONALITY);
const configuration = option('--configuration') ? canonicalAiConfiguration(await read(option('--configuration'))) : null;
const guildId = '100000000000000101';

// Model calls: a dry run prepares each request (redaction, trimming, schema) and stops there.
let calls = 0, transport = null;
const usages = [];
let generate = null;
if (dry) {
  const client = createMistralClient({ apiKey: 'dry-run-without-calls', acceptedFingerprints: [MISTRAL_MODEL], fetchImpl: () => { throw new Error('AI_EVAL_DRY'); } });
  generate = async payload => { const prepared = client.prepare(payload); return { kind: 'dry', bytes: prepared.bytes, blocks: prepared.blocks.map(block => block.kind) }; };
} else if (live) {
  const apiKey = (await readFile(option('--provider-key'), 'utf8')).trim();
  transport = createMistralTransport();
  const client = createMistralClient({ apiKey, acceptedFingerprints: [MISTRAL_MODEL], fetchImpl: transport.fetch, onUsage: value => usages.push(value) });
  generate = async payload => {
    if (calls >= maxCalls) throw new Error('AI_EVAL_CALL_BUDGET_SPENT');
    calls++;
    return client.generate(payload, { signal: new AbortController().signal, deadline: Date.now() + 30000 });
  };
}
const turnOptions = { guildId, character, configuration };

const cluster = await createTestCluster();
const results = [];
try {
  await cluster.fresh();
  const now = Date.now();
  const loaded = await loadDocuments(cluster.adminPool, guildId, documentsForLoad(documents, now, overlays));
  const passages = passagesOf(loaded);
  const library = createKnowledgeLibrary({ pool: cluster.knowledgePool, guildId, authorize: async () => false, restoreCurrent: async () => true, clock: Date.now });
  const row = passage => ({ id: passage.id, title: passage.title, heading: passage.heading, url: passage.url, ...sourceLabels(passage) });
  for (const item of cases) {
    const result = { id: item.id, class: item.class ?? null, context: item.context, game: item.game ?? null, text: item.text };
    const forbidSources = [...(item.forbidSources ?? []), ...(item.assert?.forbidSourceFamily ? [{ family: item.assert.forbidSourceFamily }] : [])];
    const conversation = (item.history ?? []).slice(-3).map(entry => entry.text ?? entry.assistant).join('\n').slice(-4000);
    const request = { guildId, channelId: '100000000000000999', deadline: Date.now() + 20000, context: { name: item.context, game: item.game ?? null } };
    const retrieved = await library.lookup(item.text, request, conversation);
    const gold = goldPassages(passages, item.gold);
    result.retrieval = { route: routeQuestion(item.text, request.context), routeExpected: item.route ?? null,
      goldInSnapshot: item.gold ? goldHit(passages, item.gold) : null, goldHit: goldHit(retrieved, item.gold),
      forbidden: forbiddenRows(retrieved, forbidSources).length, rows: retrieved.map(row), ...(item.gold?.pending ? { pending: true } : {}) };
    for (const modelMode of modelModes) {
      const runs = Number(option('--runs') ?? item.runs ?? 1), records = [];
      for (let index = 0; index < runs; index++) {
        const sources = modelMode === 'oracle' ? gold : retrieved;
        if (dry) { const { payload } = prepareTurn(item, sources, { ...turnOptions, now: Date.now() }); records.push({ dry: await generate(payload) }); continue; }
        const record = await runTurn(item, sources, { ...turnOptions, generate, now: Date.now() });
        records.push({ ...record, judgement: evaluateAsserts(record, item.assert) });
      }
      result[modelMode === 'oracle' ? 'oracle' : 'endToEnd'] = dry ? { records }
        : { runs, passed: records.filter(record => record.judgement.pass).length, records };
    }
    result.diagnosis = diagnose({ gold: Boolean(item.gold), retrieval: result.retrieval,
      oracle: result.oracle?.runs ? result.oracle : null, endToEnd: result.endToEnd?.runs ? result.endToEnd : null });
    results.push(result);
    const top = result.retrieval.rows.slice(0, 3).map(entry => entry.id.replace(/\.r\d+\./u, '.')).join(', ') || '(none)';
    console.log(`${item.id}: ${result.diagnosis}  gold=${result.retrieval.goldInSnapshot === null ? '-' : `${result.retrieval.goldHit ? 'hit' : 'miss'}${result.retrieval.goldInSnapshot ? '' : ' (absent)'}`}` +
      `${result.retrieval.forbidden ? ` forbidden=${result.retrieval.forbidden}` : ''}` +
      `${result.retrieval.routeExpected && result.retrieval.route !== result.retrieval.routeExpected ? ` route=${result.retrieval.route}` : ''}${result.oracle?.runs ? ` oracle=${result.oracle.passed}/${result.oracle.runs}` : ''}` +
      `${result.endToEnd?.runs ? ` e2e=${result.endToEnd.passed}/${result.endToEnd.runs}` : ''}  top: ${top}`);
  }
} finally {
  await cluster.stop();
  await transport?.stop();
}
const tokens = usages.reduce((sum, value) => { const usage = value.usage ?? value;
  return { prompt: sum.prompt + (usage.prompt_tokens ?? 0), completion: sum.completion + (usage.completion_tokens ?? 0) }; }, { prompt: 0, completion: 0 });
const summary = summarize(results);
await writeFile(outPath, `${JSON.stringify({ at: new Date().toISOString(), mode, dry, live, model: modelModes.length ? MISTRAL_MODEL : null, calls, tokens,
  snapshot: { sha256: manifest.sha256, takenAt: manifest.takenAt ?? null, documents: documents.length, overlays: overlays.map(item => item.id) },
  character: option('--character') ? 'supplied' : 'draft default', summary, results }, null, 2)}\n`);
console.log(JSON.stringify({ out: outPath, calls, ...summary.byDiagnosis }));
