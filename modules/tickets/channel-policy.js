import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';
import { PERMISSIONS, permissionBits, validateOverwrites } from '../../platform/authorization/discord-permissions.js';
import { CASE_TYPES } from './index.js';
import { requireCaseToken } from './references.js';
import { validateCaseAudience } from './participants.js';
import { responderRoles, validateResponders } from '../../platform/authorization/case-responders.js';

const READ_WRITE = PERMISSIONS.viewChannel | PERMISSIONS.sendMessages | PERMISSIONS.readHistory |
  PERMISSIONS.embedLinks | PERMISSIONS.addReactions;
export const CASE_CHANNEL_BITS = READ_WRITE | PERMISSIONS.attachFiles;
export const CASE_CLOSED_WRITE_BITS = PERMISSIONS.sendMessages | PERMISSIONS.embedLinks | PERMISSIONS.attachFiles |
  PERMISSIONS.addReactions | PERMISSIONS.createPublicThreads | PERMISSIONS.createPrivateThreads |
  PERMISSIONS.sendMessagesInThreads | PERMISSIONS.sendVoiceMessages | PERMISSIONS.sendPolls | PERMISSIONS.useExternalApps;

export function caseChannelMode(value) {
  const mode = value === true ? 'sealed' : value === false ? 'open' : value;
  requireCondition(['open', 'closed', 'sealed'].includes(mode), 'INVALID_CASE_CHANNEL_MODE'); return mode;
}

export function validateCasePolicy(policy) {
  requireKeys(policy, ['guildId', 'botUserId', 'staff', 'leadOps', 'categoryId', 'version', 'attachmentsAllowed', ...(Object.hasOwn(policy, 'responders') ? ['responders'] : [])]);
  const ids = ['guildId', 'botUserId', 'staff', 'leadOps', 'categoryId'].map(key => policy[key]);
  ids.forEach(requireId);
  requireCondition(new Set(ids).size === ids.length, 'CASE_CONFIGURATION_INVALID');
  requireInteger(policy.version, 1);
  validateResponders(policy);
  requireCondition(typeof policy.attachmentsAllowed === 'boolean', 'CASE_CONFIGURATION_INVALID');
}

export function validateCasePlan(plan) {
  requireKeys(plan, ['id', 'guildId', 'openerId', 'type', 'policyVersion', 'token', 'presenceEpoch', ...(Object.hasOwn(plan ?? {}, 'audience') ? ['audience'] : [])]);
  requireName(plan.id); requireId(plan.guildId); requireId(plan.openerId);
  requireCondition(CASE_TYPES.some(type => type.id === plan.type), 'UNKNOWN_CASE_TYPE');
  requireInteger(plan.policyVersion, 1); requireInteger(plan.presenceEpoch);
  requireCaseToken(plan.token);
  if (Object.hasOwn(plan, 'audience')) validateCaseAudience(plan.audience, plan.guildId, plan.openerId);
}

export function caseIdentityKey(plan) {
  validateCasePlan(plan); return JSON.stringify([plan.id, plan.guildId, plan.openerId, plan.type, plan.policyVersion, plan.token, plan.presenceEpoch]);
}
export function casePlanKey(plan) { return JSON.stringify([caseIdentityKey(plan), plan.audience ?? null]); }

export function caseMarker(plan) { validateCasePlan(plan); return `sophie:case:v1:${plan.token}`; }

/** Initial creation is bot-only; audience access is a separately confirmed operation. */
export function caseChannelPayload(plan, policy, sealed) {
  validateCasePlan(plan); validateCasePolicy(policy);
  requireCondition(plan.guildId === policy.guildId && plan.policyVersion === policy.version && plan.openerId !== policy.botUserId, 'CASE_CONFIGURATION_INVALID');
  const mode = caseChannelMode(sealed), closed = mode === 'closed';
  const overwrite = (id, type, allow, deny = 0n) => ({ id, type, allow: String(allow), deny: String(deny) });
  const overwrites = [overwrite(policy.guildId, 0, 0n, CASE_CHANNEL_BITS | (closed ? CASE_CLOSED_WRITE_BITS : 0n)), overwrite(policy.botUserId, 1, CASE_CHANNEL_BITS)];
  if (mode !== 'sealed') {
    const allowed = closed ? PERMISSIONS.viewChannel | PERMISSIONS.readHistory : READ_WRITE | (policy.attachmentsAllowed ? PERMISSIONS.attachFiles : 0n);
    const denied = closed ? CASE_CLOSED_WRITE_BITS : 0n;
    const responders = responderRoles(policy, plan.type);
    for (const id of responders) overwrites.push(overwrite(id, 0, allowed, denied));
    overwrites.push(overwrite(plan.openerId, 1, allowed, denied));
    for (const participant of plan.audience?.participants ?? []) {
      requireCondition(![policy.guildId, policy.botUserId, policy.staff, policy.leadOps, ...responders].includes(participant.userId), 'CASE_CONFIGURATION_INVALID');
      overwrites.push(overwrite(participant.userId, 1, allowed, denied));
    }
  }
  // Neither a subject identifier nor a display name can become an audience member.
  return { name: `case-${plan.token.slice(0, 12)}`, type: 0, parent_id: policy.categoryId,
    topic: caseMarker(plan), permission_overwrites: overwrites };
}

export function sameOverwrites(actual, expected) {
  validateOverwrites(actual); validateOverwrites(expected);
  const canonical = rows => rows.map(row => [row.type, row.id, String(permissionBits(row.allow)), String(permissionBits(row.deny))])
    .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`));
  return JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
}

export function requireCaseChannel(channel, plan, policy, sealed) {
  const expected = caseChannelPayload(plan, policy, sealed);
  requireKeys(channel, ['id', 'guildId', 'type', 'parentId', 'marker', 'overwrites']); requireId(channel.id);
  requireCondition(channel.guildId === plan.guildId && channel.type === 0 && channel.marker === expected.topic, 'CASE_CHANNEL_MISMATCH');
  requireCondition(channel.parentId === policy.categoryId && sameOverwrites(channel.overwrites, expected.permission_overwrites), 'CASE_CHANNEL_ACL_MISMATCH');
}
