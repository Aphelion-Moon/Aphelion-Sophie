import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { requireEditorRequestId } from '../../../modules/onboarding/authoring.js';
import { sameOverwrites } from '../../../modules/tickets/channel-policy.js';
import { sealedPermissionOverwrites } from '../discord/permission-channel-sealer.js';
import { permissionDigest } from '../runtime/permission-configuration.js';
import { buildPermissionChannelInventory } from './permission-channel-inventory.js';

const targets = (inventory, guildId, parentId) => inventory.channels.map(row => ({ caseId: row.caseId, target: {
  guildId, channelId: row.id, marker: row.marker, parentId,
} })).sort((a, b) => a.target.channelId.localeCompare(b.target.channelId));
const planHash = (plan, effects) => permissionDigest({ inventoryRevision: plan.inventory_revision, inventoryHash: plan.inventory_sha256,
  targets: effects.map(row => ({ caseId: row.case_id, target: row.target })) });

export async function readPermissionSealPlan(client, operationId) {
  const plan = (await client.query('SELECT * FROM sophie_control.maintenance_seal_plans WHERE operation_id=$1', [operationId])).rows[0];
  requireCondition(plan, 'PERMISSION_SEAL_NOT_FOUND');
  const effects = (await client.query('SELECT * FROM sophie_control.maintenance_seal_effects WHERE operation_id=$1 ORDER BY channel_id COLLATE "C"', [operationId])).rows;
  requireCondition(planHash(plan, effects) === plan.plan_sha256, 'PERMISSION_RECORD_CORRUPT');
  return { plan, effects };
}

/** Caller supplies an opaque-proof-verified fresh inventory, never a retained snapshot. */
export function requirePermissionSealInventory({ plan, effects, inventory, policy }) {
  requireCondition(effects.every(row => row.state === 'verified'), 'PERMISSION_SEAL_INCOMPLETE');
  requireCondition(inventory.blockers.length === 0, 'PERMISSION_INVENTORY_BLOCKED');
  const expected = targets(inventory, policy.guildId, policy.categoryId);
  requireCondition(planHash(plan, expected.map(row => ({ case_id: row.caseId, target: row.target }))) === plan.plan_sha256, 'PERMISSION_INVENTORY_STALE');
  requireCondition(inventory.channels.every(row => row.parentId === policy.categoryId &&
    sameOverwrites(row.overwrites, sealedPermissionOverwrites(policy.guildId, policy.botUserId))), 'PERMISSION_CHANNEL_NOT_SEALED');
}

