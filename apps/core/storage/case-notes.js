import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { CASE_NOTE_PAGE_SIZE, requireNoteText, requireNoteRequestId, requireNotePosition } from '../../../modules/tickets/notes.js';
import { caseManagementScope, loadCaseRecord } from './case-lookup.js';
import { inTransaction } from './transaction.js';

/** Human-only, append-only case notes. Neither a participant binding nor channel visibility authorizes this store. */
export function createCaseNotes({ pool, authorize, clock }) {
  requireCondition(typeof authorize === 'function' && typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function access(actor, row) {
    requireCondition(await authorize('case.manage', actor, caseManagementScope(row)) === true, 'CASE_ACCESS_DENIED');
    requireCondition(['open', 'closed'].includes(row.state) && row.desired_access === row.state, 'CASE_ACCESS_DENIED');
  }
  async function lookup(client, options) {
    try { return await loadCaseRecord(client, options); }
    catch (error) { requireCondition(error.code !== 'CASE_NOT_FOUND', 'CASE_ACCESS_DENIED'); throw error; }
  }
  const view = row => ({ number: row.number, authorId: row.author_id, createdAt: Number(row.created_at_ms), text: row.body });
  return Object.freeze({
    async read({ actor, channelId, before = null }) {
      requireId(channelId); requireNotePosition(before);
      const row = await lookup(pool, { guildId: actor.guildId, channelId }); await access(actor, row);
      const entries = (await pool.query(`SELECT number, author_id, created_at_ms, body FROM sophie_core.case_notes
        WHERE guild_id = $1 AND case_id = $2 AND ($3::integer IS NULL OR number < $3) ORDER BY number DESC LIMIT $4`,
      [actor.guildId, row.id, before, CASE_NOTE_PAGE_SIZE + 1])).rows;
      const current = await lookup(pool, { guildId: actor.guildId, channelId }); await access(actor, current);
      requireCondition(current.id === row.id && current.version === row.version && current.policy_version === row.policy_version &&
        current.audience_version === row.audience_version, 'CASE_ACCESS_DENIED');
      return { channelId, entries: entries.slice(0, CASE_NOTE_PAGE_SIZE).map(view),
        next: entries.length > CASE_NOTE_PAGE_SIZE ? entries[CASE_NOTE_PAGE_SIZE - 1].number : null };
    },
    async append({ actor, channelId, requestId, text }) {
      requireId(channelId); requireNoteRequestId(requestId); requireNoteText(text);
      const sha256 = createHash('sha256').update(text).digest('hex');
      return inTransaction(pool, async client => {
        const row = await lookup(client, { guildId: actor.guildId, channelId, lock: true }); await access(actor, row);
        const grant = operatorGrant(actor);
        const previous = (await client.query('SELECT case_id, number, author_id, sha256 FROM sophie_core.case_notes WHERE guild_id = $1 AND request_id = $2', [actor.guildId, requestId])).rows[0];
        if (previous) {
          requireCondition(previous.case_id === row.id && previous.author_id === grant.userId && previous.sha256 === sha256, 'CASE_NOTE_REQUEST_COLLISION');
          await access(actor, row); return { number: previous.number, duplicate: true };
        }
        const number = (await client.query('SELECT COALESCE(max(number), 0) + 1 AS next FROM sophie_core.case_notes WHERE guild_id = $1 AND case_id = $2', [actor.guildId, row.id])).rows[0].next;
        requireInteger(number, 1, 2147483647); const now = clock(); requireInteger(now);
        const inserted = await client.query(`INSERT INTO sophie_core.case_notes (guild_id, case_id, number, request_id, author_id, operator_grant, body, sha256, created_at_ms)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (guild_id, request_id) DO NOTHING RETURNING number`,
        [actor.guildId, row.id, number, requestId, grant.userId, grant, text, sha256, now]);
        requireCondition(inserted.rowCount === 1, 'CASE_NOTE_REQUEST_COLLISION');
        await access(actor, row); return { number, duplicate: false };
      });
    },
  });
}
