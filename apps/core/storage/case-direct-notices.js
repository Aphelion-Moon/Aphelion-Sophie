import { requireCondition, requireFreshObservation, requireKeys } from '../../../contracts/validation.js';
import { validateCasePolicy, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { createMemberOperation, lockMember } from './members.js';
import { loadCaseRecord } from './case-lookup.js';
import { loadCasePlan } from './case-audience.js';
import { lockClaim, finishClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';

export function createCaseDirectNoticeStore({ pool, clock, policy, channels, messages }) {
  validateCasePolicy(policy); const fixed = structuredClone(policy), operation = createMemberOperation({ pool, clock });
  async function current(client, member, claim) {
    const job = await lockClaim(client, claim);
    requireKeys(job.effect, ['kind', 'operationId', 'guildId', 'userId', 'caseId']);
    requireCondition(job.kind === 'case.dm' && job.effect.kind === job.kind && job.effect.operationId === claim.operationId &&
      job.effect.guildId === member.guildId && job.effect.userId === member.userId && member.guildId === fixed.guildId, 'WRONG_JOB_KIND');
    const row = await loadCaseRecord(client, { guildId: member.guildId, id: job.effect.caseId, lock: true });
    const plan = await loadCasePlan(client, row);
    const record = (await client.query('SELECT * FROM sophie_core.case_direct_notices WHERE case_id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE',
      [plan.id, member.guildId, member.userId])).rows[0];
    requireCondition(record && plan.openerId === member.userId, 'CASE_DM_UNTRUSTED');
    if (record.state !== 'pending') { await finishClaim(client, claim, 'done'); return { settled: true }; }
    if (!member.observation.present || member.presenceEpoch !== plan.presenceEpoch || plan.policyVersion !== fixed.version ||
      row.state !== 'open' || row.desired_access !== 'open' || !row.channel_id) {
      await client.query("UPDATE sophie_core.case_direct_notices SET state = 'obsolete' WHERE case_id = $1", [plan.id]);
      await finishClaim(client, claim, 'done'); return { settled: true };
    }
    requireCondition(!record.create_started, 'CASE_DM_UNCERTAIN');
    return { settled: false, plan, channelId: row.channel_id, nonce: record.nonce };
  }
  return Object.freeze({
    inspect({ claim, observation }) { return operation(observation, (client, member) => current(client, member, claim)); },
    begin({ claim, observation, channel, dm }) {
      return operation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled) return state;
        const verified = await channels.channel(channel, state.plan, false); requireCaseChannel(verified, state.plan, fixed, false);
        requireCondition(verified.id === state.channelId, 'CASE_CHANNEL_MISMATCH');
        const dmChannelId = await messages.destination(dm, state.plan); requireFreshObservation(member.observation, clock());
        await client.query(`UPDATE sophie_core.case_direct_notices SET create_started = true, dm_channel_id = $2, ticket_channel_id = $3 WHERE case_id = $1`,
          [state.plan.id, dmChannelId, state.channelId]);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return state;
      });
    },
    /** Retain a proven late delivery even after lease expiry; it cannot authorize another send. */
    note({ claim, proof }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const job = (await client.query("SELECT effect, user_id, fence FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2 AND kind = 'case.dm'",
          [claim.guildId, claim.operationId])).rows[0];
        requireCondition(job && Number(job.fence) >= claim.fence, 'CASE_DM_UNTRUSTED');
        await lockMember(client, claim.guildId, job.user_id);
        const record = (await client.query('SELECT * FROM sophie_core.case_direct_notices WHERE case_id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE',
          [job.effect.caseId, claim.guildId, job.user_id])).rows[0];
        requireCondition(record?.create_started, 'CASE_DM_UNTRUSTED');
        const messageId = messages.receipt(proof, { caseId: record.case_id, userId: record.user_id, guildId: record.guild_id,
          dmChannelId: record.dm_channel_id, channelId: record.ticket_channel_id, nonce: record.nonce });
        requireCondition(record.message_id === null || record.message_id === messageId, 'CASE_DM_UNTRUSTED');
        await client.query("UPDATE sophie_core.case_direct_notices SET state = 'sent', message_id = $2 WHERE case_id = $1", [record.case_id, messageId]);
      });
    },
    finish(claim) { return inTransaction(pool, async client => { await lockClaim(client, claim); await finishClaim(client, claim, 'done'); }); },
    blocked(claim) {
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim); requireCondition(job.kind === 'case.dm', 'WRONG_JOB_KIND');
        await client.query("UPDATE sophie_core.case_direct_notices SET state = 'blocked' WHERE case_id = $1 AND message_id IS NULL", [job.effect.caseId]);
        await finishClaim(client, claim, 'done');
      });
    },
    releaseUnsent(claim) {
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim); requireCondition(job.kind === 'case.dm', 'WRONG_JOB_KIND');
        await client.query(`UPDATE sophie_core.case_direct_notices SET create_started = false, dm_channel_id = NULL, ticket_channel_id = NULL
          WHERE case_id = $1 AND state = 'pending' AND message_id IS NULL`, [job.effect.caseId]);
      });
    },
  });
}
