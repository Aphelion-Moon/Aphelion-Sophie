import { ContractError, requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { validateActorObservation, validateCapabilityPolicy, requireConfiguredCapability, requireModerationTarget } from '../../../platform/authorization/actor-policy.js';
import { CASE_TYPES, requireCaseAccess } from '../../../modules/tickets/index.js';
import { requireContinuityStamp } from '../../../contracts/gateway.js';
import { validateCaseParticipantGrant } from '../../../contracts/case-participant.js';

/** Commands and later HTTP routes share this adapter; serialized actor claims are never trusted. */
export function createCoreAuthorization({ principals, discord, authorityStore, policy, clock, isAuthorityCurrent, readContinuity, readAuthority = null }) {
  validateCapabilityPolicy(policy);
  requireCondition(typeof isAuthorityCurrent === 'function' && typeof readContinuity === 'function' && typeof clock === 'function' &&
    (readAuthority === null || typeof readAuthority === 'function') &&
    policy.guildId === discord.guildId, 'AUTHORIZATION_CONFIGURATION_INVALID');
  const fixed = structuredClone(policy);
  const caseRoles = { staff: fixed.staff, leadOps: fixed.leadOps, ...(fixed.responders ? { responders: fixed.responders } : {}) };
  const actors = new WeakMap();
  // A fresh observation is overtaken by an authority change (a member, role, channel or guild event, or a reconnect), not
  // by message traffic; see roles.readAuthority.
  const authority = async () => requireContinuityStamp(await (readAuthority ?? readContinuity)());
  // Owner decision, 24 October 2026, replacing that of 12 October ("we should be checking steps intelligently, not grossly
  // over-doing the process with constant validation"): each request observes its actor afresh, once (resolveActor), and
  // that recorded present-member observation serves the request's own capability checks for up to REUSE_MS while the
  // authority stamp is unchanged, so one request observes the member once rather than once per step. The stamp moves on
  // any member, role, channel or guild change and on a reconnect, so a reused observation is as current as a new one.
  // Presence-bound checks (case reads, invitations, AI consent) still record afresh. A reused observation is never recorded again, so stored authority cannot move backwards.
  // This covers every capability check: the Activity's, Sophie's AI and Staff administration (cases, moderation, forms,
  // publishing, permissions, automation, answers). PRESENCE_BOUND checks record afresh.
  const REUSE_MS = 1_500, PRESENCE_BOUND = ['case.read'];
  const recent = new Map();
  function reusable(userId, version) {
    const saved = recent.get(userId), now = clock();
    return saved && saved.version === version && now >= saved.observation.observedAt && now - saved.observation.observedAt <= REUSE_MS ? saved : null;
  }
  /** The member's current observation and grant: reused within REUSE_MS of the same stamp (if `reuse`), else observed and recorded. */
  async function current(userId, withPresence = false, reuse = true) {
    requireCondition(await isAuthorityCurrent() === true, 'AUTHORITY_UNCERTAIN');
    const version = await authority();
    await authorityStore.registerPolicy(fixed);
    const unchanged = async () => await authority() === version;
    // A reused observation still stands only if what was recorded with it does: one query confirms the member's capability
    // epoch has not moved (a revocation the Gateway journal or a policy application recorded since) and no newer policy
    // version was recorded (an older configuration never resumes authority). A new observation checks both as it records.
    const saved = withPresence || !reuse || typeof authorityStore.recordedAuthority !== 'function' ? null : reusable(userId, version);
    if (saved) {
      const recorded = await authorityStore.recordedAuthority(fixed.guildId, userId);
      if (recorded?.capabilityEpoch === saved.recorded.grant.capabilityEpoch && recorded.policyVersion === fixed.version && recorded.latestPolicyVersion === fixed.version) {
        return { observation: saved.observation, ...saved.recorded, unchanged };
      }
    }
    const observation = await discord.observeActor(userId);
    validateActorObservation(observation, clock());
    requireCondition(observation.guildId === fixed.guildId, 'FOREIGN_GUILD');
    const recorded = withPresence ? await authorityStore.observeWithPresence(observation, fixed.version) :
      { grant: await authorityStore.observe(observation, fixed.version) };
    requireCondition(await unchanged(), 'OBSERVATION_INVALIDATED');
    requireFreshObservation(observation, clock());
    // Only a validated present-member observation, still bound to its stamp, serves later checks. An absence is never
    // reused, so it cannot outlive a rejoin.
    recent.delete(userId);
    if (!withPresence && observation.present && !observation.bot) {
      recent.set(userId, { version, observation, recorded });
      if (recent.size > 256) recent.delete(recent.keys().next().value);
    }
    return { observation, ...recorded, unchanged };
  }
  async function check(capability, grant, scope) {
    validateOperatorGrant(grant);
    requireCondition(grant.guildId === fixed.guildId && (scope.guildId === undefined || scope.guildId === fixed.guildId), 'OPERATION_DENIED');
    const { observation, grant: latest, unchanged, presenceEpoch } = await current(grant.userId, PRESENCE_BOUND.includes(capability));
    requireCondition(latest.capabilityEpoch === grant.capabilityEpoch && latest.policyVersion === grant.policyVersion, 'CAPABILITY_REVOKED');
    requireCondition(observation.present && !observation.bot, 'OPERATION_DENIED');
    if (['shuttle.self', 'case.create', 'ai.self'].includes(capability)) {
      requireCondition(scope.userId === grant.userId, 'OPERATION_DENIED');
      if (capability === 'shuttle.self') requireCondition(!observation.timedOut && !observation.roleIds.includes(fixed.muzzled), 'OPERATION_DENIED');
    } else if (capability === 'shuttle.activity.test') {
      // Owner decisions, 22 and 24 October 2026: while the Shuttle Activity is in testing, the server owner, current lead ops
      // role holders and holders of any role the policy grants shuttle.activity.test (Staff) pass its closed screen.
      // Self-scoped; it grants nothing else.
      const testers = fixed.grants['shuttle.activity.test'] ?? [];
      requireCondition(scope.userId === grant.userId && (observation.guildOwner || observation.roleIds.includes(fixed.leadOps) ||
        observation.roleIds.some(id => testers.includes(id))), 'OPERATION_DENIED');
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
    // Once, at the end: nothing changed while the decision was made, and its observation is still fresh.
    requireCondition(await unchanged(), 'OBSERVATION_INVALIDATED');
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
      // Navigation hints: one check per page load, which the page's later checks reuse (see current).
      const { observation, unchanged } = await current(principal.userId, false, false);
      requireCondition(observation.present && !observation.bot, 'OPERATION_DENIED');
      const capabilities = {};
      for (const capability of ['member.mute', 'member.unmute', 'shuttle.publish', 'case.forms.publish', 'answers.publish', 'automation.publish', 'permissions.publish', 'ai.control', 'ai.personality.publish', 'ai.knowledge.publish']) {
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
      requireCondition(await unchanged(), 'OBSERVATION_INVALIDATED'); requireFreshObservation(observation, clock());
      return { guildId: principal.guildId, userId: principal.userId, capabilities,
        canManageCases: manageable.length > 0, canManageOnboarding: manageable.includes('shuttle'), canCreateContacts: manageable.includes('staff-contact') };
    },
    /** The actor for a request, observed afresh; the request's own capability checks reuse this observation (see current). */
    async resolveActor(proof) {
      const principal = await principals.resolvePrincipal(proof);
      requireCondition(principal.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const { observation, grant } = await current(principal.userId, false, false);
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
        // The principal is signed in (its session or interaction) when the decision starts and still when it is made: a
        // logout during the check denies it. A lookup, not a Discord read.
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
    /** Current presence binding for own AI consent; departure/rejoin never restores an old enrollment. */
    async aiMemberPresence(actor) {
      const held = actors.get(actor); requireCondition(held !== undefined, 'UNTRUSTED_PRINCIPAL');
      const principal = await principals.resolvePrincipal(held.proof);
      requireCondition(principal.guildId === fixed.guildId && principal.userId === actor.userId, 'UNTRUSTED_PRINCIPAL');
      const observation = await current(actor.userId, true);
      requireCondition(observation.observation.present && !observation.observation.bot, 'OPERATION_DENIED');
      return observation.presenceEpoch;
    },
    /** Assignment validates its recipient independently; it never grants case access. */
    async resolveCaseResponder({ userId, ...scope }) {
      requireId(userId); requireCondition(scope.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const { grant } = await current(userId, false, false);
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
