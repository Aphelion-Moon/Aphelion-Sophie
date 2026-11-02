/**
 * Glossary expansion (plan of 2 November 2026, P53 H2). Community terms are acronyms and slang ("CI", "NLR", "combat
 * intent") that the wiki and Guidebook spell out differently or never use, so keyword search cannot know what they stand
 * for. Each owner-published glossary document (ID glossary-<slug>) lists a term's names as its aliases. A question naming
 * any of them anywhere brings that entry first, and the entry's other names help rank other passages ("combat indicator"
 * for "CI"). Only glossary aliases are matched: the Guidebook gives every entry its title and ID as aliases, which would
 * flood the results. library.lookup does not expand a question routed to development ("Did CI pass?").
 */
export const GLOSSARY_PREFIX = 'glossary-';
const MAX_WORDS = 80, MAX_PHRASE_WORDS = 4, MAX_PHRASES = 200, MAX_ACRONYMS = 3;

/** Lower-case words of the text, split as the library normalises aliases (any run of other characters is a break). */
export const phraseWords = text => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every run of one to four words in the question, shortest first, to compare with glossary aliases. */
export function queryPhrases(text) {
  const words = phraseWords(text).slice(0, MAX_WORDS), phrases = new Set();
  for (let size = 1; size <= MAX_PHRASE_WORDS; size++) for (let start = 0; start + size <= words.length; start++) phrases.add(words.slice(start, start + size).join(' '));
  return [...phrases].slice(0, MAX_PHRASES);
}

// Capitals that are words, emphasis or chat, not terms; "SS" is half of a game name (SS13, SS14).
const NOT_ACRONYMS = new Set(['SS', 'OK', 'LOL', 'OMG', 'PLS', 'PLZ', 'WTF', 'IDK', 'TBH', 'BTW', 'IMO', 'AM', 'AN', 'AND', 'ARE', 'AS', 'AT', 'BE', 'BUT',
  'BY', 'CAN', 'DO', 'DOES', 'FOR', 'HE', 'HOW', 'IF', 'IN', 'IS', 'IT', 'ME', 'MY', 'NO', 'NOT', 'OF', 'ON', 'OR', 'SO', 'THE', 'TO', 'UP', 'US', 'WE', 'WHAT',
  'WHEN', 'WHERE', 'WHO', 'WHY', 'YES', 'YOU', 'YOUR']);

/**
 * Terms the question writes in capitals ("CI", "PMS"), or the whole message when it is a single word ("rdm?"). A page's
 * heading that spells a term out puts it in brackets ("Combat Indicator (CI)"), so these become heading patterns beside the
 * rule codes. Letters followed by a number are a rule code ("CR 1"), handled there.
 */
export function acronymCandidates(text) {
  const found = [...text.matchAll(/(?<![\p{L}\p{N}])([A-Z]{2,6})(?![\p{L}\p{N}])(?![ -]?\d)/gu)].map(match => match[1]);
  const words = text.trim().split(/\s+/u);
  if (words.length === 1 && /^[a-z]{2,6}[?!.]*$/iu.test(words[0])) found.push(words[0].replace(/[?!.]+$/u, '').toUpperCase());
  return [...new Set(found)].filter(term => !NOT_ACRONYMS.has(term)).slice(0, MAX_ACRONYMS);
}
