import { requireCondition, requireFreshObservation } from '../../../contracts/validation.js';
import { requireAlertId, renderOnboardingAlert } from '../../../modules/onboarding/alerts.js';
import { createMemberOperation, lockMember } from './members.js';
import { createOnboardingCaseAccess } from './onboarding-case-access.js';
import { getSession } from './onboarding-records.js';
import { enqueue, finishClaim, lockClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';

/** Internal delivery only. No command can provide an alert body or choose its audience. */
export function createOnboardingAlertStore({ pool, clock, policy, caseVerification, messageVerification }) {
  const memberOperation = createMemberOperation({ pool, clock });
  const { binding, verify } = createOnboardingCaseAccess({ policy, verification: caseVerification });
  const fixed = policy === null ? null : structuredClone(policy);
  async function alertFor(client, member, id) {
    requireAlertId(id);
    const row = (await client.query(`SELECT * FROM sophie_core.shuttle_alerts WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE`,
      [id, member.guildId, member.userId])).rows[0];
    requireCondition(row !== undefined, 'SHUTTLE_ALERT_NOT_FOUND'); return row;
  }
  async function current(client, member, claim) {
    const job = await lockClaim(client, claim);
    requireCondition(job.kind === 'shuttle.alert' && job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
    const alert = await alertFor(client, member, job.effect.alertId);
    if (job.effect.revision !== alert.revision) {
      await finishClaim(client, claim, 'cancelled', 'SHUTTLE_ALERT_SUPERSEDED'); return { settled: true };
    }
    if (alert.state !== 'pending') { await finishClaim(client, claim, 'done'); return { settled: true }; }
    const session = await getSession(client, alert.session_id, member.guildId, member.userId);
    const bound = await binding(client, member, session);
    let relevant;
    if (alert.kind === 'help') {
      relevant = (await client.query(`SELECT 1 FROM sophie_core.shuttle_help_requests
        WHERE guild_id = $1 AND interaction_id = $2 AND session_id = $3 AND status = 'open'`,
      [member.guildId, alert.source_id, session.id])).rowCount > 0;
    } else {
      relevant = (await client.query(`SELECT 1 FROM sophie_core.outbox o
        JOIN sophie_core.outbox g ON g.guild_id = o.guild_id AND g.user_id = o.user_id AND g.kind = 'whitelist.grant'
          AND g.operation_id = CASE WHEN o.kind = 'whitelist.grant' THEN o.operation_id ELSE o.effect->>'sourceOperation' END
        WHERE o.guild_id = $1 AND o.user_id = $2 AND g.effect->>'sessionId' = $3
          AND o.kind IN ('whitelist.grant', 'whitelist.reconcile') AND o.status IN ('ready', 'leased', 'parked')
          AND (o.last_error_code IS NOT NULL OR o.kind = 'whitelist.reconcile') LIMIT 1`,
      [member.guildId, member.userId, session.id])).rowCount > 0;
      if (session.status === 'complete' && session.eligibilityEpoch === member.eligibilityEpoch && member.observation.whitelist) relevant = false;
    }
    if (!relevant || !member.observation.present || bound.plan.presenceEpoch !== member.presenceEpoch || bound.row.state !== 'open') {
      await client.query("UPDATE sophie_core.shuttle_alerts SET state = 'obsolete' WHERE id = $1", [alert.id]);
      await finishClaim(client, claim, 'done'); return { settled: true, obsolete: true };
    }
    requireCondition(alert.channel_id === null || alert.channel_id === bound.row.channel_id, 'CASE_CHANNEL_MISMATCH');
    const wording = await readSystemWording(client, member.guildId, alert.wording_revision);
    if (alert.wording_revision === null) await client.query('UPDATE sophie_core.shuttle_alerts SET wording_revision=$2 WHERE id=$1', [alert.id, wording.revision]);
    return { settled: false, alert, plan: bound.plan, channelId: bound.row.channel_id, alertId: alert.id,
      messageId: alert.message_id, createStarted: alert.create_started,
      payload: renderOnboardingAlert({ alertId: alert.id, kind: alert.kind, staffRoleId: responderRoles(fixed, 'shuttle')[0] }, wording.text) };
  }
  async function messageProof(kind, proof, expected) {
    requireCondition(typeof messageVerification?.[kind] === 'function', 'SHUTTLE_ALERT_VERIFIER_REQUIRED');
    return messageVerification[kind](proof, expected);
  }
  return Object.freeze({
    async inspectOnboardingAlert({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim);
        const { alert: _, ...view } = state; return view;
      });
    },
    async beginOnboardingAlert({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled) return state;
        requireCondition(!state.createStarted && state.messageId === null, 'SHUTTLE_ALERT_UNCERTAIN');
        await verify(proof, state.plan, state.channelId, false); requireFreshObservation(member.observation, clock());
        await lockClaim(client, claim);
        await client.query('UPDATE sophie_core.shuttle_alerts SET create_started = true, channel_id = $2 WHERE id = $1', [state.alertId, state.channelId]);
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        const { alert: _, ...view } = state; return view;
      });
    },
    async noteOnboardingAlert({ claim, proof }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = (await client.query(`SELECT effect, user_id, fence, status, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2 AND kind = 'shuttle.alert'`, [claim.guildId, claim.operationId])).rows[0];
        requireCondition(source?.dispatch_started && source.fence >= claim.fence, 'SHUTTLE_MESSAGE_UNTRUSTED');
        const member = await lockMember(client, claim.guildId, source.user_id);
        const alert = await alertFor(client, member, source.effect.alertId);
        requireCondition(source.effect.revision === alert.revision, 'SHUTTLE_MESSAGE_UNTRUSTED');
        const session = await getSession(client, alert.session_id, member.guildId, member.userId);
        const { plan } = await binding(client, member, session, false);
        const observed = await messageProof('receipt', proof, { alertId: alert.id, plan, channelId: alert.channel_id });
        requireCondition(alert.create_started && !observed.missing && (alert.message_id === null || alert.message_id === observed.messageId), 'SHUTTLE_MESSAGE_UNTRUSTED');
        await client.query('UPDATE sophie_core.shuttle_alerts SET message_id = $2 WHERE id = $1', [alert.id, observed.messageId]);
        if (source.fence !== claim.fence || source.status !== 'leased') await enqueue(client, { kind: 'shuttle.alert',
          operationId: `shuttle-alert.late.${alert.id}.${alert.revision}.${claim.fence}`,
          guildId: member.guildId, userId: member.userId, alertId: alert.id, revision: alert.revision });
      });
    },
    async confirmOnboardingAlert({ claim, observation, proof, message }) {
      return memberOperation(observation, async (client, member) => {
        const state = await current(client, member, claim); if (state.settled) return state;
        await verify(proof, state.plan, state.channelId, false);
        const observed = await messageProof('candidate', message, state);
        requireCondition(!observed.missing && observed.messageId === state.messageId, 'SHUTTLE_ALERT_MISSING');
        requireCondition(await messageProof('matches', message, state), 'SHUTTLE_ALERT_CHANGED');
        requireFreshObservation(member.observation, clock());
        await client.query("UPDATE sophie_core.shuttle_alerts SET state = 'confirmed', confirmed_at = clock_timestamp() WHERE id = $1", [state.alertId]);
        await finishClaim(client, claim, 'done'); return { settled: true, confirmed: true };
      });
    },
    /** Only a definite pre-send/rate-limit refusal can release a still-unidentified attempt. */
    async releaseUnsentOnboardingAlert(claim) {
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim); requireCondition(job.kind === 'shuttle.alert', 'WRONG_JOB_KIND');
        await client.query(`UPDATE sophie_core.shuttle_alerts SET create_started = false, channel_id = NULL
          WHERE id = $1 AND revision = $2 AND message_id IS NULL AND state = 'pending'`, [job.effect.alertId, job.effect.revision]);
      });
    },
  });
}
import { responderRoles } from '../../../platform/authorization/case-responders.js';
import { readSystemWording } from './system-wording.js';
