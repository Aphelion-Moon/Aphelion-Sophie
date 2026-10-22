// Draws the Shuttle Activity's viewscreens (pop-ups of original ASCII art with link cards) and writes the default
// moments: which section of the published copy stages which scene beat and opens which viewscreen. Owner decisions of
// 21-22 October 2026 (the coding agent makes the art; ASCII and links only, no third-party images).
// Output is deterministic. Usage: node scripts/author-shuttle-viewscreens.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { validateMoments, validateViewscreen } from '../modules/onboarding/activity-media.js';

const outputDir = new URL('../content/shuttle-activity/viewscreens/', import.meta.url);
const PROVENANCE = Object.freeze({
  author: 'Made by the coding agent (Claude) at owner direction',
  created: '2026-10-22',
  decision: 'docs/decisions/0001-owner-policy.md (The Shuttle becomes an Activity, D2; Shuttle Activity second pass)',
  rights: 'Machine-made art; it may not attract copyright in every jurisdiction. Linked works stay with their authors and are not reproduced.',
});

/** Colours each character: rules are [pattern, key] tried in order on the character, then the line's default. */
function paint(lines, fallback, rules = [], spans = []) {
  return lines.map((line, r) => [...line].map((ch, c) => {
    if (ch === ' ') return ' ';
    const span = spans.find(([row, from, to]) => row === r && c >= from && c < to);
    if (span) return span[3];
    const rule = rules.find(([pattern]) => pattern.test(ch));
    return rule ? rule[1] : fallback;
  }).join(''));
}
const BOX = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝]/;

const VIEWSCREENS = [
  {
    id: 'sealion', title: 'Keep the pad clear',
    alt: 'The Arrivals Shuttle comes down onto its landing pad. A sea lion sits on the pad marked KEEP CLEAR and asks, "Could you explain that again?" as the shuttle\'s shadow covers it.',
    lines: [
      '            .-----------.',
      '       ____/  ARRIVALS   \\____',
      '      [_______________________]',
      '              ||     ||',
      '              vv     vv',
      '        ░░░░░░░░░░░░░░░░░░░░',
      '               ,-.',
      '            _/ o  \\    "Could you',
      '           (     _>     explain that',
      '     ////// KEEP CLEAR //////  again?"',
    ],
    rules: [[/[░]/, 'd'], [/[v|]/, 'r'], [/[\/]/, 'r']],
    spans: [[1, 13, 21, 'h'], [6, 15, 18, 'I'], [7, 12, 19, 'I'], [8, 11, 19, 'I'], [7, 24, 33, 'i'], [8, 25, 37, 'i'], [9, 11, 21, 'r'], [9, 30, 37, 'i']],
    fallback: 'o',
    links: [{ label: 'Sealioning (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Sealioning' }],
  },
  {
    id: 'ten-thousand', title: 'Today\'s lucky ten thousand',
    alt: 'A station display counts the people learning something for the first time today: ten thousand. A row of small figures stands under it.',
    lines: [
      '┌────────────────────────────────────┐',
      '│   PEOPLE LEARNING THIS TODAY       │',
      '│                                    │',
      '│          1 0 , 0 0 0               │',
      '│                                    │',
      '│   o  o  o  o  o  o  o  o  o  o     │',
      '│  /|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\    │',
      '│  / \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\    │',
      '│                                    │',
      '│   Lucky them. Lucky you.           │',
      '└────────────────────────────────────┘',
    ],
    rules: [[BOX, 'H']], spans: [[1, 4, 30, 'h'], [3, 11, 24, 'c'], [5, 4, 33, 'a'], [6, 3, 34, 'A'], [7, 3, 34, 'A'], [9, 4, 26, 'i']],
    fallback: 'I',
    links: [{ label: 'xkcd: Ten Thousand', url: 'https://xkcd.com/1053/' }],
  },
  {
    id: 'aphelion-links', title: 'Meridian Rift · SS 13',
    alt: 'A small station on a ring, labelled Meridian Rift, SS 13. Links to the main website, the wiki, the rules and the code.',
    lines: [
      '        .-=-.',
      '     .-(  ●  )-.      MERIDIAN RIFT',
      '    (===|   |===)     SS 13',
      '     \'-(     )-\'',
      '        \'-=-\'         maps · wiki · code',
    ],
    rules: [[/[●]/, 'a']], spans: [[1, 22, 35, 'a'], [2, 22, 27, 'h'], [4, 22, 40, 'I']],
    fallback: 'o',
    links: [
      { label: 'Main website', url: 'https://meridian.a13.info/about/' },
      { label: 'Meridian Rift’s wiki', url: 'https://meridian-wiki.a13.info/wiki/Main_Page' },
      { label: 'Go directly to the rules', url: 'https://meridian-wiki.a13.info/wiki/Policies' },
      { label: 'GitHub', url: 'https://github.com/AphelionDevelopment/Meridian-Rift/' },
    ],
  },
  {
    id: 'rules', title: 'Recommended reading',
    alt: 'An old rulebook, open on a lectern, with a new cyan bookmark. The wiki is the authority for game rules.',
    lines: [
      '     ________   ________',
      '    /        \\ /        \\',
      '   |  RULES   |  WIKI    |',
      '   |  ~~~~~   |  ~~~~~   |',
      '   |  ~~~~~   |  ~~~~~   |',
      '   |________/ \\________|',
      '            |▌|',
      '         ___|_|___',
    ],
    rules: [[/[~]/, 'I'], [/[▌]/, 'h']], spans: [[2, 6, 11, 'a'], [2, 17, 21, 'h']],
    fallback: 'o',
    links: [
      { label: 'Start with our recommended reading', url: 'https://meridian-wiki.a13.info/wiki/Policies#RP-01' },
      { label: 'The rules', url: 'https://meridian-wiki.a13.info/wiki/Policies' },
    ],
  },
  {
    id: 'preferences-import', title: 'Bring your settings, not your setting',
    alt: 'A terminal shows the preferences import: Export-Preferences on your previous server, then Import-Character-Preferences on Meridian Rift once you are Whitelisted. You are disconnected afterwards; reconnect to continue.',
    lines: [
      '┌─ TERMINAL ─────────────────────────┐',
      '│ $ Export-Preferences               │',
      '│   on your previous server   done   │',
      '│                                    │',
      '│ $ Import-Character-Preferences     │',
      '│   on Meridian Rift, once you are   │',
      '│   Whitelisted                      │',
      '│   ... disconnected. Reconnect.     │',
      '│                                    │',
      '│ Settings move. The setting stays.  │',
      '└────────────────────────────────────┘',
    ],
    rules: [[BOX, 'o']], spans: [[0, 3, 11, 'A'], [1, 2, 22, 'c'], [2, 30, 34, 'h'], [4, 2, 32, 'c'], [7, 3, 32, 'a'], [9, 2, 35, 'i']],
    fallback: 'I',
    links: [],
  },
  {
    id: 'get-whitelisted', title: 'One last step, in the game',
    alt: 'The Meridian Rift game screen with a Get Whitelisted button. Click it in game, then sign in with Discord to link your account.',
    lines: [
      '┌─ MERIDIAN RIFT ────────────────────┐',
      '│                                    │',
      '│   WELCOME, SPACER                  │',
      '│                                    │',
      '│   [ Get Whitelisted ]   « click    │',
      '│                                    │',
      '│   then sign in with Discord        │',
      '│   to link your account             │',
      '└────────────────────────────────────┘',
    ],
    rules: [[BOX, 'o']], spans: [[0, 3, 16, 'a'], [2, 4, 19, 'i'], [4, 4, 23, 'c'], [4, 26, 33, 'a'], [6, 4, 31, 'I'], [7, 4, 25, 'I']],
    fallback: 'I',
    links: [{ label: 'Meridian Rift website', url: 'https://meridian.a13.info/about/' }],
  },
];

