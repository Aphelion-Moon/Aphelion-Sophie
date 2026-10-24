import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ANNOUNCEMENTS, CODEX, TEXT, CHUNK_LIMIT, canResetJourney, dialogueControls, momentFor, pageProgress, presence, reachedBeats, revealPoints, sceneStateFor, soundscape, titleMenu, transmissionChunks, windowUser } from '../apps/activity/client/presenter.js';
import { validateStageMoments } from '../modules/onboarding/activity-media.js';
import { ACTIVITY_STOP_SCENES } from '../modules/onboarding/activity.js';
import { parseInline, parseMarkdown, plainText, safeLink } from '../apps/activity/client/markdown.js';
import { createSoundboard } from '../apps/activity/client/audio.js';
import { createShuttleApi } from '../apps/activity/client/api.js';
import { insideDiscord } from '../apps/activity/client/discord.js';
import { loadActivityClient } from '../apps/activity/client-assets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const draft = JSON.parse(await readFile(new URL('../content/onboarding/definition.json', import.meta.url), 'utf8'));
const stops = ['departure-lounge', 'baggage-hall', 'boarding-cabin', 'viewport', 'pressure-door'].map((scene, index) => ({ title: `Stop ${index + 1}`, scene }));
const run = (changes = {}) => ({ version: 2, status: 'reading', mode: 'qualification', stop: 0, stops, pages: ['Synthetic page.'], whitelist: 'none', ...changes });
const squash = text => text.replace(/\s+/g, '');

