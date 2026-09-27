import { randomBytes } from 'node:crypto';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';

const reasons = ['before-capture', 'capture-not-verified', 'capture-disabled', 'gateway-owner-acquired', 'gateway-disconnected',
  'gateway-session-reset', 'gateway-sequence-gap', 'guild-unavailable', 'permission-change', 'channel-change', 'channel-deleted', 'payload-rejected'];

/** Open intervals coalesce; closing an interval never removes the evidence or asserts complete coverage. */
export async function recordCaseCaptureGap(client, { guildId, channelId = null, from = null, to = null, reason, recovery = null }) {
  requireCondition(reasons.includes(reason), 'INVALID_CAPTURE_GAP');
  if (from !== null) requireInteger(from); if (to !== null) requireInteger(to);
  requireCondition((to === null) === (recovery === null), 'INVALID_CAPTURE_GAP');
  await client.query(`INSERT INTO sophie_core.case_capture_gaps
    (guild_id, token, channel_id, scope_key, started_at_ms, closed_at_ms, reasons, recovered_by)
    VALUES ($1, $2, $3, COALESCE($3, 'guild'), $4, $5, ARRAY[$6]::text[], $7)
    ON CONFLICT (guild_id, scope_key) WHERE closed_at_ms IS NULL DO UPDATE SET
      reasons = ARRAY(SELECT DISTINCT unnest(sophie_core.case_capture_gaps.reasons || EXCLUDED.reasons) ORDER BY 1)`,
  [guildId, randomBytes(24).toString('hex'), channelId, from, to, reason, recovery]);
}
export async function closeCaseCaptureGap(client, { guildId, channelId = null, at, recovery }) {
  requireInteger(at);
  await client.query(`UPDATE sophie_core.case_capture_gaps SET closed_at_ms = GREATEST(started_at_ms, $3), recovered_by = $4
    WHERE guild_id = $1 AND scope_key = COALESCE($2, 'guild') AND closed_at_ms IS NULL`, [guildId, channelId, at, recovery]);
}
export async function registerCaseCaptureChannel(client, { guildId, channelId, caseId, rootChannelId = channelId, parentId = null, at }) {
  requireInteger(at);
  const inserted = await client.query(`INSERT INTO sophie_core.case_capture_channels
    (guild_id, channel_id, case_id, root_channel_id, parent_id, registered_at_ms) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
  [guildId, channelId, caseId, rootChannelId, parentId, at]);
  const row = (await client.query('SELECT * FROM sophie_core.case_capture_channels WHERE guild_id = $1 AND channel_id = $2', [guildId, channelId])).rows[0];
  requireCondition(row.case_id === caseId && row.root_channel_id === rootChannelId, 'CASE_CAPTURE_CHANNEL_COLLISION');
  if (inserted.rowCount) {
    await recordCaseCaptureGap(client, { guildId, channelId, to: at, reason: 'before-capture', recovery: 'registered' });
    await recordCaseCaptureGap(client, { guildId, channelId, from: at, reason: 'capture-not-verified' });
    const gateway = (await client.query(`SELECT capture_enabled, status, capture_observed_at_ms, lease_until > clock_timestamp() AS active
      FROM sophie_core.gateway_lifecycle WHERE guild_id = $1`, [guildId])).rows[0];
    if (!gateway?.capture_enabled || gateway.status !== 'current' || !gateway.active) await recordCaseCaptureGap(client, {
      guildId, from: gateway?.capture_observed_at_ms == null ? null : Number(gateway.capture_observed_at_ms),
      reason: gateway?.capture_enabled ? 'gateway-disconnected' : 'capture-disabled',
    });
  }
  return row;
}
export async function markCaseCapturePermissions(client, guildId, { channelId = null, from = null, reason = 'permission-change' } = {}) {
  const rows = (await client.query(`SELECT channel_id FROM sophie_core.case_capture_channels WHERE guild_id = $1
    AND ($2::text IS NULL OR channel_id = $2 OR root_channel_id = $2) ORDER BY channel_id`, [guildId, channelId])).rows;
  for (const row of rows) await recordCaseCaptureGap(client, { guildId, channelId: row.channel_id, from, reason });
}
