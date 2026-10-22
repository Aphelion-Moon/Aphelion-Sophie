import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ANNOUNCEMENTS, TEXT, CHUNK_LIMIT, dialogueControls, presence, sceneStateFor, soundscape, titleMenu, transmissionChunks } from '../apps/activity/client/presenter.js';
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

test('T-ACT-CLI-02 the title menu follows the server state; refusals show fixed notices and no boarding', () => {
  assert.deepEqual(titleMenu({ state: 'ready', mode: 'qualification' }).items.map(item => item.id), ['board', 'codex', 'settings', 'credits']);
  assert.deepEqual(titleMenu({ state: 'ready', mode: 'qualification' }, { log: true }).items.map(item => item.id), ['board', 'log', 'codex', 'settings', 'credits']);
  assert.equal(titleMenu({ state: 'ready', mode: 'refresh' }).items[0].label, TEXT.refresher);
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
