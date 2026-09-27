import { recordCaseCaptureGap, registerCaseCaptureChannel, markCaseCapturePermissions } from './case-capture-coverage.js';
import { recordCaseAttachments } from './case-attachment-records.js';

async function channels(client, guildId, event) {
  // Mapping comes from retained case provenance, never category placement or a user-supplied case ID.
  for (const item of event.items) {
    let row = (await client.query('SELECT * FROM sophie_core.case_capture_channels WHERE guild_id = $1 AND channel_id = $2', [guildId, item.channelId])).rows[0];
    if (!row && item.parentId !== null && !item.deleted) {
      const parent = (await client.query('SELECT * FROM sophie_core.case_capture_channels WHERE guild_id = $1 AND channel_id = $2', [guildId, item.parentId])).rows[0];
      if (parent) row = await registerCaseCaptureChannel(client, { guildId, channelId: item.channelId, caseId: parent.case_id,
        rootChannelId: parent.root_channel_id, parentId: item.parentId, at: event.observedAt });
    }
    if (!row) continue;
    await client.query(`INSERT INTO sophie_core.case_exclusions (guild_id, channel_id, parent_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [guildId, item.channelId, item.parentId]);
    await client.query(`UPDATE sophie_core.case_capture_channels SET parent_id = $3,
      deleted_at_ms = CASE WHEN $4 THEN $5 ELSE deleted_at_ms END WHERE guild_id = $1 AND channel_id = $2`,
    [guildId, item.channelId, item.parentId, item.deleted, event.observedAt]);
    await markCaseCapturePermissions(client, guildId, { channelId: item.channelId, from: event.observedAt, reason: item.deleted ? 'channel-deleted' : 'channel-change' });
  }
}

/** Called only inside the Gateway cursor transaction. Content never enters cursor, jobs, logs or knowledge. */
export async function recordCaseConversation(client, { capture, proof, guildId, epoch, sequence }) {
  if (proof === null) return;
  const event = capture.inspect(proof);
  if (event.kind === 'channels') return channels(client, guildId, event);
  const owned = (await client.query('SELECT 1 FROM sophie_core.case_capture_channels WHERE guild_id = $1 AND channel_id = $2', [guildId, event.channelId])).rowCount;
  if (!owned) return;
  if (event.kind === 'rejected') {
    await recordCaseCaptureGap(client, { guildId, channelId: event.channelId, from: event.observedAt, to: event.observedAt,
      reason: 'payload-rejected', recovery: 'observed' }); return;
  }
  const body = event.kind === 'delete' ? { patch: {}, issues: [] } : capture.content(proof);
  for (const messageId of event.messageIds) {
    await client.query(`INSERT INTO sophie_core.case_message_observations
    (guild_id, channel_id, message_id, continuity_epoch, sequence, kind, observed_at_ms, patch, issues)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
  [guildId, event.channelId, messageId, epoch, sequence, event.kind, event.observedAt, JSON.stringify(body.patch), JSON.stringify(body.issues)]);
    await recordCaseAttachments(client, { guildId, epoch, sequence, messageId, patch: body.patch });
  }
  if (body.issues.length) await recordCaseCaptureGap(client, { guildId, channelId: event.channelId, from: event.observedAt, to: event.observedAt,
    reason: 'payload-rejected', recovery: 'observed' });
}
