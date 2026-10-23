import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeScope, validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { productionConfiguration } from '../apps/core/runtime/production-configuration.js';
import { createDiscordTransport, activityAiWriteAllowed } from '../apps/core/discord/transport.js';
import { registerStagingCommands, activityAiCommandDefinitions } from '../apps/core/discord/command-registration.js';
import { createOnboardingEntryPanel } from '../apps/core/discord/onboarding-entry-panel.js';
import { createSystemText } from '../contracts/system-messages.js';
import { activityLaunchPost } from '../modules/onboarding/activity-post.js';
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

test('in production the rules post goes out as Sophie\'s own Components V2 message, and nothing else rides on it', async () => {
  const calls = [];
  const transport = createDiscordTransport({ guildId: ids(1), token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    fetch: async (url, init) => { calls.push([init.method, new URL(url).pathname, JSON.parse(init.body)]); return Response.json({ id: ids(30), channel_id: ids(11) }); } });
  const post = activityLaunchPost();
  await transport.createActivityPost(ids(11), 'a'.repeat(24), post);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), ['POST', `/api/v10/channels/${ids(11)}/messages`]);
  assert.deepEqual(calls[0][2], { ...post, nonce: 'a'.repeat(24), enforce_nonce: true });
  for (const body of [{ ...post, content: 'hi' }, { ...post, embeds: [] }, { ...post, flags: 0 }, { ...post, allowed_mentions: { parse: ['everyone'] } }, { ...post, allowed_mentions: { ...post.allowed_mentions, users: [ids(12)] } }, { ...post, allowed_mentions: { ...post.allowed_mentions, roles: [ids(4)] } }, { ...post, allowed_mentions: { ...post.allowed_mentions, replied_user: true } }, { ...post, components: [] }])
    await assert.rejects(transport.createActivityPost(ids(11), 'a'.repeat(24), body), /INVALID_DISCORD_PAYLOAD/);
  await assert.rejects(transport.createActivityPost(ids(11), 'not-a-nonce', post), /INVALID_DISCORD_PAYLOAD/);
  assert.equal(calls.length, 1);
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

test('production posts the Activity launch post for Lead Ops as Sophie\'s own message and refuses the Onboarding-channel entry panel', async () => {
  let allowed = true, refuse = false, directoryDown = false;
  const sent = [];
  const panel = createOnboardingEntryPanel({ authorization: { resolveActor: async () => ({}), authorize: async capability => capability === 'shuttle.publish' && allowed },
    transport: { getChannel: async id => ({ id, guild_id: ids(1), type: 0, parent_id: null }),
      getGuildChannels: async () => { if (directoryDown) throw new Error('DISCORD_BUSY'); return [{ id: ids(41), name: 'crew-support', type: 0 }, { id: ids(42), name: 'open-a-ticket', type: 0 }]; },
      getRoles: async () => [], getGuild: async () => ({ id: ids(1), emojis: [{ id: ids(43), name: 'protopop', animated: false }] }),
      createActivityPost: async (channelId, nonce, body) => { if (refuse) throw Object.assign(new Error('DISCORD_FORBIDDEN'), { code: 'DISCORD_FORBIDDEN' }); sent.push({ channelId, nonce, body }); return { id: ids(30) }; } },
    store: { hasCaseExclusion: async () => false }, nonce: () => 'f'.repeat(24),
    policy: { guildId: ids(1), categoryId: ids(9) }, definitionId: 'onboarding', enabled: () => true, readSystemText: async () => createSystemText(), commands: ['shuttle.post'] });
  // The post goes into the channel as a message (no "used /whitelist post" line); the command gets a private answer.
  const reply = await panel.prepare({ command: 'shuttle.post', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true });
  assert.deepEqual(reply, { content: "Posted. The Shuttle's boarding call is up in this channel.", flags: 64, allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } });
  assert.equal(sent.length, 1); assert.equal(sent[0].channelId, ids(11)); assert.equal(sent[0].body.flags, 1 << 15);
  assert.equal(sent[0].body.components[0].components.find(item => item.type === 9).accessory.custom_id, 'sophie:shuttle:activity:1');
  // The wording's channels and emoji link to this server's own; nobody is notified.
  assert.match(JSON.stringify(sent[0].body), new RegExp(`<:protopop:${ids(43)}>[\\s\\S]*<#${ids(41)}>[\\s\\S]*<#${ids(42)}>`));
  assert.deepEqual(sent[0].body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  // Directory unreadable: the post still goes, with plain names.
  directoryDown = true;
  await panel.prepare({ command: 'shuttle.post', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true });
  assert.equal(sent.length, 2); assert.doesNotMatch(JSON.stringify(sent[1].body), /<#|<:/); assert.match(JSON.stringify(sent[1].body), /#crew-support/);
  sent.pop(); directoryDown = false;
  // Discord refuses (no access to the channel): reported privately, never retried.
  refuse = true;
  const refused = await panel.prepare({ command: 'shuttle.post', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true });
  assert.equal(refused.flags, 64); assert.match(refused.content, /couldn't post here/); assert.equal(sent.length, 1);
  refuse = false;
  await assert.rejects(panel.prepare({ command: 'shuttle.panel', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true }), /OPERATION_DENIED/);
  allowed = false;
  await assert.rejects(panel.prepare({ command: 'shuttle.post', guildId: ids(1), channelId: ids(11) }, { isCurrent: () => true }), /OPERATION_DENIED/, 'only Lead Ops (shuttle.publish) may post');
  assert.equal(sent.length, 1, 'nothing is posted without the authority');
  assert.throws(() => createOnboardingEntryPanel({ commands: ['shuttle.start'] }), /TRUSTED_ADAPTERS_REQUIRED/);
});

test('a production database and its identities share the sophie_prod_ prefix, on this host only', () => {
  requireStagingDatabase({ host: '127.0.0.1', database: 'sophie_prod_main', user: 'sophie_prod_core' });
  requireStagingDatabase({ host: '127.0.0.1', database: 'sophie_stage_main', user: 'sophie_stage_core' });
  for (const value of [{ host: '127.0.0.1', database: 'sophie_prod_main', user: 'sophie_stage_core' }, { host: '10.0.0.5', database: 'sophie_prod_main', user: 'sophie_prod_core' },
    { host: '127.0.0.1', database: 'postgres', user: 'sophie_prod_core' }]) assert.throws(() => requireStagingDatabase(value), /ISOLATED_STAGING_DATABASE_REQUIRED/);
});
