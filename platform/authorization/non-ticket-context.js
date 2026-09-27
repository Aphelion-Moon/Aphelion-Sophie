import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';

/** Metadata only. The core must assemble this from current policy and its permanent case registry. */
export function requireNonTicketContext(context, now) {
  requireKeys(context, ['guildId', 'channelId', 'checkedAt', 'allowlisted', 'actorAllowed', 'registryAvailable', 'ancestryComplete', 'lineage']);
  requireId(context.guildId);
  requireId(context.channelId);
  requireInteger(now);
  requireInteger(context.checkedAt);
  requireCondition(context.checkedAt <= now && now - context.checkedAt <= 5_000, 'AI_CONTEXT_STALE');
  requireCondition(context.registryAvailable === true && context.ancestryComplete === true, 'AI_CLASSIFICATION_UNKNOWN');
  requireCondition(context.allowlisted === true && context.actorAllowed === true, 'AI_NOT_ALLOWED');
  requireCondition(Array.isArray(context.lineage) && context.lineage.length > 0 && context.lineage.length <= 16, 'AI_CLASSIFICATION_UNKNOWN');
  const ids = new Set();
  for (const node of context.lineage) {
    requireKeys(node, ['id', 'classification']);
    requireId(node.id);
    requireCondition(!ids.has(node.id), 'AI_CLASSIFICATION_UNKNOWN');
    ids.add(node.id);
    requireCondition(node.classification === 'non_ticket', 'AI_CASE_EXCLUDED');
  }
  requireCondition(context.lineage[0].id === context.channelId, 'AI_DESTINATION_MISMATCH');
}
