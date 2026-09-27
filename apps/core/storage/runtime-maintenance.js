import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { requireEditorRequestId } from '../../../modules/onboarding/authoring.js';
import { canonicalPermissions, permissionBase, permissionCandidate, permissionDigest } from '../runtime/permission-configuration.js';
import { reviewPermissionDeployment } from './permission-deployment-review.js';
import { createPermissionPolicyApplication } from './permission-policy-application.js';
import { createPermissionSealing } from './permission-sealing.js';
import { inTransaction } from './transaction.js';
import { readPermissionCaseBindings, buildPermissionChannelInventory } from './permission-channel-inventory.js';
import { recordCaseCaptureGap } from './case-capture-coverage.js';

export async function runtimeDatabaseAvailable(pool) {
  return (await pool.query('SELECT sophie_core.runtime_available() AS available')).rows[0]?.available === true;
}

/** Catalogue-only verification, without granting core access to owner control rows. */
export async function verifyRuntimeWriteGuards(pool) {
  const rows = (await pool.query(`SELECT c.relname, t.tgenabled, t.tgtype,
    p.prosecdef AND p.proowner=c.relowner AND fn.nspname='sophie_control' AND p.proname='guard_runtime_write' AS owned
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_trigger t ON t.tgrelid=c.oid AND t.tgname='runtime_write_guard' AND NOT t.tgisinternal
    LEFT JOIN pg_proc p ON p.oid=t.tgfoid LEFT JOIN pg_namespace fn ON fn.oid=p.pronamespace
    WHERE n.nspname='sophie_core' AND c.relkind='r'`)).rows;
  requireCondition(rows.length > 0 && rows.every(row => row.tgenabled === 'O' && row.tgtype === 62 && row.owned), 'RUNTIME_WRITE_GUARDS_INCOMPLETE');
}

const receipt = row => ({ operationId: row.operation_id, generation: Number(row.generation), phase: row.phase, activation: 'not-started' });

