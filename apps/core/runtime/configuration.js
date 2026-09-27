import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../../contracts/validation.js';
import { validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';
import { validateCapabilityPolicy } from '../../../platform/authorization/actor-policy.js';
import { validateDashboardAuth } from '../../../contracts/dashboard-auth.js';
import { validateTranscriptExportPolicy } from '../../../modules/tickets/transcript-export.js';
import { RESPONDER_TYPES, responderRoles } from '../../../platform/authorization/case-responders.js';

/** Staging is an explicit deployment scope, never a switch that approves production. No secrets in this document. */
export function validateStagingRuntime(value) {
  requireKeys(value, ['schemaVersion', 'environment', 'isolatedGuild', 'applicationId', 'publicKeyHex', 'mapping',
    'capabilityPolicy', 'casePolicy', 'limits', 'definitionId', 'captureEnabled', 'interactionPort', 'dashboardPort',
    'dashboard', 'workerIntervalMs', 'exportPolicy', ...(Object.hasOwn(value,'automationEnabled') ? ['automationEnabled'] : [])]);
  requireCondition(value.schemaVersion === 1 && value.environment === 'staging' && value.isolatedGuild === true, 'ISOLATED_STAGING_REQUIRED');
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
}
