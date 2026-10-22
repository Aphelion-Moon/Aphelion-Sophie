import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TRANSIT_MS, cueEvent, cueSheet, headingKey, linkState, momentFor, speechMs, transmissionChunks } from '../apps/activity/client/presenter.js';
import { EMOJI, parseMarkdown, plainText } from '../apps/activity/client/markdown.js';
import { createSoundboard } from '../apps/activity/client/audio.js';
import { viewscreenFrame } from '../apps/activity/client/viewscreen.js';
import { loadActivityClient } from '../apps/activity/client-assets.js';
import { loadActivityContent } from '../apps/activity/content.js';
import { validateMoments, validateViewscreen } from '../modules/onboarding/activity-media.js';
import { canonicalActivityLayout, effectiveLayout, emptyActivityLayout, validateActivityLayout } from '../modules/onboarding/activity-layout.js';
import { activityRunView, activityStopScene } from '../modules/onboarding/activity.js';
import { paginateStaticText } from '../modules/onboarding/presentation.js';
import { createActivityChannels } from '../apps/core/discord/activity-channels.js';
import { createActivityLayoutHttp, ACTIVITY_LAYOUT_ROUTES } from '../apps/core/http/activity-layout.js';
import { dashboardPageAllowed, dashboardSessionView } from '../contracts/dashboard-navigation.js';
import { GUILD, USER, NOW, publication } from './fixtures/domain.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const draft = JSON.parse(await readFile(new URL('../content/onboarding/definition.json', import.meta.url), 'utf8'));
const stops = ['departure-lounge', 'baggage-hall', 'boarding-cabin', 'viewport', 'pressure-door'].map((scene, index) => ({ id: `stop-${index}`, title: `Stop ${index + 1}`, scene }));
const run = (changes = {}) => ({ version: 2, status: 'reading', mode: 'qualification', stop: 0, stops, pages: ['Synthetic page.'], whitelist: 'none', ...changes });
const at = (steps, action, value) => steps.find(step => step.action === action && (value === undefined || step.value === value))?.at;

test('T-ACT-CUE-01 sounds filter in: each stop, page and arrival starts its pieces one after another, and the text waits for Sophie', () => {
  const title = cueSheet('title');
  assert.equal(at(title, 'ambience', 'AMB-01'), 0); assert.equal(at(title, 'music', 'MUS-01'), 2_500);
  assert.deepEqual(title.find(step => step.action === 'music').fades, { fadeIn: 4 });
  const stop = cueSheet('stop', run());
  assert.ok(at(stop, 'play', 'SC-01') < at(stop, 'transition') && at(stop, 'transition') < at(stop, 'ambience'));
  assert.ok(at(stop, 'ambience') < at(stop, 'play', 'SC-02') && at(stop, 'play', 'SC-02') < at(stop, 'play', 'DLG-03'));
  assert.ok(at(stop, 'play', 'DLG-03') < at(stop, 'speak') && at(stop, 'speak') === at(stop, 'reveal'));
  assert.deepEqual(stop.find(step => step.action === 'ambience').fades, { fadeIn: 3, previousFadeOut: 2 });
  assert.equal(at(cueSheet('stop', run({ stop: 1 })), 'play', 'SC-02'), undefined, 'the split-flap board is only in the lounge');
  const ride = cueSheet('stop', run({ stop: 1 }), { transit: true });
  assert.equal(at(ride, 'transit'), 150); assert.equal(ride.find(step => step.action === 'transit').value, TRANSIT_MS);
  assert.equal(at(ride, 'transition'), 150 + TRANSIT_MS); assert.equal(at(ride, 'play', 'SC-01'), 0);
  const page = cueSheet('page', run());
  assert.deepEqual(page.map(step => [step.at, step.action, step.value]), [[0, 'play', 'DLG-02'], [150, 'speak', 1_200], [150, 'reveal', undefined]]);
  const arrival = cueSheet('arrival', run({ status: 'boarded', stop: 4, whitelist: 'confirmed' }));
  assert.ok(at(arrival, 'play', 'SC-05') < at(arrival, 'play', 'SC-04') && at(arrival, 'play', 'SC-04') < at(arrival, 'ambience', 'AMB-06'));
  assert.equal(at(arrival, 'music', 'MUS-02'), 3_000);
  for (const event of ['stop', 'clearance', 'arrival']) {
    const sheet = cueSheet(event, run({ status: event === 'stop' ? 'reading' : event === 'arrival' ? 'boarded' : 'pending', whitelist: event === 'arrival' ? 'confirmed' : 'none' }));
    assert.equal(sheet.filter(step => step.action === 'speak').length, 1, event); assert.equal(sheet.find(step => step.action === 'speak').value, 2_400, event);
  }
  assert.throws(() => cueSheet('unknown'), /UNKNOWN_CUE_SHEET/);
});

