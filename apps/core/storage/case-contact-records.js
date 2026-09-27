import { requireCondition } from '../../../contracts/validation.js';
import { validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { validateCaseAudience } from '../../../modules/tickets/participants.js';
import { caseManagementScope } from './case-lookup.js';
import { currentCaseInvitations } from './case-audience.js';
import { recordParticipantInvitation, recordParticipantAction } from './case-participant-records.js';

export function requireContactBindings(bindings, policy, openerId) {
  validateCaseAudience({ version: 1, participants: bindings }, policy.guildId, openerId);
  requireCondition(bindings.length > 0 && bindings.every(binding => ![policy.botUserId, policy.staff, policy.leadOps, policy.guildId].includes(binding.userId)),
    'CASE_PARTICIPANT_DENIED');
}
export async function recordInitialContactAudience(client, { caseId, guildId, bindings, interactionId, grant }) {
  for (const [index, binding] of bindings.entries()) {
    const version = index + 1;
    await recordParticipantInvitation(client, { guildId, caseId, version, binding, grant });
    await recordParticipantAction(client, { guildId, caseId, version, interactionId, action: 'add', userId: binding.userId,
      invitationVersion: version, reason: 'case-context', grant });
  }
  await client.query('UPDATE sophie_core.case_reservations SET version = $2 WHERE id = $1', [caseId, bindings.length]);
  await client.query('UPDATE sophie_core.case_provisions SET audience_version = 1 WHERE case_id = $1', [caseId]);
}

/** Before the first confirmed audience, the initiating Staff action must still be valid. */
export async function currentContactSource(client, row, authorizeRecorded) {
  if (row.type !== 'staff-contact') return true;
  const source = (await client.query('SELECT contact_status, operator_grant FROM sophie_core.case_intakes WHERE guild_id = $1 AND case_id = $2', [row.guild_id, row.id])).rows[0];
  requireCondition(source && ['pending', 'confirmed', 'revoked', 'superseded'].includes(source.contact_status), 'CASE_CONTACT_SOURCE_MISSING');
  if (source.contact_status !== 'pending') return source.contact_status !== 'revoked';
  validateOperatorGrant(source.operator_grant);
  const allowed = await authorizeRecorded('case.manage', source.operator_grant, caseManagementScope(row)) === true &&
    (await currentCaseInvitations(client, row)).length > 0;
  if (!allowed) await client.query("UPDATE sophie_core.case_intakes SET contact_status = 'revoked' WHERE guild_id = $1 AND case_id = $2", [row.guild_id, row.id]);
  return allowed;
}
