import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { canonicalAutomationAction } from './index.js';

export const requireAutomationId = (id, code = 'AUTOMATION_CORRUPT') => requireCondition(typeof id === 'string' && /^[a-f0-9]{32}$/.test(id), code);
export function automationPlanKey(plan) {
  requireKeys(plan, ['id','guildId','userId','channelId','sourceMessageId','policyRevision','action','expiresAt']);
  requireAutomationId(plan.id);
  for (const key of ['guildId','userId','channelId','sourceMessageId']) requireId(plan[key]);
  requireInteger(plan.policyRevision, 1); requireInteger(plan.expiresAt);
  return JSON.stringify([plan.id,plan.guildId,plan.userId,plan.channelId,plan.sourceMessageId,plan.policyRevision,
    canonicalAutomationAction(plan.action),plan.expiresAt]);
}
export function automationPayload(id, action) {
  requireAutomationId(id); const value = canonicalAutomationAction(action);
  requireCondition(value.kind === 'message', 'AUTOMATION_INPUT_INVALID');
  return { content: value.text, embeds: [], components: [{ type: 1, components: [{ type: 2, style: 2,
    label: 'Automated response', disabled: true, custom_id: `sophie:auto:${id}` }] }],
  allowed_mentions: { parse: [], users: [], roles: [], replied_user: false }, flags: 4 };
}
export function automationEmoji(action) {
  const value = canonicalAutomationAction(action); requireCondition(value.kind === 'reaction', 'AUTOMATION_INPUT_INVALID');
  return value.emoji.id === null ? value.emoji.name : `${value.emoji.name}:${value.emoji.id}`;
}
