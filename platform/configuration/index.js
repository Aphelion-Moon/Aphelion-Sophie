import { requireCondition, requireId, requireKeys } from '../../contracts/validation.js';

/** This foundation has no production transport or persistence adapter to enable. */
export function validateOfflineConfiguration(config) {
  requireKeys(config, ['schemaVersion', 'environment', 'guildId', 'deliveryEnabled', 'assistantEnabled', 'roles', 'retention', 'onboarding', 'hostEvaluation']);
  requireCondition(config.schemaVersion === 1, 'UNKNOWN_CONFIG_VERSION');
  requireCondition(config.environment === 'offline', 'LIVE_ADAPTER_NOT_IMPLEMENTED');
  requireCondition(config.deliveryEnabled === false && config.assistantEnabled === false, 'LIVE_ACTIVATION_UNAVAILABLE');
  if (config.guildId !== null) requireId(config.guildId);
  requireKeys(config.roles, ['crew', 'muzzled', 'whitelist', 'staff', 'leadOps']);
  const configured = Object.values(config.roles).filter(id => id !== null);
  configured.forEach(requireId);
  requireCondition(new Set(configured).size === configured.length, 'ROLE_OWNERSHIP_CONFLICT');
  requireKeys(config.retention, ['caseRecords', 'attachments', 'transcripts']);
  requireCondition(Object.values(config.retention).every(value => value === 'indefinite'), 'RETENTION_POLICY_MISMATCH');
  requireKeys(config.onboarding, ['source', 'definitionStatus', 'blacklistOwner', 'repeatable', 'restoreWhitelistFromSnapshot']);
  requireCondition(config.onboarding.source === 'content/onboarding/definition.json' && config.onboarding.definitionStatus === 'draft', 'UNAPPROVED_SHUTTLE_DEFINITION');
  requireCondition(config.onboarding.blacklistOwner === 'human_discord_removal' && config.onboarding.repeatable === true && config.onboarding.restoreWhitelistFromSnapshot === false, 'SHUTTLE_POLICY_MISMATCH');
  requireKeys(config.hostEvaluation, ['approved', 'maxActiveGenerations', 'maxWaitingRequests', 'generationThreads', 'promptThreads', 'requestLifetimeFromEnqueueSeconds']);
  requireCondition(config.hostEvaluation.approved === false, 'HOST_EVALUATION_NOT_RECORDED');
  requireCondition(config.hostEvaluation.maxActiveGenerations === 1 && config.hostEvaluation.maxWaitingRequests === 3 && config.hostEvaluation.generationThreads === 4 && config.hostEvaluation.promptThreads === 4 && config.hostEvaluation.requestLifetimeFromEnqueueSeconds === 120, 'HOST_OVERLAY_MISMATCH');
  return structuredClone(config);
}
