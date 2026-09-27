import { createPrivateCaseMessages } from './private-case-messages.js';

/** Create/read only: delivery evidence never comes from scanning human messages. */
export function createOnboardingAlertMessages(options) {
  const messages = createPrivateCaseMessages({ ...options, purpose: 'alert' });
  const convert = ({ alertId, ...value }) => ({ ...value, recordId: alertId });
  return Object.freeze({ guildId: messages.guildId, prepare: (plan, channelId) => messages.prepare(plan, channelId, false),
    verification: Object.freeze({
      receipt: (proof, expected) => messages.verification.receipt(proof, convert(expected)),
      candidate: (proof, expected) => messages.verification.candidate(proof, convert(expected)),
      matches: (proof, expected) => messages.verification.matches(proof, convert(expected)),
    }),
    inspect: value => messages.inspect(convert(value)),
    create: (preparation, value) => messages.create(preparation, convert(value)),
  });
}
