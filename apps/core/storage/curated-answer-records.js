import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { canonicalAnswer } from '../../../modules/answers/index.js';

export const answerDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const lockCuratedAnswers = (client, guildId) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 038))', [guildId]);
export function checkedAnswer(row) {
  if (!row) return null;
  const document = row.action === 'publish' ? canonicalAnswer(row.document) : null;
  requireCondition(row.action === 'publish' ? answerDigest(document) === row.document_sha256 : row.document === null && row.document_sha256 === null, 'ANSWER_CORRUPT');
  const request = { name: row.name, expectedRevision: row.revision - 1, action: row.action, document };
  requireCondition(answerDigest(request) === row.request_sha256 && row.approved_public === true, 'ANSWER_CORRUPT');
  return { name: row.name, revision: row.revision, action: row.action, document, sha256: row.document_sha256,
    authorId: row.operator_grant.userId, createdAt: row.created_at.toISOString() };
}
/** Caller holds the guild library lock, including when selecting within a reply transaction. */
export async function latestAnswer(client, guildId, name) {
  return checkedAnswer((await client.query(`SELECT * FROM sophie_core.curated_answers
    WHERE guild_id = $1 AND name = $2 ORDER BY revision DESC LIMIT 1`, [guildId, name])).rows[0]);
}
