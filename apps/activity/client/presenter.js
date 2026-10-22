/**
 * What the Shuttle Activity shows for a server state (P43). Pure: no DOM, network or clock. The published copy is
 * shown whole and in order; this module only decides how much of it fits one radio transmission, which scene and
 * menu go with a state, and the fixed wording around it. Nothing here grants, implies or predicts access.
 */

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
});

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
export function titleMenu(described) {
  const settings = { id: 'settings', label: TEXT.settings }, credits = { id: 'credits', label: TEXT.credits };
  const notice = { closed: TEXT.closed, unavailable: TEXT.unavailable, elsewhere: TEXT.elsewhere, unpublished: TEXT.unpublished,
    outside: TEXT.outside, signin: TEXT.signin, failed: TEXT.failed }[described?.state] ?? null;
  if (described?.state === 'ready') {
    return { items: [{ id: 'board', label: described.mode === 'refresh' ? TEXT.refresher : TEXT.board }, settings, credits], notice: null };
  }
  if (described?.state === 'run') {
    const { run } = described;
    const primary = run.status === 'boarded' ? { id: 'arrival', label: TEXT.arrived } : run.status === 'pending' ? { id: 'resume', label: TEXT.check }
      : { id: 'resume', label: `${TEXT.resume} · ${run.stop + 1}/${run.stops.length}` };
    return { items: [primary, ...(run.status === 'boarded' ? [{ id: 'board', label: TEXT.again }] : []), settings, credits], notice: run.status === 'paused' ? TEXT.paused : null };
  }
  return { items: [settings, credits], notice };
}

/** Scene state for a run at one transmission: the board shows the stop; the door shows clearance. */
export function sceneStateFor(run, chunk = 0, chunks = 1) {
  return { stopTitle: run.stops[run.stop]?.title ?? '', stopNumber: run.stop + 1, stopCount: run.stops.length,
    section: Math.min(chunk + 1, chunks), sections: chunks, whitelist: run.whitelist };
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
  return { details: 'Boarding the Shuttle', state: `Stop ${run.stop + 1} of ${run.stops.length}` };
}
