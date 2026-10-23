import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ACTIVITY_LAUNCH_ID, POST_ART_COLUMNS, POST_BOARD, POST_COLOUR, POST_LOGO, activityLaunchPost, artBlock, plainArt } from '../modules/onboarding/activity-post.js';
import { ONBOARDING_ENTRY_ID, onboardingCommandDefinition } from '../modules/onboarding/entry-controls.js';
import { createInteractionHttpServer } from '../apps/core/discord/interaction-http.js';
import { syntheticInteractions } from './fixtures/interactions.js';

const component = customId => ({ type: 3, message: { id: '100000000000000020' }, data: { component_type: 2, custom_id: customId } });

test('T-ACT-POST-01 the rules post is a station broadcast: logotype, boarding call with the button, board, manifest, small print, rules links', async () => {
  const post = activityLaunchPost();
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
  // The launch button sits beside the boarding call; it is the only button that reaches Sophie.
  const section = container.components.find(component => component.type === 9);
  assert.deepEqual(section.accessory, { type: 2, style: 1, label: 'Board the Shuttle', custom_id: ACTIVITY_LAUNCH_ID });
  assert.match(section.components[0].content, /^## Now boarding · Gate 03\n\*kssht\*[\s\S]*five stops[\s\S]*no quiz[\s\S]*\*\*Board the Shuttle\*\*/);
  const buttons = all.filter(component => component.type === 2);
  assert.equal(buttons.filter(button => 'custom_id' in button).length, 1);
  // The rules links open the browser (style 5): https only, no custom id, the story's own rules pages.
  const links = buttons.filter(button => button.style === 5);
  assert.deepEqual(links.map(link => [link.label, link.url]), [['SS 13 rules', 'https://meridian-wiki.a13.info/wiki/Policies'], ['SS 14 rules', 'https://panel.a13.info/guide/wolfgate']]);
  // The manifest is the story's cast; the small print carries the must-knows, true to what Sophie does now.
  const words = texts.join('\n');
  assert.match(words, /### Today's manifest[\s\S]*Rook[\s\S]*Pip[\s\S]*Officer Beepsky[\s\S]*Ian[\s\S]*sea lion/);
  assert.match(words, /-# 18\+ only[\s\S]*Sophie hands you \*\*Whitelist\*\*[\s\S]*App Launcher[\s\S]*@matriarch in #crew-support/);
  assert.doesNotMatch(words, /—|request your|Complete Shuttle/);
  assert.deepEqual(post.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.doesNotMatch(JSON.stringify(post), /<@|<#|@everyone|@here/);
  // The art: coloured on desktop as `ansi` blocks; the plain variant is the same characters without the escape codes.
  assert.equal(POST_COLOUR, true);
  for (const art of [POST_LOGO, POST_BOARD]) {
    assert.ok(texts.includes(artBlock(art, true)));
    const coloured = artBlock(art, true).replace(/^```ansi\n/u, '').replace(/\n```$/u, '').replace(/\u001b\[[0-9;]*m/gu, '');
    assert.equal(coloured, plainArt(art).join('\n'));
    assert.equal(artBlock(art, false), `\`\`\`\n${plainArt(art).join('\n')}\n\`\`\``);
    // At most 32 columns, so a phone's code block never wraps it.
    for (const line of plainArt(art)) assert.equal([...line].length, POST_ART_COLUMNS, line);
  }
  const plain = activityLaunchPost(undefined, { colour: false });
  assert.doesNotMatch(JSON.stringify(plain), /\\u001b|ansi/);
  // The logotype is centred (one column either way), and the neon bar runs the full width in six colours.
  const [first] = plainArt(POST_LOGO), inner = first.trim(), left = first.length - first.trimStart().length;
  assert.ok(Math.abs(left - (POST_ART_COLUMNS - inner.length - left)) <= 1, 'APHELION is centred');
  assert.equal(plainArt(POST_LOGO).at(-1), '▄'.repeat(32)); assert.equal(new Set(POST_LOGO.at(-1).map(([, code]) => code)).size, 6);
  assert.match(plainArt(POST_BOARD).join('\n'), /DEPARTURES +GATE 03[\s\S]*01 THE BROCHURE +BOARDING[\s\S]*05 DISEMBARKING +APHELION/);
  // Provenance: each block's plain characters are recorded.
  const record = JSON.parse(await readFile(new URL('../content/shuttle-activity/rules-post-banner.json', import.meta.url), 'utf8'));
  const sha = art => createHash('sha256').update(plainArt(art).join('\n')).digest('hex');
  assert.deepEqual(record.blocks.map(block => [block.id, block.sha256]), [['logo', sha(POST_LOGO)], ['board', sha(POST_BOARD)]]);
  assert.match(record.provenance.decision, /0001-owner-policy/); assert.ok(record.blocks.every(block => block.alt.length > 40));
  assert.ok(onboardingCommandDefinition().options.some(option => option.name === 'post' && option.type === 1));
});

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