test('T-ACT-CUE-02 which sheet plays: a new stop (either way), clearance once, arrival once confirmed, nothing for the same stage', () => {
  assert.equal(cueEvent(null, run()), 'stop');
  assert.equal(cueEvent(run(), run({ stop: 1 })), 'stop');
  assert.equal(cueEvent(run({ stop: 2 }), run({ stop: 1 })), 'stop');
  assert.equal(cueEvent(run(), run({ version: 3 })), null);
  assert.equal(cueEvent(run({ stop: 4 }), run({ stop: 4, status: 'pending', whitelist: 'requested' })), 'clearance');
  assert.equal(cueEvent(run({ status: 'pending' }), run({ status: 'pending' })), null);
  assert.equal(cueEvent(run({ status: 'pending' }), run({ status: 'boarded', whitelist: 'confirmed' })), 'arrival');
  assert.equal(cueEvent(run({ status: 'boarded', whitelist: 'confirmed' }), run({ status: 'boarded', whitelist: 'confirmed' })), null);
});

test('T-ACT-MOM-01 moments: headings match after markdown and punctuation; a transmission stages the section it opens with', () => {
  assert.equal(headingKey('**No one** is forcing you to get on the shuttle.'), 'no one is forcing you to get on the shuttle');
  assert.equal(headingKey('Don’t assume [your character](https://x.test) knows!'), "don't assume your character knows");
  const moments = { one: { beat: 'adult' }, two: { beat: 'pride', viewscreen: 'rules' } };
  const chunks = ['# One\ntext', 'more of one', '# Two\ntext\n# Unknown\ntext', 'after unknown', '# One\n### Sub\ntext'];
  assert.deepEqual(chunks.map((_, index) => momentFor(chunks, index, moments)), [
    { beat: 'adult', viewscreen: null, scene: null }, { beat: 'adult', viewscreen: null, scene: null }, { beat: 'pride', viewscreen: 'rules', scene: null },
    { beat: 'none', viewscreen: null, scene: null }, { beat: 'adult', viewscreen: null, scene: null }]);
  assert.deepEqual(momentFor(['plain'], 0, moments), { beat: 'none', viewscreen: null, scene: null });
  assert.deepEqual(momentFor(['## Smaller\nunnamed'], 0, moments), { beat: 'none', viewscreen: null, scene: null });
});

