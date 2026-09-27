import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';

export const ordinaryDeliveryJoins = `JOIN sophie_core.case_reservations r ON r.id = o.effect->>'caseId'
  AND r.guild_id = o.guild_id AND r.user_id = o.user_id
  JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id`;
export const ordinaryDeliveryScope = `r.type <> 'shuttle' AND o.effect->>'kind' = o.kind
  AND o.effect->>'guildId' = o.guild_id AND o.effect->>'userId' = o.user_id AND o.effect->>'operationId' = o.operation_id
  AND ((o.kind = 'case.provision' AND o.effect->>'type' = r.type) OR (o.kind = 'case.intake' AND EXISTS (
    SELECT 1 FROM sophie_core.case_intakes intake WHERE intake.case_id = r.id AND intake.guild_id = r.guild_id
      AND intake.user_id = r.user_id AND intake.case_type = r.type)) OR (o.kind = 'case.reply' AND EXISTS (
    SELECT 1 FROM sophie_core.case_replies reply WHERE reply.id = o.effect->>'replyId' AND reply.case_id = r.id
      AND reply.guild_id = r.guild_id AND reply.user_id = r.user_id)))`;

/** Same transaction as parking. Only retained ordinary case/artifact ownership can create an issue. */
export async function recordCaseDeliveryIssue(client, { guildId, operationId }) {
  const row = (await client.query(`SELECT o.*, r.id AS case_id FROM sophie_core.outbox o ${ordinaryDeliveryJoins}
    WHERE o.guild_id = $1 AND o.operation_id = $2 AND o.status = 'parked' AND ${ordinaryDeliveryScope}`, [guildId, operationId])).rows[0];
  if (!row) return;
  const saved = await client.query(`INSERT INTO sophie_core.case_delivery_issues
    (id, guild_id, operation_id, user_id, case_id, parked_fence) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (guild_id, operation_id) DO UPDATE SET
      revision = case_delivery_issues.revision + CASE WHEN case_delivery_issues.parked_fence = EXCLUDED.parked_fence THEN 0 ELSE 1 END,
      parked_fence = EXCLUDED.parked_fence
    WHERE case_delivery_issues.user_id = EXCLUDED.user_id AND case_delivery_issues.case_id = EXCLUDED.case_id
    RETURNING id`, [randomBytes(16).toString('hex'), guildId, operationId, row.user_id, row.case_id, row.fence]);
  requireCondition(saved.rowCount === 1, 'CASE_ISSUE_COLLISION');
}
