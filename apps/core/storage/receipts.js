import { requireCondition, requireId } from '../../../contracts/validation.js';

/** Discord keeps numeric IDs; authenticated dashboard adapters use a disjoint bounded namespace. */
export function requireReceiptId(value) {
  if (typeof value === 'string' && /^dashboard\.[a-f0-9]{64}$/.test(value)) return;
  requireId(value);
}

/** Read-only replay check before acquiring external proofs. The caller must reauthorize the actual resource. */
export async function readReceipt(client, guildId, userId, interactionId, request) {
  requireReceiptId(interactionId);
  const existing = await client.query(`SELECT user_id, request = $3::jsonb AS same, result FROM sophie_core.receipts
    WHERE guild_id = $1 AND interaction_id = $2`, [guildId, interactionId, request]);
  if (!existing.rowCount) return null;
  requireCondition(existing.rows[0].user_id === userId && existing.rows[0].same, 'INTERACTION_ID_COLLISION');
  requireCondition(existing.rows[0].result !== null, 'INCOMPLETE_INTERACTION');
  return existing.rows[0].result;
}

/** Must share the transaction that commits the domain state and effects. */
export async function receipt(client, guildId, userId, interactionId, request) {
  requireReceiptId(interactionId);
  const inserted = await client.query(`INSERT INTO sophie_core.receipts (guild_id, interaction_id, user_id, request)
    VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING interaction_id`, [guildId, interactionId, userId, request]);
  if (inserted.rowCount) return null;
  const previous = await readReceipt(client, guildId, userId, interactionId, request);
  requireCondition(previous !== null, 'INTERACTION_ID_COLLISION'); return previous;
}

export async function saveReceipt(client, guildId, interactionId, result) {
  await client.query('UPDATE sophie_core.receipts SET result = $3 WHERE guild_id = $1 AND interaction_id = $2', [guildId, interactionId, result]);
}
