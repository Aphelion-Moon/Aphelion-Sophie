import { runAiOperationsSuite } from './integration/ai-operations-suite.mjs';
import { runAiKnowledgeSuite } from './integration/ai-knowledge-suite.mjs';
import { runAiControlsSuite } from './integration/ai-controls-suite.mjs';
import { runAiEffectsSuite } from './integration/ai-effects-suite.mjs';
import { runAiPreferencesSuite } from './integration/ai-preferences-suite.mjs';
import { runOnboardingChannelLifecycleSuite } from './integration/onboarding-channel-lifecycle-suite.mjs';
import { runSystemWordingSuite } from './integration/system-wording-suite.mjs';
import { runStagingUpgradeSuite } from './integration/staging-upgrade-suite.mjs';
import { runPermissionEditorSuite } from './integration/permission-editor-suite.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTestCluster } from './lib/postgres-test-cluster.mjs';
import { runRecoverySuite } from './integration/recovery-suite.mjs';
import { runRecoveryControlsSuite } from './integration/recovery-controls-suite.mjs';
import { runContactNavigationSuite } from './integration/contact-navigation-suite.mjs';
import { runContactEntrySuite } from './integration/contact-entry-suite.mjs';
import { runCaseManagementSuite } from './integration/case-management-suite.mjs';
import { runCaseLabelsSuite } from './integration/case-labels-suite.mjs';
import { runAutomationRecoverySuite } from './integration/automation-recovery-suite.mjs';
import { runAutomationDeliverySuite } from './integration/automation-delivery-suite.mjs';
import { runAutomationAdmissionSuite } from './integration/automation-admission-suite.mjs';
import { runAutomationPoliciesSuite } from './integration/automation-policies-suite.mjs';
import { runCuratedAnswersSuite } from './integration/curated-answers-suite.mjs';
import { runCaseRepliesSuite } from './integration/case-replies-suite.mjs';
import { runCaseNotesSuite } from './integration/case-notes-suite.mjs';
import { runCaseDirectNoticeSuite } from './integration/case-direct-notice-suite.mjs';
import { runStorageSuite } from './integration/storage-suite.mjs';
import { runDeliverySuite } from './integration/discord-delivery-suite.mjs';
import { runMemberDeliverySuite } from './integration/member-delivery-suite.mjs';
import { runAuthorizationSuite } from './integration/authorization-suite.mjs';
import { runCaseDeliverySuite } from './integration/case-delivery-suite.mjs';
import { runGatewaySuite } from './integration/gateway-suite.mjs';
import { runOnboardingEntrySuite } from './integration/onboarding-entry-suite.mjs';
import { runOnboardingScreenSuite } from './integration/onboarding-screen-suite.mjs';
import { runOnboardingNavigationSuite } from './integration/onboarding-navigation-suite.mjs';
import { runOnboardingAssistanceSuite } from './integration/onboarding-assistance-suite.mjs';
import { runOnboardingPauseSuite } from './integration/onboarding-pause-suite.mjs';
import { runOnboardingAlertSuite } from './integration/onboarding-alert-suite.mjs';
import { runOnboardingDeliveryIssueSuite } from './integration/onboarding-delivery-issue-suite.mjs';
import { runOnboardingArtifactRecoverySuite } from './integration/onboarding-artifact-recovery-suite.mjs';
import { runOnboardingChannelChoiceSuite } from './integration/onboarding-channel-choice-suite.mjs';
import { runCaseLifecycleSuite } from './integration/case-lifecycle-suite.mjs';
import { runCaseStaffSuite } from './integration/case-staff-suite.mjs';
import { runCaseInspectionSuite } from './integration/case-inspection-suite.mjs';
import { runDashboardAuthSuite } from './integration/dashboard-auth-suite.mjs';
import { runOnboardingAuthoringSuite } from './integration/onboarding-authoring-suite.mjs';
import { runCaseIntakeSuite } from './integration/case-intake-suite.mjs';
import { runPlayerReportSuite } from './integration/player-report-suite.mjs';
import { runCaseParticipantAuthoritySuite } from './integration/case-participant-authority-suite.mjs';
import { runCaseParticipantsSuite } from './integration/case-participants-suite.mjs';
import { runCaseContactsSuite } from './integration/case-contacts-suite.mjs';
import { runCaseConversationsSuite } from './integration/case-conversations-suite.mjs';
import { runCaseAttachmentsSuite } from './integration/case-attachments-suite.mjs';
import { runAttachmentOperationsSuite } from './integration/attachment-operations-suite.mjs';
import { runCaseTranscriptsSuite } from './integration/case-transcripts-suite.mjs';
import { runCaseExportsSuite } from './integration/case-exports-suite.mjs';
import { runStagingRuntimeSuite } from './integration/staging-runtime-suite.mjs';
import { runCaseIntakeDeliverySuite } from './integration/case-intake-delivery-suite.mjs';
import { runCaseFormAuthoringSuite } from './integration/case-form-authoring-suite.mjs';
import { runCaseDeliveryIssueSuite } from './integration/case-delivery-issue-suite.mjs';
import { sha256, sourceFiles } from './lib/repository-checks.mjs';

