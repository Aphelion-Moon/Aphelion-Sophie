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
  linked: 'Signal linked',
  offline: 'Signal lost. Retrying…',
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
  failed: 'Something went wrong on our side. Try again in a moment.',
  radio: 'Common · 145.9',
  standby: 'Standing by',
  transmitting: 'Transmitting',
  hop: 'The HoP is processing your ID card…',
  arrival: 'Now open to you',
  arrivalNone: 'Your new channels appear in Discord’s channel list.',
  log: 'Station log',
  logEmpty: 'Nothing received yet. Sophie’s transmissions appear here as you travel.',
  codex: 'Codex',
  keys: 'Keys',
  transit: 'In transit',
  skip: 'Tap to skip',
  receiving: 'Receiving transmission…',
  tip: 'Tip of the Round',
  findChannel: 'Look for {name} in your channel list.',
  honk: 'HONK!',
});

/** Shown in the lounge, the hall, the cabin, at the viewport and at the door. Station flavour, not instructions. */
export const ANNOUNCEMENTS = Object.freeze({
  'departure-lounge': 'Attention: the Arrivals Shuttle is now boarding.',
  'baggage-hall': 'Attention: please collect your baggage before boarding.',
  'boarding-cabin': 'Attention: all passengers, please take a seat.',
  viewport: 'Attention: passengers may now admire the view.',
  'pressure-door': 'Attention: the Arrivals Shuttle has docked. Watch your step.',
});

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
  ['Whitelist', 'The Discord role that lets you play on our game servers. You request it at the end of the Shuttle; it stays while you follow the rules.'],
  ['The Shuttle', 'This journey: our expectations, stop by stop. It introduces the rules; the published rules on the wiki are the authority.'],
  ['Ticket', 'A private conversation with Staff. Use #open-a-ticket for support of any kind.'],
  ['IC and OOC', 'In character and out of character: what your character says, and what you say as a player.'],
  ['LOOC', 'Local out-of-character chat, for a quick word with the players around you: “do our characters know each other?”'],
  ['Meridian Rift', 'Our SS 13 server.'],
  ['Wolfgate', 'Our SS 14 server, still in early development.'],
  ['HoP', 'Head of Personnel: the one who changes your ID card’s access. (Here, Discord does that.)'],
  ['Greytide', 'An assistant in a grey jumpsuit with a toolbox and a plan. Station folklore.'],
  ['Robust', 'Very good at a fight. Station folklore; do not try it at the help desk.'],
  ['Space carp', 'Fish that live in space and bite. Do not feed them.'],
  ['Ian', 'The Head of Personnel’s corgi. Station folklore and a very good boy.'],
]);

/** Keys and gestures, for the help card. */
export const KEYS = Object.freeze([
  ['→  Enter  Space', 'Next / Continue'], ['←  Backspace', 'Back'], ['Swipe', 'Next or back, on touch screens'],
  ['Tap the text', 'Show it all at once'], ['V', 'Switch the status window: radio or extras'], ['L', 'Station log'], ['Esc', 'Close a panel, or the menu'], ['?', 'This card'],
]);

export const CHUNK_LIMIT = 640;

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

/**
 * The stop's pages as radio transmissions of at most about `limit` characters. A heading stays with what follows it;
 * all of the copy appears, in order, with only whitespace between pieces changed.
 */
