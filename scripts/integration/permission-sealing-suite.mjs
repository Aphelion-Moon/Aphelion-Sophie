import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { runtimeDatabaseAvailable } from '../../apps/core/storage/runtime-maintenance.js';
import { GUILD } from '../../tests/fixtures/domain.js';

export async function runPermissionSealingSuite(cluster,scenario) {
  const effects=f=>f.admin.query('SELECT * FROM sophie_control.maintenance_seal_effects ORDER BY channel_id').then(r=>r.rows);
  const writes=f=>f.discord.state.calls.filter(call=>call.method==='PATCH');
  await scenario('PS01 durable intent and exclusions precede writes while retained desired access and policies stay unchanged',async f=>{
    for(const [index,access] of ['open','closed','sealed'].entries())await f.retainVisibleCase({name:`synthetic-${access}`,access,state:access==='open'?'open':'closed',channel:`10000000000000009${index}`,token:['a','b','c'][index],type:'head-admin-contact'});
    const request=await f.sealRequest(),before=await f.rows('case_reservations'),policies=await f.rows('case_policies');
    const planned=await f.maintenance.planSealing(request);assert.equal(planned.states.planned,3);assert.equal(writes(f).length,0);
    assert.equal((await f.rows('case_exclusions')).length,3);await assert.rejects(f.maintenance.cancelPreparation(request),/MAINTENANCE_STALE/);
    f.discord.state.before=async call=>{if(call.method==='PATCH')assert.equal((await effects(f)).find(row=>call.path.endsWith(row.channel_id)).state,'started');};
    for(let i=0;i<3;i++)await f.maintenance.sealNext(request);
    assert.equal(writes(f).length,2,'Already sealed channels need only fresh verification');
    const result=await f.maintenance.finishSealing(request);assert.equal(result.phase,'sealed');assert.equal(result.canActivate,false);assert.equal(result.states.verified,3);
    assert.equal(await runtimeDatabaseAvailable(f.pool),false);assert.deepEqual(await f.rows('case_reservations'),before);assert.deepEqual(await f.rows('case_policies'),policies);
    for(const table of ['maintenance_seal_plans','maintenance_seal_effects'])await assert.rejects(f.pool.query(`SELECT * FROM sophie_control.${table}`),e=>e.code==='42501');
  });
  await scenario('PS02 unconfirmed stale or blocked inventory cannot create seal intent or exclusions',async f=>{
    const spec=await f.retainVisibleCase(),request=await f.sealRequest();
    await assert.rejects(f.maintenance.planSealing({...request,confirm:false}),/CONFIRMATION_REQUIRED/);
    await assert.rejects(f.maintenance.planSealing({...request,expectedInventoryHash:'f'.repeat(64)}),/PERMISSION_INVENTORY_STALE/);
    f.discord.state.channels.get(spec.channel).parent_id=null;
    await assert.rejects(f.maintenance.planSealing(request),/PERMISSION_INVENTORY_STALE/);
    f.discord.state.channels.get(spec.channel).topic='synthetic-identity-mismatch';
    const inventory=await f.maintenance.inspectChannels({...request,requestId:f.id(),expectedRevision:1});
    await assert.rejects(f.maintenance.planSealing({...request,inventoryRevision:2,expectedInventoryHash:inventory.sha256}),/PERMISSION_INVENTORY_BLOCKED/);
    assert.equal((await effects(f)).length,0);assert.equal((await f.rows('case_exclusions')).length,0);assert.equal(writes(f).length,0);
    await f.maintenance.cancelPreparation(request);
  });
  await scenario('PS03 a lost planning commit retains the exact receipt and changed requests cannot reuse it',async f=>{
    await f.retainVisibleCase();const request=await f.sealRequest();let commits=0;
    const pool={connect:async()=>{const client=await f.admin.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&++commits===2)throw Error('Synthetic lost sealing commit');return result;
    }};}};
    await assert.rejects(f.maintenanceServices({pool}).planSealing(request),/Synthetic lost sealing commit/);
    const calls=f.discord.state.calls.length;assert.equal((await f.maintenance.planSealing(request)).duplicate,true);assert.equal(f.discord.state.calls.length,calls);
    await assert.rejects(f.maintenance.planSealing({...request,requestId:f.id()}),/MAINTENANCE_REQUEST_COLLISION/);
    assert.equal((await effects(f)).length,1);assert.equal(writes(f).length,0);
  });
  await scenario('PS04 concurrent dispatchers issue one write for a durable channel intent',async f=>{
    await f.retainVisibleCase();const request=await f.sealRequest();await f.maintenance.planSealing(request);
    const results=await Promise.allSettled([f.maintenance.sealNext(request),f.maintenance.sealNext(request)]);
    assert.ok(results.some(row=>row.status==='fulfilled'));
    for(const result of results.filter(row=>row.status==='rejected'))assert.match(result.reason.message,/PERMISSION_SEAL_BUSY/);
    assert.equal(writes(f).length,1);assert.equal((await effects(f))[0].state,'verified');
  });
  await scenario('PS05 lost write responses remain uncertain without resend and read-only recovery retains uncertainty',async f=>{
    await f.retainVisibleCase();const request=await f.sealRequest();await f.maintenance.planSealing(request);
    f.discord.state.afterWrite=call=>{if(call.method==='PATCH')throw Error('Synthetic lost sealing response');};
    await assert.rejects(f.maintenance.sealNext(request));assert.equal((await effects(f))[0].state,'uncertain');
    f.discord.state.afterWrite=null;await f.maintenance.sealNext(request);assert.equal(writes(f).length,1);
    const result=await f.maintenance.recheckNextSeal(request);assert.equal(result.states.verified,1);assert.equal(result.uncertain,1);
    assert.equal(writes(f).length,1);assert.equal((await effects(f))[0].response_observed,false);
    assert.equal((await f.maintenance.finishSealing(request)).phase,'sealed');
  });
  await scenario('PS06 successful HTTP response is insufficient without exact observed sealing',async f=>{
    const spec=await f.retainVisibleCase(),request=await f.sealRequest();await f.maintenance.planSealing(request);
    f.discord.state.before=call=>call.method==='PATCH'?new Response(JSON.stringify(f.discord.state.channels.get(spec.channel))):null;
    await assert.rejects(f.maintenance.sealNext(request),/PERMISSION_CHANNEL_NOT_SEALED/);
    assert.equal((await effects(f))[0].state,'sent');await assert.rejects(f.maintenance.finishSealing(request),/PERMISSION_SEAL_INCOMPLETE/);
    await assert.rejects(f.maintenance.recheckNextSeal(request),/PERMISSION_CHANNEL_NOT_SEALED/);
    await f.maintenance.sealNext(request);assert.equal(writes(f).length,1);assert.equal(await runtimeDatabaseAvailable(f.pool),false);
  });
  await scenario('PS07 identity changes stop dispatch and late untracked or reopened channels block completion',async f=>{
    const spec=await f.retainVisibleCase(),request=await f.sealRequest();await f.maintenance.planSealing(request);
    const channel=f.discord.state.channels.get(spec.channel),marker=channel.topic;channel.topic='synthetic-mismatch';
    await assert.rejects(f.maintenance.sealNext(request),/CASE_CHANNEL_MISMATCH/);assert.equal((await effects(f))[0].state,'planned');assert.equal(writes(f).length,0);
    channel.topic=marker;await f.maintenance.sealNext(request);
    const extra='100000000000000094';f.discord.state.channels.set(extra,{...structuredClone(channel),id:extra});
    await assert.rejects(f.maintenance.finishSealing(request),/PERMISSION_INVENTORY_BLOCKED/);f.discord.state.channels.delete(extra);
    const acl=channel.permission_overwrites;channel.permission_overwrites=[];
    await assert.rejects(f.maintenance.finishSealing(request),/PERMISSION_CHANNEL_NOT_SEALED/);channel.permission_overwrites=acl;
    assert.equal((await f.maintenance.finishSealing(request)).phase,'sealed');
    channel.permission_overwrites=[];await assert.rejects(f.maintenance.finishSealing(request),/PERMISSION_CHANNEL_NOT_SEALED/);
  });
  await scenario('PS08 confirmed discovered channels are permanently excluded without premature adoption',async f=>{
    const spec=await f.retainVisibleCase(),second='100000000000000094';
    f.discord.state.channels.set(second,{...structuredClone(f.discord.state.channels.get(spec.channel)),id:second});
    await f.admin.query('UPDATE sophie_core.case_provisions SET chosen_channel_id=$1,chosen_candidates=$2',[spec.channel,[spec.channel,second]]);
    const request=await f.sealRequest();assert.equal((await f.maintenance.planSealing(request)).total,2);
    assert.equal((await f.rows('case_exclusions')).length,2);assert.equal((await f.rows('case_channels')).length,1);
    await f.maintenance.sealNext(request);await f.maintenance.sealNext(request);assert.equal((await f.maintenance.finishSealing(request)).phase,'sealed');
  });
  await scenario('PS09 encrypted recovery preserves sealed effects exclusions and the held runtime barrier',async f=>{
    await f.retainVisibleCase();const request=await f.sealRequest();await f.maintenance.planSealing(request);await f.maintenance.sealNext(request);await f.maintenance.finishSealing(request);
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration:f.configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget();await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    for(const table of ['sophie_control.maintenance_seal_plans','sophie_control.maintenance_seal_effects','sophie_control.maintenance_operations','sophie_control.runtime_gate','sophie_core.case_exclusions'])
      assert.deepEqual((await target.pool.query(`SELECT * FROM ${table}`)).rows,(await f.admin.query(`SELECT * FROM ${table}`)).rows);
    assert.equal(await runtimeDatabaseAvailable(target.pool),false);key.fill(0);
  });
  await scenario('PS10 corrupt durable targets fail closed and capability-only candidates cannot invoke case sealing',async f=>{
    await f.retainVisibleCase();const held=await f.maintenance.begin(await f.maintenanceRequest());
    const inventory=await f.maintenance.inspectChannels({...held,requestId:f.id(),expectedRevision:0});
    await assert.rejects(f.maintenance.planSealing({...held,requestId:f.id(),inventoryRevision:1,expectedInventoryHash:inventory.sha256,confirm:true}),/PERMISSION_SEAL_NOT_REQUIRED/);
    await f.maintenance.cancelPreparation(held);
    const request=await f.sealRequest();await f.maintenance.planSealing(request);
    await f.admin.query(`UPDATE sophie_control.maintenance_seal_effects SET target=jsonb_set(target,'{parentId}','"999"')`);
    await assert.rejects(f.maintenance.sealNext(request),/PERMISSION_RECORD_CORRUPT/);assert.equal(writes(f).length,0);
  });
  await scenario('PS11 loss after the started commit cannot dispatch on retry or release the barrier',async f=>{
    await f.retainVisibleCase();const request=await f.sealRequest();await f.maintenance.planSealing(request);let commits=0;
    const pool={connect:async()=>{const client=await f.admin.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&++commits===2)throw Error('Synthetic lost start commit');return result;
    }};}};
    await assert.rejects(f.maintenanceServices({pool}).sealNext(request),/Synthetic lost start commit/);
    assert.equal((await effects(f))[0].state,'started');await f.maintenance.sealNext(request);assert.equal(writes(f).length,0);
    await assert.rejects(f.maintenance.recheckNextSeal(request),/PERMISSION_CHANNEL_NOT_SEALED/);
    await assert.rejects(f.maintenance.cancelPreparation(request),/MAINTENANCE_STALE/);assert.equal(await runtimeDatabaseAvailable(f.pool),false);
  });
}
