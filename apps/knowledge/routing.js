import { requireCondition } from '../../contracts/validation.js';
import { codeSignals } from './code-signals.js';

export const KNOWLEDGE_ROUTES = Object.freeze(['gameplay', 'development', 'mixed']);

/**
 * Question routing (plan of 2 November 2026). Players' words collide with developers' ("CI" is the Combat Indicator in
 * game and continuous integration on GitHub), so a chat turn's question is routed before retrieval:
 *   development  the question itself uses unmistakable developer words (pull request, GitHub, "CI failed", the code)
 *                or names code (a file name, a long identifier, a backticked name): every family, as before routing;
 *   gameplay     any other question in a chat context: developer pages and code search are left out and the context's
 *                game is preferred (library.lookup);
 *   mixed        no chat context (/lookup): every family, no preference.
 * The words are deliberately narrow and never code search's broad hints ("event", "system" and "component" are game
 * words too): a developer question routed to gameplay finds no developer page and she says she has no verified
 * information, the safe failure. The conversation never routes a question, so a rules question asked after someone
 * mentioned GitHub stays gameplay.
 */
const DEVELOPMENT = [
  /\bpull requests?\b/iu, /\bPRs?\b/u, /\bgit\s?hub\b/iu, /\b(?:code\s?base|source code|repos?|repository|repositories)\b/iu,
  /\b(?:in|the|its|their|game'?s|wolfgate'?s|meridian'?s)\s+code\b(?!\s+(?:red|blue|green|yellow|white|black|delta|gamma|epsilon|violet|orange|amber|word|phrase))/iu,
  /\b(?:coded|hard-?coded|coding|coders?|programm(?:ing|ers?)|functions?|procs?|datums?|structs?|variables?|yaml|yml|implemented|implementation)\b/iu,
  /\b(?:workflows?|compil(?:e|es|ed|ing|er)|linter|linting|(?:unit|integration) tests?|upstream merges?|StrongDMM|mapmerge|RobustToolbox|tgui)\b/iu,
  /\bmerg(?:e|ed|es|ing)\b[^.?!\n]{0,30}\b(?:upstream|master|main branch|conflicts?)\b/iu,
  /\b(?:contributing guide|contribute (?:to )?(?:the )?(?:code|repo|repository|project))\b/iu,
  // "CI" with a build word after it ("CI failed", "the CI checks"), or right after a pass or fail ("failing CI"); never
  // "fail to use CI" or "check if someone has CI on", which are about the combat rule.
  /\bCI\b[^.?!\n]{0,25}?\b(?:pass|passed|passes|passing|fail|fails|failed|failing|failures?|checks?|jobs?|pipelines?|builds?|lint|tests?)\b/u,
  /\b(?:passed|passes|passing|failed|failing|fails)\s+(?:the\s+)?CI\b/u,
];
// Code-looking words that are also chat: "and/or", "she/her", "TSF/PDV", "PvP", "McCoy".
const chatty = word => /^\p{L}+(?:\/\p{L}+)+$/u.test(word) || word.length < 8 && !/[._]/u.test(word);

/** The route for a question; context is the turn's chat context ({ name, game, ... }) or null outside one. */
export function routeQuestion(text, context = null) {
  requireCondition(typeof text === 'string' && text.length <= 4000, 'KNOWLEDGE_QUERY_INVALID');
  if (context === null || typeof context !== 'object') return 'mixed';
  return DEVELOPMENT.some(pattern => pattern.test(text)) || codeSignals(text).some(word => !chatty(word)) ? 'development' : 'gameplay';
}
