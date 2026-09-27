import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { ANSWER_LIMIT, canonicalAnswer, requireAnswerName, requireAnswerHash } from '../../../modules/answers/index.js';
import { inTransaction } from './transaction.js';
import { answerDigest as digest, checkedAnswer as checked, latestAnswer, lockCuratedAnswers } from './curated-answer-records.js';

const revision = value => requireInteger(value, 0, 2_147_483_646);
function intent(value) {
  requireKeys(value, ['name','expectedRevision','action','document'], 'ANSWER_INPUT_INVALID');
  requireAnswerName(value.name); revision(value.expectedRevision);
  requireCondition(['publish','withdraw'].includes(value.action), 'ANSWER_INPUT_INVALID');
  if (value.action === 'withdraw') requireCondition(value.document === null, 'ANSWER_INPUT_INVALID');
  return { name: value.name, expectedRevision: value.expectedRevision, action: value.action,
    document: value.action === 'publish' ? canonicalAnswer(value.document) : null };
}

/** No ticket queries or sends. Publishing never grants case access. */
export function createCuratedAnswers({ pool, authorize, guildId }) {
  requireId(guildId); requireCondition(typeof authorize === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function access(actor, capability) {
    requireCondition(await authorize(capability, actor, { guildId }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  }
  const operation = (actor, capability, work) => inTransaction(pool, async client => {
    const grant = await access(actor, capability);
    // Serialize publication and lookup so a withdrawal cannot race a retained old selection.
    await lockCuratedAnswers(client, guildId);
    const result = await work(client, grant); await access(actor, capability); return result;
  });
  const latest = (client, name) => latestAnswer(client, guildId, name);
  async function current(client, request) {
    const row = await latest(client, request.name);
    requireCondition((row?.revision ?? 0) === request.expectedRevision, 'ANSWER_STALE');
    if (request.action === 'withdraw') requireCondition(row?.action === 'publish', 'ANSWER_UNAVAILABLE');
    if (row === null) {
      const count = (await client.query('SELECT count(DISTINCT name)::int AS count FROM sophie_core.curated_answers WHERE guild_id = $1', [guildId])).rows[0].count;
      requireCondition(count < ANSWER_LIMIT, 'ANSWER_LIMIT');
    }
    return row;
  }
  return Object.freeze({
    async list({ actor, after = null }) {
      if (after !== null) requireAnswerName(after);
      return operation(actor, 'answers.read', async client => {
        const rows = (await client.query(`SELECT * FROM (SELECT DISTINCT ON (name) * FROM sophie_core.curated_answers
          WHERE guild_id = $1 ORDER BY name, revision DESC) latest WHERE action = 'publish' AND ($2::text IS NULL OR name > $2)
          ORDER BY name LIMIT 26`, [guildId, after])).rows;
        const entries = rows.slice(0, 25).map(row => { const value = checked(row); return { name: value.name, revision: value.revision, title: value.document.title, sha256: value.sha256 }; });
        return { entries, next: rows.length > 25 ? entries.at(-1).name : null };
      });
    },
    async lookup({ actor, name }) {
      requireAnswerName(name);
      return operation(actor, 'answers.read', async client => {
        const row = await latest(client, name); requireCondition(row?.action === 'publish', 'ANSWER_UNAVAILABLE'); return row;
      });
    },
    async history({ actor, name, before = null }) {
      requireAnswerName(name); if (before !== null) { revision(before); requireCondition(before > 0, 'ANSWER_INPUT_INVALID'); }
      return operation(actor, 'answers.publish', async client => {
        const rows = (await client.query(`SELECT * FROM sophie_core.curated_answers WHERE guild_id = $1 AND name = $2
          AND ($3::integer IS NULL OR revision < $3) ORDER BY revision DESC LIMIT 11`, [guildId, name, before])).rows;
        const entries = rows.slice(0, 10).map(checked); return { name, entries, nextBefore: rows.length > 10 ? entries.at(-1).revision : null };
      });
    },
    async review({ actor, ...fields }) {
      const request = intent(fields);
      return operation(actor, 'answers.publish', async client => ({ ...request, previous: await current(client, request),
        reviewSha256: digest(request), preservesHistory: true, audience: 'current-guild-members' }));
    },
    async change({ actor, requestId, reviewSha256, confirmed, approvedPublic, ...fields }) {
      const request = intent(fields); requireAnswerHash(requestId); requireAnswerHash(reviewSha256);
      requireCondition(confirmed === true && approvedPublic === true, 'ANSWER_CONFIRMATION_REQUIRED');
      requireCondition(reviewSha256 === digest(request), 'ANSWER_REVIEW_STALE');
      return operation(actor, 'answers.publish', async (client, grant) => {
        const prior = (await client.query('SELECT * FROM sophie_core.curated_answers WHERE guild_id = $1 AND request_id = $2', [guildId, requestId])).rows[0];
        if (prior) {
          checked(prior); requireCondition(prior.operator_grant.userId === grant.userId && prior.request_sha256 === reviewSha256, 'ANSWER_REQUEST_COLLISION');
          return { name: prior.name, revision: prior.revision, action: prior.action, duplicate: true };
        }
        await current(client, request); const next = request.expectedRevision + 1; revision(next);
        await client.query(`INSERT INTO sophie_core.curated_answers
          (guild_id, name, revision, action, document, document_sha256, request_id, request_sha256, operator_grant, approved_public)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`, [guildId, request.name, next, request.action, request.document,
          request.document === null ? null : digest(request.document), requestId, reviewSha256, grant]);
        return { name: request.name, revision: next, action: request.action, duplicate: false };
      });
    },
  });
}
