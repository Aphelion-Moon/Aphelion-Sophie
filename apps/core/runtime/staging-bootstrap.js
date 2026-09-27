import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireKeys } from '../../../contracts/validation.js';
import { PERMISSIONS, guildPermissions } from '../../../platform/authorization/discord-permissions.js';
import { sameOverwrites } from '../../../modules/tickets/channel-policy.js';
import { STAGING_ROLE_KEYS, STAGING_BOT_PERMISSIONS, requireStagingMarker, stagingRolePayload, stagingChannelPayload } from '../discord/staging-resources.js';
import { registerStagingCommands } from '../discord/command-registration.js';
import { validateStagingRuntime } from './configuration.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateStagingSeed(seed) {
  requireKeys(seed, ['schemaVersion', 'environment', 'isolatedGuild', 'guildId', 'applicationId', 'publicKeyHex', 'ownerUserId',
    'dashboardOrigin', 'interactionPort', 'dashboardPort']);
  requireCondition(seed.schemaVersion === 1 && seed.environment === 'staging' && seed.isolatedGuild === true, 'ISOLATED_STAGING_REQUIRED');
  for (const key of ['guildId', 'applicationId', 'ownerUserId']) requireId(seed[key]);
  // Reuse the exact host contract without guessing live IDs.
  validateStagingRuntime(bootstrapConfiguration(seed, '9001', { crew: '9002', muzzled: '9003', whitelist: '9004', staff: '9005', leadOps: '9006', category: '9007' }));
}
export function stagingBootstrapPlan(seed) {
  validateStagingSeed(seed);
  return { environment: 'staging', guildId: seed.guildId, applicationId: seed.applicationId, writes: [
    'Create five distinct zero-permission Sophie Test roles.', 'Create a bot-private case category and a Crew/Staff/Head Admin test lobby.',
    `Assign the new Head Admin role only to verified guild owner ${seed.ownerUserId}.`, 'Upsert the five fixed Sophie guild commands, including public answer lookup.',
    'Write an ignored local runtime configuration and durable bootstrap receipt.' ],
  manual: ['Invite the test bot with the required permissions and enable privileged intents.', 'Provide the isolated database and HTTPS ingress.',
    'Configure interaction endpoint/OAuth redirect and publish synthetic guidance/forms.'], productionReady: false };
}
export function bootstrapConfiguration(seed, botUserId, ids) {
  const mapping = { guildId: seed.guildId, botUserId, ...Object.fromEntries(STAGING_ROLE_KEYS.map(key => [key, ids[key]])), externallyOwnedRoleIds: [] };
  return { schemaVersion: 1, environment: 'staging', isolatedGuild: true, applicationId: seed.applicationId, publicKeyHex: seed.publicKeyHex,
    mapping, capabilityPolicy: { guildId: seed.guildId, version: 1, staff: ids.staff, leadOps: ids.leadOps, muzzled: ids.muzzled,
      grants: { 'member.mute': [ids.staff, ids.leadOps], 'member.unmute': [ids.staff, ids.leadOps], 'shuttle.publish': [ids.leadOps],
        'case.registry': [ids.leadOps], 'case.forms.publish': [ids.leadOps] } },
    casePolicy: { guildId: seed.guildId, botUserId, staff: ids.staff, leadOps: ids.leadOps, categoryId: ids.category, version: 1, attachmentsAllowed: false },
    limits: { memberOpen: 2, guildPending: 20, cooldownMs: 10000 }, definitionId: 'shuttle-v1', captureEnabled: true,
    interactionPort: seed.interactionPort, dashboardPort: seed.dashboardPort, workerIntervalMs: 1000,
    exportPolicy: { version: 1, enabled: true, audience: 'current-readers', maxObservations: 100, maxGaps: 200, maxBytes: 2_097_152 },
    dashboard: seed.dashboardOrigin === null ? null : { guildId: seed.guildId, applicationId: seed.applicationId, version: 1, origin: seed.dashboardOrigin } };
}

