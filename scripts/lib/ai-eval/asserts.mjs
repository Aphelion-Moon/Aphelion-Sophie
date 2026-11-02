// AI evaluation (workplan P55a, owner plan of 2 November 2026): judges one turn record against a case's `assert` fields and
// says, per case, whether a failure lies in coverage, retrieval, the turn around good evidence, or the model itself.
// Pure functions only; the CLI (scripts/ai-eval.mjs) runs the turns.
import { withoutUnbackedClaims } from '../../../modules/assistant/output.js';

const pattern = value => new RegExp(value, 'iu');
const list = value => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

/**
 * Evaluation labels from a passage's address alone. They are deliberately independent of the code under test, so a
 * routing or labelling change is judged against a fixed reading of where a passage comes from. A `game` already on the
 * row (once collectors label documents) wins.
 */
export function sourceLabels(row) {
  let url;
  try { url = new URL(row.url); } catch { return { family: 'gameplay', game: row.game ?? null }; }
  const host = url.hostname, path = url.pathname;
  const development = host === 'github.com' || host.endsWith('.githubusercontent.com') || host === 'meridian.a13.info' && path.startsWith('/docs/');
  let game = row.game ?? null;
  if (game === null) {
    if (host === 'panel.a13.info' && path.startsWith('/guide/wolfgate')) {
      // Wolfgate's own rules are Monolith*/WF*; R4, R11-1, C14, M1 and the bundled rule lists (Core Rules, MRP Ruleset,
      // Frontier Ruleset ...) are upstream SS14 text. Every other entry (lore, jobs, mechanics) is Wolfgate's.
      game = /^#Rule[A-Z]+\d+(?:-\d+)?$/u.test(url.hash) || /Rules(?:et)?$/u.test(url.hash) && !/^#(?:Monolith|WF)/u.test(url.hash) ? 'ss14-upstream' : 'ss14-wolfgate';
    } else if (host === 'meridian-wiki.a13.info' || host === 'meridian.a13.info') game = 'ss13-meridian';
    else if (host === 'github.com') game = /^\/VanguardControl\/Wolfgate(?:\/|$)/iu.test(path) ? 'ss14-wolfgate' : /^\/Aphelion-Moon\/Meridian/iu.test(path) ? 'ss13-meridian' : null;
  }
  return { family: development ? 'development' : 'gameplay', game };
}

const documentOf = row => row.documentId ?? /^(.*)\.r\d+\.s\d+$/u.exec(row.id ?? '')?.[1] ?? row.id ?? '';

/** A gold item names a passage by any of document ID, URL and heading (regular expressions); every field given must match. */
export function goldMatches(row, item) {
  const fields = [['document', documentOf(row)], ['url', row.url ?? ''], ['heading', row.heading ?? '']].filter(([key]) => item[key] !== undefined);
  return fields.length > 0 && fields.every(([key, value]) => pattern(item[key]).test(value));
}

/** `{ any: [...] }` needs one gold item among the rows; `{ all: [...] }` needs each of them. Null when the case has no gold. */
export function goldHit(rows, gold) {
  if (!gold) return null;
  const items = gold.all ?? gold.any ?? [];
  const found = item => rows.some(row => goldMatches(row, item));
  return items.length > 0 && (gold.all ? items.every(found) : items.some(found));
}

/** Retrieved rows a case forbids, by family label or URL pattern. */
export function forbiddenRows(rows, forbidSources = []) {
  return rows.filter(row => forbidSources.some(rule => rule.family !== undefined ? sourceLabels(row).family === rule.family
    : rule.url !== undefined && pattern(rule.url).test(row.url ?? '')));
}

