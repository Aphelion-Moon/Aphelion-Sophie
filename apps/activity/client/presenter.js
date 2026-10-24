/**
 * What the Shuttle Activity shows for a server state (P43). Pure: no DOM, network or clock. The published copy is
 * shown whole and in order; this module only decides how much of it fits one radio transmission, which scene and
 * menu go with a state, and the fixed wording around it. Nothing here grants, implies or predicts access.
 */
import { headingKey } from '../../../modules/onboarding/activity-media.js';

export { headingKey };

/** Fixed client wording. Owner-reviewable; never model output or member text. */
export const TEXT = Object.freeze({
  pressStart: 'Press any key or tap to begin',
  linking: 'Establishing link…',
  linkingTry: 'Establishing link… try {n} of {of}',
  linked: 'Signal linked',
  offline: 'Signal lost. Retrying…',
  slow: 'One moment: the station is catching up.',
  games: 'Our servers',
  quickConnect: 'Quick connect',
  // The owner's wording (24 October 2026), on the status line and the title alike.
  nolinkSignal: 'Cannot re-establish link, try reopening the activity. If that still doesn’t work, ping @matriarch in #crew-support.',
  nolink: 'Cannot re-establish link, try reopening the activity. If that still doesn’t work, ping @matriarch in #crew-support.',
  relink: 'Try the link again',
  board: 'Board the Shuttle',
  refresher: 'Take the refresher flight',
  resume: 'Resume journey',
  check: 'Check clearance',
  arrived: 'View arrival',
  again: 'Board again',
  settings: 'Settings',
  credits: 'Credits',
  back: 'Back',
  next: 'Next',
  continue: 'Continue',
  complete: 'Complete Shuttle',
  close: 'Close',
  menu: 'Main menu',
  speaker: 'Sophie · Community Services',
  channel: 'Radio',
  pending: 'Clearance requested. Discord is adding your Whitelist role. This page updates by itself.',
  pendingLong: 'Still waiting on Discord. You can check again.',
  confirmed: 'Whitelist confirmed. The door is open. Welcome to Aphelion.',
  refreshed: 'Refresher complete. Your Whitelist is unchanged.',
  paused: 'This journey is paused.',
  closed: 'Not boarding yet. The Shuttle Activity is being tested. Board through the Shuttle in the server for now.',
  unavailable: 'You can’t board right now. If you think that’s wrong, ask Staff.',
  elsewhere: 'Your Shuttle is already running in your Onboarding channel. Finish it there.',
  unpublished: 'No guidance is published yet. Check back soon.',
  outside: 'Open the Shuttle from Discord: use the App Launcher, or the Board button in the rules channel.',
  signin: 'Discord didn’t sign you in. Close the Shuttle and open it again.',
  stale: 'That step was already taken. Showing where you are now.',
  resetJourney: 'Reset journey',
  resetConfirm: 'Confirm reset',
  resetAsk: 'This clears your progress. You’ll start again from the first stop of the current story.',
  resetNone: 'Nothing to reset. You’re not partway through a journey.',
  resetDone: 'Journey reset. Board the Shuttle to start from the first stop.',
  failed: 'Something went wrong on our side. Try again in a moment.',
  radio: 'Common · 145.9',
  standby: 'Standing by',
  transmitting: 'Transmitting',
  pass: 'Boarding pass',
  aboardSince: 'In the server since {date}',
  passAccess: { confirmed: 'Access: Whitelist confirmed', requested: 'Access: Whitelist requested', none: 'Access: Whitelist not requested yet' },
  hop: 'The HoP is processing your ID card…',
  arrival: 'Now open to you',
  arrivalNone: 'Your new channels appear in Discord’s channel list.',
  log: 'Station log',
  logEmpty: 'Nothing received yet. Sophie’s transmissions appear here as you travel.',
  // The sheet's id stays codex; the owner renamed it (review of revision 3, 24 October 2026).
  codex: 'Glossary',
  keys: 'Keys',
  transit: 'In transit',
  // The curtain's line when the journey starts and when it returns to the main menu.
  boarding: 'Boarding the Shuttle',
  returning: 'Returning to the terminal',
  skip: 'Tap to skip',
  receiving: 'Receiving transmission…',
  tip: 'Tip of the Round',
  findChannel: 'Look for {name} in your channel list.',
  honk: 'HONK!',
});

