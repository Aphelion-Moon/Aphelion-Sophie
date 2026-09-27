import { requireCondition, requireFreshObservation, requireKeys } from '../../../contracts/validation.js';
import { requireReplyId, renderCaseReply } from '../../../modules/tickets/replies.js';
import { validateCasePolicy, casePlanKey, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { loadCaseRecord, caseManagementScope } from './case-lookup.js';
import { loadCasePlan } from './case-audience.js';
import { registerCasePolicy } from './case-records.js';
import { createMemberOperation, lockMember } from './members.js';
import { recordReplyEvent, requireReplyIntegrity } from './case-reply-records.js';
import { enqueue, finishClaim, lockClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';

/** Retained human text is released only after current authority and an exact private-channel proof. */
export function createCaseReplyDelivery({ pool, clock, policy, authorizeRecorded, caseVerification, messageVerification }) {
  validateCasePolicy(policy);
  requireCondition(typeof authorizeRecorded === 'function' && typeof caseVerification?.candidate === 'function' &&
    typeof caseVerification?.channel === 'function' && typeof messageVerification?.receipt === 'function' &&
    typeof messageVerification?.candidate === 'function' && typeof messageVerification?.matches === 'function', 'CASE_REPLY_CONFIGURATION_INVALID');
  const fixed = structuredClone(policy), memberOperation = createMemberOperation({ pool, clock });
  function effect(job, claim) {
    requireKeys(job.effect, ['kind', 'operationId', 'guildId', 'userId', 'caseId', 'replyId']);
    requireCondition(job.kind === 'case.reply' && job.effect.kind === job.kind && job.effect.guildId === claim.guildId &&
      job.effect.operationId === claim.operationId, 'WRONG_JOB_KIND'); requireReplyId(job.effect.replyId);
  }
  async function record(client, job, row) {
    const reply = (await client.query('SELECT * FROM sophie_core.case_replies WHERE id = $1 FOR UPDATE', [job.effect.replyId])).rows[0];
    requireCondition(reply && reply.guild_id === row.guild_id && reply.case_id === row.id && reply.user_id === row.user_id &&
      reply.user_id === job.effect.userId, 'CASE_REPLY_UNTRUSTED'); return reply;
  }
  const descriptor = state => ({ settled: state.settled, ...(state.settled ? {} : { plan: state.plan, channelId: state.reply.channel_id,
    recordId: state.reply.id, messageId: state.reply.message_id, createStarted: state.reply.create_started,
    withdrawing: state.reply.withdrawal_reason !== null }) });
  async function requireWithdrawal(client, reply, reason) {
    if (reply.withdrawal_reason !== null) return;
    await client.query('UPDATE sophie_core.case_replies SET withdrawal_reason = $2 WHERE id = $1', [reply.id, reason]);
    reply.withdrawal_reason = reason; await recordReplyEvent(client, reply, 'withdrawal-required');
  }
  async function settle(client, claim, reply, state) {
    await client.query('UPDATE sophie_core.case_replies SET state = $2, settled_at = clock_timestamp() WHERE id = $1', [reply.id, state]);
    await recordReplyEvent(client, reply, state); await finishClaim(client, claim, 'done');
  }
  async function current(client, member, claim) {
    const job = await lockClaim(client, claim); effect(job, claim);
    requireCondition(job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'CASE_REPLY_UNTRUSTED');
    await registerCasePolicy(client, fixed);
    const row = await loadCaseRecord(client, { guildId: member.guildId, id: job.effect.caseId, lock: true });
    const reply = await record(client, job, row), plan = await loadCasePlan(client, row);
    if (reply.state !== 'pending') { await finishClaim(client, claim, 'done'); return { settled: true }; }
    requireCondition(plan.guildId === fixed.guildId, 'CASE_POLICY_CHANGED');
    // A durable withdrawal decision never needs the original author's grant restored.
    if (reply.withdrawal_reason === null) {
      const reason = !member.observation.present || member.presenceEpoch !== plan.presenceEpoch ? 'membership-revoked' :
        plan.policyVersion !== fixed.version || row.state !== 'open' || row.desired_access !== 'open' || row.channel_id !== reply.channel_id ? 'case-changed' :
        reply.plan_key !== casePlanKey(plan) ? 'audience-changed' :
        await authorizeRecorded('case.manage', reply.operator_grant, caseManagementScope(row)) !== true ? 'authority-revoked' : null;
      if (reason !== null) await requireWithdrawal(client, reply, reason);
    }
    if (reply.withdrawal_reason && !reply.create_started && reply.message_id === null) {
      await settle(client, claim, reply, 'cancelled'); return { settled: true };
    }
    return { settled: false, row, reply, plan };
  }
  async function verifyChannel(proof, state, withdrawing = false) {
    const channel = await caseVerification[withdrawing ? 'candidate' : 'channel'](proof, state.plan, false);
    if (!withdrawing) requireCaseChannel(channel, state.plan, fixed, false);
    requireCondition(channel.id === state.reply.channel_id, 'CASE_CHANNEL_MISMATCH');
  }
  function payload(state) {
    requireReplyIntegrity(state.reply);
    return renderCaseReply({ id: state.reply.id, authorId: state.reply.author_id, text: state.reply.body });
  }
  async function source(client, claim) {
    validateClaim(claim);
    const job = (await client.query(`SELECT kind, effect, user_id, fence, status, dispatch_started FROM sophie_core.outbox
      WHERE guild_id = $1 AND operation_id = $2 AND kind = 'case.reply'`, [claim.guildId, claim.operationId])).rows[0];
    requireCondition(job && Number(job.fence) >= claim.fence, 'CASE_REPLY_UNTRUSTED'); effect(job, claim); return job;
  }
  return Object.freeze({
    inspect({ claim, observation }) { return memberOperation(observation, async (client, member) => descriptor(await current(client, member, claim))); },
    begin({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled || state.reply.withdrawal_reason) return descriptor(state);
        requireCondition(!state.reply.create_started && state.reply.message_id === null, 'CASE_REPLY_UNCERTAIN');
        await verifyChannel(proof, state); requireFreshObservation(member.observation, clock()); await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.case_replies SET create_started = true WHERE id = $1', [state.reply.id]);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        await recordReplyEvent(client, state.reply, 'send-started'); return { ...descriptor(state), payload: payload(state) };
      });
    },
    /** A late authentic ID remains recoverable after lease loss; it never confirms the reply. */
    note({ claim, proof }) {
      return inTransaction(pool, async client => {
        const job = await source(client, claim); requireCondition(job.dispatch_started, 'CASE_REPLY_UNTRUSTED');
        await lockMember(client, claim.guildId, job.user_id);
        const row = await loadCaseRecord(client, { guildId: claim.guildId, id: job.effect.caseId, lock: true }), reply = await record(client, job, row);
        requireCondition(reply.create_started, 'CASE_REPLY_UNTRUSTED');
        const observed = await messageVerification.receipt(proof, { recordId: reply.id, plan: await loadCasePlan(client, row), channelId: reply.channel_id });
        requireCondition(!observed.missing && (reply.message_id === null || reply.message_id === observed.messageId), 'CASE_REPLY_UNTRUSTED');
        if (reply.message_id === null) {
          reply.message_id = observed.messageId;
          await client.query('UPDATE sophie_core.case_replies SET message_id = $2 WHERE id = $1', [reply.id, reply.message_id]);
          await recordReplyEvent(client, reply, 'receipt');
        }
        if (reply.state === 'pending' && (Number(job.fence) !== claim.fence || job.status !== 'leased')) await enqueue(client,
          { kind: 'case.reply', operationId: `reply.late.${reply.id}.${claim.fence}`, guildId: claim.guildId, userId: job.user_id, caseId: row.id, replyId: reply.id });
      });
    },
    confirm({ claim, observation, proof, message }) {
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled || state.reply.withdrawal_reason) return descriptor(state);
        requireCondition(state.reply.message_id !== null, 'CASE_REPLY_UNCERTAIN'); await verifyChannel(proof, state);
        const expected = { ...descriptor(state), payload: payload(state) }, observed = await messageVerification.candidate(message, expected);
        requireCondition(!observed.missing && observed.messageId === state.reply.message_id, 'CASE_REPLY_MESSAGE_MISSING');
        if (await messageVerification.matches(message, expected) !== true) {
          await requireWithdrawal(client, state.reply, 'message-changed'); return descriptor(state);
        }
        requireFreshObservation(member.observation, clock()); await settle(client, claim, state.reply, 'confirmed'); return { settled: true, confirmed: true };
      });
    },
    async withdrawal({ claim, observation, proof, message, finish = false }) {
      requireCondition(typeof finish === 'boolean', 'CASE_REPLY_UNTRUSTED');
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled) return { settled: true };
        requireCondition(state.reply.withdrawal_reason !== null && state.reply.message_id !== null, 'CASE_REPLY_UNTRUSTED');
        await verifyChannel(proof, state, true);
        const observed = await messageVerification.candidate(message, descriptor(state));
        requireCondition(observed.messageId === state.reply.message_id, 'CASE_REPLY_UNTRUSTED'); requireFreshObservation(member.observation, clock());
        if (finish) {
          requireCondition(observed.missing, 'CASE_REPLY_WITHDRAWAL_UNCONFIRMED');
          await settle(client, claim, state.reply, 'withdrawn'); return { settled: true, withdrawn: true };
        }
        await lockClaim(client, claim); return descriptor(state);
      });
    },
    releaseUnsent(claim) {
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim); effect(job, claim);
        const reply = (await client.query(`UPDATE sophie_core.case_replies SET create_started = false
          WHERE id = $1 AND guild_id = $2 AND user_id = $3 AND case_id = $4 AND state = 'pending' AND create_started AND message_id IS NULL RETURNING *`,
        [job.effect.replyId, claim.guildId, job.effect.userId, job.effect.caseId])).rows[0];
        if (reply) await recordReplyEvent(client, reply, 'send-released');
      });
    },
    /** Persist a known audience/ACL failure before any compensation. No body enters the outbox. */
    invalidate(claim) {
      return inTransaction(pool, async client => {
        const job = await source(client, claim); await lockMember(client, claim.guildId, job.user_id);
        const row = await loadCaseRecord(client, { guildId: claim.guildId, id: job.effect.caseId, lock: true }), reply = await record(client, job, row);
        const changed = reply.state === 'pending' && reply.withdrawal_reason === null;
        if (changed) await requireWithdrawal(client, reply, 'channel-access-changed');
        return changed;
      });
    },
  });
}
