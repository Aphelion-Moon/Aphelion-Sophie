import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { canonicalAiConfiguration, participationDecision } from '../../../modules/assistant/participation.js';
import { canonicalPersonality } from '../../../modules/assistant/personality.js';
import { aiDigest } from './ai-controls.js';
import { inTransaction } from './transaction.js';
import { randomUUID } from 'node:crypto';
import { aiReceiptHash } from './ai-privacy.js';

/** Atomic metadata receipts and pacing. Content stays in the returned transient handoff only. */
export function createAiAdmission({ pool, guildId, ingress, inspectContext, inspectMember, clock, noticeRevision = 1,
  readNotice = async () => ({ revision: noticeRevision, binding: null, approved: noticeRevision === 1 }), privacyCurrent = async () => true, trace = () => {}, invite = null }) {
  requireInteger(noticeRevision, 1);
  requireCondition(ingress.guildId === guildId && [inspectContext, inspectMember, clock, readNotice].every(fn => typeof fn === 'function'), 'TRUSTED_ADAPTERS_REQUIRED');
  const gatherOwner = randomUUID();
  let generation = 0;
  // Fixed reason codes only (never message text, IDs or names) so an operator can see why a message was not admitted.
  const skip = reason => { try { trace(reason); } catch { /* Tracing never affects admission. */ } return null; };
  async function noticeMatches(consent) {
    const notice = await readNotice();
    if (notice?.approved !== true || !Number.isSafeInteger(notice.revision) || notice.revision < noticeRevision || notice.revision !== consent.notice_revision) return false;
    if (notice.revision === 1 && notice.binding === null) return true;
    return typeof notice.binding === 'string' && /^[a-f0-9]{64}$/u.test(notice.binding) && consent.receipt?.binding === notice.binding;
  }
  async function snapshot(client, event) {
    const version = generation;
    if (!await privacyCurrent(event.userId,client===pool?null:client)) return skip('PRIVACY_NOT_CURRENT');
    const state = (await client.query('SELECT * FROM sophie_ai.state WHERE guild_id=$1', [guildId])).rows[0];
    if (!state || state.disabled) return skip('AI_DISABLED');
    const rows = (await client.query(`SELECT kind,revision,document,sha256 FROM sophie_ai.publications WHERE guild_id=$1 AND
      ((kind='configuration' AND revision=$2) OR (kind='personality' AND revision=$3))`, [guildId, state.configuration_revision, state.personality_revision])).rows;
    const configuration = rows.find(row => row.kind === 'configuration'), personality = rows.find(row => row.kind === 'personality');
    if (!configuration || !personality) return skip('PUBLICATION_MISSING');
    const config = canonicalAiConfiguration(configuration.document), character = canonicalPersonality(personality.document);
    requireCondition(aiDigest(config) === configuration.sha256 && aiDigest(character) === personality.sha256, 'AI_PUBLICATION_CORRUPT');
    const channel = config.channels.find(row => row.channelId === event.channelId);
    if (!config.enabled || !channel || channel.profile.mode === 'ignore') return skip('CHANNEL_NOT_CONFIGURED');
    const qualification = (await client.query('SELECT * FROM sophie_ai.qualifications WHERE guild_id=$1 AND channel_id=$2', [guildId, event.channelId])).rows[0];
    if (!qualification?.active || !qualification.restore_ready || qualification.configuration_sha256 !== configuration.sha256 || qualification.personality_sha256 !== personality.sha256) return skip('QUALIFICATION_MISMATCH');
    // One server-wide choice per member (owner decision, 23 October 2026); per-channel rows no longer admit anything.
    const consent = (await client.query('SELECT * FROM sophie_ai.member_consents WHERE guild_id=$1 AND user_id=$2', [guildId, event.userId])).rows[0];
    if (!consent?.enabled || !await noticeMatches(consent)) {
      // A member with no choice at all who calls on Sophie may get the static, non-AI invitation (rate-limited by its owner).
      if (!consent && event.callsSophie === true && invite !== null) { try { invite({ channelId: event.channelId, userId: event.userId, messageId: event.messageId }); } catch { /* Never affects admission. */ } }
      return skip(consent?.enabled ? 'NOTICE_MISMATCH' : 'NO_CONSENT');
    }
    // These trusted core adapters read current exclusion/ACL/member metadata, never case content.
    const context = await inspectContext(event), member = await inspectMember(event);
    if (!context?.eligible) return skip(context === null ? 'CONTEXT_UNAVAILABLE' : 'CONTEXT_INELIGIBLE');
    if (!member?.eligible) return skip(member === null ? 'MEMBER_UNAVAILABLE' : 'MEMBER_INELIGIBLE');
    if (context.audienceHash !== qualification.audience_sha256) return skip('AUDIENCE_CHANGED');
    if (context.restricted !== qualification.restricted) return skip('RESTRICTION_CHANGED');
    // A Gateway reconnect advances every presence epoch because departures during the outage cannot be seen. The
    // member's Discord join time can: consent recorded after the current join belongs to this membership and survives
    // a reconnect, while any leave and rejoin (seen or not) moves the join time past it and still voids consent.
    const sameMembership = Number.isSafeInteger(member.joinedAt) && consent.updated_at instanceof Date && member.joinedAt < consent.updated_at.getTime();
    if (member.presenceEpoch !== Number(consent.presence_epoch) && !sameMembership) return skip('PRESENCE_CHANGED');
    if (typeof context.canReply !== 'boolean' || typeof context.canReact !== 'boolean' ||
      !Number.isSafeInteger(member.presenceEpoch) || !Number.isSafeInteger(member.accessEpoch) ||
      typeof context.continuity !== 'string' || context.continuity.length === 0 || typeof context.messageRevision !== 'string') return skip('OBSERVATION_INVALID');
    // Revalidation runs without the admission write lock. Do not return versions read before slow external observations.
    const latest = (await client.query(`SELECT s.epoch AS control_epoch,s.disabled,q.boundary_epoch,q.active,q.restore_ready,
      c.epoch AS consent_epoch,c.enabled,c.presence_epoch FROM sophie_ai.state s
      JOIN sophie_ai.qualifications q ON q.guild_id=s.guild_id AND q.channel_id=$2
      JOIN sophie_ai.member_consents c ON c.guild_id=s.guild_id AND c.user_id=$3
      WHERE s.guild_id=$1`, [guildId,event.channelId,event.userId])).rows[0];
    if (!latest || latest.disabled || !latest.active || !latest.restore_ready || !latest.enabled ||
      Number(latest.control_epoch) !== Number(state.epoch) || Number(latest.boundary_epoch) !== Number(qualification.boundary_epoch) ||
      Number(latest.consent_epoch) !== Number(consent.epoch) || Number(latest.presence_epoch) !== Number(consent.presence_epoch)) return skip('STATE_CHANGED');
    // Metadata and presence reads may outlive approval or a notice change.
    if (!await noticeMatches(consent) || !await privacyCurrent(event.userId,client===pool?null:client) || version !== generation) return skip('CHANGED_DURING_OBSERVATION');
    const now = clock();
    if ([context, member].some(value => !Number.isSafeInteger(value.checkedAt) || value.checkedAt > now || now - value.checkedAt > 5000)) {
      const oldest = Math.min(...[context, member].map(value => Number.isSafeInteger(value.checkedAt) ? value.checkedAt : now));
      return skip(`OBSERVATION_STALE_${Math.min(99, Math.max(0, Math.floor((now - oldest) / 1000)))}S`);
    }
    return { config, character, profile: channel.profile, deadline: event.receivedAt + config.deadlineMs,
      capabilities: { reply: context.canReply, react: context.canReact },
      binding: { epoch: Number(state.epoch), configurationHash: configuration.sha256, personalityHash: personality.sha256,
        boundaryEpoch: Number(qualification.boundary_epoch), audienceHash: context.audienceHash, consentEpoch: Number(consent.epoch),
        presenceEpoch: member.presenceEpoch, accessEpoch: member.accessEpoch, memberHash: member.memberHash ?? null, continuity: context.continuity,
        inputRevision: aiDigest([event.messageId, context.messageRevision]), canReply: context.canReply, canReact: context.canReact,
        workerDomain: qualification.worker_domain, releaseHash: qualification.release_sha256, restricted: qualification.restricted } };
  }
  return Object.freeze({
    invalidate() { generation++; },
    async admit(proof) {
      if (proof === null) return null;
      const version = generation;
      try {
        const event = ingress.inspect(proof);
        if (event.kind !== 'MESSAGE_CREATE') return null;
        return await inTransaction(pool, async client => {
          await client.query('SELECT pg_advisory_xact_lock(182745,56)');
          const duplicate = await client.query('SELECT 1 FROM sophie_ai.request_receipts WHERE guild_id=$1 AND message_id=$2', [guildId, event.messageId]);
          if (duplicate.rowCount) return null;
          if ((await client.query('SELECT 1 FROM sophie_ai.request_tombstones WHERE guild_id=$1 AND message_hash=$2',[guildId,aiReceiptHash(guildId,event.messageId)])).rowCount) return null;
          const initial = await snapshot(client, event);
          if (!initial) return null;
          if (version !== generation || clock() >= initial.deadline - 1000) return skip(version !== generation ? 'INVALIDATED' : 'DEADLINE_PASSED');
          const content = ingress.content(proof); if (content === null) return skip('CONTENT_UNAVAILABLE');
          const decision = participationDecision(initial.profile, { addressed: content.addressed, question: content.question, directedToOther: content.directedToOther, now: clock() });
          decision.outcomes = decision.outcomes.filter(kind => kind === 'silent' || initial.capabilities[kind]);
          const inputRevision = aiDigest([event.messageId, content.inputRevision]);
          if (inputRevision !== initial.binding.inputRevision) return skip('MESSAGE_REVISION_MISMATCH');
          if (!decision.infer) return decision.context ? { ...event, inputRevision, ...initial, decision, text: content.text } : null;
          const bytes = Buffer.byteLength(content.text,'utf8'), gatherable = initial.profile.mode === 'conversational' && bytes <= 4096;
          const { inputRevision: _revision, ...scope } = initial.binding;
          const gatherScope = aiDigest({ scope, target: content.conversationTarget, decision });
          const open = (await client.query(`SELECT * FROM sophie_ai.request_receipts WHERE guild_id=$1 AND user_id=$2 AND state='gathering'
            AND deadline>clock_timestamp() ORDER BY received_at LIMIT 1`, [guildId,event.userId])).rows[0];
          if (open && gatherable && open.channel_id === event.channelId && open.gather_owner === gatherOwner && open.gather_scope === gatherScope &&
            clock() < open.gather_until.getTime() && clock() < open.gather_quiet_until.getTime() &&
            open.gather_bytes + bytes + 1 <= 4096 && open.gather_chars + content.text.length + 1 <= 4000) {
            const count = (await client.query('SELECT count(*)::int AS count FROM sophie_ai.request_receipts WHERE guild_id=$1 AND gather_root=$2', [guildId,open.message_id])).rows[0].count;
            if (count < 3) {
              const quietUntil = count === 2 ? clock() : Math.min(clock()+750,open.gather_until.getTime());
              await client.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline,proactive,received_at,gather_root,gather_owner)
                VALUES($1,$2,$3,$4,$5,'gathered',$6,false,$7,$8,$9)`, [guildId,event.messageId,event.channelId,event.userId,inputRevision,open.deadline,new Date(event.receivedAt),open.message_id,gatherOwner]);
              await client.query(`UPDATE sophie_ai.request_receipts SET gather_bytes=gather_bytes+$3+1,gather_chars=gather_chars+$4+1,gather_quiet_until=$5
                WHERE guild_id=$1 AND message_id=$2`, [guildId,open.message_id,bytes,content.text.length,new Date(quietUntil)]);
              return { ...event,inputRevision,...initial,deadline:open.deadline.getTime(),decision,text:content.text,
                gather:{rootId:open.message_id,owner:gatherOwner,until:open.gather_until.getTime(),quietUntil} };
            }
          }
          const quota = (await client.query(`SELECT
            count(*) FILTER (WHERE channel_id=$2 AND proactive AND received_at > clock_timestamp()-interval '1 hour')::int AS hour,
            max(received_at) FILTER (WHERE channel_id=$2 AND proactive) AS channel_last,
            max(received_at) FILTER (WHERE user_id=$3 AND state<>'gathered') AS member_last,
            count(*) FILTER (WHERE user_id=$3 AND state IN ('gathering','admitted','sending') AND deadline>clock_timestamp())::int AS member_waiting,
            count(*) FILTER (WHERE state IN ('gathering','admitted','sending') AND deadline>clock_timestamp())::int AS waiting
            FROM sophie_ai.request_receipts WHERE guild_id=$1 AND received_at>clock_timestamp()-interval '1 hour'`, [guildId, event.channelId, event.userId])).rows[0];
          const now = clock(), profile = initial.profile;
          // The member interval paces unprompted participation only. A message aimed at Sophie (mention, reply or her name)
          // is limited by one turn in flight per member and the ingress flood limit, so a quick follow-up still gets an answer.
          if (quota.waiting >= 4 || quota.member_waiting > 0 || decision.proactive && quota.member_last && now - quota.member_last.getTime() < profile.memberIntervalMs) return skip('MEMBER_PACING');
          if (decision.proactive && quota.channel_last && now - quota.channel_last.getTime() < profile.evaluationIntervalMs) return skip('CHANNEL_PACING');
          if (decision.proactive && quota.hour >= profile.proactiveRepliesPerHour) decision.outcomes = decision.outcomes.filter(value => value !== 'reply');
          const recent = (await client.query(`SELECT max(updated_at) FILTER (WHERE state='delivered') AS reply_last,
            max(updated_at) FILTER (WHERE state='reacted') AS reaction_last FROM sophie_ai.request_receipts WHERE guild_id=$1 AND channel_id=$2 AND deadline>clock_timestamp()-interval '1 hour'`, [guildId, event.channelId])).rows[0];
          if (decision.proactive && recent.reply_last && now - recent.reply_last.getTime() < profile.replyIntervalMs) decision.outcomes = decision.outcomes.filter(value => value !== 'reply');
          if (recent.reaction_last && now - recent.reaction_last.getTime() < profile.reactionIntervalMs || initial.config.emojis.length === 0) decision.outcomes = decision.outcomes.filter(value => value !== 'react');
          if (decision.outcomes.every(value => value === 'silent')) return skip('NO_PERMITTED_OUTCOME');
          // Observations are in-memory Gateway state, so the admission snapshot cannot age while this transaction runs;
          // generation still fences an invalidation that arrived meanwhile.
          if (version !== generation || clock() >= initial.deadline - 1000) return skip(version !== generation ? 'INVALIDATED' : 'DEADLINE_PASSED');
          // Hash only the platform revision marker, not guessable personal message text.
          const gather = gatherable ? { rootId:event.messageId,owner:gatherOwner,until:event.receivedAt+1500,quietUntil:Math.min(clock()+750,event.receivedAt+1500) } : null;
          await client.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline,proactive,received_at,
            gather_root,gather_owner,gather_scope,gather_until,gather_quiet_until,gather_bytes,gather_chars)
            VALUES($1,$2,$3,$4,$5,$9,$6,$7,$8,$10,$11,$12,$13,$14,$15,$16)`,
          [guildId,event.messageId,event.channelId,event.userId,inputRevision,new Date(initial.deadline),decision.proactive,new Date(event.receivedAt),gather ? 'gathering':'admitted',
            gather?.rootId ?? null,gather?.owner ?? null,gather ? gatherScope:null,gather ? new Date(gather.until):null,gather ? new Date(gather.quietUntil):null,gather ? bytes:null,gather ? content.text.length:null]);
          return { ...event, inputRevision, ...initial, decision, text: content.text, gather };
        });
      } finally { ingress.discard(proof); }
    },
    async replaceGather(proof, previous) {
      const version = generation;
      try {
        const edited = ingress.inspect(proof);
        if (edited.kind !== 'MESSAGE_UPDATE' || !previous.gather || edited.messageId!==previous.messageId ||
          edited.channelId!==previous.channelId || edited.userId!==previous.userId) return null;
        const event={...edited,receivedAt:previous.receivedAt};
        return await inTransaction(pool,async client=>{
          await client.query('SELECT pg_advisory_xact_lock(182745,56)');
          const rows=(await client.query('SELECT * FROM sophie_ai.request_receipts WHERE guild_id=$1 AND gather_root=$2',[guildId,previous.gather.rootId])).rows;
          const root=rows.find(row=>row.message_id===previous.gather.rootId),prior=rows.find(row=>row.message_id===previous.messageId);
          if (!root || root.state!=='gathering' || root.gather_owner!==gatherOwner || !prior || prior.input_revision!==previous.inputRevision ||
            clock()>=root.gather_until.getTime() || clock()>=root.gather_quiet_until.getTime()) return null;
          const initial=await snapshot(client,event);if(!initial || version!==generation || initial.profile.mode!=='conversational')return null;
          const content=ingress.content(proof);if(!content)return null;
          const decision=participationDecision(initial.profile,{addressed:content.addressed,question:content.question,directedToOther:content.directedToOther,now:clock()});
          decision.outcomes=decision.outcomes.filter(kind=>kind==='silent' || initial.capabilities[kind]);
          const {inputRevision:_revision,...scope}=initial.binding;
          if(aiDigest({scope,target:content.conversationTarget,decision})!==root.gather_scope)return null;
          const inputRevision=aiDigest([event.messageId,content.inputRevision]);
          if(inputRevision!==initial.binding.inputRevision || inputRevision===previous.inputRevision)return null;
          const bytes=root.gather_bytes-Buffer.byteLength(previous.text,'utf8')+Buffer.byteLength(content.text,'utf8');
          const chars=root.gather_chars-previous.text.length+content.text.length;
          if(bytes>4096 || chars>4000)return null;
          const latest=await snapshot(client,event);
          if(!latest || aiDigest(latest.binding)!==aiDigest(initial.binding) || clock()>=root.gather_until.getTime())return null;
          const quietUntil=Math.min(clock()+750,root.gather_until.getTime());
          await client.query('UPDATE sophie_ai.request_receipts SET input_revision=$3,updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2',[guildId,event.messageId,inputRevision]);
          await client.query('UPDATE sophie_ai.request_receipts SET gather_bytes=$3,gather_chars=$4,gather_quiet_until=$5 WHERE guild_id=$1 AND message_id=$2',
            [guildId,root.message_id,bytes,chars,new Date(quietUntil)]);
          return {...previous,...initial,inputRevision,text:content.text,deadline:previous.deadline,
            gather:{...previous.gather,quietUntil}};
        });
      } finally {ingress.discard(proof);}
    },
    async revalidate(request) {
      requireInteger(request.deadline);
      if (clock() >= request.deadline) return false;
      const current = await snapshot(pool, request);
      return current !== null && aiDigest(current.binding) === aiDigest(request.binding) && clock() < request.deadline;
    },
    async freezeGather(request, fragments) {
      return inTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745,56)');
        const rows = (await client.query('SELECT * FROM sophie_ai.request_receipts WHERE guild_id=$1 AND gather_root=$2 ORDER BY received_at,message_id', [guildId,request.messageId])).rows;
        const root = rows.find(row=>row.message_id===request.messageId);
        if (!root || root.state!=='gathering' || root.gather_owner!==gatherOwner || clock()<root.gather_quiet_until.getTime() || clock()>=request.deadline-1000 ||
          rows.length!==fragments.length || rows.some(row=>!fragments.some(item=>item.messageId===row.message_id && item.inputRevision===row.input_revision))) return false;
        for (const item of fragments) {
          const current = await snapshot(client,item);
          if (!current || aiDigest(current.binding)!==aiDigest(item.binding)) return false;
        }
        return (await client.query("UPDATE sophie_ai.request_receipts SET state='admitted',updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2 AND state='gathering' AND deadline>clock_timestamp() RETURNING message_id", [guildId,request.messageId])).rowCount===1;
      });
    },
    async revalidateSource(source) {
      const current = await snapshot(pool, source);
      return current !== null && current.profile.mode !== 'ignore' && clock() < source.receivedAt + current.profile.contextTtlMs &&
        aiDigest(current.binding) === aiDigest(source.binding);
    },
    async revalidateEffect(source) {
      // Visible output ownership outlives transient context; recheck authority without renewing any content.
      const current = await snapshot(pool, source);
      return current !== null && aiDigest(current.binding) === source.bindingHash;
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
        WHERE guild_id=$1 AND message_id=$2 AND (state IN ('gathering','admitted','sending') OR
          ($3 IN ('cancelled','uncertain') AND state IN ('delivered','reacted') AND effect_id=$4))`, [guildId, request.messageId, state, effectId]);
    },
    async expire() {
      await pool.query(`UPDATE sophie_ai.request_receipts SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'expired' END,updated_at=clock_timestamp()
        WHERE guild_id=$1 AND state IN ('gathering','admitted','sending') AND deadline<=clock_timestamp()`, [guildId]);
    },
  });
}
