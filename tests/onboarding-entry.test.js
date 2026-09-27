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
