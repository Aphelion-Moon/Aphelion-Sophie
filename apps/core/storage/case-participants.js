import { requireCondition, requireFreshObservation, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { validateCaseParticipantGrant } from '../../../contracts/case-participant.js';
import { MAX_CASE_PARTICIPANTS, requireParticipantChange } from '../../../modules/tickets/participants.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation } from './members.js';
import { loadCaseRecord, caseManagementScope } from './case-lookup.js';
import { advanceCaseAudience, currentCaseInvitations } from './case-audience.js';
import { registerCasePolicy } from './case-records.js';
import { receipt, saveReceipt, requireReceiptId } from './receipts.js';
import { recordParticipantInvitation, recordParticipantAction } from './case-participant-records.js';

/** Shared mutation for signed commands and later dashboard/contact workflows. No serialized actor is trusted. */
export function createCaseParticipantStore({ pool, clock, authorize, resolveCaseParticipant, authorizeCaseParticipant, policy }) {
  if (policy !== null) validateCasePolicy(policy);
  const fixed = policy === null ? null : structuredClone(policy), memberOperation = createMemberOperation({ pool, clock });
  const access = async (actor, row) => requireCondition(await authorize('case.manage', actor, caseManagementScope(row)) === true, 'OPERATION_DENIED');
  return Object.freeze({
    async changeCaseParticipant({ actor, observation, interactionId, id, expectedVersion, action, userId, reason, confirmed }) {
      requireReceiptId(interactionId); requireInteger(expectedVersion, 0, 2_147_483_644); requireParticipantChange({ action, userId, reason, confirmed });
      return memberOperation(observation, async (client, member) => {
        const row = await loadCaseRecord(client, { guildId: member.guildId, id, lock: true });
        requireCondition(fixed !== null && row.guild_id === fixed.guildId && row.user_id === member.userId, 'CASE_CONFIGURATION_REQUIRED');
        await access(actor, row); await registerCasePolicy(client, fixed); requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED');
        const grant = operatorGrant(actor);
        const previous = await receipt(client, member.guildId, grant.userId, interactionId, { action: `case.participant.${action}`, id, expectedVersion, userId, reason, confirmed });
        if (previous) return { ...previous, duplicate: true };
        requireCondition(row.version === expectedVersion, 'STALE_CASE_VERSION');
        requireCondition(row.create_started && row.channel_id !== null && (action === 'remove' || row.state === 'open'), 'CASE_STATE_CONFLICT');
        requireCondition(![row.user_id, fixed.botUserId, fixed.staff, fixed.leadOps, fixed.guildId].includes(userId), 'CASE_PARTICIPANT_DENIED');
        const invitations = await currentCaseInvitations(client, row), existing = invitations.find(invite => invite.user_id === userId);
        const version = row.version + 1; let invitationVersion;
        if (action === 'add') {
          requireCondition(member.observation.present && member.presenceEpoch === Number(row.presence_epoch), 'CASE_PARTICIPANT_DENIED');
          requireCondition(!existing && invitations.length < MAX_CASE_PARTICIPANTS, 'CASE_PARTICIPANT_CONFLICT');
          const binding = await resolveCaseParticipant({ guildId: member.guildId, userId });
          requireCondition(binding !== null, 'CASE_PARTICIPANT_DENIED'); validateCaseParticipantGrant(binding);
          requireCondition(binding.guildId === member.guildId && binding.userId === userId && await authorizeCaseParticipant(binding) === true, 'CASE_PARTICIPANT_DENIED');
          await recordParticipantInvitation(client, { guildId: member.guildId, caseId: id, version, binding, grant });
          invitationVersion = version;
        } else {
          requireCondition(existing !== undefined, 'CASE_PARTICIPANT_CONFLICT'); invitationVersion = existing.version;
          await client.query(`UPDATE sophie_core.case_participants SET status = 'removed', settled_reason = 'staff-removed', settled_at = clock_timestamp()
            WHERE guild_id = $1 AND case_id = $2 AND version = $3`, [member.guildId, id, invitationVersion]);
        }
        await access(actor, row); requireFreshObservation(member.observation, clock());
        await recordParticipantAction(client, { guildId: member.guildId, caseId: id, version, interactionId, action, userId, invitationVersion, reason, grant });
        await advanceCaseAudience(client, row);
        const result = { caseId: id, version }; await saveReceipt(client, member.guildId, interactionId, result);
        return { ...result, duplicate: false };
      });
    },
  });
}
