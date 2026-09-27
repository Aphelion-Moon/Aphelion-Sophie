import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { createMemberOperation } from './members.js';
import { inTransaction } from './transaction.js';
import { loadCasePlan } from './case-audience.js';
import { registerCasePolicy } from './case-records.js';
import { retireOnboardingForClosure } from './onboarding-case-lifecycle.js';
import { enqueue, lockClaim, finishClaim } from './outbox.js';
import { receipt, saveReceipt } from './receipts.js';

const HOUR = 3_600_000, THREE_DAYS = 72 * HOUR;

/** Fixed owner-approved channel cleanup. Retained data is never deleted. */
export function createOnboardingChannelLifecycle({ pool, clock, authorize, authorizeRecorded, policy, verification }) {
  const memberOperation = createMemberOperation({ pool, clock });
  async function load(client, id, userId = null) {
    const row = (await client.query(`SELECT r.*, p.policy_version, p.operation_token, p.presence_epoch, p.audience_version
      FROM sophie_core.case_reservations r JOIN sophie_core.case_provisions p ON p.case_id=r.id AND p.guild_id=r.guild_id
      WHERE r.id=$1 AND r.guild_id=$2 AND r.type='shuttle' FOR UPDATE OF r,p`, [id, policy.guildId])).rows[0];
    await registerCasePolicy(client, policy);
    requireCondition(row && row.channel_id !== null && (userId === null || row.user_id === userId) && row.policy_version === policy.version, 'SHUTTLE_CASE_UNAVAILABLE');
    return { row, plan: await loadCasePlan(client, row) };
  }
  const scope = row => ({ guildId: row.guild_id, caseId: row.id, type: 'shuttle', openerId: row.user_id });
  async function self(actor, member) {
    requireCondition(await authorize('shuttle.self', actor, { guildId: member.guildId, userId: member.userId }), 'OPERATION_DENIED');
  }
  async function retire(client, member, row, reason, actor = null, removed = false) {
    if (row.onboarding_retirement === 'removed') return;
    await client.query(`UPDATE sophie_core.case_reservations SET onboarding_retirement=$2, onboarding_retirement_reason=$3,
      onboarding_retirement_actor=$4, onboarding_retired_ms=$5, state=$6, desired_access='sealed', version=version+1 WHERE id=$1`,
    [row.id, removed ? 'removed' : 'requested', reason, actor, clock(), removed ? 'closed' : 'closing']);
    await retireOnboardingForClosure(client, member, row.id, row.version + 1);
    if (!removed) await enqueue(client, { kind: 'case.provision', operationId: `onboarding.close.${row.id}.${row.version + 1}`,
      guildId: row.guild_id, userId: row.user_id, caseId: row.id, type: 'shuttle' });
  }
  async function due(client, row) {
    if (row.onboarding_retirement !== null || !['open', 'closed'].includes(row.state) || row.onboarding_activity_ms === null) return null;
    const states = (await client.query(`SELECT s.state, s.current, EXISTS (SELECT 1 FROM sophie_core.shuttle_screens v WHERE v.session_id=s.id AND v.current) AS displayed FROM sophie_core.sessions s JOIN sophie_core.shuttle_cases b ON b.session_id=s.id
      WHERE b.case_id=$1 ORDER BY (s.state->>'version')::integer DESC`, [row.id])).rows;
    if (!states.length || states.some(({ state, current }) => current && (state.status === 'role_pending' || state.helpPaused))) return null;
    if ((await client.query(`SELECT 1 FROM sophie_core.shuttle_help_requests h JOIN sophie_core.shuttle_cases b ON b.session_id=h.session_id
      WHERE b.case_id=$1 AND h.status='open' LIMIT 1`, [row.id])).rowCount) return null;
    const age = clock() - Number(row.onboarding_activity_ms);
    return !states.some(item => item.current) && states.some(item => item.displayed && item.state.status === 'complete') && age >= HOUR ? 'completed' : age >= THREE_DAYS ? 'inactive' : null;
  }
  return Object.freeze({
    async describeOnboardingEntryChannel({ actor, observation }) {
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const row = (await client.query(`SELECT r.id FROM sophie_core.case_reservations r JOIN sophie_core.case_provisions p ON p.case_id=r.id
          WHERE r.guild_id=$1 AND r.user_id=$2 AND r.type='shuttle' AND r.state IN ('pending','open') AND r.channel_id IS NOT NULL
            AND r.onboarding_retirement IS NULL AND p.presence_epoch=$3 AND p.policy_version=$4
          ORDER BY r.created_at_ms DESC,r.id DESC LIMIT 1`, [member.guildId, member.userId, member.presenceEpoch, policy.version])).rows[0];
        if (!row) return null;
        const current = await load(client, row.id, member.userId);
        return { id: row.id, plan: current.plan, channelId: current.row.channel_id };
      });
    },
    async recoverMissingOnboardingChannel({ actor, observation, id, proof }) {
      return memberOperation(observation, async (client, member) => {
        await self(actor, member); const { row, plan } = await load(client, id, member.userId);
        requireCondition((await verification.presence(proof, plan, row.channel_id)).missing, 'CASE_CHANNEL_NOT_MISSING');
        requireFreshObservation(member.observation, clock());
        await retire(client, member, row, 'missing', null, true);
      });
    },
    async describeOnboardingClosure({ actor, channelId }) {
      requireId(channelId);
      return inTransaction(pool, async client => {
        const row = (await client.query(`SELECT id FROM sophie_core.case_reservations WHERE guild_id=$1 AND channel_id=$2 AND type='shuttle'`, [policy.guildId, channelId])).rows[0];
        requireCondition(row, 'SHUTTLE_CASE_UNAVAILABLE');
        const current = await load(client, row.id);
        requireCondition(await authorize('case.manage', actor, scope(current.row)), 'OPERATION_DENIED');
        return { id: row.id, userId: current.row.user_id, channelId, plan: current.plan };
      });
    },
    async closeOnboardingChannel({ actor, observation, id, interactionId, proof }) {
      return memberOperation(observation, async (client, member) => {
        const { row, plan } = await load(client, id, member.userId);
        requireCondition(await authorize('case.manage', actor, scope(row)), 'OPERATION_DENIED');
        const grant = operatorGrant(actor);
        if (await receipt(client, member.guildId, grant.userId, interactionId, { action: 'onboarding.close', id })) return;
        const presence = await verification.presence(proof, plan, row.channel_id);
        requireFreshObservation(member.observation, clock());
        if (row.onboarding_retirement !== 'removed') await retire(client, member, row, 'manual', grant, presence.missing);
        await saveReceipt(client, member.guildId, interactionId, { caseId: id });
      });
    },
    async nextOnboardingCleanup() {
      const rows = (await pool.query(`SELECT id,user_id FROM sophie_core.case_reservations r WHERE guild_id=$1 AND type='shuttle'
        AND state IN ('open','closed') AND channel_id IS NOT NULL AND onboarding_retirement IS NULL AND onboarding_activity_ms <= $2
        AND NOT EXISTS (SELECT 1 FROM sophie_core.shuttle_help_requests h JOIN sophie_core.shuttle_cases b ON b.session_id=h.session_id WHERE b.case_id=r.id AND h.status='open')
        AND NOT EXISTS (SELECT 1 FROM sophie_core.sessions s JOIN sophie_core.shuttle_cases b ON b.session_id=s.id WHERE b.case_id=r.id AND s.current AND (s.state->>'status'='role_pending' OR (s.state->>'helpPaused')::boolean))
        AND (onboarding_activity_ms <= $3 OR (NOT EXISTS (SELECT 1 FROM sophie_core.sessions s JOIN sophie_core.shuttle_cases b ON b.session_id=s.id WHERE b.case_id=r.id AND s.current)
          AND EXISTS (SELECT 1 FROM sophie_core.shuttle_screens v JOIN sophie_core.shuttle_cases b ON b.session_id=v.session_id WHERE b.case_id=r.id AND v.current AND v.snapshot->>'status'='complete')))
        ORDER BY onboarding_activity_ms,id LIMIT 25`, [policy.guildId, clock() - HOUR, clock() - THREE_DAYS])).rows;
      // Use row metadata only. Busy or help-paused runs are checked under the member lock before retirement.
      return rows;
    },
    async scheduleOnboardingCleanup({ observation, id }) {
      return memberOperation(observation, async (client, member) => {
        const { row } = await load(client, id, member.userId), reason = await due(client, row);
        if (!reason) return false;
        requireFreshObservation(member.observation, clock());
        await retire(client, member, row, reason); return true;
      });
    },
    async beginOnboardingRemoval({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const job = await lockClaim(client, claim);
        requireCondition(job.kind === 'case.provision' && job.effect.type === 'shuttle' && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
        const { row, plan } = await load(client, job.effect.caseId, member.userId);
        requireCondition(row.onboarding_retirement === 'requested', 'SHUTTLE_CASE_UNAVAILABLE');
        if (row.onboarding_retirement_actor) requireCondition(await authorizeRecorded('case.manage', row.onboarding_retirement_actor, scope(row)), 'OPERATION_DENIED');
        const presence = await verification.presence(proof, plan, row.channel_id);
        requireFreshObservation(member.observation, clock());
        return { missing: presence.missing, plan, channelId: row.channel_id };
      });
    },
    async confirmOnboardingRemoval({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const job = await lockClaim(client, claim);
        requireCondition(job.kind === 'case.provision' && job.effect.type === 'shuttle' && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
        const { row, plan } = await load(client, job.effect.caseId, member.userId);
        requireCondition(row.onboarding_retirement === 'requested' && (await verification.presence(proof, plan, row.channel_id)).missing, 'CASE_CHANNEL_NOT_MISSING');
        await client.query(`UPDATE sophie_core.case_reservations SET onboarding_retirement='removed', state='closed' WHERE id=$1`, [row.id]);
        await finishClaim(client, claim, 'done');
      });
    },
  });
}
