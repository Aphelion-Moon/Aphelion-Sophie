import { requireCondition } from '../../../contracts/validation.js';
import { canonicalPermissions, permissionBase, permissionCandidate, permissionDigest } from '../runtime/permission-configuration.js';
import { validateStagingRuntime } from '../runtime/configuration.js';
import { inTransaction } from './transaction.js';
import { invalidateMembership } from '../../../modules/membership/index.js';
import { saveMember } from './members.js';
import { gatewayMappingHash } from './gateway-journal.js';
import { requireUnquarantinedDatabase } from '../runtime/recovery.js';

/** Owner identity only. The HTTP runtime receives neither this pool nor this store. */
export function createConfigurationApplicationStore({ pool, configuration }) {
  const guildId = configuration.mapping.guildId;
  const owned = async client => requireCondition((await client.query("SELECT pg_has_role(session_user,relowner,'USAGE') AS owned FROM pg_class WHERE oid='sophie_control.runtime_gate'::regclass")).rows[0]?.owned, 'MAINTENANCE_OWNER_REQUIRED');
  const transaction = work => inTransaction(pool, async client => { await owned(client); return work(client); });
  return Object.freeze({
    async exclusive(work) {
      await requireUnquarantinedDatabase(pool);
      const client = await pool.connect(); let locked = false;
      try {
        await owned(client);
        locked = (await client.query('SELECT pg_try_advisory_lock(182745,55) AS locked')).rows[0].locked;
        return locked ? await work() : { state: 'busy' };
      } finally { if (locked) await client.query('SELECT pg_advisory_unlock(182745,55)'); client.release(); }
    },
    async configuration() {
      await owned(pool);
      const row = (await pool.query('SELECT configuration,sha256 FROM sophie_control.runtime_configuration WHERE guild_id=$1', [guildId])).rows[0];
      if (!row) return structuredClone(configuration);
      requireCondition(permissionDigest(row.configuration) === row.sha256, 'PERMISSION_RECORD_CORRUPT');
      const next = { ...structuredClone(configuration), ...row.configuration }; validateStagingRuntime(next); return next;
    },
    async pending() {
      await owned(pool);
      return (await pool.query(`SELECT a.*,j.phase,j.generation,j.inventory_revision,j.inventory_sha256,j.seal_sha256,
        j.base_configuration,j.candidate_configuration,j.member_cursor,j.member_scan_complete
        FROM sophie_core.permission_applications a LEFT JOIN sophie_control.configuration_applications j ON j.operation_id=a.request_id
        WHERE a.guild_id=$1 AND a.state IN ('queued','applying','blocked') ORDER BY a.created_at LIMIT 1`, [guildId])).rows[0] ?? null;
    },
    async prepare(request, running) {
      return transaction(async client => {
        const saved = (await client.query('SELECT * FROM sophie_control.configuration_applications WHERE operation_id=$1', [request.request_id])).rows[0];
        if (saved) return saved;
        const row = (await client.query('SELECT * FROM sophie_core.permission_candidates WHERE guild_id=$1 ORDER BY version DESC LIMIT 1', [guildId])).rows[0];
        requireCondition(row?.status === 'published' && row.version === request.candidate_version && row.sha256 === request.candidate_sha256, 'PERMISSION_STALE');
        requireCondition(row.document.baseHash === permissionDigest(permissionBase(running)), 'PERMISSION_BASE_STALE');
        const candidate = permissionCandidate(canonicalPermissions(row.document, running), running);
        requireCondition(permissionDigest(candidate) === permissionDigest(row.candidate) && permissionDigest({ document: row.document, candidate }) === row.sha256, 'PERMISSION_RECORD_CORRUPT');
        const result = await client.query(`INSERT INTO sophie_control.configuration_applications
          (operation_id,guild_id,request_id,base_configuration,candidate_configuration) VALUES ($1,$2,$1,$3,$4) RETURNING *`,
        [request.request_id,guildId,permissionBase(running),candidate]);
        await client.query("UPDATE sophie_core.permission_applications SET state='applying',updated_at=clock_timestamp() WHERE guild_id=$1 AND request_id=$2", [guildId,request.request_id]);
        return result.rows[0];
      });
    },
    async advance(operationId, phase, data = {}) {
      requireCondition(['held','sealing','policies','members','reconciling'].includes(phase), 'MAINTENANCE_STALE');
      const fields = ['generation','inventory_revision','inventory_sha256','seal_sha256'];
      requireCondition(Object.keys(data).every(key => fields.includes(key)), 'MAINTENANCE_STALE');
      return transaction(async client => {
        const entries = Object.entries(data);
        await client.query(`UPDATE sophie_control.configuration_applications SET phase=$2,error_code=NULL${entries.map(([key],i) => `,${key}=$${i+3}`).join('')} WHERE operation_id=$1`, [operationId,phase,...entries.map(([,v])=>v)]);
        await client.query("UPDATE sophie_core.permission_applications SET state='applying',summary=$3,updated_at=clock_timestamp() WHERE guild_id=$1 AND request_id=$2", [guildId,operationId,{phase}]);
      });
    },
    async blocked(operationId, code) {
      const safe = /^[A-Z_0-9]{1,80}$/.test(code ?? '') ? code : 'CONFIGURATION_UNAVAILABLE';
      await transaction(async client => {
        await client.query('UPDATE sophie_control.configuration_applications SET error_code=$2 WHERE operation_id=$1', [operationId,safe]);
        await client.query("UPDATE sophie_core.permission_applications SET state='blocked',summary=$3,updated_at=clock_timestamp() WHERE guild_id=$1 AND request_id=$2", [guildId,operationId,{ code: safe }]);
      });
    },
    async cancelBeforeHold(operationId, code) {
      await transaction(async client => {
        requireCondition(!(await client.query('SELECT 1 FROM sophie_control.maintenance_operations WHERE operation_id=$1', [operationId])).rowCount, 'MAINTENANCE_STALE');
        await client.query("UPDATE sophie_core.permission_applications SET state='cancelled',summary=$3,updated_at=clock_timestamp() WHERE guild_id=$1 AND request_id=$2", [guildId,operationId,{ code }]);
      });
    },
    async leaseActive() {
      return (await pool.query(`SELECT EXISTS(SELECT 1 FROM sophie_core.gateway_lifecycle WHERE lease_until>clock_timestamp()) OR
        EXISTS(SELECT 1 FROM sophie_core.outbox WHERE status='leased' AND lease_until>clock_timestamp()) AS active`)).rows[0].active;
    },
    async held(operationId) {
      await owned(pool);
      const row = (await pool.query('SELECT generation FROM sophie_control.runtime_gate WHERE singleton AND operation_id=$1', [operationId])).rows[0];
      requireCondition(row, 'MAINTENANCE_STALE'); return `configuration.${operationId}.${row.generation}`;
    },
    async invalidateMembers(operationId, candidate, previous) {
      return transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745,47)');
        const journal = (await client.query('SELECT phase FROM sophie_control.configuration_applications WHERE operation_id=$1 FOR UPDATE', [operationId])).rows[0];
        if (journal.phase !== 'policies') return;
        requireCondition((await client.query('SELECT 1 FROM sophie_control.runtime_gate WHERE singleton AND operation_id=$1', [operationId])).rowCount, 'MAINTENANCE_STALE');
        const changed = ['crew','muzzled','whitelist'].some(key=>candidate.mapping[key]!==previous.mapping[key]);
        if (changed) {
          const members = (await client.query('SELECT state FROM sophie_core.members WHERE guild_id=$1 FOR UPDATE', [guildId])).rows;
          for (const row of members) {
            const member = invalidateMembership(row.state, { eligibility: candidate.mapping.whitelist!==previous.mapping.whitelist, access: true, presence: false });
            // Old role observations must never be interpreted with new role meanings.
            member.observation = null;
            await saveMember(client,member);
          }
        }
        await client.query(`UPDATE sophie_core.gateway_lifecycle SET mapping_hash=$2,session_id=NULL,resume_url=NULL,sequence=NULL,
          continuity_epoch=continuity_epoch+1,status='offline',guild_available=false WHERE guild_id=$1 AND lease_until<=clock_timestamp()`, [guildId,gatewayMappingHash(candidate.mapping)]);
        await client.query("UPDATE sophie_control.configuration_applications SET phase='members',member_scan_complete=$2 WHERE operation_id=$1", [operationId,!changed]);
      });
    },
    async pendingJobs(operationId) {
      return (await pool.query(`SELECT o.status FROM sophie_core.outbox o JOIN sophie_control.maintenance_policy_applications a
        ON a.operation_id=$2 WHERE o.guild_id=$1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.reconciliation_jobs) j WHERE j->>'operationId'=o.operation_id)`, [guildId,operationId])).rows;
    },
    async complete(operationId, candidate, summary) {
      await transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(182745,47)');
        const journal = (await client.query('SELECT * FROM sophie_control.configuration_applications WHERE operation_id=$1 FOR UPDATE', [operationId])).rows[0];
        requireCondition(journal?.phase === 'reconciling' && journal.member_scan_complete && permissionDigest(journal.candidate_configuration) === permissionDigest(candidate), 'MAINTENANCE_STALE');
        requireCondition(!(await client.query('SELECT 1 FROM sophie_control.configuration_members WHERE operation_id=$1 AND (NOT verified OR pending_effect IS NOT NULL)', [operationId])).rowCount, 'MEMBERSHIP_MIGRATION_INCOMPLETE');
        requireCondition(!(await client.query("SELECT 1 FROM sophie_core.outbox WHERE guild_id=$1 AND kind='case.provision' AND status IN ('ready','leased','parked')", [guildId])).rowCount, 'PERMISSION_RECONCILIATION_INCOMPLETE');
        await client.query(`INSERT INTO sophie_control.runtime_configuration(guild_id,operation_id,configuration,sha256) VALUES ($1,$2,$3,$4)
          ON CONFLICT(guild_id) DO UPDATE SET operation_id=EXCLUDED.operation_id,configuration=EXCLUDED.configuration,sha256=EXCLUDED.sha256,updated_at=clock_timestamp()`, [guildId,operationId,candidate,permissionDigest(candidate)]);
        await client.query("UPDATE sophie_control.maintenance_operations SET phase='completed' WHERE operation_id=$1 AND phase='policy-applied'", [operationId]);
        const released = await client.query('UPDATE sophie_control.runtime_gate SET operation_id=NULL WHERE singleton AND operation_id=$1', [operationId]);
        requireCondition(released.rowCount===1,'MAINTENANCE_STALE');
        await client.query("UPDATE sophie_control.configuration_applications SET phase='completed',completed_at=clock_timestamp() WHERE operation_id=$1", [operationId]);
        await client.query("UPDATE sophie_core.permission_applications SET state='applied',summary=$3,updated_at=clock_timestamp() WHERE guild_id=$1 AND request_id=$2", [guildId,operationId,summary]);
      });
    },
  });
}
