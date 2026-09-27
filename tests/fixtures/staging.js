import { mapping } from './discord.js';
import { casePolicy } from './cases.js';
import { APPLICATION } from './interactions.js';
import { dashboardConfiguration } from './oauth.js';
import { GUILD, STAFF, LEAD } from './domain.js';

export function stagingConfiguration(publicKeyHex, dashboard = dashboardConfiguration) {
  return { schemaVersion: 1, environment: 'staging', isolatedGuild: true, applicationId: APPLICATION, publicKeyHex,
    mapping: structuredClone(mapping), casePolicy: structuredClone(casePolicy),
    capabilityPolicy: { guildId: GUILD, version: 1, staff: STAFF, leadOps: LEAD, muzzled: mapping.muzzled,
      grants: { 'member.mute': [STAFF, LEAD], 'member.unmute': [STAFF, LEAD], 'shuttle.publish': [LEAD], 'case.registry': [LEAD], 'case.forms.publish': [LEAD] } },
    limits: { memberOpen: 2, guildPending: 3, cooldownMs: 1000 }, definitionId: 'shuttle-v1', captureEnabled: true,
    interactionPort: 38121, dashboardPort: 38122, dashboard, workerIntervalMs: 250,
    exportPolicy: { version: 1, enabled: true, audience: 'current-readers', maxObservations: 100, maxGaps: 200, maxBytes: 2_097_152 } };
}
