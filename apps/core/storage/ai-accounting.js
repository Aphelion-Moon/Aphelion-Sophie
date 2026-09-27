import { randomUUID } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { canonicalAiBudget, aiBudgetPeriods, aiReservationNanos, aiUsageCostNanos } from '../../../modules/assistant/budget.js';
import { inTransaction } from './transaction.js';

/** The trusted broker owns this store; the provider worker never receives its pool. */
export function createAiAccounting({ pool, guildId }) {
  requireId(guildId);
  const lock = client => client.query('SELECT pg_advisory_xact_lock(182745,56)');
  const now = async client => (await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
  const receipt = row => Object.freeze({ messageId: row.message_id, fence: row.fence });
  async function attempt(client, token) {
    requireId(token.messageId);
    requireCondition(typeof token.fence === 'string' && /^[a-f0-9-]{36}$/.test(token.fence), 'AI_FENCE_INVALID');
    return (await client.query('SELECT * FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND message_id=$2 AND fence=$3 FOR UPDATE',
      [guildId, token.messageId, token.fence])).rows[0] ?? null;
  }
  async function release(client, row) {
    await client.query('UPDATE sophie_ai.budget_periods SET reserved_nanos=reserved_nanos-$3 WHERE guild_id=$1 AND period=ANY($2)',
      [guildId, [row.month_period, row.day_period], row.reserved_nanos]);
    await client.query("UPDATE sophie_ai.provider_attempts SET state='released',updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2", [guildId, row.message_id]);
  }
  async function expire(client) {
    const rows = (await client.query("SELECT * FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND state='reserved' AND deadline<=clock_timestamp() FOR UPDATE", [guildId])).rows;
    for (const row of rows) await release(client, row);
    await client.query("UPDATE sophie_ai.provider_attempts SET state='uncertain',updated_at=clock_timestamp() WHERE guild_id=$1 AND state='dispatch_started' AND deadline<=clock_timestamp()", [guildId]);
  }
  return Object.freeze({
    async reserve({ local, bytes, outputTokens, deadline }) {
      requireId(local.messageId); requireInteger(local.controlEpoch); requireInteger(deadline);
      requireCondition(typeof local.inputRevision === 'string' && /^[a-f0-9]{64}$/.test(local.inputRevision) && typeof local.proactive === 'boolean', 'AI_ATTEMPT_INVALID');
      return inTransaction(pool, async client => {
        await lock(client); await expire(client);
        const at = await now(client), periods = aiBudgetPeriods(at);
        const active = (await client.query('SELECT * FROM sophie_ai.budget_policies WHERE guild_id=$1', [guildId])).rows[0];
        if (!active || active.held || deadline <= at || deadline > at + 15000) return null;
        const policy = canonicalAiBudget(active.document);
        if (policy.priceValidUntil === null || policy.priceValidUntil <= at) return null;
        const admitted = (await client.query(`SELECT r.* FROM sophie_ai.request_receipts r JOIN sophie_ai.state s USING(guild_id)
          WHERE r.guild_id=$1 AND r.message_id=$2 AND r.state='admitted' AND r.input_revision=$3 AND r.deadline>=to_timestamp($4/1000.0)
            AND NOT s.disabled AND s.epoch=$5`, [guildId, local.messageId, local.inputRevision, deadline, local.controlEpoch])).rows[0];
        if (!admitted || admitted.proactive !== local.proactive) return null;
        if ((await client.query('SELECT 1 FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND message_id=$2', [guildId, local.messageId])).rowCount) return null;
        const outstanding = Number((await client.query("SELECT count(*) AS count FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND state IN ('reserved','dispatch_started','uncertain')", [guildId])).rows[0].count);
        if (outstanding >= policy.maxUnresolved) return null;
        const amount = aiReservationNanos({ bytes, outputTokens }, policy);
        for (const period of [periods.month, periods.day]) await client.query('INSERT INTO sophie_ai.budget_periods(guild_id,period) VALUES($1,$2) ON CONFLICT DO NOTHING', [guildId, period]);
        const rows = (await client.query('SELECT * FROM sophie_ai.budget_periods WHERE guild_id=$1 AND period=ANY($2)', [guildId, [periods.month, periods.day]])).rows;
        for (const row of rows) {
          const cap = row.period === periods.month ? policy.monthlyLimitNanos : policy.dailyLimitNanos;
          const used = BigInt(row.reserved_nanos) + BigInt(row.settled_nanos);
          if (cap !== null && (used + amount > BigInt(cap) || local.proactive && used * 5n >= BigInt(cap) * 4n)) return null;
          if (row.period === periods.day && row.attempts >= policy.dailyAttempts) return null;
        }
        await client.query('UPDATE sophie_ai.budget_periods SET reserved_nanos=reserved_nanos+$3,attempts=attempts+1 WHERE guild_id=$1 AND period=ANY($2)',
          [guildId, [periods.month, periods.day], amount.toString()]);
        const row = (await client.query(`INSERT INTO sophie_ai.provider_attempts(guild_id,message_id,fence,state,policy_revision,price,month_period,day_period,control_epoch,input_revision,reserved_nanos,deadline,prompt_bytes,output_tokens)
          VALUES($1,$2,$3,'reserved',$4,$5,$6,$7,$8,$9,$10,to_timestamp($11/1000.0),$12,$13) RETURNING *`,
        [guildId, local.messageId, randomUUID(), active.revision, policy, periods.month, periods.day, local.controlEpoch, local.inputRevision, amount.toString(), deadline, bytes, outputTokens])).rows[0];
        return receipt(row);
      });
    },
    async dispatch(token) {
      return inTransaction(pool, async client => {
        await lock(client); const row = await attempt(client, token), at = await now(client);
        if (!row || row.state !== 'reserved' || row.deadline.getTime() <= at) return false;
        const periods = aiBudgetPeriods(at), price = canonicalAiBudget(row.price);
        if (periods.month !== row.month_period || periods.day !== row.day_period || price.priceValidUntil <= at) return false;
        const eligible = await client.query(`SELECT 1 FROM sophie_ai.state s JOIN sophie_ai.budget_policies p USING(guild_id)
          JOIN sophie_ai.request_receipts r USING(guild_id) WHERE s.guild_id=$1 AND NOT s.disabled AND s.epoch=$2
          AND p.revision=$3 AND NOT p.held AND r.message_id=$4 AND r.input_revision=$5 AND r.state='admitted' AND r.deadline>clock_timestamp()`,
        [guildId, row.control_epoch, row.policy_revision, row.message_id, row.input_revision]);
        if (!eligible.rowCount) return false;
        await client.query("UPDATE sophie_ai.provider_attempts SET state='dispatch_started',dispatch_at=clock_timestamp(),updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2", [guildId, row.message_id]);
        return true;
      });
    },
    async settle(token, usage, observation = {}) {
      return inTransaction(pool, async client => {
        await lock(client); const row = await attempt(client, token);
        if (!row || row.state !== 'dispatch_started' || row.deadline.getTime() <= await now(client)) return false;
        const cost = aiUsageCostNanos(usage, canonicalAiBudget(row.price));
        if (cost === null) return false;
        await client.query('UPDATE sophie_ai.budget_periods SET reserved_nanos=reserved_nanos-$3,settled_nanos=settled_nanos+$4 WHERE guild_id=$1 AND period=ANY($2)',
          [guildId, [row.month_period, row.day_period], row.reserved_nanos, cost.toString()]);
        const normalized = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'].map(key => [key, usage[key]]));
        const safeIdentity = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(value) ? value : null;
        await client.query("UPDATE sophie_ai.provider_attempts SET state='settled',settled_nanos=$3,usage=$4,model=$5,fingerprint=$6,settlement_basis='reported-usage-peak',updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2",
          [guildId, row.message_id, cost.toString(), normalized, safeIdentity(observation.model), safeIdentity(observation.fingerprint)]);
        if (cost > BigInt(row.reserved_nanos)) await client.query('UPDATE sophie_ai.budget_policies SET held=true WHERE guild_id=$1', [guildId]);
        return true;
      });
    },
    async finish(token, dispatchPossible) {
      return inTransaction(pool, async client => {
        await lock(client); const row = await attempt(client, token);
        if (!row || !['reserved', 'dispatch_started'].includes(row.state)) return;
        if (!dispatchPossible) await release(client, row);
        else await client.query("UPDATE sophie_ai.provider_attempts SET state='uncertain',updated_at=clock_timestamp() WHERE guild_id=$1 AND message_id=$2", [guildId, row.message_id]);
      });
    },
    async expire() { return inTransaction(pool, async client => { await lock(client); await expire(client); }); },
    async status() {
      return inTransaction(pool, async client => {
        await lock(client); await expire(client);
        const periods = aiBudgetPeriods(await now(client));
        const policy = (await client.query('SELECT revision,document,held FROM sophie_ai.budget_policies WHERE guild_id=$1', [guildId])).rows[0] ?? null;
        const balances = (await client.query('SELECT period,reserved_nanos,settled_nanos,attempts FROM sophie_ai.budget_periods WHERE guild_id=$1 AND period=ANY($2)', [guildId, [periods.month, periods.day]])).rows;
        const unresolved = (await client.query("SELECT count(*)::int AS attempts,COALESCE(sum(reserved_nanos),0)::text AS nanos FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND state='uncertain'", [guildId])).rows[0];
        const pending = (await client.query("SELECT message_id AS \"messageId\",fence,reserved_nanos AS nanos FROM sophie_ai.provider_attempts WHERE guild_id=$1 AND state='uncertain' ORDER BY updated_at LIMIT 4", [guildId])).rows;
        return { policy, balances, unresolved, pending, currency: 'USD', timezone: 'Europe/Vienna', accounting: 'conservative-peak-estimate' };
      });
    },
  });
}
