import { createCaseReplyAnswerReviews } from './case-reply-answer-reviews.js';
import { randomBytes } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { requireReplyId, requireReplyText } from '../../../modules/tickets/replies.js';
import { casePlanKey } from '../../../modules/tickets/channel-policy.js';
import { loadCaseRecord, caseManagementScope } from './case-lookup.js';
import { loadCasePlan } from './case-audience.js';
import { recordReplyEvent, replyRequestHash, requireReplyIntegrity } from './case-reply-records.js';
import { enqueue } from './outbox.js';
import { inTransaction } from './transaction.js';
import { canonicalAnswerReference } from '../../../modules/answers/index.js';
import { lockCuratedAnswers, latestAnswer } from './curated-answer-records.js';

/** Shared human-only request ledger. A retained reply is not a claim of Discord delivery. */
export function createCaseReplies({ pool, authorize, clock }) {
  requireCondition(typeof authorize === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function access(actor, row, sending = false) {
    requireCondition(await authorize('case.manage', actor, caseManagementScope(row)) === true, 'CASE_ACCESS_DENIED');
    requireCondition((sending ? row.state === 'open' : ['open','closed'].includes(row.state)) && row.desired_access === row.state, 'CASE_ACCESS_DENIED');
  }
  async function lookup(client, actor, channelId, lock = false) {
    requireId(channelId);
    try { return await loadCaseRecord(client, { guildId: actor.guildId, channelId, lock }); }
    catch (error) { requireCondition(error.code !== 'CASE_NOT_FOUND', 'CASE_ACCESS_DENIED'); throw error; }
  }
  async function requestReply(client, { actor, channelId, requestId, expectedVersion, text, answer = null }) {
    requireCondition(typeof requestId === 'string' && /^[a-f0-9]{64}$/.test(requestId), 'CASE_REPLY_REQUEST_INVALID');
    requireInteger(expectedVersion, 0, 2147483646); requireReplyText(text);
    const reference = answer === null ? null : canonicalAnswerReference(answer);
    const row = await lookup(client, actor, channelId, true); await access(actor, row);
    const grant = operatorGrant(actor), hash = replyRequestHash(row.id, grant.userId, expectedVersion, text, reference);
    const prior = (await client.query('SELECT * FROM sophie_core.case_replies WHERE guild_id = $1 AND request_id = $2', [actor.guildId, requestId])).rows[0];
    if (prior) {
      requireReplyIntegrity(prior);
      requireCondition(prior.case_id === row.id && prior.author_id === grant.userId && prior.request_sha256 === hash, 'CASE_REPLY_REQUEST_COLLISION');
      await access(actor, row); return { id: prior.id, state: prior.state, duplicate: true };
    }
    await access(actor, row, true); requireCondition(row.version === expectedVersion, 'STALE_CASE_VERSION');
    if (reference !== null) {
      // A prior receipt resolves above even after withdrawal. New requests serialize with publication.
      await lockCuratedAnswers(client, actor.guildId);
      const current = await latestAnswer(client, actor.guildId, reference.name);
      requireCondition(current?.action === 'publish' && current.revision === reference.revision &&
        current.sha256 === reference.sha256 && current.document.text === text, 'ANSWER_REVIEW_STALE');
    }
    // Bound author-wide submissions across cases; a pending reply never expires to make room.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 036))', [`${actor.guildId}:${grant.userId}`]);
    const now = clock(); requireInteger(now);
    const capacity = (await client.query(`SELECT
      (SELECT count(*)::int FROM (SELECT 1 FROM sophie_core.case_replies WHERE guild_id = $1 AND author_id = $2 AND state = 'pending' LIMIT 5) a) AS authored,
      (SELECT count(*)::int FROM (SELECT 1 FROM sophie_core.case_replies WHERE guild_id = $1 AND case_id = $3 AND state = 'pending' LIMIT 20) q) AS queued,
      (SELECT created_at_ms FROM sophie_core.case_replies WHERE guild_id = $1 AND author_id = $2 ORDER BY created_at_ms DESC LIMIT 1) AS latest`,
    [actor.guildId, grant.userId, row.id])).rows[0];
    requireCondition(capacity.authored < 5 && capacity.queued < 20 && (capacity.latest === null || now - Number(capacity.latest) >= 3000), 'CASE_REPLY_LIMIT');
    const id = randomBytes(16).toString('hex'), planKey = casePlanKey(await loadCasePlan(client, row));
    const inserted = await client.query(`INSERT INTO sophie_core.case_replies
      (id, guild_id, case_id, user_id, channel_id, author_id, operator_grant, request_id, request_sha256, reviewed_version, plan_key, body, created_at_ms, answer_reference)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (guild_id, request_id) DO NOTHING RETURNING id`,
    [id, actor.guildId, row.id, row.user_id, channelId, grant.userId, grant, requestId, hash, expectedVersion, planKey, text, now, reference]);
    requireCondition(inserted.rowCount === 1, 'CASE_REPLY_REQUEST_COLLISION');
    await recordReplyEvent(client, { id }, 'requested');
    await enqueue(client, { kind: 'case.reply', operationId: `reply.${id}`, guildId: actor.guildId, userId: row.user_id, caseId: row.id, replyId: id });
    await access(actor, row, true); return { id, state: 'pending', duplicate: false };
  }
  const reviews = createCaseReplyAnswerReviews({ pool, clock, loadCase: lookup, authorizeCase: access, requestReply });
  return Object.freeze({
    ...reviews,
    request: args => inTransaction(pool, client => requestReply(client, args)),
    async read({ actor, channelId, before = null }) {
      if (before !== null) {
        requireCondition(typeof before === 'object' && Object.keys(before).length === 2, 'CASE_REPLY_CURSOR_INVALID');
        requireReplyId(before.id); requireInteger(before.createdAt);
      }
      const row = await lookup(pool, actor, channelId); await access(actor, row);
      const records = (await pool.query(`SELECT r.*, o.status AS job_status, o.last_error_code FROM sophie_core.case_replies r
        LEFT JOIN sophie_core.outbox o ON o.guild_id = r.guild_id AND o.operation_id = 'reply.' || r.id
        WHERE r.guild_id = $1 AND r.case_id = $2 AND ($3::bigint IS NULL OR (r.created_at_ms, r.id) < ($3, $4))
        ORDER BY r.created_at_ms DESC, r.id DESC LIMIT 26`, [actor.guildId, row.id, before?.createdAt ?? null, before?.id ?? null])).rows;
      const current = await lookup(pool, actor, channelId); await access(actor, current);
      requireCondition(current.id === row.id && current.version === row.version && current.audience_version === row.audience_version && current.policy_version === row.policy_version, 'CASE_ACCESS_DENIED');
      records.forEach(requireReplyIntegrity);
      const view = record => ({ id: record.id, authorId: record.author_id, text: record.body, createdAt: Number(record.created_at_ms), state: record.state,
        delivery: record.state !== 'pending' ? record.state : record.create_started && record.message_id === null ? 'uncertain' : record.job_status === 'parked' ? 'needs_review' : record.withdrawal_reason ? 'withdrawing' : 'pending',
        messageId: record.message_id, answer: record.answer_reference });
      const entries = records.slice(0, 25).map(view), last = entries.at(-1);
      return { channelId, version: row.version, canReply: row.state === 'open', entries, next: records.length > 25 ? { id: last.id, createdAt: last.createdAt } : null };
    },
  });
}
