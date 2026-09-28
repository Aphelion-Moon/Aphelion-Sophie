import { createOnboardingChannelClosure, createOnboardingCleanup } from '../discord/onboarding-channel-lifecycle.js';
import { createDiscordTransport } from '../discord/transport.js';
import { createDiscordRoles } from '../discord/roles.js';
import { createCaseChannels } from '../discord/case-channels.js';
import { createOnboardingMessages } from '../discord/onboarding-messages.js';
import { createOnboardingAlertMessages } from '../discord/onboarding-alert-messages.js';
import { createCaseIntakeMessages } from '../discord/case-intake-messages.js';
import { createCoreAuthorization } from '../security/authorization.js';
import { createActorAuthorityStore } from '../storage/actor-authority.js';
import { createCoreStore } from '../storage/core-store.js';
import { createCaseIntakeStore } from '../storage/case-intake.js';
import { createCaseIntakeDeliveryStore } from '../storage/case-intake-delivery.js';
import { createCaseDeliveryIssueStore } from '../storage/case-delivery-issues.js';
import { createOutbox } from '../storage/outbox.js';
import { createRoleDispatcher, createMembershipDispatcher } from '../discord/dispatcher.js';
import { createCaseDispatcher } from '../discord/case-dispatcher.js';
import { createOnboardingDispatcher } from '../discord/onboarding-dispatcher.js';
import { createOnboardingAlertDispatcher } from '../discord/onboarding-alert-dispatcher.js';
import { createCaseIntakeDispatcher } from '../discord/case-intake-dispatcher.js';
import { createModerationCommands } from '../discord/moderation-commands.js';
import { createAdministrationCommands, createOnboardingCommands } from '../discord/onboarding-commands.js';
import { createOnboardingAssistance } from '../discord/onboarding-assistance.js';
import { createOnboardingDeliveryIssues } from '../discord/onboarding-delivery-issues.js';
import { createOnboardingNavigation } from '../discord/onboarding-navigation.js';
import { createCaseLifecycle } from '../discord/case-lifecycle.js';
import { createCaseStaff } from '../discord/case-staff.js';
import { createCaseIntake } from '../discord/case-intake.js';
import { createCaseContacts } from '../discord/case-contacts.js';
import { createCaseParticipants } from '../discord/case-participants.js';
import { createCaseDeliveryIssues } from '../discord/case-delivery-issues.js';
import { createCaseDirectNotices } from '../discord/case-direct-notices.js';
import { createCaseDirectNoticeStore } from '../storage/case-direct-notices.js';
import { createCaseDirectNoticeDispatcher } from '../discord/case-direct-notice-dispatcher.js';
import { createCaseReplyMessages } from '../discord/case-reply-messages.js';
import { createCaseReplies } from '../storage/case-replies.js';
import { createCaseReplyDelivery } from '../storage/case-reply-delivery.js';
import { createCaseReplyDispatcher } from '../discord/case-reply-dispatcher.js';
import { createCaseReplyCommands } from '../discord/case-reply-commands.js';
import { createCaseAnswerCommands } from '../discord/case-answer-commands.js';
import { createCuratedAnswers } from '../storage/curated-answers.js';
import { createCuratedAnswerCommands } from '../discord/curated-answers.js';
import { createAutomationChannels } from '../discord/automation-channels.js';
import { createAutomationMessages } from '../discord/automation-messages.js';
import { createAutomationDelivery } from '../storage/automation-delivery.js';
import { createAutomationDispatcher } from '../discord/automation-dispatcher.js';
import { createAutomationRecovery } from '../storage/automation-recovery.js';
import { createKnowledgeLookupCommands } from '../discord/knowledge-lookup.js';
import { inspectAutomationChannel } from '../storage/automation-channel-policy.js';

