import assert from 'node:assert/strict';
import { createConfigurationCoordinator } from '../../apps/core/runtime/configuration-coordinator.js';
import { createConfigurationDashboard } from '../../apps/core/runtime/configuration-dashboard.js';
import { createConfigurableStagingRuntime } from '../../apps/core/runtime/configurable-staging.js';
import { createMemberOperation } from '../../apps/core/storage/members.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { dashboardConfiguration, syntheticClientSecret } from '../../tests/fixtures/oauth.js';
import { createLoopbackGateway, waitForGateway } from '../../tests/fixtures/gateway-server.js';
import { discoveryResponse, SYNTHETIC_GATEWAY_TOKEN } from '../../tests/fixtures/gateway-supervisor.js';
import { readyEvent, guildEvent } from '../../tests/fixtures/gateway.js';
import { USER, OTHER } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED, WHITELIST, BYOND_ROLE } from '../../tests/fixtures/discord.js';

const next={crew:'100000000000000701',muzzled:'100000000000000702',whitelist:'100000000000000703'};
async function application(f,change=()=>{}) {
  for(const id of Object.values(next)) {
    f.discord.state.roles.push({id,position:5,managed:false,permissions:'0'});
    f.available.roles.push({id,name:'Synthetic replacement'});
  }
  const request=await f.prepare(change),candidate=await f.editor.publish(request),editor=f.services({applyEnabled:true});
  const review=await editor.deploymentReview({actor:request.actor,version:candidate.version});
  const input={actor:request.actor,requestId:f.id(),version:candidate.version,expectedHash:candidate.sha256,expectedReviewHash:review.reviewHash,confirm:true};
  await editor.apply(input);
  const coordinator=()=>createConfigurationCoordinator({pool:f.admin,configuration:f.configuration,transport:f.discord.transport,clock:()=>f.clock.now,stopRuntime:async()=>{}});
  return {input,editor,coordinator};
}
async function finish(coordinator) {
  for(let i=0;i<100;i++) {
    const result=await coordinator.runOnce();
    if(['applied','blocked','cancelled'].includes(result.state))return result;
  }
  assert.fail('Configuration did not reach a terminal state');
}
export async function runConfigurationApplicationSuite(cluster,scenario) {
  await cluster.adminPool.query('GRANT USAGE ON SCHEMA sophie_migrations TO sophie_test_core; GRANT SELECT ON sophie_migrations.applied TO sophie_test_core');
  await scenario('CA01 website request applies owned mappings without restoring Whitelist and retains Muzzled and external roles',async f=>{
    const muted='100000000000000900';
    f.discord.state.members.set(USER,[CREW,WHITELIST,BYOND_ROLE]);
    f.discord.state.members.set(muted,[CREW,MUZZLED]);
    await createMemberOperation({pool:f.pool,clock:()=>f.clock.now})(await f.discord.roles.observe(USER),async()=>{});
    const a=await application(f,d=>Object.assign(d,next));
    f.discord.state.members.get(USER).push(next.whitelist);
    assert.equal((await a.editor.apply(a.input)).state,'queued');
    assert.deepEqual(await finish(a.coordinator()),{state:'applied',configuration:{...f.configuration,...(await a.coordinator().configuration())}});
    assert.deepEqual(f.discord.state.members.get(USER).sort(),[next.crew,BYOND_ROLE].sort());
    assert.deepEqual(f.discord.state.members.get(muted),[next.muzzled]);
    assert.equal(f.discord.state.calls.some(c=>c.method==='PUT'&&c.path.endsWith(`/roles/${next.whitelist}`)),false);
    assert.equal((await f.admin.query('SELECT operation_id FROM sophie_control.runtime_gate')).rows[0].operation_id,null);
    assert.equal((await a.coordinator().configuration()).mapping.crew,next.crew);
    const state=(await f.rows('members')).find(row=>row.user_id===USER).state;
    assert.ok(state.eligibilityEpoch>0);assert.equal(state.observation,null);
  });
  await scenario('CA02 case policy application reconciles retained open closed and sealed channels before release',async f=>{
    await f.retainVisibleCase();
    await f.retainVisibleCase({name:'synthetic-closed',access:'closed',state:'closed',channel:'100000000000000092',token:'c'});
    await f.retainVisibleCase({name:'synthetic-sealed',access:'sealed',channel:'100000000000000093',token:'d'});
    const a=await application(f,d=>{d.responders['quick-help']=[BYOND_ROLE];});
    const result=await finish(a.coordinator());assert.equal(result.state,'applied',JSON.stringify(result));
    assert.equal((await a.coordinator().configuration()).casePolicy.version,2);
    assert.equal((await f.admin.query("SELECT count(*)::int n FROM sophie_core.outbox WHERE kind='case.provision' AND status!='done'")).rows[0].n,0);
  });
  await scenario('CA03 authority loss cancels before maintenance and cannot be replaced with an implicit administrator grant',async f=>{
    const a=await application(f);f.discord.state.members.set(OTHER,[]);
    const result=await a.coordinator().runOnce();assert.equal(result.state,'cancelled',JSON.stringify(result));
    assert.equal((await f.admin.query('SELECT operation_id FROM sophie_control.runtime_gate')).rows[0].operation_id,null);
  });
  await scenario('CA04 lost role response remains held and resumes from observation after process replacement',async f=>{
    const d=dashboardServices(f),login=await d.login(OTHER),session=await d.auth.authenticate({token:login.token});
    const headers={Cookie:`${DASHBOARD_COOKIES.session}=${login.token}`,Origin:dashboardConfiguration.origin,'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'};
    const a=await application(f,d=>{d.crew=next.crew;});let lost=false;
    f.discord.state.afterWrite=call=>{if(!lost&&call.method==='DELETE'&&call.path.endsWith(`/roles/${CREW}`)){lost=true;throw Error('Synthetic lost role response');}};
    const result=await finish(a.coordinator());assert.equal(result.state,'blocked',JSON.stringify(result));
    assert.ok((await f.admin.query('SELECT operation_id FROM sophie_control.runtime_gate')).rows[0].operation_id);
    f.discord.state.afterWrite=null;
    const pending=await a.coordinator().pending();
    const server=await createConfigurationDashboard({pool:f.admin,configuration:{...f.configuration,...pending.candidate_configuration},request:pending,
      transport:f.discord.transport,clientSecret:syntheticClientSecret,fetch:d.provider.fetch,clock:()=>f.clock.now,enabled:()=>true,onFault:()=>{}});
    const address=await server.listen();
    try {
      assert.equal((await dashboardHttp(address,'/api/permissions/application',{headers})).body.application.state,'blocked');
      assert.equal((await dashboardHttp(address,'/api/permissions/save',{method:'POST',headers,body:'{}'})).status,409);
      const path='/api/permissions/retryApplication',body=JSON.stringify({requestId:a.input.requestId,confirm:true});
      assert.equal((await dashboardHttp(address,path,{method:'POST',headers:{...headers,'X-CSRF-Token':''},body})).status,403);
      assert.equal((await dashboardHttp(address,path,{method:'POST',headers,body})).status,200);
    } finally {await server.close();}
    const resumed=await finish(a.coordinator());assert.equal(resumed.state,'applied',JSON.stringify(resumed));
    assert.equal(f.discord.state.calls.filter(c=>c.method==='DELETE'&&c.path.endsWith(`/members/${USER}/roles/${CREW}`)).length,1);
  });
  await scenario('CA05 requests reject missing confirmation stale review concurrent edits and restricted owner access',async f=>{
    const a=await application(f);
    await assert.rejects(a.editor.apply({...a.input,requestId:f.id(),confirm:false}),/PERMISSION_CONFIRMATION_REQUIRED/);
    await assert.rejects(a.editor.apply({...a.input,version:2}),/PERMISSION_REQUEST_COLLISION/);
    await assert.rejects(f.prepare(),/PERMISSION_APPLICATION_BUSY/);
    await assert.rejects(createConfigurationCoordinator({pool:f.pool,configuration:f.configuration,transport:f.discord.transport,stopRuntime:async()=>{}}).runOnce(),/permission denied|MAINTENANCE_OWNER_REQUIRED/);
    const result=await finish(a.coordinator());assert.equal(result.state,'applied',JSON.stringify(result));
  });
  await scenario('CA06 privileged replacement role fails before pausing and never becomes a membership grant',async f=>{
    const a=await application(f,d=>{d.crew=next.crew;});
    f.discord.state.roles.find(row=>row.id===next.crew).permissions='8';
    const result=await finish(a.coordinator());assert.equal(result.state,'cancelled',JSON.stringify(result));
    assert.equal(f.discord.state.calls.some(c=>c.method==='PUT'&&c.path.endsWith(`/roles/${next.crew}`)),false);
  });
  await scenario('CA07 supervisor replaces the stopped runtime and selects the retained configuration after host restart',async f=>{
    const started=[],events=[];
    const runtimeFactory=async input=>{assert.equal(input.pool,f.pool);assert.equal(input.configurationApplyEnabled,true);assert.equal(input.ownerPool,undefined);
      return {start:async()=>{started.push(input.configuration);events.push('start');return {};},stop:async()=>events.push('stop'),status:async()=>({current:true})};};
    const options={ownerPool:f.admin,pool:f.pool,configuration:f.configuration,token:'synthetic-test-token-not-a-secret',fetch:f.discord.fetch,
      clientSecret:syntheticClientSecret,clock:()=>f.clock.now,onFault:()=>assert.fail('Unexpected supervisor fault'),runtimeFactory};
    const host=await createConfigurableStagingRuntime(options);await host.start({automaticWorkers:false,ephemeralPorts:true});
    await application(f,d=>{d.crew=next.crew;});
    assert.equal((await finish(host)).state,'applied');assert.deepEqual(events,['start','stop','start']);
    assert.equal(started.at(-1).mapping.crew,next.crew);await host.stop();
    const resumed=await createConfigurableStagingRuntime(options);await resumed.start({automaticWorkers:false,ephemeralPorts:true});
    assert.equal(started.at(-1).mapping.crew,next.crew);await resumed.stop();
  });
  await scenario('CA08 crash between barrier acquisition and journal advancement resumes the same held generation',async f=>{
    const a=await application(f),coordinator=a.coordinator();await coordinator.runOnce();
    await f.admin.query("UPDATE sophie_control.configuration_applications SET phase='preparing',generation=NULL WHERE operation_id=$1",[a.input.requestId]);
    const result=await finish(a.coordinator());assert.equal(result.state,'applied',JSON.stringify(result));
    assert.equal((await f.admin.query('SELECT generation FROM sophie_control.runtime_gate')).rows[0].generation,'1');
  });
  await scenario('CA09 real runtime reboots into changed mappings and a fresh current Gateway after configuration apply',async f=>{
    await f.admin.query('GRANT USAGE ON SCHEMA sophie_migrations TO sophie_test_core; GRANT SELECT ON sophie_migrations.applied TO sophie_test_core');
    const faults=[],peer=await createLoopbackGateway({onPacket(packet,connection){if(packet.op===2){connection.send(readyEvent());const guild=guildEvent();guild.d.roles=f.discord.state.roles;connection.send(guild);}}});
    const fetch=(url,options)=>url.endsWith('/gateway/bot')?Promise.resolve(Response.json(discoveryResponse())):f.discord.fetch(url,options);
    const host=await createConfigurableStagingRuntime({ownerPool:f.admin,pool:f.pool,configuration:f.configuration,token:SYNTHETIC_GATEWAY_TOKEN,
      clientSecret:syntheticClientSecret,fetch,connect:peer.connect,clock:()=>f.clock.now,random:()=>0.25,onFault:code=>faults.push(code)});
    try {
      await host.start({automaticWorkers:false,ephemeralPorts:true});await waitForGateway(async()=>(await host.status()).current);
      await application(f,d=>{d.crew=next.crew;});
      assert.equal((await host.runOnce()).state,'waiting');
      // Expire only this isolated synthetic host's stopped lease; production waits for expiry.
      await f.admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until=clock_timestamp()-interval '1 second'");
      const result=await finish(host);assert.equal(result.state,'applied',JSON.stringify(result));
      await waitForGateway(async()=>(await host.status()).current,10_000);assert.deepEqual(faults,[]);
      assert.equal((await host.status()).gateway.phase,'current');
    } finally {await host.stop();await peer.stop();}
  });
  await scenario('CA10 approval rejects publisher authority that would disappear during owned-role migration',async f=>{
    f.discord.state.members.get(OTHER).push(WHITELIST);
    await assert.rejects(application(f,d=>{d.whitelist=next.whitelist;d.grants['permissions.publish']=[WHITELIST];}),/PERMISSION_LOCKOUT/);
    assert.equal((await f.rows('permission_applications')).length,0);
  });
  await scenario('CA11 policy commit survives a lost coordinator phase update without a second policy version or role restoration',async f=>{
    const a=await application(f),coordinator=a.coordinator();
    for(let i=0;i<20;i++){const state=await coordinator.runOnce();if(state.phase==='policies')break;assert.notEqual(state.state,'blocked');}
    await f.admin.query("UPDATE sophie_control.configuration_applications SET phase='sealing' WHERE operation_id=$1",[a.input.requestId]);
    const result=await finish(a.coordinator());assert.equal(result.state,'applied',JSON.stringify(result));
    assert.equal((await f.rows('capability_policies')).length,2);
  });
  await scenario('CA12 a quarantined restore cannot resume a pending configuration or expose its maintenance dashboard',async f=>{
    const a=await application(f),before=f.discord.state.calls.length;
    await f.admin.query('CREATE SCHEMA sophie_recovery');
    try {
      await assert.rejects(a.coordinator().runOnce(),/RECOVERY_QUARANTINED/);
      await assert.rejects(createConfigurationDashboard({pool:f.admin}),/RECOVERY_QUARANTINED/);
      assert.equal(f.discord.state.calls.length,before);
    } finally {await f.admin.query('DROP SCHEMA sophie_recovery');}
  });
  await scenario('CA13 shutdown drains a failed coordinator tick and still closes the running core',async f=>{
    let fail=false,rejectRead,stopped=0;
    const ownerPool={connect:()=>f.admin.connect(),query:(...args)=>fail?new Promise((resolve,reject)=>{rejectRead=reject;}):f.admin.query(...args)};
    const host=await createConfigurableStagingRuntime({ownerPool,pool:f.pool,configuration:f.configuration,token:'synthetic-test-token-not-a-secret',
      clientSecret:syntheticClientSecret,fetch:f.discord.fetch,clock:()=>f.clock.now,onFault:()=>assert.fail('Unexpected fault'),
      runtimeFactory:async()=>({start:async()=>({}),stop:async()=>{stopped++;},status:async()=>({current:true})})});
    await host.start({automaticWorkers:false,ephemeralPorts:true});fail=true;
    const tick=host.runOnce(),shutdown=host.stop();
    const tickFailure=assert.rejects(tick,/Synthetic coordinator query failure/);
    const stopFailure=assert.rejects(shutdown,/RUNTIME_SHUTDOWN_INCOMPLETE/);
    rejectRead(Error('Synthetic coordinator query failure'));
    await Promise.all([tickFailure,stopFailure]);assert.equal(stopped,1);
  });
}
