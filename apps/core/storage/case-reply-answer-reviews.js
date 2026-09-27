import { randomBytes } from 'node:crypto';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant, validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { requireAnswerName, requireAnswerHash } from '../../../modules/answers/index.js';
import { requireAnswerReviewToken } from '../../../modules/tickets/answer-replies.js';
import { casePlanKey } from '../../../modules/tickets/channel-policy.js';
import { loadCasePlan } from './case-audience.js';
import { answerDigest, checkedAnswer, latestAnswer, lockCuratedAnswers } from './curated-answer-records.js';
import { inTransaction } from './transaction.js';

const intentHash = (caseId, userId, version, name) => answerDigest([caseId, userId, version, name]);
const reference = row => ({ name: row.answer_name, revision: row.answer_revision, sha256: row.answer_sha256 });
function reviewHash(row) {
  validateOperatorGrant(row.operator_grant);
  return answerDigest([row.token,row.guild_id,row.user_id,row.case_id,row.channel_id,row.request_id,row.request_sha256,
    row.reviewed_version,row.plan_key,reference(row),operatorGrant(row.operator_grant),Number(row.created_at_ms),Number(row.expires_at_ms)]);
}

/** Bounded human review controls. Source text stays in retained public publications, never in tokens or routing. */
export function createCaseReplyAnswerReviews({ pool, clock, loadCase, authorizeCase, requestReply }) {
  async function check(client, actor, review, sending = false) {
    requireCondition(review && review.guild_id === actor.guildId && review.user_id === actor.userId, 'CASE_ACCESS_DENIED');
    requireCondition(review.review_sha256 === reviewHash(review) && review.request_sha256 ===
      intentHash(review.case_id, review.user_id, review.reviewed_version, review.answer_name), 'CASE_ANSWER_REVIEW_CORRUPT');
    const row = await loadCase(client, actor, review.channel_id, true); await authorizeCase(actor, row, sending);
    requireCondition(row.id === review.case_id, 'CASE_ACCESS_DENIED');
    return row;
  }
  async function fresh(client, actor, review, row) {
    const now = clock(); requireInteger(now);
    requireCondition(review.state === 'awaiting' && now >= Number(review.created_at_ms) && now < Number(review.expires_at_ms) &&
      answerDigest(operatorGrant(actor)) === answerDigest(operatorGrant(review.operator_grant)), 'CASE_ANSWER_REVIEW_STALE');
    requireCondition(row.version === review.reviewed_version && casePlanKey(await loadCasePlan(client, row)) === review.plan_key, 'CASE_ANSWER_REVIEW_STALE');
    await lockCuratedAnswers(client, actor.guildId);
    const answer = await latestAnswer(client, actor.guildId, review.answer_name);
    requireCondition(answer?.action === 'publish' && answer.revision === review.answer_revision && answer.sha256 === review.answer_sha256, 'ANSWER_REVIEW_STALE');
    return answer;
  }
  async function byToken(client, actor, token) {
    requireAnswerReviewToken(token);
    return (await client.query('SELECT * FROM sophie_core.case_answer_reviews WHERE guild_id = $1 AND token = $2 FOR UPDATE', [actor.guildId, token])).rows[0];
  }
  async function source(client, review) {
    const answer = checkedAnswer((await client.query(`SELECT * FROM sophie_core.curated_answers
      WHERE guild_id = $1 AND name = $2 AND revision = $3`, [review.guild_id, review.answer_name, review.answer_revision])).rows[0]);
    requireCondition(answer?.action === 'publish' && answer.sha256 === review.answer_sha256, 'CASE_ANSWER_REVIEW_CORRUPT'); return answer;
  }
  return Object.freeze({
    async prepareAnswerReview({ actor, channelId, requestId, expectedVersion, name }) {
      requireAnswerHash(requestId); requireAnswerName(name); requireInteger(expectedVersion, 0, 2147483646);
      return inTransaction(pool, async client => {
        const row = await loadCase(client, actor, channelId, true); await authorizeCase(actor, row, true);
        const grant = operatorGrant(actor), hash = intentHash(row.id, actor.userId, expectedVersion, name);
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 040))', [`${actor.guildId}:${actor.userId}`]);
        const prior = (await client.query('SELECT * FROM sophie_core.case_answer_reviews WHERE guild_id = $1 AND request_id = $2', [actor.guildId, requestId])).rows[0];
        if (prior) {
          requireCondition(prior.user_id === actor.userId && prior.request_sha256 === hash && prior.review_sha256 === reviewHash(prior), 'CASE_REPLY_REQUEST_COLLISION');
          await authorizeCase(actor, row, true); return { token: prior.token, duplicate: true };
        }
        requireCondition(row.version === expectedVersion, 'STALE_CASE_VERSION');
        const now = clock(); requireInteger(now);
        const capacity = (await client.query(`SELECT count(*)::int AS active FROM sophie_core.case_answer_reviews
          WHERE guild_id = $1 AND user_id = $2 AND state = 'awaiting' AND expires_at_ms > $3`, [actor.guildId, actor.userId, now])).rows[0];
        requireCondition(capacity.active < 5, 'CASE_ANSWER_REVIEW_LIMIT');
        await lockCuratedAnswers(client, actor.guildId); const answer = await latestAnswer(client, actor.guildId, name);
        requireCondition(answer?.action === 'publish', 'ANSWER_UNAVAILABLE');
        const review = { token: randomBytes(24).toString('hex'), guild_id: actor.guildId, user_id: actor.userId, case_id: row.id, channel_id: channelId,
          request_id: requestId, request_sha256: hash, reviewed_version: expectedVersion, plan_key: casePlanKey(await loadCasePlan(client, row)),
          answer_name: name, answer_revision: answer.revision, answer_sha256: answer.sha256, operator_grant: grant, created_at_ms: now, expires_at_ms: now + 600000 };
        await client.query(`INSERT INTO sophie_core.case_answer_reviews
          (token,guild_id,user_id,case_id,channel_id,request_id,request_sha256,reviewed_version,plan_key,answer_name,answer_revision,answer_sha256,operator_grant,created_at_ms,expires_at_ms,review_sha256)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`, [...Object.values(review),reviewHash(review)]);
        await authorizeCase(actor, row, true); return { token: review.token, duplicate: false };
      });
    },
    async readAnswerReview({ actor, requestId }) {
      requireAnswerHash(requestId);
      return inTransaction(pool, async client => {
        const review = (await client.query('SELECT * FROM sophie_core.case_answer_reviews WHERE guild_id = $1 AND request_id = $2 FOR UPDATE', [actor.guildId, requestId])).rows[0];
        const row = await check(client, actor, review);
        if (review.state !== 'awaiting') return { state: review.state };
        await authorizeCase(actor, row, true); const answer = await fresh(client, actor, review, row);
        await authorizeCase(actor, row, true);
        return { state: 'review', token: review.token, channelId: row.channel_id, version: row.version, answer: reference(review), document: answer.document };
      });
    },
    async confirmAnswerReview({ actor, token }) {
      return inTransaction(pool, async client => {
        const review = await byToken(client, actor, token), row = await check(client, actor, review);
        requireCondition(review.state !== 'cancelled', 'CASE_ANSWER_REVIEW_STALE');
        const answer = review.state === 'submitted' ? await source(client, review) : await fresh(client, actor, review, row);
        const result = await requestReply(client, { actor, channelId: review.channel_id, expectedVersion: review.reviewed_version,
          text: answer.document.text, answer: reference(review), requestId: answerDigest(['discord.answer-reply',actor.guildId,review.token]) });
        if (review.state === 'submitted') requireCondition(result.id === review.reply_id, 'CASE_ANSWER_REVIEW_CORRUPT');
        else await client.query("UPDATE sophie_core.case_answer_reviews SET state = 'submitted', reply_id = $2, settled_at = clock_timestamp() WHERE token = $1", [token, result.id]);
        return result;
      });
    },
    async cancelAnswerReview({ actor, token }) {
      return inTransaction(pool, async client => {
        const review = await byToken(client, actor, token), row = await check(client, actor, review);
        if (review.state === 'awaiting') await client.query("UPDATE sophie_core.case_answer_reviews SET state = 'cancelled', settled_at = clock_timestamp() WHERE token = $1", [token]);
        await authorizeCase(actor, row); return { state: review.state === 'submitted' ? 'submitted' : 'cancelled' };
      });
    },
  });
}
