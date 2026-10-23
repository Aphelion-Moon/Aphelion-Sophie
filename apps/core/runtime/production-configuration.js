import { requireCondition, requireId, requireKeys } from '../../../contracts/validation.js';
import { validateStagingRuntime } from './configuration.js';

/**
 * The Activity-and-AI production configuration (owner decision, 23 October 2026), built from the guild's existing roles.
 * Unlike staging bootstrap it creates nothing in Discord: Sophie reads Crew, Muzzled, Whitelist, Staff and Lead Ops to check
 * eligibility and grants, and the other bot keeps owning them. Lead Ops is the Activity tester gate and holds the AI
 * controls. Mute, case and form grants are present only because the policy contract requires them; no route or command
 * can use them in this scope.
 */
export function productionConfiguration(input) {
  requireKeys(input, ['guildId', 'applicationId', 'publicKeyHex', 'botUserId', 'roles', 'protectedCategoryId', 'dashboardOrigin', 'activityOrigin',
    'interactionPort', 'dashboardPort', 'activityPort']);
  requireKeys(input.roles, ['crew', 'muzzled', 'whitelist', 'staff', 'leadOps'], 'INVALID_ROLE_OWNERSHIP');
  for (const id of [input.guildId, input.applicationId, input.botUserId, input.protectedCategoryId, ...Object.values(input.roles)]) requireId(id);
  requireCondition(new Set(Object.values(input.roles)).size === 5 && !Object.values(input.roles).includes(input.guildId), 'INVALID_ROLE_OWNERSHIP');
  const { guildId, applicationId, botUserId, roles } = input, leadOps = [roles.leadOps];
  const configuration = { schemaVersion: 1, environment: 'production', isolatedGuild: false, scope: 'activity-ai',
    applicationId, publicKeyHex: input.publicKeyHex,
    mapping: { guildId, botUserId, ...roles, externallyOwnedRoleIds: [] },
    capabilityPolicy: { guildId, version: 1, staff: roles.staff, leadOps: roles.leadOps, muzzled: roles.muzzled,
      grants: { 'member.mute': leadOps, 'member.unmute': leadOps, 'shuttle.publish': leadOps, 'case.registry': leadOps,
        'ai.control': leadOps, 'ai.personality.publish': leadOps, 'ai.knowledge.publish': leadOps, 'ai.runtime.apply': leadOps, 'ai.memory.audit': leadOps } },
    // The other bot's case category: never a place Sophie's AI looks, even if a channel there were configured by mistake.
    casePolicy: { guildId, botUserId, staff: roles.staff, leadOps: roles.leadOps, categoryId: input.protectedCategoryId, version: 1, attachmentsAllowed: false },
    limits: { memberOpen: 2, guildPending: 20, cooldownMs: 10000 }, definitionId: 'shuttle-v1', captureEnabled: false, automationEnabled: false,
    interactionPort: input.interactionPort, dashboardPort: input.dashboardPort, workerIntervalMs: 1000,
    exportPolicy: { version: 1, enabled: false, audience: 'current-readers', maxObservations: 100, maxGaps: 200, maxBytes: 2_097_152 },
    dashboard: { guildId, applicationId, version: 1, origin: input.dashboardOrigin },
    activity: { origin: input.activityOrigin, port: input.activityPort, status: 'testing' } };
  validateStagingRuntime(configuration);
  return configuration;
}
