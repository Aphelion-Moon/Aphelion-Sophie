import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { validateOperatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalAutomation } from '../../../modules/automation/index.js';

export const automationDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const lockAutomationPolicy = (client,guildId) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 041))',[guildId]);
export function checkedAutomationPolicy(row) {
  if (!row) return null;
  validateOperatorGrant(row.operator_grant);
  requireCondition(row.operator_grant.guildId === row.guild_id && ['publish','withdraw'].includes(row.action), 'AUTOMATION_CORRUPT');
  const document = row.action === 'publish' ? canonicalAutomation(row.document) : null;
  requireCondition(row.action === 'publish' ? automationDigest(document) === row.document_sha256 : row.document === null && row.document_sha256 === null, 'AUTOMATION_CORRUPT');
  requireCondition(automationDigest({ expectedRevision: row.revision - 1, action: row.action, document }) === row.request_sha256 && row.approved_public === true, 'AUTOMATION_CORRUPT');
  return { revision: row.revision, action: row.action, document, sha256: row.document_sha256, authorId: row.operator_grant.userId, createdAt: row.created_at.toISOString() };
}
export async function latestAutomationPolicy(client,guildId) {
  return checkedAutomationPolicy((await client.query('SELECT * FROM sophie_core.automation_policies WHERE guild_id = $1 ORDER BY revision DESC LIMIT 1',[guildId])).rows[0]);
}
