import { defaultSystemText } from '../../../contracts/system-messages.js';
import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';
import { onboardingNavigationReply } from '../../../modules/onboarding/navigation.js';
import { onboardingHelpQueueReply } from '../../../modules/onboarding/assistance.js';
import { onboardingIssueQueueReply } from '../../../modules/onboarding/delivery-issues.js';
import { caseStatusReply } from '../../../modules/tickets/lifecycle.js';
import { caseQueueReply } from '../../../modules/tickets/staff.js';
import { ticketDestinationReply } from '../../../modules/tickets/intake.js';
import { caseIssueQueueReply } from '../../../modules/tickets/delivery-issues.js';
import { caseContactReply } from '../../../modules/tickets/contacts.js';
import { answerLookupReply } from '../../../modules/answers/discord.js';
import { answerReplyReviewMessage } from './answer-reply-message.js';
import { knowledgeLookupReply } from '../../../modules/assistant/lookup.js';

const messages = Object.freeze({
  "shuttle_closed": "reply.shuttle_closed",
  "public_answer": "reply.public_answer",
  "knowledge_lookup": "reply.public_answer",
  "case_answer_review": "reply.case_answer_review",
  "case_answer_unavailable": "reply.case_answer_unavailable",
  "case_answer_cancelled": "reply.case_answer_cancelled",
  "case_answer_submitted": "reply.case_answer_submitted",
  "case_answer_cancel_uncertain": "reply.case_answer_cancel_uncertain",
  "case_answer_stale": "reply.case_answer_stale",
  "case_answer_limit": "reply.case_answer_limit",
  "recorded": "reply.recorded",
  "denied": "reply.denied",
  "disabled": "reply.disabled",
  "unavailable": "reply.unavailable",
  "ticket_recorded": "reply.ticket_recorded",
  "case_contact": "reply.case_contact",
  "case_contact_cancelled": "reply.case_contact_cancelled",
  "ticket_busy": "reply.ticket_busy",
  "ticket_form_unavailable": "reply.ticket_form_unavailable",
  "ticket_form_invalid": "reply.ticket_form_invalid",
  "case_status": "reply.case_status",
  "case_change_recorded": "reply.case_change_recorded",
  "case_stale": "reply.case_stale",
  "case_capacity": "reply.case_capacity",
  "case_queue": "reply.case_queue",
  "case_queue_stale": "reply.case_queue_stale",
  "case_participant_recorded": "reply.case_participant_recorded",
  "case_participant_denied": "reply.case_participant_denied",
  "case_staff_recorded": "reply.case_staff_recorded",
  "case_labels_recorded": "reply.case_labels_recorded",
  "case_reply_confirmation": "reply.case_reply_confirmation",
  "case_reply_recorded": "reply.case_reply_recorded",
  "case_reply_confirmed": "reply.case_reply_confirmed",
  "case_reply_cancelled": "reply.case_reply_cancelled",
  "case_reply_withdrawn": "reply.case_reply_withdrawn",
  "case_reply_limit": "reply.case_reply_limit",
  "case_reply_uncertain": "reply.case_reply_uncertain",
  "case_assignee_denied": "reply.case_assignee_denied",
  "case_issue_queue": "reply.case_issue_queue",
  "case_issue_queue_stale": "reply.case_issue_queue_stale",
  "case_issue_recorded": "reply.case_issue_recorded",
  "case_issue_stale": "reply.case_issue_stale",
  "case_issue_review": "reply.case_issue_review",
  "case_issue_message_needed": "reply.case_issue_message_needed",
  "case_recovery_recorded": "reply.case_recovery_recorded",
  "case_recovery_rejected": "reply.case_recovery_rejected",
  "case_channel_recorded": "reply.case_channel_recorded",
  "case_channel_rejected": "reply.case_channel_rejected",
  "shuttle_recorded": "reply.onboarding_recorded",
  "shuttle_progress_recorded": "reply.onboarding_progress_recorded",
  "shuttle_help_recorded": "reply.onboarding_help_recorded",
  "shuttle_help_paused": "reply.onboarding_help_paused",
  "shuttle_paused": "reply.onboarding_paused",
  "shuttle_help_resumed": "reply.onboarding_help_resumed",
  "shuttle_help_waiting": "reply.onboarding_help_waiting",
  "shuttle_help_queue": "reply.onboarding_help_queue",
  "shuttle_help_resolved": "reply.onboarding_help_resolved",
  "shuttle_help_stale": "reply.onboarding_help_stale",
  "shuttle_issue_queue": "reply.onboarding_issue_queue",
  "shuttle_issue_recorded": "reply.onboarding_issue_recorded",
  "shuttle_issue_stale": "reply.onboarding_issue_stale",
  "shuttle_issue_review": "reply.onboarding_issue_review",
  "shuttle_issue_message_needed": "reply.onboarding_issue_message_needed",
  "shuttle_recovery_recorded": "reply.onboarding_recovery_recorded",
  "shuttle_recovery_rejected": "reply.onboarding_recovery_rejected",
  "shuttle_channel_recorded": "reply.onboarding_channel_recorded",
  "shuttle_channel_rejected": "reply.onboarding_channel_rejected",
  "shuttle_stale": "reply.onboarding_stale",
  "shuttle_busy": "reply.onboarding_busy",
  "shuttle_review": "reply.onboarding_review"
});

