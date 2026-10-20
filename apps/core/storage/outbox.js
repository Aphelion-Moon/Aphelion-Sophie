import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../../contracts/validation.js';
import { inTransaction } from './transaction.js';
import { commonParkedCodes, caseParkedCodes, onboardingParkedCodes, onboardingAlertParkedCodes, caseIntakeParkedCodes, caseReplyParkedCodes, automationParkedCodes } from '../../../contracts/delivery-errors.js';
import { recordOnboardingDeliveryIssue } from './onboarding-issue-records.js';
import { recordCaseDeliveryIssue } from './case-issue-records.js';

const deliveryKinds = Object.freeze(['whitelist.grant', 'whitelist.reconcile', 'member.reconcile', 'case.provision', 'shuttle.render', 'shuttle.alert', 'case.intake', 'case.dm', 'case.reply', 'automation.dispatch']);

// Issues are recorded for history. Shuttle failures no longer ping Staff (owner direction, 20 October 2026): parked
// Shuttle work is rechecked on its own, see recheckParkedShuttleWork.
async function recordDeliveryFailure(client, claim) {
  await recordOnboardingDeliveryIssue(client, claim);
  await recordCaseDeliveryIssue(client, claim);
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
    lease_owner = NULL, lease_until = NULL, last_error_code = $6, parked_at = CASE WHEN $5 = 'parked' THEN clock_timestamp() END
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
          SELECT o.guild_id, o.operation_id, o.available_at FROM sophie_core.outbox o
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
        RETURNING o.guild_id, o.operation_id, o.user_id, o.fence, o.kind, o.attempts,
          CASE WHEN isfinite(c.available_at) THEN LEAST(86400000, GREATEST(0, floor(extract(epoch FROM clock_timestamp() - c.available_at) * 1000)))
            ELSE 0 END::bigint AS waited_ms`, [owner, leaseMs, kinds]);
        if (!result.rowCount) return null;
        const row = result.rows[0];
        const claim = { guildId: row.guild_id, operationId: row.operation_id, owner, fence: row.fence };
        if (row.attempts > 10) {
          await finishClaim(client, claim, 'parked', 'ATTEMPT_LIMIT');
          await recordDeliveryFailure(client, claim);
          return { claim, userId: row.user_id, kind: row.kind, parked: true };
        }
        // waitedMs (time since the job became claimable) is for timing diagnostics only.
        return { claim, userId: row.user_id, kind: row.kind, parked: false, waitedMs: Number(row.waited_ms) };
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
      requireCondition(['DELIVERY_UNCERTAIN', 'DISCORD_UNAVAILABLE', 'RATE_LIMITED', 'OBSERVATION_INVALIDATED'].includes(code), 'INVALID_RETRY_CODE');
      requireInteger(retryAfterMs, 0, 86_400_000);
      return inTransaction(pool, async client => {
        await lockClaim(client, claim);
        if (code === 'RATE_LIMITED') {
          await client.query(`UPDATE sophie_core.discord_backoff SET until_at = GREATEST(until_at,
            clock_timestamp() + $1 * interval '1 millisecond') WHERE singleton`, [retryAfterMs]);
        }
        const result = await client.query(`UPDATE sophie_core.outbox SET status = 'ready',
          lease_owner = NULL, lease_until = NULL,
          -- Overtaken reads (no write attempted) clear in moments; everything else backs off exponentially.
          available_at = clock_timestamp() + CASE WHEN $5 = 'OBSERVATION_INVALIDATED' THEN 250
            ELSE GREATEST($6::double precision, LEAST(300000, power(2, attempts) * 1000)) END * interval '1 millisecond',
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
    /**
     * No Shuttle work waits for Staff (owner direction, 20 October 2026). A parked Shuttle job is rechecked on its own
     * like a Staff recheck (new fence, fresh attempts): two minutes after it parks, doubling with each recheck up to
     * fifteen. A global rate-limit halt stays with the operator. Returns how many jobs were requeued.
     */
    async recheckParkedShuttleWork(limit = 20) {
      requireInteger(limit, 1, 100);
      const result = await pool.query(`UPDATE sophie_core.outbox o SET status = 'ready', available_at = clock_timestamp(), attempts = 0,
          fence = o.fence + 1, last_error_code = NULL, parked_at = NULL, auto_rechecks = o.auto_rechecks + 1
        FROM (SELECT guild_id, operation_id FROM sophie_core.outbox
          WHERE status = 'parked' AND last_error_code IS DISTINCT FROM 'DISCORD_RATE_LIMIT_INVALID'
            AND (kind IN ('whitelist.grant', 'whitelist.reconcile', 'shuttle.render') OR (kind = 'case.provision' AND effect->>'type' = 'shuttle'))
            AND parked_at <= clock_timestamp() - LEAST(900000, 120000 * power(2, LEAST(auto_rechecks, 3))) * interval '1 millisecond'
          ORDER BY parked_at LIMIT $1 FOR UPDATE SKIP LOCKED) due
        WHERE o.guild_id = due.guild_id AND o.operation_id = due.operation_id`, [limit]);
      return result.rowCount;
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
