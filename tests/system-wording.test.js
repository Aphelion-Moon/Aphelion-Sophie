import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_MESSAGES, canonicalSystemWording, createSystemText, defaultSystemText } from '../contracts/system-messages.js';
import { renderOnboardingScreen } from '../modules/onboarding/screens.js';
import { publication, started } from './fixtures/domain.js';
import { createSystemWordingHttp } from '../apps/core/http/system-wording.js';

test('the wording catalogue has unique presentation keys and every default can be restored', () => {
  assert.equal(new Set(SYSTEM_MESSAGES.map(entry => entry.id)).size, SYSTEM_MESSAGES.length);
  assert.deepEqual(canonicalSystemWording(Object.fromEntries(SYSTEM_MESSAGES.map(entry => [entry.id, entry.source]))), {});
  assert.ok(SYSTEM_MESSAGES.every(entry => !/^[a-z][a-zA-Z0-9_]+$/.test(entry.source)));
});
test('wording accepts bounded copy, preserves placeholders and cannot add routing or authority fields', () => {
  const custom = createSystemText({ 'onboarding.next': 'Turn the page', 'onboarding.step': '{title} · Step {step}/{total}' });
  assert.equal(custom('onboarding.next'), 'Turn the page');
  assert.equal(custom('onboarding.step', { title: 'Welcome', step: 1, total: 2 }), 'Welcome · Step 1/2');
  for (const override of [{ unknown: 'No' }, { 'onboarding.next': '' }, { 'onboarding.next': 'x'.repeat(41) },
    { 'onboarding.step': 'Missing {title}' }, { 'tickets.contacts.open_contact_07e561': 'x'.repeat(79) + '{value}' }, { 'onboarding.next': '{code}' }, { 'onboarding.next': '\u0000' }]) assert.throws(() => createSystemText(override));
  assert.throws(() => custom('onboarding.step', { title: 'Welcome', step: 1, total: 2, url: 'bad' }));
});
test('custom onboarding wording preserves authored copy, control identity, buttons and mention suppression', () => {
  const input = { screenId: 'a'.repeat(32), session: started(), publication, controlVersion: 6 };
  const before = renderOnboardingScreen(input), after = renderOnboardingScreen(input, createSystemText({ 'onboarding.continue': 'I understand' }));
  assert.equal(after.components[0].components[0].label, 'I understand');
  assert.equal(before.components[0].components[0].custom_id, after.components[0].components[0].custom_id);
  assert.deepEqual(before.embeds, after.embeds); assert.deepEqual(after.allowed_mentions, { parse: [] });
  assert.equal(defaultSystemText('onboarding.continue'), 'Continue');
});
test('wording HTTP verifies authentication and rejects supplied authority and query fields', async () => {
  const actor = {}, proof = {}; let calls = 0;
  const http = createSystemWordingHttp({ auth: { authenticate: async () => ({ proof }) },
    authorization: { resolveActor: async value => { assert.equal(value, proof); return actor; } },
    store: { read: async value => { assert.equal(value.actor, actor); calls++; return {}; }, save: async () => { calls++; } } });
  await http.execute({ path: '/api/system-wording', method: 'GET', query: new URLSearchParams(), body: null, credentials: {} });
  await assert.rejects(http.execute({ path: '/api/system-wording/save', method: 'POST', query: new URLSearchParams(), body: { actor, requestId: 'a'.repeat(64), expectedRevision: 0, wording: {} }, credentials: {} }));
  await assert.rejects(http.execute({ path: '/api/system-wording', method: 'GET', query: new URLSearchParams('guildId=123'), body: null, credentials: {} }));
  assert.equal(calls, 1);
});
