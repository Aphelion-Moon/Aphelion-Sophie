import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant, validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { CASE_TYPES } from '../../../modules/tickets/index.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { CASE_QUEUE_FILTERS, CASE_ASSIGN_REASONS, requireCaseQueueFilter } from '../../../modules/tickets/staff.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';
import { loadCaseRecord, caseManagementScope, assignmentView } from './case-lookup.js';
import { registerCasePolicy } from './case-records.js';
import { inTransaction } from './transaction.js';
import { receipt, saveReceipt } from './receipts.js';

/** Staff ownership does not alter the Discord audience or grant application permissions. */
export function createCaseStaffStore({ pool, clock, authorize, authorizeRecorded, resolveCaseResponder, policy }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy);
  const configured = guildId => requireCondition(fixed !== null && guildId === fixed.guildId, 'CASE_CONFIGURATION_REQUIRED');
  async function access(actor, row) {
    requireCondition(await authorize('case.manage', actor, caseManagementScope(row)) === true, 'OPERATION_DENIED');
  }
  async function visibleTypes(actor, guildId) {
    const scope = { guildId, caseId: 'case-queue', openerId: actor?.userId };
    const visible = [];
    for (const { id } of CASE_TYPES) if (await authorize('case.manage', actor, { ...scope, type: id }) === true) visible.push(id);
    requireCondition(visible.length > 0, 'OPERATION_DENIED'); return visible;
  }
  return Object.freeze({
    async listCases({ actor, guildId, filter = 'active', after = null }) {
      requireId(guildId); configured(guildId); requireCaseQueueFilter(filter); if (after !== null) requireCaseToken(after);
      return inTransaction(pool, async client => {
        const types = await visibleTypes(actor, guildId); await registerCasePolicy(client, fixed);
        let boundary = null;
        if (after !== null) {
          boundary = (await client.query(`SELECT r.id, r.created_at_ms FROM sophie_core.case_reservations r
            JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
            WHERE r.guild_id = $1 AND p.operation_token = $2 AND r.type = ANY($3::text[])`, [guildId, after, types])).rows[0];
          requireCondition(boundary !== undefined, 'STALE_CASE_QUEUE');
        }
        const rows = (await client.query(`SELECT r.*, p.operation_token, p.policy_version FROM sophie_core.case_reservations r
          JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
          WHERE r.guild_id = $1 AND r.type = ANY($2::text[]) AND r.state = ANY($3::text[])
            AND ($4::bigint IS NULL OR r.created_at_ms > $4 OR (r.created_at_ms = $4 AND r.id COLLATE "C" > $5))
          ORDER BY r.created_at_ms, r.id COLLATE "C" LIMIT 6`, [guildId, types, CASE_QUEUE_FILTERS[filter], boundary?.created_at_ms ?? null, boundary?.id ?? null])).rows;
        const entries = [];
        for (const row of rows.slice(0, 5)) {
          requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED');
          await access(actor, row);
          entries.push({ id: row.id, token: row.operation_token, userId: row.user_id, type: row.type, caseState: row.state,
            version: row.version, channelId: row.channel_id, priority: row.priority, ...await assignmentView(row, authorizeRecorded) });
        }
        const current = await visibleTypes(actor, guildId);
        requireCondition(entries.every(row => current.includes(row.type)), 'OPERATION_DENIED');
        return { guildId, actorId: operatorGrant(actor).userId, filter, entries, next: rows.length > 5 ? entries.at(-1).token : null };
      });
    },

    async changeCaseAssignment({ actor, guildId, interactionId, id, expectedVersion, action, assigneeId = null, reason = null }) {
      requireId(guildId); configured(guildId); requireInteger(expectedVersion, 0, 2_147_483_644);
      requireCondition(['claim', 'unclaim', 'assign'].includes(action), 'INVALID_CASE_STAFF_ACTION');
      if (action === 'assign') { requireId(assigneeId); requireCondition(CASE_ASSIGN_REASONS.includes(reason), 'INVALID_CASE_REASON'); }
      else requireCondition(assigneeId === null && reason === null, 'INVALID_CASE_STAFF_ACTION');
      return inTransaction(pool, async client => {
        const row = await loadCaseRecord(client, { guildId, id, lock: true }); await access(actor, row);
        await registerCasePolicy(client, fixed); requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED');
        const grant = operatorGrant(actor), targetId = action === 'claim' ? grant.userId : assigneeId;
        const code = action === 'assign' ? reason : action === 'claim' ? 'self-claim' : 'self-release';
        const previous = await receipt(client, guildId, grant.userId, interactionId,
          { action: `case.${action}`, id, expectedVersion, assigneeId: targetId, reason: code });
        if (previous) return { duplicate: true, ...previous };
        requireCondition(row.version === expectedVersion, 'STALE_CASE_VERSION');
        if (action === 'unclaim') requireCondition(row.assignee_grant?.userId === grant.userId, 'CASE_ASSIGNMENT_CONFLICT');
        else requireCondition(row.state === 'open', 'CASE_STATE_CONFLICT');
        if (action === 'claim') requireCondition(row.assignee_grant === null, 'CASE_ASSIGNMENT_CONFLICT');
        let target = action === 'claim' ? grant : null;
        if (action === 'assign') {
          target = await resolveCaseResponder({ ...caseManagementScope(row), userId: targetId });
          requireCondition(target !== null, 'CASE_ASSIGNEE_DENIED'); validateOperatorGrant(target);
          requireCondition(target.guildId === guildId && target.userId === targetId, 'CASE_ASSIGNEE_DENIED');
        }
        await access(actor, row);
        if (target !== null) requireCondition(await authorizeRecorded('case.manage', target, caseManagementScope(row)) === true, 'CASE_ASSIGNEE_DENIED');
        await access(actor, row);
        const version = row.version + 1;
        await client.query(`INSERT INTO sophie_core.case_staff_actions
          (guild_id, case_id, version, interaction_id, action, reason, operator_grant, previous_assignee_grant, assignee_grant, requested_at_ms)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [guildId, id, version, interactionId, action, code, grant, row.assignee_grant, target, clock()]);
        await client.query('UPDATE sophie_core.case_reservations SET assignee_grant = $2, version = $3 WHERE id = $1', [id, target, version]);
        const result = { caseId: id, version }; await saveReceipt(client, guildId, interactionId, result);
        return { duplicate: false, ...result };
      });
    },
  });
}
