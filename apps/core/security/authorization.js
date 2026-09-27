import { ContractError, requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { validateActorObservation, validateCapabilityPolicy, requireConfiguredCapability, requireModerationTarget } from '../../../platform/authorization/actor-policy.js';
import { CASE_TYPES, requireCaseAccess } from '../../../modules/tickets/index.js';
import { requireContinuityStamp } from '../../../contracts/gateway.js';
import { validateCaseParticipantGrant } from '../../../contracts/case-participant.js';

/** Commands and later HTTP routes share this adapter; serialized actor claims are never trusted. */
export function createCoreAuthorization({ principals, discord, authorityStore, policy, clock, isAuthorityCurrent, readContinuity }) {
  validateCapabilityPolicy(policy);
  requireCondition(typeof isAuthorityCurrent === 'function' && typeof readContinuity === 'function' && typeof clock === 'function' &&
    policy.guildId === discord.guildId, 'AUTHORIZATION_CONFIGURATION_INVALID');
  const fixed = structuredClone(policy);
  const caseRoles = { staff: fixed.staff, leadOps: fixed.leadOps, ...(fixed.responders ? { responders: fixed.responders } : {}) };
  const actors = new WeakMap();
  const stamp = async () => requireContinuityStamp(await readContinuity());
  async function current(userId, withPresence = false) {
    requireCondition(await isAuthorityCurrent() === true, 'AUTHORITY_UNCERTAIN');
    const version = await stamp();
    await authorityStore.registerPolicy(fixed);
    const observation = await discord.observeActor(userId);
    validateActorObservation(observation, clock());
    requireCondition(observation.guildId === fixed.guildId, 'FOREIGN_GUILD');
    const recorded = withPresence ? await authorityStore.observeWithPresence(observation, fixed.version) :
      { grant: await authorityStore.observe(observation, fixed.version) };
    requireFreshObservation(observation, clock());
    requireCondition(await isAuthorityCurrent() === true, 'AUTHORITY_UNCERTAIN');
    requireCondition(await stamp() === version, 'OBSERVATION_INVALIDATED');
    requireFreshObservation(observation, clock());
    return { observation, ...recorded, version };
  }
  async function check(capability, grant, scope) {
    validateOperatorGrant(grant);
    requireCondition(grant.guildId === fixed.guildId && (scope.guildId === undefined || scope.guildId === fixed.guildId), 'OPERATION_DENIED');
    const { observation, grant: latest, version, presenceEpoch } = await current(grant.userId, capability === 'case.read');
    requireCondition(latest.capabilityEpoch === grant.capabilityEpoch && latest.policyVersion === grant.policyVersion, 'CAPABILITY_REVOKED');
    requireCondition(observation.present && !observation.bot, 'OPERATION_DENIED');
    if (['shuttle.self', 'case.create'].includes(capability)) {
      requireCondition(scope.userId === grant.userId, 'OPERATION_DENIED');
      if (capability === 'shuttle.self') requireCondition(!observation.timedOut && !observation.roleIds.includes(fixed.muzzled), 'OPERATION_DENIED');
    } else if (capability === 'answers.read') {
      // Public authored library lookup only. This grants no case or configuration access.
      requireCondition(scope.guildId === fixed.guildId, 'OPERATION_DENIED');
    } else if (capability === 'case.read') {
      // Only the core read use case supplies these retained membership/invitation bindings.
      const invited = scope.participant !== null && scope.participant !== undefined;
      if (invited) validateCaseParticipantGrant(scope.participant);
      requireCaseAccess({ actor: observation, caseRecord: { guildId: scope.guildId, type: scope.type,
        openerId: scope.openerEligible === true ? scope.openerId : null,
        participantIds: invited && scope.participant.guildId === fixed.guildId && scope.participant.userId === grant.userId &&
          scope.participant.presenceEpoch === presenceEpoch ? [grant.userId] : [] },
      roles: caseRoles, operation: 'read', now: clock() });
    } else if (capability === 'case.manage') {
      requireCondition(!observation.timedOut && !observation.roleIds.includes(fixed.muzzled), 'OPERATION_DENIED');
      requireCaseAccess({ actor: observation, caseRecord: { guildId: scope.guildId, type: scope.type,
        openerId: scope.openerId, participantIds: [] }, roles: caseRoles, operation: 'manage', now: clock() });
    } else {
      requireConfiguredCapability(fixed, capability, observation, clock());
      if (['member.mute', 'member.unmute'].includes(capability)) {
        const target = await discord.observeActor(scope.userId);
        requireModerationTarget(observation, target, clock());
      }
    }
    requireFreshObservation(observation, clock());
    requireCondition(await isAuthorityCurrent() === true, 'AUTHORITY_UNCERTAIN');
    requireCondition(await stamp() === version, 'OBSERVATION_INVALIDATED');
    requireFreshObservation(observation, clock());
    return true;
  }
  // Policy denial is a boolean; dependency outages propagate to the caller's retry path.
  async function allowed(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ContractError && ['OPERATION_DENIED', 'CASE_ACCESS_DENIED', 'CAPABILITY_REVOKED',
        'MODERATION_TARGET_DENIED', 'UNTRUSTED_PRINCIPAL'].includes(error.code)) return false;
      throw error;
    }
  }
  return Object.freeze({
    /** One fresh observation for dashboard navigation hints only. Mutations still authorize independently. */
    async dashboardAccess(proof) {
      const principal = await principals.resolvePrincipal(proof);
      requireCondition(principal.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const { observation, version } = await current(principal.userId);
      requireCondition(observation.present && !observation.bot, 'OPERATION_DENIED');
      const capabilities = {};
      for (const capability of ['shuttle.publish', 'case.forms.publish', 'answers.publish', 'automation.publish', 'permissions.publish']) {
        capabilities[capability] = await allowed(async () => { requireConfiguredCapability(fixed, capability, observation, clock()); return true; });
      }
      const manageable = [];
      for (const type of CASE_TYPES) {
        if (await allowed(async () => {
          requireCondition(!observation.timedOut && !observation.roleIds.includes(fixed.muzzled), 'OPERATION_DENIED');
          requireCaseAccess({ actor: observation, caseRecord: { guildId: fixed.guildId, type: type.id, openerId: null, participantIds: [] },
            roles: caseRoles, operation: 'manage', now: clock() }); return true;
        })) manageable.push(type.id);
      }
      const latest = await principals.resolvePrincipal(proof);
      requireCondition(latest.guildId === principal.guildId && latest.userId === principal.userId, 'UNTRUSTED_PRINCIPAL');
      requireCondition(await isAuthorityCurrent() === true, 'AUTHORITY_UNCERTAIN');
      requireCondition(await stamp() === version, 'OBSERVATION_INVALIDATED'); requireFreshObservation(observation, clock());
      return { guildId: principal.guildId, userId: principal.userId, capabilities,
        canManageCases: manageable.length > 0, canCreateContacts: manageable.includes('staff-contact') };
    },
    async resolveActor(proof) {
      const principal = await principals.resolvePrincipal(proof);
      requireCondition(principal.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const { observation, grant } = await current(principal.userId);
      requireCondition(observation.present && !observation.bot, 'OPERATION_DENIED');
      const actor = Object.freeze(grant);
      actors.set(actor, { createdAt: clock(), proof });
      return actor;
    },
    async authorize(capability, actor, scope) {
      return allowed(async () => {
        const held = actors.get(actor);
        const now = clock();
        requireCondition(held !== undefined && now >= held.createdAt && now - held.createdAt <= 300_000, 'UNTRUSTED_PRINCIPAL');
        const currentPrincipal = async () => {
          const principal = await principals.resolvePrincipal(held.proof);
          requireCondition(principal.guildId === actor.guildId && principal.userId === actor.userId, 'UNTRUSTED_PRINCIPAL');
        };
        await currentPrincipal(); const result = await check(capability, actor, scope); await currentPrincipal(); return result;
      });
    },
    async authorizeRecorded(capability, grant, scope) {
      requireCondition(['member.mute', 'member.unmute', 'case.manage'].includes(capability), 'RECORDED_CAPABILITY_UNSUPPORTED');
      return allowed(() => check(capability, grant, scope));
    },
    /** Assignment validates its recipient independently; it never grants case access. */
    async resolveCaseResponder({ userId, ...scope }) {
      requireId(userId); requireCondition(scope.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const { grant } = await current(userId);
      return await allowed(() => check('case.manage', grant, scope)) ? Object.freeze(grant) : null;
    },
    /** Eligibility only. The caller must separately authorize and record an explicit case invitation. */
    async resolveCaseParticipant({ guildId, userId }) {
      requireId(userId); requireCondition(guildId === fixed.guildId, 'FOREIGN_GUILD');
      const { observation, presenceEpoch } = await current(userId, true);
      if (!observation.present || observation.bot) return null;
      const grant = { guildId, userId, presenceEpoch }; validateCaseParticipantGrant(grant); return Object.freeze(grant);
    },
    /** Core-retained invitations only; serialized presence metadata alone never establishes case access. */
    async authorizeCaseParticipant(grant) {
      validateCaseParticipantGrant(grant); requireCondition(grant.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const currentPresence = await current(grant.userId, true);
      return currentPresence.observation.present && !currentPresence.observation.bot && currentPresence.presenceEpoch === grant.presenceEpoch;
    },
  });
}
