/** Internal transaction helpers: callers check current authority, versions and explicit confirmation. */
export async function recordParticipantInvitation(client, { guildId, caseId, version, binding, grant }) {
  await client.query(`INSERT INTO sophie_core.case_participants (guild_id, case_id, version, user_id, presence_epoch, operator_grant)
    VALUES ($1, $2, $3, $4, $5, $6)`, [guildId, caseId, version, binding.userId, binding.presenceEpoch, grant]);
}
export async function recordParticipantAction(client, { guildId, caseId, version, interactionId, action, userId, invitationVersion, reason, grant }) {
  await client.query(`INSERT INTO sophie_core.case_participant_actions
    (guild_id, case_id, version, interaction_id, action, user_id, invitation_version, reason, operator_grant)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [guildId, caseId, version, interactionId, action, userId, invitationVersion, reason, grant]);
}
