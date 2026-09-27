import { requireCondition, requireFreshObservation, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { requireOnboardingIssueId, onboardingIssueReason } from '../../../modules/onboarding/delivery-issues.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation } from './members.js';
import { inTransaction } from './transaction.js';
import { registerCasePolicy } from './case-records.js';
import { createOnboardingCaseAccess } from './onboarding-case-access.js';
import { getSession } from './onboarding-records.js';
import { onboardingDeliverySourceJoins } from './onboarding-delivery-source.js';
import { createOnboardingMessageRecovery, isOnboardingMessageJob, onboardingArtifact } from './onboarding-artifact-recovery.js';
import { receipt, saveReceipt } from './receipts.js';
import { caseCandidateIds, selectedCaseChannel, chooseOnboardingCaseChannel } from './case-channel-selection.js';

const issueJoins = `JOIN sophie_core.outbox o ON o.guild_id = i.guild_id AND o.operation_id = i.operation_id AND o.user_id = i.user_id
  ${onboardingDeliverySourceJoins}
  JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id`;
const issueScope = `o.kind IN ('whitelist.grant', 'whitelist.reconcile', 'case.provision', 'shuttle.render', 'shuttle.alert') AND r.type = 'shuttle' AND i.session_id = s.id`;
const labels = Object.freeze({ 'whitelist.grant': 'grant', 'whitelist.reconcile': 'reconcile', 'case.provision': 'case', 'shuttle.render': 'screen', 'shuttle.alert': 'alert' });
const needsMessage = (job, artifact) => isOnboardingMessageJob(job.kind) && artifact.create_started && artifact.message_id === null &&
  (job.kind !== 'shuttle.alert' || job.effect.revision === artifact.revision);

/** Closed Staff recovery actions record intent; only workers confirm delivery. */
export function createOnboardingDeliveryIssueStore({ pool, clock, authorize, policy, verification, screenVerification = null, alertVerification = null }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy);
  const memberOperation = createMemberOperation({ pool, clock });
  const caseAccess = createOnboardingCaseAccess({ policy, verification });
  const adopt = createOnboardingMessageRecovery({ policy: fixed, screenVerification, alertVerification, caseAccess });
  async function access(actor, guildId, openerId = actor?.userId) {
    requireId(guildId);
    requireCondition(fixed !== null && guildId === fixed.guildId, 'CASE_CONFIGURATION_REQUIRED');
    requireCondition(await authorize('case.manage', actor, { guildId, type: 'shuttle', openerId }) === true, 'OPERATION_DENIED');
  }
  async function issue(client, guildId, issueId) {
    requireOnboardingIssueId(issueId);
    const row = (await client.query(`SELECT i.*, o.kind, o.effect, r.state AS case_state, r.channel_id
      FROM sophie_core.shuttle_delivery_issues i ${issueJoins}
      WHERE i.guild_id = $1 AND i.id = $2 AND ${issueScope}`, [guildId, issueId])).rows[0];
    requireCondition(row, 'SHUTTLE_ISSUE_NOT_FOUND'); return row;
  }
  async function change({ actor, interactionId, issueId, expectedRevision, observation, proof = null, message = null, resultId = null }, action) {
    requireOnboardingIssueId(issueId); requireInteger(expectedRevision, 0, 2_147_483_645);
    if (action !== 'recheck') requireId(resultId);
    return memberOperation(observation, async (client, member) => {
      await access(actor, member.guildId); await registerCasePolicy(client, fixed);
      const found = await issue(client, member.guildId, issueId);
      requireCondition(found.user_id === member.userId, 'MEMBER_MISMATCH');
      const grant = operatorGrant(actor);
      const previous = await receipt(client, member.guildId, grant.userId, interactionId,
        { action: { recheck: 'shuttle.issue.recheck', adopt_message: 'shuttle.message.recover', select_channel: 'shuttle.channel.choose' }[action], issueId, expectedRevision,
          ...(action === 'adopt_message' ? { messageId: resultId } : action === 'select_channel' ? { channelId: resultId } : {}) });
      if (previous) return { duplicate: true };
      const job = (await client.query(`SELECT * FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2 FOR UPDATE`,
        [member.guildId, found.operation_id])).rows[0];
      const current = (await client.query('SELECT revision, parked_fence FROM sophie_core.shuttle_delivery_issues WHERE id = $1 FOR UPDATE', [issueId])).rows[0];
      requireCondition(job.status === 'parked' && current.revision === expectedRevision && job.fence === current.parked_fence, 'STALE_SHUTTLE_ISSUE');
      const session = await getSession(client, found.session_id, member.guildId, member.userId);
      const bound = await caseAccess.binding(client, member, session);
      const source = { ...job, session_id: found.session_id };
      const artifact = await onboardingArtifact(client, source, bound, true);
      if (job.kind === 'whitelist.grant') requireCondition(bound.row.state === 'open' && bound.row.channel_id !== null, 'SHUTTLE_CASE_UNAVAILABLE');
      if (action === 'recheck') requireCondition(!needsMessage(job, artifact), 'SHUTTLE_MESSAGE_ID_REQUIRED');
      await access(actor, member.guildId, member.userId);
      if (job.kind === 'whitelist.grant') await caseAccess.verify(proof, bound.plan, bound.row.channel_id, false);
      if (action === 'adopt_message') await adopt(client, { job: source, artifact, bound, session, resultId, proof, message });
      const candidateIds = action === 'select_channel' ? await chooseOnboardingCaseChannel(client, { job, bound, resultId, proof, verification }) : null;
      requireFreshObservation(member.observation, clock());
      await client.query(`INSERT INTO sophie_core.shuttle_delivery_rechecks
        (guild_id, interaction_id, issue_id, revision, operator_grant, parked_fence, attempts, dispatch_started, error_code, action, result_id, candidate_ids)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [member.guildId, interactionId, issueId, current.revision + 1, grant, job.fence, job.attempts, job.dispatch_started, job.last_error_code, action, resultId, candidateIds]);
      await client.query('UPDATE sophie_core.shuttle_delivery_issues SET revision = revision + 1 WHERE id = $1', [issueId]);
      // Preserve effect, possible-send marker and every historical record. A new fence
      // invalidates old leases now; global pause, backoff and Gateway gates are untouched.
      await client.query(`UPDATE sophie_core.outbox SET status = 'ready', available_at = clock_timestamp(), attempts = 0,
        fence = fence + 1, last_error_code = NULL WHERE guild_id = $1 AND operation_id = $2`, [member.guildId, found.operation_id]);
      await saveReceipt(client, member.guildId, interactionId, { issueId, revision: current.revision + 1 });
      return { duplicate: false };
    });
  }
  return Object.freeze({
    async listOnboardingDeliveryIssues({ actor, guildId, after = null }) {
      if (after !== null) requireOnboardingIssueId(after);
      return inTransaction(pool, async client => {
        await access(actor, guildId); await registerCasePolicy(client, fixed);
        const rows = (await client.query(`SELECT i.*, o.kind, o.effect, o.last_error_code, o.dispatch_started,
          r.id AS case_id, r.state AS case_state, r.channel_id, p.policy_version, p.chosen_channel_id, p.chosen_candidates
          FROM sophie_core.shuttle_delivery_issues i ${issueJoins}
          WHERE i.guild_id = $1 AND ${issueScope} AND o.status = 'parked' AND i.parked_fence = o.fence
            AND ($2::text IS NULL OR (i.created_at, i.id) > (SELECT created_at, id FROM sophie_core.shuttle_delivery_issues WHERE guild_id = $1 AND id = $2))
          ORDER BY i.created_at, i.id LIMIT 6`, [guildId, after])).rows;
        const entries = [];
        for (const row of rows.slice(0, 5)) {
          const artifact = await onboardingArtifact(client, row, { plan: { id: row.case_id } });
          const needsMessageId = needsMessage(row, artifact);
          const ids = row.kind === 'case.provision' ? await caseCandidateIds(client, { guildId, id: row.case_id }) : [];
          const channelChoice = ids.length > 1 ? { required: selectedCaseChannel(row, ids) === null, candidates: ids.slice(0, 5), total: ids.length } : null;
          entries.push({ issueId: row.id, userId: row.user_id, revision: row.revision,
            channelId: row.channel_id ?? artifact?.channel_id ?? null, caseState: row.case_state, kind: labels[row.kind],
            reason: onboardingIssueReason(row.last_error_code), attempted: row.dispatch_started, needsMessageId, channelChoice,
            recheckable: !needsMessageId && !channelChoice?.required && row.policy_version === fixed.version && (row.kind !== 'whitelist.grant' || row.case_state === 'open') });
        }
        await access(actor, guildId);
        return { state: 'ready', guildId, entries, next: rows.length > 5 ? entries.at(-1).issueId : null };
      });
    },
    async describeOnboardingDeliveryIssue({ actor, guildId, issueId }) {
      return inTransaction(pool, async client => {
        await access(actor, guildId); await registerCasePolicy(client, fixed);
        const row = await issue(client, guildId, issueId);
        const bound = await caseAccess.describeBinding(client, { guildId, userId: row.user_id }, { id: row.session_id });
        const artifact = await onboardingArtifact(client, row, bound);
        await access(actor, guildId, row.user_id);
        return { userId: row.user_id, kind: row.kind, channelId: artifact?.channel_id ?? bound.row.channel_id, plan: bound.plan,
          ...(row.kind === 'case.provision' ? { candidateIds: await caseCandidateIds(client, bound.plan) } : {}),
          ...(isOnboardingMessageJob(row.kind) ? { recordId: artifact.id } : {}) };
      });
    },
    recheckOnboardingDeliveryIssue: input => change(input, 'recheck'),
    recoverOnboardingMessage: input => change(input, 'adopt_message'),
    chooseOnboardingChannel: input => change(input, 'select_channel'),
  });


}
