import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireKeys } from '../../../contracts/validation.js';
import { CONFIGURED_CAPABILITIES, validateCapabilityPolicy } from '../../../platform/authorization/actor-policy.js';
import { RESPONDER_TYPES, responderRoles } from '../../../platform/authorization/case-responders.js';
import { validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';

const stable = value => Array.isArray(value) ? value.map(stable) : value !== null && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const permissionDigest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function permissionBase(configuration) {
  const { mapping, capabilityPolicy, casePolicy } = configuration;
  return structuredClone({ mapping, capabilityPolicy, casePolicy });
}
export function initialPermissions(configuration) {
  return { baseHash: permissionDigest(permissionBase(configuration)), staff: configuration.mapping.staff,
    crew: configuration.mapping.crew, muzzled: configuration.mapping.muzzled, whitelist: configuration.mapping.whitelist,
    leadOps: configuration.mapping.leadOps, categoryId: configuration.casePolicy.categoryId,
    grants: Object.fromEntries(CONFIGURED_CAPABILITIES.map(key => [key, [...(configuration.capabilityPolicy.grants[key] ?? [])].sort()])),
    responders: Object.fromEntries(RESPONDER_TYPES.map(key => [key, [...responderRoles(configuration.casePolicy, key)].sort()])) };
}

/** Bounded settings only. Credentials, identity and externally owned roles remain deployment inputs. */
export function canonicalPermissions(document, configuration) {
  const membership = ['crew', 'muzzled', 'whitelist'];
  requireKeys(document, ['baseHash', 'staff', 'leadOps', 'categoryId', 'grants', 'responders', ...membership.filter(key => Object.hasOwn(document, key))]);
  document = { ...Object.fromEntries(membership.map(key => [key, configuration.mapping[key]])), ...document };
  requireCondition(typeof document.baseHash === 'string' && /^[a-f0-9]{64}$/.test(document.baseHash), 'PERMISSION_INPUT_INVALID');
  for (const key of ['staff', 'leadOps', 'categoryId', ...membership]) requireId(document[key]);
  // A role cannot change its meaning during migration (for example Muzzled into Crew).
  const mappings = [...membership,'staff','leadOps'];
  for (const key of mappings) requireCondition(mappings.every(other => other === key || document[key] !== configuration.mapping[other]), 'ROLE_OWNERSHIP_CONFLICT');
  requireKeys(document.grants, CONFIGURED_CAPABILITIES);
  const proposed = { ...configuration.capabilityPolicy, staff: document.staff, leadOps: document.leadOps, muzzled: document.muzzled,
    grants: document.grants, responders: document.responders };
  validateCapabilityPolicy(proposed);
  const fixed = { baseHash: document.baseHash, staff: document.staff, leadOps: document.leadOps, categoryId: document.categoryId,
    crew: document.crew, muzzled: document.muzzled, whitelist: document.whitelist,
    grants: Object.fromEntries(CONFIGURED_CAPABILITIES.map(key => [key, [...document.grants[key]].sort()])),
    responders: Object.fromEntries(RESPONDER_TYPES.map(key => [key, [...document.responders[key]].sort()])) };
  permissionCandidate(fixed, configuration); return fixed;
}

export function permissionCandidate(document, configuration) {
  const next = structuredClone(configuration), { staff, leadOps, responders, grants, categoryId } = document;
  const membership = Object.fromEntries(['crew', 'muzzled', 'whitelist'].map(key => [key, document[key] ?? configuration.mapping[key]]));
  Object.assign(next.mapping, { staff, leadOps, ...membership });
  Object.assign(next.capabilityPolicy, { staff, leadOps, responders, grants, muzzled: membership.muzzled, version: configuration.capabilityPolicy.version + 1 });
  Object.assign(next.casePolicy, { staff, leadOps, responders, categoryId });
  // Do not invalidate existing provisions when only capability grants change.
  const previous = initialPermissions(configuration);
  if (staff !== previous.staff || leadOps !== previous.leadOps || categoryId !== previous.categoryId ||
      permissionDigest(responders) !== permissionDigest(previous.responders)) next.casePolicy.version++;
  else next.casePolicy = structuredClone(configuration.casePolicy);
  validateRoleMapping(next.mapping); validateCapabilityPolicy(next.capabilityPolicy); validateCasePolicy(next.casePolicy);
  return permissionBase(next);
}
