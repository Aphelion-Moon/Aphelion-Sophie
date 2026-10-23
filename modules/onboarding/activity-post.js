import { defaultSystemText } from '../../contracts/system-messages.js';

/** Static routing only. The button launches the Activity; it never establishes membership, progress or access. */
export const ACTIVITY_LAUNCH_ID = 'sophie:shuttle:activity:1';

/**
 * The rules post as a station broadcast (owner's pick of 24 October 2026: option B, Components V2). Its art is made by
 * the coding agent at owner direction (decision of 21 October 2026); provenance in
 * content/shuttle-activity/rules-post-banner.json. Every art line is at most 32 columns, so a phone's code block does not
 * wrap it.
 *
 * Each art line is a list of [text, ANSI SGR code or null] segments, so the coloured block (desktop Discord colours
 * `ansi` code blocks) and the plain one are the same characters. POST_COLOUR turns the colour off if a phone shows the
 * escape codes instead of plain text.
 */
export const POST_COLOUR = true;
export const POST_ART_COLUMNS = 32;
const AMBER = 0xffb84d, ESC = '\u001b';
const [GREY, RED, GREEN, YELLOW, BLUE, PINK, CYAN, WHITE] = ['30', '31', '32', '33', '34', '35', '36', '37'];
const bold = code => `1;${code}`;

// The station's name in a three-row block face (each letter three cells, a space between), the line it runs, and the
// lounge's pride banner as a neon bar: "it isn't Pride Month, it's just us".
const LOGO = [
  ' ▄▀▄ █▀▄ █ █ █▀▀ █   ▀█▀ ▄▀▄ █▀▄',
  ' █▀█ █▀  █▀█ █▀  █    █  █ █ █ █',
  ' ▀ ▀ ▀   ▀ ▀ ▀▀▀ ▀▀▀ ▀▀▀  ▀  ▀ ▀',
];
const NEON = [[RED, 5], [YELLOW, 5], [GREEN, 6], [CYAN, 5], [BLUE, 5], [PINK, 6]];
export const POST_LOGO = Object.freeze([
  ...LOGO.map(line => [[line, bold(YELLOW)]]),
  [['   ░▒▓', CYAN], ['  SHUTTLE  SERVICE  ', bold(WHITE)], ['▓▒░   ', CYAN]],
  NEON.map(([code, width]) => ['▄'.repeat(width), bold(code)]),
].map(line => Object.freeze(line)));

// The lounge's departures board: the five stops, the first one boarding.
const row = (number, stop, status, code) => [['│ ', GREY], [`${number} `, GREY], [stop.padEnd(25 - status.length), YELLOW], [`${status} `, code], ['│', GREY]];
export const POST_BOARD = Object.freeze([
  [['┌──────────────────────────────┐', GREY]],
  [['│ ', GREY], ['DEPARTURES', bold(YELLOW)], ['           ', null], ['GATE 03', bold(WHITE)], [' │', GREY]],
  [['├──────────────────────────────┤', GREY]],
  row('01', 'THE BROCHURE', 'BOARDING', bold(CYAN)),
  row('02', 'PACK YOUR BAGS', 'ON TIME', GREEN),
  row('03', 'BOARD THE SHUTTLE', 'ON TIME', GREEN),
  row('04', 'ADMIRE THE LIGHTS', 'ON TIME', GREEN),
  row('05', 'DISEMBARKING', 'APHELION', bold(PINK)),
  [['└──────────────────────────────┘', GREY]],
].map(line => Object.freeze(line)));

/** The plain characters of one art block, line by line. */
export const plainArt = art => art.map(line => line.map(([text]) => text).join(''));
/** A code block of one art block: coloured (`ansi`) or plain. */
export function artBlock(art, colour = POST_COLOUR) {
  const lines = colour ? art.map(line => line.map(([text, code]) => code ? `${ESC}[${code}m${text}${ESC}[0m` : text).join('')) : plainArt(art);
  return `\`\`\`${colour ? 'ansi' : ''}\n${lines.join('\n')}\n\`\`\``;
}

/** Where the rules live (the story's own rules sign): Meridian Rift's Policies, Wolfgate's Guidebook. Links only. */
export const POST_RULES = Object.freeze([
  Object.freeze({ key: 'activity.post.rules_ss13', url: 'https://meridian-wiki.a13.info/wiki/Policies' }),
  Object.freeze({ key: 'activity.post.rules_ss14', url: 'https://panel.a13.info/guide/wolfgate' }),
]);
/** Components V2 message flag: the post is built from components, with no content or embeds. */
export const COMPONENTS_V2 = 1 << 15;

/**
 * The post for the rules channel: one amber container of panels (the logotype, the boarding call with the launch button
 * beside it, the departures board, today's manifest, small print) and two rules links. Fixed wording; no mentions, member
 * data or AI.
 */
export function activityLaunchPost(text = defaultSystemText, { colour = POST_COLOUR } = {}) {
  const say = content => ({ type: 10, content });
  const line = { type: 14, divider: true, spacing: 1 }, gap = { type: 14, divider: false, spacing: 1 };
  return {
    flags: COMPONENTS_V2,
    components: [{ type: 17, accent_color: AMBER, components: [
      say(artBlock(POST_LOGO, colour)),
      line,
      { type: 9, components: [say(text('activity.post.call'))],
        accessory: { type: 2, style: 1, label: text('activity.post.button'), custom_id: ACTIVITY_LAUNCH_ID } },
      line,
      say(artBlock(POST_BOARD, colour)),
      say(text('activity.post.manifest')),
      gap,
      say(text('activity.post.small_print')),
      line,
      { type: 1, components: POST_RULES.map(({ key, url }) => ({ type: 2, style: 5, label: text(key), url })) },
    ] }],
    allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
  };
}
