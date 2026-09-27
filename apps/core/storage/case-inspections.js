import { createHash } from 'node:crypto';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { validateCasePolicy } from '../../../modules/tickets/channel-policy.js';
import { inTransaction } from './transaction.js';
import { registerCasePolicy } from './case-records.js';
import { enqueue } from './outbox.js';

/** Internal core scheduling only. Queueing is not proof that channel permissions were checked. */
export function createCaseInspectionStore({ pool, policy, batchSize = 5, intervalMs = 900_000, batchDelayMs = 10_000 }) {
  validateCasePolicy(policy); requireInteger(batchSize, 1, 25);
  requireInteger(intervalMs, 60_000, 86_400_000); requireInteger(batchDelayMs, 1_000, 60_000);
  const fixed = structuredClone(policy);
  return Object.freeze({
    async queueCaseInspections() {
      return inTransaction(pool, async client => {
        await client.query('INSERT INTO sophie_core.case_inspection_sweeps (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [fixed.guildId]);
        const sweep = (await client.query(`SELECT greatest(0, ceil(extract(epoch FROM (not_before - clock_timestamp())) * 1000)) AS wait_ms
          FROM sophie_core.case_inspection_sweeps WHERE guild_id = $1 FOR UPDATE`, [fixed.guildId])).rows[0];
        if (Number(sweep.wait_ms) > 0) return { status: 'waiting', waitMs: Number(sweep.wait_ms) };
        const barrier = (await client.query('SELECT NOT paused AND until_at <= clock_timestamp() AS ready FROM sophie_core.discord_backoff WHERE singleton')).rows[0];
        requireCondition(barrier !== undefined, 'DELIVERY_BARRIER_MISSING');
        const gateway = await client.query(`SELECT 1 FROM sophie_core.gateway_lifecycle WHERE guild_id = $1
          AND (status <> 'current' OR lease_until <= clock_timestamp())`, [fixed.guildId]);
        if (!barrier.ready || gateway.rowCount) return { status: 'paused' };
        const rows = (await client.query(`SELECT p.case_id, p.policy_version, p.inspection_revision, r.user_id, r.type
          FROM sophie_core.case_provisions p JOIN sophie_core.case_reservations r ON r.id = p.case_id AND r.guild_id = p.guild_id
          WHERE p.guild_id = $1 AND p.create_started AND r.onboarding_retirement IS DISTINCT FROM 'removed' AND p.next_inspection_at <= statement_timestamp()
          ORDER BY p.next_inspection_at, p.case_id COLLATE "C" LIMIT $2 FOR UPDATE OF p SKIP LOCKED`, [fixed.guildId, batchSize])).rows;
        // Follow delivery's provision-row -> policy lock order, never the reverse.
        await registerCasePolicy(client, fixed);
        const counts = { considered: rows.length, queued: 0, pending: 0, review: 0 };
        for (const row of rows) {
          const outstanding = (await client.query(`SELECT EXISTS (SELECT 1 FROM sophie_core.outbox
            WHERE guild_id = $1 AND kind = 'case.provision' AND effect->>'caseId' = $2 AND status = 'parked') AS review,
            EXISTS (SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND kind = 'case.provision'
              AND effect->>'caseId' = $2 AND status IN ('ready', 'leased')) AS pending`, [fixed.guildId, row.case_id])).rows[0];
          if (row.policy_version !== fixed.version || row.inspection_revision >= 2_147_483_646 || outstanding.review) counts.review++;
          else if (outstanding.pending) counts.pending++;
          else {
            const revision = row.inspection_revision + 1;
            const suffix = createHash('sha256').update(JSON.stringify([fixed.guildId, row.case_id, revision])).digest('hex');
            const operationId = `case.periodic.${suffix}`;
            await enqueue(client, { kind: 'case.provision', operationId, guildId: fixed.guildId,
              userId: row.user_id, caseId: row.case_id, type: row.type });
            await client.query(`UPDATE sophie_core.case_provisions SET inspection_revision = $2, last_inspection_operation_id = $3
              WHERE case_id = $1`, [row.case_id, revision, operationId]);
            counts.queued++;
          }
          // Moving all considered rows to the future keeps blocked cases from starving others.
          await client.query(`UPDATE sophie_core.case_provisions SET next_inspection_at = clock_timestamp() + $2 * interval '1 millisecond'
            WHERE case_id = $1`, [row.case_id, intervalMs]);
        }
        await client.query(`UPDATE sophie_core.case_inspection_sweeps SET not_before = clock_timestamp() + $2 * interval '1 millisecond',
          last_batch_at = clock_timestamp(), considered = $3, queued = $4, pending = $5, review = $6 WHERE guild_id = $1`,
        [fixed.guildId, batchDelayMs, counts.considered, counts.queued, counts.pending, counts.review]);
        return { status: counts.considered ? 'scheduled' : 'idle', ...counts, waitMs: batchDelayMs };
      });
    },
  });
}
