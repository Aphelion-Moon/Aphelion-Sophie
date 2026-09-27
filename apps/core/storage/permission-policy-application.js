import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { requireEditorRequestId } from '../../../modules/onboarding/authoring.js';
import { permissionDigest } from '../runtime/permission-configuration.js';
import { buildPermissionChannelInventory } from './permission-channel-inventory.js';
import { readPermissionSealPlan, requirePermissionSealInventory } from './permission-sealing.js';
import { registerCasePolicy } from './case-records.js';
import { registerCaseCaptureChannel, markCaseCapturePermissions } from './case-capture-coverage.js';
import { reviewPermissionDeployment } from './permission-deployment-review.js';
import { enqueue } from './outbox.js';

const recordHash = row => permissionDigest(Object.fromEntries([
  'operation_id', 'request_id', 'request_sha256', 'candidate_sha256', 'configuration_sha256', 'base_configuration', 'inventory_revision', 'inventory_sha256',
  'observed_inventory_sha256', 'seal_plan_sha256', 'control_before_sha256', 'control_after_sha256', 'reconciliation_jobs', 'summary',
].map(key => [key, row[key]])));

/** Applies reviewed policies under the owner barrier; it cannot release or start the runtime. */
export function createPermissionPolicyApplication({ transaction, held, candidateRecord, inventoryReceipt, inventoryInputs, running, guildId, channelInventory }) {
  const validate = ({ operationId, generation }) => { requireEditorRequestId(operationId); requireInteger(generation, 1); };
  async function applied(client, gate, request) {
    const operation = (await client.query('SELECT * FROM sophie_control.maintenance_operations WHERE operation_id=$1', [request.operationId])).rows[0];
    requireCondition(operation?.guild_id === guildId && gate.operation_id === request.operationId &&
      Number(operation.generation) === request.generation && Number(gate.generation) === request.generation, 'MAINTENANCE_STALE');
    const record = (await client.query('SELECT * FROM sophie_control.maintenance_policy_applications WHERE operation_id=$1', [request.operationId])).rows[0];
    if (!record) return null;
    requireCondition(operation.phase === 'policy-applied' && recordHash(record) === record.sha256, 'PERMISSION_RECORD_CORRUPT');
    requireCondition([permissionDigest(record.base_configuration), record.configuration_sha256].includes(permissionDigest(running)), 'PERMISSION_BASE_STALE');
    const candidate = await candidateRecord(client, operation.candidate_version, record.base_configuration);
    requireCondition(candidate.sha256 === record.candidate_sha256 && permissionDigest(candidate.candidate) === record.configuration_sha256 &&
      record.control_before_sha256 === operation.review_sha256, 'PERMISSION_RECORD_CORRUPT');
    return { operation, record };
  }
  function receipt({ operation, record }, duplicate = false) {
    return { operationId: operation.operation_id, generation: Number(operation.generation), phase: operation.phase,
      sha256: record.sha256, configurationHash: record.configuration_sha256, summary: record.summary,
      activation: 'reconciliation-required', canResume: false, duplicate };
  }
  return Object.freeze({
    async policyApplication({ operationId, generation }) {
      const request = { operationId, generation }; validate(request);
      return transaction(async (client, gate) => {
        const current = await applied(client, gate, request); requireCondition(current, 'PERMISSION_APPLICATION_NOT_FOUND'); return receipt(current);
      });
    },
    async applyPolicy({ operationId, generation, requestId, inventoryRevision, expectedInventoryHash, expectedSealHash = null, confirm }) {
      const request = { operationId, generation }; validate(request);
      for (const value of [requestId, expectedInventoryHash]) requireEditorRequestId(value);
      if (expectedSealHash !== null) requireEditorRequestId(expectedSealHash);
      requireInteger(inventoryRevision, 1); requireCondition(confirm === true, 'CONFIRMATION_REQUIRED');
      requireCondition(channelInventory?.guildId === guildId, 'TRUSTED_ADAPTERS_REQUIRED');
      const requestHash = permissionDigest({ ...request, inventoryRevision, expectedInventoryHash, expectedSealHash });
      const prepare = async (client, gate) => {
        const prior = await applied(client, gate, request);
        if (prior) {
          requireCondition(prior.record.request_id === requestId && prior.record.request_sha256 === requestHash, 'MAINTENANCE_REQUEST_COLLISION');
          return { duplicate: receipt(prior, true) };
        }
        const current = await held(client, gate, operationId, generation, ['held', 'sealed']);
        // These two control-only blockers can be resolved by complete, unambiguous fresh discovery below.
        const discovery = new Set(['created-channels-not-located', 'channel-selection-unresolved']);
        requireCondition(current.review.blockers.every(code => discovery.has(code)), 'PERMISSION_DEPLOYMENT_BLOCKED');
        const saved = (await client.query('SELECT * FROM sophie_control.maintenance_inventories WHERE operation_id=$1 ORDER BY revision DESC LIMIT 1', [operationId])).rows[0];
        requireCondition(saved?.revision === inventoryRevision && saved.sha256 === expectedInventoryHash, 'PERMISSION_INVENTORY_STALE');
        inventoryReceipt(saved, generation);
        requireCondition(saved.candidate_sha256 === current.row.sha256 && saved.control_sha256 === current.review.reviewHash, 'PERMISSION_INVENTORY_STALE');
        requireCondition(saved.inventory.blockers.length === 0, 'PERMISSION_INVENTORY_BLOCKED');
        let seal = null;
        if (current.review.casePolicyChanged) {
          requireCondition(current.operation.phase === 'sealed' && expectedSealHash !== null, 'PERMISSION_SEAL_REQUIRED');
          seal = await readPermissionSealPlan(client, operationId);
          requireCondition(seal.plan.plan_sha256 === expectedSealHash && seal.plan.inventory_revision === inventoryRevision &&
            seal.plan.inventory_sha256 === expectedInventoryHash && seal.plan.sealed_inventory_sha256 !== null, 'PERMISSION_INVENTORY_STALE');
        } else requireCondition(current.operation.phase === 'held' && expectedSealHash === null && saved.inventory.summary.discovered === 0, 'PERMISSION_SEAL_REQUIRED');
        const leases = (await client.query(`SELECT EXISTS (SELECT 1 FROM sophie_core.gateway_lifecycle WHERE lease_until>clock_timestamp()) OR
          EXISTS (SELECT 1 FROM sophie_core.outbox WHERE status='leased' AND lease_until>clock_timestamp()) OR
          EXISTS (SELECT 1 FROM sophie_core.case_attachment_jobs WHERE status='leased' AND lease_until>clock_timestamp()) AS active`)).rows[0];
        requireCondition(!leases.active, 'MAINTENANCE_ACTIVE_LEASES');
        return { current, saved, seal, inputs: await inventoryInputs(client, current, request) };
      };
      const prepared = await transaction(prepare); if (prepared.duplicate) return prepared.duplicate;
      const proof = await channelInventory.read(prepared.inputs.request);
      return transaction(async (client, gate) => {
        const latest = await prepare(client, gate); if (latest.duplicate) return latest.duplicate;
        requireCondition(permissionDigest(latest.inputs) === permissionDigest(prepared.inputs), 'PERMISSION_INVENTORY_STALE');
        const observed = channelInventory.snapshot(proof, latest.inputs.request);
        requireCondition(observed.guildId === guildId, 'FOREIGN_GUILD');
        const candidate = latest.inputs.candidate, changed = latest.current.review.casePolicyChanged;
        const inventory = buildPermissionChannelInventory({ bindings: latest.inputs.bindings, observed, candidate, runningPolicyVersion: running.casePolicy.version });
        requireCondition(inventory.blockers.length === 0, 'PERMISSION_INVENTORY_BLOCKED');
        if (changed) {
          requirePermissionSealInventory({ ...latest.seal, inventory, policy: candidate.casePolicy });
          requireCondition(permissionDigest(inventory) === latest.seal.plan.sealed_inventory_sha256, 'PERMISSION_INVENTORY_STALE');
        } else {
          const { candidateHash, controlHash } = latest.inputs.request.binding;
          requireCondition(permissionDigest({ candidateHash, controlHash, inventory }) === expectedInventoryHash, 'PERMISSION_INVENTORY_STALE');
        }
        // Serialised under the same owner barrier as sealing. Old policy rows are never rewritten.
        requireCondition(candidate.capabilityPolicy.version === running.capabilityPolicy.version + 1 &&
          candidate.casePolicy.version === running.casePolicy.version + Number(changed), 'PERMISSION_BASE_STALE');
        await registerCasePolicy(client, candidate.casePolicy);
        await client.query('INSERT INTO sophie_core.capability_policies (guild_id,version,policy) VALUES ($1,$2,$3)', [guildId, candidate.capabilityPolicy.version, candidate.capabilityPolicy]);
        const epochs = (await client.query('SELECT max(capability_epoch) AS maximum FROM sophie_core.actor_authority WHERE guild_id=$1', [guildId])).rows[0].maximum;
        requireCondition(epochs === null || BigInt(epochs) < BigInt(Number.MAX_SAFE_INTEGER), 'PERMISSION_EPOCH_EXHAUSTED');
        const authority = await client.query('UPDATE sophie_core.actor_authority SET capability_epoch=capability_epoch+1,policy_version=$2 WHERE guild_id=$1', [guildId, candidate.capabilityPolicy.version]);
        const at = Number((await client.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS at')).rows[0].at);
        let adopted = 0;
        const jobs = [];
        if (changed) {
          for (const channel of inventory.channels) {
            await client.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [guildId, channel.id]);
            const result = await client.query('INSERT INTO sophie_core.case_channels (guild_id,channel_id,case_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [guildId, channel.id, channel.caseId]);
            adopted += result.rowCount;
            const owner = (await client.query('SELECT case_id FROM sophie_core.case_channels WHERE guild_id=$1 AND channel_id=$2', [guildId, channel.id])).rows[0];
            requireCondition(owner?.case_id === channel.caseId, 'CASE_CHANNEL_COLLISION');
            const capture = await registerCaseCaptureChannel(client, { guildId, channelId: channel.id, caseId: channel.caseId, at });
            requireCondition(capture.deleted_at_ms === null, 'CASE_CAPTURE_CHANNEL_COLLISION');
            await markCaseCapturePermissions(client, guildId, { channelId: channel.id, from: at });
          }
          for (const row of inventory.cases) {
            requireInteger(row.version + 1, 1, 2_147_483_646); requireInteger(row.audienceVersion + 1, 1, 2_147_483_646);
            await client.query('UPDATE sophie_core.case_reservations SET version=version+1 WHERE guild_id=$1 AND id=$2', [guildId, row.caseId]);
            await client.query(`UPDATE sophie_core.case_provisions SET policy_version=$3,audience_version=audience_version+1,
              channel_id=$4,phase=CASE WHEN create_started THEN 'sealed' ELSE phase END WHERE guild_id=$1 AND case_id=$2`, [guildId, row.caseId, candidate.casePolicy.version, row.selectedChannelId]);
            if (row.createStarted) {
              const owner = (await client.query('SELECT user_id FROM sophie_core.case_reservations WHERE guild_id=$1 AND id=$2', [guildId, row.caseId])).rows[0];
              const operationId = `case.permission.${request.operationId}.${permissionDigest(row.caseId)}`;
              await enqueue(client, { kind: 'case.provision', operationId, guildId, userId: owner.user_id, caseId: row.caseId, type: row.type });
              jobs.push({ caseId: row.caseId, operationId });
            }
          }
        }
        const after = await reviewPermissionDeployment(client, { guildId, running: candidate, candidate,
          binding: { version: latest.current.row.version, revision: latest.current.row.revision, sha256: latest.current.row.sha256, status: latest.current.row.status } });
        // Fail atomically if the observation aged out while registering the complete retained set.
        channelInventory.snapshot(proof, latest.inputs.request);
        const summary = { casePolicyChanged: changed, capabilityPolicyVersion: candidate.capabilityPolicy.version, casePolicyVersion: candidate.casePolicy.version,
          casesMigrated: changed ? inventory.cases.length : 0, channelsAdopted: adopted, reconciliationJobs: jobs.length, authorityEpochsAdvanced: authority.rowCount };
        const record = { operation_id: operationId, request_id: requestId, request_sha256: requestHash, candidate_sha256: latest.current.row.sha256,
          configuration_sha256: permissionDigest(candidate), base_configuration: running, inventory_revision: inventoryRevision, inventory_sha256: expectedInventoryHash,
          observed_inventory_sha256: permissionDigest(inventory), seal_plan_sha256: expectedSealHash, control_before_sha256: latest.current.review.reviewHash,
          control_after_sha256: after.reviewHash, reconciliation_jobs: jobs, summary };
        record.sha256 = recordHash(record);
        await client.query(`INSERT INTO sophie_control.maintenance_policy_applications
          (operation_id,request_id,request_sha256,candidate_sha256,configuration_sha256,inventory_revision,inventory_sha256,
          observed_inventory_sha256,seal_plan_sha256,control_before_sha256,control_after_sha256,reconciliation_jobs,summary,sha256,base_configuration,database_actor)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,session_user)`, [operationId,requestId,requestHash,record.candidate_sha256,
          record.configuration_sha256,inventoryRevision,expectedInventoryHash,record.observed_inventory_sha256,expectedSealHash,
          record.control_before_sha256,record.control_after_sha256,JSON.stringify(jobs),summary,record.sha256,running]);
        await client.query("UPDATE sophie_control.maintenance_operations SET phase='policy-applied' WHERE operation_id=$1", [operationId]);
        return receipt(await applied(client, gate, request));
      });
    },
  });
}
