import { requireCondition } from '../../contracts/validation.js';

export const requireAnswerReviewToken = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{48}$/.test(value), 'CASE_ANSWER_REVIEW_INVALID');
export function answerReplyCommandOption(reference) {
  return { type: 1, name: 'answer', description: 'Review an approved public answer before sending it to a private case.', options: [
    { ...reference }, { type: 3, name: 'name', description: 'Approved answer name from /answer list.', required: true, max_length: 40 },
  ] };
}
export function parseAnswerReplyControl(value) {
  const match = typeof value === 'string' && /^sophie:answer-reply:(confirm|cancel):([a-f0-9]{48})$/.exec(value);
  requireCondition(match !== null && match !== false, 'CASE_ANSWER_REVIEW_INVALID');
  return { command: `ticket.answer.${match[1]}`, reviewToken: match[2] };
}
