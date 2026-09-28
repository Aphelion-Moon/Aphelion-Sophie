import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { automationDeliveryFixture } from '../../tests/fixtures/automation-delivery.js';
import { createAutomationRecovery } from '../../apps/core/storage/automation-recovery.js';
import { createAutomationPolicies } from '../../apps/core/storage/automation-policies.js';
import { createAutomationPoliciesHttp } from '../../apps/core/http/automation-policies.js';
import { createDashboardAuthHttpServer } from '../../apps/core/http/dashboard-auth.js';
import { dashboardServices } from '../../tests/fixtures/dashboard-auth.js';
import { dashboardHttp } from '../../tests/fixtures/dashboard-http.js';
import { dashboardConfiguration } from '../../tests/fixtures/oauth.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { automationDocument,automationRule,PUBLIC_CHANNEL,SECOND_CHANNEL,PROTECTED_CATEGORY } from '../../tests/fixtures/automation.js';
import { GUILD,USER,OTHER,STAFF } from '../../tests/fixtures/domain.js';
import { BOT,CREW } from '../../tests/fixtures/discord.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createRecoveryBundle,prepareRecoveryBundle,restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';
import { createDashboardApi } from '../../apps/dashboard/api.js';
import { createAutomationController } from '../../apps/dashboard/automation-controller.js';

