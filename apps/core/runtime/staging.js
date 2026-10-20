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
import { createSystemWordingReader, createSystemWordingStore } from '../storage/system-wording.js';
import { randomUUID } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { validateStagingRuntime } from './configuration.js';
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
import { createOutbox } from '../storage/outbox.js';
import { createCaseReconciler } from '../discord/case-reconciler.js';
import { createCaseInspectionStore } from '../storage/case-inspections.js';
import { createCorePrincipals } from '../security/principals.js';
import { createDashboardAuthStore } from '../storage/dashboard-auth.js';
import { createDashboardAuth } from '../security/dashboard-auth.js';
import { createDiscordOAuth } from '../discord/oauth.js';
import { createDashboardAuthHttpServer } from '../http/dashboard-auth.js';
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

/** Explicit staging host. Construction starts no listener, connection, registration, migration or service. */
export async function createStagingRuntime({ configuration, pool, aiControlPool = null, aiPreferenceJournal = null, aiWorker = null, aiKnowledge = null, aiKnowledgeAdmin = null, aiKnowledgeAdminFactory = null, aiApproval = null, aiActivationPool = null, aiRestoreCurrent = async () => false, token, clientSecret = null, fetch, connect, clock = Date.now, random = Math.random, onFault, onTrace = () => {}, rateLimits = createDiscordRateLimits(), configurationApplyEnabled = false, gatewayLeaseMs = 30_000 }) {
  validateStagingRuntime(configuration); const fixed = structuredClone(configuration);
  requireCondition(typeof onFault === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  await requireUnquarantinedDatabase(pool);
  requireCondition(await runtimeDatabaseAvailable(pool), 'RUNTIME_MAINTENANCE_ACTIVE');
  let started = false, stopping = false, gatewayTask = null, workerTask = Promise.resolve(), timer = null, dashboardListening = false;
  let knowledgeAdministration = null, knowledgeStarted = false;
  let maintenanceObserved = false;
  const active = () => started && !stopping && !maintenanceObserved;
  const fault = code => { try { onFault(code); } catch { /* Never log original dependency errors or payloads. */ } };
  // Timing diagnostics (fixed codes: outcome, milliseconds, request counts). Never faults, IDs or content.
  const trace = code => { try { onTrace(code); } catch { /* Diagnostics never affect the runtime. */ } };
  const databaseActive = async () => {
    if (!active()) return false;
    if (await runtimeDatabaseAvailable(pool)) return true;
    maintenanceObserved = true; fault('RUNTIME_MAINTENANCE_ACTIVE'); return false;
  };
  // Every transport below uses the same bot token, so they share Discord's buckets and must share one view of them.
  // A supervising host passes its own registry so a restarted runtime keeps the cooldowns it already learned.
  const transport = createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled: databaseActive, limits: rateLimits });
  requireCondition(aiWorker===null || aiKnowledge!==null && aiControlPool!==null, 'AI_ADAPTERS_REQUIRED');
  let aiRuntime = null, activationRebind = null, activationFollow = null;
  const privacyEffects=aiControlPool===null?null:createAiEffects({pool:aiControlPool,guildId:fixed.mapping.guildId,clock});
  const privacyMessages=privacyEffects===null?null:createAiMessages({transport,botUserId:fixed.mapping.botUserId,effects:privacyEffects,clock,canReact:async()=>false});
  const privacy=aiControlPool===null?null:createAiPrivacy({pool:aiControlPool,guildId:fixed.mapping.guildId,journal:aiPreferenceJournal,
    departures:createAiDepartures({pool,guildId:fixed.mapping.guildId}),invalidate:()=>aiRuntime?.invalidate(),onFault:fault,
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
  const journal = createGatewayJournal({ pool, mapping: fixed.mapping, clock, leaseMs: gatewayLeaseMs,
    automation: fixed.automationEnabled === true ? createAutomationAdmission({guildId:fixed.mapping.guildId,protectedCategoryId:fixed.casePolicy.categoryId,
      channels:createAutomationChannels({transport}),ingress:createAutomationIngress({guildId:fixed.mapping.guildId,botUserId:fixed.mapping.botUserId,clock})}) : null,
    caseCapture: fixed.captureEnabled ? createCaseMessageCapture({ guildId: fixed.mapping.guildId, clock }) : null });
  const observer = createGatewayObserver({ journal, mapping: fixed.mapping, applicationId: fixed.applicationId, clock, ai: aiGateway });
  const enabled = async () => await databaseActive() && await observer.isCurrent();
  const gateway = createGatewaySupervisor({ observer, transport, connect, token, clock, random, enabled: active, renewMs: Math.floor(gatewayLeaseMs / 3) });
  const verifier = createInteractionVerifier({ publicKeyHex: fixed.publicKeyHex, applicationId: fixed.applicationId, guildId: fixed.mapping.guildId, clock });
  const authRoles = createDiscordRoles({ transport: createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled, limits: rateLimits }),
    mapping: fixed.mapping, clock, readContinuity: observer.readContinuity });
  const auth = fixed.dashboard === null ? null : createDashboardAuth({ configuration: fixed.dashboard,
    store: createDashboardAuthStore({ pool, configuration: fixed.dashboard, clock }),
    oauth: createDiscordOAuth({ configuration: fixed.dashboard, clientSecret, fetch, clock, enabled }), discord: authRoles, clock, enabled });
  const principals = auth === null ? verifier : createCorePrincipals({ interactions: verifier, dashboard: auth });
  const createAiLane=worker=>createAiRuntime({ configuration: fixed, corePool: pool, controlPool: aiControlPool, worker, knowledge: aiKnowledge,
    observer, guildState, token, fetch, clock, enabled, rateLimits, onFault: fault,privacyCurrent:privacy.current,
    memory: aiPreferenceJournal === null ? null : createAiMemory({ pool: aiControlPool, guildId: fixed.mapping.guildId, journal: aiPreferenceJournal, clock }),
    memories: aiMemories === null ? null : { ...aiMemories, enabled: async () => aiApproval !== null && typeof aiApproval.automaticMemory === 'function' && await aiApproval.automaticMemory() },
    ...(aiApproval === null ? {} : { readNotice: aiApproval.notice }) });
  if(aiWorker!==null)aiRuntime=createAiLane(aiWorker);
  const readSystemText = createSystemWordingReader({ pool, guildId: fixed.mapping.guildId });
  const lane = () => createAdministrationLane({ configuration: fixed, pool, token, fetch, clock, enabled, rateLimits, observer, principals, verifier, onFault: fault, onTrace: trace, readSystemText, knowledge:aiKnowledge });
  const requests = lane(), delivery = lane();
  const responder = createInteractionResponder({ verifier, applicationId: fixed.applicationId, fetch, clock, enabled, readSystemText, ...requests.responseAdapters });
  // A recorded Shuttle change has already committed its render intent, so delivery starts now instead of at the next
  // interval. The diagnostic is a fixed code: the command result and whole milliseconds, never IDs or content.
  const interactionCommands = Object.freeze({ async execute(envelope) {
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
    onboardingPanel: createOnboardingEntryPanel({ authorization: requests.authorization, transport: requests.transport, store: requests.store, policy: fixed.casePolicy,
      definitionId: fixed.definitionId, enabled, readSystemText }),
    caseIntake: requests.caseIntake, readSystemText, enabled, onFault: fault });
  const reconciler = createCaseReconciler({ store: createCaseInspectionStore({ pool, policy: fixed.casePolicy }), enabled });
  // No Shuttle work waits for Staff: parked Shuttle jobs are rechecked on their own (see recheckParkedShuttleWork).
  const shuttleOutbox = createOutbox({ pool });
  let dashboard = null;
  if (auth !== null) {
    const browser = lane(), { authorization, roles } = browser;
    const aiChannels = createAutomationChannels({ transport: browser.transport });
    const knowledgeAdmin = knowledgeAdministration = aiKnowledgeAdminFactory?.({ authorize: authorization.authorize, invalidate: () => aiRuntime?.invalidate() });
    const knowledge = aiKnowledgeAdmin === null && !knowledgeAdmin ? null : createAiKnowledgeHttp({ auth, authorization, knowledge: aiKnowledgeAdmin ?? knowledgeAdmin.editor, invalidate: () => aiRuntime?.invalidate() });
    const qualificationObservations = aiActivationPool === null || guildState === null ? null : createAiObservations({ pool, transport: browser.transport, guildState,
      authorityStore: createActorAuthorityStore({ pool, clock }), capabilityPolicy: fixed.capabilityPolicy, mapping: fixed.mapping,
      protectedCategoryId: fixed.casePolicy.categoryId, observer, clock });
    const activation = qualificationObservations === null || aiApproval === null ? null : createAiActivation({ pool: aiActivationPool,
      guildId: fixed.mapping.guildId, authorize: authorization.authorize, inspectChannel: qualificationObservations.inspectChannel,
      approval: aiApproval, workerRelease: () => aiRuntime?.qualifiedRelease?.() ?? null, restoreCurrent: aiRestoreCurrent, clock,
      invalidate: () => aiRuntime?.invalidate() });
    activationRebind = activation === null ? null : activation.rebind; activationFollow = activation === null ? null : activation.follow;
    const knowledgeLookup = aiKnowledge === null ? null : createKnowledgeLookupHttp({ auth, authorization, knowledge: aiKnowledge, clock });
    const ai = aiControlPool === null ? null : createAiControlsHttp({ auth, authorization, trace: fault, controls: { ...createAiControls({
      pool: aiControlPool, guildId: fixed.mapping.guildId, authorize: authorization.authorize, preferenceJournal:aiPreferenceJournal, privacyCurrent:privacy.current,clock, memories: aiMemories,
      memoriesActive: async () => aiApproval !== null && typeof aiApproval.automaticMemory === 'function' && await aiApproval.automaticMemory(),
      workerStatus:()=>aiRuntime?.workerStatus?.()??{connected:false,release:null,observedAt:null},
      readDiagnostic:channelId=>aiRuntime?.diagnostics(channelId)??null,
      ...(aiApproval === null ? {} : { readNotice: aiApproval.notice }),
      memberPresence: actor => authorization.aiMemberPresence(actor),
      // A publication also moves active channels onto it (Go live persists); the follow is idempotent and owner-role only.
      invalidate: () => { aiRuntime?.invalidate(); if (activationFollow) void activationFollow().catch(() => fault('AI_QUALIFICATION_FOLLOW_UNAVAILABLE')); },
      inspectChannel: (_client, channelId) => inspectAutomationChannel(pool, { guildId: fixed.mapping.guildId,
        protectedCategoryId: fixed.casePolicy.categoryId, channels: aiChannels, channelId }),
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
      formAuthoring: createCaseFormAuthoringHttp({ auth, authorization, store: createCaseFormAuthoringStore({ pool, authorize: authorization.authorize, guildId: fixed.mapping.guildId }) }),
      presentation: await createDashboardPresentation() });
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
    const results = await Promise.allSettled([interactions.close(), dashboardListening ? dashboard.close() : undefined, aiRuntime?.stop(), preferenceExpiry?.stop(), gateway.stop(), workerTask]);
    results.push(...await Promise.allSettled([knowledgeAdministration?.stop()]));
    dashboardListening = false;
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
        requireCondition(!stopping, 'RUNTIME_STOPPED');
        gatewayTask = gateway.start(owner).then(result => { if (!stopping) { stopping = true; clearTimeout(timer); fault('RUNTIME_GATEWAY_HALTED'); } return result; });
        // Go live persists across restarts and deployments: active channels follow the installed release.
        if(aiRuntime && aiWorker?.release)try {await activationRebind?.(aiWorker.release);await activationFollow?.();}catch{fault('AI_QUALIFICATION_REBIND_UNAVAILABLE');}
        if(aiRuntime)try {await aiRuntime.start();}catch{fault('AI_WORKER_CONNECTION_UNAVAILABLE');}
        preferenceExpiry?.start();
        if (automaticWorkers) { scheduled = true; schedule(); }
        return { interactions: interactionAddress, dashboard: dashboardAddress };
      } catch (error) { await stop(); throw error; }
    },
    runOnce: tick,
    async status() { return { environment: 'staging', productionReady: false, started, stopping, current: await enabled(), gateway: await gateway.readStatus() }; },
    stop,
  });
}
