import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOnboardingHelpControl, onboardingHelpQueueReply } from '../modules/onboarding/assistance.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { GUILD, USER, OTHER } from './fixtures/domain.js';

test('signed assistance controls preserve bounded routing data without trusting role arrays or target claims', () => {
  const identities = syntheticInteractions();
  const queue = identities.mint({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'queue' }] } });
  assert.equal(queue.command, 'shuttle.queue'); assert.equal(queue.after, null);
  const control = `sophie:shuttle-help:v1:resolve:${USER}:0`;
  const resolve = identities.mint({ type: 3, message: { id: OTHER }, data: { component_type: 2, custom_id: control } });
  assert.equal(resolve.command, 'shuttle.help.resolve'); assert.equal(resolve.requestId, USER);
  assert.equal(resolve.expectedRevision, 0); assert.equal(resolve.userId, OTHER); assert.equal(resolve.targetId, OTHER);
  assert.equal(Object.hasOwn(resolve, 'message'), false); assert.equal(Object.hasOwn(resolve, 'roles'), false);
  assert.throws(() => identities.verifier.resolvePrincipal({ ...resolve }), /UNTRUSTED_PRINCIPAL/);
  for (const value of [`sophie:shuttle-help:v1:resolve:${USER}:00`, `sophie:shuttle-help:v1:resolve:${USER}:2147483647`,
    `sophie:shuttle-help:v1:resolve:${USER}:-1`, 'sophie:shuttle-help:v1:queue:-1', 'sophie:shuttle-help:v1:delete:all:0']) {
    assert.throws(() => parseOnboardingHelpControl(value));
  }
  assert.deepEqual(parseOnboardingHelpControl(`sophie:shuttle-help:v1:queue:${USER}`), { command: 'shuttle.queue', after: USER });
});

test('assistance presentation is bounded metadata with explicit per-request controls and pagination', () => {
  const entries = Array.from({ length: 5 }, (_, index) => ({ requestId: String(BigInt(USER) + BigInt(index)), userId: USER,
    revision: 0, channelId: OTHER, caseState: 'open', paused: false }));
  const view = { state: 'ready', guildId: GUILD, entries, next: entries.at(-1).requestId };
  const body = onboardingHelpQueueReply(view);
  assert.equal(body.embeds.length, 5); assert.equal(body.components[0].components.length, 5);
  assert.equal(body.components[1].components.length, 2);
  for (let index = 0; index < 5; index++) {
    assert.equal(parseOnboardingHelpControl(body.components[0].components[index].custom_id).requestId, entries[index].requestId);
  }
  assert.equal(parseOnboardingHelpControl(body.components[1].components[1].custom_id).after, view.next);
  assert.equal(onboardingHelpQueueReply({ ...view, entries: [], next: null }).embeds.length, 0);
  for (const state of ['denied', 'disabled', 'unavailable']) assert.deepEqual(onboardingHelpQueueReply({ state }).embeds, []);
  for (const invalid of [{ ...view, entries: [...entries, entries[0]] }, { ...view, entries: [entries[0], entries[0]], next: null },
    { ...view, next: '999' }, { ...view, entries: [{ ...entries[0], userId: '@everyone' }], next: null },
    { ...view, transcript: 'unsupported' }]) assert.throws(() => onboardingHelpQueueReply(invalid));
});

test('the command router requires an explicitly injected assistance adapter for its closed staff routes', async () => {
  const called = [], router = createAdministrationCommands({ assistance: { execute: async envelope => {
    called.push(envelope.command); return 'shuttle_help_resolved';
  } } });
  assert.equal(await router.execute({ command: 'shuttle.queue' }), 'shuttle_help_resolved');
  assert.equal(await router.execute({ command: 'shuttle.help.resolve' }), 'shuttle_help_resolved');
  assert.equal(await router.execute({ command: 'shuttle.help.delete' }), 'denied');
  assert.deepEqual(called, ['shuttle.queue', 'shuttle.help.resolve']);
  assert.equal(await createAdministrationCommands({}).execute({ command: 'shuttle.queue' }), 'denied');
});
