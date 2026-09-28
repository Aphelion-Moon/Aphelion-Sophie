import { createAiControls } from '../storage/ai-controls.js';
import { createAiPreferenceExpiry } from './ai-preference-expiry.js';
import { createAiRuntime } from './ai.js';
import { createAiOperationsRuntime } from './ai-operations.js';
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
import { createDiscordTransport } from '../discord/transport.js';
import { createDiscordRoles } from '../discord/roles.js';
import { createCaseMessageCapture } from '../discord/case-message-capture.js';
import { createGatewayJournal } from '../storage/gateway-journal.js';
import { createGatewayObserver } from '../discord/gateway-observer.js';
import { createGatewaySupervisor } from '../discord/gateway-supervisor.js';
import { createInteractionVerifier } from '../security/interaction-verifier.js';
import { createInteractionResponder } from '../discord/interaction-response.js';
import { createInteractionHttpServer } from '../discord/interaction-http.js';
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

/** Explicit staging host. Construction starts no listener, connection, registration, migration or service. */
export async function createStagingRuntime({ configuration, pool, aiControlPool = null, aiPreferenceJournal = null, aiWorker = null, aiLifecycle = null, aiKnowledge = null, aiKnowledgeAdmin = null, token, clientSecret = null, fetch, connect, clock = Date.now, random = Math.random, onFault, configurationApplyEnabled = false }) {
  validateStagingRuntime(configuration); const fixed = structuredClone(configuration);
  requireCondition(typeof onFault === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  await requireUnquarantinedDatabase(pool);
  requireCondition(await runtimeDatabaseAvailable(pool), 'RUNTIME_MAINTENANCE_ACTIVE');
  let started = false, stopping = false, gatewayTask = null, workerTask = Promise.resolve(), timer = null, dashboardListening = false;
  let maintenanceObserved = false;
  const active = () => started && !stopping && !maintenanceObserved;
  const fault = code => { try { onFault(code); } catch { /* Never log original dependency errors or payloads. */ } };
  const preferenceExpiry = aiControlPool === null ? null : createAiPreferenceExpiry({pool:aiControlPool,guildId:fixed.mapping.guildId,onFault:()=>fault('AI_CONTROL_UNAVAILABLE')});
  const databaseActive = async () => {
    if (!active()) return false;
    if (await runtimeDatabaseAvailable(pool)) return true;
    maintenanceObserved = true; fault('RUNTIME_MAINTENANCE_ACTIVE'); return false;
  };
  const transport = createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled: databaseActive });
  requireCondition((aiWorker===null || aiLifecycle===null) && (aiWorker===null && aiLifecycle===null || aiKnowledge!==null && aiControlPool!==null), 'AI_ADAPTERS_REQUIRED');
  let aiRuntime = null;
  const aiGateway = aiWorker === null && aiLifecycle===null ? null : { prepare: payload => aiRuntime?.prepare(payload) ?? null,
    committed: (proof, accepted) => aiRuntime?.committed(proof, accepted), invalidate: () => aiRuntime?.invalidate() };
  const journal = createGatewayJournal({ pool, mapping: fixed.mapping, clock,
    automation: fixed.automationEnabled === true ? createAutomationAdmission({guildId:fixed.mapping.guildId,protectedCategoryId:fixed.casePolicy.categoryId,
      channels:createAutomationChannels({transport}),ingress:createAutomationIngress({guildId:fixed.mapping.guildId,botUserId:fixed.mapping.botUserId,clock})}) : null,
    caseCapture: fixed.captureEnabled ? createCaseMessageCapture({ guildId: fixed.mapping.guildId, clock }) : null });
  const observer = createGatewayObserver({ journal, mapping: fixed.mapping, applicationId: fixed.applicationId, clock, ai: aiGateway });
  const enabled = async () => await databaseActive() && await observer.isCurrent();
  const gateway = createGatewaySupervisor({ observer, transport, connect, token, clock, random, enabled: active });
  const verifier = createInteractionVerifier({ publicKeyHex: fixed.publicKeyHex, applicationId: fixed.applicationId, guildId: fixed.mapping.guildId, clock });
  const authRoles = createDiscordRoles({ transport: createDiscordTransport({ guildId: fixed.mapping.guildId, token, fetch, clock, enabled }),
    mapping: fixed.mapping, clock, readContinuity: observer.readContinuity });
  const auth = fixed.dashboard === null ? null : createDashboardAuth({ configuration: fixed.dashboard,
    store: createDashboardAuthStore({ pool, configuration: fixed.dashboard, clock }),
    oauth: createDiscordOAuth({ configuration: fixed.dashboard, clientSecret, fetch, clock, enabled }), discord: authRoles, clock, enabled });
  const principals = auth === null ? verifier : createCorePrincipals({ interactions: verifier, dashboard: auth });
  const createAiLane=worker=>createAiRuntime({ configuration: fixed, corePool: pool, controlPool: aiControlPool, worker, knowledge: aiKnowledge,
    observer, token, fetch, clock, enabled, onFault: fault });
  if(aiWorker!==null)aiRuntime=createAiLane(aiWorker);
  if(aiLifecycle!==null)aiRuntime=createAiOperationsRuntime({pool:aiControlPool,guildId:fixed.mapping.guildId,lifecycle:aiLifecycle,createRuntime:createAiLane,onFault:fault});
  const readSystemText = createSystemWordingReader({ pool, guildId: fixed.mapping.guildId });
  const lane = () => createAdministrationLane({ configuration: fixed, pool, token, fetch, clock, enabled, observer, principals, verifier, onFault: fault, readSystemText, knowledge:aiKnowledge });
  const requests = lane(), delivery = lane();
  const responder = createInteractionResponder({ verifier, applicationId: fixed.applicationId, fetch, clock, enabled, readSystemText, ...requests.responseAdapters });
  const interactions = createInteractionHttpServer({ verifier, commands: requests.commands, respond: responder.respond,
    onboardingPanel: createOnboardingEntryPanel({ authorization: requests.authorization, transport: requests.transport, store: requests.store, policy: fixed.casePolicy,
      definitionId: fixed.definitionId, enabled, readSystemText }),
    caseIntake: requests.caseIntake, readSystemText, enabled, onFault: fault });
  const reconciler = createCaseReconciler({ store: createCaseInspectionStore({ pool, policy: fixed.casePolicy }), enabled });
  let dashboard = null;
  if (auth !== null) {
    const browser = lane(), { authorization, roles } = browser;
    const aiChannels = createAutomationChannels({ transport: browser.transport });
    const knowledge = aiKnowledgeAdmin === null ? null : createAiKnowledgeHttp({ auth, authorization, knowledge: aiKnowledgeAdmin, invalidate: () => aiRuntime?.invalidate() });
    const knowledgeLookup = aiKnowledge === null ? null : createKnowledgeLookupHttp({ auth, authorization, knowledge: aiKnowledge, clock });
    const ai = aiControlPool === null ? null : createAiControlsHttp({ auth, authorization, controls: createAiControls({
      pool: aiControlPool, guildId: fixed.mapping.guildId, authorize: authorization.authorize, preferenceJournal:aiPreferenceJournal, clock,
      workerCatalogue:aiLifecycle===null?[]:aiRuntime.catalogue,workerOperationsAvailable:aiLifecycle!==null,
      readDiagnostic:channelId=>aiRuntime?.diagnostics(channelId)??null,
      memberPresence: actor => authorization.aiMemberPresence(actor),
      invalidate: () => aiRuntime?.invalidate(),
      inspectChannel: (_client, channelId) => inspectAutomationChannel(pool, { guildId: fixed.mapping.guildId,
        protectedCategoryId: fixed.casePolicy.categoryId, channels: aiChannels, channelId }),
    }) });
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
    const contactNavigation = createContactNavigationHttp({ auth, authorization, store: browser.intakeStore, discord: roles, channels: browser.channels, enabled });
    const contactEntry = createContactEntryHttp({ auth, authorization, store: browser.intakeStore, discord: roles, channels: browser.channels, enabled });
    dashboard = createDashboardAuthHttpServer({ configuration: fixed.dashboard, auth, authorization, ai, knowledge, knowledgeLookup, enabled, onFault: fault, transcripts, caseExports, notes, replies, answers, automation, permissions, labels, management, contactEntry, contactNavigation,
      wording: createSystemWordingHttp({ auth, authorization, store: createSystemWordingStore({ pool, authorize: authorization.authorize, guildId: fixed.mapping.guildId, definitionId: fixed.definitionId }) }),
      authoring: createOnboardingAuthoringHttp({ auth, authorization, store: createOnboardingAuthoringStore({ pool, authorize: authorization.authorize,
        guildId: fixed.mapping.guildId, definitionId: fixed.definitionId }) }),
      formAuthoring: createCaseFormAuthoringHttp({ auth, authorization, store: createCaseFormAuthoringStore({ pool, authorize: authorization.authorize, guildId: fixed.mapping.guildId }) }),
      presentation: await createDashboardPresentation() });
  }
  const owner = `staging.${randomUUID()}`;
  let ticking = false;
  function tick() {
    if (ticking || !active()) return Promise.resolve();
    ticking = true;
    workerTask = (async () => {
      if (!await enabled()) return;
      await reconciler.runOnce();
      // Bounded round-robin: a busy case queue cannot starve membership or role revocation.
      for (const worker of delivery.workers) { if (!active()) break; await worker.runOnce(owner); }
    })().finally(() => { ticking = false; });
    return workerTask;
  }
  function schedule() {
    if (!active()) return;
    timer = setTimeout(() => {
      workerTask = tick().catch(() => fault('RUNTIME_WORKER_UNAVAILABLE')).finally(schedule);
    }, fixed.workerIntervalMs);
  }
  async function stop() {
    stopping = true; clearTimeout(timer);
    const results = await Promise.allSettled([interactions.close(), dashboardListening ? dashboard.close() : undefined, aiRuntime?.stop(), preferenceExpiry?.stop(), gateway.stop(), workerTask]);
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
        if(aiRuntime)try {await aiRuntime.start();}catch{fault('AI_WORKER_OPERATIONS_UNAVAILABLE');}
        preferenceExpiry?.start();
        if (automaticWorkers) schedule();
        return { interactions: interactionAddress, dashboard: dashboardAddress };
      } catch (error) { await stop(); throw error; }
    },
    runOnce: tick,
    async status() { return { environment: 'staging', productionReady: false, started, stopping, current: await enabled(), gateway: await gateway.readStatus() }; },
    stop,
  });
}
