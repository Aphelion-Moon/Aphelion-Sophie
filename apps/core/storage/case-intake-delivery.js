import { loadCasePlan } from './case-audience.js';
import { requireCondition, requireFreshObservation, requireKeys } from '../../../contracts/validation.js';
import { validateCasePolicy, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { requireIntakeMessageId, renderCaseIntakeMessage } from '../../../modules/tickets/intake-messages.js';
import { createMemberOperation, lockMember } from './members.js';
import { loadCaseRecord } from './case-lookup.js';
import { registerCasePolicy } from './case-records.js';
import { planIntakeMessages } from './case-intake-message-records.js';
import { caseFormHash } from './case-form-records.js';
import { enqueue, finishClaim, lockClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';

/** Internal delivery use cases. Descriptors never contain answers; payloads require a current private-channel proof. */
export function createCaseIntakeDeliveryStore({ pool, clock, policy, caseVerification, messageVerification }) {
  validateCasePolicy(policy); const fixed = structuredClone(policy), memberOperation = createMemberOperation({ pool, clock });
  async function current(client, member, claim) {
    const job = await lockClaim(client, claim);
    requireKeys(job.effect, ['kind', 'operationId', 'guildId', 'userId', 'caseId']);
    requireCondition(job.kind === 'case.intake' && job.effect.guildId === member.guildId && job.effect.userId === member.userId &&
      job.effect.operationId === claim.operationId, 'WRONG_JOB_KIND');
    await registerCasePolicy(client, fixed);
    const row = await loadCaseRecord(client, { guildId: member.guildId, id: job.effect.caseId, lock: true }), plan = await loadCasePlan(client, row);
    requireCondition(plan.guildId === fixed.guildId && plan.openerId === member.userId && plan.policyVersion === fixed.version, 'CASE_POLICY_CHANGED');
    requireCondition(member.observation.present && plan.presenceEpoch === member.presenceEpoch, 'CASE_INTAKE_UNAVAILABLE');
    requireCondition(row.state !== 'pending', 'CASE_INTAKE_NOT_READY');
    requireCondition(row.state === 'open' && row.desired_access === 'open' && row.channel_id !== null, 'CASE_INTAKE_UNAVAILABLE');
    const { records, pages } = await planIntakeMessages(client, plan, fixed), record = records.find(value => value.state === 'pending');
    if (!record) { await finishClaim(client, claim, 'done'); return { settled: true }; }
    requireCondition(record.channel_id === null || record.channel_id === row.channel_id, 'CASE_CHANNEL_MISMATCH');
    return { settled: false, plan, channelId: row.channel_id, recordId: record.id, kind: record.kind,
      messageId: record.message_id, createStarted: record.create_started, record, page: pages[record.ordinal - 1] };
  }
  const descriptor = ({ record: _, page: __, ...view }) => view;
  const payload = state => renderCaseIntakeMessage({ id: state.recordId, page: state.page, caseType: state.plan.type, policy: fixed });
  async function verify(proof, state) {
    requireCondition(typeof caseVerification?.channel === 'function', 'CASE_VERIFIER_REQUIRED');
    const channel = await caseVerification.channel(proof, state.plan, false);
    requireCaseChannel(channel, state.plan, fixed, false); requireCondition(channel.id === state.channelId, 'CASE_CHANNEL_MISMATCH');
  }
  function messageProof(kind, proof, expected) {
    requireCondition(typeof messageVerification?.[kind] === 'function', 'CASE_INTAKE_VERIFIER_REQUIRED'); return messageVerification[kind](proof, expected);
  }
  async function source(client, claim) {
    validateClaim(claim);
    const job = (await client.query("SELECT effect, user_id, fence, status, dispatch_started FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2 AND kind = 'case.intake'",
      [claim.guildId, claim.operationId])).rows[0];
    requireCondition(job !== undefined && Number(job.fence) >= claim.fence, 'SHUTTLE_MESSAGE_UNTRUSTED'); return job;
  }
  return Object.freeze({
    async inspectCaseIntake({ claim, observation }) {
      return memberOperation(observation, async (client, member) => descriptor(await current(client, member, claim)));
    },
    async beginCaseIntakeMessage({ claim, observation, proof, recordId }) {
      requireIntakeMessageId(recordId);
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled) return state;
        requireCondition(state.recordId === recordId && !state.createStarted && state.messageId === null, 'CASE_INTAKE_UNCERTAIN');
        await verify(proof, state); requireFreshObservation(member.observation, clock()); await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.case_intake_messages SET create_started = true, channel_id = $2 WHERE id = $1', [recordId, state.channelId]);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return { ...descriptor(state), payload: payload(state) };
      });
    },
    /** Authentic late IDs are retained even when an old lease cannot confirm or send anything else. */
    async noteCaseIntakeMessage({ claim, recordId, proof }) {
      requireIntakeMessageId(recordId);
      return inTransaction(pool, async client => {
        const job = await source(client, claim); requireCondition(job.dispatch_started, 'SHUTTLE_MESSAGE_UNTRUSTED');
        await lockMember(client, claim.guildId, job.user_id);
        const row = await loadCaseRecord(client, { guildId: claim.guildId, id: job.effect.caseId, lock: true });
        const record = (await client.query('SELECT * FROM sophie_core.case_intake_messages WHERE id = $1 AND case_id = $2 AND guild_id = $3 AND user_id = $4 FOR UPDATE',
          [recordId, row.id, claim.guildId, job.user_id])).rows[0];
        requireCondition(record?.create_started && record.channel_id !== null, 'SHUTTLE_MESSAGE_UNTRUSTED');
        const observed = await messageProof('receipt', proof, { recordId, plan: await loadCasePlan(client, row), channelId: record.channel_id });
        requireCondition(!observed.missing && (record.message_id === null || record.message_id === observed.messageId), 'SHUTTLE_MESSAGE_UNTRUSTED');
        await client.query('UPDATE sophie_core.case_intake_messages SET message_id = $2 WHERE id = $1', [recordId, observed.messageId]);
        if (Number(job.fence) !== claim.fence || job.status !== 'leased') await enqueue(client, { kind: 'case.intake',
          operationId: `intake.late.${recordId}.${claim.fence}`, guildId: claim.guildId, userId: job.user_id, caseId: row.id });
      });
    },
    async confirmCaseIntakeMessage({ claim, observation, proof, recordId, message }) {
      requireIntakeMessageId(recordId);
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled) return state;
        requireCondition(state.recordId === recordId && state.messageId !== null, 'CASE_INTAKE_UNCERTAIN'); await verify(proof, state);
        const expected = { ...descriptor(state), payload: payload(state) }, observed = await messageProof('candidate', message, expected);
        requireCondition(!observed.missing && observed.messageId === state.messageId, 'CASE_INTAKE_MESSAGE_MISSING');
        requireCondition(await messageProof('matches', message, expected), 'CASE_INTAKE_MESSAGE_CHANGED'); requireFreshObservation(member.observation, clock());
        await client.query("UPDATE sophie_core.case_intake_messages SET state = 'confirmed', confirmed_at = clock_timestamp() WHERE id = $1", [recordId]);
        const pending = (await client.query("SELECT 1 FROM sophie_core.case_intake_messages WHERE case_id = $1 AND state = 'pending'", [state.plan.id])).rowCount > 0;
        if (pending) return { settled: false, confirmed: true };
        await finishClaim(client, claim, 'done');
        await client.query(`UPDATE sophie_core.outbox SET status = 'done', last_error_code = NULL WHERE guild_id = $1 AND user_id = $2
          AND kind = 'case.intake' AND effect->>'caseId' = $3 AND status IN ('ready', 'parked')`, [member.guildId, member.userId, state.plan.id]);
        return { settled: true, confirmed: true };
      });
    },
    async releaseUnsentCaseIntakeMessage({ claim, recordId }) {
      requireIntakeMessageId(recordId);
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim); requireCondition(job.kind === 'case.intake', 'WRONG_JOB_KIND');
        await client.query(`UPDATE sophie_core.case_intake_messages SET create_started = false, channel_id = NULL
          WHERE id = $1 AND case_id = $2 AND guild_id = $3 AND user_id = $4 AND message_id IS NULL AND state = 'pending'`,
        [recordId, job.effect.caseId, job.effect.guildId, job.effect.userId]);
      });
    },
    /** Reconcile access after a failed or late write; this records metadata only, with no new message attempt. */
    async queueCaseIntakeInspection(claim) {
      return inTransaction(pool, async client => {
        const job = await source(client, claim); await lockMember(client, claim.guildId, job.user_id);
        const row = await loadCaseRecord(client, { guildId: claim.guildId, id: job.effect.caseId, lock: true });
        await enqueue(client, { kind: 'case.provision', operationId: `case.intake-guard.${caseFormHash([claim.operationId, claim.fence])}`,
          guildId: claim.guildId, userId: job.user_id, caseId: row.id, type: row.type });
      });
    },
  });
}
