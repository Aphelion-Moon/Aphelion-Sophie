import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ACTIVITY_LAUNCH_ID, POST_ART_COLUMNS, POST_BOARD, POST_IMAGES, POST_LOGO, activityLaunchPost, plainArt, resolvePostMentions } from '../modules/onboarding/activity-post.js';
import { rasterise } from '../scripts/author-rules-post-art.mjs';
import { loadActivityClient } from '../apps/activity/client-assets.js';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ONBOARDING_ENTRY_ID, onboardingCommandDefinition } from '../modules/onboarding/entry-controls.js';
import { createInteractionHttpServer } from '../apps/core/discord/interaction-http.js';
import { syntheticInteractions } from './fixtures/interactions.js';

const component = customId => ({ type: 3, message: { id: '100000000000000020' }, data: { component_type: 2, custom_id: customId } });

test('T-ACT-POST-01 the rules post is a station broadcast: logotype, boarding call with the button, board, small print, rules links', async () => {
  const origin = 'https://onboarding.example.test', post = activityLaunchPost(undefined, { mediaOrigin: origin });
  assert.equal(post.flags, 1 << 15); assert.ok(!('content' in post) && !('embeds' in post));
  assert.equal(post.components.length, 1);
  const [container] = post.components;
  assert.equal(container.type, 17); assert.equal(container.accent_color, 0xffb84d);
  // Discord's limits for Components V2: 40 components in all, 4,000 characters of text.
  const all = [], walk = component => { all.push(component); for (const child of component.components ?? []) walk(child); if (component.accessory) walk(component.accessory); };
  walk(container);
  assert.ok(all.length <= 40, `${all.length} components`);
  const texts = all.filter(component => component.type === 10).map(component => component.content);
  assert.ok(texts.join('').length <= 4_000);
  // The art panels are images on the Activity host, so they fill the width on desktop too (a code block sat left), with
  // the art's own words as alt text.
  const galleries = container.components.filter(component => component.type === 12);
  assert.deepEqual(galleries.map(gallery => gallery.items.map(item => item.media.url)),
    [[`${origin}/content/shuttle-activity/post/rules-post-logo-1.png`], [`${origin}/content/shuttle-activity/post/rules-post-board-1.png`]]);
  assert.match(galleries[0].items[0].description, /APHELION[\s\S]*Shuttle Service[\s\S]*pride banner/);
  assert.match(galleries[1].items[0].description, /gate 03[\s\S]*The Brochure, boarding[\s\S]*Board the Shuttle, delayed[\s\S]*Disembarking, deep space/);
  assert.equal(container.components.indexOf(galleries[0]), 0, 'the logotype opens the post');
  // The launch button sits beside the boarding call; it is the only button that reaches Sophie.
  const section = container.components.find(component => component.type === 9);
  // The call names the button by its label (owner's edit of 24 October 2026: Travel to the Interlink).
  assert.deepEqual(section.accessory, { type: 2, style: 1, label: 'Travel to the Interlink', custom_id: ACTIVITY_LAUNCH_ID });
  assert.match(section.components[0].content, /^## Now boarding · Gate 03\n> \*\*\[P-BAND\]\*\* :protopop: Sophie beeps[\s\S]*five stops[\s\S]*\*\*Travel to the Interlink\*\* button/);
  // Italics close against their words: Discord does not italicise "*text *".
  assert.doesNotMatch(section.components[0].content, / \*(\n|$)/);
  const buttons = all.filter(component => component.type === 2);
  assert.equal(buttons.filter(button => 'custom_id' in button).length, 1);
  // The rules links open the browser (style 5): https only, no custom id, the story's own rules pages.
  const links = buttons.filter(button => button.style === 5);
  assert.deepEqual(links.map(link => [link.label, link.url]), [['SS 13 Wiki', 'https://meridian-wiki.a13.info/wiki/Policies'], ['SS 14 Guidebook', 'https://panel.a13.info/guide/wolfgate']]);
  // The owner removed the manifest; the small print carries the must-knows, true to what Sophie does now.
  const words = texts.join('\n');
  assert.doesNotMatch(words, /manifest|Rook|Pip/);
  assert.match(words, /-# Button above does nothing\?[\s\S]*App Launcher[\s\S]*-# Stuck\? Confused\? Ping @138755661537214464 in #crew-support or open a ticket in #open-a-ticket\./);
  assert.doesNotMatch(words, /—|request your|Complete Shuttle/);
  assert.deepEqual(post.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  // Without the server's directory nothing is linked.
  assert.doesNotMatch(JSON.stringify(post), /<@|<#|<:|@everyone|@here|\\u001b/);
  // Without an Activity host the art goes as plain code blocks; a host must be https.
  const plain = activityLaunchPost();
  assert.equal(plain.components[0].components.filter(component => component.type === 12).length, 0);
  assert.ok(plain.components[0].components.some(component => component.type === 10 && component.content === `\`\`\`\n${plainArt(POST_LOGO).join('\n')}\n\`\`\``));
  for (const bad of ['http://onboarding.example.test', 'https://example.test/path', 'javascript:alert(1)']) assert.throws(() => activityLaunchPost(undefined, { mediaOrigin: bad }), /MEDIA_ORIGIN/);
  // The art: at most 32 columns, the logotype centred, the pride banner in the lounge's seven stripes, the owner's board.
  for (const art of [POST_LOGO, POST_BOARD]) for (const line of plainArt(art)) assert.equal([...line].length, POST_ART_COLUMNS, line);
  const [first] = plainArt(POST_LOGO), inner = first.trim(), left = first.length - first.trimStart().length;
  assert.ok(Math.abs(left - (POST_ART_COLUMNS - inner.length - left)) <= 1, 'APHELION is centred');
  assert.equal(plainArt(POST_LOGO).at(-1), '▄'.repeat(32)); assert.deepEqual(POST_LOGO.at(-1).map(([, key]) => key), ['1', '2', '3', '4', '5', '6', '7']);
  assert.match(plainArt(POST_BOARD).join('\n'), /DEPARTURES +GATE 03[\s\S]*01 THE BROCHURE +BOARDING[\s\S]*03 BOARD THE SHUTTLE DELAYED[\s\S]*05 DISEMBARKING +DEEP SPACE/);
  assert.ok(onboardingCommandDefinition().options.some(option => option.name === 'post' && option.type === 1));
});

test('T-ACT-POST-04 the art images are the rendered art, pinned, recorded and served by the Activity host', async () => {
  const record = JSON.parse(await readFile(new URL('../content/shuttle-activity/rules-post-banner.json', import.meta.url), 'utf8'));
  assert.match(record.provenance.decision, /0001-owner-policy/); assert.match(record.provenance.generator, /No font file, model or image tool/);
  assert.deepEqual(record.blocks.map(block => block.id), ['logo', 'board']);
  const assets = await loadActivityClient(fileURLToPath(new URL('..', import.meta.url)));
  for (const block of record.blocks) {
    const image = POST_IMAGES[block.id], bytes = await readFile(new URL(`../${block.path}`, import.meta.url));
    assert.equal(block.path, image.path); assert.equal(block.alt, image.alt);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), block.sha256);
    assert.equal(createHash('sha256').update(plainArt(image.art).join('\n')).digest('hex'), block.artSha256);
    // The PNG's pixels are exactly the art rendered now (decoded here, so a different zlib build cannot fail it).
    const decoded = decodePng(bytes), raster = rasterise(image.art);
    assert.deepEqual([decoded.width, decoded.height], [raster.width, raster.height]); assert.deepEqual([block.width, block.height], [raster.width, raster.height]);
    assert.ok(decoded.pixels.equals(raster.pixels), `${block.id}: the image is the current art`);
    assert.ok(raster.width >= 800, 'wide enough to fill the post on desktop');
    // Served at its path as a PNG, pinned to its recorded hash.
    assert.equal(assets.get(`/${block.path}`)?.type, 'image/png');
  }
});

test('T-ACT-POST-05 the post links the server\'s own channels, members, roles and emoji, and never notifies anyone', () => {
  const directory = {
    channels: [{ id: '100000000000000041', name: 'crew-support', type: 0 }, { id: '100000000000000042', name: 'open-a-ticket', type: 0 },
      { id: '100000000000000044', name: 'twice', type: 0 }, { id: '100000000000000045', name: 'twice', type: 0 }, { id: '100000000000000046', name: 'voice', type: 2 }],
    roles: [{ id: '100000000000000047', name: 'Matriarch' }, { id: '100000000000000001', name: '@everyone' }],
    emojis: [{ id: '100000000000000043', name: 'protopop', animated: false }, { id: '100000000000000048', name: 'spin', animated: true }],
  };
  const resolve = text => resolvePostMentions(text, directory);
  assert.equal(resolve('Ping @138755661537214464 in #crew-support or open a ticket in #open-a-ticket.'),
    'Ping <@138755661537214464> in <#100000000000000041> or open a ticket in <#100000000000000042>.');
  assert.equal(resolve('Ask @matriarch (or @Matriarch).'), 'Ask <@&100000000000000047> (or <@&100000000000000047>).');
  assert.equal(resolve(':protopop: and :spin:'), '<:protopop:100000000000000043> and <a:spin:100000000000000048>');
  // Unknown, ambiguous or voice channels, @everyone/@here, unknown emoji: plain text. Headings and small print are untouched.
  for (const plain of ['#nowhere', '#twice', '#voice', '@everyone', '@here', ':unknown:', '## Now boarding', '-# small print', 'mail@example.test'])
    assert.equal(resolve(plain), plain);
  assert.equal(resolvePostMentions('#crew-support', null), '#crew-support');
  // The post with the directory: linked, and still no notifications.
  const post = activityLaunchPost(undefined, { mediaOrigin: 'https://onboarding.example.test', directory });
  const text = JSON.stringify(post);
  assert.match(text, /<:protopop:100000000000000043> Sophie beeps/);
  assert.match(text, /Ping <@138755661537214464> in <#100000000000000041> or open a ticket in <#100000000000000042>\./);
  assert.deepEqual(post.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
});

/** A minimal reader for the PNGs the art script writes: 8-bit RGB, every row unfiltered. */
function decodePng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8, width = 0, height = 0; const data = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); assert.deepEqual([...body.subarray(8, 13)], [8, 2, 0, 0, 0]); }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data)), pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) { assert.equal(raw[y * (width * 3 + 1)], 0); raw.copy(pixels, y * width * 3, y * (width * 3 + 1) + 1, (y + 1) * (width * 3 + 1)); }
  return { width, height, pixels };
}

