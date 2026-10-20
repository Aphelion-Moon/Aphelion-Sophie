import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardingEntryControls, onboardingCommandDefinition, ONBOARDING_ENTRY_ID } from '../modules/onboarding/entry-controls.js';
import { createAdministrationCommands, createOnboardingCommands } from '../apps/core/discord/onboarding-commands.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { USER, OTHER, GUILD, definition } from './fixtures/domain.js';

test('Shuttle entry buttons and subcommands derive the member from the verified identity', () => {
  const signed = syntheticInteractions();
  const slash = signed.mint({ member: { user: { id: USER } }, data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } });
  const button = signed.mint({ type: 3, member: { user: { id: USER } }, message: { id: OTHER },
    data: { component_type: 2, custom_id: ONBOARDING_ENTRY_ID } });
  for (const proof of [slash, button]) {
    assert.equal(proof.command, 'shuttle.start'); assert.equal(proof.targetId, USER);
    assert.deepEqual(signed.verifier.resolvePrincipal(proof), { guildId: GUILD, userId: USER });
    assert.equal(Object.hasOwn(proof, 'message'), false);
    assert.throws(() => signed.verifier.resolvePrincipal({ ...proof }), /UNTRUSTED_PRINCIPAL/);
  }
  assert.equal(onboardingEntryControls()[0].components[0].custom_id, ONBOARDING_ENTRY_ID);
  assert.deepEqual(onboardingCommandDefinition().contexts, [0]);
  assert.equal(onboardingCommandDefinition().name, 'whitelist');
  assert.throws(() => signed.mint({ data: { type: 1, name: 'shuttle', options: [{ type: 1, name: 'start' }] } }),
    /INTERACTION_COMMAND_UNSUPPORTED/);
});

test('unrecognized components, selected values and caller-specified Shuttle targets are rejected', () => {
  const signed = syntheticInteractions();
  for (const data of [{ component_type: 3, custom_id: ONBOARDING_ENTRY_ID },
    { component_type: 2, custom_id: 'unrecognized' }, { component_type: 2, custom_id: ONBOARDING_ENTRY_ID, values: [] }]) {
    assert.throws(() => signed.mint({ type: 3, data, message: { id: OTHER } }), /INTERACTION_COMPONENT_UNSUPPORTED/);
  }
  for (const subcommand of [{ type: 1, name: 'start', value: USER },
    { type: 1, name: 'start', options: [{ type: 6, name: 'member', value: USER }] }, { type: 1, name: 'reset' }]) {
    assert.throws(() => signed.mint({ data: { type: 1, name: 'whitelist', options: [subcommand] } }), /INTERACTION_OPTIONS_INVALID/);
  }
});

test('administration routing is a closed union and Shuttle construction validates bounded configuration', async () => {
  const called = [];
  const router = createAdministrationCommands({ moderation: { execute: async e => { called.push(e.command); return 'recorded'; } },
    onboarding: { execute: async e => { called.push(e.command); return 'shuttle_recorded'; } } });
  assert.equal(await router.execute({ command: 'shuttle.start' }), 'shuttle_recorded');
  assert.equal(await router.execute({ command: 'mute' }), 'recorded');
  assert.equal(await router.execute({ command: 'shell' }), 'denied');
  assert.deepEqual(called, ['shuttle.start', 'mute']);
  assert.throws(() => createOnboardingCommands({ definitionId: definition.id,
    limits: { memberOpen: 1, guildPending: 0, cooldownMs: 1_000 }, enabled: () => false }), /INVALID_INTEGER/);
});

test('starting Whitelist before any guide is published says so instead of sending the member to Staff', async () => {
  const { ContractError } = await import('../contracts/validation.js');
  const commands = (code) => createOnboardingCommands({ definitionId: definition.id, limits: { memberOpen: 1, guildPending: 1, cooldownMs: 1_000 }, enabled: () => true,
    authorization: { resolveActor: async () => ({ guildId: GUILD, userId: USER }) }, discord: { guildId: GUILD, observe: async () => ({}) }, channels: {},
    store: { describeOnboardingEntryChannel: async () => null, openOnboarding: async () => { throw new ContractError(code); } } });
  const start = { command: 'shuttle.start', guildId: GUILD, userId: USER, targetId: USER, interactionId: '1' };
  assert.equal(await commands('DEFINITION_NOT_FOUND').execute(start), 'shuttle_unpublished');
  assert.equal(await commands('DEFINITION_WITHDRAWN').execute(start), 'shuttle_review');
});

