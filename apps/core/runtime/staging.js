import { createAiControls } from '../storage/ai-controls.js';
import { createAiActivation } from '../storage/ai-activation.js';
import { createAiObservations } from '../discord/ai-observations.js';
import { createActorAuthorityStore } from '../storage/actor-authority.js';
import { createAiPreferenceExpiry } from './ai-preference-expiry.js';
import { createAiDepartures } from '../storage/ai-departures.js';
import { createAiPrivacy } from '../storage/ai-privacy.js';
import { createAiEffects } from '../storage/ai-effects.js';
import { createAiMessages } from '../discord/ai-messages.js';
import { createAiRuntime } from './ai.js';
import { createAiMemory } from '../storage/ai-memory.js';
import { createAiMemories } from '../storage/ai-memories.js';
import { createAiControlsHttp } from '../http/ai-controls.js';
import { createAiKnowledgeHttp } from '../http/ai-knowledge.js';
import { createKnowledgeLookupHttp } from '../http/knowledge-lookup.js';
import { inspectAutomationChannel } from '../storage/automation-channel-policy.js';
import { createSystemWordingHttp } from '../http/system-wording.js';
import { createOnboardingEntryPanel } from '../discord/onboarding-entry-panel.js';
import { createErrorAlerts } from './error-alerts.js';
import { createSystemWordingReader, createSystemWordingStore } from '../storage/system-wording.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireCondition } from '../../../contracts/validation.js';
import { runtimeScope, validateStagingRuntime } from './configuration.js';
import { requireUnquarantinedDatabase } from './recovery.js';
import { createAdministrationLane } from './administration.js';
import { createDiscordTransport, createDiscordRateLimits } from '../discord/transport.js';
import { createDiscordRoles } from '../discord/roles.js';
import { createCaseMessageCapture } from '../discord/case-message-capture.js';
import { createGatewayJournal } from '../storage/gateway-journal.js';
import { createGatewayObserver } from '../discord/gateway-observer.js';
import { createGatewaySupervisor } from '../discord/gateway-supervisor.js';
import { createInteractionVerifier } from '../security/interaction-verifier.js';
import { createInteractionResponder } from '../discord/interaction-response.js';
import { createInteractionHttpServer } from '../discord/interaction-http.js';
import { createSophieMemberCommands } from '../discord/sophie-member.js';
import { createAiMemberControls } from './ai-member.js';
import { createCodeSearch } from '../../knowledge/code-search.js';
import { createOutbox } from '../storage/outbox.js';
import { createCaseReconciler } from '../discord/case-reconciler.js';
import { createCaseInspectionStore } from '../storage/case-inspections.js';
import { createCorePrincipals } from '../security/principals.js';
import { createDashboardAuthStore } from '../storage/dashboard-auth.js';
import { createDashboardAuth } from '../security/dashboard-auth.js';
import { createDiscordOAuth } from '../discord/oauth.js';
import { createDashboardAuthHttpServer } from '../http/dashboard-auth.js';
import { createActivityAuth } from '../security/activity-auth.js';
import { createActivityHttpServer } from '../http/activity.js';
import { createShuttleActivityStore } from '../storage/shuttle-activity.js';
import { loadActivityClient } from '../../activity/client-assets.js';
import { loadActivityContent } from '../../activity/content.js';
import { createActivityChannels } from '../discord/activity-channels.js';
import { createActivityStation } from '../discord/activity-station.js';
import { createActivityLayoutStore } from '../storage/activity-layout.js';
import { createActivityLayoutHttp } from '../http/activity-layout.js';
import { createDashboardPresentation } from '../http/dashboard-assets.js';
import { createOnboardingAuthoringStore } from '../storage/onboarding-authoring.js';
import { createOnboardingAuthoringHttp } from '../http/onboarding-authoring.js';
import { createCaseFormAuthoringStore } from '../storage/case-form-authoring.js';
import { createCaseFormAuthoringHttp } from '../http/case-form-authoring.js';
import { createCaseChildAccess } from '../discord/case-child-access.js';
import { createCaseTranscripts } from '../storage/case-transcripts.js';
import { createCaseTranscriptsHttp } from '../http/case-transcripts.js';
import { createCaseExports } from '../storage/case-exports.js';
import { createCaseExportsHttp } from '../http/case-exports.js';
import { createCaseNotes } from '../storage/case-notes.js';
import { createCaseNotesHttp } from '../http/case-notes.js';
import { createCaseRepliesHttp } from '../http/case-replies.js';
import { createCaseLabels } from '../storage/case-labels.js';
import { createCaseLabelsHttp } from '../http/case-labels.js';
import { createCaseManagementHttp } from '../http/case-management.js';
import { createCaseDeliveryIssuesHttp } from '../http/case-delivery-issues.js';
import { createOnboardingStaffHttp } from '../http/onboarding-staff.js';
import { createModerationRecoveryHttp } from '../http/moderation-recovery.js';
import { createContactNavigationHttp } from '../http/contact-navigation.js';
import { createContactEntryHttp } from '../http/contact-entry.js';
import { createAutomationPolicies } from '../storage/automation-policies.js';
import { createAutomationPoliciesHttp } from '../http/automation-policies.js';
import { createAutomationChannels } from '../discord/automation-channels.js';
import { createAutomationIngress } from '../discord/automation-ingress.js';
import { createAutomationAdmission } from '../storage/automation-admission.js';
import { createCuratedAnswers } from '../storage/curated-answers.js';
import { createCuratedAnswersHttp } from '../http/curated-answers.js';
import { createPermissionEditor } from '../storage/permission-editor.js';
import { createPermissionEditorHttp } from '../http/permission-editor.js';
import { createPermissionOptions } from '../discord/permission-options.js';
import { runtimeDatabaseAvailable } from '../storage/runtime-maintenance.js';
import { createGuildState } from '../discord/guild-state.js';