test('T-ACT-POST-02 signed routing: the launch button and /whitelist post have their own commands', () => {
  const identities = syntheticInteractions();
  assert.equal(identities.mint(component(ACTIVITY_LAUNCH_ID)).command, 'shuttle.activity');
  assert.equal(identities.mint(component(ONBOARDING_ENTRY_ID)).command, 'shuttle.start');
  assert.equal(identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'post' }] } }).command, 'shuttle.post');
  assert.throws(() => identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'post', options: [{ name: 'x', type: 3, value: 'y' }] }] } }));
});

async function server(options = {}) {
  const signed = syntheticInteractions(), calls = [], panels = [];
  const http = createInteractionHttpServer({ verifier: signed.verifier, enabled: () => true, onFault: () => {},
    commands: { execute: async envelope => { calls.push(envelope.command); return 'recorded'; } }, respond: async () => {},
    onboardingPanel: { prepare: async envelope => { panels.push(envelope.command); return { content: '', embeds: [{ title: 'post' }] }; } }, ...options });
  const address = await http.listen();
  const request = async payload => {
    const input = signed.signed(signed.payload(payload));
    return (await fetch(`http://${address.host}:${address.port}/discord/interactions`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': input.signature, 'X-Signature-Timestamp': input.timestamp }, body: input.body })).json();
  };
  return { http, calls, panels, request };
}

test('T-ACT-POST-03 the launch button answers LAUNCH_ACTIVITY and records nothing; entry launches it only once open', async () => {
  const testing = await server();
  try {
    assert.deepEqual(await testing.request(component(ACTIVITY_LAUNCH_ID)), { type: 12 });
    assert.equal((await testing.request(component(ONBOARDING_ENTRY_ID))).type, 5);
    const posted = await testing.request({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'post' }] } });
    assert.equal(posted.type, 4); assert.deepEqual(testing.panels, ['shuttle.post']);
    await testing.http.drain();
    assert.deepEqual(testing.calls, ['shuttle.start']);
  } finally { await testing.http.close(); }
  const open = await server({ activityOpen: true });
  try {
    assert.deepEqual(await open.request(component(ONBOARDING_ENTRY_ID)), { type: 12 });
    assert.deepEqual(await open.request({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } }), { type: 12 });
    await open.http.drain();
    assert.deepEqual(open.calls, []);
  } finally { await open.http.close(); }
  const disabled = await server({ enabled: () => false });
  try { assert.equal((await disabled.request(component(ACTIVITY_LAUNCH_ID))).type, 4); }
  finally { await disabled.http.close(); }
});