test('T-ACT-MOM-02 the shipped moments cover every section heading of the draft copy, with beats their default scenes draw', async () => {
  const content = await loadActivityContent(root);
  validateMoments(content.defaults, new Set(content.viewscreens.keys()));
  let mapped = 0;
  draft.stages.forEach((stage, index) => {
    const moments = content.defaults.stages[stage.id] ?? {}, stopScene = activityStopScene(index, draft.stages.length);
    // A moment may stage its section in a scene of its own (Board the Shuttle); its beat belongs to that scene.
    for (const moment of Object.values(moments)) assert.ok(content.sceneBeats.get(moment.scene ?? stopScene).includes(moment.beat), `${stage.id}: ${moment.beat}`);
    const keys = [...stage.body.matchAll(/^# (.+)$/gm)].map(match => headingKey(match[1]));
    for (const key of keys) { assert.ok(Object.hasOwn(moments, key), `${stage.id}: ${key}`); mapped++; }
    // Every page of the stop resolves to a moment without error.
    const chunks = transmissionChunks(paginateStaticText(stage.body));
    chunks.forEach((_, chunk) => momentFor(chunks, chunk, moments));
  });
  assert.equal(mapped, 21);
  // Ten Thousand belongs to the page that links the comic, wherever that page falls in its section.
  const lights = draft.stages.find(stage => stage.id === 'admire-the-lights');
  const pages = transmissionChunks(paginateStaticText(lights.body));
  const shown = pages.map((page, index) => momentFor(pages, index, content.defaults.stages['admire-the-lights']));
  assert.deepEqual(pages.map((page, index) => [page.includes('xkcd.com/1053'), shown[index].viewscreen === 'ten-thousand']).filter(([a, b]) => a !== b), []);
  assert.ok(shown.some(moment => moment.beat === 'lucky'));
});

test('T-ACT-MOM-04 a phrase moment stages the page containing it and keeps the section moment elsewhere', () => {
  const moments = { one: { beat: 'adult' }, '~see the comic': { beat: 'lucky', viewscreen: 'ten-thousand' } };
  const chunks = ['# One\ntext', 'more text', 'Then **see the comic** here.'];
  assert.deepEqual(chunks.map((_, index) => momentFor(chunks, index, moments)), [
    { beat: 'adult', viewscreen: null, scene: null }, { beat: 'adult', viewscreen: null, scene: null }, { beat: 'lucky', viewscreen: 'ten-thousand', scene: null }]);
});

test('T-ACT-MOM-03 viewscreens: original art within bounds, https links only, provenance recorded', async () => {
  const folder = new URL('../content/shuttle-activity/viewscreens/', import.meta.url);
  const files = (await readdir(folder)).filter(name => name.endsWith('.json'));
  assert.ok(files.length >= 6);
  for (const name of files) {
    const screen = validateViewscreen(JSON.parse(await readFile(new URL(name, folder), 'utf8')));
    assert.equal(`${screen.id}.json`, name);
    assert.match(screen.provenance.author, /coding agent/i);
    const frame = viewscreenFrame(screen);
    assert.ok(frame.cols <= 40 && frame.rows <= 16);
    assert.ok(frame.glyphs.every(row => [...row].length === frame.cols) && frame.colours.every(row => [...row].length === frame.cols));
  }
  const sample = JSON.parse(await readFile(new URL(files[0], folder), 'utf8'));
  for (const bad of [{ links: [{ label: 'x', url: 'http://example.test/' }] }, { links: [{ label: 'x', url: 'https://u:p@example.test/' }] },
    { links: Array.from({ length: 7 }, (_, i) => ({ label: `x${i}`, url: 'https://example.test/' })) },
    { art: { text: ['ok', '☺'], colours: ['ii', 'i'] } }, { art: { text: ['x'.repeat(41)], colours: ['i'.repeat(41)] } }, { script: 'alert(1)' }]) {
    assert.throws(() => validateViewscreen({ ...sample, ...bad }), /INVALID_VIEWSCREEN/);
  }
});

test('T-ACT-MD-01 channel chips only for channels core reported; emoji shortcodes and @names are styled text', () => {
  const tree = parseMarkdown('Use #open-a-ticket, #secret-staff or <#100000000000000009>. Ask @matriarch :wink: (#1 fan) a@b.test');
  const nodes = tree[0].children;
  assert.deepEqual(nodes.filter(node => node.type === 'channel').map(node => node.name), ['open-a-ticket', 'secret-staff', '1']);
  assert.equal(nodes.find(node => node.type === 'mention').channel, '100000000000000009');
  assert.deepEqual(nodes.filter(node => node.type === 'at').map(node => node.text), ['@matriarch']);
  assert.ok(nodes.some(node => node.type === 'text' && node.text === EMOJI.wink));
  const visible = { '#open-a-ticket': { id: '100000000000000001', name: 'open-a-ticket' }, '<#100000000000000009>': { id: '100000000000000009', name: 'rules' } };
  const text = plainText(tree, visible);
  assert.match(text, /#open-a-ticket, #secret-staff or #rules\./);
  assert.match(plainText(tree), /or #channel\./);
  assert.equal(parseMarkdown(':notanemoji:')[0].children.map(node => node.text).join(''), ':notanemoji:');
});

function fakeChannels({ channels, roles, memberRoles = [], owner = '100000000000000777' }) {
  let reads = 0;
  const transport = { async getGuild() { reads++; return { id: GUILD, owner_id: owner }; }, async getGuildChannels() { return channels; } };
  const prepared = { async prepare(userId) { return { context: { userId, memberRoleIds: memberRoles, roles } }; } };
  return { reads: () => reads, adapter: createActivityChannels({ transport, roles: prepared, guildId: GUILD, clock: () => NOW }) };
}

test('T-ACT-CHAN-01 links name only channels the member can view now; hidden names never leave core', async () => {
  const VIEW = String(1n << 10n), WHITELIST = '100000000000000500';
  const roles = [{ id: GUILD, permissions: VIEW }, { id: WHITELIST, permissions: '0' }];
  const channels = [
    { id: '100000000000000001', type: 0, name: 'open-a-ticket', position: 1, permission_overwrites: [] },
    { id: '100000000000000002', type: 0, name: 'staff-room', position: 2, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: VIEW }] },
    { id: '100000000000000003', type: 0, name: 'meridian-rift', position: 3, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: VIEW }, { id: WHITELIST, type: 0, allow: VIEW, deny: '0' }] },
    { id: '100000000000000004', type: 2, name: 'voice', position: 4, permission_overwrites: [] },
  ];
  const pages = ['Open #open-a-ticket, not #staff-room, or <#100000000000000003>, #voice, #missing.'];
  const before = fakeChannels({ channels, roles });
  const seen = await before.adapter.resolve({ userId: USER, pages, arrival: null });
  assert.deepEqual(Object.keys(seen.mentions), ['#open-a-ticket']);
  assert.deepEqual(seen.arrival, []);
  assert.doesNotMatch(JSON.stringify(seen), /staff-room|meridian/);
  const after = fakeChannels({ channels, roles, memberRoles: [WHITELIST] });
  const arrival = [{ channelId: '100000000000000003', note: 'Our SS 13 server' }, { channelId: '100000000000000002' }, { channelId: '100000000000000099' }];
  const open = await after.adapter.resolve({ userId: USER, pages, arrival });
  assert.deepEqual(open.mentions['<#100000000000000003>'], { id: '100000000000000003', name: 'meridian-rift' });
  assert.deepEqual(open.arrival, [{ id: '100000000000000003', name: 'meridian-rift', note: 'Our SS 13 server' }]);
  await after.adapter.resolve({ userId: USER, pages, arrival });
  assert.equal(after.reads(), 1, 'the channel list is cached briefly');
  assert.deepEqual(await fakeChannels({ channels, roles }).adapter.resolve({ userId: USER, pages: ['No channels here.'], arrival: null }), { mentions: {}, arrival: [] });
});

