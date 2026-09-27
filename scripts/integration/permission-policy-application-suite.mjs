import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { createOutbox } from '../../apps/core/storage/outbox.js';
import { createMemberOperation } from '../../apps/core/storage/members.js';
import { createCaseChannels } from '../../apps/core/discord/case-channels.js';
import { createCaseDispatcher } from '../../apps/core/discord/case-dispatcher.js';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { runtimeDatabaseAvailable } from '../../apps/core/storage/runtime-maintenance.js';
import { GUILD, USER, OTHER, STAFF } from '../../tests/fixtures/domain.js';
import { BYOND_ROLE } from '../../tests/fixtures/discord.js';

export async function runPermissionPolicyApplicationSuite(cluster,scenario) {
  async function request(f,change=true) {
    if(change) {
      const request=await f.sealRequest();let status=await f.maintenance.planSealing(request);
      while(status.states.planned)status=await f.maintenance.sealNext(request);
      const seal=await f.maintenance.finishSealing(request);
      return {...request,requestId:f.id(),expectedSealHash:seal.sha256};
    }
    const held=await f.maintenance.begin(await f.maintenanceRequest(d=>{d.grants['shuttle.publish']=[BYOND_ROLE];}));
    const inventory=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    return {...held,requestId:f.id(),inventoryRevision:inventory.revision,expectedInventoryHash:inventory.sha256,confirm:true};
  }
  const applications=f=>f.admin.query('SELECT * FROM sophie_control.maintenance_policy_applications').then(r=>r.rows);
  const candidate=f=>f.admin.query('SELECT candidate FROM sophie_core.permission_candidates ORDER BY version DESC LIMIT 1').then(r=>r.rows[0].candidate);
  function ownedReconciliation(f,configuration) {
    // Synthetic owner composition only. This does not supply a production maintenance worker or release the gate.
    const clock=()=>f.clock.now,authorityStore=createActorAuthorityStore({pool:f.admin,clock});
    const authorization=createCoreAuthorization({principals:f.identities.verifier,discord:f.discord.roles,authorityStore,policy:configuration.capabilityPolicy,
      clock,isAuthorityCurrent:()=>true,readContinuity:f.discord.roles.readContinuity});
    const channels=createCaseChannels({transport:f.discord.transport,roles:f.discord.roles,mapping:configuration.mapping,policy:configuration.casePolicy,clock,
      authorizeCaseParticipant:authorization.authorizeCaseParticipant});
    const store=createCoreStore({pool:f.admin,clock,authorize:authorization.authorize,authorizeRecorded:authorization.authorizeRecorded,
      authorizeCaseParticipant:authorization.authorizeCaseParticipant,casePolicy:configuration.casePolicy,caseVerification:channels.verification});
    return {authorization,worker:createCaseDispatcher({outbox:createOutbox({pool:f.admin}),store,roles:f.discord.roles,channels,enabled:()=>true})};
  }
  await scenario('PA01 policy application preserves epochs and history while atomically queuing versioned case reconciliation',async f=>{
    await createMemberOperation({pool:f.admin,clock:()=>f.clock.now})(await f.discord.roles.observe(USER),async()=>{});
    for(const [i,access] of ['open','closed','sealed'].entries())await f.retainVisibleCase({name:`synthetic-${access}`,access,state:access==='open'?'open':'closed',channel:`10000000000000009${i}`,token:['a','b','c'][i]});
    const grant=await f.actor(OTHER);
    await f.admin.query(`INSERT INTO sophie_core.case_participants (guild_id,case_id,version,user_id,presence_epoch,operator_grant,status)
      VALUES ($1,'synthetic-open',1,$2,1,$3,'removed')`,[GUILD,OTHER,grant]);
    const r=await request(f),members=await f.rows('members'),invitations=await f.rows('case_participants'),before=await f.rows('case_provisions'),authority=await f.rows('actor_authority');
    const oldPolicies=await f.rows('case_policies'),calls=f.discord.state.calls.length,result=await f.maintenance.applyPolicy(r);
    assert.equal(result.phase,'policy-applied');assert.equal(result.canResume,false);assert.equal(result.summary.reconciliationJobs,3);
    assert.ok(f.discord.state.calls.slice(calls).every(call=>call.method==='GET'));assert.equal(await runtimeDatabaseAvailable(f.pool),false);
    assert.deepEqual(await f.rows('members'),members);assert.deepEqual(await f.rows('case_participants'),invitations);
    assert.deepEqual((await f.rows('case_policies')).filter(row=>row.version===1),oldPolicies);
    for(const row of await f.rows('case_provisions')){const prior=before.find(p=>p.case_id===row.case_id);assert.equal(row.policy_version,2);assert.equal(row.audience_version,prior.audience_version+1);assert.equal(row.presence_epoch,prior.presence_epoch);assert.equal(row.phase,'sealed');}
    for(const row of await f.rows('actor_authority')){const prior=authority.find(p=>p.user_id===row.user_id);assert.equal(BigInt(row.capability_epoch),BigInt(prior.capability_epoch)+1n);assert.equal(row.presence_epoch,prior.presence_epoch);assert.deepEqual(row.observation,prior.observation);assert.equal(row.policy_version,2);}
    assert.deepEqual((await f.rows('case_reservations')).map(r=>r.desired_access).sort(),['closed','open','sealed']);
    for(const row of await f.rows('outbox')){assert.equal(row.kind,'case.provision');assert.equal(row.status,'ready');assert.ok(row.operation_id.startsWith(`case.permission.${r.operationId}.`));}
    assert.equal((await f.rows('case_capture_channels')).length,3);assert.ok((await f.rows('case_capture_gaps')).some(row=>row.reasons.includes('permission-change')));
    await assert.rejects(f.maintenance.cancelPreparation(r),/MAINTENANCE_STALE/);
    await assert.rejects(f.pool.query('SELECT * FROM sophie_control.maintenance_policy_applications'),e=>e.code==='42501');
    const next=ownedReconciliation(f,await candidate(f));assert.equal(await next.authorization.authorizeRecorded('case.manage',grant,{guildId:GUILD,type:'quick-help'}),false);
    await assert.rejects(createActorAuthorityStore({pool:f.admin,clock:()=>f.clock.now}).registerPolicy(f.configuration.capabilityPolicy),/CAPABILITY_POLICY_ROLLBACK/);
  });
  await scenario('PA02 capability-only application advances grants without sealing migrating or queuing cases',async f=>{
    await f.retainVisibleCase();const r=await request(f,false),before=await f.rows('case_provisions'),cases=await f.rows('case_reservations');
    const result=await f.maintenance.applyPolicy(r);assert.equal(result.summary.casePolicyChanged,false);assert.equal(result.summary.reconciliationJobs,0);
    assert.deepEqual(await f.rows('case_provisions'),before);assert.deepEqual(await f.rows('case_reservations'),cases);
    assert.equal((await f.rows('case_policies')).length,1);assert.equal((await f.rows('outbox')).length,0);assert.equal(f.discord.state.calls.filter(c=>c.method==='PATCH').length,0);
    assert.equal(await runtimeDatabaseAvailable(f.pool),false);
  });
  await scenario('PA03 unsealed changed-policy candidates and uncertain queued work cannot apply',async f=>{
    await f.retainVisibleCase();const r=await f.sealRequest();
    await assert.rejects(f.maintenance.applyPolicy(r),/PERMISSION_SEAL_REQUIRED/);assert.equal((await applications(f)).length,0);
    await f.maintenance.cancelPreparation(r);
    await f.admin.query(`INSERT INTO sophie_core.outbox (guild_id,operation_id,user_id,kind,effect,status,dispatch_started)
      VALUES ($1,'synthetic.uncertain',$2,'case.provision',$3,'parked',true)`,[GUILD,USER,{guildId:GUILD,userId:USER,caseId:'synthetic-review',type:'quick-help',kind:'case.provision',operationId:'synthetic.uncertain'}]);
    const pending=await request(f);await assert.rejects(f.maintenance.applyPolicy(pending),/PERMISSION_DEPLOYMENT_BLOCKED/);
    assert.equal((await applications(f)).length,0);assert.equal((await f.rows('capability_policies')).length,1);
  });
  await scenario('PA04 fresh ACL drift and changed control state reject application before policy mutation',async f=>{
    const spec=await f.retainVisibleCase(),r=await request(f),channel=f.discord.state.channels.get(spec.channel),acl=channel.permission_overwrites;
    channel.permission_overwrites=[];await assert.rejects(f.maintenance.applyPolicy(r),/PERMISSION_CHANNEL_NOT_SEALED/);channel.permission_overwrites=acl;
    const service=f.maintenanceServices({channelInventory:{...f.inventory,read:async input=>{const proof=await f.inventory.read(input);await f.admin.query('UPDATE sophie_core.case_reservations SET version=version+1');return proof;}}});
    await assert.rejects(service.applyPolicy(r),/PERMISSION_DEPLOYMENT_REVIEW_STALE/);assert.equal((await applications(f)).length,0);assert.equal((await f.rows('case_policies')).length,1);
  });
  await scenario('PA05 lost application commit retries exactly without duplicating epochs versions or reconciliation jobs',async f=>{
    await f.retainVisibleCase();const r=await request(f);let commits=0;
    const pool={connect:async()=>{const client=await f.admin.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&++commits===2)throw Error('Synthetic lost policy commit');return result;
    }};}};
    await assert.rejects(f.maintenanceServices({pool}).applyPolicy(r),/Synthetic lost policy commit/);
    const before=await f.rows('actor_authority'),calls=f.discord.state.calls.length,result=await f.maintenance.applyPolicy(r);
    assert.equal(result.duplicate,true);assert.equal(f.discord.state.calls.length,calls);assert.deepEqual(await f.rows('actor_authority'),before);assert.equal((await f.rows('outbox')).length,1);
    await assert.rejects(f.maintenance.applyPolicy({...r,requestId:f.id()}),/MAINTENANCE_REQUEST_COLLISION/);
    assert.equal((await f.maintenance.policyApplication(r)).sha256,result.sha256);
    const restarted=f.maintenanceServices({configuration:{...f.configuration,...await candidate(f)}});
    assert.equal((await restarted.policyApplication(r)).sha256,result.sha256);assert.equal((await restarted.applyPolicy(r)).duplicate,true);
  });
  await scenario('PA06 expiry during policy registration rolls back policies epochs capture and queued jobs together',async f=>{
    await f.retainVisibleCase();const r=await request(f),before=await f.rows('actor_authority');
    const pool={connect:async()=>{const client=await f.admin.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0].startsWith('UPDATE sophie_core.actor_authority SET capability_epoch='))f.clock.now+=5001;return result;
    }};}};
    await assert.rejects(f.maintenanceServices({pool}).applyPolicy(r),/MEMBERSHIP_STALE/);
    assert.equal((await applications(f)).length,0);assert.equal((await f.rows('case_policies')).length,1);assert.equal((await f.rows('capability_policies')).length,1);
    assert.deepEqual(await f.rows('actor_authority'),before);assert.equal((await f.rows('case_capture_channels')).length,0);assert.equal((await f.rows('outbox')).length,0);
    assert.equal((await f.maintenance.sealingStatus(r)).phase,'sealed');
  });
  await scenario('PA07 sealed discovered duplicates are adopted with explicit capture gaps and the retained exact selection',async f=>{
    const spec=await f.retainVisibleCase(),second='100000000000000094';f.discord.state.channels.set(second,{...structuredClone(f.discord.state.channels.get(spec.channel)),id:second});
    await f.admin.query('UPDATE sophie_core.case_provisions SET chosen_channel_id=$1,chosen_candidates=$2',[spec.channel,[spec.channel,second]]);
    const r=await request(f),result=await f.maintenance.applyPolicy(r);assert.equal(result.summary.channelsAdopted,1);assert.equal((await f.rows('case_channels')).length,2);
    assert.equal((await f.rows('case_capture_channels')).length,2);assert.equal((await f.rows('case_provisions'))[0].channel_id,spec.channel);
    assert.equal((await f.rows('case_provisions'))[0].chosen_channel_id,spec.channel);assert.equal((await f.rows('case_exclusions')).length,2);
    assert.ok((await f.rows('case_capture_gaps')).filter(row=>row.channel_id===second).every(row=>row.reasons.includes('before-capture')||row.closed_at_ms===null));
  });
  await scenario('PA08 migrated jobs use fresh eligibility and preserve Head Admin closed and legacy sealed audiences',async f=>{
    const specs=[];for(const [i,access] of ['open','closed','sealed'].entries())specs.push(await f.retainVisibleCase({name:`synthetic-${access}`,access,state:access==='open'?'open':'closed',channel:`10000000000000009${i}`,token:['a','b','c'][i],type:i===0?'head-admin-contact':'tech-support'}));
    const r=await request(f);await f.maintenance.applyPolicy(r);const next=ownedReconciliation(f,await candidate(f));await f.drain(next.worker);
    const open=f.discord.state.channels.get(specs[0].channel),closed=f.discord.state.channels.get(specs[1].channel),sealed=f.discord.state.channels.get(specs[2].channel);
    assert.equal(open.permission_overwrites.some(row=>row.id===STAFF),false);assert.ok(open.permission_overwrites.some(row=>row.id===USER));
    assert.ok(closed.permission_overwrites.some(row=>row.id===BYOND_ROLE));assert.equal(closed.permission_overwrites.some(row=>row.id===STAFF),false);
    assert.equal(sealed.permission_overwrites.length,2);assert.equal((await f.rows('case_reservations')).find(row=>row.id===specs[1].name).desired_access,'closed');
    assert.equal(await runtimeDatabaseAvailable(f.pool),false);
  });
  await scenario('PA09 a departed opener stays sealed after migration instead of regaining a saved audience',async f=>{
    const spec=await f.retainVisibleCase(),r=await request(f);await f.maintenance.applyPolicy(r);f.discord.state.members.delete(USER);
    await f.drain(ownedReconciliation(f,await candidate(f)).worker);assert.equal(f.discord.state.channels.get(spec.channel).permission_overwrites.length,2);
    assert.equal((await f.rows('case_reservations'))[0].state,'failed');assert.equal(await runtimeDatabaseAvailable(f.pool),false);
  });
  await scenario('PA10 encrypted quarantine recovery preserves applied policies journal jobs and the held barrier',async f=>{
    await f.retainVisibleCase();const r=await request(f);await f.maintenance.applyPolicy(r);
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const configuration={...f.configuration,...await candidate(f)};
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget();await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    for(const table of ['sophie_control.maintenance_policy_applications','sophie_control.maintenance_operations','sophie_control.runtime_gate','sophie_core.case_provisions','sophie_core.capability_policies','sophie_core.case_policies'])
      assert.deepEqual((await target.pool.query(`SELECT * FROM ${table} ORDER BY 1`)).rows,(await f.admin.query(`SELECT * FROM ${table} ORDER BY 1`)).rows);
    assert.equal(await runtimeDatabaseAvailable(target.pool),false);assert.equal((await target.pool.query('SELECT count(*)::int AS n FROM sophie_core.outbox')).rows[0].n,1);key.fill(0);
    await f.admin.query("UPDATE sophie_control.maintenance_policy_applications SET sha256=repeat('f',64)");await assert.rejects(f.maintenance.policyApplication(r),/PERMISSION_RECORD_CORRUPT/);
  });
  await scenario('PA11 an existing capture registry records the maintenance gap when the barrier is acquired',async f=>{
    const spec=await f.retainVisibleCase();
    await f.admin.query(`INSERT INTO sophie_core.case_capture_channels (guild_id,channel_id,case_id,root_channel_id,registered_at_ms)
      VALUES ($1,$2,$3,$2,$4)`,[GUILD,spec.channel,spec.name,f.clock.now]);
    const held=await f.maintenance.begin(await f.maintenanceRequest());
    const operation=(await f.admin.query('SELECT created_at FROM sophie_control.maintenance_operations')).rows[0];
    const gap=(await f.rows('case_capture_gaps'))[0];assert.equal(gap.channel_id,null);assert.equal(Number(gap.started_at_ms),operation.created_at.getTime());
    assert.ok(gap.reasons.includes('permission-change'));assert.equal(gap.closed_at_ms,null);
    await f.maintenance.cancelPreparation(held);assert.equal((await f.rows('case_capture_gaps'))[0].closed_at_ms,null,'Cancellation cannot certify capture recovery');
  });
}
