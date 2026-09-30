import { requireCondition, requireInteger, requireKeys } from '../../contracts/validation.js';

/** Written only into protected installation configuration after the operator reviews the evidence. */
export function canonicalProcessingPolicy(value) {
  requireKeys(value, ['schemaVersion', 'provider', 'domain', 'approved', 'evidenceHash', 'validUntil', 'noticeRevision', 'noticeText'], 'AI_PROCESSING_POLICY_INVALID');
  requireCondition(value.schemaVersion === 1 && value.provider === 'deepseek' && value.domain === 'public' && typeof value.approved === 'boolean', 'AI_PROCESSING_POLICY_INVALID');
  requireCondition(typeof value.evidenceHash === 'string' && /^[a-f0-9]{64}$/u.test(value.evidenceHash) && value.evidenceHash !== '0'.repeat(64), 'AI_PROCESSING_POLICY_INVALID');
  requireInteger(value.validUntil, 1); requireInteger(value.noticeRevision, 2, 2147483646);
  requireCondition(typeof value.noticeText === 'string' && value.noticeText.trim().length > 0 && value.noticeText.length <= 8000, 'AI_PROCESSING_POLICY_INVALID');
  return Object.freeze({ ...value });
}

export function createProcessingApproval({ policy = null, qualified, clock = Date.now }) {
  const fixed = policy === null ? null : canonicalProcessingPolicy(policy);
  requireCondition(typeof qualified === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  // Qualification may wait on storage. Do not admit processing after the evidence expires during it.
  const current = async () => fixed?.approved === true && clock() < fixed.validUntil &&
    await qualified() === true && clock() < fixed.validUntil;
  return Object.freeze({ current,
    async notice() { return { revision: fixed?.noticeRevision ?? 2, text: fixed?.noticeText ?? 'AI message processing is awaiting operator review.', approved: await current() }; },
    async evidence() { return await current() ? { evidenceHash: fixed.evidenceHash, noticeRevision: fixed.noticeRevision, validUntil: fixed.validUntil } : null; },
  });
}