/** One request lane owns its proof issuers and serial transport. Workers use a separate lane. */
export function createAdministrationLane({ configuration, pool, token, fetch, clock, enabled, observer, principals, verifier, onFault, readSystemText, knowledge = null }) {
  const { mapping, casePolicy: policy, limits, definitionId, capabilityPolicy } = configuration;
  const transport = createDiscordTransport({ guildId: mapping.guildId, token, fetch, clock, enabled });
  const roles = createDiscordRoles({ transport, mapping, clock, readContinuity: observer.readContinuity });
  const authorization = createCoreAuthorization({ principals, discord: roles, authorityStore: createActorAuthorityStore({ pool, clock }),
    policy: capabilityPolicy, clock, isAuthorityCurrent: enabled, readContinuity: observer.readContinuity });
  const { authorize, authorizeRecorded, resolveCaseResponder, resolveCaseParticipant, authorizeCaseParticipant } = authorization;
  const channels = createCaseChannels({ transport, roles, mapping, policy, clock, authorizeCaseParticipant });
  const messageOptions = { transport, roles, channels, mapping, policy, clock };
  const screens = createOnboardingMessages(messageOptions), alerts = createOnboardingAlertMessages(messageOptions), answers = createCaseIntakeMessages(messageOptions);
  const replyMessages = createCaseReplyMessages(messageOptions);
  const store = createCoreStore({ pool, clock, authorize, authorizeRecorded, resolveCaseResponder, resolveCaseParticipant, authorizeCaseParticipant,
    casePolicy: policy, caseVerification: channels.verification, onboardingMessageVerification: screens.verification, onboardingAlertVerification: alerts.verification });
  const intakeStore = createCaseIntakeStore({ pool, clock, authorize, authorizeRecorded, resolveCaseParticipant, authorizeCaseParticipant,
    policy, limits, verification: channels.verification });
  const deliveryStore = createCaseIntakeDeliveryStore({ pool, clock, policy, caseVerification: channels.verification, messageVerification: answers.verification });
  const issueStore = createCaseDeliveryIssueStore({ pool, clock, authorize, policy, verification: channels.verification,
    messageVerification: answers.verification, replyVerification: replyMessages.verification });
  const common = { authorization, discord: roles, store, enabled };
  const assistance = createOnboardingAssistance(common);
  const deliveryIssues = createOnboardingDeliveryIssues({ ...common, channels, screenMessages: screens, alertMessages: alerts });
  const caseLifecycle = createCaseLifecycle({ ...common, limits });
  const caseStaff = createCaseStaff({ ...common, guildId: mapping.guildId });
  const caseIntake = createCaseIntake({ ...common, verifier, channels, store: intakeStore, onFault });
  const caseContacts = createCaseContacts({ ...common, channels, store: intakeStore });
  const caseDeliveryIssues = createCaseDeliveryIssues({ ...common, channels, messages: answers, replyMessages, store: issueStore });
  const replyStore = createCaseReplies({ pool, authorize, clock });
  const caseAnswers = createCaseAnswerCommands({ ...common, replies: replyStore, guildId: mapping.guildId });
  const publicAnswers = createCuratedAnswerCommands({ authorization, enabled, guildId: mapping.guildId,
    answers: createCuratedAnswers({ pool, authorize, guildId: mapping.guildId }) });
  const lookupChannels=createAutomationChannels({transport});
  const knowledgeLookup=knowledge===null ? null:createKnowledgeLookupCommands({authorization,verifier,knowledge,guildId:mapping.guildId,enabled,clock,
    inspectChannel:channelId=>inspectAutomationChannel(pool,{guildId:mapping.guildId,protectedCategoryId:policy.categoryId,channels:lookupChannels,channelId})});
  const commands = createAdministrationCommands({ onboardingClosure: createOnboardingChannelClosure({ authorization, roles, channels, store, enabled }), moderation: createModerationCommands(common),
    onboarding: createOnboardingCommands({ ...common, channels, definitionId, limits }), assistance, deliveryIssues, caseLifecycle, caseStaff,
    caseIntake, caseContacts, caseDeliveryIssues, publicAnswers, caseAnswers, knowledgeLookup, caseParticipants: createCaseParticipants(common),
    caseReplies: createCaseReplyCommands({ ...common, verifier, replies: replyStore, guildId: mapping.guildId }) });
  const outbox = createOutbox({ pool });
  const directMessages = createCaseDirectNotices({ readSystemText, transport, roles, channels, botUserId: mapping.botUserId, clock });
  const directStore = createCaseDirectNoticeStore({ pool, clock, policy, channels: channels.verification, messages: directMessages.verification });
  const replyDelivery = createCaseReplyDelivery({ pool, clock, policy, authorizeRecorded,
    caseVerification: channels.verification, messageVerification: replyMessages.verification });
  const automationMessages = createAutomationMessages({transport,roles,botUserId:mapping.botUserId,protectedCategoryId:policy.categoryId,clock});
  const automationDelivery = createAutomationDelivery({pool,clock,guildId:mapping.guildId,protectedCategoryId:policy.categoryId,
    channels:createAutomationChannels({transport}),messages:automationMessages,automationEnabled:()=>configuration.automationEnabled === true});
  const automationRecovery = createAutomationRecovery({pool,authorize,guildId:mapping.guildId,protectedCategoryId:policy.categoryId,
    channels:createAutomationChannels({transport}),messages:automationMessages});
  const workers = [createMembershipDispatcher({ outbox, store, discord: roles, enabled }), createRoleDispatcher({ outbox, store, discord: roles, enabled }),
    createCaseDispatcher({ outbox, store, roles, channels, enabled }), createOnboardingDispatcher({ outbox, store, roles, messages: screens, enabled }),
    createOnboardingAlertDispatcher({ outbox, store, roles, messages: alerts, enabled }),
    createCaseIntakeDispatcher({ outbox, store: deliveryStore, roles, messages: answers, enabled }),
    createCaseDirectNoticeDispatcher({ outbox, store: directStore, roles, channels, messages: directMessages, enabled }),
    createCaseReplyDispatcher({ outbox, store: replyDelivery, roles, messages: replyMessages, enabled }),
    createAutomationDispatcher({outbox,store:automationDelivery,messages:automationMessages,enabled}),
    createOnboardingCleanup({ store, roles, enabled, clock })];
  return { transport, roles, channels, authorization, store, intakeStore, replyStore, commands, workers, caseIntake, automationRecovery,
    responseAdapters: { onboardingNavigation: createOnboardingNavigation({ ...common, channels }), onboardingAssistance: assistance,
      onboardingDeliveryIssues: deliveryIssues, caseLifecycle, caseStaff, caseIntake, caseContacts, caseDeliveryIssues, publicAnswers, caseAnswers, knowledgeLookup } };
}
