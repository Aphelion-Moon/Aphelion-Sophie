import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { automationAdmissionFixture } from '../../tests/fixtures/automation-admission.js';
import { automationDocument, automationRule, PUBLIC_CHANNEL, SECOND_CHANNEL, PROTECTED_CATEGORY } from '../../tests/fixtures/automation.js';
import { GUILD, USER, OTHER } from '../../tests/fixtures/domain.js';
import { BOT, mapping } from '../../tests/fixtures/discord.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createAutomationAdmission } from '../../apps/core/storage/automation-admission.js';
import { createAutomationIngress } from '../../apps/core/discord/automation-ingress.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createRecoveryBundle,prepareRecoveryBundle,restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';

export async function runAutomationAdmissionSuite(cluster,run){
  const scenario=(name,work,options)=>run(name,async()=>work(await automationAdmissionFixture(cluster,options)));
  const jobs=async f=>(await f.rows('outbox')).filter(row=>row.kind==='automation.dispatch');
  await scenario('AA01 matching commits metadata receipt approved-action reference cooldowns and one job with the Gateway cursor',async f=>{
    const input=f.payload({content:'SYNTHETIC_TRANSIENT_SENTINEL help'});await f.sendPayload(input);
    const events=await f.rows('automation_events'),deliveries=await f.rows('automation_deliveries'),queue=await jobs(f);
    assert.equal(events.length,1);assert.equal(deliveries.length,1);assert.equal(queue.length,1);assert.equal((await f.rows('automation_cooldowns')).length,2);
    assert.equal(Number((await f.rows('gateway_lifecycle'))[0].sequence),input.s);
    assert.deepEqual(queue[0].effect,{kind:'automation.dispatch',guildId:GUILD,userId:USER,operationId:`automation.${deliveries[0].id}`,deliveryId:deliveries[0].id});
    assert.equal(JSON.stringify([events,deliveries,queue]).includes('SYNTHETIC_TRANSIENT_SENTINEL'),false);
    assert.equal(Number(deliveries[0].expires_at_ms)-Number(deliveries[0].created_at_ms),60000);
  });
  await scenario('AA02 replayed sequence and duplicate message IDs never repeat jobs or inspect changed content',async f=>{
    const input=f.payload();await f.sendPayload(input);assert.equal((await f.sendPayload(input)).duplicate,true);
    const duplicate=f.payload({id:input.d.id});Object.defineProperty(duplicate.d,'content',{get(){throw Error('duplicate body read');}});
    await f.sendPayload(duplicate);assert.equal((await jobs(f)).length,1);assert.equal((await f.rows('automation_events')).length,1);
  });
  await scenario('AA03 ticket tombstones moved categories and threads are excluded before content access',async f=>{
    const protectedIds=['801','802','803','804'];
    // The policy was reviewed while these were ordinary text channels.
    for(const id of protectedIds)f.discord.state.channels.set(id,{id,guild_id:GUILD,type:0,parent_id:null});
    const actor=await f.actor(OTHER),fields={expectedRevision:1,action:'publish',document:automationDocument([automationRule({channels:protectedIds})])};
    const review=await f.automation.review({actor,...fields});await f.automation.change({actor,...fields,requestId:'b'.repeat(64),reviewSha256:review.reviewSha256,confirmed:true,approvedPublic:true});
    await f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,'801']);
    f.discord.state.channels.get('802').parent_id=PROTECTED_CATEGORY;f.discord.state.channels.get('803').type=11;f.discord.state.channels.get('804').parent_id='801';
    for(const id of protectedIds){const input=f.payload({channel_id:id});Object.defineProperty(input.d,'content',{get(){throw Error('excluded content read');}});await f.sendPayload(input);}
    assert.equal((await f.rows('automation_events')).length,0);assert.equal((await jobs(f)).length,0);
  });
  await scenario('AA04 bot webhook self system foreign and update events never enter automation storage',async f=>{
    for(const changes of [{author:{id:BOT}},{author:{id:USER,bot:true}},{webhook_id:'123'},{type:1},{guild_id:'999'}]){
      const input=f.payload(changes);Object.defineProperty(input.d,'content',{get(){throw Error('suppressed content read');}});await f.sendPayload(input);
    }
    const update=f.payload();update.t='MESSAGE_UPDATE';await f.sendPayload(update);
    assert.equal((await f.rows('automation_events')).length,0);assert.equal((await jobs(f)).length,0);
  });
  await scenario('AA05 durable cooldowns span users and channels and remain active after publication changes',async f=>{
    await f.send();f.step(500);await f.send({author:{id:OTHER,bot:false}});f.step(500);await f.send({channel_id:SECOND_CHANNEL});
    const actor=await f.actor(OTHER),fields={expectedRevision:1,action:'publish',document:automationDocument()},review=await f.automation.review({actor,...fields});
    await f.automation.change({actor,...fields,requestId:'b'.repeat(64),reviewSha256:review.reviewSha256,confirmed:true,approvedPublic:true});
    f.step(2000);await f.send({channel_id:SECOND_CHANNEL});
    assert.equal((await jobs(f)).length,2);assert.deepEqual((await f.rows('automation_events')).map(row=>row.decisions[0].state),['selected','cooldown','cooldown','selected']);
  });
  await scenario('AA06 fresh admission services and resumed Gateway replay keep receipts and cooldown state',async f=>{
    const original=f.payload();await f.sendPayload(original);const before=await jobs(f);
    await f.observer.pause(f.connection);await f.admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until='-infinity'");
    const ingress=createAutomationIngress({guildId:GUILD,botUserId:BOT,clock:f.clock}),admission=createAutomationAdmission({guildId:GUILD,protectedCategoryId:PROTECTED_CATEGORY,channels:f.channels,ingress});
    const journal=createGatewayJournal({pool:f.pool,mapping,clock:f.clock,automation:admission});
    const {lease,resume}=await journal.acquire('fresh-automation');assert.equal(resume.sequence,original.s);
    await journal.resume(lease);await journal.dispatch(lease,{sessionId:resume.sessionId,sequence:original.s+1,change:{kind:'resumed'}});
    const repeated={...original,s:original.s+2},proof=admission.prepare(repeated);
    await journal.dispatch(lease,{sessionId:resume.sessionId,sequence:repeated.s,change:{kind:'ignored'},automationMessage:proof});
    assert.deepEqual(await jobs(f),before);assert.equal((await f.rows('automation_cooldowns')).length,2);
  });
  await scenario('AA07 matched stop cooldown and the three-action cap persist exactly the selected decisions',async f=>{
    await f.send();assert.equal((await jobs(f)).length,3);
    assert.deepEqual((await f.rows('automation_events'))[0].decisions.map(row=>row.state),['selected','selected','selected','limit','limit']);
  },{document:automationDocument(Array.from({length:5},(_,index)=>automationRule({id:`rule${index}`,stop:false})))});
  await scenario('AA08 pending per-user capacity records suppression without consuming another cooldown slot',async f=>{
    for(let index=0;index<6;index++){if(index)f.step(3000);await f.send();}
    assert.equal((await jobs(f)).length,5);assert.equal((await f.rows('automation_events')).at(-1).outcome,'capacity');
    assert.equal(Number((await f.rows('automation_cooldowns'))[0].admitted_at_ms),f.clock()-3000);
  });
  await scenario('AA09 global and channel pending limits hold across unrelated authors',async f=>{
    const channels=Array.from({length:10},(_,index)=>String(820+index));
    for(let index=0;index<101;index++){if(index)f.step(1000);await f.send({channel_id:channels[Math.min(9,Math.floor(index/10))],author:{id:String(1000+index),bot:false}});}
    assert.equal((await jobs(f)).length,100);assert.equal((await f.rows('automation_events')).at(-1).outcome,'capacity');
    assert.equal((await f.rows('automation_deliveries')).filter(row=>row.channel_id===channels[9]).length,10);
  },{document:automationDocument([automationRule({channels:Array.from({length:10},(_,index)=>String(820+index)),userCooldownMs:1000})])});
  await scenario('AA10 invalid content is recorded without partial matching or retention and withdrawal stops future inspection',async f=>{
    await f.send({content:'help'+'x'.repeat(4000)});assert.equal((await f.rows('automation_events'))[0].outcome,'invalid-content');assert.equal((await jobs(f)).length,0);
    const actor=await f.actor(OTHER),fields={expectedRevision:1,action:'withdraw',document:null},review=await f.automation.review({actor,...fields});
    await f.automation.change({actor,...fields,requestId:'b'.repeat(64),reviewSha256:review.reviewSha256,confirmed:true,approvedPublic:true});
    const input=f.payload();Object.defineProperty(input.d,'content',{get(){throw Error('withdrawn content read');}});await f.sendPayload(input);
    assert.equal((await f.rows('automation_events')).length,1);
  });
  await scenario('AA11 failed outbox insert rolls back event cooldown delivery and cursor together',async f=>{
    await f.admin.query(`CREATE FUNCTION sophie_core.synthetic_automation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.kind = 'automation.dispatch' THEN RAISE EXCEPTION 'SYNTHETIC_AUTOMATION_FAILURE'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_automation_failure BEFORE INSERT ON sophie_core.outbox FOR EACH ROW EXECUTE FUNCTION sophie_core.synthetic_automation_failure()`);
    try {await assert.rejects(f.send(),/GATEWAY_PROCESSING_FAILED/);for(const table of ['automation_events','automation_cooldowns','automation_deliveries'])assert.equal((await f.rows(table)).length,0);
      assert.equal(Number((await f.rows('gateway_lifecycle'))[0].sequence),2);
    } finally {await f.admin.query('DROP TRIGGER synthetic_automation_failure ON sophie_core.outbox; DROP FUNCTION sophie_core.synthetic_automation_failure()');}
  });
  await scenario('AA12 activation changes require a fresh identify and old-mode journal calls fail closed',async f=>{
    await f.send();await f.observer.pause(f.connection);await f.admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until='-infinity'");
    const disabled=createGatewayJournal({pool:f.pool,mapping,clock:f.clock});assert.equal(disabled.messageIntents,0);
    const next=await disabled.acquire('automation-disabled');assert.equal(next.resume,null);
    assert.equal((await f.rows('gateway_lifecycle'))[0].automation_enabled,false);assert.equal((await jobs(f)).length,1);
    const enabled=createGatewayJournal({pool:f.pool,mapping,clock:f.clock,automation:f.admission});
    await assert.rejects(enabled.renew(next.lease),/GATEWAY_AUTOMATION_MODE_CHANGED/);
  });
  await scenario('AA13 migration replay and encrypted restore preserve event references cooldowns and pending jobs',async f=>{
    await f.send();assert.deepEqual(await migrateCore(f.admin),{migrations: 60});
    const configuration=stagingConfiguration('a'.repeat(64));configuration.capabilityPolicy=f.policy;configuration.automationEnabled=true;
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget(),restored=await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});
    assert.equal(restored.tableCountsVerified,true);
    for(const table of ['automation_events','automation_cooldowns','automation_deliveries'])assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_core.${table}`)).rows,await f.rows(table));
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
    assert.equal((await target.pool.query("SELECT status FROM sophie_core.outbox WHERE kind='automation.dispatch'")).rows[0].status,'parked');
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.automation_events'),error=>error.code==='42501');
  });
  let loseCommit=false;
  await scenario('AA14 a lost cursor commit acknowledgement retains one admission and resolves on fresh-service replay',async f=>{
    const input=f.payload();loseCommit=true;await assert.rejects(f.sendPayload(input),/GATEWAY_PROCESSING_FAILED/);
    assert.equal((await jobs(f)).length,1);assert.equal(Number((await f.rows('gateway_lifecycle'))[0].sequence),input.s);
    await f.admin.query("UPDATE sophie_core.gateway_lifecycle SET lease_until='-infinity'");
    const ingress=createAutomationIngress({guildId:GUILD,botUserId:BOT,clock:f.clock}),admission=createAutomationAdmission({guildId:GUILD,protectedCategoryId:PROTECTED_CATEGORY,channels:f.channels,ingress});
    const journal=createGatewayJournal({pool:f.pool,mapping,clock:f.clock,automation:admission}),{lease,resume}=await journal.acquire('lost-commit-replay');
    await journal.resume(lease);await journal.dispatch(lease,{sessionId:resume.sessionId,sequence:input.s+1,change:{kind:'resumed'}});
    const proof=admission.prepare(input);await journal.dispatch(lease,{sessionId:resume.sessionId,sequence:input.s+2,change:{kind:'ignored'},automationMessage:proof});
    assert.equal((await jobs(f)).length,1);assert.equal((await f.rows('automation_events')).length,1);
  },{journalPool:pool=>({connect:async()=>{const client=await pool.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
    const result=await client.query(...args);if(args[0]==='COMMIT'&&loseCommit){loseCommit=false;throw Error('Synthetic lost cursor commit');}return result;
  }};}})});
  await scenario('AA15 exclusion appearing after matching prevents all durable admission',async f=>{
    let calls=0;
    const channels={inspect:async id=>{const result=await f.channels.inspect(id);if(++calls===2)await f.admin.query(
      'INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,id]);return result;}};
    const admission=createAutomationAdmission({guildId:GUILD,protectedCategoryId:PROTECTED_CATEGORY,channels,ingress:f.ingress});
    const client=await f.pool.connect();
    try{await client.query('BEGIN');await admission.record(client,{proof:f.ingress.prepare(f.payload()),epoch:1,sequence:3});await client.query('COMMIT');}
    catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    assert.equal(calls,2);assert.equal((await f.rows('automation_events')).length,0);assert.equal((await jobs(f)).length,0);
  });
}
