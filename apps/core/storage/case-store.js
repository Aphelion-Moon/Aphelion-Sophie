import { createHash } from 'node:crypto';
import { recordCaseDirectNotice } from './case-direct-notice-records.js';
import { requireCondition, requireFreshObservation, requireId, requireName } from '../../../contracts/validation.js';
import { CASE_TYPES } from '../../../modules/tickets/index.js';
import { validateCasePolicy, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation, lockMember } from './members.js';
import { receipt, saveReceipt } from './receipts.js';
import { enqueue, finishClaim, lockClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';
import { registerCasePolicy, reserveCaseRecords } from './case-records.js';
import { caseCandidateIds, selectedCaseChannel, requireOtherCaseSeals } from './case-channel-selection.js';
import { createCaseLifecycleStore, latestCaseAction } from './case-lifecycle.js';
import { loadCasePlan, refreshCaseAudience } from './case-audience.js';
import { currentContactSource } from './case-contact-records.js';
import { registerCaseCaptureChannel, closeCaseCaptureGap } from './case-capture-coverage.js';

/** Core-only case metadata. Verification callbacks are narrow, opaque observation checks. */
export function createCaseStore({ pool, clock, authorize, authorizeRecorded = async () => false, authorizeCaseParticipant = async () => false, policy = null, verification = null }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy);
  const memberOperation = createMemberOperation({ pool, clock });
  const access = async (capability, actor, scope) => requireCondition(await authorize(capability, actor, scope) === true, 'OPERATION_DENIED');
  async function registerPolicy(client) {
    await registerCasePolicy(client, fixed);
  }
  async function load(client, guildId, caseId) {
    const row = (await client.query(`SELECT r.*, p.policy_version, p.operation_token, p.presence_epoch, p.audience_version,
      p.create_started, p.channel_id AS candidate_channel_id, p.phase, p.chosen_channel_id, p.chosen_candidates FROM sophie_core.case_reservations r
      JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
      WHERE r.guild_id = $1 AND r.id = $2 FOR UPDATE OF r, p`, [guildId, caseId])).rows[0];
    requireCondition(row !== undefined, 'CASE_PROVISION_NOT_FOUND');
    const plan = await loadCasePlan(client, row);
    return { row, plan };
  }
  async function active(client, claim, member) {
    const job = await lockClaim(client, claim);
    requireCondition(job.kind === 'case.provision' && job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
    const loaded = await load(client, member.guildId, job.effect.caseId);
    const row = await refreshCaseAudience(client, loaded.row, { authorizeCaseParticipant, authorizeRecorded });
    const current = { row, plan: await loadCasePlan(client, row) };
    requireCondition(current.plan.openerId === member.userId && current.plan.type === job.effect.type, 'CASE_PROVISION_MISMATCH');
    await registerPolicy(client);
    requireCondition(current.plan.guildId === fixed.guildId, 'CASE_CONFIGURATION_INVALID');
    requireCondition(current.plan.policyVersion === fixed.version, 'CASE_POLICY_CHANGED');
    const action = await latestCaseAction(client, member.guildId, current.plan.id);
    const present = member.observation.present && member.presenceEpoch === current.plan.presenceEpoch;
    const reopening = action?.action === 'reopen' && action.status === 'pending';
    const allowed = !reopening || await authorizeRecorded('case.manage', action.operator_grant,
      { guildId: member.guildId, caseId: current.plan.id, type: current.plan.type, openerId: member.userId }) === true;
    const rejectedReopen = reopening && (!present || !allowed);
    const desired = rejectedReopen ? action.previous_access : current.row.desired_access;
    const contactAllowed = await currentContactSource(client, row, authorizeRecorded);
    const mode = !present || !contactAllowed || current.row.state === 'failed' ? 'sealed' : desired;
    return { ...current, job, action, mode, present, allowed, contactAllowed, rejectedReopen, eligible: mode === 'open' };
  }
  async function uniqueChannel(client, row, plan, channelId, otherProofs) {
    const ids = await caseCandidateIds(client, plan);
    requireCondition(selectedCaseChannel(row, ids) === channelId, 'CASE_CHANNEL_DUPLICATE');
    await requireOtherCaseSeals({ verification, policy: fixed, plan, ids, channelId, proofs: otherProofs });
  }
  function verified(kind, proof, plan, sealed) {
    requireCondition(typeof verification?.[kind] === 'function', 'CASE_VERIFIER_REQUIRED');
    return verification[kind](proof, plan, sealed);
  }
  return Object.freeze({
    ...createCaseLifecycleStore({ pool, clock, authorize, authorizeRecorded, policy }),
    async reserveCase({ actor, interactionId, id, type, observation, limits }) {
      requireName(id);
      requireCondition(CASE_TYPES.some(candidate => candidate.id === type && candidate.publicEntry), 'INVALID_PUBLIC_CASE_TYPE');
      return memberOperation(observation, async (client, member) => {
        await access('case.create', actor, { guildId: member.guildId, userId: member.userId });
        requireFreshObservation(member.observation, clock());
        requireCondition(member.observation.present, 'MEMBER_ABSENT');
        await registerPolicy(client); requireCondition(member.guildId === fixed.guildId, 'FOREIGN_GUILD');
        const previous = await receipt(client, member.guildId, member.userId, interactionId, { action: 'case.create', type });
        if (previous) return { duplicate: true, id: previous.caseId };
        await reserveCaseRecords(client, member, { id, type, limits, policy: fixed, clock });
        await saveReceipt(client, member.guildId, interactionId, { caseId: id });
        return { duplicate: false, id };
      });
    },

    async inspectCaseProvision({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan, eligible, mode, contactAllowed } = await active(client, claim, member);
        if (row.onboarding_retirement === 'removed') {
          await finishClaim(client, claim, 'done'); return { settled: true, reason: 'SHUTTLE_CHANNEL_REMOVED' };
        }
        if (row.onboarding_retirement === 'requested') return { settled: false, retiring: true, plan, channelId: row.channel_id };
        if (!eligible && !row.create_started) {
          await client.query("UPDATE sophie_core.case_reservations SET state = 'failed', version = version + 1 WHERE id = $1 AND state <> 'failed'", [plan.id]);
          const reason = contactAllowed ? 'CASE_REQUESTER_LEFT' : 'CASE_CONTACT_REVOKED';
          await finishClaim(client, claim, 'cancelled', reason);
          return { settled: true, reason };
        }
        return { settled: false, plan, createStarted: row.create_started, channelId: row.candidate_channel_id, mode };
      });
    },

    async inspectCaseCandidates({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan } = await active(client, claim, member);
        const ids = await caseCandidateIds(client, plan);
        return { ids, channelId: selectedCaseChannel(row, ids) };
      });
    },

    async beginCaseDuplicateSeal({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan } = await active(client, claim, member);
        const channel = await verified('candidate', proof, plan);
        const ids = await caseCandidateIds(client, plan);
        requireCondition(ids.length > 1 && ids.includes(channel.id) && selectedCaseChannel(row, ids) !== channel.id, 'CASE_CHANNEL_DUPLICATE');
        await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
      });
    },

    async confirmCaseDuplicateSeal({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const { plan } = await active(client, claim, member);
        const channel = await verified('channel', proof, plan, true);
        requireCondition((await caseCandidateIds(client, plan)).includes(channel.id), 'CASE_CHANNEL_MISMATCH');
        requireCaseChannel(channel, plan, fixed, true);
      });
    },

    async beginCaseCreation({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan, eligible } = await active(client, claim, member);
        requireCondition(eligible && row.state === 'pending' && !row.create_started && row.candidate_channel_id === null, 'CASE_CREATION_UNCERTAIN');
        await lockClaim(client, claim);
        await client.query("UPDATE sophie_core.case_provisions SET create_started = true, phase = 'creating' WHERE case_id = $1", [plan.id]);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return plan;
      });
    },

    /** A stale worker may retain discovered channel metadata, never acknowledge its old lease. */
    async noteCaseChannel({ claim, proof }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = (await client.query(`SELECT effect, user_id, fence, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2 AND kind = 'case.provision'`, [claim.guildId, claim.operationId])).rows[0];
        requireCondition(source && source.fence >= claim.fence, 'UNCERTAIN_CASE_NOT_FOUND');
        await lockMember(client, claim.guildId, source.user_id);
        const { row, plan } = await load(client, claim.guildId, source.effect.caseId);
        requireCondition(row.create_started, 'CASE_CREATION_NOT_STARTED');
        const channel = await verified('candidate', proof, plan);
        await client.query('INSERT INTO sophie_core.case_exclusions (guild_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [plan.guildId, channel.id]);
        const added = await client.query('INSERT INTO sophie_core.case_channels (guild_id, channel_id, case_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [plan.guildId, channel.id, plan.id]);
        const owner = (await client.query('SELECT case_id FROM sophie_core.case_channels WHERE guild_id = $1 AND channel_id = $2', [plan.guildId, channel.id])).rows[0];
        requireCondition(owner.case_id === plan.id, 'CASE_CHANNEL_COLLISION');
        await registerCaseCaptureChannel(client, { guildId: plan.guildId, channelId: channel.id, caseId: plan.id, at: clock() });
        await client.query('UPDATE sophie_core.case_provisions SET channel_id = COALESCE(channel_id, $2) WHERE case_id = $1', [plan.id, channel.id]);
        const ids = await caseCandidateIds(client, plan);
        if (added.rowCount && ids.length > 1) {
          await client.query("UPDATE sophie_core.case_reservations SET state = 'pending', version = version + 1 WHERE id = $1 AND state = 'open'", [plan.id]);
          // A new candidate invalidates every previously displayed choice reference.
          await client.query(`UPDATE sophie_core.shuttle_delivery_issues i SET revision = LEAST(i.revision + 1, 2147483646)
            FROM sophie_core.outbox o WHERE o.guild_id = i.guild_id AND o.operation_id = i.operation_id
              AND o.kind = 'case.provision' AND o.guild_id = $1 AND o.effect->>'caseId' = $2`, [plan.guildId, plan.id]);
          const pending = await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND kind = 'case.provision'
            AND effect->>'caseId' = $2 AND status IN ('ready', 'leased', 'parked') LIMIT 1`, [plan.guildId, plan.id]);
          if (!pending.rowCount) await enqueue(client, { kind: 'case.provision', operationId: `case.duplicate.${channel.id}`,
            guildId: plan.guildId, userId: plan.openerId, caseId: plan.id, type: plan.type });
        }
        return { channelId: channel.id, ambiguous: selectedCaseChannel(row, ids) === null };
      });
    },

    async beginCaseAccess({ claim, observation, proof, otherProofs = [] }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan, eligible, mode } = await active(client, claim, member);
        const channel = await verified('candidate', proof, plan);
        requireCondition(row.create_started && row.candidate_channel_id === channel.id, 'CASE_CHANNEL_MISMATCH');
        await uniqueChannel(client, row, plan, channel.id, otherProofs);
        await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.case_provisions SET phase = $2 WHERE case_id = $1', [plan.id, eligible ? 'opening' : 'quarantining']);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return { plan, channelId: channel.id, mode };
      });
    },

    async confirmCaseProvision({ claim, observation, proof, otherProofs = [] }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan, eligible, mode, action, rejectedReopen, allowed, contactAllowed } = await active(client, claim, member);
        const channel = await verified('candidate', proof, plan);
        requireCondition(row.candidate_channel_id === channel.id, 'CASE_CHANNEL_MISMATCH');
        await uniqueChannel(client, row, plan, channel.id, otherProofs);
        if (!eligible && row.phase !== 'quarantining') {
          await client.query("UPDATE sophie_core.case_provisions SET phase = 'quarantining' WHERE case_id = $1", [plan.id]);
          return { settled: false, quarantineRequired: true };
        }
        await verified('channel', proof, plan, mode);
        requireCaseChannel(channel, plan, fixed, mode);
        await closeCaseCaptureGap(client, { guildId: plan.guildId, channelId: channel.id, at: clock(), recovery: 'permissions-verified' });
        if (mode !== 'sealed') await client.query(`UPDATE sophie_core.case_participants SET status = 'active', confirmed_at = clock_timestamp()
          WHERE guild_id = $1 AND case_id = $2 AND status = 'pending'`, [plan.guildId, plan.id]);
        if (mode !== 'sealed' && plan.type === 'staff-contact') await client.query(`UPDATE sophie_core.case_intakes SET contact_status = 'confirmed'
          WHERE guild_id = $1 AND case_id = $2 AND contact_status = 'pending'`, [plan.guildId, plan.id]);
        await client.query('UPDATE sophie_core.case_provisions SET phase = $2 WHERE case_id = $1', [plan.id, eligible ? 'confirmed' : 'quarantined']);
        const state = eligible ? 'open' : rejectedReopen || row.desired_access === 'closed' || ['closing', 'closed'].includes(row.state) ? 'closed' : 'failed';
        await client.query(`UPDATE sophie_core.case_reservations SET state = $2, channel_id = $3,
          desired_access = $4, version = version + CASE WHEN state <> $2 OR channel_id IS DISTINCT FROM $3 OR desired_access <> $4 THEN 1 ELSE 0 END
          WHERE id = $1`, [plan.id, state, channel.id, rejectedReopen ? action.previous_access : row.desired_access]);
        if (action?.status === 'pending') await client.query(`UPDATE sophie_core.case_lifecycle_actions
          SET status = $4, settled_at = clock_timestamp() WHERE guild_id = $1 AND case_id = $2 AND version = $3 AND status = 'pending'`,
        [plan.guildId, plan.id, action.version, rejectedReopen ? allowed ? 'ineligible' : 'revoked' : 'confirmed']);
        await finishClaim(client, claim, 'done', !contactAllowed ? 'CASE_CONTACT_REVOKED' : rejectedReopen ? allowed ? 'CASE_REQUESTER_LEFT' : 'CASE_AUTHORITY_REVOKED' : mode === 'sealed' && row.desired_access === 'open' ? 'CASE_REQUESTER_LEFT' : null);
        if (eligible && mode === 'open') await recordCaseDirectNotice(client, plan);
        return { settled: true, opened: eligible, retained: true, channelId: channel.id };
      });
    },

    async noteUncertainCaseChange(claim) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = (await client.query(`SELECT effect, user_id, fence, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2 AND kind = 'case.provision'`, [claim.guildId, claim.operationId])).rows[0];
        requireCondition(source?.dispatch_started && source.fence >= claim.fence, 'UNCERTAIN_CASE_NOT_FOUND');
        await lockMember(client, claim.guildId, source.user_id);
        const { plan } = await load(client, claim.guildId, source.effect.caseId);
        const suffix = createHash('sha256').update(JSON.stringify([claim.operationId, claim.fence])).digest('hex');
        await enqueue(client, { kind: 'case.provision', operationId: `case.recheck.${suffix}`, guildId: plan.guildId,
          userId: plan.openerId, caseId: plan.id, type: plan.type });
      });
    },

    async excludeCaseChannel({ actor, guildId, channelId, parentId }) {
      requireId(guildId); requireId(channelId); if (parentId !== null) requireId(parentId);
      return inTransaction(pool, async client => {
        await access('case.registry', actor, { guildId });
        await client.query('INSERT INTO sophie_core.case_exclusions (guild_id, channel_id, parent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [guildId, channelId, parentId]);
      });
    },

    async hasCaseExclusion({ guildId, lineage }) {
      requireId(guildId);
      requireCondition(Array.isArray(lineage) && lineage.length > 0 && lineage.length <= 16, 'INVALID_CHANNEL_LINEAGE'); lineage.forEach(requireId);
      const result = await pool.query('SELECT 1 FROM sophie_core.case_exclusions WHERE guild_id = $1 AND channel_id = ANY($2::text[]) LIMIT 1', [guildId, lineage]);
      return result.rowCount > 0;
    },
  });
}
