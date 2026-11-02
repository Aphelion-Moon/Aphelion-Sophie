// Re-judges a stored ai-eval result against the current case file (workplan P55a): when a case's asserts are corrected,
// the recorded replies are judged again and re-diagnosed without another model call. Writes only the --out file.
// node scripts/ai-eval-rejudge.mjs --result <result.json> --cases <cases.json> --out <rejudged.json>
import { readFile, writeFile } from 'node:fs/promises';
import { diagnose, evaluateAsserts, summarize } from './lib/ai-eval/asserts.mjs';

const args = process.argv.slice(2), option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const resultPath = option('--result'), casesPath = option('--cases'), outPath = option('--out');
if (!resultPath || !casesPath || !outPath) { console.log('usage: node scripts/ai-eval-rejudge.mjs --result <file> --cases <file> --out <file>'); process.exit(2); }
const result = JSON.parse(await readFile(resultPath, 'utf8'));
const cases = new Map(JSON.parse(await readFile(casesPath, 'utf8')).map(item => [item.id, item]));
let changed = 0;
const results = result.results.map(entry => {
  const item = cases.get(entry.id);
  if (!item) return entry;
  const rejudged = { ...entry };
  for (const mode of ['oracle', 'endToEnd']) {
    if (!entry[mode]?.runs) continue;
    const records = entry[mode].records.map(record => ({ ...record, judgement: evaluateAsserts(record, item.assert) }));
    rejudged[mode] = { ...entry[mode], passed: records.filter(record => record.judgement.pass).length, records };
  }
  rejudged.diagnosis = diagnose({ gold: Boolean(item.gold), retrieval: entry.retrieval,
    oracle: rejudged.oracle?.runs ? rejudged.oracle : null, endToEnd: rejudged.endToEnd?.runs ? rejudged.endToEnd : null });
  if (rejudged.diagnosis !== entry.diagnosis) { changed++; console.log(`${entry.id}: ${entry.diagnosis} -> ${rejudged.diagnosis}`); }
  return rejudged;
});
const summary = summarize(results);
await writeFile(outPath, `${JSON.stringify({ ...result, rejudgedAt: new Date().toISOString(), rejudgedFrom: resultPath, summary, results }, null, 2)}\n`);
console.log(JSON.stringify({ changed, ...summary.byDiagnosis }));
