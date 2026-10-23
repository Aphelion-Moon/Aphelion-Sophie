import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeScope, validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { productionConfiguration } from '../apps/core/runtime/production-configuration.js';
import { createDiscordTransport, activityAiWriteAllowed } from '../apps/core/discord/transport.js';
import { registerStagingCommands, activityAiCommandDefinitions } from '../apps/core/discord/command-registration.js';
import { createOnboardingEntryPanel } from '../apps/core/discord/onboarding-entry-panel.js';
import { createSystemText } from '../contracts/system-messages.js';
import { requireStagingDatabase } from '../apps/core/runtime/database.js';

const ids = n => `1${String(n).padStart(17, '0')}`;
const input = (change = {}) => ({ guildId: ids(1), applicationId: ids(2), publicKeyHex: 'a'.repeat(64), botUserId: ids(3),
  roles: { crew: ids(4), muzzled: ids(5), whitelist: ids(6), staff: ids(7), leadOps: ids(8) }, protectedCategoryId: ids(9),
  dashboardOrigin: 'https://sophie.example.test', activityOrigin: 'https://onboarding.example.test', interactionPort: 38121, dashboardPort: 38122, activityPort: 38125, ...change });

test('production is only Activity and AI: no capture, automation or case export, and never an isolated-guild claim', () => {
  const configuration = productionConfiguration(input());
  assert.equal(runtimeScope(configuration), 'activity-ai'); assert.equal(configuration.activity.status, 'testing');
  assert.deepEqual(configuration.capabilityPolicy.grants['ai.control'], [ids(8)], 'Lead Ops holds the AI controls and the tester gate');
  for (const change of [{ scope: 'full' }, { isolatedGuild: true }, { captureEnabled: true }, { automationEnabled: true },
    { exportPolicy: { ...configuration.exportPolicy, enabled: true } }]) assert.throws(() => validateStagingRuntime({ ...configuration, ...change }));
  const { scope: _scope, ...withoutScope } = configuration;
  assert.throws(() => validateStagingRuntime(withoutScope));
  assert.throws(() => validateStagingRuntime({ ...configuration, environment: 'staging' }), 'staging still means an isolated guild without a scope');
  assert.equal(runtimeScope({ environment: 'staging' }), 'full');
  assert.throws(() => productionConfiguration(input({ roles: { ...input().roles, crew: ids(5) } })), /INVALID_ROLE_OWNERSHIP/);
  assert.throws(() => productionConfiguration(input({ protectedCategoryId: 'support' })));
  // Tester roles beside Lead Ops (owner decision, 24 October 2026: Staff); never Muzzled or @everyone.
  assert.equal(Object.hasOwn(configuration.capabilityPolicy.grants, 'shuttle.activity.test'), false);
  const staffTest = productionConfiguration(input({ activityTesterRoles: [ids(7)] }));
  assert.deepEqual(staffTest.capabilityPolicy.grants['shuttle.activity.test'], [ids(7)]); validateStagingRuntime(staffTest);
  for (const roles of [[ids(5)], [ids(1)], [ids(7), ids(7)], ['staff']]) assert.throws(() => productionConfiguration(input({ activityTesterRoles: roles })), JSON.stringify(roles));
});

test('in production the Discord transport refuses every role, channel and permission write before it leaves', async () => {
  const calls = [];
  const transport = createDiscordTransport({ guildId: ids(1), token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    fetch: async (url, init) => { calls.push([init.method, new URL(url).pathname]); return Response.json({ id: ids(10), channel_id: ids(11) }); } });
  for (const add of [true, false]) await assert.rejects(transport.changeMemberRole(ids(12), ids(4), add), /DISCORD_SCOPE_REFUSED/);
  assert.deepEqual(calls, [], 'a member role write never reaches fetch');
  await transport.createTicketDm(ids(12));
  assert.deepEqual(calls, [['POST', '/api/v10/users/@me/channels']], 'an allowed write still goes out');
  for (const [method, path, allowed] of [['PUT', `/guilds/${ids(1)}/members/${ids(12)}/roles/${ids(4)}`, false], ['DELETE', `/guilds/${ids(1)}/members/${ids(12)}/roles/${ids(6)}`, false],
    ['PATCH', `/guilds/${ids(1)}/members/${ids(12)}`, false], ['PUT', `/channels/${ids(11)}/permissions/${ids(4)}`, false], ['POST', `/guilds/${ids(1)}/channels`, false],
    ['PATCH', `/channels/${ids(11)}`, false], ['PUT', `/guilds/${ids(1)}/bans/${ids(12)}`, false], ['POST', `/channels/${ids(11)}/messages`, true],
    ['DELETE', `/channels/${ids(11)}/messages/${ids(13)}`, true], ['PUT', `/channels/${ids(11)}/messages/${ids(13)}/reactions/%F0%9F%8E%89/@me`, true],
    ['POST', '/users/@me/channels', true], ['POST', `/applications/${ids(2)}/guilds/${ids(1)}/commands`, true], ['GET', `/guilds/${ids(1)}/roles`, true]])
    assert.equal(activityAiWriteAllowed(method, path), allowed, `${method} ${path}`);
});

