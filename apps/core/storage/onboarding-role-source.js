/** Closed relationship: a role job must originate in an actual grant for a bound Onboarding. */
export const onboardingRoleSourceJoins = `
  JOIN sophie_core.outbox g ON g.guild_id = o.guild_id AND g.user_id = o.user_id AND g.kind = 'whitelist.grant'
    AND g.operation_id = CASE WHEN o.kind = 'whitelist.grant' THEN o.operation_id ELSE o.effect->>'sourceOperation' END
  JOIN sophie_core.sessions s ON s.id = g.effect->>'sessionId' AND s.guild_id = g.guild_id AND s.user_id = g.user_id
  JOIN sophie_core.shuttle_cases b ON b.session_id = s.id AND b.guild_id = s.guild_id AND b.user_id = s.user_id
  JOIN sophie_core.case_reservations r ON r.id = b.case_id AND r.guild_id = b.guild_id AND r.user_id = b.user_id`;

export async function onboardingRoleSource(client, { guildId, operationId }) {
  return (await client.query(`SELECT s.id, s.guild_id, s.user_id, o.status, o.fence FROM sophie_core.outbox o
    ${onboardingRoleSourceJoins}
    WHERE o.guild_id = $1 AND o.operation_id = $2 AND o.kind IN ('whitelist.grant', 'whitelist.reconcile')
      AND r.type = 'shuttle'`, [guildId, operationId])).rows[0] ?? null;
}
