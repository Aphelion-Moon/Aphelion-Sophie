import { createPrivateCaseMessages } from './private-case-messages.js';

/**
 * Keeps the Shuttle message interface separate from notification formats. A run's messages are its status card
 * (recordId is the screen ID) and its parts (recordId is the part ID); kind and the run's screenId choose the format.
 */
export function createOnboardingMessages(options) {
  const messages = createPrivateCaseMessages({ ...options, purpose: 'screen' });
  const convert = ({ screenId, recordId = screenId, ...value }) => ({ ...value, recordId, screenId });
  return Object.freeze({ guildId: messages.guildId, prepare: messages.prepare,
    verification: Object.freeze({
      receipt: (proof, expected) => messages.verification.receipt(proof, convert(expected)),
      candidate: (proof, expected) => messages.verification.candidate(proof, convert(expected)),
      written: (proof, expected) => messages.verification.written(proof, convert(expected)),
      matches: (proof, expected, options) => messages.verification.matches(proof, convert(expected), options),
    }),
    inspect: value => messages.inspect(convert(value)),
    create: (preparation, value) => messages.create(preparation, convert(value)),
    edit: (preparation, value) => messages.edit(preparation, convert(value)),
    remove: (preparation, value) => messages.remove(preparation, convert(value)),
  });
}
