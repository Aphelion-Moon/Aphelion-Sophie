// Re-judges a stored ai-eval result against the current case file (workplan P55a): when a case's asserts are corrected,
// the recorded replies are judged again and re-diagnosed without another model call. With --replay, each recorded model
// output first goes again through what core does after the model call today (validation, the reply checks, rendering;
// scripts/lib/ai-eval/turn.mjs), with its passages rebuilt from the snapshot it ran on. Writes only the --out file.
// node scripts/ai-eval-rejudge.mjs --result <result.json> --cases <cases.json> --out <rejudged.json>
//   [--replay --snapshot <dir> [--character <personality.json>] [--configuration <ai-configuration.json>]]
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { diagnose, evaluateAsserts, summarize } from './lib/ai-eval/asserts.mjs';
import { documentsForLoad, passagesOf, readSnapshot } from './lib/ai-eval/snapshot.mjs';
import { finishTurn, prepareTurn } from './lib/ai-eval/turn.mjs';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../modules/assistant/personality.js';
import { canonicalAiConfiguration } from '../modules/assistant/participation.js';

const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const resultPath = option('--result'), casesPath = option('--cases'), outPath = option('--out'), replay = args.includes('--replay');
if (!resultPath || !casesPath || !outPath || replay && !option('--snapshot')) {
  console.log('usage: node scripts/ai-eval-rejudge.mjs --result <file> --cases <file> --out <file> [--replay --snapshot <dir>]'); process.exit(2);
}
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const result = await read(resultPath);
const cases = new Map((await read(casesPath)).map(item => [item.id, item]));

// Replays rebuild each record's passages from the snapshot, loaded as the run loaded it (revision 1 of every document).
let passages = null, turnOptions = null;
if (replay) {
  const { documents } = await readSnapshot(option('--snapshot')), now = Date.now();
  const loaded = documentsForLoad(documents, now).map(document => ({ document, publicationHash: createHash('sha256').update(JSON.stringify(document)).digest('hex') }));
  passages = new Map(passagesOf(loaded).map(passage => [passage.id, passage]));
  turnOptions = { guildId: '100000000000000101', character: canonicalPersonality(option('--character') ? await read(option('--character')) : DRAFT_PERSONALITY),
    configuration: option('--configuration') ? canonicalAiConfiguration(await read(option('--configuration'))) : null };
}
async function replayed(item, record) {
  if (!replay || record.raw === undefined) return record;
  const sources = record.sources.map(source => passages.get(source.id));
  if (sources.some(source => source === undefined)) return { ...record, replay: 'AI_EVAL_REPLAY_SOURCE_MISSING' };
  const turn = prepareTurn(item, sources, { ...turnOptions, now: Date.now() });
  return finishTurn({ id: record.id, sources: record.sources, requesterLabel: record.requesterLabel, raw: record.raw }, record.raw, turn, sources);
}

let changed = 0;
const results = [];
for (const entry of result.results) {
  const item = cases.get(entry.id);
  if (!item) { results.push(entry); continue; }
  const rejudged = { ...entry };
  for (const mode of ['oracle', 'endToEnd']) {
    if (!entry[mode]?.runs) continue;
    const records = [];
    for (const record of entry[mode].records) { const next = await replayed(item, record); records.push({ ...next, judgement: evaluateAsserts(next, item.assert) }); }
    rejudged[mode] = { ...entry[mode], passed: records.filter(record => record.judgement.pass).length, records };
  }
  rejudged.diagnosis = diagnose({ gold: Boolean(item.gold), retrieval: entry.retrieval,
    oracle: rejudged.oracle?.runs ? rejudged.oracle : null, endToEnd: rejudged.endToEnd?.runs ? rejudged.endToEnd : null });
  if (rejudged.diagnosis !== entry.diagnosis) { changed++; console.log(`${entry.id}: ${entry.diagnosis} -> ${rejudged.diagnosis}`); }
  results.push(rejudged);
}
const summary = summarize(results);
await writeFile(outPath, `${JSON.stringify({ ...result, rejudgedAt: new Date().toISOString(), rejudgedFrom: resultPath, ...(replay ? { replayed: true } : {}), summary, results }, null, 2)}\n`);
console.log(JSON.stringify({ changed, ...summary.byDiagnosis }));
