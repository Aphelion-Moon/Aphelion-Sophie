import { requireCondition, requireFreshObservation, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { commonParkedCodes } from '../../../contracts/delivery-errors.js';
import { createMemberOperation } from './members.js';
import { receipt, saveReceipt } from './receipts.js';

const operation = value => requireCondition(typeof value === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(value), 'MODERATION_INPUT_INVALID');
const failureCodes = new Set([...commonParkedCodes, 'ATTEMPT_LIMIT', 'DISCORD_RATE_LIMIT_INVALID', 'RECONCILIATION_REVIEW_REQUIRED']);
const matches = (job, member, revision) => job.kind === 'member.reconcile' && job.user_id === member.userId &&
  job.effect.guildId === member.guildId && job.effect.userId === member.userId &&
  (job.effect.actionRevision === null || job.effect.actionRevision === revision);

/** Reopens a reviewed reconciliation job, preserving its intent, uncertainty and original authority. */
export function createModerationRecovery({ pool, clock, authorize, authorizeRecorded }) {
  const memberOperation = createMemberOperation({ pool, clock });
  const scope = member => ({ guildId: member.guildId, userId: member.userId });
  const capability = action => action.muted ? 'member.mute' : 'member.unmute';
  const check = async (actor, member, action) => requireCondition(await authorize(capability(action), actor, scope(member)) === true, 'OPERATION_DENIED');
  async function latest(client, member) {
    return (await client.query(`SELECT revision, muted, operator_grant, eligibility_epoch FROM sophie_core.member_actions
      WHERE guild_id=$1 AND user_id=$2 ORDER BY revision DESC LIMIT 1 FOR UPDATE`, [member.guildId, member.userId])).rows[0] ?? null;
  }
  async function hold(member, action) {
    if (!member.observation.present) return 'member_left';
    if (Number(action.eligibility_epoch) !== member.eligibilityEpoch) return 'decision_expired';
    if (await authorizeRecorded(capability(action), action.operator_grant, scope(member)) !== true) return 'moderator_unavailable';
    return null;
  }
  return Object.freeze({
    async reviewModeration({ actor, observation }) {
      return memberOperation(observation, async (client, member) => {
        const action = await latest(client, member);
        if (action) await check(actor, member, action);
        else requireCondition(await authorize('member.mute', actor, scope(member)) === true ||
          await authorize('member.unmute', actor, scope(member)) === true, 'OPERATION_DENIED');
        const reason = action ? await hold(member, action) : 'no_action', revision = action ? Number(action.revision) : null;
        const jobs = action ? (await client.query(`SELECT operation_id, kind, user_id, effect, status, fence, last_error_code
          FROM sophie_core.outbox WHERE guild_id=$1 AND user_id=$2 AND kind='member.reconcile'
            AND status IN ('ready','leased','parked') AND (effect->'actionRevision'='null'::jsonb OR effect->>'actionRevision'=$3)
          ORDER BY created_at DESC, operation_id DESC LIMIT 20`, [member.guildId, member.userId, String(revision)])).rows : [];
        if (action) await check(actor, member, action);
        requireFreshObservation(member.observation, clock());
        return { guildId: member.guildId, actorId: operatorGrant(actor).userId, userId: member.userId,
          action: action ? (action.muted ? 'mute' : 'unmute') : null, actionRevision: revision,
          eligibilityEpoch: member.eligibilityEpoch, hold: reason,
          jobs: jobs.filter(job => matches(job, member, revision)).map(job => ({ operationId: job.operation_id,
            fence: Number(job.fence), status: job.status, reason: failureCodes.has(job.last_error_code) ? job.last_error_code : null,
            retryAllowed: reason === null && job.status === 'parked' && failureCodes.has(job.last_error_code) })) };
      });
    },
    async retryModeration({ actor, observation, interactionId, operationId, expectedFence, expectedActionRevision, expectedEligibilityEpoch }) {
      operation(operationId); requireInteger(expectedFence); requireInteger(expectedActionRevision, 1); requireInteger(expectedEligibilityEpoch);
      return memberOperation(observation, async (client, member) => {
        const action = await latest(client, member);
        requireCondition(action !== null && Number(action.revision) === expectedActionRevision, 'MODERATION_REVIEW_STALE');
        await check(actor, member, action);
        requireCondition(member.eligibilityEpoch === expectedEligibilityEpoch && await hold(member, action) === null, 'MODERATION_REVIEW_STALE');
        const previous = await receipt(client, member.guildId, member.userId, interactionId, { action: 'retry-moderation',
          operatorId: operatorGrant(actor).userId, operationId, expectedFence, expectedActionRevision, expectedEligibilityEpoch });
        if (previous) return { recorded: true, duplicate: true };
        const job = (await client.query(`SELECT kind, user_id, effect, status, fence, last_error_code FROM sophie_core.outbox
          WHERE guild_id=$1 AND operation_id=$2 FOR UPDATE`, [member.guildId, operationId])).rows[0];
        requireCondition(job && matches(job, member, expectedActionRevision) && job.status === 'parked' &&
          Number(job.fence) === expectedFence && failureCodes.has(job.last_error_code), 'MODERATION_REVIEW_STALE');
        await check(actor, member, action);
        requireCondition(await hold(member, action) === null, 'MODERATION_REVIEW_STALE');
        requireFreshObservation(member.observation, clock());
        // Do not clear dispatch_started: a possibly completed role write must first be observed.
        await client.query(`UPDATE sophie_core.outbox SET status='ready', attempts=0, fence=fence+1,
          lease_owner=NULL, lease_until=NULL, available_at=clock_timestamp(), last_error_code=NULL
          WHERE guild_id=$1 AND operation_id=$2`, [member.guildId, operationId]);
        await saveReceipt(client, member.guildId, interactionId, { recorded: true });
        return { recorded: true, duplicate: false };
      });
    },
  });
}