/** Explicit setup only. Durable started markers prevent blindly repeating ambiguous creates. */
export function createStagingBootstrap({ seed, transport, journal }) {
  validateStagingSeed(seed); const fixed = structuredClone(seed), seedHash = digest(fixed);
  async function context(botUserId) {
    const guild = await transport.getGuild(), roles = await transport.getRoles(), bot = await transport.getMember(botUserId);
    requireCondition(guild.id === fixed.guildId && guild.owner_id === fixed.ownerUserId && bot?.user?.id === botUserId && bot.user.bot === true &&
      Array.isArray(bot.roles) && (bot.communication_disabled_until === null || bot.communication_disabled_until === undefined), 'STAGING_BOOTSTRAP_AUTHORITY_INVALID');
    const permissions = guildPermissions({ guildId: fixed.guildId, userId: botUserId, ownerId: guild.owner_id, roleIds: bot.roles,
      roles: roles.map(role => ({ id: role.id, permissions: role.permissions })) });
    requireCondition((permissions & STAGING_BOT_PERMISSIONS) === STAGING_BOT_PERMISSIONS && (permissions & PERMISSIONS.administrator) === 0n, 'STAGING_BOOTSTRAP_PERMISSIONS_REQUIRED');
    const position = Math.max(0, ...roles.filter(role => bot.roles.includes(role.id)).map(role => role.position));
    requireCondition(Number.isSafeInteger(position) && position > 0, 'ROLE_HIERARCHY_BLOCKED');
    return { roles, position };
  }
  function verifyRole(role, key, marker, position) {
    requireId(role?.id); const expected = stagingRolePayload(key, marker);
    requireCondition(role.managed === false && role.permissions === '0' && role.name === expected.name &&
      role.hoist === false && role.mentionable === expected.mentionable, 'STAGING_BOOTSTRAP_RESOURCE_CHANGED');
    // Keep the runtime's conservative numeric hierarchy rule, including tied positions.
    requireCondition(Number.isSafeInteger(role.position) && role.position >= 0 && role.position < position, 'ROLE_HIERARCHY_BLOCKED');
  }
  return Object.freeze({ async apply(confirmGuildId) {
    requireCondition(confirmGuildId === fixed.guildId && transport.guildId === fixed.guildId, 'STAGING_BOOTSTRAP_CONFIRMATION_REQUIRED');
    const identity = await transport.getCurrentUser(), application = await transport.getCurrentApplication(); requireId(identity?.id);
    requireCondition(identity.bot === true && application?.id === fixed.applicationId, 'GATEWAY_IDENTITY_MISMATCH');
    let state = await journal.read();
    requireKeys(state, ['schemaVersion', 'seedHash', 'marker', 'botUserId', 'steps']); requireStagingMarker(state.marker);
    requireCondition(state.schemaVersion === 1 && state.seedHash === seedHash && (state.botUserId === null || state.botUserId === identity.id), 'STAGING_BOOTSTRAP_RECEIPT_MISMATCH');
    requireKeys(state.steps, [...STAGING_ROLE_KEYS, 'category', 'lobby', 'owner', 'commands']);
    state = structuredClone(state); state.botUserId = identity.id; await journal.save(state);
    const ids = {};
    for (const key of STAGING_ROLE_KEYS) {
      const current = await context(identity.id), step = state.steps[key];
      if (step !== null) {
        requireCondition(['observed', 'confirmed'].includes(step.status), 'STAGING_BOOTSTRAP_UNCERTAIN');
        verifyRole(current.roles.find(role => role.id === step.id), key, state.marker, current.position); ids[key] = step.id;
        state.steps[key] = { status: 'confirmed', id: step.id }; await journal.save(state); continue;
      }
      state.steps[key] = { status: 'started' }; await journal.save(state);
      let role;
      try { role = await transport.createStagingRole(key, state.marker); }
      catch (error) {
        if (['RATE_LIMITED', 'DISCORD_BUSY', 'DISCORD_AUTHORIZATION_FAILED', 'DISCORD_TRANSPORT_DISABLED'].includes(error.code)) {
          state.steps[key] = null; await journal.save(state);
        }
        throw error;
      }
      requireId(role?.id); state.steps[key] = { status: 'observed', id: role.id }; await journal.save(state);
      const fresh = await context(identity.id); verifyRole(fresh.roles.find(candidate => candidate.id === role.id), key, state.marker, fresh.position);
      ids[key] = role.id; state.steps[key] = { status: 'confirmed', id: role.id }; await journal.save(state);
    }
    for (const key of ['category', 'lobby']) {
      await context(identity.id); const step = state.steps[key];
      requireCondition(step === null || ['observed', 'confirmed'].includes(step.status), 'STAGING_BOOTSTRAP_UNCERTAIN');
      if (step === null) { state.steps[key] = { status: 'started' }; await journal.save(state); }
      let channel;
      try { channel = step === null ? await transport.createStagingChannel(key, state.marker, identity.id, ids) : await transport.getChannel(step.id); }
      catch (error) {
        if (step === null && ['RATE_LIMITED', 'DISCORD_BUSY', 'DISCORD_AUTHORIZATION_FAILED', 'DISCORD_TRANSPORT_DISABLED'].includes(error.code)) {
          state.steps[key] = null; await journal.save(state);
        }
        throw error;
      }
      requireId(channel?.id); const expected = stagingChannelPayload(key, state.marker, fixed.guildId, identity.id, ids);
      state.steps[key] = { status: 'observed', id: channel.id }; await journal.save(state);
      const fresh = await transport.getChannel(channel.id);
      requireCondition(fresh?.guild_id === fixed.guildId && fresh.type === expected.type && fresh.name === expected.name &&
        fresh.parent_id === null && sameOverwrites(fresh.permission_overwrites, expected.permission_overwrites), 'STAGING_BOOTSTRAP_RESOURCE_CHANGED');
      ids[key] = channel.id; state.steps[key] = { status: 'confirmed', id: channel.id }; await journal.save(state);
    }
    const current = await context(identity.id);
    for (const key of STAGING_ROLE_KEYS) verifyRole(current.roles.find(role => role.id === ids[key]), key, state.marker, current.position);
    const owner = await transport.getMember(fixed.ownerUserId);
    requireCondition(owner?.user?.id === fixed.ownerUserId && owner.user.bot !== true && Array.isArray(owner.roles), 'STAGING_BOOTSTRAP_AUTHORITY_INVALID');
    if (!owner.roles.includes(ids.leadOps)) {
      state.steps.owner = { status: 'started' }; await journal.save(state);
      await transport.changeMemberRole(fixed.ownerUserId, ids.leadOps, true);
      requireCondition((await transport.getMember(fixed.ownerUserId))?.roles?.includes(ids.leadOps), 'STAGING_BOOTSTRAP_UNCERTAIN');
    }
    state.steps.owner = { status: 'confirmed', id: fixed.ownerUserId }; await journal.save(state);
    state.steps.commands = { status: 'started' }; await journal.save(state);
    await registerStagingCommands({ transport, applicationId: fixed.applicationId, botUserId: identity.id, confirmGuildId });
    state.steps.commands = { status: 'confirmed' }; await journal.save(state);
    const configuration = bootstrapConfiguration(fixed, identity.id, ids); validateStagingRuntime(configuration);
    return { configuration, lobbyId: ids.lobby };
  } });
}

export function newStagingBootstrapReceipt(seed, marker) {
  validateStagingSeed(seed); requireStagingMarker(marker);
  return { schemaVersion: 1, seedHash: digest(seed), marker, botUserId: null,
    steps: Object.fromEntries([...STAGING_ROLE_KEYS, 'category', 'lobby', 'owner', 'commands'].map(key => [key, null])) };
}
