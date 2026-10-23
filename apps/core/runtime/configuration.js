import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../../contracts/validation.js';
import { validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';
import { validateCapabilityPolicy } from '../../../platform/authorization/actor-policy.js';
import { validateDashboardAuth } from '../../../contracts/dashboard-auth.js';
import { validateActivityConfiguration } from '../../../modules/onboarding/activity.js';
import { validateTranscriptExportPolicy } from '../../../modules/tickets/transcript-export.js';
import { RESPONDER_TYPES, responderRoles } from '../../../platform/authorization/case-responders.js';

/** Staging is an explicit deployment scope, never a switch that approves production. No secrets in this document. */
/**
 * Production, Activity and AI only (owner decision, 23 October 2026): Sophie joins a guild whose roles another bot owns.
 * Only the Shuttle Activity (tester gate), the AI and /sophie and /lookup run; no member role is reconciled or granted, and
 * no case, moderation, Shuttle-channel, automation or permission work runs. Every other configuration is isolated staging.
 */
export const runtimeScope = value => value?.environment === 'production' ? value.scope : 'full';

export function validateStagingRuntime(value) {
  const production = value?.environment === 'production';
  requireKeys(value, ['schemaVersion', 'environment', 'isolatedGuild', 'applicationId', 'publicKeyHex', 'mapping',
    'capabilityPolicy', 'casePolicy', 'limits', 'definitionId', 'captureEnabled', 'interactionPort', 'dashboardPort',
    'dashboard', 'workerIntervalMs', 'exportPolicy', ...(production ? ['scope'] : []), ...['automationEnabled', 'activity'].filter(key => Object.hasOwn(value, key))]);
  requireCondition(value.schemaVersion === 1 && (value.environment === 'staging' && value.isolatedGuild === true ||
    production && value.isolatedGuild === false && value.scope === 'activity-ai'), 'ISOLATED_STAGING_REQUIRED');
  // Nothing that writes case records, captures messages, automates channels or exports cases runs in production.
  if (production) requireCondition(value.captureEnabled === false && value.automationEnabled !== true && value.exportPolicy?.enabled === false, 'PRODUCTION_SCOPE_INVALID');
  requireId(value.applicationId); requireName(value.definitionId);
  requireCondition(typeof value.publicKeyHex === 'string' && /^[a-fA-F0-9]{64}$/.test(value.publicKeyHex), 'INTERACTION_VERIFIER_CONFIGURATION_INVALID');
  validateRoleMapping(value.mapping); validateCapabilityPolicy(value.capabilityPolicy); validateCasePolicy(value.casePolicy); validateTicketLimits(value.limits);
  const { mapping, casePolicy, capabilityPolicy } = value;
  requireCondition(RESPONDER_TYPES.every(type => JSON.stringify([...responderRoles(casePolicy, type)].sort()) ===
    JSON.stringify([...responderRoles(capabilityPolicy, type)].sort()) && !responderRoles(casePolicy, type).includes(mapping.muzzled)), 'RUNTIME_MAPPING_MISMATCH');
  requireCondition(casePolicy.attachmentsAllowed === false, 'STAGING_ATTACHMENT_ACQUISITION_UNAVAILABLE');
  requireCondition(casePolicy.guildId === mapping.guildId && capabilityPolicy.guildId === mapping.guildId && casePolicy.botUserId === mapping.botUserId &&
    ['staff', 'leadOps'].every(key => casePolicy[key] === mapping[key] && capabilityPolicy[key] === mapping[key]) &&
    capabilityPolicy.muzzled === mapping.muzzled, 'RUNTIME_MAPPING_MISMATCH');
  requireCondition(typeof value.captureEnabled === 'boolean', 'STAGING_CONFIGURATION_INVALID');
  requireCondition(value.automationEnabled === undefined || typeof value.automationEnabled === 'boolean','STAGING_CONFIGURATION_INVALID');
  requireInteger(value.interactionPort, 1024, 65535); requireInteger(value.dashboardPort, 1024, 65535);
  requireCondition(value.interactionPort !== value.dashboardPort, 'RUNTIME_PORT_CONFLICT');
  requireInteger(value.workerIntervalMs, 250, 10000);
  validateTranscriptExportPolicy(value.exportPolicy);
  if (value.dashboard !== null) {
    validateDashboardAuth(value.dashboard);
    requireCondition(value.dashboard.guildId === mapping.guildId && value.dashboard.applicationId === value.applicationId, 'RUNTIME_MAPPING_MISMATCH');
  }
  // The Shuttle Activity signs members in with the dashboard's OAuth application, on its own loopback port.
  if (value.activity !== undefined) {
    validateActivityConfiguration(value.activity);
    requireCondition(value.dashboard !== null && value.activity.origin !== value.dashboard.origin, 'ACTIVITY_CONFIGURATION_INVALID');
    requireCondition(![value.interactionPort, value.dashboardPort].includes(value.activity.port), 'RUNTIME_PORT_CONFLICT');
  }
}
