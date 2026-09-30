import { requireCondition, requireInteger, requireKeys } from '../../contracts/validation.js';

const evidenceKeys = ['processorAgreement', 'discordServiceProviderTerms', 'retentionAndDeletion', 'internationalTransfers'];

/** Written only into protected installation configuration after the operator reviews the evidence. */
export function canonicalProcessingPolicy(value) {
  requireKeys(value, ['schemaVersion', 'provider', 'domain', 'approved', 'evidenceHash', 'validUntil', 'noticeRevision', 'noticeText', ...(value?.schemaVersion === 2 ? ['review'] : [])], 'AI_PROCESSING_POLICY_INVALID');
  requireCondition([1, 2].includes(value.schemaVersion) && value.provider === 'deepseek' && value.domain === 'public' && typeof value.approved === 'boolean', 'AI_PROCESSING_POLICY_INVALID');
  requireCondition(typeof value.evidenceHash === 'string' && /^[a-f0-9]{64}$/u.test(value.evidenceHash) && value.evidenceHash !== '0'.repeat(64), 'AI_PROCESSING_POLICY_INVALID');
  requireInteger(value.validUntil, 1); requireInteger(value.noticeRevision, 2, 2147483646);
  requireCondition(typeof value.noticeText === 'string' && value.noticeText.trim().length > 0 && value.noticeText.length <= 8000, 'AI_PROCESSING_POLICY_INVALID');
  if (value.schemaVersion === 1) return Object.freeze({ ...value });
  requireKeys(value.review, ['status', ...evidenceKeys], 'AI_PROCESSING_POLICY_INVALID');
  requireCondition(['draft', 'accepted'].includes(value.review.status), 'AI_PROCESSING_POLICY_INVALID');
  for (const key of evidenceKeys) requireCondition(typeof value.review[key] === 'string' && /^[a-f0-9]{64}$/u.test(value.review[key]) && value.review[key] !== '0'.repeat(64), 'AI_PROCESSING_POLICY_INVALID');
  // These are operator-recorded receipts for reviewed evidence, never signatures or legal conclusions.
  return Object.freeze({ ...value, review: Object.freeze({ ...value.review }) });
}

export function createProcessingApproval({ policy = null, qualified, digest, clock = Date.now }) {
  const fixed = policy === null ? null : canonicalProcessingPolicy(policy);
  requireCondition(typeof qualified === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(fixed?.schemaVersion !== 2 || typeof digest === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  // Qualification may wait on storage. Do not admit processing after the evidence expires during it.
  const current = async () => fixed?.schemaVersion === 2 && fixed.review.status === 'accepted' && fixed.approved === true && clock() < fixed.validUntil &&
    await qualified() === true && clock() < fixed.validUntil;
  const binding = fixed?.schemaVersion === 2 ? digest(JSON.stringify([fixed.noticeRevision, fixed.noticeText, fixed.evidenceHash, ...evidenceKeys.map(key => fixed.review[key])])) : null;
  return Object.freeze({ current,
    async notice() { return { revision: fixed?.noticeRevision ?? 2, text: fixed?.noticeText ?? 'AI message processing is awaiting operator review.', binding, approved: await current() }; },
    async evidence() { return await current() ? { evidenceHash: binding, noticeRevision: fixed.noticeRevision, validUntil: fixed.validUntil } : null; },
  });
}
