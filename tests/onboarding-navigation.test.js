import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingNavigationReply } from '../modules/onboarding/navigation.js';
import { createInteractionResponder } from '../apps/core/discord/interaction-response.js';
import { syntheticInteractions, APPLICATION, CHANNEL } from './fixtures/interactions.js';
import { GUILD, USER, NOW } from './fixtures/domain.js';

test('Shuttle destinations expose one direct link only when ready', () => {
  const ready = onboardingNavigationReply({ state: 'ready', guildId: GUILD, channelId: CHANNEL });
  assert.equal(ready.components[0].components[0].url, `https://discord.com/channels/${GUILD}/${CHANNEL}`);
  assert.equal(ready.components[0].components[0].custom_id, undefined);
  const waiting = onboardingNavigationReply({ state: 'preparing' });
  assert.deepEqual(waiting.components, []);
  assert.equal(ready.components[0].components[0].label, 'Begin Whitelist');
  for (const state of ['denied', 'disabled', 'unavailable']) assert.deepEqual(onboardingNavigationReply({ state }).components, []);
  for (const value of [{ state: 'ready', guildId: GUILD, channelId: '../other' },
    { state: 'ready', guildId: GUILD, channelId: CHANNEL, url: 'https://example.invalid' },
    { state: 'preparing', channelId: CHANNEL }, { state: 'unrecognized' }]) {
    assert.throws(() => onboardingNavigationReply(value));
  }
});

test('entry waits for readiness without sending a retry button, and terminates on timeout or access loss', async () => {
  for (const outcome of ['ready', 'timeout', 'denied']) {
    const identities = syntheticInteractions(), sent = []; let reads = 0, waits = 0;
    const envelope = identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } });
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION, clock: () => NOW,
      enabled: () => true, wait: async () => { waits++; assert.equal(sent.length, 0); },
      onboardingNavigation: { resolve: async () => { reads++; return reads === 1 || outcome === 'timeout' ? { state: 'preparing' } :
        outcome === 'denied' ? { state: 'denied' } : { state: 'ready', guildId: GUILD, channelId: CHANNEL }; } },
      fetch: async (_url, request) => { sent.push(JSON.parse(request.body)); return Response.json({}); } });
    await responder.respond(envelope, 'shuttle_recorded'); assert.equal(sent.length, 1);
    assert.equal(waits, outcome === 'timeout' ? 15 : 1);
    if (outcome === 'ready') { assert.match(sent[0].content, /has arrived/); assert.ok(sent[0].components[0].components[0].url); }
    else { assert.deepEqual(sent[0].components, []); assert.doesNotMatch(sent[0].content, /has arrived/); }
  }
});

test('verified Shuttle responses deliver a private fixed destination with all mentions suppressed', async () => {
  const identities = syntheticInteractions(), calls = [];
  const envelope = identities.mint({ member: { user: { id: USER } },
    data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } });
  let lookups = 0;
  const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION, clock: () => NOW,
    enabled: () => true, onboardingNavigation: { resolve: async value => {
      assert.equal(value, envelope); lookups++; return { state: 'ready', guildId: GUILD, channelId: CHANNEL };
    } }, fetch: async (url, request) => { calls.push({ url, body: JSON.parse(request.body) }); return Response.json({}); } });
  await assert.rejects(responder.respond({ ...envelope }, 'shuttle_recorded'), /INTERACTION_REPLY_EXPIRED/);
  assert.equal(lookups, 0);
  await responder.respond(envelope, 'shuttle_recorded');
  assert.equal(lookups, 1); assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/webhooks\/\d+\/synthetic-interaction-reply-token\/messages\/@original$/);
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.equal(calls[0].body.components[0].components[0].url, `https://discord.com/channels/${GUILD}/${CHANNEL}`);
  await responder.respond(envelope, 'denied');
  assert.equal(lookups, 1); assert.deepEqual(calls[1].body.components, []);
});

test('expired credentials and a disabled gate after destination lookup prevent response delivery', async () => {
  for (const change of ['expiry', 'disable']) {
    let now = NOW, enabled = true, calls = 0;
    const identities = syntheticInteractions({ clock: () => now });
    const envelope = identities.mint({ member: { user: { id: USER } },
      data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } });
    const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION, clock: () => now,
      enabled: () => enabled, onboardingNavigation: { resolve: async () => {
        if (change === 'expiry') now += 900_000; else enabled = false;
        return { state: 'ready', guildId: GUILD, channelId: CHANNEL };
      } }, fetch: async () => { calls++; return Response.json({}); } });
    await assert.rejects(responder.respond(envelope, 'shuttle_recorded'),
      change === 'expiry' ? /INTERACTION_REPLY_EXPIRED/ : /DISCORD_TRANSPORT_DISABLED/);
    assert.equal(calls, 0);
  }
});