/** Shown in the lounge, the hall, the bay, the cabin, at the viewport and at the door. Station flavour, not instructions. */
export const ANNOUNCEMENTS = Object.freeze({
  'departure-lounge': 'Attention: the Arrivals Shuttle is now boarding.',
  'baggage-hall': 'Attention: please check in your baggage before boarding.',
  'boarding-cabin': 'Attention: all passengers, please take a seat.',
  'landing-bay': 'Attention: all passengers, please board at Gate 03.',
  'cabin-turbulence': 'Attention: please fasten your straps for departure.',
  viewport: 'Attention: passengers may now admire the view.',
  'pressure-door': 'Attention: the Arrivals Shuttle has docked. Watch your step.',
});

/**
 * The game servers (owner, 24 October 2026): each with its info channel and a quick-connect link, offered on the main menu
 * and at the last step only once core says the member has Whitelist (they cannot see the servers before that).
 */
export const GAMES = Object.freeze([
  Object.freeze({ id: 'meridian', name: 'Meridian Rift', kind: 'SS13', channel: 'ss13-info', play: 'https://meridian.a13.info/play/' }),
  Object.freeze({ id: 'wolfgate', name: 'Wolfgate', kind: 'SS14', channel: 'ss14-info', play: 'https://panel.a13.info/join/s/wolfgate' }),
]);

/** Tip of the Round: shared SS13 culture, no setting lore (owner decision, 22 October 2026). */
export const TIPS = Object.freeze([
  'A toolbox is robust. It is not a conversation.',
  'The clown is not your enemy. Usually.',
  'Never feed the space carp.',
  'Ian is a very good boy. Do not test this.',
  'Wet floor signs are there for a reason. Walk.',
  'When in doubt, ask in LOOC.',
  'Internals on before you step outside.',
  'The HoP has a lot of paperwork. Be kind.',
  'If you smell plasma, tell someone.',
  'Monkey cubes and water do not mix.',
  'The AI can hear you. Say thank you.',
  'Greytide is a lifestyle, not a job title.',
]);

/** A short glossary for new arrivals. Plain facts about this community; jokes are labelled as such. */
export const CODEX = Object.freeze([
  ['Whitelist', 'The Discord role that lets you play on our game servers. Sophie hands it to you when you disembark at the end of the Shuttle; it stays while you follow the rules.'],
  ['The Shuttle', 'This ride: five stops through our expectations. It introduces the rules; the published rules (the wiki and the Guidebook) are the authority.'],
  ['Ticket', 'A private conversation with Staff. Use #open-a-ticket for support of any kind.'],
  ['IC and OOC', 'In character and out of character: what your character says, and what you say as a player.'],
  ['LOOC', 'Local out-of-character chat, for a quick word with the players around you: “do our characters know each other?”'],
  ['Meridian Rift', 'Our SS 13 server, in development.'],
  ['Wolfgate', 'Our SS 14 server, still early days.'],
  ['HoP', 'Head of Personnel: the one who changes your ID card’s access. (Here, Discord does that.)'],
  ['Greytide', 'An assistant in a grey jumpsuit with a toolbox and a plan. Station folklore.'],
  ['Robust', 'Very good at a fight. Station folklore; do not try it at the help desk.'],
  ['Space carp', 'Fish that live in space and bite. Do not feed them.'],
  ['Mothroach', 'Half moth, half cockroach, mostly fluff. Station folklore; they like lamps and dark corners.'],
  ['Beepsky', 'Officer Beepsky, a securitron who says HALT a lot. Station folklore; on the Shuttle, he does the age check.'],
  ['Ian', 'The Head of Personnel’s corgi. Station folklore and a very good boy.'],
]);