test('T-ACT-LAY-01 layout documents are bounded data: known scenes, valid moments, a short curated list', () => {
  const viewscreens = new Set(['rules']);
  const good = { schema: 1, stops: { 'the-brochure': { scene: 'viewport', moments: { 'this is an adult community': { beat: 'enjoy', viewscreen: 'rules' } } } },
    arrival: [{ channelId: '100000000000000003', note: 'Say hello' }, { channelId: '100000000000000004' }] };
  validateActivityLayout(good, { viewscreens });
  validateActivityLayout(emptyActivityLayout());
  for (const bad of [{ ...good, extra: 1 }, { ...good, stops: { 'the-brochure': { scene: 'hangar-viewport' } } },
    { ...good, stops: { 'the-brochure': { moments: { 'Upper Case': { beat: 'adult' } } } } },
    { ...good, stops: { 'the-brochure': { moments: { x: { beat: 'adult', viewscreen: 'unknown' } } } } },
    { ...good, arrival: [{ channelId: '100000000000000003' }, { channelId: '100000000000000003' }] },
    { ...good, arrival: [{ channelId: '100000000000000003', note: '<b>hi</b>' }] }, { ...good, arrival: [{ channelId: '100000000000000003', note: 'x'.repeat(121) }] },
    { ...good, arrival: Array.from({ length: 13 }, (_, i) => ({ channelId: `1000000000000001${String(i).padStart(2, '0')}` })) }, { ...good, arrival: [{ channelId: 'general' }] }]) {
    assert.throws(() => validateActivityLayout(bad, { viewscreens }));
  }
  const shuffled = { arrival: good.arrival, stops: { 'the-brochure': { moments: good.stops['the-brochure'].moments, scene: 'viewport' } }, schema: 1 };
  assert.equal(JSON.stringify(canonicalActivityLayout(shuffled, { viewscreens })), JSON.stringify(canonicalActivityLayout(good, { viewscreens })));
});