test('a Shuttle command overtaken by Gateway traffic or a short cooldown is tried again, then asks the member to retry', async () => {
  const { ContractError } = await import('../contracts/validation.js');
  const limits = { memberOpen: 1, guildPending: 1, cooldownMs: 1_000 };
  const build = (failures, store = {}) => {
    const traces = [], pauses = [], calls = { restore: 0, release: [] };
    const commands = createOnboardingCommands({ definitionId: definition.id, limits, enabled: () => true,
      trace: code => traces.push(code), pause: async ms => { pauses.push(ms); },
      authorization: { resolveActor: async () => ({ guildId: GUILD, userId: USER }) },
      discord: { guildId: GUILD, observe: async () => { const next = failures.shift(); if (next) throw next; return {}; } },
      channels: { inspect: async () => ({}) },
      store: { describeOnboardingEntryChannel: async () => null, openOnboarding: async () => {},
        describeOnboardingControl: async () => ({ plan: {} }), actOnOnboarding: async () => {},
        restoreOnboardingControl: async () => { calls.restore++; throw new ContractError('OBSERVATION_INVALIDATED'); },
        releaseOnboardingControl: async value => { calls.release.push(value); return { restored: true }; }, ...store } });
    return { commands, traces, pauses, calls };
  };
  const start = { command: 'shuttle.start', guildId: GUILD, userId: USER, targetId: USER, interactionId: '1' };
  const click = { command: 'shuttle.control', action: 'advance', guildId: GUILD, userId: USER, targetId: USER, interactionId: '2',
    screenId: 'a'.repeat(32), channelId: OTHER, messageId: OTHER, controlVersion: 0 };
  // One overtaken read and one short cooldown: the command still records, waiting at most the reported cooldown.
  const busy = Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED', retryAfterMs: 700 });
  const retried = build([new ContractError('OBSERVATION_INVALIDATED'), busy]);
  assert.equal(await retried.commands.execute(click), 'shuttle_progress_recorded');
  assert.deepEqual(retried.pauses, [150, 700]);
  assert.deepEqual(retried.traces, ['SHUTTLE_COMMAND_RETRIED_OBSERVATION_INVALIDATED', 'SHUTTLE_COMMAND_RETRIED_RATE_LIMITED']);
  assert.equal(retried.calls.release.length, 0);
  // Still overtaken after every retry: the member is asked to try again, and the card is queued to be drawn again
  // without reading Discord once the normal restore cannot.
  const exhausted = build(Array.from({ length: 8 }, () => new ContractError('OBSERVATION_INVALIDATED')));
  assert.equal(await exhausted.commands.execute(click), 'shuttle_retry');
  assert.deepEqual(exhausted.pauses, [150, 400, 1_000]);
  assert.equal(exhausted.traces.at(-1), 'SHUTTLE_COMMAND_FAILED_OBSERVATION_INVALIDATED');
  assert.deepEqual(exhausted.calls.release, [{ guildId: GUILD, userId: USER, interactionId: '2', action: 'advance',
    screenId: click.screenId, channelId: OTHER, messageId: OTHER }]);
  // A start is retried the same way; a denial or an out-of-date card is final at once.
  assert.equal(await build([new ContractError('OBSERVATION_UNAVAILABLE')]).commands.execute(start), 'shuttle_recorded');
  const denied = build([], { actOnOnboarding: async () => { throw new ContractError('STALE_SHUTTLE_CONTROL'); } });
  assert.equal(await denied.commands.execute(click), 'shuttle_stale'); assert.deepEqual(denied.pauses, []);
  // A failure a retry cannot fix keeps the general reply; its code reaches the operator's trace.
  const odd = build([], { openOnboarding: async () => { throw new ContractError('SOMETHING_NEW'); } });
  assert.equal(await odd.commands.execute(start), 'unavailable'); assert.deepEqual(odd.traces, ['SHUTTLE_COMMAND_FAILED_SOMETHING_NEW']);
});