/** Only edits a verified interaction's own ephemeral response with bounded static presentation. */
export function createInteractionResponder({ verifier, applicationId, fetch, clock, enabled, onboardingNavigation = null, onboardingAssistance = null, onboardingDeliveryIssues = null, caseLifecycle = null, caseStaff = null, caseIntake = null, caseDeliveryIssues = null, caseContacts = null, publicAnswers = null, caseAnswers = null, knowledgeLookup = null, readSystemText = async () => defaultSystemText, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  requireId(applicationId);
  requireCondition(typeof fetch === 'function' && typeof clock === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(onboardingNavigation === null || typeof onboardingNavigation.resolve === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(onboardingAssistance === null || typeof onboardingAssistance.queue === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(onboardingDeliveryIssues === null || typeof onboardingDeliveryIssues.queue === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseLifecycle === null || typeof caseLifecycle.status === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseStaff === null || (typeof caseStaff.queue === 'function' && typeof caseStaff.status === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseIntake === null || typeof caseIntake.destination === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseDeliveryIssues === null || typeof caseDeliveryIssues.queue === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseContacts === null || typeof caseContacts.view === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(publicAnswers === null || typeof publicAnswers.view === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(knowledgeLookup===null || ['view','current'].every(key=>typeof knowledgeLookup[key]==='function'),'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseAnswers === null || typeof caseAnswers.view === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  let cooldownUntil = 0, paused = false;
  return Object.freeze({
    async respond(envelope, status) {
      requireCondition(Object.hasOwn(messages, status), 'INTERACTION_RESPONSE_INVALID');
      requireCondition(await enabled() === true, 'DISCORD_TRANSPORT_DISABLED');
      requireCondition(!paused && clock() >= cooldownUntil, 'INTERACTION_RESPONSE_RATE_LIMITED');
      const credentials = verifier.replyCredentials(envelope);
      requireCondition(credentials.applicationId === applicationId, 'FOREIGN_APPLICATION');
      // Page turns are quiet. Errors use a private follow-up so @original is never overwritten.
      const update = envelope.command === 'shuttle.control';
      if (update && ['shuttle_progress_recorded', 'shuttle_help_recorded', 'shuttle_help_paused'].includes(status)) return;
      const text = await readSystemText();
      let body = { content: text(messages[status]), embeds: [], components: [] },lookupView=null;
      if(status==='knowledge_lookup' && knowledgeLookup!==null){lookupView=await knowledgeLookup.view(envelope);body=knowledgeLookupReply(lookupView);}
      if (status === 'public_answer' && publicAnswers !== null) body = answerLookupReply(await publicAnswers.view(envelope), text);
      if (status === 'case_answer_review' && caseAnswers !== null) body = answerReplyReviewMessage(await caseAnswers.view(envelope), text);
      if (status === 'case_contact' && caseContacts !== null) body = caseContactReply(await caseContacts.view(envelope), text);
      if (status === 'ticket_recorded' && caseIntake !== null) body = { embeds: [], ...ticketDestinationReply(await caseIntake.destination(envelope), text) };
      if (status === 'shuttle_recorded' && onboardingNavigation !== null) {
        let destination;
        // Keep Discord's deferred acknowledgement until a verified destination exists.
        // Every lookup rechecks current authority; no early button restarts the command.
        for (let attempt = 0; attempt < 16; attempt++) {
          requireCondition(await enabled() === true, 'DISCORD_TRANSPORT_DISABLED');
          verifier.replyCredentials(envelope);
          destination = await onboardingNavigation.resolve(envelope);
          if (destination.state !== 'preparing') break;
          if (attempt < 15) await wait(2_000);
        }
        body = { embeds: [], ...onboardingNavigationReply(destination.state === 'preparing' ? { state: 'unavailable' } : destination, text) };
      }
      if (status === 'shuttle_help_queue' && onboardingAssistance !== null) body = onboardingHelpQueueReply(await onboardingAssistance.queue(envelope), text);
      if (status === 'shuttle_issue_queue' && onboardingDeliveryIssues !== null) body = onboardingIssueQueueReply(await onboardingDeliveryIssues.queue(envelope), text);
      if (['case_status', 'case_change_recorded'].includes(status) && caseLifecycle !== null) body = caseStatusReply(await caseLifecycle.status(envelope), text);
      if (status === 'case_queue' && caseStaff !== null) body = caseQueueReply(await caseStaff.queue(envelope), text);
      if (status === 'case_issue_queue' && caseDeliveryIssues !== null) body = caseIssueQueueReply(await caseDeliveryIssues.queue(envelope), text);
      if (['case_staff_recorded', 'case_labels_recorded'].includes(status) && caseStaff !== null) body = caseStatusReply(await caseStaff.status(envelope), text);
      requireCondition(await enabled() === true, 'DISCORD_TRANSPORT_DISABLED');
      verifier.replyCredentials(envelope); // Navigation may outlive the interaction's reply window.
      requireCondition(!paused && clock() >= cooldownUntil, 'INTERACTION_RESPONSE_RATE_LIMITED');
      if(lookupView!==null)requireCondition(await knowledgeLookup.current(lookupView)===true,'KNOWLEDGE_SOURCE_STALE');
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 5_000);
      let response;
      try {
        response = await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${encodeURIComponent(credentials.token)}${update ? '?wait=true' : '/messages/@original'}`, {
          method: update ? 'POST' : 'PATCH', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Sophie/0.1.0' },
          body: JSON.stringify({ ...body, ...(update ? { flags: 64 } : {}), allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } }),
        });
        if (response.status === 429) {
          let seconds = Number(response.headers.get('retry-after'));
          const reader = response.body?.getReader();
          if (reader) {
            const parts = []; let size = 0;
            try {
              while (true) {
                const { value, done } = await reader.read(); if (done) break;
                size += value.length; requireCondition(size <= 4_096, 'INTERACTION_RESPONSE_INVALID'); parts.push(value);
              }
              const data = JSON.parse(Buffer.concat(parts).toString('utf8'));
              const bodySeconds = data?.retry_after;
              if (typeof bodySeconds === 'number' || typeof bodySeconds === 'string') {
                const parsed = Number(bodySeconds);
                seconds = Number.isFinite(parsed) ? Math.max(seconds || 0, parsed) : NaN;
              }
            } catch { seconds = NaN; }
            finally { await reader.cancel().catch(() => {}); }
          }
          if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86_400) paused = true;
          else cooldownUntil = clock() + Math.ceil(seconds * 1_000);
          throw new ContractError('INTERACTION_RESPONSE_RATE_LIMITED');
        }
        requireCondition(response.status === 200, 'INTERACTION_RESPONSE_UNAVAILABLE');
      } catch (error) {
        if (error instanceof ContractError) throw error;
        throw new ContractError('INTERACTION_RESPONSE_UNAVAILABLE');
      } finally { controller.abort(); clearTimeout(deadline); await response?.body?.cancel().catch(() => {}); }
    },
  });
}
