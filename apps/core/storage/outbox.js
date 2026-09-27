import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../../contracts/validation.js';
import { inTransaction } from './transaction.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes, onboardingAlertParkedCodes, caseIntakeParkedCodes, caseReplyParkedCodes, automationParkedCodes } from '../../../contracts/delivery-errors.js';
import { recordOnboardingDeliveryAlert } from './onboarding-alert-records.js';
import { recordOnboardingDeliveryIssue } from './onboarding-issue-records.js';
import { recordCaseDeliveryIssue } from './case-issue-records.js';

const deliveryKinds = Object.freeze(['whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision', 'shuttle.render', 'shuttle.alert', 'case.intake', 'case.dm', 'case.reply', 'automation.dispatch']);

async function recordDeliveryFailure(client, claim) {
  await recordOnboardingDeliveryIssue(client, claim);
  await recordCaseDeliveryIssue(client, claim);
  const effect = await recordOnboardingDeliveryAlert(client, claim);
  if (effect) await enqueue(client, effect);
}

export async function enqueue(client, effect) {
  // Internal callers emit closed, versioned effect shapes; no arbitrary job handlers.
  const result = await client.query(`INSERT INTO sophie_core.outbox
    (guild_id, operation_id, user_id, kind, effect) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (guild_id, operation_id) DO NOTHING RETURNING operation_id`,
  [effect.guildId, effect.operationId, effect.userId, effect.kind, effect]);
  if (!result.rowCount) {
    const previous = await client.query('SELECT effect = $3::jsonb AS same FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2', [effect.guildId, effect.operationId, effect]);
    requireCondition(previous.rows[0]?.same, 'OUTBOX_ID_COLLISION');
  }
}

export function validateClaim(claim) {
  requireKeys(claim, ['guildId', 'operationId', 'owner', 'fence']);
  requireId(claim.guildId);
  requireCondition(typeof claim.operationId === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(claim.operationId), 'INVALID_OPERATION_ID');
  requireName(claim.owner);
  requireInteger(claim.fence, 1);
}

export async function lockClaim(client, claim) {
  validateClaim(claim);
  const result = await client.query(`SELECT effect, kind, user_id, dispatch_started FROM sophie_core.outbox
    WHERE guild_id = $1 AND operation_id = $2 AND lease_owner = $3 AND fence = $4
      AND status = 'leased' AND lease_until > clock_timestamp() FOR UPDATE`,
  [claim.guildId, claim.operationId, claim.owner, claim.fence]);
  requireCondition(result.rowCount === 1, 'OUTBOX_LEASE_LOST');
  return result.rows[0];
}

export async function finishClaim(client, claim, status, code = null) {
  // Recheck the time after any intervening row locks or state validation.
  const result = await client.query(`UPDATE sophie_core.outbox SET status = $5,
    lease_owner = NULL, lease_until = NULL, last_error_code = $6
    WHERE guild_id = $1 AND operation_id = $2 AND lease_owner = $3 AND fence = $4
      AND status = 'leased' AND lease_until > clock_timestamp()`,
  [claim.guildId, claim.operationId, claim.owner, claim.fence, status, code]);
  requireCondition(result.rowCount === 1, 'OUTBOX_LEASE_LOST');
}

