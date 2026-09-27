import { loadCasePlan } from './case-audience.js';
import { requireCondition, requireFreshObservation, requireInteger, requireName } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { requireCaseActionReason } from '../../../modules/tickets/lifecycle.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation } from './members.js';
import { registerCasePolicy, requireCaseCapacity } from './case-records.js';
import { retireOnboardingForClosure } from './onboarding-case-lifecycle.js';
import { inTransaction } from './transaction.js';
import { receipt, saveReceipt } from './receipts.js';
import { enqueue } from './outbox.js';
import { loadCaseRecord, assignmentView } from './case-lookup.js';

/** Immutable request metadata plus separately tracked delivery outcome. */
export async function latestCaseAction(client, guildId, caseId) {
  return (await client.query(`SELECT * FROM sophie_core.case_lifecycle_actions
    WHERE guild_id = $1 AND case_id = $2 ORDER BY version DESC LIMIT 1`, [guildId, caseId])).rows[0] ?? null;
}

export function createCaseLifecycleStore({ pool, clock, authorize, authorizeRecorded, policy }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy), memberOperation = createMemberOperation({ pool, clock });
  async function access(actor, row) {
    requireCondition(fixed !== null && row.guild_id === fixed.guildId, 'CASE_CONFIGURATION_REQUIRED');
    requireCondition(await authorize('case.manage', actor, { guildId: row.guild_id, caseId: row.id,
      type: row.type, openerId: row.user_id }) === true, 'OPERATION_DENIED');
  }
  async function request({ actor, observation, interactionId, id, expectedVersion, reason, limits }, action) {
    requireName(id); requireInteger(expectedVersion, 0, 2_147_483_644); requireCaseActionReason(action, reason);
    return memberOperation(observation, async (client, member) => {
      const row = await loadCaseRecord(client, { guildId: member.guildId, id, lock: true });
      requireCondition(row.user_id === member.userId, 'MEMBER_MISMATCH'); await access(actor, row);
      await registerCasePolicy(client, fixed); requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED');
      const grant = operatorGrant(actor);
      const previous = await receipt(client, member.guildId, grant.userId, interactionId, { action: `case.${action}`, id, expectedVersion, reason });
      if (previous) return { duplicate: true };
      requireCondition(row.version === expectedVersion, 'STALE_CASE_VERSION');
      requireCondition(row.channel_id !== null && row.create_started, 'CASE_STATE_CONFLICT');
      const earlier = await latestCaseAction(client, member.guildId, id);
      if (action === 'close') requireCondition(['open', 'closing'].includes(row.state) || (row.state === 'pending' && row.channel_id !== null), 'CASE_STATE_CONFLICT');
      else {
        requireCondition(row.onboarding_retirement == null, 'CASE_STATE_CONFLICT');
        requireCondition(['closed', 'failed'].includes(row.state) || (row.state === 'pending' && earlier?.action === 'reopen'), 'CASE_STATE_CONFLICT');
        requireCondition(member.observation.present, 'MEMBER_ABSENT');
        await requireCaseCapacity(client, member, { limits, clock, excludeId: id });
      }
      await access(actor, row); requireFreshObservation(member.observation, clock());
      const version = row.version + 1;
      const previousAccess = earlier?.action === 'reopen' && earlier.status === 'pending' ? earlier.previous_access : row.desired_access;
      await client.query(`UPDATE sophie_core.case_lifecycle_actions SET status = 'superseded', settled_at = clock_timestamp()
        WHERE guild_id = $1 AND case_id = $2 AND status = 'pending'`, [member.guildId, id]);
      await client.query(`INSERT INTO sophie_core.case_lifecycle_actions
        (guild_id, case_id, version, interaction_id, action, reason, operator_grant, previous_access, requested_at_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [member.guildId, id, version, interactionId, action, reason, grant, previousAccess, clock()]);
      await client.query('UPDATE sophie_core.case_reservations SET state = $2, desired_access = $3, version = $4 WHERE id = $1',
        [id, action === 'close' ? 'closing' : 'pending', action === 'close' ? previousAccess === 'sealed' ? 'sealed' : 'closed' : 'open', version]);
      if (action === 'reopen') {
        await client.query('UPDATE sophie_core.case_provisions SET presence_epoch = $2 WHERE case_id = $1', [id, member.presenceEpoch]);
        await client.query(`UPDATE sophie_core.case_intakes SET contact_status = 'superseded'
          WHERE guild_id = $1 AND case_id = $2 AND contact_status IN ('pending', 'revoked')`, [member.guildId, id]);
      }
      else await retireOnboardingForClosure(client, member, id, version);
      await enqueue(client, { kind: 'case.provision', guildId: member.guildId, userId: member.userId,
        caseId: id, type: row.type, operationId: `case.lifecycle.${interactionId}` });
      await saveReceipt(client, member.guildId, interactionId, { caseId: id, version });
      return { duplicate: false };
    });
  }
  return Object.freeze({
    async describeCase({ actor, guildId, id = null, channelId = null, token = null }) {
      return inTransaction(pool, async client => {
        const row = await loadCaseRecord(client, { guildId, id, channelId, token }); await access(actor, row);
        await registerCasePolicy(client, fixed); requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED');
        const action = await latestCaseAction(client, guildId, row.id);
        const plan = await loadCasePlan(client, row);
        const assignment = await assignmentView(row, authorizeRecorded); await access(actor, row);
        return { id: row.id, userId: row.user_id, type: row.type, state: row.state, version: row.version,
          channelId: row.channel_id, desiredAccess: row.desired_access, priority: row.priority, tags: row.tags,
          action: action?.action ?? null, actionStatus: action?.status ?? null, ...assignment, plan };
      });
    },
    closeCase: input => request(input, 'close'),
    reopenCase: input => request(input, 'reopen'),
  });
}
