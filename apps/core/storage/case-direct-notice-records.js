import { randomBytes } from 'node:crypto';
import { enqueue } from './outbox.js';

/** Called in the verified channel transaction. Existing ordinary cases receive one link, never a bulk member DM. */
export async function recordCaseDirectNotice(client, plan) {
  const inserted = await client.query(`INSERT INTO sophie_core.case_direct_notices (case_id, guild_id, user_id, nonce)
    SELECT case_id, guild_id, user_id, $4 FROM sophie_core.case_intakes
    WHERE case_id = $1 AND guild_id = $2 AND user_id = $3
    ON CONFLICT (case_id) DO NOTHING RETURNING case_id`, [plan.id, plan.guildId, plan.openerId, randomBytes(12).toString('hex')]);
  if (inserted.rowCount) await enqueue(client, { kind: 'case.dm', operationId: `dm.${plan.id}`,
    guildId: plan.guildId, userId: plan.openerId, caseId: plan.id });
}
