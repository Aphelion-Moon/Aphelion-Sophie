import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { onboardingDeliverySource } from './onboarding-delivery-source.js';

/** Called in the same transaction as parking; never registers arbitrary jobs or case text. */
export async function recordOnboardingDeliveryIssue(client, claim) {
  const source = await onboardingDeliverySource(client, claim);
  if (!source || source.status !== 'parked') return;
  const result = await client.query(`INSERT INTO sophie_core.shuttle_delivery_issues
    (id, guild_id, operation_id, user_id, session_id, parked_fence) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (guild_id, operation_id) DO UPDATE SET
      revision = shuttle_delivery_issues.revision + CASE WHEN shuttle_delivery_issues.parked_fence = EXCLUDED.parked_fence THEN 0 ELSE 1 END,
      parked_fence = EXCLUDED.parked_fence
    WHERE shuttle_delivery_issues.user_id = EXCLUDED.user_id AND shuttle_delivery_issues.session_id = EXCLUDED.session_id
    RETURNING id`, [randomBytes(16).toString('hex'), source.guild_id, claim.operationId, source.user_id, source.id, source.fence]);
  requireCondition(result.rowCount === 1, 'SHUTTLE_ISSUE_COLLISION');
}