test('T-ACT-CLI-01 transmissions keep every character of the copy, in order, within the size limit', () => {
  for (const stage of draft.stages) {
    const chunks = transmissionChunks([stage.body]);
    assert.equal(squash(chunks.join('')), squash(stage.body), stage.id);
    for (const chunk of chunks) assert.ok(chunk.length <= CHUNK_LIMIT + 200, `${stage.id}: ${chunk.length}`);
    // A heading never ends a transmission on its own.
    for (const chunk of chunks.slice(0, -1)) assert.doesNotMatch(chunk.split('\n').at(-1), /^#{1,3} /);
  }
  const fenced = 'Before\n\n```\nline one\n\nline two\n```\n\nAfter';
  assert.ok(transmissionChunks([fenced], 20).some(chunk => chunk.includes('line one\n\nline two')));
  const long = `${'word '.repeat(400)}end.`;
  assert.equal(squash(transmissionChunks([long]).join('')), squash(long));
  assert.deepEqual(transmissionChunks([]), ['']);
});

test('T-ACT-PAGE-01 pages: signs stay whole with their introduction, Discord message breaks are ignored, authors place breaks', () => {
  const sign = `> **NOTICE · LONG SIGN**\n${Array.from({ length: 6 }, (_, i) => `> Line ${i} ${'of the sign '.repeat(6)}`).join('\n')}`;
  assert.ok(sign.length > CHUNK_LIMIT && sign.length < CHUNK_LIMIT * 2);
  // A sign longer than a page is never cut, and keeps the heading and line that introduce it.
  const intro = transmissionChunks([`# A section\nHere it is.\n\n${sign}\n\nAfter the sign.`]);
  assert.ok(intro.some(chunk => chunk.startsWith('# A section') && chunk.includes(sign)), 'the sign stays with its introduction');
  assert.ok(intro.every(chunk => !chunk.includes('Line 0') || chunk.includes('Line 5')), 'and is never split');
  // A long run of text before a sign does not drag the sign onto its page.
  const crowded = transmissionChunks([`# A section\n${'Plenty to read here. '.repeat(10)}\n\n${sign}`]);
  assert.equal(crowded.length, 2); assert.ok(crowded[1].startsWith('> **NOTICE'));
  // Two Discord messages read as one stop: a short tail joins the page before it.
  assert.deepEqual(transmissionChunks(['# Heading\nFirst paragraph.', 'Second paragraph.']), ['# Heading\nFirst paragraph.\n\nSecond paragraph.']);
  // A phrase moment marked break starts a page at its phrase.
  const moments = { '~nobody owes you': { beat: 'x', break: true } };
  assert.deepEqual(transmissionChunks(['# Heading\nOne.\n\nNobody owes you anything.\n\nThree.'], CHUNK_LIMIT, moments),
    ['# Heading\nOne.', 'Nobody owes you anything.\n\nThree.']);
});

test('T-ACT-PAGE-02 text-synced moments wait for their phrase; pages already read count them as reached', () => {
  const chunks = ['# Rail\nThe sea lion yaps.', 'Nobody owes you.\n\n**We crush sea-lions with shuttles.**\n\n*THUMP.*', 'Off the rail.'];
  const moments = { rail: { beat: 'sealion' }, '~we crush sea-lions with shuttles': { beat: 'strike', on: 'reveal' }, '~off the rail': { beat: 'strike' } };
  assert.equal(momentFor(chunks, 1, moments).beat, 'sealion', 'before the reader reaches it');
  assert.equal(momentFor(chunks, 1, moments, new Set(['~we crush sea-lions with shuttles'])).beat, 'strike', 'once reached');
  assert.equal(momentFor(chunks, 1, moments, true).beat, 'strike');
  assert.deepEqual(reachedBeats(chunks, 1, moments).sort(), ['sealion']); assert.deepEqual(reachedBeats(chunks, 2, moments).sort(), ['sealion', 'strike']);
  // Where the phrase starts in what is typed out: markdown is not typed.
  const [point] = revealPoints(chunks[1], 'Nobody owes you.\nWe crush sea-lions with shuttles.\nTHUMP.', moments);
  assert.deepEqual(point, { key: '~we crush sea-lions with shuttles', at: 17 });
  assert.deepEqual(revealPoints(chunks[0], 'The sea lion yaps.', moments), []);
  // Only phrases may wait or break a page; a heading already starts its own.
  assert.throws(() => validateStageMoments({ rail: { beat: 'sealion', on: 'reveal' } }), /INVALID_MOMENTS/);
  assert.throws(() => validateStageMoments({ '~rail': { beat: 'sealion', break: 'yes' } }), /INVALID_MOMENT/);
  validateStageMoments({ '~rail': { beat: 'sealion', break: true, on: 'reveal' } });
});

test('T-ACT-CLI-02 the title menu follows the server state; refusals show fixed notices and no boarding', () => {
  assert.deepEqual(titleMenu({ state: 'ready', mode: 'qualification' }).items.map(item => item.id), ['board', 'codex', 'settings', 'credits']);
  assert.deepEqual(titleMenu({ state: 'ready', mode: 'qualification' }, { log: true }).items.map(item => item.id), ['board', 'log', 'codex', 'settings', 'credits']);
  assert.equal(titleMenu({ state: 'ready', mode: 'refresh' }).items[0].label, TEXT.refresher);
  // Reset journey (Settings) is offered only while a run is being read.
  assert.equal(canResetJourney({ state: 'run', run: { status: 'reading' } }), true);
  assert.equal(canResetJourney({ state: 'run', run: { status: 'paused' } }), true);
  for (const described of [{ state: 'run', run: { status: 'pending' } }, { state: 'run', run: { status: 'boarded' } }, { state: 'ready' }, null])
    assert.equal(canResetJourney(described), false, JSON.stringify(described));
  for (const state of ['closed', 'unavailable', 'elsewhere', 'unpublished', 'outside', 'signin', 'failed']) {
    const menu = titleMenu({ state });
    assert.deepEqual(menu.items.map(item => item.id), ['codex', 'settings', 'credits'], state);
    assert.equal(menu.notice, TEXT[state], state);
  }
  assert.equal(titleMenu({ state: 'run', run: run({ stop: 2 }) }).items[0].label, `${TEXT.resume} · 3/5`);
  assert.equal(titleMenu({ state: 'run', run: run({ status: 'pending', whitelist: 'requested' }) }).items[0].label, TEXT.check);
  assert.deepEqual(titleMenu({ state: 'run', run: run({ status: 'boarded', whitelist: 'confirmed' }) }).items.map(item => item.id), ['arrival', 'board', 'codex', 'settings', 'credits']);
  assert.equal(titleMenu(null).notice, null);
});

test('T-ACT-CLI-03 controls: pages before stops, Complete on the last page of the last stop, Check while pending', () => {
  assert.deepEqual(dialogueControls(run(), 0, 3).back, { enabled: false, action: 'back' });
  assert.equal(dialogueControls(run(), 0, 3).forward.action, 'next-chunk');
  assert.equal(dialogueControls(run(), 1, 3).back.action, 'previous-chunk');
  assert.deepEqual(dialogueControls(run(), 2, 3).forward, { enabled: true, action: 'advance', label: TEXT.continue });
  assert.equal(dialogueControls(run({ stop: 4 }), 0, 1).forward.label, TEXT.complete);
  assert.equal(dialogueControls(run({ stop: 1 }), 0, 1).back.enabled, true);
  assert.equal(dialogueControls(run({ status: 'pending', stop: 4 }), 0, 1).forward.action, 'check');
  assert.equal(dialogueControls(run({ status: 'pending', stop: 4 }), 0, 1).back.enabled, false);
  assert.equal(dialogueControls(run({ status: 'boarded', stop: 4 }), 0, 1).forward.action, 'menu');
  assert.equal(dialogueControls(run({ status: 'paused' }), 0, 1).forward.enabled, false);
});

test('T-ACT-CLI-04 scenes, sound and presence: arrival music only after confirmation; presence names no copy', () => {
  // Sections are the copy's top-level headings; a section's results stay "reached" from its page on, and all of them
  // once the run is past reading.
  const pages = ['# One\nfirst', 'more of one', '# Two\nsecond', 'more of two'], moments = { one: { beat: 'adult' }, two: { beat: 'pride' } };
  assert.deepEqual(sceneStateFor(run({ stop: 1 }), 1, pages), { stopTitle: 'Stop 2', stopNumber: 2, stopCount: 5, section: 1, sections: 2, whitelist: 'none', beat: 'none',
    reached: [], link: 'ready', crew: null, online: null });
  assert.equal(sceneStateFor(run({ stop: 1 }), 2, pages).section, 2);
  assert.equal(sceneStateFor(run({ stop: 1 }), 1, pages, 'pride').beat, 'pride');
  assert.deepEqual(sceneStateFor(run({ stop: 1, moments }), 1, pages).reached, ['adult']);
  assert.deepEqual(sceneStateFor(run({ stop: 1, moments }), 3, pages).reached, ['adult', 'pride']);
  assert.deepEqual(sceneStateFor(run({ status: 'pending', stop: 4, moments }), 0, pages).reached, ['adult', 'pride']);
  assert.equal(soundscape('run', run({ stop: 2 }), 'landing-bay').ambience, 'AMB-07', 'the sound follows the scene on screen');
  assert.equal(sceneStateFor(run({ status: 'boarded', stop: 4, whitelist: 'confirmed' })).link, 'arrived');
  assert.deepEqual(soundscape('title'), { ambience: 'AMB-01', music: 'MUS-01' });
  assert.deepEqual(soundscape('run', run({ stop: 2 })), { ambience: 'AMB-04', music: null });
  assert.equal(soundscape('run', run({ status: 'pending', stop: 4, whitelist: 'requested' })).music, null);
  assert.deepEqual(soundscape('run', run({ status: 'boarded', stop: 4, whitelist: 'confirmed' })), { ambience: 'AMB-06', music: 'MUS-02' });
  assert.deepEqual(presence(run({ stop: 3 })), { details: 'Riding the Arrivals Shuttle', state: 'Stop 4 of 5' });
  assert.deepEqual(presence(null), { details: 'At the Shuttle terminal' });
  assert.doesNotMatch(JSON.stringify(presence(run({ stops: [{ title: 'Secret title', scene: 'viewport' }] }))), /Secret/);
});

test('T-ACT-CLI-05 markdown: Discord formatting becomes a tree of text; HTML stays text and only https links are links', () => {
  const tree = parseMarkdown('# Title\nAn **18+ _adult_** [wiki](https://wiki.example.test/Main) <@123> <#456>\n\n-# small\n- one\n  - two\n> quoted\n```\n<b>code</b>\n```');
  assert.deepEqual(tree.map(node => node.type), ['heading', 'paragraph', 'subtext', 'list', 'quote', 'codeblock']);
  const paragraph = tree[1].children;
  assert.equal(paragraph.find(node => node.type === 'strong').children.find(node => node.type === 'em').children[0].text, 'adult');
  assert.deepEqual(paragraph.find(node => node.type === 'link'), { type: 'link', href: 'https://wiki.example.test/Main', children: [{ type: 'text', text: 'wiki' }] });
  assert.deepEqual(paragraph.filter(node => node.type === 'mention').map(node => node.text), ['@member', '#channel']);
  assert.equal(tree[3].items[1].depth, 1);
  assert.equal(tree[5].text, '<b>code</b>');
  for (const unsafe of ['javascript:alert(1)', 'http://plain.example.test', 'data:text/html,x', 'https://user:pass@example.test']) assert.equal(safeLink(unsafe), null, unsafe);
  assert.deepEqual(parseInline('[click](javascript:alert(1))').some(node => node.type === 'link'), false);
  assert.equal(plainText(parseMarkdown('<img src=x onerror=alert(1)>')), '<img src=x onerror=alert(1)>\n');
  assert.equal(plainText(parseInline('\\*not bold\\*')), '*not bold*');
  for (const stage of draft.stages) assert.ok(plainText(parseMarkdown(stage.body)).length > 100, stage.id);
});

test('T-ACT-CLI-06 sound: nothing before the first tap, Opus or MP3 by support, loops cross-fade on one channel', async () => {
  const started = [], fetched = [];
  const gain = () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} }, connect() {} });
  const context = { currentTime: 0, state: 'running', destination: {}, createGain: gain, async decodeAudioData(bytes) { return { bytes }; }, async resume() {},
    createBufferSource: () => ({ connect() {}, start(when, offset) { started.push(offset ?? 0); }, stop() {} }) };
  const index = JSON.parse(await readFile(new URL('../content/shuttle-activity/sounds/index.json', import.meta.url), 'utf8'));
  const board = createSoundboard({ index, base: '/s/', createContext: () => context, canPlayOpus: false, fetchBytes: async path => { fetched.push(path); return path; } });
  await board.play('UI-02');
  assert.deepEqual(fetched, []);
  await board.unlock(); await board.play('UI-02');
  assert.deepEqual(fetched, ['/s/ui-02-confirm.mp3']);
  await board.ambience('AMB-02'); await board.ambience('AMB-02');
  assert.equal(started.at(-1), 0.5);
  assert.equal(fetched.filter(path => path.includes('amb-02')).length, 1);
});

