import { ContractError, requireId } from '../../../contracts/validation.js';
import { createMembership, observeMembership } from '../../../modules/membership/index.js';
import { inTransaction } from './transaction.js';
import { enqueue } from './outbox.js';

export async function lockMember(client, guildId, userId) {
  requireId(guildId); requireId(userId);
  await client.query('INSERT INTO sophie_core.members (guild_id, user_id, state) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [guildId, userId, createMembership(guildId, userId)]);
  return (await client.query('SELECT state FROM sophie_core.members WHERE guild_id = $1 AND user_id = $2 FOR UPDATE', [guildId, userId])).rows[0].state;
}

export async function saveMember(client, member) {
  await client.query('UPDATE sophie_core.members SET state = $3 WHERE guild_id = $1 AND user_id = $2', [member.guildId, member.userId, member]);
  await client.query(`UPDATE sophie_core.sessions SET current = false WHERE guild_id = $1 AND user_id = $2
    AND current AND (state->>'eligibilityEpoch')::bigint <> $3`, [member.guildId, member.userId, member.eligibilityEpoch]);
  const screens = await client.query(`UPDATE sophie_core.shuttle_screens SET current = false, ready = false
    WHERE guild_id = $1 AND user_id = $2 AND current AND
      ((snapshot->>'eligibilityEpoch')::bigint <> $3 OR access_epoch <> $4) RETURNING id`,
  [member.guildId, member.userId, member.eligibilityEpoch, member.accessEpoch]);
  for (const screen of screens.rows) await enqueue(client, { kind: 'shuttle.render',
    operationId: `screen.revoke.${screen.id}.${member.version}`, guildId: member.guildId, userId: member.userId, screenId: screen.id });
}

/** Shared lock order and revocation savepoint for membership, Onboarding and case use cases. */
export function createMemberOperation({ pool, clock }) {
  return async (observation, action) => {
    const outcome = await inTransaction(pool, async client => {
      const previous = await lockMember(client, observation.guildId, observation.userId);
      const member = observeMembership(previous, observation, clock());
      await saveMember(client, member);
      await client.query('SAVEPOINT domain_action');
      try { return { value: await action(client, member, previous) }; }
      catch (error) {
        if (!(error instanceof ContractError)) throw error;
        await client.query('ROLLBACK TO SAVEPOINT domain_action');
        return { failure: error.code };
      }
    });
    if (outcome.failure) throw new ContractError(outcome.failure);
    return outcome.value;
  };
}
