import { requireCondition, requireId, requireInteger, requireKeys, requireName } from './validation.js';

export const attachmentTypes = Object.freeze(['image/png', 'image/jpeg', 'text/plain']);
export const attachmentFailureCodes = Object.freeze(['ATTACHMENT_REFERENCE_INVALID', 'ATTACHMENT_TYPE_DENIED',
  'ATTACHMENT_COUNT_LIMIT', 'ATTACHMENT_SIZE_LIMIT', 'ATTACHMENT_CAPACITY_LIMIT', 'ATTACHMENT_ATTEMPT_LIMIT',
  'ATTACHMENT_SOURCE_UNAVAILABLE', 'ATTACHMENT_RESPONSE_INVALID', 'ATTACHMENT_CONTENT_INVALID',
  'ATTACHMENT_NETWORK_UNAVAILABLE', 'ATTACHMENT_RATE_LIMITED', 'ATTACHMENT_RATE_LIMIT_INVALID', 'ATTACHMENT_STORAGE_UNAVAILABLE', 'ATTACHMENT_POLICY_DISABLED']);

/** Explicit bounded configuration; no implicit production approval, scanner or retention expiry. */
export function validateAttachmentPolicy(value) {
  requireKeys(value, ['approvalRef', 'maxFileBytes', 'maxPerMessage', 'maxStoredBytes', 'timeoutMs', 'allowedTypes', 'retention', 'quarantine']);
  requireName(value.approvalRef); requireInteger(value.maxFileBytes, 1, 33554432);
  requireInteger(value.maxPerMessage, 1, 20); requireInteger(value.maxStoredBytes, value.maxFileBytes, 1099511627776);
  requireInteger(value.timeoutMs, 1000, 30000);
  requireCondition(Array.isArray(value.allowedTypes) && value.allowedTypes.length > 0 && value.allowedTypes.length <= 3 &&
    new Set(value.allowedTypes).size === value.allowedTypes.length && value.allowedTypes.every(type => attachmentTypes.includes(type)), 'ATTACHMENT_POLICY_INVALID');
  requireCondition(value.retention === 'indefinite' && value.quarantine === 'unscanned', 'ATTACHMENT_POLICY_INVALID');
}
export function requireAttachmentToken(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{48}$/.test(value), 'ATTACHMENT_TOKEN_INVALID');
}
/** Exact Discord attachment identity. Never accept proxy/embedded URLs, redirects or a general URL fetch. */
export function attachmentUrl(value, channelId, attachmentId) {
  requireId(channelId); requireId(attachmentId);
  requireCondition(typeof value === 'string' && value.length <= 4096 && !/[\s\\\x00-\x1f]/.test(value), 'ATTACHMENT_REFERENCE_INVALID');
  const match = /^https:\/\/cdn\.discordapp\.com\/attachments\/([1-9][0-9]{0,19})\/([1-9][0-9]{0,19})\/([^/?#]+)(\?[^#]*)?$/.exec(value);
  requireCondition(match !== null && match[1] === channelId && match[2] === attachmentId, 'ATTACHMENT_REFERENCE_INVALID');
  let name;
  try { name = decodeURIComponent(match[3]); } catch { requireCondition(false, 'ATTACHMENT_REFERENCE_INVALID'); }
  requireCondition(name.length <= 1024 && !['.', '..'].includes(name) && !/[\/\\\x00-\x1f]/.test(name), 'ATTACHMENT_REFERENCE_INVALID');
  const url = new URL(value), entries = [...url.searchParams];
  requireCondition(entries.length === 0 || (entries.length === 3 && new Set(entries.map(([key]) => key)).size === 3 &&
    entries.every(([key, part]) => key === 'hm' ? /^[a-fA-F0-9]{64}$/.test(part) : ['ex', 'is'].includes(key) && /^[a-fA-F0-9]{1,16}$/.test(part))), 'ATTACHMENT_REFERENCE_INVALID');
  return url.href;
}
export function attachmentReference(record, policy) {
  validateAttachmentPolicy(policy);
  requireInteger(record.ordinal, 0, 99); requireCondition(record.ordinal < policy.maxPerMessage, 'ATTACHMENT_COUNT_LIMIT');
  const item = record.attachment;
  requireCondition(item && typeof item === 'object', 'ATTACHMENT_REFERENCE_INVALID'); requireId(item.id);
  requireCondition(Number.isSafeInteger(item.size) && item.size > 0 && item.size <= policy.maxFileBytes, 'ATTACHMENT_SIZE_LIMIT');
  requireCondition(typeof item.filename === 'string' && item.filename.length <= 256 && !/[\/\\:\x00-\x1f]/.test(item.filename), 'ATTACHMENT_REFERENCE_INVALID');
  const extensions = { 'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'text/plain': /\.(txt|log)$/i };
  const type = item.content_type;
  requireCondition(policy.allowedTypes.includes(type) && extensions[type].test(item.filename) && item.ephemeral !== true, 'ATTACHMENT_TYPE_DENIED');
  return { url: attachmentUrl(item.url, record.channelId, item.id), channelId: record.channelId, attachmentId: item.id, size: item.size, type };
}
