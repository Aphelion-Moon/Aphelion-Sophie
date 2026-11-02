import { requireCondition } from '../../contracts/validation.js';
import { withoutSentences, withoutUnbackedClaims } from './output.js';

/**
 * Deterministic reply checks (plan of 2 November 2026). Like the unbacked-claim removal they remove whole sentences and
 * keep the rest of the reply; text in code fences is never touched.
 * - References (P53 H3): a #channel must be in the owner's channel directory or in a cited passage; a /command must be one
 *   of Sophie's own commands for the context, or appear in a cited passage or in what the members wrote.
 * - Verdicts (owner, 2 November 2026: Sophie never judges an incident): when the member describes something that happened,
 *   a sentence ruling on it ("that's definitely RDM"); always, a sentence saying what will happen to someone or promising
 *   to report, flag or pass something on, which Sophie cannot do.
 * - Numbers (P53 C4): in an answer from sources, every number must appear in a cited passage or in what the members wrote.
 */
const CHANNEL = /(?<![\p{L}\p{N}_&<\/])#([^\s#.,;:!?()[\]{}"'`<>*_~|]{2,64})/gu;
const COMMAND = /(?<![\p{L}\p{N}_\/:.\\-])\/([a-z][a-z0-9_-]{2,31})(?![\p{L}\p{N}_\/-])/giu;
// Tone indicators ("/srs", "/gen") are chat, not commands.
const TONE = new Set(['srs', 'nsrs', 'gen', 'genq', 'pos', 'neg', 'nbr', 'nsx', 'sarc', 'lyr', 'ref', 'hyp', 'exa', 'irl']);