/** Internal owner-only maintenance phase. No activation or runtime release path. */
export function createPermissionSealing({ transaction, held, inventoryReceipt, inventoryInputs, running, guildId, channelInventory, channelSealer }) {
  const validate = ({ operationId, generation }) => { requireEditorRequestId(operationId); requireInteger(generation, 1); };
  const adapters = () => requireCondition(channelInventory?.guildId === guildId && channelSealer?.guildId === guildId, 'TRUSTED_ADAPTERS_REQUIRED');
  async function load(client, gate, request, phases = ['sealing', 'sealed']) {
    const current = await held(client, gate, request.operationId, request.generation, phases);
    return { ...current, ...await readPermissionSealPlan(client, request.operationId) };
  }
  function receipt(current, duplicate = false) {
    return { operationId: current.operation.operation_id, generation: Number(current.operation.generation), phase: current.operation.phase,
      sha256: current.plan.plan_sha256, total: current.effects.length,
      states: Object.fromEntries(['planned', 'started', 'sent', 'uncertain', 'verified'].map(state => [state, current.effects.filter(row => row.state === state).length])),
      uncertain: current.effects.filter(row => row.had_uncertainty).length, canActivate: false, activation: 'not-started', duplicate };
  }
  function inventory(proof, inputs) {
    const observed = channelInventory.snapshot(proof, inputs.request);
    requireCondition(observed.guildId === guildId, 'FOREIGN_GUILD');
    return buildPermissionChannelInventory({ bindings: inputs.bindings, observed, candidate: inputs.candidate, runningPolicyVersion: running.casePolicy.version });
  }
  const sameInputs = (a, b) => requireCondition(permissionDigest(a) === permissionDigest(b), 'PERMISSION_INVENTORY_STALE');
  async function verifyEffect(request, effect) {
    const proof = await channelSealer.inspect(effect.target);
    return transaction(async (client, gate) => {
      const current = await load(client, gate, request, ['sealing']), row = current.effects.find(row => row.channel_id === effect.channel_id);
      requireCondition(row && row.state !== 'planned', 'MAINTENANCE_STALE');
      channelSealer.verify(proof, row.target);
      await client.query(`UPDATE sophie_control.maintenance_seal_effects SET state='verified',verified_at=clock_timestamp(),
        had_uncertainty=had_uncertainty OR state IN ('started','uncertain') WHERE operation_id=$1 AND channel_id=$2`, [request.operationId, row.channel_id]);
      return receipt(await load(client, gate, request));
    });
  }
  return Object.freeze({
    async planSealing({ operationId, generation, requestId, inventoryRevision, expectedInventoryHash, confirm }) {
      const request = { operationId, generation }; validate(request); adapters();
      for (const value of [requestId, expectedInventoryHash]) requireEditorRequestId(value);
      requireInteger(inventoryRevision, 1); requireCondition(confirm === true, 'CONFIRMATION_REQUIRED');
      const requestHash = permissionDigest({ ...request, inventoryRevision, expectedInventoryHash });
      const prepare = async (client, gate) => {
        const current = await held(client, gate, operationId, generation, ['held', 'sealing', 'sealed']);
        const prior = (await client.query('SELECT * FROM sophie_control.maintenance_seal_plans WHERE operation_id=$1', [operationId])).rows[0];
        if (prior) {
          requireCondition(prior.request_id === requestId && prior.request_sha256 === requestHash, 'MAINTENANCE_REQUEST_COLLISION');
          return { duplicate: receipt(await load(client, gate, request), true) };
        }
        requireCondition(current.operation.phase === 'held' && current.review.casePolicyChanged, 'PERMISSION_SEAL_NOT_REQUIRED');
        const saved = (await client.query('SELECT * FROM sophie_control.maintenance_inventories WHERE operation_id=$1 ORDER BY revision DESC LIMIT 1', [operationId])).rows[0];
        requireCondition(saved && saved.revision === inventoryRevision && saved.sha256 === expectedInventoryHash, 'PERMISSION_INVENTORY_STALE');
        inventoryReceipt(saved, generation);
        requireCondition(saved.inventory.blockers.length === 0, 'PERMISSION_INVENTORY_BLOCKED');
        return { saved, inputs: await inventoryInputs(client, current, request) };
      };
      const prepared = await transaction(prepare); if (prepared.duplicate) return prepared.duplicate;
      const proof = await channelInventory.read(prepared.inputs.request);
      return transaction(async (client, gate) => {
        const current = await prepare(client, gate); if (current.duplicate) return current.duplicate;
        sameInputs(current.inputs, prepared.inputs);
        const fresh = inventory(proof, current.inputs), { candidateHash, controlHash } = current.inputs.request.binding;
        requireCondition(permissionDigest({ candidateHash, controlHash, inventory: fresh }) === expectedInventoryHash, 'PERMISSION_INVENTORY_STALE');
        const effects = targets(fresh, guildId, current.inputs.candidate.casePolicy.categoryId);
        const plan = { inventory_revision: inventoryRevision, inventory_sha256: expectedInventoryHash };
        const hash = planHash(plan, effects.map(row => ({ case_id: row.caseId, target: row.target })));
        await client.query(`INSERT INTO sophie_control.maintenance_seal_plans
          (operation_id,inventory_revision,inventory_sha256,request_id,request_sha256,plan_sha256) VALUES ($1,$2,$3,$4,$5,$6)`,
        [operationId, inventoryRevision, expectedInventoryHash, requestId, requestHash, hash]);
        for (const row of effects) {
          await client.query('INSERT INTO sophie_control.maintenance_seal_effects (operation_id,channel_id,case_id,target) VALUES ($1,$2,$3,$4)', [operationId, row.target.channelId, row.caseId, row.target]);
          // Exclude confirmed channels before any external write, including newly found duplicates.
          await client.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [guildId, row.target.channelId]);
        }
        await client.query("UPDATE sophie_control.maintenance_operations SET phase='sealing' WHERE operation_id=$1", [operationId]);
        return receipt(await load(client, gate, request));
      });
    },
    async sealingStatus({ operationId, generation }) {
      const request = { operationId, generation };
      validate(request); return transaction(async (client, gate) => receipt(await load(client, gate, request)));
    },
    async sealNext({ operationId, generation }) {
      const request = { operationId, generation };
      validate(request); adapters();
      const selected = await transaction(async (client, gate) => {
        const current = await load(client, gate, request, ['sealing']);
        return { effect: current.effects.find(row => row.state === 'planned'), receipt: receipt(current) };
      });
      if (!selected.effect) return selected.receipt;
      const effect = selected.effect, proof = await channelSealer.prepare(effect.target);
      await transaction(async (client, gate) => {
        const current = await load(client, gate, request, ['sealing']);
        requireCondition(current.effects.find(row => row.channel_id === effect.channel_id)?.state === 'planned', 'PERMISSION_SEAL_BUSY');
        await client.query("UPDATE sophie_control.maintenance_seal_effects SET state='started' WHERE operation_id=$1 AND channel_id=$2", [request.operationId, effect.channel_id]);
      });
      let sent = false;
      try {
        await channelSealer.apply(proof, effect.target, () => transaction(async (client, gate) => {
          const current = await load(client, gate, request, ['sealing']);
          return current.effects.find(row => row.channel_id === effect.channel_id)?.state === 'started';
        }));
        sent = true;
      } finally {
        // A process loss before this commit leaves 'started', which is never resent.
        await transaction(async (client, gate) => {
          await load(client, gate, request, ['sealing', 'sealed']);
          await client.query(`UPDATE sophie_control.maintenance_seal_effects SET
            state=CASE WHEN state='verified' THEN state ELSE $3 END,
            had_uncertainty=had_uncertainty OR NOT $4, response_observed=response_observed OR $4
            WHERE operation_id=$1 AND channel_id=$2`, [request.operationId, effect.channel_id, sent ? 'sent' : 'uncertain', sent]);
        });
      }
      return verifyEffect(request, effect);
    },
    async recheckNextSeal({ operationId, generation }) {
      const request = { operationId, generation };
      validate(request); adapters();
      const current = await transaction((client, gate) => load(client, gate, request, ['sealing']));
      const effect = current.effects.find(row => ['started', 'sent', 'uncertain'].includes(row.state));
      return effect ? verifyEffect(request, effect) : receipt(current);
    },
    async finishSealing({ operationId, generation }) {
      const request = { operationId, generation };
      validate(request); adapters();
      const prepare = async (client, gate) => {
        const current = await load(client, gate, request);
        requireCondition(current.effects.every(row => row.state === 'verified'), 'PERMISSION_SEAL_INCOMPLETE');
        return { current, inputs: await inventoryInputs(client, current, request) };
      };
      const prepared = await transaction(prepare), proof = await channelInventory.read(prepared.inputs.request);
      return transaction(async (client, gate) => {
        const current = await prepare(client, gate); sameInputs(current.inputs, prepared.inputs);
        const fresh = inventory(proof, current.inputs);
        requirePermissionSealInventory({ ...current.current, inventory: fresh, policy: current.inputs.candidate.casePolicy });
        await client.query('UPDATE sophie_control.maintenance_seal_plans SET sealed_inventory_sha256=$2 WHERE operation_id=$1', [request.operationId, permissionDigest(fresh)]);
        await client.query("UPDATE sophie_control.maintenance_operations SET phase='sealed' WHERE operation_id=$1", [request.operationId]);
        return receipt(await load(client, gate, request));
      });
    },
  });
}