// The detail a log line may carry, in this order: who (a Discord user ID), the request, where the member was in the Shuttle,
// how it failed (phase, cause, the transient codes retried before it, attempts) and how long it took. Each value is a fixed
// token; anything else is left out of the line.
const DETAIL_KEYS = Object.freeze([['userId', 'user'], ['request', 'request'], ['stage', 'stage'], ['phase', 'phase'], ['cause', 'cause'],
  ['retried', 'retried'], ['tries', 'tries'], ['ms', 'ms'], ['code', 'code']]);
const DETAIL_VALUE = /^[A-Za-z0-9_.:/>-]{1,96}$/u;
export function logDetail(context) {
  if (context === null || typeof context !== 'object') return null;
  const pairs = [];
  for (const [key, label] of DETAIL_KEYS) {
    if (context[key] === undefined || context[key] === null) continue;
    const value = String(context[key]).replace(/ \(([a-z]+)\)$/u, ':$1').replace(/ /gu, ':');
    if (DETAIL_VALUE.test(value)) pairs.push(`${label}=${value}`);
  }
  return pairs.length ? pairs.join(' ') : null;
}

/** Explicit staging host. Construction starts no listener, connection, registration, migration or service. */
export async function createStagingRuntime({ configuration, pool, aiControlPool = null, aiPreferenceJournal = null, aiWorker = null, aiKnowledge = null, aiKnowledgeAdmin = null, aiKnowledgeAdminFactory = null, aiApproval = null, aiActivationPool = null, aiRestoreCurrent = async () => false, aiGithubToken = null, token, clientSecret = null, fetch, connect, clock = Date.now, random = Math.random, onFault, onTrace = () => {}, rateLimits = createDiscordRateLimits(), configurationApplyEnabled = false, gatewayLeaseMs = 30_000 }) {
  validateStagingRuntime(configuration); const fixed = structuredClone(configuration);
  // Production, Activity and AI only: no role, case, moderation, Shuttle-channel, automation or permission work (configuration.js).
  const limited = runtimeScope(fixed) === 'activity-ai';
  requireCondition(typeof onFault === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  await requireUnquarantinedDatabase(pool);
  requireCondition(await runtimeDatabaseAvailable(pool), 'RUNTIME_MAINTENANCE_ACTIVE');
  let started = false, stopping = false, gatewayTask = null, workerTask = Promise.resolve(), timer = null, dashboardListening = false;
  let knowledgeAdministration = null, knowledgeStarted = false;
  let maintenanceObserved = false;
  const active = () => started && !stopping && !maintenanceObserved;
  // Errors also go to the configured alert channel (codes only; apps/core/runtime/error-alerts.js).
  let errorAlerts = null;
  // The host log gets the code and, when the caller knows it, fixed-vocabulary detail (logDetail: who, which request, where
  // in the Shuttle, how it failed); the alert also gets who was affected and the request.
  const fault = (code, context) => { try { onFault(code, logDetail(context)); } catch { /* Never log original dependency errors or payloads. */ } errorAlerts?.report(code, context); };
  // Diagnostics (fixed codes: outcome, milliseconds, request counts), with the same detail. Never content.
  const trace = (code, context) => { try { onTrace(code, logDetail(context)); } catch { /* Diagnostics never affect the runtime. */ } };
  const databaseActive = async () => {
    if (!active()) return false;
    if (await runtimeDatabaseAvailable(pool)) return true;
    maintenanceObserved = true; fault('RUNTIME_MAINTENANCE_ACTIVE'); return false;
  };
  // Every transport below uses the same bot token, so they share Discord's buckets and must share one view of them.
  // A supervising host passes its own registry so a restarted runtime keeps the cooldowns it already learned.
  const transport = createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled: databaseActive, limits: rateLimits, scope: runtimeScope(fixed) });
  // Its own transport, live while the runtime runs, so a database outage can still be reported; same Discord buckets.
  if (fixed.errorAlerts) errorAlerts = createErrorAlerts({ ...fixed.errorAlerts, clock,
    transport: createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled: async () => started && !stopping, limits: rateLimits, scope: runtimeScope(fixed) }) });
  requireCondition(aiWorker===null || aiKnowledge!==null && aiControlPool!==null, 'AI_ADAPTERS_REQUIRED');
  let aiRuntime = null, activationRebind = null, activationFollow = null;
  const privacyEffects=aiControlPool===null?null:createAiEffects({pool:aiControlPool,guildId:fixed.mapping.guildId,clock});
  const privacyMessages=privacyEffects===null?null:createAiMessages({transport,botUserId:fixed.mapping.botUserId,effects:privacyEffects,clock,canReact:async()=>false});
  const aiDepartures=createAiDepartures({pool,guildId:fixed.mapping.guildId});
  const privacy=aiControlPool===null?null:createAiPrivacy({pool:aiControlPool,guildId:fixed.mapping.guildId,journal:aiPreferenceJournal,
    departures:aiDepartures,invalidate:()=>aiRuntime?.invalidate(),onFault:fault,
    removeEffect:effect=>privacyMessages.remove({guildId:fixed.mapping.guildId,channelId:effect.channel_id},{messageId:effect.message_id,owner:effect.owner,id:effect.receipt_id})});
  // Sophie's own memories exist only with the independent journal; they are used only while an accepted notice discloses them.
  const aiMemories=privacy===null||aiPreferenceJournal===null?null:createAiMemories({pool:aiControlPool,guildId:fixed.mapping.guildId,journal:aiPreferenceJournal,privacyCurrent:privacy.current,clock});
  const preferenceExpiry=privacy===null?null:createAiPreferenceExpiry({pool:aiControlPool,guildId:fixed.mapping.guildId,onFault:()=>fault('AI_CONTROL_UNAVAILABLE'),
    maintainPrivacy:async()=>{await privacy.maintain();await aiMemories?.expire();}});
  // One Gateway projection outlives worker runtimes: it must see every dispatch, including while no worker runs.
  const guildState = aiWorker === null ? null : createGuildState({ guildId: fixed.mapping.guildId, botUserId: fixed.mapping.botUserId });
  const aiGateway = guildState === null ? null : { prepare: payload => { guildState.accept(payload); return aiRuntime?.prepare(payload) ?? null; },
    committed: (proof, accepted) => aiRuntime?.committed(proof, accepted), invalidate: () => aiRuntime?.invalidate() };
  // Gateway ownership lease: 30 s in every deployment; isolated tests may shorten it (renewed at a third of it).
  const journal = createGatewayJournal({ pool, mapping: fixed.mapping, clock, leaseMs: gatewayLeaseMs, reconcileMembers: !limited,
    automation: fixed.automationEnabled === true ? createAutomationAdmission({guildId:fixed.mapping.guildId,protectedCategoryId:fixed.casePolicy.categoryId,
      channels:createAutomationChannels({transport}),ingress:createAutomationIngress({guildId:fixed.mapping.guildId,botUserId:fixed.mapping.botUserId,clock})}) : null,
    caseCapture: fixed.captureEnabled ? createCaseMessageCapture({ guildId: fixed.mapping.guildId, clock }) : null });
  const observer = createGatewayObserver({ journal, mapping: fixed.mapping, applicationId: fixed.applicationId, clock, ai: aiGateway });
  // Every Discord request and authorization check asks this gate (two database reads), several at once within one member's
  // request; callers asking while a check is under way share its answer instead of each sending their own (Activity audit,
  // 24 October 2026). Nothing is kept once it settles, so a later caller always checks afresh.
  let gating = null;
  const enabled = () => gating ??= (async () => await databaseActive() && await observer.isCurrent())().finally(() => { gating = null; });
  const gateway = createGatewaySupervisor({ observer, transport, connect, token, clock, random, enabled: active, renewMs: Math.floor(gatewayLeaseMs / 3), onTrace: trace });
  const verifier = createInteractionVerifier({ publicKeyHex: fixed.publicKeyHex, applicationId: fixed.applicationId, guildId: fixed.mapping.guildId, clock });
  const authRoles = createDiscordRoles({ transport: createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled, scope: runtimeScope(fixed), limits: rateLimits }),
    mapping: fixed.mapping, clock, readContinuity: observer.readContinuity });
  const auth = fixed.dashboard === null ? null : createDashboardAuth({ configuration: fixed.dashboard,
    store: createDashboardAuthStore({ pool, configuration: fixed.dashboard, clock }),
    oauth: createDiscordOAuth({ configuration: fixed.dashboard, clientSecret, fetch, clock, enabled }), discord: authRoles, clock, enabled });
  // The Shuttle Activity signs members in through the same OAuth application and resolves them through core principals.
  const activityAuth = auth === null || fixed.activity === undefined ? null : createActivityAuth({ applicationId: fixed.applicationId,
    guildId: fixed.mapping.guildId, oauth: createDiscordOAuth({ configuration: fixed.dashboard, clientSecret, fetch, clock, enabled }),
    instances: instanceId => transport.getActivityInstance(fixed.applicationId, instanceId), discord: authRoles, clock, enabled });
  const principals = auth === null ? verifier : createCorePrincipals({ interactions: verifier, dashboard: auth, activity: activityAuth });
  const createAiLane=worker=>createAiRuntime({ configuration: fixed, corePool: pool, controlPool: aiControlPool, worker, knowledge: aiKnowledge,
    observer, guildState, token, fetch, clock, enabled, rateLimits, onFault: fault,privacyCurrent:privacy.current,
    memory: aiPreferenceJournal === null ? null : createAiMemory({ pool: aiControlPool, guildId: fixed.mapping.guildId, journal: aiPreferenceJournal, clock }),
    memories: aiMemories === null ? null : { ...aiMemories, enabled: async () => aiApproval !== null && typeof aiApproval.automaticMemory === 'function' && await aiApproval.automaticMemory() },
    readSystemText: createSystemWordingReader({ pool, guildId: fixed.mapping.guildId }),
    codeSearch: aiGithubToken === null ? null : createCodeSearch({ token: aiGithubToken, fetchImpl: fetch, clock }),
    ...(aiApproval === null ? {} : { readNotice: aiApproval.notice, staffChannels: async () => typeof aiApproval.staffChannels === 'function' && await aiApproval.staffChannels() }) });
  if(aiWorker!==null)aiRuntime=createAiLane(aiWorker);
  const readSystemText = createSystemWordingReader({ pool, guildId: fixed.mapping.guildId });
  // One set of member AI controls per authorization lane: the Discord panel and the dashboard share the same use cases.
  const aiMemberControls = authorization => aiControlPool === null || privacy === null ? null : createAiMemberControls({ clock,
    requestErasure: userId => aiDepartures.request(userId).then(() => aiRuntime?.invalidate()),
    controls: createAiControls({ pool: aiControlPool, guildId: fixed.mapping.guildId, authorize: authorization.authorize, preferenceJournal: aiPreferenceJournal,
      privacyCurrent: privacy.current, clock, memories: aiMemories, invalidate: () => aiRuntime?.invalidate(),
      memoriesActive: async () => aiApproval !== null && typeof aiApproval.automaticMemory === 'function' && await aiApproval.automaticMemory(),
      ...(aiApproval === null ? {} : { readNotice: aiApproval.notice }), memberPresence: actor => authorization.aiMemberPresence(actor),
      inspectChannel: async () => null }) });
  const sophieMemberFactory = aiControlPool === null || privacy === null ? null : ({ authorization, transport: laneTransport, verifier: laneVerifier, enabled: laneEnabled, readSystemText: laneText }) =>
    createSophieMemberCommands({ authorization, member: aiMemberControls(authorization), verifier: laneVerifier, transport: laneTransport,
      guildId: fixed.mapping.guildId, enabled: laneEnabled, readSystemText: laneText });
  const lane = (extra = {}) => createAdministrationLane({ configuration: fixed, pool, token, fetch, clock, enabled, rateLimits, observer, principals, verifier, onFault: fault, onTrace: trace, readSystemText, knowledge:aiKnowledge, ...extra });
  const requests = lane({ sophieMemberFactory }), delivery = lane();
  const responder = createInteractionResponder({ verifier, applicationId: fixed.applicationId, fetch, clock, enabled, readSystemText, ...requests.responseAdapters });
  // A recorded Shuttle change has already committed its render intent, so delivery starts now instead of at the next
  // interval. The diagnostic is a fixed code: the command result and whole milliseconds, never IDs or content.
  const interactionCommands = Object.freeze({ async execute(envelope) {
    if (limited && !(String(envelope.command).startsWith('sophie.') || envelope.command === 'knowledge.lookup')) return 'denied';
    const startedAt = performance.now();
    const result = await requests.commands.execute(envelope);
    if (['shuttle.start', 'shuttle.control'].includes(envelope.command)) {
      trace(`SHUTTLE_COMMAND_${String(result).toUpperCase().replace(/[^A-Z]/g, '_').slice(0, 32)}_${Math.min(99_999, Math.round(performance.now() - startedAt))}MS`);
      // A failed click may have queued its card to be drawn again; waking costs nothing when there is no work.
      if (result !== 'disabled') wake();
    }
    return result;
  } });
  const interactions = createInteractionHttpServer({ verifier, commands: interactionCommands, respond: responder.respond,
    // Production posts only the Activity launch post (owner decision, 24 October 2026): its button opens the Activity, which
    // checks access itself; the Onboarding-channel entry panel stays with the full runtime.
    onboardingPanel: createOnboardingEntryPanel({ authorization: requests.authorization, transport: requests.transport, store: requests.store, policy: fixed.casePolicy,
      definitionId: fixed.definitionId, enabled, readSystemText, commands: limited ? ['shuttle.post'] : ['shuttle.panel', 'shuttle.post'],
      mediaOrigin: fixed.activity?.origin ?? null }),
    caseIntake: limited ? null : requests.caseIntake, sophiePanel: requests.sophieMember, readSystemText, enabled, onFault: fault, activityOpen: fixed.activity?.status === 'open' });
  const reconciler = createCaseReconciler({ store: createCaseInspectionStore({ pool, policy: fixed.casePolicy }), enabled });
  // No Shuttle work waits for Staff: parked Shuttle jobs are rechecked on their own (see recheckParkedShuttleWork).
  const shuttleOutbox = createOutbox({ pool });
  // The shipped Activity content (default moments, scene beats, viewscreens), read once for the editor and run views.
  const activityContent = auth !== null || activityAuth !== null ? await loadActivityContent(fileURLToPath(new URL('../../../', import.meta.url))) : null;
  let dashboard = null;
  if (auth !== null) {
    const browser = lane(), { authorization, roles } = browser;
    const aiChannels = createAutomationChannels({ transport: browser.transport });
    const knowledgeAdmin = knowledgeAdministration = aiKnowledgeAdminFactory?.({ authorize: authorization.authorize, invalidate: () => aiRuntime?.invalidate() });
    const knowledge = aiKnowledgeAdmin === null && !knowledgeAdmin ? null : createAiKnowledgeHttp({ auth, authorization, knowledge: aiKnowledgeAdmin ?? knowledgeAdmin.editor, invalidate: () => aiRuntime?.invalidate() });
    const qualificationObservations = aiActivationPool === null || guildState === null ? null : createAiObservations({ pool, transport: browser.transport, guildState,
      authorityStore: createActorAuthorityStore({ pool, clock }), capabilityPolicy: fixed.capabilityPolicy, mapping: fixed.mapping,
      protectedCategoryId: fixed.casePolicy.categoryId, aiChannelExceptions: fixed.aiChannelExceptions ?? [], observer, clock });
    const activation = qualificationObservations === null || aiApproval === null ? null : createAiActivation({ pool: aiActivationPool,
      guildId: fixed.mapping.guildId, authorize: authorization.authorize, inspectChannel: qualificationObservations.inspectChannel,
      approval: aiApproval, workerRelease: () => aiRuntime?.qualifiedRelease?.() ?? null, restoreCurrent: aiRestoreCurrent, clock,
      invalidate: () => aiRuntime?.invalidate() });
    activationRebind = activation === null ? null : activation.rebind; activationFollow = activation === null ? null : activation.follow;
    const knowledgeLookup = aiKnowledge === null ? null : createKnowledgeLookupHttp({ auth, authorization, knowledge: aiKnowledge, clock });
    const ai = aiControlPool === null ? null : createAiControlsHttp({ auth, authorization, trace: fault, member: aiMemberControls(authorization), controls: { ...createAiControls({
      pool: aiControlPool, guildId: fixed.mapping.guildId, authorize: authorization.authorize, preferenceJournal:aiPreferenceJournal, privacyCurrent:privacy.current,clock, memories: aiMemories,
      memoriesActive: async () => aiApproval !== null && typeof aiApproval.automaticMemory === 'function' && await aiApproval.automaticMemory(),
      workerStatus:()=>aiRuntime?.workerStatus?.()??{connected:false,release:null,observedAt:null},
      readDiagnostic:channelId=>aiRuntime?.diagnostics(channelId)??null,
      ...(aiApproval === null ? {} : { readNotice: aiApproval.notice }),
      memberPresence: actor => authorization.aiMemberPresence(actor),
      // A publication also moves active channels onto it (Go live persists); the follow is idempotent and owner-role only.
      invalidate: () => { aiRuntime?.invalidate(); if (activationFollow) void activationFollow().catch(() => fault('AI_QUALIFICATION_FOLLOW_UNAVAILABLE')); },
      inspectChannel: (_client, channelId) => inspectAutomationChannel(pool, { guildId: fixed.mapping.guildId,
        protectedCategoryId: fixed.casePolicy.categoryId, channels: aiChannels, channelId, exceptions: fixed.aiChannelExceptions ?? [] }),
    }), ...(activation ?? { reviewActivation: async () => { requireCondition(false, 'AI_ACTIVATION_UNAVAILABLE'); }, activate: async () => { requireCondition(false, 'AI_ACTIVATION_UNAVAILABLE'); } }) } });
    const permissions = createPermissionEditorHttp({ auth, authorization, store: createPermissionEditor({ pool,
      authorize: authorization.authorize, configuration: fixed, options: createPermissionOptions({ transport: browser.transport }),
      observeActor: userId => roles.observeActor(userId), clock, applyEnabled: configurationApplyEnabled }) });
    const childAccess = createCaseChildAccess({ guildId: fixed.mapping.guildId, botUserId: fixed.mapping.botUserId,
      transport: browser.transport, roles, clock });
    const transcriptStore = createCaseTranscripts({ pool, authorization, roles, childAccess, clock });
    const transcripts = createCaseTranscriptsHttp({ auth, authorization, transcripts: transcriptStore });
    const caseExports = createCaseExportsHttp({ auth, authorization,
      exports: createCaseExports({ pool, transcripts: transcriptStore, readPolicy: () => fixed.exportPolicy }) });
    const notes = createCaseNotesHttp({ auth, authorization, notes: createCaseNotes({ pool, authorize: authorization.authorize, clock }) });
    const replies = createCaseRepliesHttp({ auth, authorization, replies: browser.replyStore });
    const answers = createCuratedAnswersHttp({ auth, authorization,
      answers: createCuratedAnswers({ pool, authorize: authorization.authorize, guildId: fixed.mapping.guildId }) });
    const automation = createAutomationPoliciesHttp({ auth, authorization, recovery:browser.automationRecovery, automation: createAutomationPolicies({ pool,
      authorize: authorization.authorize, guildId: fixed.mapping.guildId, protectedCategoryId: fixed.casePolicy.categoryId,
      channels: createAutomationChannels({ transport: browser.transport }) }) });
    const labels = createCaseLabelsHttp({ auth, authorization, labels: createCaseLabels({ pool, authorize: authorization.authorize, clock }) });
    const management = createCaseManagementHttp({ auth, authorization, store: browser.store, discord: roles, limits: fixed.limits, enabled });
    const caseDelivery = createCaseDeliveryIssuesHttp({ auth, authorization, store: browser.issueStore, discord: roles,
      channels: browser.channels, messages: browser.intakeMessages, replyMessages: browser.replyMessages, enabled });
    const onboardingStaff = createOnboardingStaffHttp({ auth, authorization, store: browser.store, discord: roles,
      channels: browser.channels, screenMessages: browser.screenMessages, alertMessages: browser.alertMessages, enabled });
    const moderation = createModerationRecoveryHttp({ auth, authorization, store: browser.store, discord: roles, enabled });
    const contactNavigation = createContactNavigationHttp({ auth, authorization, store: browser.intakeStore, discord: roles, channels: browser.channels, enabled });
    const contactEntry = createContactEntryHttp({ auth, authorization, store: browser.intakeStore, discord: roles, channels: browser.channels, enabled });
    dashboard = createDashboardAuthHttpServer({ configuration: fixed.dashboard, auth, authorization, ai, knowledge, knowledgeLookup, enabled, onFault: fault, transcripts, caseExports, notes, replies, answers, automation, permissions, labels, management, moderation, caseDelivery, onboardingStaff, contactEntry, contactNavigation,
      wording: createSystemWordingHttp({ auth, authorization, store: createSystemWordingStore({ pool, authorize: authorization.authorize, guildId: fixed.mapping.guildId, definitionId: fixed.definitionId }) }),
      authoring: createOnboardingAuthoringHttp({ auth, authorization, store: createOnboardingAuthoringStore({ pool, authorize: authorization.authorize,
        guildId: fixed.mapping.guildId, definitionId: fixed.definitionId }) }),
      activityLayout: createActivityLayoutHttp({ auth, authorization, store: createActivityLayoutStore({ pool, authorize: authorization.authorize,
        guildId: fixed.mapping.guildId, definitionId: fixed.definitionId, ...activityContent }) }),
      formAuthoring: createCaseFormAuthoringHttp({ auth, authorization, store: createCaseFormAuthoringStore({ pool, authorize: authorization.authorize, guildId: fixed.mapping.guildId }) }),
      presentation: await createDashboardPresentation(),
      // Production keeps only the AI, knowledge, wording, Shuttle copy and Activity layout pages.
      ...(limited ? { transcripts: null, caseExports: null, notes: null, replies: null, answers: null, automation: null, permissions: null, labels: null,
        management: null, moderation: null, caseDelivery: null, onboardingStaff: null, contactEntry: null, contactNavigation: null, formAuthoring: null } : {}) });
  }
  let activity = null, activityListening = false;
  if (activityAuth !== null) {
    const visitor = lane();
    activity = createActivityHttpServer({ configuration: fixed.activity, applicationId: fixed.applicationId, guildId: fixed.mapping.guildId, port: fixed.activity.port,
      assets: await loadActivityClient(fileURLToPath(new URL('../../../', import.meta.url))), auth: activityAuth,
      authorization: visitor.authorization, discord: visitor.roles, enabled, onFault: fault, onTrace: trace, wake: () => wake(), clock,
      channels: createActivityChannels({ transport: visitor.transport, roles: visitor.roles, guildId: fixed.mapping.guildId, clock }),
      station: createActivityStation({ transport: visitor.transport, guildId: fixed.mapping.guildId, clock }),
      store: createShuttleActivityStore({ pool, clock, authorize: visitor.authorization.authorize, definitionId: fixed.definitionId, status: fixed.activity.status,
        defaults: activityContent.defaults, deliverWhitelist: true }) });
  }
  const owner = `staging.${randomUUID()}`;
  let ticking = false, scheduled = false, wakeQueued = false;
  function tick() {
    if (ticking || !active()) return Promise.resolve();
    ticking = true;
    workerTask = (async () => {
      if (!await enabled()) return;
      if(active() && knowledgeAdministration && !knowledgeStarted){
        try {await knowledgeAdministration.start();knowledgeStarted=true;}catch{fault('KNOWLEDGE_SYNC_UNAVAILABLE');}
      }
      // Production (Activity and AI only) runs no case, membership or Shuttle-channel worker; it only delivers the Whitelist
      // grants the Shuttle Activity records (owner decision, 24 October 2026).
      // Every grant delivery outcome but an empty queue is logged with its time (owner request, 24 October 2026), so a grant
      // that was cancelled or retried shows how.
      if (limited) {
        const startedAt = performance.now(), result = await delivery.whitelistGrants.runOnce(owner);
        if (!['idle', 'disabled'].includes(result?.status)) trace(`WHITELIST_GRANT_${String(result?.status).toUpperCase().replace(/[^A-Z]/g, '_').slice(0, 24)}`,
          { code: result?.code ?? null, ms: Math.min(99_999, Math.round(performance.now() - startedAt)) });
        // Then the staff notice of a grant just confirmed, if configured.
        if (delivery.whitelistNotices && active()) {
          const noticed = await delivery.whitelistNotices.runOnce(owner);
          if (!['idle', 'disabled'].includes(noticed?.status)) trace(`WHITELIST_NOTICE_${String(noticed?.status).toUpperCase().replace(/[^A-Z]/g, '_').slice(0, 24)}`, { code: noticed?.code ?? null });
        }
        return;
      }
      await reconciler.runOnce();
      try { if (await shuttleOutbox.recheckParkedShuttleWork() > 0) trace('SHUTTLE_SELF_HEAL_REQUEUED'); }
      catch { fault('SHUTTLE_SELF_HEAL_UNAVAILABLE'); }
      // Bounded round-robin: a busy case queue cannot starve membership or role revocation.
      for (const worker of delivery.workers) { if (!active()) break; await worker.runOnce(owner); }
    })().finally(() => { ticking = false; });
    return workerTask;
  }
  function schedule() {
    if (!active()) return;
    clearTimeout(timer);
    // A wake that arrived during the last tick may have committed after its worker ran; go again at once.
    const delay = wakeQueued ? 0 : fixed.workerIntervalMs; wakeQueued = false;
    timer = setTimeout(() => {
      workerTask = tick().catch(() => fault('RUNTIME_WORKER_UNAVAILABLE')).finally(schedule);
    }, delay);
  }
  /** Runs the normal tick now. Coalesced: one tick at a time, and only once automatic workers are running. */
  function wake() {
    if (!scheduled || !active()) return;
    if (ticking) { wakeQueued = true; return; }
    clearTimeout(timer);
    workerTask = tick().catch(() => fault('RUNTIME_WORKER_UNAVAILABLE')).finally(schedule);
  }
  async function stop() {
    stopping = true; clearTimeout(timer);
    const results = await Promise.allSettled([interactions.close(), dashboardListening ? dashboard.close() : undefined, activityListening ? activity.close() : undefined, aiRuntime?.stop(), preferenceExpiry?.stop(), gateway.stop(), workerTask]);
    results.push(...await Promise.allSettled([knowledgeAdministration?.stop()]));
    dashboardListening = false; activityListening = false;
    await gatewayTask;
    requireCondition(results.every(result => result.status === 'fulfilled'), 'RUNTIME_SHUTDOWN_INCOMPLETE');
  }
  return Object.freeze({
    async start({ automaticWorkers = true, ephemeralPorts = false } = {}) {
      requireCondition(!started && !stopping && typeof automaticWorkers === 'boolean' && typeof ephemeralPorts === 'boolean', 'RUNTIME_ALREADY_STARTED');
      requireCondition(await runtimeDatabaseAvailable(pool), 'RUNTIME_MAINTENANCE_ACTIVE');
      started = true;
      try {
        const interactionAddress = await interactions.listen(ephemeralPorts ? 0 : fixed.interactionPort);
        const dashboardAddress = dashboard === null ? null : await dashboard.listen(ephemeralPorts ? 0 : fixed.dashboardPort);
        dashboardListening = dashboardAddress !== null;
        const activityAddress = activity === null ? null : await activity.listen(ephemeralPorts ? 0 : fixed.activity.port);
        activityListening = activityAddress !== null;
        requireCondition(!stopping, 'RUNTIME_STOPPED');
        gatewayTask = gateway.start(owner).then(result => { if (!stopping) { stopping = true; clearTimeout(timer); fault('RUNTIME_GATEWAY_HALTED'); } return result; });
        // Go live persists across restarts and deployments: active channels follow the installed release.
        if(aiRuntime && aiWorker?.release)try {await activationRebind?.(aiWorker.release);await activationFollow?.();}catch{fault('AI_QUALIFICATION_REBIND_UNAVAILABLE');}
        if(aiRuntime)try {await aiRuntime.start();}catch{fault('AI_WORKER_CONNECTION_UNAVAILABLE');}
        preferenceExpiry?.start();
        if (automaticWorkers) { scheduled = true; schedule(); }
        return { interactions: interactionAddress, dashboard: dashboardAddress, ...(activity === null ? {} : { activity: activityAddress }) };
      } catch (error) { await stop(); throw error; }
    },
    runOnce: tick,
    async status() { return { environment: 'staging', productionReady: false, started, stopping, current: await enabled(), gateway: await gateway.readStatus() }; },
    stop,
  });
}