test('T-ACT-CLI-09 Sophie\'s radio comes in quickly from a random point in the static and drops out quickly', async () => {
  const events = [];
  const gain = () => { const g = { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {},
    linearRampToValueAtTime(value, at) { events.push(['ramp', value, at]); } }; return { gain: g, connect() {} }; };
  const context = { currentTime: 10, state: 'running', destination: {}, createGain: gain, async decodeAudioData(bytes) { return { bytes }; }, async resume() {},
    createBufferSource: () => ({ connect() {}, start(when, offset) { events.push(['start', when, offset]); }, stop(at) { events.push(['stop', at]); } }) };
  const index = JSON.parse(await readFile(new URL('../content/shuttle-activity/sounds/index.json', import.meta.url), 'utf8'));
  const loop = index.sounds.find(sound => sound.cue === 'DLG-05').loop;
  const board = createSoundboard({ index, base: '/s/', createContext: () => context, canPlayOpus: true, fetchBytes: async path => path, random: () => 0.5 });
  await board.unlock();
  await board.radio(true); await board.radio(true);
  assert.deepEqual(events.filter(event => event[0] === 'start'), [['start', 10, loop.start + 0.5 * (loop.end - loop.start)]]);
  assert.deepEqual(events.find(event => event[0] === 'ramp'), ['ramp', 1, 10.12]);
  await board.radio(false);
  assert.deepEqual(events.slice(-2), [['ramp', 0, 11.5], ['stop', 11.55]]);
  await board.radio(false);
  assert.equal(events.filter(event => event[0] === 'stop').length, 1);
});

