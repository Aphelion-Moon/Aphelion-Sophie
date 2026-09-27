import { randomBytes } from 'node:crypto';

/** Core-only reference jobs contain identifiers, never copied filenames, URLs or file bodies. */
export async function recordCaseAttachments(client, { guildId, epoch, sequence, messageId, patch }) {
  if (!Array.isArray(patch.attachments)) return;
  for (let ordinal = 0; ordinal < patch.attachments.length; ordinal++) await client.query(`INSERT INTO sophie_core.case_attachment_jobs
    (token, guild_id, continuity_epoch, sequence, message_id, ordinal) VALUES ($1, $2, $3, $4, $5, $6)`,
  [randomBytes(24).toString('hex'), guildId, epoch, sequence, messageId, ordinal]);
}
