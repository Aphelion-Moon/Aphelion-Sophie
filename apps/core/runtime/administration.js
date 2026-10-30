import { runtimeScope } from './configuration.js';
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
import { createRoleDispatcher, createWhitelistGrantDispatcher, createMembershipDispatcher } from '../discord/dispatcher.js';
import { createWhitelistNoticeDispatcher } from '../discord/whitelist-notices.js';
import { createMemberRecordDispatcher } from '../discord/member-records.js';
import { createMemberRecordStore } from '../storage/member-records.js';
import { createMemberWatch } from '../discord/member-watch.js';
import { createCaseDispatcher } from '../discord/case-dispatcher.js';
import { createOnboardingDispatcher } from '../discord/onboarding-dispatcher.js';
import { createOnboardingAlertDispatcher } from '../discord/onboarding-alert-dispatcher.js';
import { createCaseIntakeDispatcher } from '../discord/case-intake-dispatcher.js';
import { createModerationCommands } from '../discord/moderation-commands.js';
import { createAdministrationCommands, createOnboardingCommands } from '../discord/onboarding-commands.js';
import { createOnboardingAssistance } from '../discord/onboarding-assistance.js';
import { createShuttleProgress } from '../discord/shuttle-progress.js';
import { readShuttleProgress } from '../storage/shuttle-timing.js';
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
export function createAdministrationLane({ configuration, pool, token, fetch, clock, enabled, rateLimits, observer, principals, verifier, onFault, onTrace = () => {}, readSystemText, knowledge = null, sophieMemberFactory = null }) {
  const { mapping, casePolicy: policy, limits, definitionId, capabilityPolicy } = configuration;
  // In production (Activity and AI only) this lane may add exactly one role: Whitelist, at the end of the Shuttle (owner decision,
  // 24 October 2026).
  const transport = createDiscordTransport({ guildId: mapping.guildId, token, fetch, clock, enabled, scope: runtimeScope(configuration),
    ...(runtimeScope(configuration) === 'activity-ai' ? { grantRoleIds: [mapping.whitelist] } : {}), ...(rateLimits ? { limits: rateLimits } : {}),
    // Member records: posts in their one forum (owner decisions, 30 October 2026).
    ...(configuration.memberRecords ? { recordForumId: configuration.memberRecords.forumId } : {}) });
  // Role, member and channel observations are checked against the authority boundary, so message traffic (including
  // this bot's own posts) no longer overtakes them; message reads keep the full continuity.
  const readAuthority = observer.readAuthorityBoundary ?? null;
  const roles = createDiscordRoles({ transport, mapping, clock, readContinuity: observer.readContinuity, readBoundary: readAuthority, readAuthority });
  const authorization = createCoreAuthorization({ principals, discord: roles, authorityStore: createActorAuthorityStore({ pool, clock }),
    policy: capabilityPolicy, clock, isAuthorityCurrent: enabled, readContinuity: observer.readContinuity, readAuthority });
  const { authorize, authorizeRecorded, resolveCaseResponder, resolveCaseParticipant, authorizeCaseParticipant } = authorization;
  const channels = createCaseChannels({ transport, roles, mapping, policy, clock, authorizeCaseParticipant });
  const messageOptions = { transport, roles, channels, mapping, policy, clock };
  const screens = createOnboardingMessages(messageOptions), alerts = createOnboardingAlertMessages(messageOptions), answers = createCaseIntakeMessages(messageOptions);
  const replyMessages = createCaseReplyMessages(messageOptions);
  const store = createCoreStore({ pool, clock, authorize, authorizeRecorded, resolveCaseResponder, resolveCaseParticipant, authorizeCaseParticipant,
    casePolicy: policy, caseVerification: channels.verification, onboardingMessageVerification: screens.verification, onboardingAlertVerification: alerts.verification,
    whitelistNotices: configuration.whitelistNotices !== undefined, whitelistReconciliation: runtimeScope(configuration) === 'full',
    memberRecords: configuration.memberRecords !== undefined });
  const intakeStore = createCaseIntakeStore({ pool, clock, authorize, authorizeRecorded, resolveCaseParticipant, authorizeCaseParticipant,
    policy, limits, verification: channels.verification });
  const deliveryStore = createCaseIntakeDeliveryStore({ pool, clock, policy, caseVerification: channels.verification, messageVerification: answers.verification });
  const issueStore = createCaseDeliveryIssueStore({ pool, clock, authorize, policy, verification: channels.verification,
    messageVerification: answers.verification, replyVerification: replyMessages.verification });
  const common = { authorization, discord: roles, store, enabled };
  const assistance = createOnboardingAssistance(common);
  // Staff set Watch on a member's record post (owner direction, 30 October 2026), where member records are configured.
  const memberWatch = configuration.memberRecords === undefined ? null : createMemberWatch({ authorization, enabled, guildId: mapping.guildId,
    store: createMemberRecordStore({ pool, clock, guildId: mapping.guildId, forumId: configuration.memberRecords.forumId, changelogThreadId: configuration.memberRecords.changelogThreadId }) });
  const shuttleProgress = createShuttleProgress({ authorization, discord: roles, enabled, clock,
    read: (guildId, userId) => readShuttleProgress(pool, guildId, userId) });
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
    inspectChannel:channelId=>inspectAutomationChannel(pool,{guildId:mapping.guildId,protectedCategoryId:policy.categoryId,channels:lookupChannels,channelId,
      exceptions:configuration.aiChannelExceptions??[]})});
  // The member's own Sophie panel (owner decision, 23 October 2026); present only where the AI controls are composed.
  const sophieMember = sophieMemberFactory === null ? null : sophieMemberFactory({ authorization, transport, verifier, enabled, readSystemText });
  const commands = createAdministrationCommands({ sophieMember, onboardingClosure: createOnboardingChannelClosure({ authorization, roles, channels, store, enabled }), moderation: createModerationCommands(common),
    onboarding: createOnboardingCommands({ ...common, channels, definitionId, limits, trace: onTrace }), assistance, deliveryIssues, caseLifecycle, caseStaff,
    caseIntake, caseContacts, caseDeliveryIssues, publicAnswers, caseAnswers, knowledgeLookup, shuttleProgress, memberWatch, caseParticipants: createCaseParticipants(common),
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
    createCaseDispatcher({ outbox, store, roles, channels, enabled, trace: onTrace }), createOnboardingDispatcher({ outbox, store, roles, messages: screens, enabled,
      trace: onTrace, requestCount: transport.requestCount }),
    createOnboardingAlertDispatcher({ outbox, store, roles, messages: alerts, enabled }),
    createCaseIntakeDispatcher({ outbox, store: deliveryStore, roles, messages: answers, enabled }),
    createCaseDirectNoticeDispatcher({ outbox, store: directStore, roles, channels, messages: directMessages, enabled }),
    createCaseReplyDispatcher({ outbox, store: replyDelivery, roles, messages: replyMessages, enabled }),
    createAutomationDispatcher({outbox,store:automationDelivery,messages:automationMessages,enabled}),
    createOnboardingCleanup({ store, roles, enabled, clock })];
  // Staff hear of each Whitelist Sophie gives, when a channel is configured (owner request, 24 October 2026).
  const whitelistNotices = configuration.whitelistNotices === undefined ? null :
    createWhitelistNoticeDispatcher({ outbox, transport, channelId: configuration.whitelistNotices.channelId, enabled });
  if (whitelistNotices) workers.push(whitelistNotices);
  // A post per member in the Staff forum, and the changelog, when configured (owner decisions, 30 October 2026).
  const records = configuration.memberRecords;
  const memberRecords = records === undefined ? null : createMemberRecordDispatcher({ transport, botUserId: mapping.botUserId, tagIds: records.tagIds, enabled, trace: onTrace,
    store: createMemberRecordStore({ pool, clock, guildId: mapping.guildId, forumId: records.forumId, changelogThreadId: records.changelogThreadId }) });
  if (memberRecords) workers.push(memberRecords);
  return { transport, roles, channels, authorization, store, intakeStore, replyStore, issueStore, intakeMessages: answers, replyMessages,
    screenMessages: screens, alertMessages: alerts, commands, workers, caseIntake, automationRecovery, sophieMember,
    whitelistGrants: createWhitelistGrantDispatcher({ outbox, store, discord: roles, enabled }), whitelistNotices, memberRecords,
    responseAdapters: { onboardingNavigation: createOnboardingNavigation({ ...common, channels }), onboardingAssistance: assistance,
      onboardingDeliveryIssues: deliveryIssues, caseLifecycle, caseStaff, caseIntake, caseContacts, caseDeliveryIssues, publicAnswers, caseAnswers, knowledgeLookup, sophieMember, shuttleProgress } };
}
