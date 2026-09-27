import { createPrivateCaseMessages } from './private-case-messages.js';

/** Private human replies only. Withdrawal removes an observed own message, never a retained case record. */
export function createCaseReplyMessages(options) {
  const messages = createPrivateCaseMessages({ ...options, purpose: 'reply' });
  return Object.freeze({ guildId: messages.guildId, verification: messages.verification,
    prepare: (plan, channelId, withdrawing = false) => messages.prepare(plan, channelId, withdrawing),
    inspect: messages.inspect, create: messages.create, withdraw: messages.withdraw });
}
