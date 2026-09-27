import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { requireTicketCapacity } from '../../../modules/tickets/index.js';
import { enqueue } from './outbox.js';

/** Internal transaction helpers shared by public cases and the private Onboarding entry use case. */
export async function registerCasePolicy(client, policy) {
  requireCondition(policy !== null, 'CASE_CONFIGURATION_REQUIRED');
  await client.query('SELECT pg_advisory_xact_lock(182745, 4)');
  const latest = (await client.query('SELECT max(version) AS version FROM sophie_core.case_policies WHERE guild_id = $1', [policy.guildId])).rows[0].version;
  requireCondition(latest === null || latest <= policy.version, 'CASE_POLICY_CHANGED');
  await client.query('INSERT INTO sophie_core.case_policies (guild_id, version, policy) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [policy.guildId, policy.version, policy]);
  const recorded = (await client.query('SELECT policy = $3::jsonb AS same FROM sophie_core.case_policies WHERE guild_id = $1 AND version = $2', [policy.guildId, policy.version, policy])).rows[0];
  requireCondition(recorded.same, 'CASE_POLICY_IMMUTABLE');
}

/** Shared admission budget for new cases and explicit reopening; never for worker retries. */
export async function requireCaseCapacity(client, member, { limits, clock, excludeId = null }) {
  await client.query('INSERT INTO sophie_core.case_budgets (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [member.guildId]);
  await client.query('SELECT guild_id FROM sophie_core.case_budgets WHERE guild_id = $1 FOR UPDATE', [member.guildId]);
  const counts = (await client.query(`SELECT
    count(*) FILTER (WHERE user_id = $2 AND state IN ('pending', 'open', 'closing') AND id IS DISTINCT FROM $3)::integer AS member_open,
    count(*) FILTER (WHERE state = 'pending' AND id IS DISTINCT FROM $3)::integer AS guild_pending,
    max(created_at_ms) FILTER (WHERE user_id = $2) AS last_created
    FROM sophie_core.case_reservations WHERE guild_id = $1`, [member.guildId, member.userId, excludeId])).rows[0];
  const reopen = (await client.query(`SELECT max(a.requested_at_ms) AS requested FROM sophie_core.case_lifecycle_actions a
    JOIN sophie_core.case_reservations r ON r.id = a.case_id AND r.guild_id = a.guild_id
    WHERE a.guild_id = $1 AND r.user_id = $2 AND a.action = 'reopen'`, [member.guildId, member.userId])).rows[0].requested;
  const last = [counts.last_created, reopen].filter(value => value !== null).map(Number);
  requireTicketCapacity({ memberOpen: counts.member_open, guildPending: counts.guild_pending,
    lastCreatedAt: last.length ? Math.max(...last) : null }, limits, clock());
}

/** Caller already owns the member lock, current authorization and immutable policy check. */
export async function reserveCaseRecords(client, member, { id, type, limits, policy, clock }) {
  await requireCaseCapacity(client, member, { limits, clock });
  await client.query(`INSERT INTO sophie_core.case_reservations (id, guild_id, user_id, type, state, created_at_ms)
    VALUES ($1, $2, $3, $4, 'pending', $5)`, [id, member.guildId, member.userId, type, clock()]);
  await client.query(`INSERT INTO sophie_core.case_provisions (case_id, guild_id, policy_version, operation_token, presence_epoch)
    VALUES ($1, $2, $3, $4, $5)`, [id, member.guildId, policy.version, randomBytes(24).toString('hex'), member.presenceEpoch]);
  await enqueue(client, { kind: 'case.provision', operationId: `case.${id}`, guildId: member.guildId, userId: member.userId, caseId: id, type });
}