/** Claims are internal core APIs; a lease is not permission to make a Discord call. */
export function createOutbox({ pool }) {
  return Object.freeze({
    async claim(owner, leaseMs = 30_000, kinds = deliveryKinds) {
      requireName(owner);
      requireInteger(leaseMs, 1_000, 120_000);
      requireCondition(Array.isArray(kinds) && kinds.length > 0 && kinds.length <= deliveryKinds.length && new Set(kinds).size === kinds.length &&
        kinds.every(kind => deliveryKinds.includes(kind)), 'INVALID_JOB_KINDS');
      return inTransaction(pool, async client => {
        // Serialise this tiny claim step; no lock is held across external delivery.
        // This also enforces one live lease per member across all effect kinds.
        await client.query('SELECT pg_advisory_xact_lock(182745, 2)');
        const delivery = await client.query('SELECT NOT paused AND until_at <= clock_timestamp() AS allowed FROM sophie_core.discord_backoff WHERE singleton');
        requireCondition(delivery.rowCount === 1, 'DELIVERY_BARRIER_MISSING');
        if (!delivery.rows[0].allowed) return null;
        const result = await client.query(`WITH candidate AS (
          SELECT o.guild_id, o.operation_id FROM sophie_core.outbox o
          WHERE ((o.status = 'ready' AND o.available_at <= clock_timestamp())
              OR (o.status = 'leased' AND o.lease_until <= clock_timestamp()))
            AND o.kind = ANY($3::text[])
            AND NOT EXISTS (SELECT 1 FROM sophie_core.gateway_lifecycle gateway
              WHERE gateway.guild_id = o.guild_id AND (gateway.status <> 'current' OR gateway.lease_until <= clock_timestamp()))
            AND NOT EXISTS (SELECT 1 FROM sophie_core.outbox busy
              WHERE busy.guild_id = o.guild_id AND busy.user_id = o.user_id
                AND busy.status = 'leased' AND busy.lease_until > clock_timestamp())
          ORDER BY o.available_at, o.created_at, o.operation_id
          LIMIT 1 FOR UPDATE OF o SKIP LOCKED
        ) UPDATE sophie_core.outbox o SET status = 'leased', lease_owner = $1,
          lease_until = clock_timestamp() + $2 * interval '1 millisecond',
          fence = o.fence + 1, attempts = o.attempts + 1
        FROM candidate c WHERE o.guild_id = c.guild_id AND o.operation_id = c.operation_id
        RETURNING o.guild_id, o.operation_id, o.user_id, o.fence, o.kind, o.attempts`, [owner, leaseMs, kinds]);
        if (!result.rowCount) return null;
        const row = result.rows[0];
        const claim = { guildId: row.guild_id, operationId: row.operation_id, owner, fence: row.fence };
        if (row.attempts > 10) {
          await finishClaim(client, claim, 'parked', 'ATTEMPT_LIMIT');
          await recordDeliveryFailure(client, claim);
          return { claim, userId: row.user_id, kind: row.kind, parked: true };
        }
        return { claim, userId: row.user_id, kind: row.kind, parked: false };
      });
    },
    async renew(claim, leaseMs = 30_000) {
      validateClaim(claim);
      requireInteger(leaseMs, 1_000, 120_000);
      const result = await pool.query(`UPDATE sophie_core.outbox
        SET lease_until = clock_timestamp() + $5 * interval '1 millisecond'
        WHERE guild_id = $1 AND operation_id = $2 AND lease_owner = $3 AND fence = $4
          AND status = 'leased' AND lease_until > clock_timestamp()`,
      [claim.guildId, claim.operationId, claim.owner, claim.fence, leaseMs]);
      requireCondition(result.rowCount === 1, 'OUTBOX_LEASE_LOST');
    },
    async retry(claim, code, retryAfterMs = 0) {
      requireCondition(['DELIVERY_UNCERTAIN', 'DISCORD_UNAVAILABLE', 'RATE_LIMITED'].includes(code), 'INVALID_RETRY_CODE');
      requireInteger(retryAfterMs, 0, 86_400_000);
      return inTransaction(pool, async client => {
        await lockClaim(client, claim);
        if (code === 'RATE_LIMITED') {
          await client.query(`UPDATE sophie_core.discord_backoff SET until_at = GREATEST(until_at,
            clock_timestamp() + $1 * interval '1 millisecond') WHERE singleton`, [retryAfterMs]);
        }
        const result = await client.query(`UPDATE sophie_core.outbox SET status = 'ready',
          lease_owner = NULL, lease_until = NULL,
          available_at = clock_timestamp() + GREATEST($6::double precision, LEAST(300000, power(2, attempts) * 1000)) * interval '1 millisecond',
          last_error_code = $5 WHERE guild_id = $1 AND operation_id = $2
            AND lease_owner = $3 AND fence = $4 AND lease_until > clock_timestamp()`,
        [claim.guildId, claim.operationId, claim.owner, claim.fence, code, retryAfterMs]);
        requireCondition(result.rowCount === 1, 'OUTBOX_LEASE_LOST');
        if (code === 'DELIVERY_UNCERTAIN') await recordDeliveryFailure(client, claim);
      });
    },
    async park(claim, code) {
      requireCondition([...commonParkedCodes, ...caseParkedCodes, ...onboardingParkedCodes, ...onboardingAlertParkedCodes, ...caseIntakeParkedCodes, ...caseReplyParkedCodes, ...automationParkedCodes, 'DISCORD_RATE_LIMIT_INVALID',
        'RECONCILIATION_REVIEW_REQUIRED', 'CASE_DM_UNCERTAIN', 'CASE_DM_UNTRUSTED'].includes(code), 'INVALID_PARK_CODE');
      return inTransaction(pool, async client => {
        await lockClaim(client, claim);
        if (code === 'DISCORD_RATE_LIMIT_INVALID') await client.query('UPDATE sophie_core.discord_backoff SET paused = true WHERE singleton');
        await finishClaim(client, claim, 'parked', code);
        await recordDeliveryFailure(client, claim);
      });
    },
    /** Successful progress can release a job for its next bounded role operation. */
    async continue(claim) {
      return inTransaction(pool, async client => {
        await lockClaim(client, claim);
        const result = await client.query(`UPDATE sophie_core.outbox SET status = 'ready',
          lease_owner = NULL, lease_until = NULL, available_at = clock_timestamp(), attempts = 0,
          last_error_code = NULL WHERE guild_id = $1 AND operation_id = $2 AND lease_owner = $3
            AND fence = $4 AND lease_until > clock_timestamp()`, [claim.guildId, claim.operationId, claim.owner, claim.fence]);
        requireCondition(result.rowCount === 1, 'OUTBOX_LEASE_LOST');
      });
    },
    async requireDeliveryReady(claim) {
      return inTransaction(pool, async client => {
        await lockClaim(client, claim);
        const result = await client.query('SELECT NOT paused AND until_at <= clock_timestamp() AS allowed FROM sophie_core.discord_backoff WHERE singleton');
        requireCondition(result.rowCount === 1 && result.rows[0].allowed, 'DISCORD_DELIVERY_PAUSED');
        const gateway = await client.query(`SELECT 1 FROM sophie_core.gateway_lifecycle WHERE guild_id = $1
          AND (status <> 'current' OR lease_until <= clock_timestamp())`, [claim.guildId]);
        requireCondition(gateway.rowCount === 0, 'GATEWAY_UNAVAILABLE');
      });
    },
    /** A server-imposed pause remains valid even if the reporting worker lost its job lease. */
    async deferDiscordDelivery(retryAfterMs) {
      requireInteger(retryAfterMs, 1, 86_400_000);
      const result = await pool.query(`UPDATE sophie_core.discord_backoff SET until_at = GREATEST(until_at,
        clock_timestamp() + $1 * interval '1 millisecond') WHERE singleton`, [retryAfterMs]);
      requireCondition(result.rowCount === 1, 'DELIVERY_BARRIER_MISSING');
    },
    async pauseDiscordDelivery() {
      const result = await pool.query('UPDATE sophie_core.discord_backoff SET paused = true WHERE singleton');
      requireCondition(result.rowCount === 1, 'DELIVERY_BARRIER_MISSING');
    },
  });
}
