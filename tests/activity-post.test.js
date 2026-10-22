import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ACTIVITY_LAUNCH_ID, ACTIVITY_POST_BANNER, activityLaunchPost } from '../modules/onboarding/activity-post.js';
import { ONBOARDING_ENTRY_ID, onboardingCommandDefinition } from '../modules/onboarding/entry-controls.js';
import { createInteractionHttpServer } from '../apps/core/discord/interaction-http.js';
import { syntheticInteractions } from './fixtures/interactions.js';

const component = customId => ({ type: 3, message: { id: '100000000000000020' }, data: { component_type: 2, custom_id: customId } });

test('T-ACT-POST-01 the rules post: banner, fixed wording, one launch button, no mentions', async () => {
  const post = activityLaunchPost();
  assert.equal(post.embeds.length, 1);
  const [embed] = post.embeds;
  assert.equal(embed.title, 'The Shuttle is boarding'); assert.equal(embed.color, 0xffb84d);
  assert.ok(embed.description.startsWith(`\`\`\`\n${ACTIVITY_POST_BANNER.join('\n')}\n\`\`\`\n`));
  assert.ok(embed.description.length <= 4_096);
  assert.deepEqual(post.components, [{ type: 1, components: [{ type: 2, style: 1, label: 'Board the Shuttle', custom_id: ACTIVITY_LAUNCH_ID }] }]);
  assert.deepEqual(post.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.doesNotMatch(JSON.stringify(post), /<@|<#|@everyone|@here/);
  for (const line of ACTIVITY_POST_BANNER) assert.equal([...line].length, 32, line);
  const record = JSON.parse(await readFile(new URL('../content/shuttle-activity/rules-post-banner.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(ACTIVITY_POST_BANNER.join('\n')).digest('hex'), record.sha256);
  assert.match(record.provenance.decision, /0001-owner-policy/);
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
