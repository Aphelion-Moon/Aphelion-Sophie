import { requireCondition, requireId } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalAiConfiguration } from '../../../modules/assistant/participation.js';
import { canonicalPersonality } from '../../../modules/assistant/personality.js';
import { canonicalAiBudget } from '../../../modules/assistant/budget.js';
import { canonicalAiWorkerRelease } from '../../../modules/assistant/worker-release.js';
import { aiDigest } from './ai-controls.js';
import { inTransaction } from './transaction.js';

/** The maintenance identity owns qualification writes. Browser input only selects a reviewed channel. */
export function createAiActivation({ pool, guildId, authorize, inspectChannel, approval, workerRelease, restoreCurrent, clock = Date.now, invalidate = () => {} }) {
  requireId(guildId);
  const access = async actor => {
    requireCondition(operatorGrant(actor).guildId === guildId && await authorize('ai.runtime.apply', actor, { guildId }) === true, 'OPERATION_DENIED');
  };
  async function transaction(actor, work) {
    await access(actor);
    return inTransaction(pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(182745,56)');
      const result = await work(client); await access(actor); return result;
    });
  }
  async function candidate(client, actor, channelId) {
    const evidence = await approval.evidence();
    requireCondition(evidence && await restoreCurrent() === true, 'AI_PROCESSING_UNAPPROVED');
    const release = await workerRelease(); requireCondition(release !== null, 'AI_WORKER_NOT_READY');
    canonicalAiWorkerRelease(release);
    const state = (await client.query('SELECT * FROM sophie_ai.state WHERE guild_id=$1 FOR UPDATE', [guildId])).rows[0];
    requireCondition(state, 'AI_PUBLICATION_REQUIRED');
    const rows = (await client.query(`SELECT kind,document,sha256 FROM sophie_ai.publications WHERE guild_id=$1 AND
      ((kind='configuration' AND revision=$2) OR (kind='personality' AND revision=$3))`, [guildId, state.configuration_revision, state.personality_revision])).rows;
    const configuration = rows.find(row => row.kind === 'configuration'), personality = rows.find(row => row.kind === 'personality');
    requireCondition(configuration && personality, 'AI_PUBLICATION_REQUIRED');
    const config = canonicalAiConfiguration(configuration.document), character = canonicalPersonality(personality.document);
    requireCondition(aiDigest(config) === configuration.sha256 && aiDigest(character) === personality.sha256, 'AI_PUBLICATION_CORRUPT');
    requireCondition(config.enabled && config.channels.some(row => row.channelId === channelId && row.profile.mode !== 'ignore'), 'AI_CHANNEL_UNAVAILABLE');
    const policy = (await client.query('SELECT * FROM sophie_ai.budget_policies WHERE guild_id=$1', [guildId])).rows[0];
    requireCondition(policy && !policy.held, 'AI_BUDGET_UNAVAILABLE');
    const budget = canonicalAiBudget(policy.document);
    requireCondition(budget.priceValidUntil > clock() && BigInt(budget.monthlyLimitNanos) <= 20000000000n, 'AI_PRICE_STALE');
    const observed = await inspectChannel({ guildId, channelId, userId: actor.userId });
    requireCondition(observed?.eligible && observed.restricted === false && clock() >= observed.checkedAt && clock() - observed.checkedAt < 5000, 'AI_PUBLIC_CHANNEL_REQUIRED');
    return { channelId, epoch: Number(state.epoch), configurationHash: configuration.sha256, personalityHash: personality.sha256,
      budgetHash: aiDigest(budget), budgetRevision: policy.revision, approval: evidence, release,
      audienceHash: observed.audienceHash, continuity: observed.continuity };
  }
  return Object.freeze({
    async reviewActivation({ actor, channelId }) {
      requireId(channelId);
      return transaction(actor, async client => { const request = await candidate(client, actor, channelId); return { ...request, reviewSha256: aiDigest(request) }; });
    },
    async activate({ actor, channelId, reviewSha256, requestId, confirmed }) {
      requireId(channelId); requireCondition(confirmed === true, 'AI_CONFIRMATION_REQUIRED');
      requireCondition([reviewSha256, requestId].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)), 'AI_HASH_INVALID');
      const result = await transaction(actor, async client => {
        const prior = (await client.query('SELECT * FROM sophie_ai.activation_receipts WHERE guild_id=$1 AND request_id=$2', [guildId, requestId])).rows[0];
        if (prior) {
          requireCondition(prior.actor_id === actor.userId && prior.channel_id === channelId && prior.review_sha256 === reviewSha256, 'AI_REQUEST_COLLISION');
          return { duplicate: true, channelId, boundaryEpoch: Number(prior.boundary_epoch) };
        }
        const request = await candidate(client, actor, channelId);
        requireCondition(aiDigest(request) === reviewSha256, 'AI_ACTIVATION_STALE');
        const previous = (await client.query('SELECT boundary_epoch FROM sophie_ai.qualifications WHERE guild_id=$1 AND channel_id=$2 FOR UPDATE', [guildId, channelId])).rows[0];
        const epoch = Number(previous?.boundary_epoch ?? 0) + 1;
        requireCondition(Number.isSafeInteger(epoch), 'AI_ACTIVATION_STALE');
        await client.query(`INSERT INTO sophie_ai.qualifications(guild_id,channel_id,boundary_epoch,audience_sha256,worker_domain,release_sha256,
          evidence_sha256,configuration_sha256,personality_sha256,restricted,active,restore_ready)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,false,true,true) ON CONFLICT(guild_id,channel_id) DO UPDATE SET
          boundary_epoch=EXCLUDED.boundary_epoch,audience_sha256=EXCLUDED.audience_sha256,worker_domain=EXCLUDED.worker_domain,
          release_sha256=EXCLUDED.release_sha256,evidence_sha256=EXCLUDED.evidence_sha256,configuration_sha256=EXCLUDED.configuration_sha256,
          personality_sha256=EXCLUDED.personality_sha256,restricted=false,active=true,restore_ready=true`,
        [guildId, channelId, epoch, request.audienceHash, request.release.domain, request.release.releaseHash, request.release.evidenceHash, request.configurationHash, request.personalityHash]);
        requireCondition(aiDigest(await candidate(client, actor, channelId)) === reviewSha256, 'AI_ACTIVATION_STALE');
        await client.query('UPDATE sophie_ai.state SET disabled=false,epoch=epoch+1 WHERE guild_id=$1', [guildId]);
        await client.query('INSERT INTO sophie_ai.activation_receipts(guild_id,request_id,actor_id,channel_id,review_sha256,boundary_epoch) VALUES($1,$2,$3,$4,$5,$6)',
          [guildId, requestId, actor.userId, channelId, reviewSha256, epoch]);
        return { duplicate: false, channelId, boundaryEpoch: epoch };
      });
      invalidate(); return result;
    },
  });
}