// Judging an incident is never Sophie's: "that's RDM", "they'll be banned", "I'll report it".
const VERDICT = [
  /\b(?:that|this|it)(?:'s| is| was)\s+(?:(?:definitely|clearly|probably|absolutely|totally)\s+)?(?:rdm|random deathmatch|griefing|metagaming|powergaming|a (?:rule )?(?:break|violation)|against the rules|bannable|not allowed)\b/iu,
  /\bthey(?:'ll| will| should| are going to)\s+(?:(?:probably|definitely)\s+)?(?:be|get)\s+(?:banned|punished|warned|noted)\b/iu,
  /\bI(?:'ll| will| can| am going to|'m going to)\s+(?:file|report|forward|log|pass|flag|escalate)\b/iu,
  /\b(?:you were|you got)\s+(?:definitely\s+)?(?:rdm(?:'d|ed)?|griefed)\b/iu,
];

/** What a member would see: the rendered message, including embed text. */
export function visibleText(record) {
  if (!record.rendered) return '';
  return [record.rendered.content ?? '', ...(record.rendered.embeds ?? [])].join('\n');
}

/**
 * Judges one turn record. A record is { outcome, support, citations, memoriesProposed, requesterLabel, rendered, sources,
 * codeSearch, error, validation }; sources are the passages the turn was given (id, url, heading, title, game?).
 * A turn that errored delivered nothing, so it fails whatever the case asserts.
 */
export function evaluateAsserts(record, assert = {}) {
  const failures = [], fail = message => failures.push(message);
  if (record.error || record.validation) return { pass: false, failures: [`error: ${record.error ?? record.validation}`] };
  const text = visibleText(record), sources = record.sources ?? [], memories = record.memoriesProposed ?? [];
  const cited = (record.citations ?? []).map(id => sources.find(source => source.id === id)).filter(Boolean);
  if (assert.outcome !== undefined && record.outcome !== assert.outcome) fail(`outcome ${record.outcome}, expected ${assert.outcome}`);
  if (assert.notOutcome !== undefined && record.outcome === assert.notOutcome) fail(`outcome ${record.outcome}`);
  if (assert.support !== undefined && record.support !== assert.support) fail(`support ${record.support}, expected ${assert.support}`);
  if (assert.memory === 'required' && memories.length === 0) fail('no memory proposed');
  if (assert.memory === 'forbidden' && memories.length > 0) fail('memory proposed');
  if (assert.memoryScope !== undefined && memories.some(item => item.scope !== assert.memoryScope)) fail(`memory scope other than ${assert.memoryScope}`);
  if (assert.memoryAboutRequester && memories.some(item => item.scope === 'member' && JSON.stringify(item.about) !== JSON.stringify([record.requesterLabel])))
    fail('member memory about someone other than the requester');
  for (const value of list(assert.forbidMemoryText)) if (memories.some(item => pattern(value).test(item.text))) fail(`memory text matches ${value}`);
  for (const value of list(assert.forbidText)) if (pattern(value).test(text)) fail(`text matches forbidden ${value}`);
  for (const value of list(assert.requireText)) if (!pattern(value).test(text)) fail(`text lacks ${value}`);
  for (const value of list(assert.pointer)) if (!pattern(value).test(text)) fail(`no pointer matching ${value}`);
  if (assert.claimNeedsMemory && memories.length === 0 && withoutUnbackedClaims(text, { remembered: false }).removed > 0) fail('claims a save without a memory');
  for (const value of list(assert.requireCitationUrl)) if (!cited.some(source => pattern(value).test(source.url ?? ''))) fail(`no citation matching ${value}`);
  for (const value of list(assert.forbidCitationUrl)) if (cited.some(source => pattern(value).test(source.url ?? ''))) fail(`cites ${value}`);
  if (assert.requireCitationGame !== undefined && !cited.some(source => list(assert.requireCitationGame).includes(sourceLabels(source).game)))
    fail(`no citation from ${list(assert.requireCitationGame).join(' or ')}`);
  if (assert.forbidSourceFamily !== undefined && sources.some(source => sourceLabels(source).family === assert.forbidSourceFamily))
    fail(`given a ${assert.forbidSourceFamily} passage`);
  if (assert.minLinks !== undefined && (text.match(/<https:\/\/[^>\s]+>/gu) ?? []).length < assert.minLinks) fail(`fewer than ${assert.minLinks} links`);
  if (assert.codeSearch === 'ran' && record.codeSearch !== true) fail('code search did not run');
  if (assert.noVerdict && VERDICT.some(rule => rule.test(text))) fail('judges the incident');
  return { pass: failures.length === 0, failures };
}

/**
 * Where a case's failure lies. Inputs: whether the case names gold passages and whether the snapshot holds them; whether
 * retrieval returned them (and nothing forbidden); and the passes over runs for the oracle mode (gold passages handed to
 * the real prompt) and the end-to-end mode. Labels:
 *   pass          every end-to-end run passed
 *   flaky         some runs passed, some failed (end-to-end, or oracle when end-to-end failed throughout)
 *   coverage      the knowledge base holds no gold passage: a document is missing, not a search or model fault
 *   retrieval     the gold passage exists but was not retrieved (or a forbidden one was), and the model is fine with it
 *   interference  the gold passage was retrieved and the model is fine with it alone, yet the real turn failed
 *   model         the model fails even when handed the gold passages
 *   retrieved / retrieval-only results without a model run; undetermined when a model run is missing
 */
export function diagnose({ gold, retrieval, oracle = null, endToEnd = null }) {
  const retrieved = retrieval ? retrieval.goldHit !== false && retrieval.forbidden === 0 : null;
  if (endToEnd) {
    if (endToEnd.passed === endToEnd.runs) return 'pass';
    if (endToEnd.passed > 0) return 'flaky';
  }
  if (gold && retrieval && !retrieval.goldInSnapshot) return 'coverage';
  if (oracle) {
    if (oracle.passed === 0) return 'model';
    if (oracle.passed < oracle.runs) return 'flaky';
    if (!endToEnd) return retrieved === false ? 'retrieval' : 'retrieved';
    return retrieved === false ? 'retrieval' : 'interference';
  }
  if (!endToEnd) return retrieved === false ? 'retrieval' : 'retrieved';
  return retrieved === false ? 'retrieval' : 'undetermined';
}

/** Counts per class and per diagnosis. */
export function summarize(results) {
  const byClass = {}, byDiagnosis = {};
  for (const result of results) {
    const row = byClass[result.class ?? 'unclassified'] ??= { cases: 0 };
    row.cases++; row[result.diagnosis] = (row[result.diagnosis] ?? 0) + 1;
    byDiagnosis[result.diagnosis] = (byDiagnosis[result.diagnosis] ?? 0) + 1;
  }
  // Cases whose question was routed otherwise than the case expects (gameplay, development or mixed).
  const misrouted = results.filter(result => result.retrieval?.routeExpected && result.retrieval.route !== result.retrieval.routeExpected).map(result => result.id);
  return { cases: results.length, byDiagnosis, byClass, misrouted };
}
