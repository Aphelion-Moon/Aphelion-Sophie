import { createHash } from 'node:crypto';
import { requireInteger } from '../../../contracts/validation.js';
import { validateCasePlan } from '../../../modules/tickets/channel-policy.js';
import { caseManagementScope } from './case-lookup.js';
import { enqueue } from './outbox.js';

/** Caller locks the case before changing these records. Only current invitations form an audience. */
export async function currentCaseInvitations(client, row) {
  return (await client.query(`SELECT * FROM sophie_core.case_participants WHERE guild_id = $1 AND case_id = $2
    AND status IN ('pending', 'active') ORDER BY user_id COLLATE "C"`, [row.guild_id, row.id])).rows;
}
export const participantBinding = row => ({ guildId: row.guild_id, userId: row.user_id, presenceEpoch: Number(row.presence_epoch) });

/** Shared by provisioning, lifecycle, navigation and retained-message recovery. */
export async function loadCasePlan(client, row) {
  const plan = { id: row.id, guildId: row.guild_id, openerId: row.user_id, type: row.type,
    policyVersion: row.policy_version, token: row.operation_token, presenceEpoch: Number(row.presence_epoch) };
  if (row.audience_version > 0) plan.audience = { version: row.audience_version,
    participants: (await currentCaseInvitations(client, row)).map(participantBinding) };
  validateCasePlan(plan); return plan;
}

export async function advanceCaseAudience(client, row) {
  const version = row.version + 1, audienceVersion = row.audience_version + 1;
  requireInteger(version, 1, 2_147_483_646); requireInteger(audienceVersion, 1, 2_147_483_646);
  await client.query('UPDATE sophie_core.case_provisions SET audience_version = $2 WHERE case_id = $1', [row.id, audienceVersion]);
  await client.query(`UPDATE sophie_core.case_reservations SET version = $2,
    state = CASE WHEN state = 'open' THEN 'pending' ELSE state END WHERE id = $1`, [row.id, version]);
  const suffix = createHash('sha256').update(JSON.stringify([row.guild_id, row.id, audienceVersion])).digest('hex');
  await enqueue(client, { kind: 'case.provision', operationId: `case.audience.${suffix}`, guildId: row.guild_id,
    userId: row.user_id, caseId: row.id, type: row.type });
  return { ...row, version, audience_version: audienceVersion, state: row.state === 'open' ? 'pending' : row.state };
}

/** A membership failure is permanent for this invitation. Outages propagate, never approve. */
export async function refreshCaseAudience(client, row, { authorizeCaseParticipant, authorizeRecorded }) {
  let changed = false;
  for (const invite of await currentCaseInvitations(client, row)) {
    const present = await authorizeCaseParticipant(participantBinding(invite)) === true;
    const authority = invite.status !== 'pending' || await authorizeRecorded('case.manage', invite.operator_grant, caseManagementScope(row)) === true;
    if (!present || !authority) {
      await client.query(`UPDATE sophie_core.case_participants SET status = 'revoked', settled_reason = $4, settled_at = clock_timestamp()
        WHERE guild_id = $1 AND case_id = $2 AND version = $3`, [row.guild_id, row.id, invite.version, present ? 'authority-revoked' : 'membership-revoked']);
      changed = true;
    }
  }
  return changed ? advanceCaseAudience(client, row) : row;
}