test('T-ACT-LAY-02 a published layout changes scenes and moments per stop; the run view carries only the current stop\'s moments', () => {
  const defaults = { schema: 1, stages: { [publication.stages[0].id]: { a: { beat: 'adult' }, b: { beat: 'pride' } } } };
  const layout = { schema: 1, stops: { [publication.stages[0].id]: { scene: 'viewport', moments: { b: { beat: 'none' } } }, [publication.stages[1].id]: { scene: 'boarding-cabin' } },
    arrival: [{ channelId: '100000000000000003' }] };
  const effective = effectiveLayout({ stages: publication.stages, defaults, layout });
  assert.deepEqual(effective.stops.map(stop => stop.scene), ['viewport', 'boarding-cabin', ...publication.stages.slice(2).map((_, i) => activityStopScene(i + 2, publication.stages.length))]);
  assert.deepEqual(effective.stops[0].moments, { a: { beat: 'adult' }, b: { beat: 'none' } });
  assert.deepEqual(effective.arrival, [{ channelId: '100000000000000003' }]);
  const view = activityRunView({ session: { id: 'activity.1', guildId: GUILD, userId: USER, definitionId: publication.id, definitionVersion: publication.version,
    eligibilityEpoch: 1, mode: 'qualification', stepIndex: 0, status: 'active', version: 0, nonce: 'n1', grantAccessEpoch: null, helpPaused: false }, publication, whitelist: false, layout: effective });
  assert.equal(view.stops[0].scene, 'viewport'); assert.deepEqual(view.moments, effective.stops[0].moments);
  assert.equal(JSON.stringify(view).includes('100000000000000003'), false, 'the curated list is not part of the run view');
});

test('T-ACT-LAY-03 editor routes: closed shapes, fresh authentication, guidance publishers only', async () => {
  assert.deepEqual(Object.keys(ACTIVITY_LAYOUT_ROUTES), ['/api/activity-layout', '/api/activity-layout/publish']);
  const calls = [];
  const http = createActivityLayoutHttp({ auth: { async authenticate(input) { calls.push(['auth', input.method]); return { proof: 'p' }; } },
    authorization: { async resolveActor(proof) { return { proof }; } },
    store: { async readActivityLayout(input) { calls.push(['read', input]); return { version: 0 }; }, async publishActivityLayout(input) { calls.push(['publish', input]); return { version: 1 }; } } });
  const query = new URLSearchParams();
  assert.deepEqual(await http.execute({ path: '/api/activity-layout', method: 'GET', query, body: null, credentials: {} }), { version: 0 });
  const body = { requestId: 'a'.repeat(64), expectedVersion: 0, document: emptyActivityLayout() };
  assert.deepEqual(await http.execute({ path: '/api/activity-layout/publish', method: 'POST', query, body, credentials: {} }), { version: 1 });
  assert.deepEqual(calls.at(-1), ['publish', { actor: { proof: 'p' }, ...body }]);
  for (const bad of [{ path: '/api/activity-layout', method: 'POST', body }, { path: '/api/activity-layout/publish', method: 'POST', body: { ...body, extra: 1 } },
    { path: '/api/activity-layout', method: 'GET', body: null, query: new URLSearchParams('x=1') }]) {
    await assert.rejects(http.execute({ query, credentials: {}, ...bad }), error => error.code === 'ACTIVITY_LAYOUT_INPUT_INVALID');
  }
  const actor = { guildId: GUILD, userId: USER, capabilities: { 'shuttle.publish': true } };
  assert.equal(dashboardPageAllowed('/activity', dashboardSessionView(actor, 'csrf', { 'shuttle.publish': true, activityLayout: true })), true);
  assert.equal(dashboardPageAllowed('/activity', dashboardSessionView(actor, 'csrf', { 'shuttle.publish': true })), false);
  assert.equal(dashboardPageAllowed('/activity', dashboardSessionView({ ...actor, capabilities: {} }, 'csrf', { activityLayout: true })), false);
});

