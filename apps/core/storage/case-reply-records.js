import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { canonicalAnswerReference } from '../../../modules/answers/index.js';

export const replyRequestHash = (caseId, authorId, version, text, answer = null) => createHash('sha256')
  .update(JSON.stringify([caseId, authorId, version, text, ...(answer === null ? [] : [canonicalAnswerReference(answer)])])).digest('hex');
export function requireReplyIntegrity(record) {
  requireCondition(replyRequestHash(record.case_id, record.author_id, record.reviewed_version, record.body, record.answer_reference ?? null) === record.request_sha256, 'CASE_REPLY_CORRUPT');
}

/** Caller holds the reply lock (or has just inserted it). Audit entries contain no authored text. */
export async function recordReplyEvent(client, record, event) {
  await client.query(`INSERT INTO sophie_core.case_reply_events (reply_id, number, event, message_id)
    SELECT $1, COALESCE(max(number), 0) + 1, $2, $3 FROM sophie_core.case_reply_events WHERE reply_id = $1`,
  [record.id, event, record.message_id ?? null]);
}