test('T-ACT-CLI-07 API client: one request key per click across retries; refusals carry the fixed word', async () => {
  const bodies = [];
  let failures = 2;
  const api = createShuttleApi({ randomBytes: count => new Uint8Array(count).fill(171), wait: async () => {},
    fetch: async (path, options) => {
      if (options.body) bodies.push(JSON.parse(options.body));
      if (path === '/api/session') return new Response(JSON.stringify({ token: 'a'.repeat(64), accessToken: 'x', scopes: ['identify'] }), { status: 200 });
      if (failures-- > 0) return new Response('{}', { status: 503 });
      if (path === '/api/shuttle') return new Response(JSON.stringify({ error: 'closed' }), { status: 403 });
      assert.equal(options.headers.Authorization, `Bearer ${'a'.repeat(64)}`);
      return new Response(JSON.stringify({ run: { stop: 1 } }), { status: 200 });
    } });
  await api.signIn({ code: 'c', instanceId: 'i-1' });
  assert.deepEqual(await api.act('advance', 4), { run: { stop: 1 } });
  const keys = bodies.filter(body => body.action === 'advance').map(body => body.requestId);
  assert.equal(keys.length, 3); assert.equal(new Set(keys).size, 1); assert.match(keys[0], /^[a-f0-9]{32}$/);
  await assert.rejects(api.describe(), error => error.word === 'closed' && error.status === 403);
  assert.equal(insideDiscord('?frame_id=1&instance_id=i-1&platform=desktop'), true);
  assert.equal(insideDiscord('?instance_id=i-1'), false);
});

test('T-ACT-CLI-08 the listener serves the page, its module graph, the pinned SDK, font, scenes and sounds, and nothing else', async () => {
  const assets = await loadActivityClient(root);
  for (const path of ['/', '/apps/activity/client/app.js', '/apps/activity/client/shuttle.js', '/apps/activity/scene-player.js', '/modules/onboarding/scenes.js',
    '/contracts/validation.js', '/apps/activity/vendor/embedded-app-sdk/Discord.mjs', '/apps/activity/client/app.css', '/apps/activity/fonts/CozetteVector.woff2',
    '/content/shuttle-activity/scenes/pressure-door.json', '/content/shuttle-activity/sounds/index.json', '/content/shuttle-activity/sounds/mus-02-arrival-theme.opus']) {
    assert.ok(assets.has(path), path);
  }
  assert.equal(assets.get('/').type, 'text/html; charset=utf-8');
  for (const path of assets.keys()) assert.doesNotMatch(path, /apps\/core|legal|\.local|config|scripts|tests/, path);
  const page = assets.get('/').body.toString('utf8');
  assert.doesNotMatch(page, /<script(?![^>]*type="module" src="\/apps\/activity\/client\/app\.js")/);
  assert.doesNotMatch(page, /\sstyle=|\son[a-z]+=/);
});

test('T-ACT-CLI-11 every scene a stop or section can show has its station announcement', () => {
  for (const scene of ACTIVITY_STOP_SCENES) assert.match(ANNOUNCEMENTS[scene] ?? '', /^Attention: /, scene);
});