/** Keys and gestures, for the help card. */
export const KEYS = Object.freeze([
  ['↑  ↓  1–9', 'Main menu: move, or pick a choice by its number'], ['→  Enter  Space', 'Next / Continue'], ['←  Backspace', 'Back'], ['Swipe', 'Next or back, on touch screens'],
  ['Tap the text', 'Show it all at once'], ['V', 'Switch the status window: radio or extras'], ['M', 'Sound off or on'], ['L', 'Station log'], ['Esc', 'Close a panel, or the menu'], ['?', 'This card'],
]);

// About one idea a page, as visual novels pace their text boxes (owner review, 22 October 2026).
export const CHUNK_LIMIT = 480;

/** Paragraph blocks of one page. A heading always starts a block; a fenced code block is never split. */
function blocks(page) {
  const result = [], lines = page.split('\n');
  let current = [], fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && line.trim() === '' && !/^\s*```/.test(line)) { if (current.length) result.push(current.join('\n')); current = []; continue; }
    if (!fenced && /^#{1,3} /.test(line) && current.length) { result.push(current.join('\n')); current = []; }
    current.push(line);
  }
  if (current.length) result.push(current.join('\n'));
  return result;
}

/** Splits one over-long block at line ends, then at sentence ends or spaces, never inside a word. */
function splitBlock(block, limit) {
  if (block.length <= limit || /^\s*```/.test(block)) return [block];
  const pieces = [];
  let current = '';
  const push = text => { if (current && current.length + 1 + text.length > limit) { pieces.push(current); current = text; } else current = current ? `${current}\n${text}` : text; };
  for (const line of block.split('\n')) {
    if (line.length <= limit) { push(line); continue; }
    let rest = line;
    while (rest.length > limit) {
      const window = rest.slice(0, limit);
      const cut = Math.max(window.lastIndexOf('. ') + 1, window.lastIndexOf('! ') + 1, window.lastIndexOf('? ') + 1) || window.lastIndexOf(' ');
      const at = cut > limit / 3 ? cut : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : limit;
      push(rest.slice(0, at).trimEnd()); rest = rest.slice(at).trimStart();
    }
    if (rest) push(rest);
  }
  if (current) pieces.push(current);
  return pieces;
}

/** A sign card: a quote block, every line of it quoted. */
const isSign = block => block.split('\n').every(line => /^\s*>/.test(line));
/** Phrases a page must start at: phrase moments marked as a page break, in lower case. */
const breakPhrases = moments => Object.entries(moments ?? {}).filter(([key, moment]) => key.startsWith('~') && moment?.break === true).map(([key]) => key.slice(1));

/**
 * The stop's copy as radio transmissions of about `limit` characters, cut from the stop as one text: where Discord
 * splits its messages does not decide where a page ends. A heading stays with what follows it and a section always
 * opens a fresh page. A sign card is never split (up to twice the limit), and it keeps a short introduction (a heading
 * and a line or two) on its page. A phrase moment marked `break` starts a page where the author wants one. All of the
 * copy appears, in order, with only whitespace between pieces changed.
 */
