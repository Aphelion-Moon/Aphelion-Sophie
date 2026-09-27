import { requireCondition, requireId, requireName } from '../../../contracts/validation.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';

/** Core metadata lookup only. Every caller must authorize the actual returned case. */
export async function loadCaseRecord(client, { guildId, id = null, channelId = null, token = null, lock = false }) {
  requireId(guildId);
  requireCondition(!(id !== null && token !== null), 'INVALID_CASE_REFERENCE');
  if (id !== null) requireName(id); else if (token !== null) requireCaseToken(token); else requireId(channelId);
  const row = (await client.query(`SELECT r.*, p.policy_version, p.operation_token, p.presence_epoch, p.create_started, p.audience_version
    FROM sophie_core.case_reservations r JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
    WHERE r.guild_id = $1 AND (($2::text IS NOT NULL AND r.id = $2) OR ($4::text IS NOT NULL AND p.operation_token = $4)
      OR ($2::text IS NULL AND $4::text IS NULL AND r.channel_id = $3))
    ${lock ? 'FOR UPDATE OF r, p' : ''}`, [guildId, id, channelId, token])).rows[0];
  requireCondition(row !== undefined, 'CASE_NOT_FOUND'); return row;
}

export function caseManagementScope(row) {
  return { guildId: row.guild_id, caseId: row.id, type: row.type, openerId: row.user_id };
}

/** Assignment is operational metadata, never an access grant. */
export async function assignmentView(row, authorizeRecorded) {
  return row.assignee_grant === null ? { assigneeId: null, assignmentStatus: null } : {
    assigneeId: row.assignee_grant.userId,
    assignmentStatus: await authorizeRecorded('case.manage', row.assignee_grant, caseManagementScope(row)) === true ? 'current' : 'needs_review',
  };
}