const root = resolve(import.meta.dirname, '..');
const selected = process.argv.find(value => value.startsWith('--suite='))?.slice(8) ?? null;
if (process.argv.slice(2).some(value => !['--record', '--suite=ai', '--suite=onboarding-lifecycle', '--suite=staging-upgrade', '--suite=permissions', '--suite=configuration', '--suite=authorization', '--suite=dashboard-auth', '--suite=shuttle-authoring', '--suite=onboarding', '--suite=system-wording', '--suite=automation-recovery', '--suite=automation-delivery', '--suite=automation-admission', '--suite=automation', '--suite=answers', '--suite=replies', '--suite=contact-navigation', '--suite=contact-entry', '--suite=management', '--suite=labels', '--suite=notes', '--suite=controls', '--suite=recovery', '--suite=transcripts', '--suite=staging', '--suite=exports', '--suite=attachment-operations', '--suite=intake', '--suite=direct-notices'].includes(value)) ||
    process.argv.filter(value => value.startsWith('--suite=')).length > 1) throw new Error('UNKNOWN_STORAGE_SUITE_ARGUMENT');
const results = [];
console.log('Starting isolated PostgreSQL synthetic checks (no existing database login).');
const cluster = await createTestCluster();
let cleanup = false;
try {
  const run = async (name, work) => {
    try { await work(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
    catch (error) {
      results.push({ name, status: 'failed', code: /^[A-Z_0-9]{1,64}$/.test(error.code ?? '') ? error.code : 'ASSERTION_OR_RUNTIME_FAILURE' });
      console.error(`FAIL ${name}`);
      throw error;
    }
  };
  const suites = [runAiOperationsSuite,runAiKnowledgeSuite,runAiControlsSuite,runAiEffectsSuite,runAiPreferencesSuite,runOnboardingChannelLifecycleSuite,runStagingUpgradeSuite,runPermissionEditorSuite,runAutomationRecoverySuite, runAutomationDeliverySuite, runAutomationAdmissionSuite, runAutomationPoliciesSuite, runCuratedAnswersSuite, runCaseRepliesSuite, runContactNavigationSuite, runContactEntrySuite, runCaseManagementSuite, runCaseLabelsSuite, runCaseNotesSuite, runRecoveryControlsSuite, runRecoverySuite, runDeliverySuite, runMemberDeliverySuite, runAuthorizationSuite, runCaseDeliverySuite, runGatewaySuite,
    runOnboardingEntrySuite, runOnboardingScreenSuite, runOnboardingNavigationSuite, runOnboardingAssistanceSuite, runOnboardingPauseSuite,
    runOnboardingAlertSuite, runOnboardingDeliveryIssueSuite, runOnboardingArtifactRecoverySuite, runOnboardingChannelChoiceSuite,
    runCaseLifecycleSuite, runCaseStaffSuite, runCaseInspectionSuite, runDashboardAuthSuite, runOnboardingAuthoringSuite,
    runCaseIntakeSuite, runCaseIntakeDeliverySuite, runCaseDeliveryIssueSuite, runCaseDirectNoticeSuite, runCaseFormAuthoringSuite, runPlayerReportSuite,
    runCaseParticipantAuthoritySuite, runCaseParticipantsSuite, runCaseContactsSuite, runCaseConversationsSuite, runCaseAttachmentsSuite, runAttachmentOperationsSuite, runCaseTranscriptsSuite, runStagingRuntimeSuite, runCaseExportsSuite, runSystemWordingSuite];
  const selectedSuites = { ai: [runAiOperationsSuite,runAiControlsSuite,runAiEffectsSuite,runAiPreferencesSuite,runGatewaySuite,runAiKnowledgeSuite], configuration:[(cluster,run)=>runPermissionEditorSuite(cluster,run,true)], 'onboarding-lifecycle': [runOnboardingChannelLifecycleSuite], 'system-wording': [runSystemWordingSuite], onboarding: [runOnboardingScreenSuite, runOnboardingPauseSuite, runOnboardingNavigationSuite, runOnboardingAlertSuite, runOnboardingArtifactRecoverySuite, runSystemWordingSuite], 'staging-upgrade': [runRecoverySuite, runStagingUpgradeSuite], permissions: [runPermissionEditorSuite, runAuthorizationSuite], 'shuttle-authoring': [runOnboardingAuthoringSuite, runOnboardingScreenSuite, runOnboardingPauseSuite], authorization: [runAuthorizationSuite], 'dashboard-auth': [runDashboardAuthSuite], 'automation-recovery': [runAutomationRecoverySuite], 'automation-delivery': [runAutomationDeliverySuite], 'automation-admission': [runAutomationAdmissionSuite,runGatewaySuite], automation: [runAutomationPoliciesSuite], answers: [runCuratedAnswersSuite], replies: [runCaseRepliesSuite], 'contact-navigation': [runCaseContactsSuite, runContactNavigationSuite], 'contact-entry': [runCaseContactsSuite, runContactEntrySuite], management: [runCaseLifecycleSuite, runCaseStaffSuite, runCaseParticipantsSuite, runCaseManagementSuite], labels: [runCaseStaffSuite, runCaseLabelsSuite], notes: [runCaseNotesSuite], controls: [runRecoveryControlsSuite], recovery: [runRecoverySuite], transcripts: [runCaseTranscriptsSuite], staging: [runStagingRuntimeSuite], exports: [runCaseTranscriptsSuite, runCaseExportsSuite],
    'attachment-operations': [runCaseAttachmentsSuite, runAttachmentOperationsSuite],
    intake: [runCaseIntakeSuite, runCaseIntakeDeliverySuite, runCaseDeliveryIssueSuite],
    'direct-notices': [runCaseDirectNoticeSuite] };
  for (const suite of selected === null ? suites : selectedSuites[selected]) { await suite(cluster, run); await cluster.checkpoint(); }
  // Stateful restart checks run without added checkpoints inside the suite.
  if (selected === null) await runStorageSuite(cluster, run);
} finally { await cluster.stop(); cleanup = true; }

const inputs = ['apps/core/storage/migrations/063-ai-worker-operations.sql', 'apps/core/storage/migrations/062-ai-preferences.sql', 'apps/core/storage/migrations/061-ai-gathering.sql', 'apps/core/storage/migrations/060-ai-effects.sql', 'apps/core/storage/migrations/059-knowledge-imports.sql', 'apps/core/storage/migrations/058-ai-accounting.sql', 'apps/core/storage/migrations/057-ai-boundaries.sql', 'apps/core/storage/migrations/056-ai-controls.sql', 'apps/core/storage/migrations/055-configuration-application.sql', ...await sourceFiles(root), 'apps/dashboard/login.html', 'apps/core/storage/migrations/054-onboarding-channel-lifecycle.sql', 'contracts/system-messages.json', 'apps/dashboard/localizations.html', 'apps/core/storage/migrations/001-core.sql', 'apps/core/storage/migrations/002-discord-backoff.sql', 'apps/core/storage/migrations/003-member-actions.sql', 'apps/core/storage/migrations/004-actor-authority.sql', 'apps/core/storage/migrations/005-case-provisioning.sql', 'package.json', 'package-lock.json',
  'apps/core/storage/migrations/006-gateway-journal.sql', 'apps/core/storage/migrations/007-gateway-identify-budget.sql',
  'apps/core/storage/migrations/008-shuttle-case-binding.sql',
  'apps/core/storage/migrations/009-shuttle-screens.sql',
  'apps/core/storage/migrations/010-shuttle-assistance.sql',
  'apps/core/storage/migrations/011-shuttle-pause.sql',
  'apps/core/storage/migrations/012-shuttle-alerts.sql',
  'apps/core/storage/migrations/013-shuttle-delivery-issues.sql',
  'apps/core/storage/migrations/014-shuttle-artifact-recovery.sql',
  'apps/core/storage/migrations/015-case-channel-selection.sql',
  'apps/core/storage/migrations/016-case-lifecycle.sql',
  'apps/core/storage/migrations/017-case-staff.sql',
  'apps/core/storage/migrations/018-case-inspections.sql',
  'apps/core/storage/migrations/019-dashboard-auth.sql',
  'apps/core/storage/migrations/020-shuttle-authoring.sql',
  'apps/core/storage/migrations/021-case-intake.sql',
  'apps/core/storage/migrations/022-case-intake-delivery.sql',
  'apps/core/storage/migrations/023-case-delivery-issues.sql',
  'apps/core/storage/migrations/024-case-form-authoring.sql',
  'apps/core/storage/migrations/025-player-reports.sql',
  'apps/core/storage/migrations/026-case-participant-presence.sql',
  'apps/core/storage/migrations/027-case-participants.sql',
  'apps/core/storage/migrations/028-staff-contact-intake.sql',
  'apps/core/storage/migrations/029-case-conversations.sql',
  'apps/core/storage/migrations/030-case-attachments.sql',
  'apps/core/storage/migrations/031-case-exports.sql', 'apps/core/storage/migrations/032-case-direct-notices.sql', 'apps/core/storage/migrations/033-recovery-controls.sql', 'apps/core/storage/migrations/034-case-notes.sql', 'apps/core/storage/migrations/035-case-labels.sql', 'apps/core/storage/migrations/036-case-replies.sql', 'apps/core/storage/migrations/037-case-reply-issues.sql', 'apps/core/storage/migrations/038-curated-answers.sql', 'apps/core/storage/migrations/039-case-reply-answers.sql', 'apps/core/storage/migrations/040-case-answer-reviews.sql', 'apps/core/storage/migrations/041-automation-policies.sql', 'apps/core/storage/migrations/042-automation-admission.sql', 'apps/core/storage/migrations/043-automation-delivery.sql', 'apps/core/storage/migrations/044-automation-recovery.sql', 'apps/core/storage/migrations/045-permission-editor.sql', 'apps/core/storage/migrations/046-dashboard-return-path.sql', 'apps/core/storage/migrations/047-runtime-maintenance.sql', 'apps/core/storage/migrations/048-permission-channel-inventory.sql', 'apps/core/storage/migrations/049-permission-sealing.sql', 'apps/core/storage/migrations/050-permission-policy-application.sql', 'apps/core/storage/migrations/051-onboarding-message.sql', 'apps/core/storage/migrations/052-system-wording.sql', 'apps/core/storage/migrations/053-wording-return-path.sql', 'apps/dashboard/permissions.html',
  'apps/dashboard/index.html', 'apps/dashboard/ticket-forms.html', 'apps/dashboard/cases.html', 'apps/dashboard/staff-notes.html', 'apps/dashboard/case-labels.html', 'apps/dashboard/manage-cases.html', 'apps/dashboard/contact-entry.html', 'apps/dashboard/contacts.html', 'apps/dashboard/styles.css', 'Sophie-Visual-Assets-v1/asset-manifest.json',
  'Sophie-Visual-Assets-v1/assets/sophie/neon-chibi-v1/sophie-avatar.png',
  'config/staging.example.json', 'legal/storage-packages.json', 'legal/postgresql-test-runtime.json', 'docs/decisions/0003-storage-dependencies.md'];
const files = await Promise.all(inputs.sort().map(async path => ({ path, sha256: sha256(await readFile(resolve(root, path))) })));
const report = { schemaVersion: 1, recordedAt: new Date().toISOString(), buildId: sha256(JSON.stringify(files)),
  selection: selected ?? 'all',
  scope: 'Isolated PostgreSQL, simulated Discord/OAuth HTTP and loopback HTTP/WebSocket ingress; not live Discord/OAuth acceptance, browser TLS, OS identity isolation, off-host recovery or production approval',
  runtime: { node: process.version, postgres: cluster.runtime.version }, tests: { total: results.length, passed: results.filter(x => x.status === 'passed').length, failed: results.filter(x => x.status === 'failed').length, skipped: 0 },
  clusterStopped: cleanup, results, files };
if (process.argv.includes('--record')) {
  await mkdir(resolve(root, 'docs/evidence'), { recursive: true });
  await writeFile(resolve(root, `docs/evidence/${selected === null ? 'storage' : selected}-verification.json`), `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify({ ...report.tests, clusterStopped: cleanup, productionReady: false }, null, 2));