export function transmissionChunks(pages, limit = CHUNK_LIMIT) {
  const chunks = [];
  for (const page of pages) {
    let current = '';
    let pendingHeading = '';
    for (const block of blocks(page).flatMap(block => splitBlock(block, limit))) {
      if (/^#{1,3} /.test(block) && !block.includes('\n')) { pendingHeading = pendingHeading ? `${pendingHeading}\n\n${block}` : block; continue; }
      const piece = pendingHeading ? `${pendingHeading}\n\n${block}` : block;
      pendingHeading = '';
      if (current && current.length + 2 + piece.length > limit) { chunks.push(current); current = piece; }
      else current = current ? `${current}\n\n${piece}` : piece;
    }
    if (pendingHeading) current = current ? `${current}\n\n${pendingHeading}` : pendingHeading;
    if (current) chunks.push(current);
  }
  return chunks.length ? chunks : [''];
}

/** The title screen for a described state: one headline item, the always-available items, and a notice. */
export function titleMenu(described, { log = false } = {}) {
  const extras = [...(log ? [{ id: 'log', label: TEXT.log }] : []), { id: 'codex', label: TEXT.codex }];
  const settings = { id: 'settings', label: TEXT.settings }, credits = { id: 'credits', label: TEXT.credits };
  const notice = { closed: TEXT.closed, unavailable: TEXT.unavailable, elsewhere: TEXT.elsewhere, unpublished: TEXT.unpublished,
    outside: TEXT.outside, signin: TEXT.signin, failed: TEXT.failed }[described?.state] ?? null;
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

/** Scene state for a run at one transmission: the board shows the stop; the door shows clearance. */
export function sceneStateFor(run, chunk = 0, chunks = 1, beat = 'none') {
  return { stopTitle: run.stops[run.stop]?.title ?? '', stopNumber: run.stop + 1, stopCount: run.stops.length,
    section: Math.min(chunk + 1, chunks), sections: chunks, whitelist: run.whitelist, beat, link: run.status === 'boarded' ? 'arrived' : 'ready' };
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
 */
export function momentFor(chunks, chunk, moments = {}) {
  const at = Math.min(chunk, chunks.length - 1), headings = text => [...text.matchAll(/^(#{1,3}) (.+)$/gm)];
  let found = { beat: 'none', viewscreen: null };
  const apply = ([, level, text]) => {
    const moment = moments[headingKey(text)];
    if (moment) found = { beat: moment.beat ?? 'none', viewscreen: moment.viewscreen ?? null };
    else if (level === '#') found = { beat: 'none', viewscreen: null };
  };
  for (let i = 0; i < at; i++) headings(chunks[i]).forEach(apply);
  const own = headings(chunks[at] ?? '');
  if (own.length) apply(own[0]);
  // A phrase moment (key "~phrase") belongs to the page that contains it, such as the page that links a comic.
  const page = (chunks[at] ?? '').toLowerCase();
  for (const [key, moment] of Object.entries(moments)) {
    if (key.startsWith('~') && page.includes(key.slice(1))) found = { beat: moment.beat ?? 'none', viewscreen: moment.viewscreen ?? null };
  }
  return found;
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
export function cueSheet(event, run = null, { transit = false } = {}) {
  const sounds = run ? soundscape('run', run) : soundscape('title');
  const ambience = ['ambience', sounds.ambience, { fadeIn: 3, previousFadeOut: 2 }];
  const sheet = {
    title: [[0, 'ambience', sounds.ambience, { fadeIn: 3 }], [2_500, 'music', sounds.music, { fadeIn: 4 }]],
    stop: [[0, 'music', null, { previousFadeOut: 2 }], [0, 'play', 'SC-01'], [150, 'transition'], [300, ...ambience],
      ...(run?.stops[run.stop]?.scene === 'departure-lounge' ? [[900, 'play', 'SC-02']] : []),
      [1_200, 'play', 'DLG-03'], [1_400, 'speak', 2_400], [1_400, 'reveal']],
    page: [[0, 'play', 'DLG-02'], [150, 'speak', 1_200], [150, 'reveal']],
    clearance: [[0, 'music', null, { previousFadeOut: 2 }], [150, 'transition'], [300, ...ambience], [600, 'play', 'DLG-03'], [800, 'speak', 2_400], [800, 'reveal']],
    arrival: [[0, 'play', 'SC-05'], [150, 'transition'], [600, 'play', 'SC-04'], [1_000, ...ambience], [1_200, 'play', 'DLG-03'], [1_400, 'speak', 2_400],
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

/** Which ambience and music go with a view (cue IDs in content/shuttle-activity/sounds/index.json). */
export function soundscape(view, run = null) {
  if (view === 'title') return { ambience: 'AMB-01', music: 'MUS-01' };
  if (!run) return { ambience: null, music: null };
  if (run.whitelist === 'confirmed') return { ambience: 'AMB-06', music: 'MUS-02' };
  const scene = run.stops[run.stop]?.scene;
  return { ambience: { 'departure-lounge': 'AMB-02', 'baggage-hall': 'AMB-03', 'boarding-cabin': 'AMB-04', viewport: 'AMB-05', 'pressure-door': 'AMB-02' }[scene] ?? null, music: null };
}

/** Presence line for Discord (owner decision D6): the stop number only, never names or copy. */
export function presence(run) {
  if (!run) return { details: 'At the Shuttle terminal' };
  if (run.status === 'boarded') return { details: 'Arrived at Aphelion' };
  if (run.status === 'pending') return { details: 'Waiting for clearance' };
  return { details: 'Riding the Arrivals Shuttle', state: `Stop ${run.stop + 1} of ${run.stops.length}` };
}
