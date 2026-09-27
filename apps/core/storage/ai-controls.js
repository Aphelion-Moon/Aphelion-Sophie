import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalAiConfiguration } from '../../../modules/assistant/participation.js';
import { canonicalPersonality } from '../../../modules/assistant/personality.js';
import { inTransaction } from './transaction.js';

// PostgreSQL jsonb reorders object keys. Hash canonical data, including nested profiles.
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const aiDigest = value => createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
const hash = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'AI_HASH_INVALID');
const revision = value => requireInteger(value, 0, 2147483646);
const capability = kind => kind === 'configuration' ? 'ai.control' : 'ai.personality.publish';
function publication(kind, document) {
  requireCondition(['configuration', 'personality'].includes(kind), 'AI_PUBLICATION_INVALID');
  return kind === 'configuration' ? canonicalAiConfiguration(document) : canonicalPersonality(document);
}

/** Authenticated controls own desired state. Activation requires separate installation evidence. */
export function createAiControls({ pool, guildId, authorize, inspectChannel, memberPresence, noticeRevision = 1 }) {
  requireId(guildId); requireInteger(noticeRevision, 1);
  for (const fn of [authorize, inspectChannel, memberPresence]) requireCondition(typeof fn === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function access(actor, action, scope = {}) {
    requireCondition(await authorize(action, actor, { guildId, ...scope }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  }
  async function transaction(actor, action, work, scope = {}) {
    await access(actor, action, scope);
    return inTransaction(pool, async client => {
      // One short AI control lock; never acquires the administration maintenance barrier.
      await client.query('SELECT pg_advisory_xact_lock(182745,56)');
      await client.query('INSERT INTO sophie_ai.state(guild_id) VALUES($1) ON CONFLICT DO NOTHING', [guildId]);
      const state = (await client.query('SELECT * FROM sophie_ai.state WHERE guild_id=$1 FOR UPDATE', [guildId])).rows[0];
      const result = await work(client, state); await access(actor, action, scope); return result;
    });
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
  return Object.freeze({
    async current({ actor, kind }) {
      publication(kind, kind === 'configuration' ? { schemaVersion: 1, enabled: false, deadlineMs: 15000, channels: [], emojis: [] } : { core: 'Sophie', examples: [] });
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
        else await client.query('UPDATE sophie_ai.state SET personality_revision=$2,epoch=epoch+1 WHERE guild_id=$1', [guildId, next]);
        return { revision: next, duplicate: false, activation: 'qualification-required' };
      });
    },
    disable: ({ actor }) => transaction(actor, 'ai.control', async (client, state) => {
      if (!state.disabled) await client.query('UPDATE sophie_ai.state SET disabled=true,epoch=epoch+1 WHERE guild_id=$1', [guildId]);
      return { disabled: true, epoch: Number(state.epoch) + (state.disabled ? 0 : 1) };
    }),
    async consent({ actor, channelId, enabled, expectedEpoch, acceptedNoticeRevision }) {
      requireId(channelId); requireInteger(expectedEpoch); requireInteger(acceptedNoticeRevision, 1);
      requireCondition(typeof enabled === 'boolean' && (!enabled || acceptedNoticeRevision === noticeRevision), 'AI_NOTICE_STALE');
      return transaction(actor, 'ai.self', async client => {
        const prior = (await client.query('SELECT * FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id=$2 AND user_id=$3 FOR UPDATE', [guildId, channelId, actor.userId])).rows[0];
        requireCondition(Number(prior?.epoch ?? 0) === expectedEpoch, 'AI_CONSENT_STALE');
        // Opt-out does not depend on continuing channel visibility or a working inference service.
        if (enabled) {
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
      }, { userId: actor.userId });
    },
    ownConsents: ({ actor }) => transaction(actor, 'ai.self', async client => ({ noticeRevision,
      channels: (await client.query('SELECT channel_id AS "channelId",epoch,enabled,notice_revision AS "noticeRevision" FROM sophie_ai.consents WHERE guild_id=$1 AND user_id=$2 ORDER BY channel_id LIMIT 101', [guildId, actor.userId])).rows.map(row => ({ ...row, epoch: Number(row.epoch) }))
    }), { userId: actor.userId }),
  });
}
