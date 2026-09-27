import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionResponder } from '../apps/core/discord/interaction-response.js';
import { syntheticInteractions, APPLICATION } from './fixtures/interactions.js';
import { NOW } from './fixtures/domain.js';

test('onboarding page turns are quiet and errors use a private follow-up, never overwrite the page', async () => {
  const identities = syntheticInteractions(), calls = [];
  const envelope = identities.mint({ type: 3, message: { id: '123456789012345678' },
    data: { component_type: 2, custom_id: `sophie:shuttle:v1:${'a'.repeat(32)}:advance:1` } });
  const responder = createInteractionResponder({ verifier: identities.verifier, applicationId: APPLICATION, clock: () => NOW,
    enabled: () => true, fetch: async (url, options) => { calls.push({ url, options }); return Response.json({}); } });
  for (const status of ['shuttle_progress_recorded', 'shuttle_help_recorded', 'shuttle_help_paused']) await responder.respond(envelope, status);
  assert.equal(calls.length, 0);
  await responder.respond(envelope, 'shuttle_stale');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].url.endsWith('?wait=true')); assert.ok(!calls[0].url.includes('@original'));
  assert.equal(JSON.parse(calls[0].options.body).flags, 64);
});

test('T01 interaction replies use only verified tokens and static mention-suppressed responses', async () => {
  const interactions = syntheticInteractions();
  const envelope = interactions.mint();
  const calls = [];
  const responder = createInteractionResponder({ verifier: interactions.verifier, applicationId: APPLICATION, clock: () => NOW,
    enabled: () => true, fetch: async (url, options) => { calls.push({ url, options }); return new Response('{}', { status: 200 }); } });
  await responder.respond(envelope, 'recorded');
  assert.equal(Object.hasOwn(envelope, 'token'), false);
  assert.equal(calls[0].url, `https://discord.com/api/v10/webhooks/${APPLICATION}/synthetic-interaction-reply-token/messages/@original`);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.match(body.content, /Request recorded/);
  assert.doesNotMatch(body.content, /complete|successfully muted/);
  await assert.rejects(responder.respond({ ...envelope }, 'recorded'), /INTERACTION_REPLY_EXPIRED/);
  await assert.rejects(responder.respond(envelope, '@everyone'), /INTERACTION_RESPONSE_INVALID/);
});

test('T18 reply rate limits and expired tokens prevent subsequent HTTP calls', async () => {
  let now = NOW, count = 0;
  const interactions = syntheticInteractions({ clock: () => now });
  const envelope = interactions.mint();
  const responder = createInteractionResponder({ verifier: interactions.verifier, applicationId: APPLICATION, clock: () => now,
    enabled: () => true, fetch: async () => { count++; return new Response('{"retry_after":2.5}', { status: 429 }); } });
  await assert.rejects(responder.respond(envelope, 'recorded'), /INTERACTION_RESPONSE_RATE_LIMITED/);
  now += 2_000;
  await assert.rejects(responder.respond(envelope, 'recorded'), /INTERACTION_RESPONSE_RATE_LIMITED/);
  assert.equal(count, 1);
  now = NOW + 900_000;
  await assert.rejects(responder.respond(envelope, 'recorded'), /INTERACTION_REPLY_EXPIRED/);
  assert.equal(count, 1);
});

test('T24 reply errors never retain a URL, credential, response body or raw fetch failure', async () => {
  const interactions = syntheticInteractions();
  const envelope = interactions.mint();
  for (const fetch of [async () => { throw new Error('synthetic-sensitive-url'); },
    async () => new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } })]) {
    const responder = createInteractionResponder({ verifier: interactions.verifier, applicationId: APPLICATION, clock: () => NOW, enabled: () => true, fetch });
    await assert.rejects(responder.respond(envelope, 'recorded'), error => error.message === 'INTERACTION_RESPONSE_UNAVAILABLE' && error.cause === undefined);
  }
});
