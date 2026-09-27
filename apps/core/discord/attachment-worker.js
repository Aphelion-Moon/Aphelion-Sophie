import { attachmentFailureCodes } from '../../../contracts/case-attachment.js';
import { requireCondition } from '../../../contracts/validation.js';

/** Narrow acquisition worker. Retained files remain unscanned, quarantined and private. */
export function createAttachmentWorker({ store, source, vault }) {
  let busy = false, suspended = false;
  return Object.freeze({
    async runOnce(owner) {
      if (busy) return { status: 'busy' };
      if (suspended) return { status: 'unavailable', code: 'ATTACHMENT_STORAGE_UNAVAILABLE' };
      busy = true; let claim;
      try {
        if (!await store.canRun()) return { status: 'disabled' };
        claim = await store.claim(owner); if (!claim) return { status: 'idle' };
        const prepared = await store.prepare(claim);
        let proof = null;
        for (const attempt of prepared.attempts) {
          requireCondition(attempt.source_hash === prepared.sourceHash && Number(attempt.bytes) === prepared.reference.size &&
            attempt.media_type === prepared.reference.type, 'ATTACHMENT_REFERENCE_INVALID');
          proof = await vault.recover(attempt.slot, prepared.reference); if (proof) break;
        }
        if (!proof) {
          const slot = await store.reserve(claim, prepared);
          await store.check(claim, prepared.policyHash);
          proof = await source.acquire(prepared.reference, prepared.policy.timeoutMs, chunks => vault.write(slot, prepared.reference, chunks));
        }
        await store.complete(claim, prepared, proof);
        return { status: 'retained' };
      } catch (error) {
        if (error.code === 'ATTACHMENT_RATE_LIMIT_INVALID') {
          try { await store.pause(); }
          catch { suspended = true; return { status: 'uncertain' }; }
        }
        if (error.code === 'ATTACHMENT_RATE_LIMITED' && error.retryAfterMs !== undefined) {
          try { await store.defer(error.retryAfterMs); }
          catch { suspended = true; return { status: 'uncertain' }; }
        }
        if (!claim) return { status: 'unavailable' };
        // A lost COMMIT acknowledgement must not trigger another file write or erase the success.
        try { if (await store.result(claim.token) === 'retained') return { status: 'retained' }; } catch { /* Durable outcome remains uncertain. */ }
        const code = attachmentFailureCodes.includes(error.code) ? error.code : 'ATTACHMENT_STORAGE_UNAVAILABLE';
        try { return { status: await store.failed(claim, code), code }; }
        catch { return { status: 'uncertain' }; }
      } finally { busy = false; }
    },
  });
}
