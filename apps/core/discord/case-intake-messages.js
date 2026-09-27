import { createPrivateCaseMessages } from './private-case-messages.js';

/** Fixed retained-intake format; no edit, history, AI, remote template or arbitrary destination method. */
export function createCaseIntakeMessages(options) {
  const messages = createPrivateCaseMessages({ ...options, purpose: 'intake' });
  return Object.freeze({ guildId: messages.guildId, verification: messages.verification,
    prepare: (plan, channelId, notify) => messages.prepare(plan, channelId, false, notify),
    inspect: messages.inspect, create: messages.create });
}
