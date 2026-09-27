import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalAiConfiguration } from '../../../modules/assistant/participation.js';
import { canonicalPersonality } from '../../../modules/assistant/personality.js';
import { inTransaction } from './transaction.js';
import { canonicalAiBudget, DEFAULT_AI_BUDGET } from '../../../modules/assistant/budget.js';
import { createAiAccounting } from './ai-accounting.js';

// PostgreSQL jsonb reorders object keys. Hash canonical data, including nested profiles.
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const aiDigest = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const hash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'AI_HASH_INVALID');
const revision = value => requireInteger(value, 0, 2147483646);
const capability = kind => kind === 'personality' ? 'ai.personality.publish' : 'ai.control';
function publication(kind, document) {
  requireCondition(['configuration', 'personality', 'budget'].includes(kind), 'AI_PUBLICATION_INVALID');
  return kind === 'configuration' ? canonicalAiConfiguration(document) : kind === 'budget' ? canonicalAiBudget(document) : canonicalPersonality(document);
}

/** Authenticated controls own desired state. Activation requires separate installation evidence. */
export function createAiControls({ pool, guildId, authorize, inspectChannel, memberPresence, invalidate = () => {}, noticeRevision = 2,
  noticeApproved = async () => false }) {
  requireId(guildId); requireInteger(noticeRevision, 1);
  for (const fn of [authorize, inspectChannel, memberPresence, noticeApproved]) requireCondition(typeof fn === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function access(actor, action, scope = {}) {
    requireCondition(await authorize(action, actor, { guildId, ...scope }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  }
  async function transaction(actor, action, work, scope = {}, changes = false) {
    await access(actor, action, scope);
    return inTransaction(pool, async client => {
      // One short AI control lock; never acquires the administration maintenance barrier.
      await client.query('SELECT pg_advisory_xact_lock(182745,56)');
      await client.query('INSERT INTO sophie_ai.state(guild_id) VALUES($1) ON CONFLICT DO NOTHING', [guildId]);
      const state = (await client.query('SELECT * FROM sophie_ai.state WHERE guild_id=$1 FOR UPDATE', [guildId])).rows[0];
      const result = await work(client, state); await access(actor, action, scope); return result;
    }).finally(() => { if (changes) invalidate(); });
  }
  async function current(client, kind) {
    const row = (await client.query('SELECT * FROM sophie_ai.publications WHERE guild_id=$1 AND kind=$2 ORDER BY revision DESC LIMIT 1', [guildId, kind])).rows[0];
    if (!row) return null;
    const document = publication(kind, row.document); requireCondition(aiDigest(document) === row.sha256, 'AI_PUBLICATION_CORRUPT');
    return { revision: row.revision, document, sha256: row.sha256 };
  }
  async function validateChannels(client, document) {
    for (const { channelId, profile } of document.channels) {
      if (profile.mode !== 'ignore') requireCondition(await inspectChannel(client, channelId) !== null, 'AI_CHANNEL_UNAVAILABLE');
    }
  }
  function input(fields) {
    requireKeys(fields, ['kind', 'expectedRevision', 'document'], 'AI_INPUT_INVALID');
    const { kind, expectedRevision, document } = fields;
    revision(expectedRevision); const canonical = publication(kind, document);
    return { kind, expectedRevision, document: canonical };
  }
  async function spendingHold(client, state, expectedRevision, evidenceHash) {
    revision(expectedRevision); hash(evidenceHash);
    const policy = (await client.query('SELECT * FROM sophie_ai.budget_policies WHERE guild_id=$1', [guildId])).rows[0];
    requireCondition(policy?.held && policy.revision === expectedRevision, 'AI_SPENDING_STALE');
    const at = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
    requireCondition(canonicalAiBudget(policy.document).priceValidUntil > at, 'AI_PRICE_STALE');
    const pending = await client.query("SELECT 1 FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND state IN ('reserved','dispatch_started','uncertain') LIMIT 1", [guildId]);
    requireCondition(pending.rowCount === 0, 'AI_ACCOUNTING_UNRESOLVED');
    return { expectedRevision, evidenceHash, controlEpoch: Number(state.epoch) };
  }
  return Object.freeze({
    async current({ actor, kind }) {
      publication(kind, kind === 'configuration' ? { schemaVersion: 1, enabled: false, deadlineMs: 15000, channels: [], emojis: [] } :
        kind === 'budget' ? DEFAULT_AI_BUDGET : { core: 'Sophie', examples: [] });
      return transaction(actor, capability(kind), async (client, state) => ({ publication: await current(client, kind),
        disabled: state.disabled, epoch: Number(state.epoch), activation: 'qualification-required' }));
    },
    async review({ actor, ...fields }) {
      const request = input(fields);
      return transaction(actor, capability(request.kind), async client => {
        const previous = await current(client, request.kind);
        requireCondition((previous?.revision ?? 0) === request.expectedRevision, 'AI_PUBLICATION_STALE');
        if (request.kind === 'configuration') await validateChannels(client, request.document);
        return { ...request, previous, reviewSha256: aiDigest(request), activation: 'qualification-required' };
      });
    },
    async publish({ actor, requestId, reviewSha256, confirmed, ...fields }) {
      hash(requestId); hash(reviewSha256); requireCondition(confirmed === true, 'AI_CONFIRMATION_REQUIRED');
      const request = input(fields); requireCondition(aiDigest(request) === reviewSha256, 'AI_REVIEW_STALE');
      return transaction(actor, capability(request.kind), async client => {
        const prior = (await client.query('SELECT * FROM sophie_ai.publications WHERE guild_id=$1 AND request_id=$2', [guildId, requestId])).rows[0];
        if (prior) { requireCondition(prior.actor_id === actor.userId && prior.request_sha256 === reviewSha256, 'AI_REQUEST_COLLISION');
          return { revision: prior.revision, duplicate: true, activation: 'qualification-required' }; }
        const previous = await current(client, request.kind);
        requireCondition((previous?.revision ?? 0) === request.expectedRevision, 'AI_PUBLICATION_STALE');
        if (request.kind === 'configuration') await validateChannels(client, request.document);
        const next = request.expectedRevision + 1; revision(next);
        await client.query(`INSERT INTO sophie_ai.publications(guild_id,kind,revision,document,sha256,actor_id,request_id,request_sha256)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [guildId, request.kind, next, request.document, aiDigest(request.document), actor.userId, requestId, reviewSha256]);
        if (request.kind === 'configuration') await client.query(`UPDATE sophie_ai.state SET configuration_revision=$2,epoch=epoch+1,
          disabled=CASE WHEN $3 THEN disabled ELSE true END WHERE guild_id=$1`, [guildId, next, request.document.enabled]);
        else if (request.kind === 'personality') await client.query('UPDATE sophie_ai.state SET personality_revision=$2,epoch=epoch+1 WHERE guild_id=$1', [guildId, next]);
        else {
          await client.query(`INSERT INTO sophie_ai.budget_policies(guild_id,revision,document,actor_id) VALUES($1,$2,$3,$4)
            ON CONFLICT(guild_id) DO UPDATE SET revision=$2,document=$3,actor_id=$4,updated_at=clock_timestamp()`, [guildId, next, request.document, actor.userId]);
          await client.query('UPDATE sophie_ai.state SET epoch=epoch+1 WHERE guild_id=$1', [guildId]);
        }
        return { revision: next, duplicate: false, activation: 'qualification-required' };
      }, {}, true);
    },
    disable: ({ actor }) => transaction(actor, 'ai.control', async (client, state) => {
      if (!state.disabled) await client.query('UPDATE sophie_ai.state SET disabled=true,epoch=epoch+1 WHERE guild_id=$1', [guildId]);
      return { disabled: true, epoch: Number(state.epoch) + (state.disabled ? 0 : 1) };
    }, {}, true),
    async budgetStatus({ actor }) {
      await access(actor, 'ai.control');
      const result = await createAiAccounting({ pool, guildId }).status();
      await access(actor, 'ai.control'); return result;
    },
    reviewSpendingHold: ({ actor, expectedRevision, evidenceHash }) => transaction(actor, 'ai.control', async (client, state) => {
      const candidate = await spendingHold(client, state, expectedRevision, evidenceHash);
      return { ...candidate, reviewSha256: aiDigest(candidate) };
    }),
    async clearSpendingHold({ actor, expectedRevision, evidenceHash, reviewSha256, requestId, confirmed }) {
      hash(reviewSha256); hash(requestId); requireCondition(confirmed === true, 'AI_CONFIRMATION_REQUIRED');
      return transaction(actor, 'ai.control', async (client, state) => {
        const prior = (await client.query('SELECT * FROM sophie_ai.budget_hold_receipts WHERE guild_id=$1 AND request_id=$2', [guildId, requestId])).rows[0];
        if (prior) {
          requireCondition(prior.actor_id === actor.userId && prior.review_sha256 === reviewSha256 && prior.policy_revision === expectedRevision && prior.evidence_sha256 === evidenceHash, 'AI_REQUEST_COLLISION');
          return { cleared: true, duplicate: true };
        }
        const candidate = await spendingHold(client, state, expectedRevision, evidenceHash);
        requireCondition(aiDigest(candidate) === reviewSha256, 'AI_REVIEW_STALE');
        await client.query('INSERT INTO sophie_ai.budget_hold_receipts(guild_id,request_id,actor_id,review_sha256,evidence_sha256,policy_revision) VALUES($1,$2,$3,$4,$5,$6)',
          [guildId, requestId, actor.userId, reviewSha256, evidenceHash, expectedRevision]);
        await client.query('UPDATE sophie_ai.budget_policies SET held=false,updated_at=clock_timestamp() WHERE guild_id=$1', [guildId]);
        await client.query('UPDATE sophie_ai.state SET epoch=epoch+1 WHERE guild_id=$1', [guildId]);
        return { cleared: true, duplicate: false };
      }, {}, true);
    },
    async resolveSpending({ actor, messageId, fence, requestId, confirmed }) {
      requireId(messageId); hash(requestId); requireCondition(confirmed === true, 'AI_CONFIRMATION_REQUIRED');
      requireCondition(typeof fence === 'string' && /^[a-f0-9-]{36}$/.test(fence), 'AI_FENCE_INVALID');
      return transaction(actor, 'ai.control', async client => {
        const row = (await client.query('SELECT * FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND message_id=$2 AND fence=$3 FOR UPDATE', [guildId,messageId,fence])).rows[0];
        requireCondition(row, 'AI_SPENDING_STALE');
        if (row.resolution_id === requestId && row.resolution_actor === actor.userId) return { resolved:true,duplicate:true };
        requireCondition(row.state === 'uncertain', 'AI_SPENDING_STALE');
        await client.query('UPDATE sophie_ai.budget_periods SET reserved_nanos=reserved_nanos-$3,settled_nanos=settled_nanos+$3 WHERE guild_id=$1 AND period=ANY($2)',
          [guildId,[row.month_period,row.day_period],row.reserved_nanos]);
        await client.query(`UPDATE sophie_ai.provider_attempts SET state='settled',settled_nanos=reserved_nanos,settlement_basis='conservative-reservation',
          resolution_actor=$3,resolution_id=$4,updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2`,[guildId,messageId,actor.userId,requestId]);
        return { resolved:true,duplicate:false };
      });
    },
    async consent({ actor, channelId, enabled, expectedEpoch, acceptedNoticeRevision }) {
      requireId(channelId); requireInteger(expectedEpoch); requireInteger(acceptedNoticeRevision, 1);
      requireCondition(typeof enabled === 'boolean' && (!enabled || acceptedNoticeRevision === noticeRevision), 'AI_NOTICE_STALE');
      return transaction(actor, 'ai.self', async client => {
        const prior = (await client.query('SELECT * FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id=$2 AND user_id=$3 FOR UPDATE', [guildId, channelId, actor.userId])).rows[0];
        requireCondition(Number(prior?.epoch ?? 0) === expectedEpoch, 'AI_CONSENT_STALE');
        // Opt-out does not depend on continuing channel visibility or a working inference service.
        if (enabled) {
          requireCondition(await noticeApproved() === true, 'AI_NOTICE_UNAPPROVED');
          const configuration = await current(client, 'configuration');
          requireCondition(configuration?.document.channels.some(channel => channel.channelId === channelId && channel.profile.mode !== 'ignore') &&
            await inspectChannel(client, channelId) !== null, 'AI_CHANNEL_UNAVAILABLE');
        }
        const presence = await memberPresence(actor); requireInteger(presence);
        const epoch = expectedEpoch + 1; requireInteger(epoch);
        await client.query(`INSERT INTO sophie_ai.consents(guild_id,channel_id,user_id,epoch,enabled,presence_epoch,notice_revision)
          VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(guild_id,channel_id,user_id) DO UPDATE SET
          epoch=EXCLUDED.epoch,enabled=EXCLUDED.enabled,presence_epoch=EXCLUDED.presence_epoch,notice_revision=EXCLUDED.notice_revision,updated_at=clock_timestamp()`,
        [guildId, channelId, actor.userId, epoch, enabled, presence, acceptedNoticeRevision]);
        return { channelId, enabled, epoch, noticeRevision: acceptedNoticeRevision };
      }, { userId: actor.userId }, true);
    },
    ownConsents: ({ actor }) => transaction(actor, 'ai.self', async client => ({ noticeRevision, optInAvailable: await noticeApproved() === true,
      channels: (await client.query('SELECT channel_id AS "channelId",epoch,enabled,notice_revision AS "noticeRevision" FROM sophie_ai.consents WHERE guild_id=$1 AND user_id=$2 ORDER BY channel_id LIMIT 101', [guildId, actor.userId])).rows.map(row => ({ ...row, epoch: Number(row.epoch) }))
    }), { userId: actor.userId }),
  });
}
