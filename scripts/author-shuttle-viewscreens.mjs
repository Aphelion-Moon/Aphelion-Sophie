// Draws the Shuttle Activity's viewscreens (pop-ups of original ASCII art with link cards) and writes the default
// moments: which section of the published copy stages which scene beat and opens which viewscreen. Owner decisions of
// 21-22 October 2026 (the coding agent makes the art; ASCII and links only, no third-party images).
// Output is deterministic. Usage: node scripts/author-shuttle-viewscreens.mjs
import { mkdir, readdir, writeFile } from 'node:fs/promises';
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
/** A line of text centred in a field of the given width (odd widths share one centre column). */
const centre = (text, width) => { const pad = width - [...text].length, left = Math.floor(pad / 2); return ' '.repeat(left) + text + ' '.repeat(pad - left); };
/** A colour span for the first occurrence of text on a row. */
const spanOf = (lines, row, text, key) => { const at = lines[row].indexOf(text); if (at < 0) throw new Error(`span ${text}`); return [row, at, at + [...text].length, key]; };
/** Lines framed in a box, each centred. */
const framed = (width, rows) => ['┌' + '─'.repeat(width - 2) + '┐', ...rows.map(row => '│' + centre(row, width - 2) + '│'), '└' + '─'.repeat(width - 2) + '┘'];
const TEN_THOUSAND = framed(37, ['PEOPLE LEARNING THIS TODAY', '', '1 0 , 0 0 0', '', 'o  o  o  o  o  o  o  o  o', '/|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\', '/ \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\', '', 'Lucky them. Lucky you.']);
// An open book on a lectern: two equal pages either side of the spine, the bookmark hanging at the centre.
const BOOK = [
  '  __________   __________  ',
  ' /          \\ /          \\ ',
  '|' + centre('RULES', 12) + '|' + centre('WIKI', 12) + '|',
  '|   ~~~~~~   |   ~~~~~~   |',
  '|   ~~~~~~   |   ~~~~~~   |',
  '|   ~~~~     |     ~~~~   |',
  ' \\__________\\|/__________/ ',
  '            |▌|            ',
  '        ____|_|____        ',
];

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
    lines: TEN_THOUSAND,
    rules: [[BOX, 'H']],
    spans: [spanOf(TEN_THOUSAND, 1, 'PEOPLE LEARNING THIS TODAY', 'h'), spanOf(TEN_THOUSAND, 3, '1 0 , 0 0 0', 'c'), spanOf(TEN_THOUSAND, 5, 'o  o  o  o  o  o  o  o  o', 'a'),
      spanOf(TEN_THOUSAND, 6, '/|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\/|\\', 'A'), spanOf(TEN_THOUSAND, 7, '/ \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\/ \\', 'A'), spanOf(TEN_THOUSAND, 9, 'Lucky them. Lucky you.', 'i')],
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
    lines: BOOK,
    rules: [[/[~]/, 'I'], [/[▌]/, 'h']], spans: [spanOf(BOOK, 2, 'RULES', 'a'), spanOf(BOOK, 2, 'WIKI', 'h')],
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
      // Beepsky flies in for the 18+ sign and says the line (sixth pass): his page starts at his line (revision 1 wording).
      '~halt-- oh': { beat: 'beepsky', break: true },
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
      // Each section of Board the Shuttle has its own scene; the shared seat stays in the stop's cabin.
      'you are not traveling alone': { beat: 'together', scene: 'landing-bay' },
      // The original pre-story Shuttle text (content/onboarding/definition.json) spells it the British way.
      'you are not travelling alone': { beat: 'together', scene: 'landing-bay' },
      "a shared seat is not an invitation into someone's lap": { beat: 'seat' },
      'we crush sea-lions with shuttles': { beat: 'sealion', viewscreen: 'sealion', scene: 'cabin-turbulence' },
      // The story (sixth pass): the sea lion is lined up and yaps through the first two pages; the third page opens on the
      // boundaries line, and the shuttle hits it when the reader reaches the punchline. Then it's off the rail.
      'real questions are welcome': { beat: 'sealion', viewscreen: 'sealion', scene: 'cabin-turbulence' },
      "~that's called [sealioning]": { beat: 'sealion', viewscreen: 'sealion', scene: 'cabin-turbulence', break: true },
      '~nobody owes you an endless defense': { beat: 'sealion', viewscreen: 'sealion', scene: 'cabin-turbulence', break: true },
      '~we crush sea-lions with shuttles.': { beat: 'strike', viewscreen: 'sealion', scene: 'cabin-turbulence', on: 'reveal' },
      "~and we're clear from the launch rail": { beat: 'strike', viewscreen: 'sealion', scene: 'cabin-turbulence', break: true },
    },
    'admire-the-lights': {
      'we are here to enjoy ourselves': { beat: 'enjoy' },
      // After the first page, someone walks in with a confetti popper (sixth pass).
      '~need a break? take one': { beat: 'popper', break: true },
      'every life is valuable, every experience is unique': { beat: 'valuable' },
      'take photos and make memories': { beat: 'photos' },
      // A key starting with ~ is a phrase: the page that contains it stages this moment. The comic is linked on the last page.
      '~xkcd.com/1053': { beat: 'lucky', viewscreen: 'ten-thousand' },
      // The story draft gives Ten Thousand a section of its own (content/onboarding/story.md).
      'the lucky ten thousand': { beat: 'lucky', viewscreen: 'ten-thousand' },
    },
    disembarking: {
      'watch your step and do not run': { beat: 'watch-step' },
      'feedback is a two-way street': { beat: 'feedback' },
      'be safe, spacer': { beat: 'be-safe' },
      'ready to enter the station': { beat: 'ready' },
      // The original pre-story Shuttle text keeps its heading.
      'ready to disembark': { beat: 'ready' },
      "you will need to click the 'get whitelisted' button in game and complete discord sign in to link your account to our server completely": { beat: 'get-whitelisted', viewscreen: 'get-whitelisted' },
      // The story draft's shorter heading for the same step; both stay until the story version is published.
      'one last step, in the game': { beat: 'get-whitelisted', viewscreen: 'get-whitelisted' },
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
// Scenes come from author-shuttle-scenes.mjs; run that first when a moment names a new scene.
const scenes = new Set((await readdir(new URL('../scenes/', outputDir))).filter(file => file.endsWith('.json')).map(file => file.slice(0, -5)));
validateMoments(MOMENTS, ids, scenes);
await writeFile(new URL('../moments.json', outputDir), `${JSON.stringify(MOMENTS, null, 2)}\n`);
console.log('moments', Object.keys(MOMENTS.stages).length, 'stages');
