import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { canonicalAiConfiguration, participationDecision, questionCandidate } from '../../../modules/assistant/participation.js';
import { canonicalPersonality } from '../../../modules/assistant/personality.js';
import { aiDigest } from './ai-controls.js';
import { inTransaction } from './transaction.js';

/** Atomic metadata receipts and pacing. Content stays in the returned transient handoff only. */
export function createAiAdmission({ pool, guildId, ingress, inspectContext, inspectMember, clock }) {
  requireCondition(ingress.guildId === guildId && [inspectContext, inspectMember, clock].every(fn => typeof fn === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  async function snapshot(client, event) {
    const state = (await client.query('SELECT * FROM sophie_ai.state WHERE guild_id=$1', [guildId])).rows[0];
    if (!state || state.disabled) return null;
    const rows = (await client.query(`SELECT kind,revision,document,sha256 FROM sophie_ai.publications WHERE guild_id=$1 AND
      ((kind='configuration' AND revision=$2) OR (kind='personality' AND revision=$3))`, [guildId, state.configuration_revision, state.personality_revision])).rows;
    const configuration = rows.find(row => row.kind === 'configuration'), personality = rows.find(row => row.kind === 'personality');
    if (!configuration || !personality) return null;
    const config = canonicalAiConfiguration(configuration.document), character = canonicalPersonality(personality.document);
    requireCondition(aiDigest(config) === configuration.sha256 && aiDigest(character) === personality.sha256, 'AI_PUBLICATION_CORRUPT');
    const channel = config.channels.find(row => row.channelId === event.channelId);
    if (!config.enabled || !channel || channel.profile.mode === 'ignore') return null;
    const qualification = (await client.query('SELECT * FROM sophie_ai.qualifications WHERE guild_id=$1 AND channel_id=$2', [guildId, event.channelId])).rows[0];
    if (!qualification?.active || !qualification.restore_ready || qualification.configuration_sha256 !== configuration.sha256 || qualification.personality_sha256 !== personality.sha256) return null;
    const consent = (await client.query('SELECT * FROM sophie_ai.consents WHERE guild_id=$1 AND channel_id=$2 AND user_id=$3', [guildId, event.channelId, event.userId])).rows[0];
    if (!consent?.enabled) return null;
    // These trusted core adapters read current exclusion/ACL/member metadata, never case content.
    const context = await inspectContext(event), member = await inspectMember(event);
    if (!context?.eligible || !member?.eligible || context.audienceHash !== qualification.audience_sha256 ||
      context.restricted !== qualification.restricted || typeof context.canReply !== 'boolean' || typeof context.canReact !== 'boolean' ||
      !Number.isSafeInteger(member.presenceEpoch) || !Number.isSafeInteger(member.accessEpoch) ||
      typeof context.continuity !== 'string' || context.continuity.length === 0 || typeof context.messageRevision !== 'string' ||
      member.presenceEpoch !== Number(consent.presence_epoch)) return null;
    const now = clock();
    if ([context, member].some(value => !Number.isSafeInteger(value.checkedAt) || value.checkedAt > now || now - value.checkedAt > 5000)) return null;
    return { config, character, profile: channel.profile, deadline: event.receivedAt + config.deadlineMs,
      capabilities: { reply: context.canReply, react: context.canReact },
      binding: { epoch: Number(state.epoch), configurationHash: configuration.sha256, personalityHash: personality.sha256,
        boundaryEpoch: Number(qualification.boundary_epoch), audienceHash: context.audienceHash, consentEpoch: Number(consent.epoch),
        presenceEpoch: member.presenceEpoch, accessEpoch: member.accessEpoch, continuity: context.continuity,
        inputRevision: aiDigest([event.messageId, context.messageRevision]), canReply: context.canReply, canReact: context.canReact,
        workerDomain: qualification.worker_domain, releaseHash: qualification.release_sha256, restricted: qualification.restricted } };
  }
  return Object.freeze({
    async admit(proof) {
      if (proof === null) return null;
      try {
        const event = ingress.inspect(proof);
        return await inTransaction(pool, async client => {
          await client.query('SELECT pg_advisory_xact_lock(182745,56)');
          const initial = await snapshot(client, event);
          if (!initial || clock() >= initial.deadline - 1000) return null;
          const duplicate = await client.query('SELECT 1 FROM sophie_ai.request_receipts WHERE guild_id=$1 AND message_id=$2', [guildId, event.messageId]);
          if (duplicate.rowCount) return null;
          const content = ingress.content(proof); if (content === null) return null;
          const decision = participationDecision(initial.profile, { addressed: content.addressed, question: questionCandidate(content.text), directedToOther: content.directedToOther, now: clock() });
          decision.outcomes = decision.outcomes.filter(kind => kind === 'silent' || initial.capabilities[kind]);
          const inputRevision = aiDigest([event.messageId, content.inputRevision]);
          if (inputRevision !== initial.binding.inputRevision) return null;
          if (!decision.infer) return decision.context ? { ...event, inputRevision, ...initial, decision, text: content.text } : null;
          const quota = (await client.query(`SELECT
            count(*) FILTER (WHERE channel_id=$2 AND proactive AND received_at > clock_timestamp()-interval '1 hour')::int AS hour,
            max(received_at) FILTER (WHERE channel_id=$2 AND proactive) AS channel_last,
            max(received_at) FILTER (WHERE user_id=$3) AS member_last,
            count(*) FILTER (WHERE user_id=$3 AND state IN ('admitted','sending') AND deadline>clock_timestamp())::int AS member_waiting,
            count(*) FILTER (WHERE state IN ('admitted','sending') AND deadline>clock_timestamp())::int AS waiting
            FROM sophie_ai.request_receipts WHERE guild_id=$1 AND received_at>clock_timestamp()-interval '1 hour'`, [guildId, event.channelId, event.userId])).rows[0];
          const now = clock(), profile = initial.profile;
          if (quota.waiting >= 4 || quota.member_waiting > 0 || quota.member_last && now - quota.member_last.getTime() < profile.memberIntervalMs) return null;
          if (decision.proactive && quota.channel_last && now - quota.channel_last.getTime() < profile.evaluationIntervalMs) return null;
          if (decision.proactive && quota.hour >= profile.proactiveRepliesPerHour) decision.outcomes = decision.outcomes.filter(value => value !== 'reply');
          const recent = (await client.query(`SELECT max(updated_at) FILTER (WHERE state='delivered') AS reply_last,
            max(updated_at) FILTER (WHERE state='reacted') AS reaction_last FROM sophie_ai.request_receipts WHERE guild_id=$1 AND channel_id=$2 AND deadline>clock_timestamp()-interval '1 hour'`, [guildId, event.channelId])).rows[0];
          if (decision.proactive && recent.reply_last && now - recent.reply_last.getTime() < profile.replyIntervalMs) decision.outcomes = decision.outcomes.filter(value => value !== 'reply');
          if (recent.reaction_last && now - recent.reaction_last.getTime() < profile.reactionIntervalMs || initial.config.emojis.length === 0) decision.outcomes = decision.outcomes.filter(value => value !== 'react');
          if (decision.outcomes.every(value => value === 'silent')) return null;
          const latest = await snapshot(client, event);
          if (!latest || aiDigest(latest.binding) !== aiDigest(initial.binding) || clock() >= initial.deadline - 1000) return null;
          // Hash only the platform revision marker, not guessable personal message text.
          await client.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline,proactive,received_at)
            VALUES($1,$2,$3,$4,$5,'admitted',$6,$7,$8)`, [guildId, event.messageId, event.channelId, event.userId, inputRevision, new Date(initial.deadline), decision.proactive, new Date(event.receivedAt)]);
          return { ...event, inputRevision, ...initial, decision, text: content.text };
        });
      } finally { ingress.discard(proof); }
    },
    async revalidate(request) {
      requireInteger(request.deadline);
      if (clock() >= request.deadline) return false;
      const current = await snapshot(pool, request);
      return current !== null && aiDigest(current.binding) === aiDigest(request.binding) && clock() < request.deadline;
    },
    async revalidateSource(source) {
      const current = await snapshot(pool, source);
      return current !== null && current.profile.mode !== 'ignore' && clock() < source.receivedAt + current.profile.contextTtlMs &&
        aiDigest(current.binding) === aiDigest(source.binding);
    },
    async beginDelivery(request) {
      return inTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745,56)');
        const current = await snapshot(client, request);
        if (!current || aiDigest(current.binding) !== aiDigest(request.binding) || clock() >= request.deadline) return false;
        return (await client.query(`UPDATE sophie_ai.request_receipts SET state='sending',updated_at=clock_timestamp()
          WHERE guild_id=$1 AND message_id=$2 AND state='admitted' AND deadline>clock_timestamp() RETURNING message_id`, [guildId, request.messageId])).rowCount === 1;
      });
    },
    async settle(request, state, effectId = null) {
      requireCondition(['delivered', 'reacted', 'silent', 'expired', 'cancelled', 'unavailable', 'uncertain'].includes(state), 'AI_STATE_INVALID');
      if (effectId !== null) requireCondition(typeof effectId === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(effectId), 'AI_EFFECT_INVALID');
      await pool.query(`UPDATE sophie_ai.request_receipts SET state=$3,effect_id=$4,updated_at=clock_timestamp()
        WHERE guild_id=$1 AND message_id=$2 AND state IN ('admitted','sending')`, [guildId, request.messageId, state, effectId]);
    },
    async expire() {
      await pool.query(`UPDATE sophie_ai.request_receipts SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'expired' END,updated_at=clock_timestamp()
        WHERE guild_id=$1 AND state IN ('admitted','sending') AND deadline<=clock_timestamp()`, [guildId]);
    },
  });
}
