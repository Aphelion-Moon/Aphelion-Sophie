import { createHash } from 'node:crypto';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { requireCaseLabels } from '../../../modules/tickets/labels.js';
import { loadCaseRecord, caseManagementScope } from './case-lookup.js';
import { inTransaction } from './transaction.js';

/** Shared human-only labels. Priority never grants access or changes delivery order. */
export function createCaseLabels({ pool, authorize, clock }) {
  requireCondition(typeof authorize === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function lookup(client, actor, { id = null, channelId = null }, lock = false) {
    let row;
    try { row = await loadCaseRecord(client, { guildId: actor.guildId, id, channelId, lock }); }
    catch (error) { requireCondition(error.code !== 'CASE_NOT_FOUND', 'CASE_ACCESS_DENIED'); throw error; }
    await access(actor, row); return row;
  }
  async function access(actor, row) {
    requireCondition(await authorize('case.manage', actor, caseManagementScope(row)) === true, 'CASE_ACCESS_DENIED');
    requireCondition(['open', 'closed'].includes(row.state) && row.desired_access === row.state, 'CASE_ACCESS_DENIED');
  }
  return Object.freeze({
    async readCaseLabels({ actor, before = null, ...reference }) {
      if (before !== null) requireInteger(before, 1, 2147483647);
      const row = await lookup(pool, actor, reference);
      const history = (await pool.query(`SELECT version, priority, tags, author_id, created_at_ms FROM sophie_core.case_label_changes
        WHERE guild_id = $1 AND case_id = $2 AND ($3::integer IS NULL OR version < $3) ORDER BY version DESC LIMIT 26`,
      [actor.guildId, row.id, before])).rows;
      const current = await lookup(pool, actor, reference);
      requireCondition(current.id === row.id && current.version === row.version && current.policy_version === row.policy_version &&
        current.audience_version === row.audience_version, 'CASE_ACCESS_DENIED');
      return { caseId: row.id, channelId: row.channel_id, version: row.version, priority: row.priority, tags: row.tags,
        history: history.slice(0, 25).map(item => ({ version: item.version, priority: item.priority, tags: item.tags,
          authorId: item.author_id, createdAt: Number(item.created_at_ms) })), next: history.length > 25 ? history[24].version : null };
    },
    async changeCaseLabels({ actor, requestId, expectedVersion, priority, tags, ...reference }) {
      requireCondition(typeof requestId === 'string' && /^[a-f0-9]{64}$/.test(requestId), 'CASE_LABEL_REQUEST_INVALID');
      requireInteger(expectedVersion, 0, 2147483644); requireCaseLabels({ priority, tags });
      const desired = { priority, tags: [...tags] };
      return inTransaction(pool, async client => {
        const row = await lookup(client, actor, reference, true), grant = operatorGrant(actor);
        const sha256 = createHash('sha256').update(JSON.stringify({ caseId: row.id, expectedVersion, ...desired })).digest('hex');
        const prior = (await client.query('SELECT case_id, version, author_id, request_sha256 FROM sophie_core.case_label_changes WHERE guild_id = $1 AND request_id = $2', [actor.guildId, requestId])).rows[0];
        if (prior) {
          requireCondition(prior.case_id === row.id && prior.author_id === grant.userId && prior.request_sha256 === sha256, 'CASE_LABEL_REQUEST_COLLISION');
          await access(actor, row); return { version: prior.version, duplicate: true };
        }
        requireCondition(row.version === expectedVersion, 'STALE_CASE_VERSION');
        const version = row.version + 1, now = clock(); requireInteger(now);
        const inserted = await client.query(`INSERT INTO sophie_core.case_label_changes
          (guild_id, case_id, version, request_id, request_sha256, author_id, operator_grant, previous_priority, previous_tags, priority, tags, created_at_ms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (guild_id, request_id) DO NOTHING RETURNING version`,
        [actor.guildId, row.id, version, requestId, sha256, grant.userId, grant, row.priority, row.tags, desired.priority, desired.tags, now]);
        requireCondition(inserted.rowCount === 1, 'CASE_LABEL_REQUEST_COLLISION');
        await client.query('UPDATE sophie_core.case_reservations SET version = $2, priority = $3, tags = $4 WHERE id = $1',
          [row.id, version, desired.priority, desired.tags]);
        await access(actor, row); return { version, duplicate: false };
      });
    },
  });
}
