import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { onboardingRoleSource } from './onboarding-role-source.js';

/** Internal event recording. Returns a narrow intent for the caller's same transaction. */
export async function recordOnboardingAlert(client, { guildId, userId, sessionId, kind, sourceId }) {
  requireCondition(['help', 'delivery'].includes(kind), 'INVALID_SHUTTLE_ALERT');
  const id = randomBytes(16).toString('hex');
  const inserted = await client.query(`INSERT INTO sophie_core.shuttle_alerts
    (id, guild_id, user_id, session_id, kind, source_id) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (guild_id, kind, source_id) DO NOTHING RETURNING id, revision`, [id, guildId, userId, sessionId, kind, sourceId]);
  let alert = inserted.rows[0];
  if (!alert && kind === 'delivery') {
    // A resolved temporary failure must not consume the run's first actual notice.
    // Never clear a possible send or reping a previously confirmed message.
    alert = (await client.query(`UPDATE sophie_core.shuttle_alerts SET state = 'pending', revision = revision + 1
      WHERE guild_id = $1 AND user_id = $2 AND session_id = $3 AND kind = 'delivery' AND source_id = $3
        AND state = 'obsolete' AND NOT create_started AND message_id IS NULL RETURNING id, revision`,
    [guildId, userId, sessionId])).rows[0];
  }
  if (!alert) return null;
  return { kind: 'shuttle.alert', operationId: `shuttle-alert.${alert.id}.${alert.revision}`,
    guildId, userId, alertId: alert.id, revision: alert.revision };
}

/** Role failures can alert only the bound Onboarding, never other case types or alert jobs. */
export async function recordOnboardingDeliveryAlert(client, claim) {
  const source = await onboardingRoleSource(client, claim);
  return source ? recordOnboardingAlert(client, { guildId: source.guild_id, userId: source.user_id,
    sessionId: source.id, kind: 'delivery', sourceId: source.id }) : null;
}