// Which section stages which beat (headings as headingKey() produces them; a key starting with ~ matches a phrase in the page).
const MOMENTS = {
  schema: 1,
  stages: {
    'the-brochure': {
      'this is an adult community': { beat: 'adult' },
      'aphelion is owned and operated by queers, furries, and freaks': { beat: 'pride' },
      'no one is forcing you to get on the shuttle': { beat: 'voluntary' },
      'know your equipment, amenities, and rights': { beat: 'amenities' },
      'understand our expectations for whitelisting': { beat: 'expectations', viewscreen: 'rules' },
      'about ss 13 - meridian rift': { beat: 'meridian', viewscreen: 'aphelion-links' },
      'about ss 14 - wolfgate': { beat: 'wolfgate' },
    },
    'pack-your-bags': {
      'if you are migrating from elsewhere': { beat: 'migrating', viewscreen: 'preferences-import' },
      'leave the past in the past': { beat: 'past' },
      "don't assume your character knows their friends or enemies": { beat: 'looc' },
    },
    'board-the-shuttle': {
      'you are not travelling alone': { beat: 'together' },
      "a shared seat is not an invitation into someone's lap": { beat: 'seat' },
      'we crush sea-lions with shuttles': { beat: 'sealion', viewscreen: 'sealion' },
    },
    'admire-the-lights': {
      'we are here to enjoy ourselves': { beat: 'enjoy' },
      'every life is valuable, every experience is unique': { beat: 'valuable' },
      'take photos and make memories': { beat: 'photos' },
      // A key starting with ~ is a phrase: the page that contains it stages this moment. The comic is linked on the last page.
      '~xkcd.com/1053': { beat: 'lucky', viewscreen: 'ten-thousand' },
    },
    disembarking: {
      'watch your step and do not run': { beat: 'watch-step' },
      'feedback is a two-way street': { beat: 'feedback' },
      'be safe, spacer': { beat: 'be-safe' },
      'ready to disembark': { beat: 'ready' },
      "you will need to click the 'get whitelisted' button in game and complete discord sign in to link your account to our server completely": { beat: 'get-whitelisted', viewscreen: 'get-whitelisted' },
    },
  },
};

await mkdir(outputDir, { recursive: true });
const ids = new Set();
for (const def of VIEWSCREENS) {
  const screen = { schema: 1, id: def.id, title: def.title, art: { text: def.lines, colours: paint(def.lines, def.fallback, def.rules, def.spans) },
    alt: def.alt, links: def.links, provenance: PROVENANCE };
  validateViewscreen(screen); ids.add(def.id);
  await writeFile(new URL(`${def.id}.json`, outputDir), `${JSON.stringify(screen, null, 1)}\n`);
  console.log(def.id);
}
validateMoments(MOMENTS, ids);
await writeFile(new URL('../moments.json', outputDir), `${JSON.stringify(MOMENTS, null, 2)}\n`);
console.log('moments', Object.keys(MOMENTS.stages).length, 'stages');