export async function runAutomationRecoverySuite(cluster,run) {
  const reaction={document:automationDocument([automationRule({action:{kind:'reaction',emoji:{id:null,name:'✅'}}})])};
  const scenario=(name,work,options)=>run(name,async()=>{
    const f=await automationDeliveryFixture(cluster,options);let sequence=0;
    const recoveryServices=(changes={})=>createAutomationRecovery({pool:f.pool,authorize:f.authorization.authorize,guildId:GUILD,
      protectedCategoryId:PROTECTED_CATEGORY,channels:f.channels,messages:f.messages,...changes});
    const recovery=recoveryServices(),actor=()=>f.actor(OTHER);
    const request=async(action='recheck',messageId=null)=>({actor:await actor(),deliveryId:(await f.record()).id,expectedVersion:(await f.job()).fence,
      action,messageId,requestId:(++sequence).toString(16).padStart(64,'0'),confirmed:true});
    async function park(){await f.send();const {claim}=await f.outbox.claim('park-worker',30000,['automation.dispatch']);await f.outbox.park(claim,'DISCORD_AUTHORIZATION_FAILED');}
    async function uncertain(){
      const sourceId=await f.send();f.discord.state.afterWrite=()=>{throw Error('Synthetic lost effect response');};
      assert.equal((await f.run()).code,'AUTOMATION_UNCERTAIN');f.discord.state.afterWrite=null;
      return {sourceId,messageId:[...f.discord.state.messages.values()].find(value=>value.author?.id===BOT)?.id??null};
    }
    await work({...f,recovery,recoveryServices,request,park,uncertain,editor:actor});
  });
  await scenario('AR01 metadata queue and detail require current publisher authority without exposing text or grants',async f=>{
    await f.park();const listed=await f.recovery.list({actor:await f.editor()});assert.equal(listed.entries.length,1);assert.equal(listed.entries[0].canRecheck,true);
    const detail=await f.recovery.detail({actor:await f.editor(),deliveryId:listed.entries[0].deliveryId});assert.equal(detail.entry.kind,'message');
    const json=JSON.stringify([listed,detail]);for(const field of ['Synthetic public','content','operator_grant','document','token'])assert.equal(json.includes(field),false);
    await assert.rejects(f.recovery.list({actor:await f.actor(USER)}),/OPERATION_DENIED/);
    f.discord.state.members.set(OTHER,[]);await assert.rejects(f.recovery.detail({actor:await f.editor(),deliveryId:listed.entries[0].deliveryId}),/OPERATION_DENIED/);
  });
  await scenario('AR02 confirmed recheck advances the fence and records an exact operator receipt without changing send state',async f=>{
    await f.park();const request=await f.request(),before=await f.record(),result=await f.recovery.change(request);
    assert.equal(result.acceptedVersion,request.expectedVersion+1);assert.equal((await f.job()).status,'ready');assert.deepEqual(await f.record(),before);
    await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');assert.equal((await f.recovery.change(request)).duplicate,true);
    assert.equal((await f.rows('automation_recovery_actions')).length,1);
    const detail=await f.recovery.detail({actor:await f.editor(),deliveryId:before.id});assert.ok(detail.events.some(event=>event.kind==='operator-recheck'&&event.operatorId===OTHER));
  });
  await scenario('AR03 stale concurrent review versions cannot reset a newer queue and duplicate requests retain one repair',async f=>{
    await f.park();const one=await f.request(),two=await f.request(),results=await Promise.allSettled([f.recovery.change(one),f.recovery.change(two)]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.find(result=>result.status==='rejected').reason.code,'AUTOMATION_RECOVERY_STALE');
    const winner=results[0].status==='fulfilled'?one:two;assert.equal((await f.recovery.change(winner)).duplicate,true);
    assert.equal((await f.rows('automation_recovery_actions')).length,1);
  });
  await scenario('AR04 uncertain sends cannot be rechecked or declared absent and mismatched message references are rejected',async f=>{
    const {messageId}=await f.uncertain();assert.equal((await f.recovery.list({actor:await f.editor()})).entries[0].canRecover,true);
    await assert.rejects(f.recovery.change(await f.request()),/AUTOMATION_RECOVERY_UNAVAILABLE/);
    await assert.rejects(f.recovery.change(await f.request('recover','999')),/AUTOMATION_RECOVERY_UNAVAILABLE/);
    f.discord.state.messages.get(messageId).author.id=USER;await assert.rejects(f.recovery.change(await f.request('recover',messageId)),/AUTOMATION_RECOVERY_UNAVAILABLE/);
    assert.equal((await f.record()).receipt_available,false);assert.equal((await f.rows('automation_recovery_actions')).length,0);
  });
  await scenario('AR05 recovery adopts the exact own marked message and normal workers confirm without another send',async f=>{
    const {messageId}=await f.uncertain(),request=await f.request('recover',messageId);await f.recovery.change(request);
    assert.equal((await f.record()).sent_message_id,messageId);assert.equal((await f.record()).create_started,true);await f.drain(f.worker);
    assert.equal((await f.record()).state,'confirmed');assert.equal((await f.recovery.change(request)).duplicate,true);
    assert.equal(f.discord.state.calls.filter(call=>call.method==='POST').length,1);
  });
  await scenario('AR06 expired withdrawn-policy effects can be recovered for removal even after the source member leaves',async f=>{
    const {messageId}=await f.uncertain();await f.withdraw();f.step(60001);f.discord.state.members.delete(USER);
    await f.recovery.change(await f.request('recover',messageId));await f.drain(f.worker);
    assert.equal((await f.record()).state,'withdrawn');assert.equal(f.discord.state.messages.has(messageId),false);
  });
  await scenario('AR07 matching own reactions can be recovered but an absent reaction never authorizes a repeat',async f=>{
    const {sourceId}=await f.uncertain(),source=f.discord.state.messages.get(sourceId);source.reactions[0].me=false;
    await assert.rejects(f.recovery.change(await f.request('recover')),/AUTOMATION_RECOVERY_UNAVAILABLE/);
    source.reactions[0].me=true;await f.recovery.change(await f.request('recover'));await f.drain(f.worker);
    assert.equal((await f.record()).state,'confirmed');assert.equal(f.discord.state.calls.filter(call=>call.method==='PUT').length,1);
  },reaction);
  await scenario('AR08 excluded channels prevent recovery metadata fetches and preserve uncertain state',async f=>{
    const {messageId}=await f.uncertain();await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,PUBLIC_CHANNEL]);
    const start=f.discord.state.calls.length;await assert.rejects(f.recovery.change(await f.request('recover',messageId)),/AUTOMATION_CHANNEL_UNAVAILABLE/);
    assert.equal(f.discord.state.calls.slice(start).some(call=>call.path.includes('/messages/')),false);assert.equal((await f.record()).receipt_available,false);
  });
  await scenario('AR09 exclusion observed after candidate inspection rolls back receipt and operator audit',async f=>{
    const {messageId}=await f.uncertain(),messages={...f.messages,recover:async(...args)=>{const proof=await f.messages.recover(...args);
      await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,PUBLIC_CHANNEL]);return proof;}};
    await assert.rejects(f.recoveryServices({messages}).change(await f.request('recover',messageId)),/AUTOMATION_CHANNEL_UNAVAILABLE/);
    assert.equal((await f.record()).receipt_available,false);assert.equal((await f.rows('automation_recovery_actions')).length,0);
  });
  await scenario('AR10 final publisher revocation rolls back candidate adoption audit and queue release',async f=>{
    const {messageId}=await f.uncertain(),messages={...f.messages,recover:async(...args)=>{const proof=await f.messages.recover(...args);f.discord.state.members.set(OTHER,[]);return proof;}};
    await assert.rejects(f.recoveryServices({messages}).change(await f.request('recover',messageId)),/OPERATION_DENIED/);
    assert.equal((await f.record()).receipt_available,false);assert.equal((await f.job()).status,'parked');assert.equal((await f.rows('automation_recovery_actions')).length,0);
  });
  await scenario('AR11 shared pauses and job cooldowns survive repair and restored quarantine jobs cannot be released',async f=>{
    await f.park();await f.admin.query("UPDATE sophie_core.outbox SET available_at=clock_timestamp()+interval '1 hour' WHERE kind='automation.dispatch'");
    await f.admin.query("UPDATE sophie_core.discord_backoff SET paused=true,until_at=clock_timestamp()+interval '1 hour'");
    const before=await f.job(),barrier=await f.rows('discord_backoff');await f.recovery.change(await f.request());
    assert.equal((await f.job()).available_at.getTime(),before.available_at.getTime());assert.deepEqual(await f.rows('discord_backoff'),barrier);assert.equal((await f.run()).status,'idle');
    await f.admin.query("UPDATE sophie_core.outbox SET status='parked',last_error_code='RECONCILIATION_REVIEW_REQUIRED' WHERE kind='automation.dispatch'");
    await assert.rejects(f.recovery.change(await f.request()),/AUTOMATION_RECOVERY_STALE/);
  });
  await scenario('AR12 lost commit acknowledgement resolves one accepted repair after later policy and queue changes',async f=>{
    await f.park();const request=await f.request();let lose=true;
    const pool={connect:async()=>{const client=await f.pool.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&lose){lose=false;throw Error('Synthetic lost repair commit');}return result;
    }};}};
    await assert.rejects(f.recoveryServices({pool}).change(request),/Synthetic lost repair commit/);await f.withdraw();await f.drain(f.worker);
    assert.equal((await f.recovery.change(request)).duplicate,true);assert.equal((await f.record()).state,'cancelled');assert.equal((await f.rows('automation_recovery_actions')).length,1);
    await assert.rejects(f.recovery.change({...request,expectedVersion:request.expectedVersion+1}),/AUTOMATION_REQUEST_COLLISION/);
  });
  await scenario('AR13 late original receipts agree with operator adoption and old claims cannot release the new fenced job',async f=>{
    await f.send();const {claim}=await f.outbox.claim('late-original',30000,['automation.dispatch']),state=await f.store.prepare(claim);await f.store.begin(claim,state.proof);
    const proof=await f.messages.create(state.plan,state.proof),messageId=f.messages.verification.receipt(proof,state.plan);
    await f.admin.query("UPDATE sophie_core.outbox SET lease_until='-infinity' WHERE kind='automation.dispatch'");assert.equal((await f.run()).code,'AUTOMATION_UNCERTAIN');
    await f.recovery.change(await f.request('recover',messageId));await f.store.note(claim,proof);
    await assert.rejects(f.outbox.continue(claim),/OUTBOX_LEASE_LOST/);await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');
    assert.equal((await f.rows('automation_delivery_events')).filter(event=>event.kind==='receipt').length,1);
  });
  await scenario('AR14 bounded queue pagination preserves references without duplicate entries',async f=>{
    for(let index=0;index<11;index++){
      if(index)f.step(3000);const userId=String(8800+index);f.discord.state.members.set(userId,[CREW]);
      await f.send({author:{id:userId,bot:false},channel_id:index%2?SECOND_CHANNEL:PUBLIC_CHANNEL});
      const {claim}=await f.outbox.claim('queue-worker',30000,['automation.dispatch']);await f.outbox.park(claim,'DISCORD_AUTHORIZATION_FAILED');
    }
    const first=await f.recovery.list({actor:await f.editor()}),second=await f.recovery.list({actor:await f.editor(),before:first.nextBefore});
    assert.equal(first.entries.length,10);assert.equal(second.entries.length,1);assert.equal(new Set([...first.entries,...second.entries].map(row=>row.deliveryId)).size,11);
  });
  await scenario('AR15 authenticated HTTP repair requires CSRF confirmation closed fields and current capability',async f=>{
    const {messageId}=await f.uncertain(),d=dashboardServices({...f,clock:{get now(){return f.clock();},enabled:true}}),authorization=d.dashboardAuthorization,faults=[];
    const server=createDashboardAuthHttpServer({configuration:dashboardConfiguration,auth:d.auth,authorization,
      automation:createAutomationPoliciesHttp({auth:d.auth,authorization,automation:f.automation,recovery:f.recoveryServices({authorize:authorization.authorize})}),enabled:()=>true,onFault:value=>faults.push(value)});
    const address=await server.listen();
    try {
      const login=await d.login(OTHER),session=await d.auth.authenticate({token:login.token}),headers={Cookie:`${DASHBOARD_COOKIES.session}=${login.token}`,Origin:dashboardConfiguration.origin,
        'X-CSRF-Token':session.csrfToken,'Content-Type':'application/json'};
      const {actor,...body}=await f.request('recover',messageId),post=(value,extra={})=>dashboardHttp(address,'/api/automation/repair',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});
      assert.equal((await dashboardHttp(address,'/api/automation/issues',{headers})).body.entries.length,1);
      assert.equal((await post(body,{'X-CSRF-Token':'wrong'})).status,403);assert.equal((await post({...body,confirmed:false})).status,400);
      assert.equal((await post({...body,force:true})).status,400);assert.equal((await post({...body,deliveryId:'invalid'})).status,400);
      assert.equal((await post(body)).status,200);assert.equal((await post(body)).body.duplicate,true);
      f.discord.state.members.set(OTHER,[]);assert.equal((await dashboardHttp(address,'/api/automation/issues',{headers})).status,403);assert.deepEqual(faults,[]);
    } finally {await server.close();}
  });
  await scenario('AR16 migration replay and encrypted restore preserve exact operator recovery receipts and audit',async f=>{
    const {messageId}=await f.uncertain();await f.recovery.change(await f.request('recover',messageId));assert.deepEqual(await migrateCore(f.admin),{migrations: 60});
    const configuration=stagingConfiguration('a'.repeat(64));configuration.capabilityPolicy=f.policy;configuration.automationEnabled=true;
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget(),restored=await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});assert.equal(restored.tableCountsVerified,true);
    for(const table of ['automation_recovery_actions','automation_delivery_events','automation_deliveries'])assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_core.${table}`)).rows,await f.rows(table));
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
    assert.equal((await target.pool.query("SELECT status FROM sophie_core.outbox WHERE kind='automation.dispatch'")).rows[0].status,'parked');
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.automation_recovery_actions'),error=>error.code==='42501');
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.automation_recovery_actions'),error=>error.code==='42501');
  });
  await scenario('AR17 corrupt references remain visible as metadata-only issues without allowing repair',async f=>{
    await f.park();await f.admin.query("UPDATE sophie_core.automation_deliveries SET action_sha256=repeat('f',64)");
    const list=await f.recovery.list({actor:await f.editor()});assert.equal(list.entries[0].integrity,'unverified');assert.equal(list.entries[0].canRecheck,false);
    await assert.rejects(f.recovery.change(await f.request()),/AUTOMATION_CORRUPT/);assert.equal((await f.job()).status,'parked');
  });
  await scenario('AR18 operator audit failure rolls back receipt adoption and leaves the original uncertain job parked',async f=>{
    const {messageId}=await f.uncertain();await f.admin.query('REVOKE INSERT ON sophie_core.automation_recovery_actions FROM sophie_test_core');
    try {await assert.rejects(f.recovery.change(await f.request('recover',messageId)),error=>error.code==='42501');}
    finally {await f.admin.query('GRANT INSERT ON sophie_core.automation_recovery_actions TO sophie_test_core');}
    assert.equal((await f.record()).receipt_available,false);assert.equal((await f.job()).status,'parked');
    assert.deepEqual((await f.rows('automation_delivery_events')).map(row=>row.kind),['send-started']);
  });
  await scenario('AR19 operator history pages preserve audit order identity and all eleven retained actions',async f=>{
    await f.park();for(let index=0;index<11;index++){
      await f.recovery.change(await f.request());const {claim}=await f.outbox.claim('audit-page-worker',30000,['automation.dispatch']);await f.outbox.park(claim,'DISCORD_AUTHORIZATION_FAILED');
    }
    const actor=await f.editor(),deliveryId=(await f.record()).id,first=await f.recovery.detail({actor,deliveryId}),second=await f.recovery.detail({actor,deliveryId,before:first.nextBefore});
    assert.equal(first.events.length,10);assert.equal(second.events.length,1);
    const events=[...first.events,...second.events];assert.deepEqual(events.map(row=>row.sequence),Array.from({length:11},(_,index)=>11-index));
    assert.ok(events.every(event=>event.kind==='operator-recheck'&&event.operatorId===OTHER));
  });
  await scenario('AR20 browser controller composes authenticated publication preview and uncertain-effect recovery with retained storage',async f=>{
    const {messageId}=await f.uncertain(),d=dashboardServices({...f,clock:{get now(){return f.clock();},enabled:true}}),authorization=d.dashboardAuthorization;
    const automation=createAutomationPolicies({pool:f.pool,authorize:authorization.authorize,guildId:GUILD,channels:f.channels,protectedCategoryId:PROTECTED_CATEGORY});
    const server=createDashboardAuthHttpServer({configuration:dashboardConfiguration,auth:d.auth,authorization,
      automation:createAutomationPoliciesHttp({auth:d.auth,authorization,automation,recovery:f.recoveryServices({authorize:authorization.authorize})}),enabled:()=>true,onFault:()=>assert.fail('Unexpected HTTP fault')});
    const address=await server.listen();
    try {
      const login=await d.login(OTHER);let lose=false,sequence=100;
      const api=createDashboardApi({fetch:async(path,options)=>{
        const response=await dashboardHttp(address,path,{method:options.method,headers:{...options.headers,Cookie:`${DASHBOARD_COOKIES.session}=${login.token}`,Origin:dashboardConfiguration.origin},body:options.body??''});
        if(lose&&path==='/api/automation/repair'&&response.status===200){lose=false;throw Error('Synthetic lost browser receipt');}
        return Response.json(response.body,{status:response.status});
      }}),c=createAutomationController({api,onChange:()=>{},newRequestId:()=>(++sequence).toString(16).padStart(64,'0')});
      await c.start();assert.equal(c.snapshot().phase,'ready',c.snapshot().error);assert.equal(c.snapshot().issues.entries.length,1);
      await c.openIssue(c.snapshot().issues.entries[0].deliveryId);assert.equal(c.snapshot().detail.entry.canRecheck,false);
      await c.reviewRepair('recover',messageId);assert.ok(c.snapshot().repair,c.snapshot().error);c.confirmRepair(true);lose=true;await c.sendRepair();assert.ok(c.snapshot().pending);
      await c.retry();assert.equal(c.snapshot().pending,null);await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');
      assert.equal(f.discord.state.calls.filter(call=>call.method==='POST').length,1);assert.equal((await f.rows('automation_recovery_actions')).length,1);
      c.sample(0,'channelId',PUBLIC_CHANNEL);c.sample(0,'userId',USER);c.sample(0,'content','Synthetic help');c.attestSamples(true);await c.preview();assert.equal(c.snapshot().preview?.deliveryEnabled,false,c.snapshot().error);
      c.editSource('Synthetic browser public source');await c.review();assert.ok(c.snapshot().review,c.snapshot().error);c.confirm(true);await c.send();assert.equal(c.snapshot().current.revision,2,c.snapshot().error);
      await c.review('withdraw');c.confirm(true);await c.send();assert.equal(c.snapshot().current.action,'withdraw',c.snapshot().error);
      f.discord.state.members.set(OTHER,[]);await c.checkAccess();assert.equal(c.snapshot().phase,'denied');assert.equal(c.snapshot().detail,null);assert.equal(c.snapshot().draft,null);
    } finally {await server.close();}
  });
}
