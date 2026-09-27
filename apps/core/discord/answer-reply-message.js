import { defaultSystemText } from '../../../contracts/system-messages.js';
import { requireId, requireInteger } from '../../../contracts/validation.js';
import { canonicalAnswerReference, canonicalAnswer } from '../../../modules/answers/index.js';
import { requireAnswerReviewToken } from '../../../modules/tickets/answer-replies.js';

export function answerReplyReviewMessage(view, text = defaultSystemText) {
  if (view.state !== 'review') return { content: view.state === 'denied' ? text("answers.answer_reply_message.current_staff_access_to_this_case_is_required_d5a019") :
    view.state === 'submitted' ? text("answers.answer_reply_message.this_review_already_has_a_recorded_reply_requ_024665") :
      text("answers.answer_reply_message.this_review_is_unavailable_cancelled_expired__758570"), embeds: [], components: [] };
  requireAnswerReviewToken(view.token); requireId(view.channelId); requireInteger(view.version, 0, 2147483646);
  const reference = canonicalAnswerReference(view.answer), document = canonicalAnswer(view.document);
  return { content: text("answers.answer_reply_message.review_reply_to_case_channel_case_version_app_992bac", { channelId: view.channelId, version: view.version, name: reference.name, revision: reference.revision }),
    embeds: [{ title: document.title, description: document.text, footer: { text: document.source } }],
    components: [{ type: 1, components: [
      { type: 2, style: 3, label: text("answers.answer_reply_message.confirm_reply_f44258"), custom_id: `sophie:answer-reply:confirm:${view.token}` },
      { type: 2, style: 2, label: text("answers.answer_reply_message.cancel_review_87a8ca"), custom_id: `sophie:answer-reply:cancel:${view.token}` },
    ] }] };
}
