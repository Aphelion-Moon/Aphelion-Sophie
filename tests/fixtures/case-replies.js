import { createCaseReplies } from '../../apps/core/storage/case-replies.js';
import { createCaseReplyDelivery } from '../../apps/core/storage/case-reply-delivery.js';
import { createCaseReplyMessages } from '../../apps/core/discord/case-reply-messages.js';
import { createCaseReplyDispatcher } from '../../apps/core/discord/case-reply-dispatcher.js';
import { createCaseDeliveryIssueStore } from '../../apps/core/storage/case-delivery-issues.js';
import { createCaseDeliveryIssues } from '../../apps/core/discord/case-delivery-issues.js';
import { intakeDeliveryWorkflow } from './case-intake-delivery.js';
import { mapping } from './discord.js';
import { casePolicy } from './cases.js';
import { GUILD, OTHER, LEAD } from './domain.js';

export function replyRecoveryServices(f, overrides = {}) {
  const issues = createCaseDeliveryIssueStore({ pool: f.pool, clock: () => f.clock.now, authorize: f.authorization.authorize,
    policy: casePolicy, verification: f.discord.channels.verification, replyVerification: f.messages.verification, ...overrides });
  const issueCommands = createCaseDeliveryIssues({ authorization: f.authorization, discord: f.discord.roles,
    channels: f.discord.channels, replyMessages: f.messages, store: issues, enabled: () => f.clock.enabled });
  const listIssues = () => issues.listCaseDeliveryIssues({ actor: f.request().actor, guildId: GUILD });
  return { issues, issueCommands, listIssues };
}

export function replyServices(f, overrides = {}) {
  const clock = () => f.clock.now, messages = createCaseReplyMessages({ ...f.discord, mapping, policy: casePolicy, clock });
  const replies = createCaseReplies({ pool: f.pool, authorize: f.authorization.authorize, clock, ...overrides });
  const delivery = createCaseReplyDelivery({ pool: f.pool, clock, policy: casePolicy, authorizeRecorded: overrides.authorizeRecorded ?? f.authorization.authorizeRecorded,
    caseVerification: f.discord.channels.verification, messageVerification: messages.verification });
  const worker = createCaseReplyDispatcher({ outbox: f.outbox, store: delivery, roles: f.discord.roles, messages, enabled: () => f.clock.enabled });
  return { replies, delivery, messages, worker };
}
export async function replyWorkflow(cluster) {
  const f = await intakeDeliveryWorkflow(cluster, { extraCapabilities: { 'answers.publish': [LEAD] } }), opened = await f.openTicket('quick-help');
  const services = replyServices(f), actor = await f.actor(OTHER);
  const request = (changes = {}) => ({ actor, channelId: opened.channel_id, expectedVersion: opened.version,
    requestId: 'a'.repeat(64), text: 'SYNTHETIC human reply @everyone <@123> 🛰️', ...changes });
  const makeReady = () => f.admin.query("UPDATE sophie_core.outbox SET available_at = clock_timestamp() - interval '1 second' WHERE kind = 'case.reply' AND status = 'ready'");
  return { ...f, ...services, opened, request, makeReady };
}