test('T-ACT-CLI-12 the terminal greets the member by their Discord username; long names give way, @aphelion stays', async () => {
  assert.equal(windowUser('moonie'), 'moonie'); assert.equal(windowUser(null), 'crew'); assert.equal(windowUser('   '), 'crew');
  assert.equal(windowUser('a\u0000b\u001fc'), 'abc', 'no control characters');
  const longest = 'a'.repeat(32);
  assert.equal(windowUser(longest), longest, 'the longest Discord username is kept whole; the page cuts it with an ellipsis');
  const page = await readFile(new URL('../apps/activity/client/index.html', import.meta.url), 'utf8'), css = await readFile(new URL('../apps/activity/client/app.css', import.meta.url), 'utf8');
  assert.match(page, /id="window-title"[^>]*aria-hidden="true"[\s\S]*id="window-user"[^>]*>crew<[\s\S]*class="window-host">@aphelion</);
  assert.doesNotMatch(page, /shuttle<\/span><\/p>|@aphelion: shuttle/);
  // The name shrinks with an ellipsis; @aphelion never shrinks.
  assert.match(css, /\.window-user \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/); assert.match(css, /\.window-host \{ flex: none; \}/);
  assert.match(css, /\.window-title-text \{[^}]*min-width: 0; max-width: 100%/);
});

test('T-ACT-CLI-13 the radio meter is a travelling wave: no per-bar rule loses to the shared speaking rule', async () => {
  const css = await readFile(new URL('../apps/activity/client/app.css', import.meta.url), 'utf8');
  const rules = [...css.matchAll(/^([^{}\n]*\.wave i[^{}\n]*)\{([^}]*)\}/gm)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const bars = rules.filter(rule => /nth-(last-)?child/.test(rule.selector) && /animation/.test(rule.body));
  assert.ok(bars.length >= 8, 'per-bar timing exists');
  // The shared rule is scoped to the speaking states; every per-bar rule carries the same scope, so it wins.
  for (const rule of bars) assert.match(rule.selector, /^main(:is\(\[data-speaking="on"\], \[data-speaking="trailing"\]\)|\[data-speaking="(on|trailing)"\]) \.wave i/, rule.selector);
  const delays = new Set(bars.map(rule => /animation-delay: (-?[\d.]+s)/.exec(rule.body)?.[1]).filter(Boolean));
  assert.ok(delays.size >= 7, 'each bar a step behind the last');
});

test('T-ACT-CLI-14 the click-to-continue mark is decorative and still with motion off', async () => {
  const css = await readFile(new URL('../apps/activity/client/app.css', import.meta.url), 'utf8'), client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  assert.match(client, /mark\.className = 'ctc'; mark\.setAttribute\('aria-hidden', 'true'\); mark\.textContent = '▼'/);
  assert.match(css, /main\[data-motion="off"\] :is\(\.ctc,/); assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.ctc,/);
});

