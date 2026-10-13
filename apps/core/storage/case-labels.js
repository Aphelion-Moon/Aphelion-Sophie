import { createHash, randomBytes } from 'node:crypto';
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
    /** Last write wins; a repeated change just records the same labels again. */
    async changeCaseLabels({ actor, priority, tags, ...reference }) {
      requireCaseLabels({ priority, tags });
      const desired = { priority, tags: [...tags] };
      return inTransaction(pool, async client => {
        const row = await lookup(client, actor, reference, true), grant = operatorGrant(actor);
        const version = row.version + 1, now = clock(); requireInteger(now);
        // The change table keeps its original request columns; each change now gets a fresh request ID.
        const requestId = randomBytes(32).toString('hex');
        const sha256 = createHash('sha256').update(JSON.stringify({ caseId: row.id, version, ...desired })).digest('hex');
        await client.query(`INSERT INTO sophie_core.case_label_changes
          (guild_id, case_id, version, request_id, request_sha256, author_id, operator_grant, previous_priority, previous_tags, priority, tags, created_at_ms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [actor.guildId, row.id, version, requestId, sha256, grant.userId, grant, row.priority, row.tags, desired.priority, desired.tags, now]);
        await client.query('UPDATE sophie_core.case_reservations SET version = $2, priority = $3, tags = $4 WHERE id = $1',
          [row.id, version, desired.priority, desired.tags]);
        await access(actor, row); return { version };
      });
    },
  });
}
