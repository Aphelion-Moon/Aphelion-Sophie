import { defaultSystemText } from '../../contracts/system-messages.js';

/** Static routing only. The button launches the Activity; it never establishes membership, progress or access. */
export const ACTIVITY_LAUNCH_ID = 'sophie:shuttle:activity:1';

/**
 * The rules post as a station broadcast (owner's pick of 24 October 2026: option B, Components V2). Its art is made by
 * the coding agent at owner direction (decision of 21 October 2026); provenance in
 * content/shuttle-activity/rules-post-banner.json.
 *
 * Each art line is a list of [text, scene colour key] segments (the keys of SCENE_COLOURS, so the art wears the
 * lounge's palette). Discord draws a code block left-aligned at the message's full width, so on desktop the art sat in
 * the left half (owner review, 24 October 2026). The post therefore shows each art panel as an image rendered from these
 * lines (scripts/author-rules-post-art.mjs), served by the Activity host, which fills the width and keeps its colours on
 * every client; the plain characters are its alt text. Without an Activity host the art falls back to plain code blocks,
 * at most 32 columns so a phone does not wrap them.
 */
export const POST_ART_COLUMNS = 32;
const AMBER = 0xffb84d;

// The station's name in a three-row block face (each letter three cells, a space between), the line it runs, and the
// lounge's pride banner beneath: "it isn't Pride Month, it's just us".
const LOGO = [
  ' ▄▀▄ █▀▄ █ █ █▀▀ █   ▀█▀ ▄▀▄ █▀▄',
  ' █▀█ █▀  █▀█ █▀  █    █  █ █ █ █',
  ' ▀ ▀ ▀   ▀ ▀ ▀▀▀ ▀▀▀ ▀▀▀  ▀  ▀ ▀',
];
const STRIPES = [['1', 5], ['2', 4], ['3', 5], ['4', 4], ['5', 5], ['6', 4], ['7', 5]];
export const POST_LOGO = Object.freeze([
  ...LOGO.map(line => [[line, 'a']]),
  [['   ░▒▓', 'h'], ['  SHUTTLE  SERVICE  ', 'c'], ['▓▒░   ', 'h']],
  STRIPES.map(([key, width]) => ['▄'.repeat(width), key]),
].map(line => Object.freeze(line)));

// The lounge's departures board: the five stops (owner's edit of 24 October 2026: the Shuttle delayed, the last stop
// bound for deep space).
const row = (number, stop, status, key) => [['│ ', 'o'], [`${number} `, 'I'], [stop.padEnd(25 - status.length), 'a'], [`${status} `, key], ['│', 'o']];
export const POST_BOARD = Object.freeze([
  [['┌──────────────────────────────┐', 'o']],
  [['│ ', 'o'], ['DEPARTURES', 'a'], ['           ', '.'], ['GATE 03', 'c'], [' │', 'o']],
  [['├──────────────────────────────┤', 'o']],
  row('01', 'THE BROCHURE', 'BOARDING', 'h'),
  row('02', 'PACK YOUR BAGS', 'ON TIME', '4'),
  row('03', 'BOARD THE SHUTTLE', 'DELAYED', '1'),
  row('04', 'ADMIRE THE LIGHTS', 'ON TIME', '4'),
  row('05', 'DISEMBARKING', 'DEEP SPACE', 'p'),
  [['└──────────────────────────────┘', 'o']],
].map(line => Object.freeze(line)));

/** The plain characters of one art block, line by line. */
export const plainArt = art => art.map(line => line.map(([text]) => text).join(''));

/** The art panels as images on the Activity host (named per version, since Discord caches media by URL), with alt text. */
export const POST_IMAGES = Object.freeze({
  logo: Object.freeze({ art: POST_LOGO, path: 'content/shuttle-activity/post/rules-post-logo-1.png',
    alt: 'APHELION in amber block letters over the words Shuttle Service, with the departure lounge\'s rainbow pride banner beneath.' }),
  board: Object.freeze({ art: POST_BOARD, path: 'content/shuttle-activity/post/rules-post-board-1.png',
    alt: 'Departures board, gate 03: 01 The Brochure, boarding. 02 Pack Your Bags, on time. 03 Board the Shuttle, delayed. ' +
      '04 Admire the Lights, on time. 05 Disembarking, deep space.' }),
});

/** Where the rules live (the story's own rules sign): Meridian Rift's Policies, Wolfgate's Guidebook. Links only. */
export const POST_RULES = Object.freeze([
  Object.freeze({ key: 'activity.post.rules_ss13', url: 'https://meridian-wiki.a13.info/wiki/Policies' }),
  Object.freeze({ key: 'activity.post.rules_ss14', url: 'https://panel.a13.info/guide/wolfgate' }),
]);
/** Components V2 message flag: the post is built from components, with no content or embeds. */
export const COMPONENTS_V2 = 1 << 15;

/** An art panel: its image on the Activity host, or (without one) a plain code block. */
function artPanel(image, mediaOrigin) {
  if (mediaOrigin === null) return { type: 10, content: `\`\`\`\n${plainArt(image.art).join('\n')}\n\`\`\`` };
  return { type: 12, items: [{ media: { url: `${mediaOrigin}/${image.path}` }, description: image.alt }] };
}

/**
 * The post for the rules channel: one amber container of panels (the logotype, the boarding call with the launch button
 * beside it, the departures board, small print) and two rules links. Fixed wording; no mentions, member data or AI.
 * mediaOrigin is the Activity host (https://…) serving the art images, or null for code blocks.
 */
export function activityLaunchPost(text = defaultSystemText, { mediaOrigin = null } = {}) {
  if (mediaOrigin !== null && !/^https:\/\/[a-z0-9.-]+(?::\d{1,5})?$/u.test(mediaOrigin)) throw new Error('ACTIVITY_POST_MEDIA_ORIGIN_INVALID');
  const line = { type: 14, divider: true, spacing: 1 };
  return {
    flags: COMPONENTS_V2,
    components: [{ type: 17, accent_color: AMBER, components: [
      artPanel(POST_IMAGES.logo, mediaOrigin),
      line,
      { type: 9, components: [{ type: 10, content: text('activity.post.call') }],
        accessory: { type: 2, style: 1, label: text('activity.post.button'), custom_id: ACTIVITY_LAUNCH_ID } },
      line,
      artPanel(POST_IMAGES.board, mediaOrigin),
      { type: 10, content: text('activity.post.small_print') },
      line,
      { type: 1, components: POST_RULES.map(({ key, url }) => ({ type: 2, style: 5, label: text(key), url })) },
    ] }],
    allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
  };
}