test('T-ACT-PAGE-03 a section that is a heading and one paragraph keeps its sign on its page; a longer one does not', () => {
  const sign = `> **NOTICE · LINKS**\n${Array.from({ length: 4 }, (_, i) => `> [Link ${i}](https://example.invalid/${i}): ${'what it is for '.repeat(4)}`).join('\n')}`;
  const paragraph = 'About this server. '.repeat(15).trim();
  assert.ok(paragraph.length > CHUNK_LIMIT / 3 && paragraph.length + sign.length < CHUNK_LIMIT * 2);
  // The About pages (owner review of revision 3): the link box shares the section's page.
  assert.deepEqual(transmissionChunks([`# About a server\n\n${paragraph}\n\n${sign}\n\nOn we go.`]),
    [`# About a server\n\n${paragraph}\n\n${sign}`, 'On we go.']);
  // Two paragraphs before the sign: it gets its own page, as before.
  const two = transmissionChunks([`# About a server\n\n${paragraph}\n\nAnother paragraph.\n\n${sign}`]);
  assert.equal(two.length, 2); assert.ok(two[1].startsWith('> **NOTICE'));
});

test('T-ACT-CLI-15 the Glossary keeps its sheet id; the page counter sits over the dots and shows only while reading', () => {
  assert.equal(TEXT.codex, 'Glossary');
  assert.ok(titleMenu({ state: 'ready', mode: 'qualification' }).items.some(item => item.id === 'codex' && item.label === 'Glossary'));
  assert.deepEqual(pageProgress(2, 5), { counter: '3 / 5', dots: '▪ ▪ ■ □ □' });
  assert.deepEqual(pageProgress(0, 1), { counter: '', dots: '' });
  assert.deepEqual(pageProgress(1, 4, false), { counter: '', dots: '' });
});

test('T-ACT-CLI-16 an ended session signs in again through Discord without a prompt and resends the same request once', async () => {
  const tokens = ['a'.repeat(64), 'b'.repeat(64)], live = new Set([tokens[0]]);
  let issued = 0, acts = [];
  const fetch = async (path, options) => {
    if (path === '/api/session') { const token = tokens[issued++]; live.add(token); return new Response(JSON.stringify({ token, accessToken: 'x', scopes: ['identify'] }), { status: 200 }); }
    const bearer = options.headers.Authorization?.slice(7);
    if (path === '/api/shuttle/act') acts.push({ bearer, requestId: JSON.parse(options.body).requestId });
    if (!live.has(bearer)) return new Response(JSON.stringify({ error: 'signin' }), { status: 401 });
    return new Response(JSON.stringify({ run: { stop: 2 } }), { status: 200 });
  };
  const signals = [];
  const api = createShuttleApi({ randomBytes: count => new Uint8Array(count).fill(171), wait: async () => {}, fetch, onSignal: online => signals.push(online) });
  await api.signIn({ code: 'c', instanceId: 'i-1' });
  // Without a way to renew (outside Discord), an ended session is still the sign-in notice.
  live.clear();
  await assert.rejects(api.act('advance', 4), error => error.word === 'signin' && error.status === 401);
  // With one, the member keeps reading: one renewal, and the same request key on the new token.
  let renewals = 0; acts = [];
  api.setRenewal(async () => { renewals++; await api.signIn({ code: 'again', instanceId: 'i-1' }); });
  assert.deepEqual(await api.act('advance', 4), { run: { stop: 2 } });
  assert.equal(renewals, 1); assert.deepEqual(acts.map(act => act.bearer), [tokens[0], tokens[1]]);
  assert.equal(new Set(acts.map(act => act.requestId)).size, 1);
  assert.ok(signals.every(Boolean), 'a refused session is not a lost signal');
  // A renewal that fails, or a session refused again straight after renewing, ends in the notice; never a loop.
  live.clear(); renewals = 0;
  api.setRenewal(async () => { renewals++; throw new Error('declined'); });
  await assert.rejects(api.describe(), error => error.word === 'signin'); assert.equal(renewals, 1);
  api.setRenewal(async () => { renewals++; });
  renewals = 0; await assert.rejects(api.describe(), error => error.word === 'signin'); assert.equal(renewals, 1);
});

test('T-ACT-CLI-17 phones (owner audit, 24 October 2026): sheets open at their top, one sheet shape, touch-sized controls, no sticky hover', async () => {
  const page = await readFile(new URL('../apps/activity/client/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../apps/activity/client/app.css', import.meta.url), 'utf8');
  const client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  // Every sheet: a focusable panel, a header bar with its title and a close button, a scrolling body ending in Close.
  for (const id of ['settings', 'codex', 'log', 'keys', 'credits']) {
    const sheet = new RegExp(String.raw`<section id="${id}" class="sheet" hidden aria-labelledby="${id}-heading">\s*<div class="sheet-panel[^"]*" tabindex="-1">\s*` +
      String.raw`<header class="sheet-head"><h2 id="${id}-heading" class="sheet-heading">[^<]+</h2><button type="button" class="sheet-close" data-close aria-label="Close">✕</button></header>\s*` +
      String.raw`<div class="sheet-body">[\s\S]*?<button type="button" class="control primary sheet-done" data-close>Close</button>\s*</div>\s*</div>\s*</section>`);
    assert.match(page, sheet, id);
  }
  assert.match(page, /id="codex-heading" class="sheet-heading">Glossary</);
  // Opening focuses the panel without scrolling and puts the body at its top (the Glossary opened at its bottom before).
  assert.match(client, /if \(body\) body\.scrollTop = 0;\s*panel\?\.focus\?\.\(\{ preventScroll: true \}\);/);
  assert.doesNotMatch(client, /querySelector\('input, button, a'\)\?\.focus\(\)/);
  assert.match(client, /\$\(id\)\.addEventListener\('click', event => \{ if \(event\.target === event\.currentTarget\) closeSheets\(\); \}\)/, 'the backdrop closes');
  assert.match(css, /\.sheet-body \{[^}]*overflow-y: auto; overscroll-behavior: contain;/);
  assert.match(css, /\.sheet \{[^}]*env\(safe-area-inset-top\)[^}]*env\(safe-area-inset-bottom\)/);
  // Hover only where a pointer hovers; fingers get 44 px; buttons never double-tap zoom.
  const hoverAt = css.indexOf('@media (hover: hover)');
  assert.ok(hoverAt > 0); assert.doesNotMatch(css.slice(0, hoverAt), /:hover/);
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*\.control, \.corner, \.viewscreen-link, \.arrival-card \{ min-height: 44px; \}/);
  assert.match(css, /button, input \{[^}]*touch-action: manipulation;/);
  // Short screens: a short portrait phone gives reading more room; a phone on its side keeps the side-by-side layout.
  assert.match(css, /@media \(orientation: portrait\) and \(max-height: 760px\) \{\s*#shuttle \{ grid-template-rows: minmax\(0, 40vh\)/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 500px\) \{[\s\S]*#shuttle \{ grid-template-columns: var\(--column\) minmax\(0, 1fr\);[\s\S]*\.status \{ height: clamp\(84px/);
  assert.match(css, /@media \(max-width: 480px\) \{\s*\.codex-list \{ grid-template-columns: minmax\(0, 1fr\);/);
  // The glossary says what Sophie does now.
  const glossary = Object.fromEntries(CODEX);
  assert.match(glossary.Whitelist, /Sophie hands it to you when you disembark/); assert.doesNotMatch(glossary.Whitelist, /request/);
  assert.match(glossary['Meridian Rift'], /in development/); assert.doesNotMatch(glossary['The Shuttle'], /journey/i);
});

test('T-ACT-CLI-19 only tappable things look tappable: links underlined with a mark, channel chips bordered, mentions plain', async () => {
  const css = await readFile(new URL('../apps/activity/client/app.css', import.meta.url), 'utf8');
  // A story link's arrow is text inside the link, after its label, so the typewriter never shows it first.
  assert.match(css, /\.md-link-arrow, \.credits a::after \{/); assert.doesNotMatch(css, /\.md-link::after/);
  const markdown = await readFile(new URL('../apps/activity/client/markdown.js', import.meta.url), 'utf8');
  assert.match(markdown, /element\('a', 'md-link', \[\.\.\.inline\(node\.children\), arrow\]\)/);
  assert.match(css, /\.md-channel \{[^}]*border: 1px solid var\(--holo-dim\);[^}]*cursor: pointer;/);
  // A mention or an unreachable channel neither wears the link colour nor a chip's background.
  for (const selector of ['md-mention', 'md-at']) {
    const rule = new RegExp(`\\.${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    assert.doesNotMatch(rule, /holo|background|border|cursor/, selector);
  }
  // The story now names the channels and links the rule sections it talks about.
  const story = await readFile(new URL('../content/onboarding/story.md', import.meta.url), 'utf8');
  for (const anchor of ['#RP-09', '#RP-05', '#CR-04', '#CR-07', '/wiki/Lore']) assert.ok(story.includes(anchor), anchor);
  assert.match(story, /leadership question channels \( #ask-mewn, #ask-mal, #ask-cobalt \)/);
});

test('T-ACT-CLI-18 linking never hangs: each try is bounded, tries back off, then the member is asked to try again or reopen', async () => {
  const { LINK_TIMEOUT_MS, LINK_ATTEMPTS, linkRetryDelay, linkingText } = await import('../apps/activity/client/presenter.js');
  assert.equal(LINK_TIMEOUT_MS, 15_000);
  assert.deepEqual(Array.from({ length: LINK_ATTEMPTS }, (_, i) => linkRetryDelay(i + 1)), [2_000, 5_000, 10_000, 20_000, null]);
  assert.equal(linkingText(1), 'Establishing link…'); assert.equal(linkingText(3), 'Establishing link… try 3 of 5');
  // Out of tries: trying again is the first choice, with a notice saying how to recover.
  const menu = titleMenu({ state: 'nolink' });
  assert.equal(menu.items[0].id, 'relink'); assert.equal(menu.notice, 'Cannot re-establish link, try reopening the activity. If that still doesn’t work, ping @matriarch in #crew-support.');
  const client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  assert.match(client, /const timer = timers\.after\(LINK_TIMEOUT_MS, \(\) => reject/, 'every try is bounded');
  assert.match(client, /const wait = linkRetryDelay\(linkAttempt\);\s*if \(wait === null\) \{ described = \{ state: 'nolink' \}; signal\('nolink'\); return; \}/);
  assert.match(client, /setSignal: checkSignal/); assert.match(client, /heartbeat = timers\.every\(15_000/);
  // Typing keeps the fraction of a character between frames: the speed setting holds on any display refresh.
  assert.match(client, /let budget = Math\.floor\(due\); carry = due - budget;/); assert.doesNotMatch(client, /Math\.max\(1, Math\.round\(\(now - last\) \* cps/);
  // Music starts at half volume (owner, 24 October 2026).
  assert.match(client, /levels: \{ master: 100, music: 50,/);
  const discord = await readFile(new URL('../apps/activity/client/discord.js', import.meta.url), 'utf8');
  assert.match(discord, /shared \?\?= /, 'one Discord SDK for the page, reused by every try');
});

test('T-ACT-CLI-21 back in the window, a lost link recovers without reopening (owner report, 24 October 2026)', async t => {
  // A renewal Discord never answers gives up after RENEWAL_MS; the next refused request renews afresh instead of waiting on it.
  const { RENEWAL_MS } = await import('../apps/activity/client/api.js');
  assert.equal(RENEWAL_MS, 10_000);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fetch = async path => path === '/api/session'
    ? new Response(JSON.stringify({ token: 'a'.repeat(64), accessToken: 'x', scopes: [] }), { status: 200 })
    : new Response(JSON.stringify({ error: 'signin' }), { status: 401 });
  const api = createShuttleApi({ randomBytes: count => new Uint8Array(count), wait: async () => {}, fetch });
  await api.signIn({ code: 'c', instanceId: 'i-1' });
  let renewals = 0;
  api.setRenewal(() => { renewals++; return new Promise(() => {}); });
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
  for (const expected of [1, 2]) {
    const pending = api.describe();
    await settle(); t.mock.timers.tick(RENEWAL_MS);
    await assert.rejects(pending, error => error.word === 'signin'); assert.equal(renewals, expected);
  }
  const client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  // Focus or visibility back: a link out of tries starts over with a fresh sign-in; a lost signal is checked at once.
  assert.match(client, /addEventListener\('visibilitychange', \(\) => \{ sound\.setHidden\(document\.hidden\); returned\(\); \}\)/);
  assert.match(client, /addEventListener\?\.\('focus', \(\) => \{ returned\(\); \}\)/);
  assert.match(client, /if \(state === 'nolink'\) \{[\s\S]*?await link\(\{ fresh: true \}\)/);
  assert.match(client, /if \(id === 'relink'\) \{[^\n]*await link\(\{ fresh: true \}\)/);
  assert.match(client, /if \(fresh && discord !== null\) discord = null;/);
  // Only a closed Shuttle or a refusal stops the tries; a member Discord has not listed in the instance yet is retried.
  assert.match(client, /if \(\['closed', 'denied'\]\.includes\(error\?\.word\)\)/);
});

test('T-ACT-CLI-22 Resume picks up on the page the member was reading, not the stop\'s first (owner report, 24 October 2026)', async () => {
  const client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  assert.match(client, /PLACE_KEY = 'shuttle\.place\.v1'/);
  // Entering a run restores the saved page when the mark (run version, stop, and the stop's text) still matches.
  assert.match(client, /chunk = atEnd \? chunks\.length - 1 : savedPage\(\);\s*savePlace\(\);/);
  assert.match(client, /function turnPage\(next\) \{\s*chunk = next; savePlace\(\);/);
  assert.match(client, /if \(run\?\.status !== 'reading'\) return null;/);
  assert.match(client, /return `\$\{run\.version\}:\$\{run\.stop\}:\$\{chunks\.length\}:\$\{hash\.toString\(36\)\}`;/);
  assert.match(client, /saved\.page >= 0 && saved\.page < chunks\.length\) return saved\.page;/);
});

test('T-ACT-CLI-23 Large text reaches the text, and Aa in the radio header switches it (member feedback, 24 October 2026)', async () => {
  const page = await readFile(new URL('../apps/activity/client/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../apps/activity/client/app.css', import.meta.url), 'utf8');
  const client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  // body resolves --text at body; without main reading it again, Large changed nothing.
  assert.match(css, /\nmain \{ font-size: var\(--text\); \}\nmain\[data-text-size="large"\] \{ --text: 20px; \}/);
  assert.match(page, /<header class="radio-head">[\s\S]*?<button id="radio-size" type="button" class="chip radio-size" aria-pressed="false" aria-label="Large text"[^>]*>Aa<\/button>\s*<\/header>/);
  assert.match(client, /\$\('radio-size'\)\.setAttribute\('aria-pressed', String\(settings\.size === 'large'\)\);/);
  assert.match(client, /settings\.size = settings\.size === 'large' \? 'normal' : 'large'; applySettings\(\); saveSettings\(\);/);
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*\.radio-size \{ min-width: 44px; min-height: 44px; \}/);
});

test('T-ACT-CLI-20 a scene link is a real button over its slot while reading, opening the page through Discord', async () => {
  const page = await readFile(new URL('../apps/activity/client/index.html', import.meta.url), 'utf8');
  const client = await readFile(new URL('../apps/activity/client/shuttle.js', import.meta.url), 'utf8');
  const player = await readFile(new URL('../apps/activity/scene-player.js', import.meta.url), 'utf8');
  assert.match(page, /<button id="scene-link" type="button" class="scene-link" hidden><\/button>/);
  assert.match(player, /get link\(\) \{ return scene\?\.link \?\? null; \}/);
  // Shown only while reading a scene that has a link; labelled for screen readers; opened through Discord, never in the frame.
  assert.match(client, /if \(!link \|\| !rect \|\| !canvas \|\| view !== 'radio'\) \{ button\.hidden = true; return; \}/);
  assert.match(client, /button\.setAttribute\('aria-label', link\.label\)/);
  assert.match(client, /\$\('scene-link'\)\?\.addEventListener\('click', \(\) => \{ const link = player\.link; if \(link\) \{ sound\.play\('UI-02'\); discord\?\.openLink\(link\.url\); \} \}\)/);
});
