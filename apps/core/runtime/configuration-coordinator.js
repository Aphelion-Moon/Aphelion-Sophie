import { requireCondition } from '../../../contracts/validation.js';
import { requireConfiguredCapability } from '../../../platform/authorization/actor-policy.js';
import { requireOwnedRoleChange } from '../../../modules/membership/discord-policy.js';
import { permissionDigest } from './permission-configuration.js';
import { createConfigurationApplicationStore } from '../storage/configuration-application.js';
import { createPermissionMaintenance } from '../storage/runtime-maintenance.js';
import { createPermissionChannelInventory } from '../discord/permission-channel-inventory.js';
import { createPermissionChannelSealer } from '../discord/permission-channel-sealer.js';
import { createDiscordRoles } from '../discord/roles.js';
import { createConfigurationMemberMigration } from '../storage/configuration-members.js';
import { createConfigurationReconciliation } from './configuration-reconciliation.js';

/** One bounded durable phase per turn. Effects stay behind the retained owner barrier. */
export function createConfigurationCoordinator({ pool, configuration, transport, stopRuntime, clock = Date.now }) {
  const store = createConfigurationApplicationStore({pool,configuration});
  const id = (operationId,label) => permissionDigest({operationId,label});
  return Object.freeze({ configuration:store.configuration, pending:store.pending,
    async runOnce() {
      return store.exclusive(async()=>{
        const request=await store.pending();if(!request)return {state:'idle'};
        if(request.state==='blocked')return {state:'blocked'};
        const operationId=request.request_id;
        let held=false;
        try {
          const running=await store.configuration();
          const journal=await store.prepare(request,running);
          const previous={...running,...journal.base_configuration},candidate={...running,...journal.candidate_configuration};
          // A process can die after acquiring the barrier but before recording its phase.
          held=journal.generation!==null || !!(await pool.query('SELECT 1 FROM sophie_control.runtime_gate WHERE operation_id=$1',[operationId])).rowCount;
          const continuity=()=>held?store.held(operationId):Promise.resolve(`configuration.prepare.${operationId}`);
          const oldRoles=createDiscordRoles({transport,mapping:previous.mapping,clock,readContinuity:continuity});
          const newRoles=createDiscordRoles({transport,mapping:candidate.mapping,clock,readContinuity:continuity});
          const authorize=async()=>{
            const observation=await oldRoles.observeActor(request.operator_grant.userId);
            for(const policy of [previous.capabilityPolicy,candidate.capabilityPolicy])requireConfiguredCapability(policy,'permissions.publish',observation,clock());
            return true;
          };
          await authorize();
          // Validate every owned target, even if the guild currently has no affected members.
          const validation=await newRoles.prepare(request.operator_grant.userId);
          for(const change of ['add_crew','add_muzzled','add_whitelist'])requireOwnedRoleChange(validation.context,candidate.mapping,change,clock());
          await stopRuntime();
          if(await store.leaseActive())return {state:'waiting',phase:'stopping'};
          const inventory=createPermissionChannelInventory({transport,clock});
          const sealer=createPermissionChannelSealer({transport,roles:oldRoles,mapping:previous.mapping,clock});
          const maintenance=createPermissionMaintenance({pool,configuration:previous,channelInventory:inventory,channelSealer:sealer});
          const binding={operationId,generation:Number(journal.generation)};
          if(journal.phase==='preparing') {
            const receipt=await maintenance.begin({operationId,version:request.candidate_version,expectedHash:request.candidate_sha256,expectedReviewHash:request.review_sha256});
            held=true;await store.advance(operationId,'held',{generation:receipt.generation});return {state:'progressed',phase:'held'};
          }
          if(journal.phase==='held') {
            // Stable request identity recovers an inventory commit whose response was lost.
            const observed=await maintenance.inspectChannels({...binding,requestId:id(operationId,'inventory'),expectedRevision:0});
            requireCondition(observed.blockers.length===0,'PERMISSION_INVENTORY_BLOCKED');
            await store.advance(operationId,'sealing',{inventory_revision:observed.revision,inventory_sha256:observed.sha256});return {state:'progressed',phase:'sealing'};
          }
          const selection={...binding,requestId:id(operationId,'seal'),inventoryRevision:journal.inventory_revision,expectedInventoryHash:journal.inventory_sha256,confirm:true};
          if(journal.phase==='sealing') {
            const committed=(await pool.query('SELECT seal_plan_sha256 FROM sophie_control.maintenance_policy_applications WHERE operation_id=$1',[operationId])).rows[0];
            if(committed){await maintenance.policyApplication(binding);await store.advance(operationId,'policies',{seal_sha256:committed.seal_plan_sha256});return {state:'progressed',phase:'policies'};}
            let sealHash=journal.seal_sha256;
            if(candidate.casePolicy.version!==previous.casePolicy.version) {
              const state=await maintenance.planSealing(selection);
              if(state.states.planned){await authorize();await maintenance.sealNext(binding);return {state:'progressed',phase:'sealing'};}
              if(state.states.started||state.states.sent||state.states.uncertain){await maintenance.recheckNextSeal(binding);return {state:'progressed',phase:'sealing'};}
              sealHash=(await maintenance.finishSealing(binding)).sha256;
            }
            await authorize();
            await maintenance.applyPolicy({...selection,requestId:id(operationId,'policy'),expectedSealHash:sealHash});
            await store.advance(operationId,'policies',{seal_sha256:sealHash});return {state:'progressed',phase:'policies'};
          }
          if(journal.phase==='policies') {
            await store.invalidateMembers(operationId,journal.candidate_configuration,journal.base_configuration);
            return {state:'progressed',phase:'members'};
          }
          const members=createConfigurationMemberMigration({pool,operationId,previous:previous.mapping,candidate:candidate.mapping,
            transport,oldRoles,newRoles,held:store.held,authorize,clock});
          if(journal.phase==='members') {
            const state=await members.runOnce();if(state.state!=='complete')return state;
            await store.advance(operationId,'reconciling');return {state:'progressed',phase:'reconciling'};
          }
          requireCondition(journal.phase==='reconciling','MAINTENANCE_STALE');
          const enabled=async()=>{await store.held(operationId);return authorize();};
          const reconcile=createConfigurationReconciliation({pool,operationId,configuration:candidate,transport,roles:newRoles,enabled,clock});
          const jobs=await store.pendingJobs(operationId);
          requireCondition(jobs.every(row=>row.status!=='parked'),'PERMISSION_RECONCILIATION_BLOCKED');
          if(jobs.some(row=>row.status!=='done')){await reconcile.runOnce();return {state:'progressed',phase:'reconciling'};}
          if(!await members.verify()){await store.advance(operationId,'members');return {state:'progressed',phase:'members'};}
          const summary=await reconcile.verify();await authorize();
          await store.complete(operationId,journal.candidate_configuration,{...summary,capabilityVersion:candidate.capabilityPolicy.version,caseVersion:candidate.casePolicy.version});
          return {state:'applied',configuration:candidate};
        }catch(error){
          if(!held&&['PERMISSION_STALE','PERMISSION_BASE_STALE','PERMISSION_DEPLOYMENT_REVIEW_STALE','OPERATION_DENIED','ROLE_CONFIGURATION_INVALID','ROLE_HIERARCHY_BLOCKED','ROLE_OWNERSHIP_CONFLICT'].includes(error.code)) {
            await store.cancelBeforeHold(operationId,error.code);return {state:'cancelled',code:error.code};
          }
          await store.blocked(operationId,error.code);return {state:'blocked',code:error.code??'CONFIGURATION_UNAVAILABLE'};
        }
      });
    },
  });
}
