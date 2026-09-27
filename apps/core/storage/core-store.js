import { ContractError, requireCondition, requireFreshObservation, requireId, requireInteger, requireKeys, requireName } from '../../../contracts/validation.js';
import { setMuteIntent, requireOnboardingEligibility, planMemberChange } from '../../../modules/membership/index.js';
import { operatorGrant, validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { advanceOnboarding, backOnboarding, confirmWhitelist, requireGrantDelivery, retryWhitelist, startOnboarding, validateDefinition, nextOnboardingScreen, previousOnboardingScreen } from '../../../modules/onboarding/index.js';
import { createMemberOperation, lockMember, saveMember } from './members.js';
import { receipt, saveReceipt } from './receipts.js';
import { createCaseParticipantStore } from './case-participants.js';
import { createCaseStore } from './case-store.js';
import { createCaseStaffStore } from './case-staff.js';
import { createCaseLabels } from './case-labels.js';
import { createOnboardingEntryStore } from './onboarding-entry.js';
import { createOnboardingChannelLifecycle } from './onboarding-channel-lifecycle.js';
import { createOnboardingPublicationStore } from './onboarding-publications.js';
import { lockOnboardingDefinition, withdrawOnboardingPublication } from './onboarding-publication-records.js';
import { createOnboardingScreenStore } from './onboarding-screens.js';
import { createOnboardingAssistanceStore } from './onboarding-assistance.js';
import { createOnboardingAlertStore } from './onboarding-alerts.js';
import { createOnboardingDeliveryIssueStore } from './onboarding-delivery-issues.js';
import { recordOnboardingDeliveryAlert } from './onboarding-alert-records.js';
import { getDefinition, getSession, saveSession } from './onboarding-records.js';
import { inTransaction } from './transaction.js';
import { enqueue, finishClaim, lockClaim, validateClaim } from './outbox.js';

async function queueReconciliation(client, member, sourceOperation, suffix = 'reconcile') {
  await enqueue(client, { kind: 'whitelist.reconcile', guildId: member.guildId, userId: member.userId,
    operationId: `${sourceOperation}.${suffix}`, sourceOperation,
    // This asks the future dispatcher to inspect current policy, not blindly remove a role.
    accessEpoch: member.accessEpoch, eligibilityEpoch: member.eligibilityEpoch });
  const alert = await recordOnboardingDeliveryAlert(client, { guildId: member.guildId, operationId: sourceOperation });
  if (alert) await enqueue(client, alert);
}

async function latestMemberAction(client, member) {
  return (await client.query(`SELECT * FROM sophie_core.member_actions WHERE guild_id = $1 AND user_id = $2
    ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [member.guildId, member.userId])).rows[0] ?? null;
}

async function queueMemberInspection(client, member, suffix = 'observed') {
  const pending = await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND user_id = $2
    AND kind = 'member.reconcile' AND status IN ('ready', 'leased', 'parked') LIMIT 1`, [member.guildId, member.userId]);
  if (!pending.rowCount) await enqueue(client, { kind: 'member.reconcile', guildId: member.guildId, userId: member.userId,
    operationId: `member.${member.userId}.${member.version}.${suffix}`, actionRevision: null });
}

/**
 * Core-only use cases. Trusted Discord/OAuth adapters supply observations/actor identity;
 * these methods must never be bound directly to client-controlled JSON.
 * authorize is injected by the composition root and must check current capabilities.
 */
export function createCoreStore({ pool, clock, authorize, authorizeRecorded = async () => false, resolveCaseResponder = async () => null, resolveCaseParticipant = async () => null, authorizeCaseParticipant = async () => false, casePolicy = null, caseVerification = null, onboardingMessageVerification = null, onboardingAlertVerification = null }) {
  requireCondition(typeof clock === 'function' && typeof authorize === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const checkAccess = async (capability, actor, scope) => requireCondition(await authorize(capability, actor, scope) === true, 'OPERATION_DENIED');
  requireCondition(typeof authorizeRecorded === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(typeof resolveCaseResponder === 'function', 'TRUSTED_ADAPTERS_REQUIRED');

  const memberOperation = createMemberOperation({ pool, clock });
  const cases = createCaseStore({ pool, clock, authorize, authorizeRecorded, authorizeCaseParticipant, policy: casePolicy, verification: caseVerification });

  async function requestMemberAction({ actor, interactionId, observation }, muted, confirmed = false) {
    return memberOperation(observation, async (client, member) => {
      await checkAccess(muted ? 'member.mute' : 'member.unmute', actor, { guildId: member.guildId, userId: member.userId });
      requireFreshObservation(member.observation, clock());
      const grant = operatorGrant(actor);
      requireCondition(grant.guildId === member.guildId, 'FOREIGN_GUILD');
      requireCondition(member.observation.present, 'MEMBER_ABSENT');
      if (confirmed) requireCondition(!member.observation.muzzled, 'UNMUTE_NOT_CONFIRMED');
      const previous = await receipt(client, member.guildId, member.userId, interactionId,
        { action: muted ? 'mute' : confirmed ? 'unmute-confirmed' : 'unmute', operatorId: grant.userId });
      if (previous) return member;
      const latest = await latestMemberAction(client, member);
      const revision = Number(latest?.revision ?? 0) + 1; requireInteger(revision, 1);
      const operationId = `member-action.${interactionId}`;
      // Pending unmute does not clear the durable block. Only observed removal may do so.
      const next = setMuteIntent(member, !confirmed, member.version);
      await saveMember(client, next);
      await client.query(`INSERT INTO sophie_core.member_actions
        (guild_id, user_id, revision, operation_id, muted, status, operator_grant, eligibility_epoch)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [member.guildId, member.userId, revision, operationId, muted, confirmed ? 'applied' : 'pending', grant, member.eligibilityEpoch]);
      await enqueue(client, { kind: 'member.reconcile', operationId, guildId: member.guildId, userId: member.userId, actionRevision: revision });
      await saveReceipt(client, member.guildId, interactionId, { memberVersion: next.version, actionRevision: revision });
      return next;
    });
  }

  return Object.freeze({
    ...createCaseParticipantStore({ pool, clock, authorize, resolveCaseParticipant, authorizeCaseParticipant, policy: casePolicy }),
    ...createCaseStaffStore({ pool, clock, authorize, authorizeRecorded, resolveCaseResponder, policy: casePolicy }),
    ...createCaseLabels({ pool, clock, authorize }),
    ...createOnboardingEntryStore({ pool, clock, authorize, policy: casePolicy }),
    ...createOnboardingChannelLifecycle({ pool, clock, authorize, authorizeRecorded, policy: casePolicy, verification: caseVerification }),
    ...createOnboardingPublicationStore({ pool, authorize }),
    ...createOnboardingScreenStore({ pool, clock, authorize, policy: casePolicy, caseVerification, messageVerification: onboardingMessageVerification }),
    ...createOnboardingAssistanceStore({ pool, clock, authorize, policy: casePolicy }),
    ...createOnboardingDeliveryIssueStore({ pool, clock, authorize, policy: casePolicy, verification: caseVerification,
      screenVerification: onboardingMessageVerification, alertVerification: onboardingAlertVerification }),
    ...createOnboardingAlertStore({ pool, clock, policy: casePolicy, caseVerification, messageVerification: onboardingAlertVerification }),
    async recordObservation(observation) {
      return memberOperation(observation, async (client, member, previous) => {
        if (member.observation.whitelist && previous.observation?.whitelist === false) {
          const uncertain = await client.query(`SELECT operation_id FROM sophie_core.outbox
            WHERE guild_id = $1 AND user_id = $2 AND kind = 'whitelist.grant'
              AND dispatch_started AND status IN ('cancelled', 'parked')
            ORDER BY created_at DESC, operation_id DESC LIMIT 1`, [member.guildId, member.userId]);
          if (uncertain.rowCount) await queueReconciliation(client, member, uncertain.rows[0].operation_id, `observed.${member.version}`);
        }
        const action = await latestMemberAction(client, member);
        const desired = action && (action.muted || action.status === 'pending') ? action.muted : null;
        if (planMemberChange(member, desired, clock()) !== 'none') await queueMemberInspection(client, member);
        return member;
      });
    },

    async publishDefinition({ actor, definition }) {
      validateDefinition(definition);
      requireCondition(definition.status === 'published', 'PUBLISHED_DEFINITION_REQUIRED');
      return inTransaction(pool, async client => {
        await checkAccess('shuttle.publish', actor, { definitionId: definition.id });
        await lockOnboardingDefinition(client, definition.id);
        const inserted = await client.query('INSERT INTO sophie_core.definitions (id, version, definition) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [definition.id, definition.version, definition]);
        if (!inserted.rowCount) {
          const previous = await client.query('SELECT definition = $3::jsonb AS same FROM sophie_core.definitions WHERE id = $1 AND version = $2', [definition.id, definition.version, definition]);
          requireCondition(previous.rows[0].same, 'DEFINITION_IMMUTABLE');
        }
      });
    },

    async withdrawDefinition({ actor, id, version }) {
      requireName(id); requireInteger(version, 1);
      return inTransaction(pool, async client => {
        await checkAccess('shuttle.publish', actor, { definitionId: id });
        await lockOnboardingDefinition(client, id); await withdrawOnboardingPublication(client, id, version);
        await checkAccess('shuttle.publish', actor, { definitionId: id });
      });
    },

    async start({ actor, interactionId, id, nonce, observation, definitionId }) {
      requireName(id); requireName(nonce); requireName(definitionId);
      return memberOperation(observation, async (client, member) => {
        await checkAccess('shuttle.self', actor, { guildId: member.guildId, userId: member.userId });
        requireOnboardingEligibility(member, clock());
        const previous = await receipt(client, member.guildId, member.userId, interactionId, { action: 'start', definitionId });
        if (previous) {
          const session = await getSession(client, previous.sessionId, member.guildId, member.userId);
          requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
          const published = await getDefinition(client, session.definitionId, session.definitionVersion);
          requireCondition(published.status === 'published', 'DEFINITION_WITHDRAWN');
          return { duplicate: true, session };
        }
        const current = await client.query('SELECT id FROM sophie_core.sessions WHERE guild_id = $1 AND user_id = $2 AND current', [member.guildId, member.userId]);
        requireCondition(!current.rowCount, 'SHUTTLE_ALREADY_ACTIVE');
        const found = await client.query(`SELECT definition FROM sophie_core.definitions WHERE id = $1
          AND definition->>'status' = 'published' ORDER BY version DESC LIMIT 1 FOR SHARE`, [definitionId]);
        requireCondition(found.rowCount === 1, 'DEFINITION_NOT_FOUND');
        const session = startOnboarding({ id, nonce, member, definition: found.rows[0].definition, now: clock() });
        await client.query(`INSERT INTO sophie_core.sessions (id, guild_id, user_id, definition_id, definition_version, current, state)
          VALUES ($1, $2, $3, $4, $5, true, $6)`, [id, member.guildId, member.userId, session.definitionId, session.definitionVersion, session]);
        await saveReceipt(client, member.guildId, interactionId, { sessionId: id });
        return { duplicate: false, session };
      });
    },

    async transition({ actor, action, interactionId, sessionId, command, observation }) {
      requireCondition(['advance', 'back', 'retry', 'next-screen', 'previous-screen'].includes(action), 'INVALID_SHUTTLE_ACTION');
      requireName(sessionId);
      return memberOperation(observation, async (client, member) => {
        await checkAccess('shuttle.self', actor, { guildId: member.guildId, userId: member.userId });
        requireOnboardingEligibility(member, clock());
        // Validate before receipt lookup as well as in the pure transition.
        requireKeys(command, ['guildId', 'userId', 'expectedVersion', 'nonce', 'nextNonce']);
        requireInteger(command.expectedVersion); requireName(command.nonce); requireName(command.nextNonce);
        requireCondition(command.guildId === member.guildId && command.userId === member.userId, 'FOREIGN_SHUTTLE_CONTROL');
        const previous = await receipt(client, member.guildId, member.userId, interactionId,
          { action, sessionId, expectedVersion: command.expectedVersion, nonce: command.nonce });
        const session = await getSession(client, sessionId, member.guildId, member.userId);
        requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
        const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
        requireCondition(definition.status === 'published', 'DEFINITION_WITHDRAWN');
        if (previous) return { duplicate: true, session };
        const change = { advance: advanceOnboarding, back: backOnboarding, retry: retryWhitelist,
          'next-screen': nextOnboardingScreen, 'previous-screen': previousOnboardingScreen }[action](session, member, definition, command, clock());
        await saveSession(client, change.session, member);
        for (const effect of change.effects) await enqueue(client, effect);
        await saveReceipt(client, member.guildId, interactionId, { sessionId });
        return { duplicate: false, session: change.session };
      });
    },

    async requestMute({ actor, interactionId, observation }) {
      return requestMemberAction({ actor, interactionId, observation }, true);
    },

    async requestUnmute({ actor, interactionId, observation }) {
      return requestMemberAction({ actor, interactionId, observation }, false);
    },

    async confirmUnmuted({ actor, interactionId, observation }) {
      return requestMemberAction({ actor, interactionId, observation }, false, true);
    },

    async inspectMemberReconciliation({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const job = await lockClaim(client, claim);
        requireCondition(job.kind === 'member.reconcile' && job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
        const action = await latestMemberAction(client, member);
        if (job.effect.actionRevision != null && Number(action?.revision) !== job.effect.actionRevision) {
          await finishClaim(client, claim, 'cancelled', 'MEMBER_ACTION_SUPERSEDED');
          return { deliver: false, reason: 'MEMBER_ACTION_SUPERSEDED' };
        }
        if (!member.observation.present) {
          await finishClaim(client, claim, 'cancelled', 'MEMBER_ABSENT');
          return { deliver: false, reason: 'MEMBER_ABSENT' };
        }
        const desired = action && (action.muted || action.status === 'pending') ? action.muted : null;
        let change = planMemberChange(member, desired, clock());
        if (['add_muzzled', 'remove_muzzled', 'confirm_unmute'].includes(change)) {
          requireCondition(action !== null, 'MEMBER_ACTION_REQUIRED');
          validateOperatorGrant(action.operator_grant);
          requireCondition(Number(action.eligibility_epoch) === member.eligibilityEpoch, 'MEMBER_ACTION_EPOCH_CHANGED');
          requireCondition(await authorizeRecorded(action.muted ? 'member.mute' : 'member.unmute', action.operator_grant,
            { guildId: member.guildId, userId: member.userId }) === true, 'OPERATION_DENIED');
          requireFreshObservation(member.observation, clock());
        }
        if (change === 'confirm_unmute') {
          member = setMuteIntent(member, false, member.version);
          await saveMember(client, member);
          await client.query(`UPDATE sophie_core.member_actions SET status = 'applied'
            WHERE guild_id = $1 AND user_id = $2 AND revision = $3`, [member.guildId, member.userId, action.revision]);
          change = planMemberChange(member, null, clock());
        }
        if (change === 'none') {
          if (action?.status === 'pending' && action.muted === member.observation.muzzled) {
            await client.query(`UPDATE sophie_core.member_actions SET status = 'applied'
              WHERE guild_id = $1 AND user_id = $2 AND revision = $3`, [member.guildId, member.userId, action.revision]);
          }
          await finishClaim(client, claim, 'done');
          return { deliver: false, confirmed: true };
        }
        await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return { deliver: true, change };
      });
    },

    async noteUncertainMemberChange(claim) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = (await client.query(`SELECT user_id, fence, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2 AND kind = 'member.reconcile'`, [claim.guildId, claim.operationId])).rows[0];
        requireCondition(source?.dispatch_started && source.fence >= claim.fence, 'UNCERTAIN_MEMBER_CHANGE_NOT_FOUND');
        const member = await lockMember(client, claim.guildId, source.user_id);
        // Independent of the old lease: this is only a request to inspect current policy.
        await enqueue(client, { kind: 'member.reconcile', guildId: member.guildId, userId: member.userId,
          operationId: `member.${member.userId}.${member.version}.uncertain.${claim.fence}`, actionRevision: null });
      });
    },

    async inspectGrant({ claim, observation, confirm = false }) {
      requireCondition(typeof confirm === 'boolean', 'INVALID_CONFIRMATION');
      // Member -> outbox lock ordering is shared with all member transitions.
      return memberOperation(observation, async (client, member) => {
        const job = await lockClaim(client, claim);
        requireCondition(job.kind === 'whitelist.grant', 'WRONG_JOB_KIND');
        requireCondition(job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'MEMBER_MISMATCH');
        const session = await getSession(client, job.effect.sessionId, member.guildId, member.userId);
        const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
        try { requireGrantDelivery(session, member, job.effect, definition, clock()); }
        catch (error) {
          if (!(error instanceof ContractError)) throw error;
          await finishClaim(client, claim, 'cancelled', error.code);
          if (job.dispatch_started || confirm) await queueReconciliation(client, member, claim.operationId);
          return { deliver: false, reason: error.code, reconciliationRequired: job.dispatch_started || confirm };
        }
        if (confirm || member.observation.whitelist) {
          const complete = confirmWhitelist(session, member, job.effect, definition, clock());
          await saveSession(client, complete, member);
          await finishClaim(client, claim, 'done');
          return { deliver: false, confirmed: true, session: complete };
        }
        // Revalidate the fence after lock waits and mark the possible external effect durably.
        await lockClaim(client, claim);
        await client.query(`UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2`, [claim.guildId, claim.operationId]);
        return { deliver: true, effect: job.effect };
      });
    },

    async inspectWhitelistReconciliation({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const job = await lockClaim(client, claim);
        requireCondition(job.kind === 'whitelist.reconcile' && job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
        const source = await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2
          AND user_id = $3 AND kind = 'whitelist.grant' AND dispatch_started`, [member.guildId, job.effect.sourceOperation, member.userId]);
        requireCondition(source.rowCount === 1, 'RECONCILIATION_SOURCE_MISSING');
        if (!member.observation.present || !member.observation.whitelist) {
          await finishClaim(client, claim, 'done');
          return { deliver: false, reconciled: true };
        }
        const sessions = await client.query(`SELECT state FROM sophie_core.sessions WHERE guild_id = $1 AND user_id = $2
          AND (state->>'eligibilityEpoch')::bigint = $3 AND state->>'status' IN ('complete', 'role_pending')
          ORDER BY (state->>'status' = 'complete') DESC LIMIT 1 FOR UPDATE`,
        [member.guildId, member.userId, member.eligibilityEpoch]);
        // Already-earned access survives muting; a fresh fully-read qualification may also
        // justify a newer in-flight grant. Neither branch restores a missing role.
        let entitled = sessions.rows.some(row => row.state.status === 'complete');
        for (const { state: session } of sessions.rows.filter(row => row.state.status === 'role_pending')) {
          const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
          const effect = { kind: 'whitelist.grant', operationId: `${session.id}.grant.${session.version}`, guildId: member.guildId,
            userId: member.userId, sessionId: session.id, expectedSessionVersion: session.version,
            eligibilityEpoch: session.eligibilityEpoch, accessEpoch: session.grantAccessEpoch };
          try { requireGrantDelivery(session, member, effect, definition, clock()); entitled = true; }
          catch (error) { if (!(error instanceof ContractError)) throw error; }
        }
        if (entitled) {
          await finishClaim(client, claim, 'done');
          return { deliver: false, preservedCurrentEntitlement: true };
        }
        await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return { deliver: true, change: 'remove_whitelist' };
      });
    },

    /** An expired worker may record uncertainty, but can never complete its old job. */
    async noteUncertainGrant(claim) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = await client.query(`SELECT user_id, kind, effect, fence, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2`, [claim.guildId, claim.operationId]);
        const row = source.rows[0];
        requireCondition(row && row.fence >= claim.fence && row.dispatch_started &&
          ['whitelist.grant', 'whitelist.reconcile'].includes(row.kind), 'UNCERTAIN_GRANT_NOT_FOUND');
        const member = await lockMember(client, claim.guildId, row.user_id);
        const original = row.kind === 'whitelist.grant' ? claim.operationId : row.effect.sourceOperation;
        // The attempted job's unique operation identity, not an unbounded suffix chain.
        const suffix = `late.${claim.fence}.${row.kind === 'whitelist.grant' ? 'g' : 'r'}.${member.version}`;
        await queueReconciliation(client, member, original, suffix);
      });
    },

    ...cases,
  });
}