export function transmissionChunks(pages, limit = CHUNK_LIMIT, moments = {}) {
  const chunks = [], breaks = breakPhrases(moments);
  const text = pages.filter(page => String(page).trim()).join('\n\n');
  let current = '', pendingHeading = '';
  for (const block of blocks(text).flatMap(block => isSign(block) && block.length <= limit * 2 ? [block] : splitBlock(block, limit))) {
    if (/^#{1,3} /.test(block) && !block.includes('\n')) { pendingHeading = pendingHeading ? `${pendingHeading}\n\n${block}` : block; continue; }
    const piece = pendingHeading ? `${pendingHeading}\n\n${block}` : block;
    pendingHeading = '';
    // A section (top-level heading) always opens a fresh transmission, so the scene stages exactly what is read.
    const starts = /^# /.test(piece) || breaks.some(phrase => piece.toLowerCase().includes(phrase));
    // A sign card also stays on a page that is only its heading and one paragraph: the About pages keep their link boxes
    // (owner review of revision 3, 24 October 2026).
    const opening = /^#{1,3} [^\n]+\n\n[^#\n][^\n]*$/.test(current);
    const room = isSign(block) && (current.length <= limit / 3 || opening) ? limit * 2 : limit;
    if (current && (starts || current.length + 2 + piece.length > room)) { chunks.push(current); current = piece; }
    else current = current ? `${current}\n\n${piece}` : piece;
  }
  if (pendingHeading) current = current ? `${current}\n\n${pendingHeading}` : pendingHeading;
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

/**
 * Where the reader is in a stop: a page counter ("3 / 14") over the dots, filled for pages read. Empty unless the stop
 * is being read and has more than one page.
 */
export function pageProgress(chunk, count, reading = true) {
  if (!reading || count <= 1) return { counter: '', dots: '' };
  return { counter: `${chunk + 1} / ${count}`, dots: Array.from({ length: count }, (_, index) => index === chunk ? '■' : index < chunk ? '▪' : '□').join(' ') };
}

/**
 * Linking with Discord and core at start (owner report, 24 October 2026: stuck on "Establishing link…"). Each attempt has
 * LINK_TIMEOUT_MS; a failed or timed-out attempt is tried again after the next delay here, and once these run out the
 * member is asked to try again or reopen the Shuttle. null: no more tries.
 */
export const LINK_TIMEOUT_MS = 15_000;
const LINK_RETRY_MS = Object.freeze([2_000, 5_000, 10_000, 20_000]);
export const LINK_ATTEMPTS = LINK_RETRY_MS.length + 1;
export function linkRetryDelay(attempt) { return Number.isInteger(attempt) && attempt >= 1 && attempt <= LINK_RETRY_MS.length ? LINK_RETRY_MS[attempt - 1] : null; }
/**
 * Waiting for Whitelist (Activity audit, 24 October 2026): Sophie's grant usually lands within seconds, so the first checks
 * come quickly and later ones spread out, rather than one request every 5 s for ten minutes. The nth check's delay.
 */
const CLEARANCE_MS = Object.freeze([1_500, 2_500, 4_000, 6_000]);
export const CLEARANCE_LATER_MS = 10_000;
export function clearanceDelay(check) { return Number.isInteger(check) && check >= 1 && check <= CLEARANCE_MS.length ? CLEARANCE_MS[check - 1] : CLEARANCE_LATER_MS; }
/** The status line while linking: which try this is, after the first. */
export function linkingText(attempt) { return attempt > 1 ? TEXT.linkingTry.replace('{n}', String(attempt)).replace('{of}', String(LINK_ATTEMPTS)) : TEXT.linking; }

/** Reset journey (Settings) has something to clear only while a run is being read; a finished run offers boarding again. */
export function canResetJourney(described) {
  return described?.state === 'run' && ['reading', 'paused'].includes(described.run?.status);
}

/** The title screen for a described state: one headline item, the always-available items, and a notice. */
export function titleMenu(described, { log = false } = {}) {
  const extras = [...(log ? [{ id: 'log', label: TEXT.log }] : []), { id: 'codex', label: TEXT.codex }];
  const settings = { id: 'settings', label: TEXT.settings }, credits = { id: 'credits', label: TEXT.credits };
  const notice = { closed: TEXT.closed, unavailable: TEXT.unavailable, elsewhere: TEXT.elsewhere, unpublished: TEXT.unpublished,
    outside: TEXT.outside, signin: TEXT.signin, failed: TEXT.failed, nolink: TEXT.nolink }[described?.state] ?? null;
  // The link gave up after its retries: trying again comes first, so nobody is left waiting on a screen that will not change.
  if (described?.state === 'nolink') return { items: [{ id: 'relink', label: TEXT.relink }, ...extras, settings, credits], notice };
  if (described?.state === 'ready') {
    return { items: [{ id: 'board', label: described.mode === 'refresh' ? TEXT.refresher : TEXT.board }, ...extras, settings, credits], notice: null };
  }
  if (described?.state === 'run') {
    const { run } = described;
    const primary = run.status === 'boarded' ? { id: 'arrival', label: TEXT.arrived } : run.status === 'pending' ? { id: 'resume', label: TEXT.check }
      : { id: 'resume', label: `${TEXT.resume} · ${run.stop + 1}/${run.stops.length}` };
    return { items: [primary, ...(run.status === 'boarded' ? [{ id: 'board', label: TEXT.again }] : []), ...extras, settings, credits], notice: run.status === 'paused' ? TEXT.paused : null };
  }
  return { items: [...extras, settings, credits], notice };
}

/**
 * The beats staged on the transmissions up to and including this one: what the reader has reached in this stop, by
 * position, so going Back un-reaches them. Scenes keep a section's results (a banner hung, boxes ticked) from then on.
 */
export function reachedBeats(chunks, chunk, moments = {}, revealed = false) {
  const reached = new Set();
  const last = Math.min(chunk, chunks.length - 1);
  for (let i = 0; i <= last; i++) {
    // A page already read has staged everything on it, text-synced moments included; this page only what has been reached.
    for (const shown of i < last ? [false, true] : [false, revealed]) {
      const { beat } = momentFor(chunks, i, moments, shown);
      if (beat !== 'none') reached.add(beat);
    }
  }
  return [...reached];
}

/**
 * Scene state for a run at one transmission: the board shows the stop and section; the door shows clearance and the
 * station's counts. Sections are the copy's top-level headings, counted up to this transmission. Once the run is past
 * reading (clearance, arrival), every beat of the final stop counts as reached.
 */
export function sceneStateFor(run, chunk = 0, chunks = [''], beat = 'none', moments = run.moments ?? {}, revealed = false) {
  const opens = chunks.map(text => /^# /m.test(text));
  const sections = Math.max(1, opens.filter(Boolean).length), section = Math.max(1, opens.slice(0, chunk + 1).filter(Boolean).length);
  const reached = run.status === 'reading' ? reachedBeats(chunks, chunk, moments, revealed) : reachedBeats(chunks, chunks.length - 1, moments, true);
  return { stopTitle: run.stops[run.stop]?.title ?? '', stopNumber: run.stop + 1, stopCount: run.stops.length,
    section: Math.min(section, sections), sections, whitelist: run.whitelist, beat, reached, link: run.status === 'boarded' ? 'arrived' : 'ready',
    crew: run.station?.crew ?? null, online: run.station?.online ?? null };
}

/** Characters a second for each text speed setting. */
export const TYPE_CPS = Object.freeze({ slow: 45, normal: 90, fast: 180 });
/**
 * How long Sophie's radio runs for a page: about half the time the page takes to type out at the member's text speed
 * (normal speed when text shows all at once), between 2 and 6 seconds (owner decision, 22 October 2026). The trail-off
 * follows it.
 */
export function speechMs(text, speed = 'normal') {
  const cps = TYPE_CPS[speed] ?? TYPE_CPS.normal, chars = [...String(text ?? '')].length;
  return Math.round(Math.min(6_000, Math.max(2_000, (chars / cps) * 500)));
}

/** The name the title screen's terminal shows before @aphelion: the member's Discord username, or crew. */
export function windowUser(name) {
  const clean = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return clean ? clean.slice(0, 64) : 'crew';
}

/** What the title screen's link panel says: only what the server last reported. */
export function linkState(described) {
  if (!described) return 'none';
  if (described.state === 'run') return described.run.status === 'boarded' ? 'arrived' : 'ready';
  return { ready: 'ready', closed: 'closed', elsewhere: 'channel', unavailable: 'held', unpublished: 'held' }[described.state] ?? 'offline';
}

/**
 * The moment a transmission belongs to: its first heading, or else the last heading before it, so a transmission that
 * opens one section and starts the next stages the one it opens with. A top-level heading that no moment names returns
 * to the plain scene; a smaller unnamed heading keeps the section's moment. moments: { [headingKey or "~phrase"]: { beat, viewscreen? } }.
 * A phrase moment marked `on: "reveal"` applies only once the reader has reached its phrase (revealed: true, or the
 * set of such phrases reached on this page), as a visual novel stages an event on the line that describes it.
 */
export function momentFor(chunks, chunk, moments = {}, revealed = false) {
  const at = Math.min(chunk, chunks.length - 1), headings = text => [...text.matchAll(/^(#{1,3}) (.+)$/gm)];
  const none = { beat: 'none', viewscreen: null, scene: null }, of = moment => ({ beat: moment.beat ?? 'none', viewscreen: moment.viewscreen ?? null, scene: moment.scene ?? null });
  let found = none;
  const apply = ([, level, text]) => {
    const moment = moments[headingKey(text)];
    if (moment) found = of(moment);
    else if (level === '#') found = none;
  };
  for (let i = 0; i < at; i++) headings(chunks[i]).forEach(apply);
  const own = headings(chunks[at] ?? '');
  if (own.length) apply(own[0]);
  // A phrase moment (key "~phrase") belongs to the page that contains it, such as the page that links a comic.
  const page = (chunks[at] ?? '').toLowerCase();
  const reached = key => revealed === true || (revealed instanceof Set && revealed.has(key));
  const phrases = Object.entries(moments).filter(([key]) => key.startsWith('~') && page.includes(key.slice(1)));
  for (const [key, moment] of [...phrases.filter(([, m]) => m.on !== 'reveal'), ...phrases.filter(([k, m]) => m.on === 'reveal' && reached(k))]) {
    found = { ...of(moment), scene: moment.scene ?? found.scene };
  }
  return found;
}

/** Characters a second a reader takes in, for text-synced moments when the page shows all at once. */
export const READ_CPS = 25;
/** The longest a text-synced moment waits on a page shown all at once. */
export const REVEAL_MAX_MS = 12_000;
/**
 * The text-synced moments on a page: each phrase's key and where it starts in the page's plain text (what the
 * typewriter types), in reading order. A phrase the plain text does not contain is staged at the page's end.
 */
export function revealPoints(page, plain, moments = {}) {
  const raw = String(page ?? '').toLowerCase(), text = String(plain ?? '').toLowerCase();
  return Object.entries(moments).filter(([key, moment]) => key.startsWith('~') && moment?.on === 'reveal' && raw.includes(key.slice(1)))
    .map(([key]) => { const at = text.indexOf(key.slice(1)); return { key, at: at < 0 ? text.length : at }; }).sort((a, b) => a.at - b.at);
}

/** The ride between two stops, when motion is on. Skippable. */
export const TRANSIT_MS = 1_500;

/**
 * Which cue sheet a newly shown run starts: a new stop, clearance, arrival, or none (the same stage again). Going back to
 * an earlier stop is a new stop too.
 */
export function cueEvent(previous, next) {
  if (next.status === 'boarded') return previous?.status === 'boarded' ? null : next.whitelist === 'confirmed' ? 'arrival' : 'clearance';
  if (next.status === 'pending') return previous?.status === 'pending' ? null : 'clearance';
  if (!previous || previous.stop !== next.stop || previous.status !== next.status) return 'stop';
  return null;
}

/**
 * When each sound, scene change and line of Sophie's starts, in milliseconds from the event, so they filter in one after
 * another instead of all at once (owner feedback, 22 October 2026). Actions: play (one-shot cue), ambience and music
 * (with fades in seconds), transition (scene swap), transit (the ride, ms), speak (Sophie's burst, ms) and reveal (the
 * text starts). The click sound of the control that caused the event is played by that control, not here.
 */
export function cueSheet(event, run = null, { transit = false, speech = null, scene = null } = {}) {
  const sounds = run ? soundscape('run', run, scene) : soundscape('title');
  const ambience = ['ambience', sounds.ambience, { fadeIn: 3, previousFadeOut: 2 }];
  const sheet = {
    title: [[0, 'ambience', sounds.ambience, { fadeIn: 3 }], [2_500, 'music', sounds.music, { fadeIn: 4 }]],
    stop: [[0, 'music', null, { previousFadeOut: 2 }], [0, 'play', 'SC-01'], [150, 'transition'], [300, ...ambience],
      ...(run?.stops[run.stop]?.scene === 'departure-lounge' ? [[900, 'play', 'SC-02']] : []),
      [1_200, 'play', 'DLG-03'], [1_400, 'speak', speech ?? 2_400], [1_400, 'reveal']],
    page: [[0, 'play', 'DLG-02'], [150, 'speak', speech ?? 1_200], [150, 'reveal']],
    clearance: [[0, 'music', null, { previousFadeOut: 2 }], [150, 'transition'], [300, ...ambience], [450, 'play', 'SC-15'], [600, 'play', 'DLG-03'], [800, 'speak', speech ?? 2_400], [800, 'reveal']],
    arrival: [[0, 'play', 'SC-05'], [150, 'transition'], [600, 'play', 'SC-04'], [1_000, ...ambience], [1_200, 'play', 'DLG-03'], [1_400, 'speak', speech ?? 2_400],
      [1_400, 'reveal'], [3_000, 'music', sounds.music, { fadeIn: 4 }]],
  }[event];
  if (!sheet) throw new Error('UNKNOWN_CUE_SHEET');
  let steps = sheet.map(([at, action, value, fades]) => ({ at, action, ...(value === undefined ? {} : { value }), ...(fades ? { fades } : {}) }));
  if (transit && event === 'stop') {
    steps = [...steps.map(step => step.at >= 150 ? { ...step, at: step.at + TRANSIT_MS } : step), { at: 150, action: 'transit', value: TRANSIT_MS }]
      .sort((a, b) => a.at - b.at);
  }
  return steps;
}

/** The controls under a transmission. The last transmission of the last stop finishes the Shuttle. */
export function dialogueControls(run, chunk, chunks) {
  const reading = run.status === 'reading';
  const lastChunk = chunk >= chunks - 1, lastStop = run.stop === run.stops.length - 1;
  return {
    back: { enabled: reading && (chunk > 0 || run.stop > 0), action: chunk > 0 ? 'previous-chunk' : 'back' },
    forward: reading ? { enabled: true, action: lastChunk ? 'advance' : 'next-chunk', label: !lastChunk ? TEXT.next : lastStop ? TEXT.complete : TEXT.continue }
      : run.status === 'pending' ? { enabled: true, action: 'check', label: TEXT.check }
      : run.status === 'boarded' ? { enabled: true, action: 'menu', label: TEXT.menu } : { enabled: false, action: null, label: TEXT.continue },
  };
}

/** Which ambience and music go with a view (cue IDs in content/shuttle-activity/sounds/index.json): the scene on screen, else the stop's. */
export function soundscape(view, run = null, scene = null) {
  if (view === 'title') return { ambience: 'AMB-01', music: 'MUS-01' };
  if (!run) return { ambience: null, music: null };
  if (run.whitelist === 'confirmed') return { ambience: 'AMB-06', music: 'MUS-02' };
  const shown = scene ?? run.stops[run.stop]?.scene;
  return { ambience: { 'departure-lounge': 'AMB-02', 'baggage-hall': 'AMB-03', 'landing-bay': 'AMB-07', 'boarding-cabin': 'AMB-04', 'cabin-turbulence': 'AMB-04', viewport: 'AMB-05',
    'pressure-door': 'AMB-02' }[shown] ?? null, music: null };
}

/** Presence line for Discord (owner decision D6): the stop number only, never names or copy. */
export function presence(run) {
  if (!run) return { details: 'At the Shuttle terminal' };
  if (run.status === 'boarded') return { details: 'Arrived at Aphelion' };
  if (run.status === 'pending') return { details: 'Waiting for clearance' };
  return { details: 'Riding the Arrivals Shuttle', state: `Stop ${run.stop + 1} of ${run.stops.length}` };
}