/** Owner-only preparation API, not a dashboard action or permission activation. */
export function createPermissionMaintenance({ pool, configuration, channelInventory = null, channelSealer = null }) {
  const fixed = structuredClone(configuration), running = permissionBase(fixed), guildId = fixed.mapping.guildId;
  const transaction = work => inTransaction(pool, async client => {
    const owner = (await client.query(`SELECT pg_has_role(session_user, relowner, 'USAGE') AS owned
      FROM pg_class WHERE oid='sophie_control.runtime_gate'::regclass`)).rows[0];
    requireCondition(owner?.owned === true, 'MAINTENANCE_OWNER_REQUIRED');
    // Matches the shared transaction lock acquired by every runtime DML trigger.
    await client.query('SELECT pg_advisory_xact_lock(182745,47)');
    const gate = (await client.query('SELECT * FROM sophie_control.runtime_gate WHERE singleton FOR UPDATE')).rows[0];
    requireCondition(gate, 'RUNTIME_WRITE_GUARDS_INCOMPLETE');
    return work(client, gate);
  });
  async function candidateRecord(client, version, base = fixed) {
    const row = (await client.query('SELECT * FROM sophie_core.permission_candidates WHERE guild_id=$1 AND version=$2', [guildId, version])).rows[0];
    requireCondition(row && row.status === 'published', 'PERMISSION_STALE');
    const latest = (await client.query('SELECT max(version) AS version FROM sophie_core.permission_candidates WHERE guild_id=$1', [guildId])).rows[0].version;
    requireCondition(latest === version && row.document.baseHash === permissionDigest(permissionBase(base)), 'PERMISSION_BASE_STALE');
    const candidate = permissionCandidate(canonicalPermissions(row.document, base), base);
    requireCondition(permissionDigest(candidate) === permissionDigest(row.candidate) &&
      permissionDigest({ document: row.document, candidate }) === row.sha256, 'PERMISSION_RECORD_CORRUPT');
    return row;
  }
  async function inspect(client, version) {
    const row = await candidateRecord(client, version), candidate = row.candidate;
    const review = await reviewPermissionDeployment(client, { guildId, running, candidate,
      binding: { version, revision: row.revision, sha256: row.sha256, status: row.status } });
    return { row, review };
  }
  async function held(client, gate, operationId, generation, phases = ['held']) {
    const row = (await client.query('SELECT * FROM sophie_control.maintenance_operations WHERE operation_id=$1', [operationId])).rows[0];
    requireCondition(row?.guild_id === guildId && phases.includes(row.phase) && gate.operation_id === operationId &&
      Number(gate.generation) === generation && Number(row.generation) === generation, 'MAINTENANCE_STALE');
    const inspected = await inspect(client, row.candidate_version);
    requireCondition(inspected.review.reviewHash === row.review_sha256, 'PERMISSION_DEPLOYMENT_REVIEW_STALE');
    return { operation: row, ...inspected };
  }
  function inventoryReceipt(row, generation) {
    requireCondition(permissionDigest({ candidateHash: row.candidate_sha256, controlHash: row.control_sha256, inventory: row.inventory }) === row.sha256, 'PERMISSION_RECORD_CORRUPT');
    return { operationId: row.operation_id, generation, revision: row.revision, sha256: row.sha256,
      createdAt: row.created_at.toISOString(), summary: row.inventory.summary, blockers: row.inventory.blockers,
      canActivate: false, activation: 'not-started' };
  }
  async function inventoryInputs(client, current, { operationId, generation }) {
    const bindings = await readPermissionCaseBindings(client, guildId), candidate = current.row.candidate;
    const request = { binding: { operationId, generation, candidateHash: current.row.sha256, controlHash: current.review.reviewHash },
      channelIds: [...new Set(bindings.flatMap(row => [...row.known_channels, row.channel_id, row.provision_channel_id, row.chosen_channel_id].filter(Boolean)))].sort(),
      categoryIds: [...new Set([running.casePolicy.categoryId, candidate.casePolicy.categoryId])].sort(),
      roleIds: [...new Set([candidate.mapping.staff, candidate.mapping.leadOps,
        ...Object.values(candidate.capabilityPolicy.grants).flat(), ...Object.values(candidate.capabilityPolicy.responders).flat()])].sort() };
    return { bindings, candidate, request };
  }
  return Object.freeze({
    ...createPermissionPolicyApplication({ transaction, held, candidateRecord, inventoryReceipt, inventoryInputs, running, guildId, channelInventory }),
    ...createPermissionSealing({ transaction, held, inventoryReceipt, inventoryInputs, running, guildId, channelInventory, channelSealer }),
    async begin({ operationId, version, expectedHash, expectedReviewHash }) {
      for (const value of [operationId, expectedHash, expectedReviewHash]) requireEditorRequestId(value);
      requireInteger(version, 1);
      const requestHash = permissionDigest({ guildId, running, version, expectedHash, expectedReviewHash });
      return transaction(async (client, gate) => {
        const prior = (await client.query('SELECT * FROM sophie_control.maintenance_operations WHERE operation_id=$1', [operationId])).rows[0];
        if (prior) { requireCondition(prior.request_sha256 === requestHash, 'MAINTENANCE_REQUEST_COLLISION'); return { ...receipt(prior), duplicate: true }; }
        requireCondition(gate.operation_id === null, 'RUNTIME_MAINTENANCE_ACTIVE');
        const leases = (await client.query(`SELECT EXISTS (SELECT 1 FROM sophie_core.gateway_lifecycle WHERE lease_until>clock_timestamp()) OR
          EXISTS (SELECT 1 FROM sophie_core.outbox WHERE status='leased' AND lease_until>clock_timestamp()) OR
          EXISTS (SELECT 1 FROM sophie_core.case_attachment_jobs WHERE status='leased' AND lease_until>clock_timestamp()) AS active`)).rows[0];
        requireCondition(!leases.active, 'MAINTENANCE_ACTIVE_LEASES');
        const { row, review } = await inspect(client, version);
        requireCondition(row.sha256 === expectedHash && review.reviewHash === expectedReviewHash, 'PERMISSION_DEPLOYMENT_REVIEW_STALE');
        const generation = Number(gate.generation) + 1; requireInteger(generation, 1);
        const operation = (await client.query(`INSERT INTO sophie_control.maintenance_operations
          (operation_id,guild_id,candidate_version,request_sha256,review_sha256,generation,phase,database_actor)
          VALUES ($1,$2,$3,$4,$5,$6,'held',session_user) RETURNING created_at`, [operationId, guildId, version, requestHash, expectedReviewHash, generation])).rows[0];
        // The capture interruption starts with the hold, not with later policy application.
        if ((await client.query('SELECT 1 FROM sophie_core.case_capture_channels WHERE guild_id=$1 LIMIT 1', [guildId])).rowCount)
          await recordCaseCaptureGap(client, { guildId, from: operation.created_at.getTime(), reason: 'permission-change' });
        await client.query('UPDATE sophie_control.runtime_gate SET generation=$1,operation_id=$2 WHERE singleton', [generation, operationId]);
        return { operationId, generation, phase: 'held', activation: 'not-started', duplicate: false };
      });
    },
    async inspectChannels({ operationId, generation, requestId, expectedRevision }) {
      for (const value of [operationId, requestId]) requireEditorRequestId(value);
      requireInteger(generation, 1); requireInteger(expectedRevision, 0, 2_147_483_646);
      requireCondition(channelInventory?.guildId === guildId, 'TRUSTED_ADAPTERS_REQUIRED');
      const requestHash = permissionDigest({ operationId, generation, expectedRevision });
      const prepare = async (client, gate) => {
        const current = await held(client, gate, operationId, generation);
        const prior = (await client.query('SELECT * FROM sophie_control.maintenance_inventories WHERE operation_id=$1 AND request_id=$2', [operationId, requestId])).rows[0];
        if (prior) {
          requireCondition(prior.request_sha256 === requestHash, 'MAINTENANCE_REQUEST_COLLISION');
          return { duplicate: { ...inventoryReceipt(prior, generation), duplicate: true } };
        }
        const latest = (await client.query('SELECT max(revision) AS revision FROM sophie_control.maintenance_inventories WHERE operation_id=$1', [operationId])).rows[0].revision ?? 0;
        requireCondition(latest === expectedRevision, 'PERMISSION_INVENTORY_STALE');
        return inventoryInputs(client, current, { operationId, generation });
      };
      const prepared = await transaction(prepare); if (prepared.duplicate) return prepared.duplicate;
      // No database lock is held across Discord I/O. Recheck the exact operation,
      // candidate, control snapshot and revision before retaining the observation.
      const proof = await channelInventory.read(prepared.request);
      return transaction(async (client, gate) => {
        const current = await prepare(client, gate); if (current.duplicate) return current.duplicate;
        requireCondition(permissionDigest(current.request) === permissionDigest(prepared.request) &&
          permissionDigest(current.bindings) === permissionDigest(prepared.bindings), 'PERMISSION_INVENTORY_STALE');
        const observed = channelInventory.snapshot(proof, current.request);
        requireCondition(observed.guildId === guildId, 'FOREIGN_GUILD');
        const inventory = buildPermissionChannelInventory({ bindings: current.bindings, observed, candidate: current.candidate, runningPolicyVersion: running.casePolicy.version });
        const revision = expectedRevision + 1, { candidateHash, controlHash } = current.request.binding;
        const sha256 = permissionDigest({ candidateHash, controlHash, inventory });
        const saved = (await client.query(`INSERT INTO sophie_control.maintenance_inventories
          (operation_id,revision,request_id,request_sha256,candidate_sha256,control_sha256,inventory,sha256)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [operationId, revision, requestId, requestHash, candidateHash, controlHash, inventory, sha256])).rows[0];
        return { ...inventoryReceipt(saved, generation), duplicate: false };
      });
    },
    async channelInventory({ operationId, revision }) {
      requireEditorRequestId(operationId); requireInteger(revision, 1, 2_147_483_647);
      return transaction(async client => {
        const operation = (await client.query('SELECT * FROM sophie_control.maintenance_operations WHERE operation_id=$1', [operationId])).rows[0];
        requireCondition(operation?.guild_id === guildId, 'MAINTENANCE_STALE');
        const row = (await client.query('SELECT * FROM sophie_control.maintenance_inventories WHERE operation_id=$1 AND revision=$2', [operationId, revision])).rows[0];
        requireCondition(row, 'PERMISSION_NOT_FOUND'); return inventoryReceipt(row, Number(operation.generation));
      });
    },
    // Available only before any activation work exists. A later activation phase
    // must never reuse this cancellation path to reopen access after side effects.
    async cancelPreparation({ operationId, generation }) {
      requireEditorRequestId(operationId); requireInteger(generation, 1);
      return transaction(async (client, gate) => {
        const row = (await client.query('SELECT * FROM sophie_control.maintenance_operations WHERE operation_id=$1', [operationId])).rows[0];
        requireCondition(row?.guild_id === guildId && Number(row.generation) === generation, 'MAINTENANCE_STALE');
        if (row.phase === 'cancelled') return { ...receipt(row), duplicate: true };
        requireCondition(row.phase === 'held' && gate.operation_id === operationId && Number(gate.generation) === generation, 'MAINTENANCE_STALE');
        const { review } = await inspect(client, row.candidate_version);
        requireCondition(review.reviewHash === row.review_sha256, 'PERMISSION_DEPLOYMENT_REVIEW_STALE');
        await client.query("UPDATE sophie_control.maintenance_operations SET phase='cancelled',cancelled_at=clock_timestamp() WHERE operation_id=$1", [operationId]);
        await client.query('UPDATE sophie_control.runtime_gate SET operation_id=NULL WHERE singleton');
        return { operationId, generation, phase: 'cancelled', activation: 'not-started', duplicate: false };
      });
    },
  });
}
