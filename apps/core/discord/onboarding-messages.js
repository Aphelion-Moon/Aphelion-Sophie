import { createPrivateCaseMessages } from './private-case-messages.js';

/** Keeps the existing screen interface separate from notification formats. */
export function createOnboardingMessages(options) {
  const messages = createPrivateCaseMessages({ ...options, purpose: 'screen' });
  const convert = ({ screenId, ...value }) => ({ ...value, recordId: screenId });
  return Object.freeze({ guildId: messages.guildId, prepare: messages.prepare,
    verification: Object.freeze({
      receipt: (proof, expected) => messages.verification.receipt(proof, convert(expected)),
      candidate: (proof, expected) => messages.verification.candidate(proof, convert(expected)),
      matches: (proof, expected) => messages.verification.matches(proof, convert(expected)),
    }),
    inspect: value => messages.inspect(convert(value)),
    create: (preparation, value) => messages.create(preparation, convert(value)),
    edit: (preparation, value) => messages.edit(preparation, convert(value)),
  });
}
