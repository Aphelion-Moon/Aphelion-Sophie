import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { requireAuthToken, validateDashboardAuth } from '../../../contracts/dashboard-auth.js';
import { inTransaction } from './transaction.js';
import { dashboardReturnPath } from '../../../contracts/dashboard-navigation.js';

/** Authentication data only: no case access, provider tokens, profile fields or permission snapshots. */
export function createDashboardAuthStore({ pool, configuration, clock }) {
  validateDashboardAuth(configuration); requireCondition(typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const fixed = structuredClone(configuration), claims = new WeakMap();
  async function policy(client, register = false) {
    if (register) {
      await client.query('INSERT INTO sophie_core.dashboard_auth_limits (guild_id) VALUES ($1) ON CONFLICT DO NOTHING', [fixed.guildId]);
      await client.query('SELECT guild_id FROM sophie_core.dashboard_auth_limits WHERE guild_id = $1 FOR UPDATE', [fixed.guildId]);
    }
    const latest = (await client.query('SELECT version, policy = $2::jsonb AS same FROM sophie_core.dashboard_auth_policies WHERE guild_id = $1 ORDER BY version DESC LIMIT 1',
      [fixed.guildId, fixed])).rows[0];
    requireCondition(!latest || latest.version <= fixed.version, 'DASHBOARD_POLICY_CHANGED');
    if (register && (!latest || latest.version < fixed.version)) {
      await client.query('INSERT INTO sophie_core.dashboard_auth_policies (guild_id, version, policy) VALUES ($1, $2, $3)', [fixed.guildId, fixed.version, fixed]);
    } else requireCondition(latest?.version === fixed.version && latest.same, 'DASHBOARD_POLICY_CHANGED');
  }
  return Object.freeze({
    async beginFlow({ stateHash, bindingHash, previousBindingHash = null, returnPath = '/' }) {
      dashboardReturnPath(returnPath);
      requireAuthToken(stateHash); requireAuthToken(bindingHash); if (previousBindingHash !== null) requireAuthToken(previousBindingHash);
      return inTransaction(pool, async client => {
        await policy(client, true);
        const allowed = (await client.query('SELECT not_before <= clock_timestamp() AS allowed FROM sophie_core.dashboard_auth_limits WHERE guild_id = $1', [fixed.guildId])).rows[0].allowed;
        requireCondition(allowed, 'DASHBOARD_LOGIN_BUSY');
        let slot = (await client.query(`SELECT slot FROM sophie_core.dashboard_login_flows WHERE guild_id = $1
          AND (policy_version <> $3 OR expires_at <= clock_timestamp() OR phase = 'complete' OR binding_hash = $2) ORDER BY slot LIMIT 1`, [fixed.guildId, previousBindingHash, fixed.version])).rows[0]?.slot;
        if (slot === undefined) slot = (await client.query(`SELECT n AS slot FROM generate_series(1, 64) n WHERE NOT EXISTS
          (SELECT 1 FROM sophie_core.dashboard_login_flows WHERE guild_id = $1 AND slot = n) ORDER BY n LIMIT 1`, [fixed.guildId])).rows[0]?.slot;
        requireCondition(slot !== undefined, 'DASHBOARD_LOGIN_BUSY');
        await client.query(`INSERT INTO sophie_core.dashboard_login_flows (guild_id, slot, policy_version, state_hash, binding_hash, expires_at, phase, return_path)
          VALUES ($1, $2, $3, $4, $5, clock_timestamp() + interval '5 minutes', 'pending', $6) ON CONFLICT (guild_id, slot) DO UPDATE SET
          policy_version = EXCLUDED.policy_version, state_hash = EXCLUDED.state_hash, binding_hash = EXCLUDED.binding_hash,
          expires_at = EXCLUDED.expires_at, phase = 'pending', return_path = EXCLUDED.return_path`, [fixed.guildId, slot, fixed.version, stateHash, bindingHash, returnPath]);
        await client.query("UPDATE sophie_core.dashboard_auth_limits SET not_before = clock_timestamp() + interval '2 seconds' WHERE guild_id = $1", [fixed.guildId]);
      });
    },
    async consumeFlow({ stateHash, bindingHash }) {
      requireAuthToken(stateHash); requireAuthToken(bindingHash);
      const returnPath = await inTransaction(pool, async client => {
        await policy(client, true);
        const result = await client.query(`UPDATE sophie_core.dashboard_login_flows SET phase = 'consumed'
          WHERE guild_id = $1 AND policy_version = $2 AND state_hash = $3 AND binding_hash = $4
            AND phase = 'pending' AND expires_at > clock_timestamp() RETURNING return_path`, [fixed.guildId, fixed.version, stateHash, bindingHash]);
        requireCondition(result.rowCount === 1, 'DASHBOARD_LOGIN_INVALID');
        return dashboardReturnPath(result.rows[0].return_path);
      });
      const claim = Object.freeze({}); claims.set(claim, { stateHash, returnPath }); return claim;
    },
    async finishLogin({ claim, observation, tokenHash, previousTokenHash = null }) {
      const held = claims.get(claim); claims.delete(claim);
      requireCondition(held !== undefined, 'DASHBOARD_LOGIN_INVALID'); const { stateHash, returnPath } = held; requireAuthToken(tokenHash);
      if (previousTokenHash !== null) requireAuthToken(previousTokenHash);
      requireId(observation.userId); requireCondition(observation.guildId === fixed.guildId && observation.present && !observation.bot, 'OPERATION_DENIED');
      return inTransaction(pool, async client => {
        await policy(client, true);
        const consumed = await client.query(`UPDATE sophie_core.dashboard_login_flows SET phase = 'complete' WHERE guild_id = $1
          AND policy_version = $2 AND state_hash = $3 AND phase = 'consumed' AND expires_at > clock_timestamp()`, [fixed.guildId, fixed.version, stateHash]);
        requireCondition(consumed.rowCount === 1, 'DASHBOARD_LOGIN_INVALID');
        const own = (await client.query(`SELECT slot FROM sophie_core.dashboard_sessions WHERE guild_id = $1 AND user_id = $2
          AND policy_version = $3 AND NOT revoked AND expires_at > clock_timestamp() ORDER BY issued_at, slot`, [fixed.guildId, observation.userId, fixed.version])).rows;
        let slot = own.length >= 8 ? own[0].slot : (await client.query(`SELECT slot FROM sophie_core.dashboard_sessions WHERE guild_id = $1
          AND (policy_version <> $3 OR revoked OR expires_at <= clock_timestamp() OR token_hash = $2) ORDER BY slot LIMIT 1`, [fixed.guildId, previousTokenHash, fixed.version])).rows[0]?.slot;
        if (slot === undefined) slot = (await client.query(`SELECT n AS slot FROM generate_series(1, 256) n WHERE NOT EXISTS
          (SELECT 1 FROM sophie_core.dashboard_sessions WHERE guild_id = $1 AND slot = n) ORDER BY n LIMIT 1`, [fixed.guildId])).rows[0]?.slot;
        requireCondition(slot !== undefined, 'DASHBOARD_LOGIN_BUSY');
        // Rotate every successful login, including a browser that already held a session.
        if (previousTokenHash !== null) await client.query('UPDATE sophie_core.dashboard_sessions SET revoked = true WHERE guild_id = $1 AND token_hash = $2', [fixed.guildId, previousTokenHash]);
        requireFreshObservation(observation, clock());
        await client.query(`INSERT INTO sophie_core.dashboard_sessions (guild_id, slot, policy_version, user_id, token_hash, expires_at)
          VALUES ($1, $2, $3, $4, $5, clock_timestamp() + interval '1 hour') ON CONFLICT (guild_id, slot) DO UPDATE SET
          policy_version = EXCLUDED.policy_version, user_id = EXCLUDED.user_id, token_hash = EXCLUDED.token_hash,
          issued_at = clock_timestamp(), expires_at = EXCLUDED.expires_at, revoked = false`, [fixed.guildId, slot, fixed.version, observation.userId, tokenHash]);
        return { returnPath };
      });
    },
    async readSession(tokenHash) {
      requireAuthToken(tokenHash);
      return inTransaction(pool, async client => {
        await policy(client);
        const row = (await client.query(`SELECT user_id FROM sophie_core.dashboard_sessions WHERE guild_id = $1 AND policy_version = $2
          AND token_hash = $3 AND NOT revoked AND expires_at > clock_timestamp() AND issued_at + interval '12 hours' > clock_timestamp()`, [fixed.guildId, fixed.version, tokenHash])).rows[0];
        requireCondition(row !== undefined, 'DASHBOARD_SESSION_INVALID'); return { guildId: fixed.guildId, userId: row.user_id };
      });
    },
    async refreshSession(tokenHash) {
      requireAuthToken(tokenHash);
      return inTransaction(pool, async client => {
        await policy(client);
        const result = await client.query(`UPDATE sophie_core.dashboard_sessions
          SET expires_at = LEAST(issued_at + interval '12 hours', clock_timestamp() + interval '1 hour')
          WHERE guild_id=$1 AND policy_version=$2 AND token_hash=$3 AND NOT revoked
            AND expires_at > clock_timestamp() AND issued_at + interval '12 hours' > clock_timestamp()
          RETURNING LEAST(3600, GREATEST(0, floor(extract(epoch FROM expires_at - clock_timestamp()))::int)) AS max_age`, [fixed.guildId, fixed.version, tokenHash]);
        requireCondition(result.rowCount === 1 && result.rows[0].max_age > 0, 'DASHBOARD_SESSION_INVALID');
        return result.rows[0].max_age;
      });
    },
    async revokeSession(tokenHash) {
      requireAuthToken(tokenHash);
      await pool.query('UPDATE sophie_core.dashboard_sessions SET revoked = true WHERE guild_id = $1 AND token_hash = $2', [fixed.guildId, tokenHash]);
    },
  });
}
