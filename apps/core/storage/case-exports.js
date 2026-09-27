import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { requireExportHash, transcriptExportDocument, validateTranscriptExportPolicy } from '../../../modules/tickets/transcript-export.js';
import { inTransaction } from './transaction.js';

const hash = value => createHash('sha256').update(value).digest('hex');

/** Rebuilds exact reviewed bytes under current authorization. Audit metadata never claims client receipt. */
export function createCaseExports({ pool, transcripts, readPolicy }) {
  requireCondition(typeof readPolicy === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function prepare(request) {
    const policy = structuredClone(await readPolicy()); validateTranscriptExportPolicy(policy);
    requireCondition(policy.enabled, 'CASE_EXPORT_DISABLED');
    const snapshot = await transcripts.prepareExport(request, policy);
    const body = transcriptExportDocument(snapshot.html), bytes = Buffer.byteLength(body);
    requireCondition(bytes <= policy.maxBytes, 'CASE_EXPORT_TOO_LARGE');
    const contentHash = hash(body), policyHash = hash(JSON.stringify(policy));
    const reviewHash = hash(JSON.stringify([contentHash, policyHash, snapshot.authorityHash]));
    requireCondition(hash(JSON.stringify(await readPolicy())) === policyHash, 'CASE_EXPORT_POLICY_CHANGED');
    return { policy, policyHash, snapshot, body, bytes, contentHash, reviewHash };
  }
  function review(result) {
    return { caseToken: result.snapshot.caseToken, channelId: result.snapshot.channelId, reviewHash: result.reviewHash,
      policyVersion: result.policy.version, sha256: result.contentHash, bytes: result.bytes,
      observations: result.snapshot.observations, gaps: result.snapshot.gaps, completeHistory: false,
      includes: 'Selected channel observations and gaps; attachment status only.',
      excludes: 'Other channels, Staff notes, form answers and file bytes.' };
  }
  return Object.freeze({
    async review(request) { return review(await prepare(request)); },
    async confirm({ actor, caseToken, channelId, requestId, reviewHash, confirmed }) {
      requireExportHash(requestId); requireExportHash(reviewHash);
      requireCondition(confirmed === true, 'CASE_EXPORT_CONFIRMATION_REQUIRED');
      const request = { actor, caseToken, channelId }, result = await prepare(request);
      requireCondition(result.reviewHash === reviewHash, 'CASE_EXPORT_REVIEW_STALE');
      // This table records an authorized generation attempt, not a successful download.
      // No Discord request occurs while holding its transaction/unique-key lock.
      await inTransaction(pool, async client => {
        const policy = await client.query(`INSERT INTO sophie_core.case_export_policies (guild_id, version, sha256)
          VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING sha256`, [actor.guildId, result.policy.version, result.policyHash]);
        const saved = policy.rows[0] ?? (await client.query('SELECT sha256 FROM sophie_core.case_export_policies WHERE guild_id = $1 AND version = $2',
          [actor.guildId, result.policy.version])).rows[0];
        requireCondition(saved?.sha256 === result.policyHash, 'CASE_EXPORT_POLICY_CHANGED');
        await client.query(`INSERT INTO sophie_core.case_export_attempts
          (guild_id, request_id, actor_id, case_id, channel_id, review_hash, content_hash, policy_version, bytes, observation_count, gap_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [actor.guildId, requestId, actor.userId, result.snapshot.caseId, result.snapshot.channelId, reviewHash, result.contentHash,
          result.policy.version, result.bytes, result.snapshot.observations, result.snapshot.gaps]);
        const savedAttempt = (await client.query('SELECT actor_id, review_hash FROM sophie_core.case_export_attempts WHERE guild_id = $1 AND request_id = $2',
          [actor.guildId, requestId])).rows[0];
        requireCondition(savedAttempt?.actor_id === actor.userId && savedAttempt.review_hash === reviewHash, 'CASE_EXPORT_REQUEST_COLLISION');
      });
      // Re-read and reauthorize after the audit commit too; logout/revocation or changed bytes suppress delivery.
      const final = await prepare(request);
      requireCondition(final.reviewHash === reviewHash, 'CASE_EXPORT_REVIEW_STALE');
      return { ...review(final), requestId, filename: `sophie-transcript-${caseToken}-${final.snapshot.channelId}.html`, body: final.body };
    },
  });
}
