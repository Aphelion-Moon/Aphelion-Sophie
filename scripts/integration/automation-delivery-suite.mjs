import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { automationDeliveryFixture } from '../../tests/fixtures/automation-delivery.js';
import { automationDocument, automationRule, PUBLIC_CHANNEL, PROTECTED_CATEGORY } from '../../tests/fixtures/automation.js';
import { GUILD, USER } from '../../tests/fixtures/domain.js';
import { MUZZLED } from '../../tests/fixtures/discord.js';
import { migrateCore } from '../../apps/core/storage/migrate.js';
import { createRecoveryBundle,prepareRecoveryBundle,restoreRecoveryBundle } from '../../apps/core/recovery/bundle.js';
import { reviewedRecoveryTools } from '../../apps/core/recovery/local-operations.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';

export async function runAutomationDeliverySuite(cluster,run) {
  const scenario=(name,work,options)=>run(name,async()=>work(await automationDeliveryFixture(cluster,options)));
  const reaction={document:automationDocument([automationRule({action:{kind:'reaction',emoji:{id:null,name:'✅'}}})])};
  const writes=f=>f.discord.state.calls.filter(call=>['POST','PUT'].includes(call.method));
  const exclude=f=>f.admin.query('INSERT INTO sophie_core.case_exclusions (guild_id,channel_id,parent_id) VALUES ($1,$2,null)',[GUILD,PUBLIC_CHANNEL]);
  const retry=f=>f.admin.query("UPDATE sophie_core.outbox SET available_at='-infinity' WHERE kind='automation.dispatch'");
  await scenario('AD01 approved static message commits send intent receipt and fresh verification without duplicate creation',async f=>{
    await f.send();assert.equal((await f.run()).status,'progressed');assert.equal((await f.record()).state,'pending');
    assert.equal((await f.record()).receipt_available,true);assert.equal((await f.run()).status,'settled');assert.equal((await f.record()).state,'confirmed');
    assert.equal((await f.run()).status,'idle');assert.equal(writes(f).length,1);
    assert.deepEqual((await f.rows('automation_delivery_events')).map(row=>row.kind),['send-started','receipt','confirmed']);
  });
  await scenario('AD02 own reaction is verified in a fresh worker turn and never repeated',async f=>{
    const id=await f.send();await f.run();await f.run();assert.equal((await f.record()).state,'confirmed');assert.equal(writes(f).length,1);
    assert.equal(f.discord.state.messages.get(id).reactions[0].me,true);assert.equal((await f.record()).sent_message_id,null);
  },reaction);
  await scenario('AD03 expired pending actions cancel and release queue capacity while preserving history',async f=>{
    for(let index=0;index<5;index++){await f.send();f.step(3000);}f.step(60000);
    await f.drain(f.worker);assert.equal((await f.rows('automation_deliveries')).filter(row=>row.state==='cancelled').length,5);
    assert.equal(writes(f).length,0);await f.send();await f.drain(f.worker);assert.equal((await f.rows('automation_deliveries')).filter(row=>row.state==='confirmed').length,1);
  });
  await scenario('AD04 withdrawn policy cancels unstarted jobs without reading source messages',async f=>{
    await f.send();await f.withdraw();await f.drain(f.worker);assert.equal((await f.record()).withdrawal_reason,'policy');
    assert.equal(writes(f).length,0);assert.equal(f.discord.state.calls.some(call=>call.path.includes('/messages/')),false);
  });
  await scenario('AD05 retained case exclusions cancel before fetching any source message metadata',async f=>{
    await f.send();await exclude(f);await f.drain(f.worker);assert.equal((await f.record()).state,'cancelled');
    assert.equal(f.discord.state.calls.some(call=>call.path.includes('/messages/')),false);
  });
  await scenario('AD06 current missing or Muzzled membership prevents an automatic send',async f=>{
    await f.send();f.discord.state.members.set(USER,[MUZZLED]);await f.drain(f.worker);assert.equal((await f.record()).state,'cancelled');assert.equal(writes(f).length,0);
  });
  await scenario('AD07 disabling automation cancels pending work and withdraws a known unconfirmed effect',async f=>{
    await f.send();await f.run();f.control.active=false;await f.drain(f.worker);
    assert.equal((await f.record()).state,'withdrawn');assert.equal(f.discord.state.messages.has((await f.record()).sent_message_id),false);
    f.step(3000);await f.send();await f.drain(f.worker);assert.equal((await f.rows('automation_deliveries'))[1].state,'cancelled');assert.equal(writes(f).length,1);
  });
  await scenario('AD08 a case transition after a positive send removes only the retained own effect without reading case bodies',async f=>{
    await f.send();await f.run();await exclude(f);const start=f.discord.state.calls.length;await f.drain(f.worker);
    assert.equal((await f.record()).state,'withdrawn');assert.equal(f.discord.state.calls.slice(start).some(call=>call.method==='GET'&&call.path.includes('/messages/')),false);
  });
  await scenario('AD09 an unknown create response parks possible-send state and a fresh worker never posts again',async f=>{
    await f.send();f.discord.state.afterWrite=()=>{throw Error('Synthetic lost response');};
    assert.deepEqual(await f.run(),{status:'operator_required',code:'AUTOMATION_UNCERTAIN'});f.discord.state.afterWrite=null;
    assert.equal((await f.record()).create_started,true);assert.equal((await f.record()).receipt_available,false);assert.equal((await f.run()).status,'idle');assert.equal(writes(f).length,1);
  });
  await scenario('AD10 a late positive receipt survives lease loss and wakes an uncertainty job for verification',async f=>{
    await f.send();const {claim}=await f.outbox.claim('original',30000,['automation.dispatch']);const state=await f.store.prepare(claim);await f.store.begin(claim,state.proof);
    const proof=await f.messages.create(state.plan,state.proof);
    await f.admin.query("UPDATE sophie_core.outbox SET lease_until='-infinity' WHERE kind='automation.dispatch'");
    assert.deepEqual(await f.run(),{status:'operator_required',code:'AUTOMATION_UNCERTAIN'});
    await f.store.note(claim,proof);await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');assert.equal(writes(f).length,1);
    await f.store.note(claim,proof);assert.equal((await f.job()).status,'done');
  });
  await scenario('AD11 lost withdrawal response retries only idempotent removal and never recreates the message',async f=>{
    await f.send();await f.run();await f.withdraw();f.discord.state.afterWrite=call=>{if(call.method==='DELETE')throw Error('Synthetic lost removal');};
    assert.equal((await f.run()).status,'retry_scheduled');f.discord.state.afterWrite=null;await retry(f);await f.drain(f.worker);
    assert.equal((await f.record()).state,'withdrawn');assert.equal(writes(f).length,1);
  });
  await scenario('AD12 an existing bot reaction belongs to no new job and is neither adopted nor removed',async f=>{
    const id=await f.send();f.discord.state.messages.get(id).reactions=[{emoji:{id:null,name:'✅'},me:true}];await f.drain(f.worker);
    assert.equal((await f.record()).state,'cancelled');assert.equal((await f.record()).withdrawal_reason,'existing-reaction');assert.equal(writes(f).length,0);
    assert.equal(f.discord.state.messages.get(id).reactions[0].me,true);
  },reaction);
  await scenario('AD13 missing confirmed reaction is withdrawn without recreating it',async f=>{
    const id=await f.send();await f.run();f.discord.state.messages.get(id).reactions[0].me=false;await f.drain(f.worker);
    assert.equal((await f.record()).state,'withdrawn');assert.equal(writes(f).length,1);
  },reaction);
  await scenario('AD14 definite rate limit releases unsent state and persists the shared barrier',async f=>{
    await f.send();f.discord.state.before=call=>call.method==='POST'?new Response(JSON.stringify({retry_after:1,global:true}),{status:429}):null;
    assert.equal((await f.run()).code,'RATE_LIMITED');assert.equal((await f.record()).create_started,false);
    assert.ok((await f.rows('discord_backoff'))[0].until_at>new Date());f.discord.state.before=null;f.step(1001);
    await f.admin.query("UPDATE sophie_core.discord_backoff SET until_at='-infinity'");await retry(f);await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');
  });
  await scenario('AD15 a definite invalid action cancels without ambiguous possible-send state',async f=>{
    await f.send();f.discord.state.before=call=>call.method==='POST'?new Response('{}',{status:400}):null;await f.drain(f.worker);
    assert.equal((await f.record()).state,'cancelled');assert.equal((await f.record()).create_started,false);
  });
  await scenario('AD16 action-reference corruption parks instead of sending a different retained rule',async f=>{
    await f.send();await f.admin.query("UPDATE sophie_core.automation_deliveries SET action_sha256=repeat('f',64)");
    assert.deepEqual(await f.run(),{status:'operator_required',code:'AUTOMATION_CORRUPT'});assert.equal(writes(f).length,0);
  });
  await scenario('AD17 concurrent workers retain one fenced send and one confirmation',async f=>{
    await f.send();const results=await Promise.all([f.run(),f.run()]);assert.ok(results.some(result=>result.status==='progressed'));
    await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');assert.equal(writes(f).length,1);
  });
  await scenario('AD18 protected category drift after preparation cancels at the durable send boundary',async f=>{
    await f.send();const {claim}=await f.outbox.claim('race-worker',30000,['automation.dispatch']),state=await f.store.prepare(claim);
    f.discord.state.channels.get(PUBLIC_CHANNEL).parent_id=PROTECTED_CATEGORY;assert.equal((await f.store.begin(claim,state.proof)).settled,true);
    assert.equal((await f.record()).state,'cancelled');assert.equal(writes(f).length,0);
  });
  await scenario('AD19 removed source messages prevent initial automatic delivery',async f=>{
    const id=await f.send();f.discord.state.messages.delete(id);await f.drain(f.worker);assert.equal((await f.record()).state,'cancelled');assert.equal(writes(f).length,0);
  });
  await scenario('AD20 encrypted restore preserves delivery attempts receipts audit and quarantined jobs',async f=>{
    await f.send();await f.run();assert.deepEqual(await migrateCore(f.admin),{migrations: 55});
    const configuration=stagingConfiguration('a'.repeat(64));configuration.capabilityPolicy=f.policy;configuration.automationEnabled=true;
    const {configuration:database,binaryRoot,directory:parent}=cluster.recovery,tools=await reviewedRecoveryTools(binaryRoot),key=randomBytes(32),maxDatabaseBytes=33554432;
    const backup=await createRecoveryBundle({pool:f.admin,database,tools,configuration,buildId:'a'.repeat(64),vaultRoots:[],parent,key,maxDatabaseBytes});
    const prepared=await prepareRecoveryBundle({directory:backup.directory,parent,key,maxDatabaseBytes,confirmGuildId:GUILD,expectedManifestSha256:backup.manifestSha256});
    const target=await cluster.recovery.createTarget(),restored=await restoreRecoveryBundle({prepared,pool:target.pool,database:target.configuration,tools});assert.equal(restored.tableCountsVerified,true);
    for(const table of ['automation_deliveries','automation_delivery_events'])assert.deepEqual((await target.pool.query(`SELECT * FROM sophie_core.${table}`)).rows,await f.rows(table));
    assert.equal((await target.pool.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
    assert.equal((await target.pool.query("SELECT status FROM sophie_core.outbox WHERE kind='automation.dispatch'")).rows[0].status,'parked');
    await assert.rejects(f.pool.query('DELETE FROM sophie_core.automation_delivery_events'),error=>error.code==='42501');
    await assert.rejects(cluster.knowledgePool.query('SELECT * FROM sophie_core.automation_delivery_events'),error=>error.code==='42501');
  });
  await scenario('AD21 unknown reaction response parks without a repeat PUT or removal of an unproven effect',async f=>{
    const id=await f.send();f.discord.state.afterWrite=()=>{throw Error('Synthetic lost reaction response');};
    assert.deepEqual(await f.run(),{status:'operator_required',code:'AUTOMATION_UNCERTAIN'});f.discord.state.afterWrite=null;
    await f.withdraw();assert.equal((await f.run()).status,'idle');assert.equal(f.discord.state.messages.get(id).reactions[0].me,true);assert.equal(writes(f).length,1);
  },reaction);
  await scenario('AD22 a lost receipt COMMIT acknowledgement recovers the retained receipt without another creation',async f=>{
    await f.send();const {claim}=await f.outbox.claim('commit-worker',30000,['automation.dispatch']),state=await f.store.prepare(claim);await f.store.begin(claim,state.proof);
    const proof=await f.messages.create(state.plan,state.proof);let lose=true;
    const pool={connect:async()=>{const client=await f.pool.connect();return {release:discard=>client.release(discard),query:async(...args)=>{
      const result=await client.query(...args);if(args[0]==='COMMIT'&&lose){lose=false;throw Error('Synthetic lost receipt commit');}return result;
    }};}};
    await assert.rejects(f.services({pool}).store.note(claim,proof),/Synthetic lost receipt commit/);
    await f.admin.query("UPDATE sophie_core.outbox SET lease_until='-infinity' WHERE kind='automation.dispatch'");
    await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');assert.equal(writes(f).length,1);
  });
  await scenario('AD23 a late removal proof survives lease loss and is settled by a fresh fenced worker',async f=>{
    await f.send();await f.run();await f.withdraw();const {claim}=await f.outbox.claim('remove-worker',30000,['automation.dispatch']),state=await f.store.prepare(claim);
    const proof=await f.messages.remove(state.plan,state.row.sent_message_id);
    await f.admin.query("UPDATE sophie_core.outbox SET lease_until='-infinity' WHERE kind='automation.dispatch'");
    await f.store.removed(claim,proof);await f.drain(f.worker);assert.equal((await f.record()).state,'withdrawn');assert.equal(writes(f).length,1);
  });
  await scenario('AD24 receipt and audit roll back together when retention is unavailable',async f=>{
    await f.send();const {claim}=await f.outbox.claim('audit-worker',30000,['automation.dispatch']),state=await f.store.prepare(claim);await f.store.begin(claim,state.proof);
    const proof=await f.messages.create(state.plan,state.proof);
    await f.admin.query('REVOKE INSERT ON sophie_core.automation_delivery_events FROM sophie_test_core');
    try { await assert.rejects(f.store.note(claim,proof),error=>error.code==='42501');assert.equal((await f.record()).receipt_available,false); }
    finally {await f.admin.query('GRANT INSERT ON sophie_core.automation_delivery_events TO sophie_test_core');}
    await f.store.note(claim,proof);await f.outbox.continue(claim);await f.drain(f.worker);assert.equal((await f.record()).state,'confirmed');assert.equal(writes(f).length,1);
  });
}
