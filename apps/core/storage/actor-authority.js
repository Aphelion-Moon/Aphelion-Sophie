import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { validateActorObservation, validateCapabilityPolicy } from '../../../platform/authorization/actor-policy.js';
import { inTransaction } from './transaction.js';
import { recordAiDeparture } from './ai-departures.js';

/** Records observed revocations. It does not make an offline interval authoritative. */
export function createActorAuthorityStore({ pool, clock }) {
  const registered = new Set();
  async function observe(observation, policyVersion) {
    validateActorObservation(observation, clock()); requireInteger(policyVersion, 1);
    const normalized = { ...observation, roleIds: [...observation.roleIds].sort() };
    return inTransaction(pool, async client => {
      const latest = (await client.query('SELECT max(version) AS version FROM sophie_core.capability_policies WHERE guild_id = $1', [observation.guildId])).rows[0].version;
      requireCondition(latest === policyVersion, 'CAPABILITY_POLICY_ROLLBACK');
      await client.query(`INSERT INTO sophie_core.actor_authority
        (guild_id, user_id, capability_epoch, policy_version, observation) VALUES ($1, $2, 1, $3, $4)
        ON CONFLICT DO NOTHING`, [observation.guildId, observation.userId, policyVersion, normalized]);
      const previous = (await client.query(`SELECT capability_epoch, presence_epoch, policy_version, observation FROM sophie_core.actor_authority
        WHERE guild_id = $1 AND user_id = $2 FOR UPDATE`, [observation.guildId, observation.userId])).rows[0];
      requireCondition(previous.policy_version <= policyVersion, 'CAPABILITY_POLICY_ROLLBACK');
      const stable = value => JSON.stringify([value.roleIds, value.present, value.bot, value.timedOut,
        value.administrator, value.guildOwner, value.highestRolePosition]);
      if (previous.observation.observedAt > observation.observedAt) {
        // Concurrent observers (dashboard checks, AI rechecks) can finish out of order. An older observation that agrees
        // with the newer stored one adds nothing: keep the stored record and its epochs. One that disagrees could
        // restore revoked authority, so it is still refused.
        requireCondition(stable(previous.observation) === stable(normalized) && previous.policy_version === policyVersion, 'OBSERVATION_OUT_OF_ORDER');
        return { grant: { guildId: observation.guildId, userId: observation.userId, capabilityEpoch: Number(previous.capability_epoch), policyVersion },
          presenceEpoch: Number(previous.presence_epoch) };
      }
      const changed = stable(previous.observation) !== stable(normalized) || previous.policy_version !== policyVersion;
      const epoch = Number(previous.capability_epoch) + (changed ? 1 : 0); requireInteger(epoch, 1);
      const lostPresence = previous.observation.present && (!normalized.present || (!previous.observation.bot && normalized.bot));
      const presenceEpoch = Number(previous.presence_epoch) + Number(lostPresence); requireInteger(presenceEpoch, 1);
      if (lostPresence && !normalized.present) await recordAiDeparture(client,observation.guildId,observation.userId);
      await client.query(`UPDATE sophie_core.actor_authority SET capability_epoch = $3, policy_version = $4, observation = $5, presence_epoch = $6
        WHERE guild_id = $1 AND user_id = $2`, [observation.guildId, observation.userId, epoch, policyVersion, normalized, presenceEpoch]);
      return { grant: { guildId: observation.guildId, userId: observation.userId, capabilityEpoch: epoch, policyVersion }, presenceEpoch };
    });
  }
  return Object.freeze({
    async registerPolicy(policy) {
      validateCapabilityPolicy(policy);
      // Once recorded, a policy version never changes (CAPABILITY_POLICY_IMMUTABLE), so a process registers each policy it
      // holds once. Every observation still checks that no newer version was recorded since (CAPABILITY_POLICY_ROLLBACK in
      // observe). It ran on every check before, under a lock all checks share (Activity audit, 24 October 2026).
      const key = JSON.stringify(policy);
      if (registered.has(key)) return;
      await inTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745, 3)');
        const latest = (await client.query('SELECT max(version) AS version FROM sophie_core.capability_policies WHERE guild_id = $1', [policy.guildId])).rows[0].version;
        requireCondition(latest === null || latest <= policy.version, 'CAPABILITY_POLICY_ROLLBACK');
        await client.query(`INSERT INTO sophie_core.capability_policies (guild_id, version, policy) VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING`, [policy.guildId, policy.version, policy]);
        const recorded = (await client.query('SELECT policy = $3::jsonb AS same FROM sophie_core.capability_policies WHERE guild_id = $1 AND version = $2', [policy.guildId, policy.version, policy])).rows[0];
        requireCondition(recorded.same, 'CAPABILITY_POLICY_IMMUTABLE');
      });
      if (registered.size >= 16) registered.clear();
      registered.add(key);
    },
    /** The member's recorded capability epoch and policy version, and the newest policy version recorded; null if none. */
    async recordedAuthority(guildId, userId) {
      const row = (await pool.query(`SELECT a.capability_epoch, a.policy_version,
        (SELECT max(version) FROM sophie_core.capability_policies p WHERE p.guild_id = a.guild_id) AS latest
        FROM sophie_core.actor_authority a WHERE a.guild_id = $1 AND a.user_id = $2`, [guildId, userId])).rows[0];
      return row ? { capabilityEpoch: Number(row.capability_epoch), policyVersion: Number(row.policy_version), latestPolicyVersion: Number(row.latest) } : null;
    },
    async observe(observation, policyVersion) { return (await observe(observation, policyVersion)).grant; },
    observeWithPresence: observe,
  });
}
