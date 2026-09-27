import { requireCondition, requireInteger, requireName } from '../../../contracts/validation.js';
import { createOutbox, lockClaim } from './outbox.js';
import { inTransaction } from './transaction.js';

/** Only the held owner's recorded case-reconciliation jobs may run without Gateway. */
export function createConfigurationCaseOutbox({ pool, operationId }) {
  const gate = async client => {
    const row=(await client.query(`SELECT pg_has_role(session_user,relowner,'USAGE') AS owned,
      EXISTS(SELECT 1 FROM sophie_control.runtime_gate WHERE singleton AND operation_id=$1) AS held
      FROM pg_class WHERE oid='sophie_control.runtime_gate'::regclass`,[operationId])).rows[0];
    requireCondition(row?.owned&&row.held,'MAINTENANCE_OWNER_REQUIRED');
  };
  return Object.freeze({ ...createOutbox({pool}),
    async claim(owner,leaseMs,kinds) {
      requireName(owner);requireInteger(leaseMs,1000,120000);
      requireCondition(kinds.length===1&&kinds[0]==='case.provision','WRONG_JOB_KIND');
      return inTransaction(pool,async client=>{
        await gate(client);await client.query('SELECT pg_advisory_xact_lock(182745,2)');
        const allowed=(await client.query('SELECT NOT paused AND until_at<=clock_timestamp() AS allowed FROM sophie_core.discord_backoff WHERE singleton')).rows[0]?.allowed;
        if(!allowed)return null;
        const result=await client.query(`WITH selected AS (
          SELECT o.guild_id,o.operation_id FROM sophie_core.outbox o JOIN sophie_control.maintenance_policy_applications a ON a.operation_id=$1
          WHERE o.kind='case.provision' AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.reconciliation_jobs) j WHERE j->>'operationId'=o.operation_id)
          AND ((o.status='ready' AND o.available_at<=clock_timestamp()) OR (o.status='leased' AND o.lease_until<=clock_timestamp()))
          ORDER BY o.operation_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED)
          UPDATE sophie_core.outbox o SET status='leased',lease_owner=$2,lease_until=clock_timestamp()+$3*interval '1 millisecond',fence=fence+1,attempts=attempts+1
          FROM selected s WHERE o.guild_id=s.guild_id AND o.operation_id=s.operation_id RETURNING o.*`,[operationId,owner,leaseMs]);
        const row=result.rows[0];if(!row)return null;
        requireCondition(row.attempts<=10,'PERMISSION_RECONCILIATION_LIMIT');
        return {claim:{guildId:row.guild_id,operationId:row.operation_id,owner,fence:row.fence},userId:row.user_id,kind:row.kind,parked:false};
      });
    },
    async requireDeliveryReady(claim) {
      await inTransaction(pool,async client=>{
        await gate(client);await lockClaim(client,claim);
        const allowed=(await client.query(`SELECT NOT b.paused AND b.until_at<=clock_timestamp() AS allowed
          FROM sophie_core.discord_backoff b,sophie_control.maintenance_policy_applications a
          WHERE b.singleton AND a.operation_id=$1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.reconciliation_jobs) j WHERE j->>'operationId'=$2)`,[operationId,claim.operationId])).rows[0]?.allowed;
        requireCondition(allowed,'DISCORD_DELIVERY_PAUSED');
      });
    },
  });
}