// A member describing something that happened to them or that someone did.
const INCIDENT = [/\b(?:someone|somebody|a (?:guy|player|person|dude|ship|crew)|this (?:guy|player|person)|he|she|they|people)\b[^.?!\n]{0,40}\b(?:shot|killed|blew up|attacked|griefed|rdm(?:'?d|ed)|spaced|stole|hacked|bombed|murdered|robbed|destroyed|metagamed|metacommed|boarded|harassed)\b/iu,
  /\b(?:killed|shot|attacked|griefed|robbed|spaced|boarded) (?:me|my|us|our)\b/iu, /\bI (?:got|was|have been) (?:killed|shot|attacked|griefed|rdm(?:'?d|ed)|robbed|spaced|banned)\b/iu];
const HEDGE = /\b(?:if|would|could|might|may|unless|depends|depending|whether|usually|generally|typically)\b/iu;
const RULING = [
  /\b(?:that|this|it)(?:'s| is| was| sounds like| looks like| counts as)\s+(?:(?:definitely|clearly|obviously|totally|absolutely|textbook|classic)\s+)*(?:an?\s+)?(?:rdm|random death ?match|metagam(?:e|ing)|metacomm(?:s|ing)?|powergam(?:e|ing)|grief(?:ing)?|eorg|rule ?break(?:ing)?|bannable|ban-?worthy|against the rules|breaking (?:the )?rules?|a violation)\b/iu,
  /\b(?:he|she|they|the (?:guy|player|person|other player))\s+(?:(?:definitely|clearly|obviously)\s+)?(?:broke|violated|(?:is|are|was|were) breaking)\s+(?:(?:a|the|this|that)\s+)?rules?\b/iu,
  /\b(?:he|she|they|the (?:guy|player|person|other player))(?:'s|'re| is| are| was| were)\s+(?:(?:definitely|clearly|obviously)\s+)?(?:rdm(?:ing)?|griefing|metagaming|powergaming)\b/iu,
  /\byou (?:were|got)\s+(?:(?:definitely|clearly|totally)\s+)?(?:rdm(?:'?d|ed)|griefed|metagamed)\b/iu];
const OUTCOME = /\b(?:he|she|they|the (?:guy|player|person|other player))(?:'ll| will|'s going to| is going to|'re going to| are going to)\s+(?:(?:probably|definitely|likely|surely)\s+)?(?:get|be)\s+(?:banned|punished|warned|kicked|noted|in trouble)\b/iu;
const PROMISE = /\bI(?:'ll| will|'m going to| am going to|'ve| have)\s+(?:(?:go ahead and|definitely|also|already)\s+)?(?:report(?:ed)?|flag(?:ged)?|forward(?:ed)?|pass(?:ed)? (?:it|this|that) on|escalat(?:e|ed)|let (?:the )?(?:staff|admins|mods) know|tell (?:the )?(?:staff|admins|mods)|ping(?:ed)? (?:the )?(?:staff|admins|mods))\b/iu;

const NUMBER_WORDS = new Map(Object.entries({ two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000 }));
// A number word is a claim when it counts time, distance or a penalty ("five seconds", "three formal warnings"); "three Safe
// Zones" only counts what the sentence lists.
const UNITS = 'seconds?|minutes?|hours?|days?|weeks?|months?|years?|rounds?|shifts?|times?|warnings?|strikes?|bans?|chances?|meters?|metres?|tiles?|points?|credits?|spesos|thalers|percent|steps?|levels?';
const COUNTED = new RegExp(`\\b(${[...NUMBER_WORDS.keys()].join('|')})(?:[\\s-]+\\p{L}+)?[\\s-]+(?:${UNITS})\\b`, 'giu');
// List markers ("1. ", which the sentence splitter may leave standing alone) are layout; game names are not numbers.
const layout = text => text.replace(/^\s*\d{1,2}[.)](?=\s|$)/gmu, ' ').replace(/\bspace station 1[34]\b/giu, ' ');
const digitsIn = text => [...text.matchAll(/(?<![\p{L}\p{N}.,])(\d{1,3}(?:,\d{3})+|\d+)/gu)].map(([, digits]) => Number(digits.replaceAll(',', '')));

/** Every number a text gives, in digits or words ("five"); codes such as SS14 or R6 are names. */
export function numbersIn(text) {
  const plain = layout(text), found = new Set(digitsIn(plain));
  for (const [word] of plain.toLowerCase().matchAll(/\p{L}+/gu)) if (NUMBER_WORDS.has(word)) found.add(NUMBER_WORDS.get(word));
  return found;
}

/** The numbers a sentence claims: its digits, and number words that count time, distance or a penalty. */
export function claimedNumbers(sentence) {
  const plain = layout(sentence);
  return [...digitsIn(plain), ...[...plain.matchAll(COUNTED)].map(([, word]) => NUMBER_WORDS.get(word.toLowerCase()))];
}

/**
 * `commands`: the command names Sophie may use here (capabilities.js); `directory`: the owner's channel directory; `cited`:
 * title, heading and text of the passages the reply cites; `said`: the members' own words in the turn; `sourced`: whether
 * the reply answers from sources. Returns the remaining text (null when nothing is left) and what was removed.
 */
export function checkReply(text, { commands = [], directory = [], cited = '', said = '', sourced = false }) {
  requireCondition([text, cited, said].every(value => typeof value === 'string') && Array.isArray(commands) && Array.isArray(directory), 'AI_OUTPUT_INVALID');
  const listed = new Set(directory.map(entry => entry.name)), own = new Set(commands), quoted = `${cited}\n${said}`.toLowerCase(), source = cited.toLowerCase();
  const unlisted = sentence => [...sentence.matchAll(CHANNEL)].some(([named, name]) => !/^\d+$/u.test(name) && !listed.has(name.toLowerCase()) && !source.includes(named.toLowerCase())) ||
    [...sentence.matchAll(COMMAND)].some(([named, name]) => !TONE.has(name.toLowerCase()) && !own.has(name.toLowerCase()) && !quoted.includes(named.toLowerCase()));
  const incident = INCIDENT.some(pattern => pattern.test(said));
  const verdict = sentence => PROMISE.test(sentence) || !HEDGE.test(sentence) && (OUTCOME.test(sentence) || incident && RULING.some(pattern => pattern.test(sentence)));
  const known = new Set([...numbersIn(cited), ...numbersIn(said)]);
  const unsupported = sentence => sourced && claimedNumbers(sentence).some(number => !known.has(number));
  const removed = { references: 0, verdicts: 0, numbers: 0 };
  let rest = text;
  for (const [kind, test] of [['references', unlisted], ['verdicts', verdict], ['numbers', unsupported]]) {
    if (rest === null) break;
    const checked = withoutSentences(rest, test);
    removed[kind] = checked.removed; rest = checked.text;
  }
  return { text: rest, removed, total: removed.references + removed.verdicts + removed.numbers };
}

/** Title, heading and text of the passages a reply cites. */
export function citedText(output, sources) {
  return sources.filter(source => output.citations?.includes(source.id)).map(source => `${source.title ?? ''}\n${source.heading ?? ''}\n${source.text ?? ''}`).join('\n');
}

/**
 * A validated reply as it is delivered, shared by core's turns and the evaluator: unbacked claims removed first
 * (withoutUnbackedClaims), then the checks above. When nothing is left, `fallback('claim')` or `fallback('check')` gives the
 * owner's wording and the reply then rests on the conversation; a null fallback means silence. Memories ride along.
 */
export async function checkedReplyOutput(output, { remembered, others = [], commands = [], directory = [], said = '', sources = [], fallback = async () => null }) {
  const claims = withoutUnbackedClaims(output.text, { remembered, others });
  const checks = claims.text === null ? { text: null, removed: { references: 0, verdicts: 0, numbers: 0 }, total: 0 }
    : checkReply(claims.text, { commands, directory, cited: citedText(output, sources), said, sourced: output.support === 'provided_sources' });
  const removed = { claims: claims.removed, ...checks.removed };
  if (claims.removed + checks.total === 0) return { output, removed };
  if (checks.text !== null) return { output: { ...output, text: checks.text }, removed };
  const text = await fallback(claims.text === null ? 'claim' : 'check');
  return { output: text === null ? { kind: 'silent', ...(output.memories ? { memories: output.memories } : {}) }
    : { ...output, text, purpose: 'conversation', support: 'current_conversation', citations: [] }, removed };
}
