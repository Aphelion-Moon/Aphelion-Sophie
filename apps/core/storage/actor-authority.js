import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { validateActorObservation, validateCapabilityPolicy } from '../../../platform/authorization/actor-policy.js';
import { inTransaction } from './transaction.js';

/** Records observed revocations. It does not make an offline interval authoritative. */
export function createActorAuthorityStore({ pool, clock }) {
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
      requireCondition(previous.observation.observedAt <= observation.observedAt, 'OBSERVATION_OUT_OF_ORDER');
      const stable = value => JSON.stringify([value.roleIds, value.present, value.bot, value.timedOut,
        value.administrator, value.guildOwner, value.highestRolePosition]);
      const changed = stable(previous.observation) !== stable(normalized) || previous.policy_version !== policyVersion;
      const epoch = Number(previous.capability_epoch) + (changed ? 1 : 0); requireInteger(epoch, 1);
      const lostPresence = previous.observation.present && (!normalized.present || (!previous.observation.bot && normalized.bot));
      const presenceEpoch = Number(previous.presence_epoch) + Number(lostPresence); requireInteger(presenceEpoch, 1);
      await client.query(`UPDATE sophie_core.actor_authority SET capability_epoch = $3, policy_version = $4, observation = $5, presence_epoch = $6
        WHERE guild_id = $1 AND user_id = $2`, [observation.guildId, observation.userId, epoch, policyVersion, normalized, presenceEpoch]);
      return { grant: { guildId: observation.guildId, userId: observation.userId, capabilityEpoch: epoch, policyVersion }, presenceEpoch };
    });
  }
  return Object.freeze({
    async registerPolicy(policy) {
      validateCapabilityPolicy(policy);
      return inTransaction(pool, async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745, 3)');
        const latest = (await client.query('SELECT max(version) AS version FROM sophie_core.capability_policies WHERE guild_id = $1', [policy.guildId])).rows[0].version;
        requireCondition(latest === null || latest <= policy.version, 'CAPABILITY_POLICY_ROLLBACK');
        await client.query(`INSERT INTO sophie_core.capability_policies (guild_id, version, policy) VALUES ($1, $2, $3)
          ON CONFLICT DO NOTHING`, [policy.guildId, policy.version, policy]);
        const recorded = (await client.query('SELECT policy = $3::jsonb AS same FROM sophie_core.capability_policies WHERE guild_id = $1 AND version = $2', [policy.guildId, policy.version, policy])).rows[0];
        requireCondition(recorded.same, 'CAPABILITY_POLICY_IMMUTABLE');
      });
    },
    async observe(observation, policyVersion) { return (await observe(observation, policyVersion)).grant; },
    observeWithPresence: observe,
  });
}
