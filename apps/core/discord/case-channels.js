import { requireCondition, requireFreshObservation, requireId, requireInteger } from '../../../contracts/validation.js';
import { validateRoleContext, validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { CASE_CHANNEL_BITS, CASE_CLOSED_WRITE_BITS, caseChannelMode, validateCasePolicy, validateCasePlan, caseChannelPayload, caseMarker, requireCaseChannel, casePlanKey, caseIdentityKey } from '../../../modules/tickets/channel-policy.js';
import { PERMISSIONS, channelPermissions, guildPermissions, validateOverwrites } from '../../../platform/authorization/discord-permissions.js';

/** Explicit metadata projection: never retain arbitrary channel topics or names. */
export function projectChannelMetadata(raw, expectedGuildId, fromGuildRoute = false) {
  requireCondition(raw !== null && typeof raw === 'object', 'CASE_CHANNEL_MISSING');
  const guildId = raw.guild_id ?? (fromGuildRoute ? expectedGuildId : null);
  requireId(raw.id); requireId(guildId);
  requireCondition(guildId === expectedGuildId, 'FOREIGN_GUILD'); requireInteger(raw.type, 0, 16);
  const parentId = raw.parent_id ?? null; if (parentId !== null) requireId(parentId);
  requireCondition(Array.isArray(raw.permission_overwrites), 'DISCORD_RESPONSE_INVALID');
  const overwrites = raw.permission_overwrites.map(entry => ({ id: entry?.id, type: entry?.type, allow: entry?.allow, deny: entry?.deny }));
  validateOverwrites(overwrites);
  return Object.freeze({ id: raw.id, guildId, type: raw.type, parentId,
    marker: typeof raw.topic === 'string' && /^sophie:case:v1:[a-f0-9]{48}$/.test(raw.topic) ? raw.topic : null,
    overwrites: Object.freeze(overwrites.map(Object.freeze)) });
}

/** Case metadata stays in core. This adapter has no message, attachment or AI method. */
export function createCaseChannels({ transport, roles, mapping, policy, clock, authorizeCaseParticipant = async () => false }) {
  validateRoleMapping(mapping); validateCasePolicy(policy);
  requireCondition(policy.guildId === transport.guildId && policy.guildId === roles.guildId &&
    ['guildId', 'botUserId', 'staff', 'leadOps'].every(key => policy[key] === mapping[key]), 'CASE_CONFIGURATION_INVALID');
  const fixed = structuredClone(policy);
  const roleMapping = structuredClone(mapping);
  const prepared = new WeakMap(), observed = new WeakMap();
  const key = casePlanKey;
  async function currentAudience(plan) {
    for (const grant of plan.audience?.participants ?? []) requireCondition(await authorizeCaseParticipant(grant) === true, 'CASE_AUDIENCE_CHANGED');
  }
  const project = (raw, fromGuildRoute = false) => projectChannelMetadata(raw, fixed.guildId, fromGuildRoute);
  async function certify(raw, plan, observedAt, version, fromGuildRoute = false) {
    const channel = project(raw, fromGuildRoute);
    requireCondition(channel.guildId === plan.guildId && channel.type === 0 && channel.marker === caseMarker(plan), 'CASE_CHANNEL_MISMATCH');
    requireFreshObservation({ known: true, observedAt }, clock());
    requireCondition(await roles.readContinuity() === version, 'OBSERVATION_INVALIDATED');
    requireFreshObservation({ known: true, observedAt }, clock());
    const proof = Object.freeze({ channelId: channel.id });
    observed.set(proof, { channel, planKey: key(plan), identityKey: caseIdentityKey(plan), known: true, observedAt, version });
    return proof;
  }
  async function candidate(proof, plan) {
    const record = observed.get(proof);
    requireCondition(record && record.channel && record.identityKey === caseIdentityKey(plan), 'CASE_OBSERVATION_UNTRUSTED');
    requireFreshObservation(record, clock());
    requireCondition(await roles.readContinuity() === record.version, 'OBSERVATION_INVALIDATED');
    requireFreshObservation(record, clock());
    return record.channel;
  }
  async function consume(context, plan) {
    const record = prepared.get(context);
    requireCondition(record && record.planKey === key(plan), 'CASE_CONTEXT_UNTRUSTED');
    requireFreshObservation(record.context, clock()); prepared.delete(context);
    await roles.assertCurrent(record.context);
    return record;
  }
  return Object.freeze({
    guildId: fixed.guildId,
    verification: Object.freeze({
      candidate,
      async presence(proof, plan, channelId) {
        const record = observed.get(proof);
        requireCondition(record && record.identityKey === caseIdentityKey(plan) && record.channelId === channelId, 'CASE_OBSERVATION_UNTRUSTED');
        requireFreshObservation(record, clock());
        requireCondition(await roles.readContinuity() === record.version, 'OBSERVATION_INVALIDATED');
        requireFreshObservation(record, clock());
        return { missing: record.missing === true };
      },
      async channel(proof, plan, sealed) {
        const channel = await candidate(proof, plan);
        requireCondition(observed.get(proof).planKey === key(plan), 'CASE_AUDIENCE_CHANGED');
        if (caseChannelMode(sealed) !== 'sealed') await currentAudience(plan);
        requireCaseChannel(channel, plan, fixed, sealed);
        await candidate(proof, plan);
        return channel;
      },
    }),
    async prepare(plan, mode = 'open') {
      caseChannelPayload(plan, fixed, true); // Validate the entire binding before any request.
      mode = caseChannelMode(mode);
      const { context, observation } = await roles.prepare(plan.openerId);
      validateRoleContext(context, roleMapping, clock());
      requireCondition(responderRoles(fixed, plan.type).every(id => context.roles.some(role => role.id === id)), 'CASE_CONFIGURATION_INVALID');
      const category = project(await transport.getChannel(fixed.categoryId));
      requireCondition(category.id === fixed.categoryId && category.type === 4, 'CASE_CATEGORY_INVALID');
      const projectedRoles = context.roles.map(role => ({ id: role.id, permissions: role.permissions }));
      const principal = { guildId: fixed.guildId, userId: fixed.botUserId, roleIds: context.botRoleIds, roles: projectedRoles };
      const base = guildPermissions(principal);
      const needed = PERMISSIONS.manageChannels | PERMISSIONS.manageRoles | CASE_CHANNEL_BITS | (mode === 'closed' ? CASE_CLOSED_WRITE_BITS : 0n);
      requireCondition(!context.botTimedOut && (base & needed) === needed, 'BOT_PERMISSION_MISSING');
      const parentPermissions = channelPermissions({ ...principal, overwrites: category.overwrites });
      requireCondition((parentPermissions & (PERMISSIONS.viewChannel | PERMISSIONS.manageChannels | PERMISSIONS.manageRoles)) ===
        (PERMISSIONS.viewChannel | PERMISSIONS.manageChannels | PERMISSIONS.manageRoles), 'BOT_PERMISSION_MISSING');
      requireFreshObservation(context, clock());
      await roles.assertCurrent(context);
      const preparation = Object.freeze({ observation: Object.freeze({ ...observation }) });
      prepared.set(preparation, { context, planKey: key(plan), mode });
      return preparation;
    },
    async find(plan) {
      validateCasePlan(plan); requireCondition(plan.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const startedAt = clock();
      const version = await roles.readContinuity();
      const channels = await transport.getGuildChannels();
      requireCondition(Array.isArray(channels) && channels.length <= 500, 'DISCORD_RESPONSE_INVALID');
      const matches = channels.filter(channel => channel?.topic === caseMarker(plan));
      return Promise.all(matches.map(channel => certify(channel, plan, startedAt, version, true)));
    },
    async inspect(plan, channelId) {
      requireId(channelId);
      const startedAt = clock();
      const version = await roles.readContinuity();
      const raw = await transport.getChannel(channelId);
      requireCondition(raw?.id === channelId, 'CASE_CHANNEL_MISSING');
      return certify(raw, plan, startedAt, version);
    },
    async inspectPresence(plan, channelId) {
      validateCasePlan(plan); requireId(channelId);
      requireCondition(plan.guildId === fixed.guildId && plan.type === 'shuttle', 'OPERATION_DENIED');
      const observedAt = clock(), version = await roles.readContinuity();
      const raw = await transport.getChannel(channelId);
      if (raw !== null) {
        requireCondition(raw?.id === channelId, 'CASE_CHANNEL_MISMATCH');
        const proof = await certify(raw, plan, observedAt, version);
        Object.assign(observed.get(proof), { channelId, missing: false });
        return proof;
      }
      requireCondition(await roles.readContinuity() === version, 'OBSERVATION_INVALIDATED');
      requireFreshObservation({ known: true, observedAt }, clock());
      const proof = Object.freeze({ channelId, missing: true });
      observed.set(proof, { channelId, missing: true, identityKey: caseIdentityKey(plan), known: true, observedAt, version });
      return proof;
    },
    async removeOnboarding(preparation, proof, plan) {
      requireCondition(plan.type === 'shuttle', 'OPERATION_DENIED');
      const channel = await candidate(proof, plan);
      await consume(preparation, plan);
      await transport.deleteOnboardingChannel(channel.id);
    },
    async create(preparation, plan) {
      await consume(preparation, plan);
      const startedAt = clock();
      const version = await roles.readContinuity();
      const raw = await transport.createCaseTextChannel(caseChannelPayload(plan, fixed, true));
      return certify(raw, plan, startedAt, version, true);
    },
    async setAudience(preparation, proof, plan, sealed) {
      const channel = await candidate(proof, plan), context = await consume(preparation, plan);
      requireCondition(caseChannelMode(sealed) !== 'closed' || context.mode === 'closed', 'CASE_CONTEXT_UNTRUSTED');
      if (caseChannelMode(sealed) !== 'sealed') await currentAudience(plan);
      await roles.assertCurrent(context.context);
      const payload = caseChannelPayload(plan, fixed, sealed);
      const result = await transport.replaceCaseAudience(channel.id, fixed.categoryId, payload.permission_overwrites);
      requireCondition(result?.id === channel.id && (result.guild_id === undefined || result.guild_id === fixed.guildId), 'CASE_CHANNEL_MISMATCH');
    },
  });
}
import { responderRoles } from '../../../platform/authorization/case-responders.js';