test('T-ACT-AUD-01 sound: music ducks about 6 dB under Sophie, a master level scales everything, and a cue can set its fades', async () => {
  const ramps = [], targets = [];
  const gain = () => { const g = { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime(value) { targets.push(value); },
    linearRampToValueAtTime(value, when) { ramps.push([value, when]); } }; return { gain: g, connect() {} }; };
  const context = { currentTime: 10, state: 'running', destination: {}, createGain: gain, async decodeAudioData(bytes) { return { bytes }; }, async resume() {},
    createBufferSource: () => ({ connect() {}, start() {}, stop() {} }) };
  const index = JSON.parse(await readFile(new URL('../content/shuttle-activity/sounds/index.json', import.meta.url), 'utf8'));
  const board = createSoundboard({ index, base: '/s/', createContext: () => context, canPlayOpus: true, fetchBytes: async path => path, levels: { music: 1 } });
  await board.unlock();
  const mix = index.suggestedMix?.music ?? 1;
  board.duck(true); assert.equal(targets.at(-1), mix * 0.5);
  board.duck(false); assert.equal(targets.at(-1), mix);
  board.setMaster(0.4); assert.equal(targets.at(-1), 0.4);
  await board.ambience('AMB-02', { fadeIn: 3 });
  assert.deepEqual(ramps.at(-1), [1, 13]);
  await board.ambience('AMB-03', { fadeIn: 3, previousFadeOut: 2 });
  assert.ok(ramps.some(([value, when]) => value === 0 && when === 12), 'the previous bed fades out over 2 s');
});

test('T-ACT-CLI-10 the client serves the viewscreens and moments with the scenes, and the title link panel reads truthfully', async () => {
  const files = await loadActivityClient(root);
  for (const path of ['/content/shuttle-activity/moments.json', '/content/shuttle-activity/viewscreens/sealion.json', '/apps/activity/client/viewscreen.js',
    '/modules/onboarding/activity-media.js']) assert.ok(files.has(path), path);
  assert.equal(linkState(null), 'none');
  assert.equal(linkState({ state: 'ready' }), 'ready');
  assert.equal(linkState({ state: 'closed' }), 'closed');
  assert.equal(linkState({ state: 'elsewhere' }), 'channel');
  assert.equal(linkState({ state: 'failed' }), 'offline');
  assert.equal(linkState({ state: 'run', run: run({ status: 'boarded' }) }), 'arrived');
});

test('T-ACT-MOM-05 a section can name its own scene; the layout accepts only known scenes and beats that scene draws', () => {
  const moments = { one: { beat: 'together', scene: 'landing-bay' }, two: { beat: 'seat' } };
  const chunks = ['# One\ntext', '# Two\ntext'];
  assert.deepEqual(momentFor(chunks, 0, moments), { beat: 'together', viewscreen: null, scene: 'landing-bay' });
  assert.deepEqual(momentFor(chunks, 1, moments), { beat: 'seat', viewscreen: null, scene: null });
  validateActivityLayout({ schema: 1, stops: { 'board-the-shuttle': { moments: { one: { beat: 'together', scene: 'landing-bay' } } } }, arrival: [] });
  assert.throws(() => validateActivityLayout({ schema: 1, stops: { 'board-the-shuttle': { moments: { one: { beat: 'together', scene: 'nowhere' } } } }, arrival: [] }),
    /INVALID_MOMENT/);
  const canonical = canonicalActivityLayout({ arrival: [], schema: 1, stops: { s: { moments: { one: { scene: 'landing-bay', beat: 'together' } } } } });
  assert.equal(JSON.stringify(canonical.stops.s.moments.one), '{"beat":"together","scene":"landing-bay"}');
});

test('T-ACT-CUE-03 Sophie speaks for about half of a page\'s typing time, between 2 and 6 seconds', () => {
  assert.equal(speechMs('x'.repeat(90)), 2_000);
  assert.equal(speechMs('x'.repeat(540)), 3_000);
  assert.equal(speechMs('x'.repeat(540), 'slow'), 6_000);
  assert.equal(speechMs('x'.repeat(540), 'fast'), 2_000);
  assert.equal(speechMs('x'.repeat(5_000)), 6_000);
  const sheet = cueSheet('page', run(), { speech: 3_000 });
  assert.equal(sheet.find(step => step.action === 'speak').value, 3_000);
  assert.equal(cueSheet('stop', run(), { speech: 4_500 }).find(step => step.action === 'speak').value, 4_500);
});