test('in production the administration lane may add the Whitelist role and nothing else (owner decision, 24 October 2026)', async () => {
  const calls = [];
  const transport = createDiscordTransport({ guildId: ids(1), token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    grantRoleIds: [ids(6)], fetch: async (url, init) => { calls.push([init.method, new URL(url).pathname]); return new Response(null, { status: 204 }); } });
  await transport.changeMemberRole(ids(12), ids(6), true);
  assert.deepEqual(calls, [['PUT', `/api/v10/guilds/${ids(1)}/members/${ids(12)}/roles/${ids(6)}`]]);
  await assert.rejects(transport.changeMemberRole(ids(12), ids(6), false), /DISCORD_SCOPE_REFUSED/, 'never removes Whitelist');
  for (const role of [ids(4), ids(5), ids(7), ids(8)]) await assert.rejects(transport.changeMemberRole(ids(12), role, true), /DISCORD_SCOPE_REFUSED/, `never adds ${role}`);
  assert.equal(calls.length, 1);
  assert.equal(activityAiWriteAllowed('PUT', `/guilds/${ids(1)}/members/${ids(12)}/roles/${ids(6)}`), false, 'without the grant list nothing is added');
  assert.throws(() => createDiscordTransport({ guildId: ids(1), token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true,
    scope: 'activity-ai', grantRoleIds: [ids(6), ids(4)], fetch }), /TRUSTED_ADAPTERS_REQUIRED/, 'one grantable role at most');
});

test('production registers only /sophie, /lookup and /whitelist post', async () => {
  const names = [], definitions = [];
  const transport = { guildId: ids(1), getCurrentUser: async () => ({ id: ids(3), bot: true }), getCurrentApplication: async () => ({ id: ids(2) }),
    upsertGuildCommand: async (_application, definition) => { names.push(definition.name); definitions.push(definition); return { id: ids(20), name: definition.name, type: 1, application_id: ids(2), guild_id: ids(1) }; } };
  await registerStagingCommands({ transport, applicationId: ids(2), botUserId: ids(3), confirmGuildId: ids(1), scope: 'activity-ai' });
  assert.deepEqual([...names].sort(), ['lookup', 'sophie', 'whitelist']);
  // Only the launch post: no start, panel, close or queue in production.
  assert.deepEqual(definitions.find(item => item.name === 'whitelist').options.map(option => option.name), ['post']);
  assert.deepEqual(activityAiCommandDefinitions().map(item => item.name).sort(), ['lookup', 'sophie', 'whitelist']);
  await assert.rejects(registerStagingCommands({ transport, applicationId: ids(2), botUserId: ids(3), confirmGuildId: ids(1), scope: 'everything' }), /COMMAND_REGISTRATION_SCOPE_INVALID/);
});

test('production posts the Activity launch post for Lead Ops and refuses the Onboarding-channel entry panel', async () => {
  let allowed = true;
  const panel = createOnboardingEntryPanel({ authorization: { resolveActor: async () => ({}), authorize: async capability => capability === 'shuttle.publish' && allowed },
    transport: { getChannel: async id => ({ id, guild_id: ids(1), type: 0, parent_id: null }) }, store: { hasCaseExclusion: async () => false },
    policy: { guildId: ids(1), categoryId: ids(9) }, definitionId: 'onboarding', enabled: () => true, readSystemText: async () => createSystemText(), commands: ['shuttle.post'] });
  const post = await panel.prepare({ command: 'shuttle.post', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true });
  assert.equal(post.components[0].components[0].custom_id, 'sophie:shuttle:activity:1');
  await assert.rejects(panel.prepare({ command: 'shuttle.panel', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true }), /OPERATION_DENIED/);
  allowed = false;
  await assert.rejects(panel.prepare({ command: 'shuttle.post', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true }), /OPERATION_DENIED/, 'only Lead Ops (shuttle.publish) may post');
  assert.throws(() => createOnboardingEntryPanel({ commands: ['shuttle.start'] }), /TRUSTED_ADAPTERS_REQUIRED/);
});

test('a production database and its identities share the sophie_prod_ prefix, on this host only', () => {
  requireStagingDatabase({ host: '127.0.0.1', database: 'sophie_prod_main', user: 'sophie_prod_core' });
  requireStagingDatabase({ host: '127.0.0.1', database: 'sophie_stage_main', user: 'sophie_stage_core' });
  for (const value of [{ host: '127.0.0.1', database: 'sophie_prod_main', user: 'sophie_stage_core' }, { host: '10.0.0.5', database: 'sophie_prod_main', user: 'sophie_prod_core' },
    { host: '127.0.0.1', database: 'postgres', user: 'sophie_prod_core' }]) assert.throws(() => requireStagingDatabase(value), /ISOLATED_STAGING_DATABASE_REQUIRED/);
});
