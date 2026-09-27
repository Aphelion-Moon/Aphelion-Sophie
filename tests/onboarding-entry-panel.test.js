import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnboardingEntryPanel } from '../apps/core/discord/onboarding-entry-panel.js';
import { createSystemText } from '../contracts/system-messages.js';
import { GUILD, USER } from './fixtures/domain.js';

test('entry panel uses bounded saved wording with fixed self-service routing and no mentions', async () => {
  const panel = createOnboardingEntryPanel({ authorization: { resolveActor: async () => ({}), authorize: async () => true },
    transport: { getChannel: async id => ({ id, guild_id: GUILD, type: 0, parent_id: null }) },
    store: { hasCaseExclusion: async () => false }, policy: { guildId: GUILD, categoryId: USER }, definitionId: 'onboarding', enabled: () => true,
    readSystemText: async () => createSystemText({ 'onboarding.panel.title': 'Welcome aboard', 'onboarding.panel.body': 'Read our **guidance**.', 'onboarding.entry': 'Begin here' }) });
  const result = await panel.prepare({ command: 'shuttle.panel', guildId: GUILD, channelId: GUILD }, { isCurrent: () => true });
  assert.equal(result.embeds[0].title, 'Welcome aboard'); assert.equal(result.embeds[0].description, 'Read our **guidance**.');
  assert.equal(result.components[0].components[0].label, 'Begin here');
  assert.equal(result.components[0].components[0].custom_id, 'sophie:shuttle:start:1'); assert.deepEqual(result.allowed_mentions.parse, []);
});

test('panel preparation rejects revoked authority, protected destinations and expired initial responses', async () => {
  let allowed = true, excluded = false, live = true, reads = 0;
  const panel = createOnboardingEntryPanel({ authorization: { resolveActor: async () => ({}), authorize: async () => allowed },
    transport: { getChannel: async id => ({ id, guild_id: GUILD, type: 0, parent_id: null }) },
    store: { hasCaseExclusion: async () => excluded }, policy: { guildId: GUILD, categoryId: USER }, definitionId: 'onboarding', enabled: () => true,
    readSystemText: async () => { reads++; allowed = false; return createSystemText(); } });
  const prepare = () => panel.prepare({ command: 'shuttle.panel', guildId: GUILD, channelId: GUILD }, { isCurrent: () => live });
  await assert.rejects(prepare(), /OPERATION_DENIED/); assert.equal(reads, 1);
  allowed = true; excluded = true; await assert.rejects(prepare(), /OPERATION_DENIED/); assert.equal(reads, 1);
  excluded = false; live = false; await assert.rejects(prepare(), /OPERATION_DENIED/); assert.equal(reads, 1);
});
