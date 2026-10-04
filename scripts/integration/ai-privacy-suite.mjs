import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createAiControls } from '../../apps/core/storage/ai-controls.js';
import { createAiDepartures, recordAiDeparture } from '../../apps/core/storage/ai-departures.js';
import { createAiPrivacy, aiReceiptHash } from '../../apps/core/storage/ai-privacy.js';
import { createPreferenceJournal, initializePreferenceJournal } from '../../apps/core/storage/preference-journal.js';
import { createAiAdmission } from '../../apps/core/storage/ai-admission.js';
import { createAiIngress } from '../../apps/core/discord/ai-ingress.js';
import { DEFAULT_AI_BUDGET } from '../../modules/assistant/budget.js';
import { requireInstalledAiDatabase } from '../../apps/core/runtime/installed.js';

export async function runAiPrivacySuite(cluster,run) {
  const {adminPool:admin,corePool:pool}=cluster,guildId='929',actor={guildId,userId:'202',capabilityEpoch:1,policyVersion:1};
  await run('AI-D11 installed control rejects any missing schema066 deletion grant',async()=>{
    await admin.query('CREATE ROLE sophie_test_departure_control NOLOGIN');
    await admin.query('GRANT USAGE ON SCHEMA sophie_ai TO sophie_test_departure_control');
    const grants=[['request_tombstones','SELECT'],['request_tombstones','INSERT'],['effect_erasure','SELECT'],
      ['effect_erasure','INSERT'],['effect_erasure','DELETE'],['consents','DELETE'],['request_receipts','DELETE']];
    for(const [table,privilege] of grants) await admin.query(`GRANT ${privilege} ON sophie_ai.${table} TO sophie_test_departure_control`);
    const client=await admin.connect();
    async function inspect(){await client.query('BEGIN');try{
      await client.query('SET LOCAL ROLE sophie_test_departure_control');await requireInstalledAiDatabase(client,'control');
    }finally{await client.query('ROLLBACK');}}
    try {
      await inspect();
      for(const [table,privilege] of grants){
        await admin.query(`REVOKE ${privilege} ON sophie_ai.${table} FROM sophie_test_departure_control`);
        await assert.rejects(inspect(),/AI_DATABASE_PRIVILEGES_MISSING/);
        await admin.query(`GRANT ${privilege} ON sophie_ai.${table} TO sophie_test_departure_control`);
      }
      await inspect();
    }finally{client.release();}
  });
  await admin.query('GRANT SELECT,INSERT,UPDATE,DELETE ON sophie_ai.consents,sophie_ai.request_receipts,sophie_ai.request_tombstones,sophie_ai.effect_erasure,sophie_ai.response_preferences TO sophie_test_core');
  await admin.query('INSERT INTO sophie_core.capability_policies(guild_id,version,policy) VALUES($1,1,$2)',[guildId,{guildId,version:1}]);
  await admin.query('INSERT INTO sophie_core.actor_authority(guild_id,user_id,capability_epoch,policy_version,observation) VALUES($1,$2,1,1,$3)',[guildId,actor.userId,{guildId,userId:actor.userId,present:true}]);
  const path=resolve(cluster.recovery.directory,'departure-privacy.jsonl'),id='8'.repeat(64);
  await initializePreferenceJournal({path,id});let qualified=true,removed=[],faults=[];
  const diskJournal=createPreferenceJournal({path,id,qualified:async()=>qualified}),departures=createAiDepartures({pool,guildId});
  let synced=null,commitGate=null;
  const journal={read:diskJournal.read,advance:async(...args)=>{const result=await diskJournal.advance(...args);synced?.();if(commitGate)await commitGate;return result;}};
  const privacy=()=>createAiPrivacy({pool,guildId,journal,departures,onFault:code=>faults.push(code),removeEffect:async effect=>{
    removed.push(effect.receipt_id);await pool.query("UPDATE sophie_ai.effects SET state='removed' WHERE guild_id=$1 AND message_id=$2",[guildId,effect.message_id]);
  }});
  const controls=createAiControls({pool,guildId,preferenceJournal:journal,privacyCurrent:privacy().current,
    authorize:async(action,who,scope)=>action==='ai.self' && who===actor && scope.userId===actor.userId,memberPresence:async()=>1,inspectChannel:async()=>null});
  const own=()=>controls.ownPreferences({actor});
  const row=async()=>(await pool.query('SELECT * FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2',[guildId,actor.userId])).rows[0];
  const save=async()=>controls.savePreferences({actor,expectedEpoch:(await own()).epoch,settings:{replyLength:'brief',language:'pl'},confirmed:true});
  const retention=async value=>controls.saveRetention({actor,expectedEpoch:(await own()).epoch,retainOnLeave:value,confirmed:true});
  const leave=()=>recordAiDeparture(pool,guildId,actor.userId);
  async function consent() {await pool.query(`INSERT INTO sophie_ai.consents(guild_id,user_id,channel_id,epoch,enabled,presence_epoch,notice_revision)
    VALUES($1,$2,'303',1,true,1,1) ON CONFLICT(guild_id,channel_id,user_id) DO UPDATE SET enabled=true`,[guildId,actor.userId]);}
  async function receipt(id,userId=actor.userId) {await pool.query(`INSERT INTO sophie_ai.request_receipts(guild_id,message_id,channel_id,user_id,input_revision,state,deadline)
    VALUES($1,$2,'303',$3,$4,'admitted',clock_timestamp()+interval '15 seconds')`,[guildId,id,userId,'a'.repeat(64)]);}
  await run('DS08-D01 departure defaults to deletion and preserves only deletion/replay fences',async()=>{
    assert.equal((await own()).retainOnLeave,false);const saved=await save();await consent();await receipt('701');
    await leave();assert.equal(await privacy().current(actor.userId),false);assert.equal((await own()).settings,null);
    await assert.rejects(controls.saveRetention({actor,expectedEpoch:saved.epoch,retainOnLeave:true,confirmed:true}),/AI_DELETION_PENDING/);
    await privacy().maintain();assert.equal(await departures.pending(actor.userId),false);
    assert.equal((await row()).settings,null);assert.equal((await row()).retain_on_leave,false);
    for(const table of ['consents','request_receipts'])assert.equal((await pool.query(`SELECT 1 FROM sophie_ai.${table} WHERE guild_id=$1 AND user_id=$2`,[guildId,actor.userId])).rowCount,0);
    assert.equal((await pool.query('SELECT message_hash FROM sophie_ai.request_tombstones WHERE guild_id=$1',[guildId])).rows[0].message_hash,aiReceiptHash(guildId,'701'));
    const epoch=await journal.read(guildId,actor.userId);await privacy().maintain();assert.equal(await journal.read(guildId,actor.userId),epoch);
  });
  await run('DS08-D02 explicit retention preserves settings and expiry without restoring active consent',async()=>{
    const saved=await save();await retention(true);await consent();await receipt('706');
    await pool.query("UPDATE sophie_ai.request_receipts SET state='delivered' WHERE guild_id=$1 AND message_id='706'",[guildId]);
    await leave();await privacy().maintain();
    const kept=await own();assert.equal(kept.retainOnLeave,true);assert.deepEqual(kept.settings,saved.settings);assert.equal(kept.expiresAt,saved.expiresAt);
    assert.equal((await controls.ownConsents({actor})).channels[0].enabled,false);
    assert.equal((await pool.query("SELECT state FROM sophie_ai.request_receipts WHERE guild_id=$1 AND message_id='706'",[guildId])).rows[0].state,'delivered');
    const stale=kept.epoch;await retention(false);
    await assert.rejects(controls.saveRetention({actor,expectedEpoch:stale,retainOnLeave:true,confirmed:true}),/AI_PREFERENCE_STALE/);
  });
  await run('DS08-D03 default departure survives failure and restart; stale retained copies cannot resurrect data',async()=>{
    await retention(true);const old=await row();await retention(false);await consent();await leave();
    qualified=false;await privacy().maintain();assert.ok(faults.includes('AI_DELETION_UNAVAILABLE'));assert.equal(await departures.pending(actor.userId),true);qualified=true;
    await privacy().maintain();assert.equal((await row()).settings,null);
    await admin.query('UPDATE sophie_ai.response_preferences SET epoch=$3,settings=$4,expires_at=$5,retain_on_leave=true,departure_epoch=$6 WHERE guild_id=$1 AND user_id=$2',
      [guildId,actor.userId,old.epoch,old.settings,old.expires_at,old.departure_epoch]);await consent();
    assert.equal(await privacy().current(actor.userId),false);assert.equal((await own()).settings,null);
    await privacy().maintain();assert.equal((await own()).retainOnLeave,false);assert.equal((await own()).settings,null);
    assert.deepEqual((await controls.ownConsents({actor})).channels,[]);
  });
  await run('DS08-D04 unresolved effects keep erasure pending; late acknowledgement permits exact cleanup then deletion',async()=>{
    await save();await receipt('702');await receipt('703','404');
    for(const id of ['702','703'])await admin.query(`INSERT INTO sophie_ai.effects(guild_id,message_id,owner,channel_id,kind,dependencies,sources,state,deadline)
      VALUES($1,$2,gen_random_uuid(),'303','reply',$3,'[]','attempted',clock_timestamp()+interval '15 seconds')`,[guildId,id,JSON.stringify([{userId:actor.userId,messageId:'702'}])]);
    await leave();await privacy().maintain();assert.equal(await departures.pending(actor.userId),true);assert.equal((await row()).settings,null);
    assert.ok(faults.includes('AI_DELETION_PENDING'));assert.equal(removed.length,0);
    assert.ok((await pool.query('SELECT dependencies FROM sophie_ai.effects WHERE guild_id=$1',[guildId])).rows.every(row=>row.dependencies.length===0));
    await admin.query("UPDATE sophie_ai.effects SET receipt_id='909' WHERE guild_id=$1 AND message_id='702'",[guildId]);
    await privacy().maintain();assert.deepEqual(removed,['909']);await privacy().maintain();assert.equal(await departures.pending(actor.userId),true);
    await admin.query("UPDATE sophie_ai.effects SET receipt_id='910' WHERE guild_id=$1 AND message_id='703'",[guildId]);
    await privacy().maintain();assert.deepEqual(removed,['909','910']);await privacy().maintain();assert.equal(await departures.pending(actor.userId),false);
    assert.equal((await pool.query('SELECT 1 FROM sophie_ai.effect_erasure WHERE guild_id=$1',[guildId])).rowCount,0);
    assert.equal((await pool.query("SELECT 1 FROM sophie_ai.request_receipts WHERE guild_id=$1 AND message_id='703'",[guildId])).rowCount,1);
  });
  await run('DS08-D05 acknowledgement of an older departure cannot swallow a newer departure',async()=>{
    await leave();const old=(await departures.list())[0];await leave();await departures.complete(old);
    assert.equal(await departures.pending(actor.userId),true);await privacy().maintain();assert.equal(await departures.pending(actor.userId),false);
    const peer={...actor,userId:'404'};await assert.rejects(controls.saveRetention({actor:peer,expectedEpoch:0,retainOnLeave:true,confirmed:true}),/OPERATION_DENIED/);
  });
  await run('DS08-D07 a journal write in flight is not mistaken for restored data',async()=>{
    let release;commitGate=new Promise(resolve=>{release=resolve;});const reached=new Promise(resolve=>{synced=resolve;});
    const saving=save();await reached;let checked=false;const checking=privacy().current(actor.userId).then(value=>{checked=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(checked,false);
    release();await saving;assert.equal(await checking,true);synced=null;commitGate=null;
    assert.equal(await departures.pending(actor.userId),false);
  });
  await run('DS08-D08 erased requests cannot be replayed even before channel or member metadata is read',async()=>{
    const ingress=createAiIngress({guildId,botUserId:'505',clock:Date.now});
    const admission=createAiAdmission({pool,guildId,ingress,clock:Date.now,
      inspectContext:async()=>assert.fail('tombstone must precede observations'),inspectMember:async()=>assert.fail('tombstone must precede observations')});
    const proof=ingress.prepare({t:'MESSAGE_CREATE',d:{type:0,guild_id:guildId,channel_id:'303',id:'701',author:{id:actor.userId,bot:false},content:'Synthetic replay',mentions:[],attachments:[]}});
    assert.notEqual(proof,null);assert.equal(await admission.admit(proof),null);
  });
  await run('DS08-D09 deletion releases unsent reservations, preserves uncertain costs and later removes resolved identities',async()=>{
    await receipt('704');await receipt('705');
    for(const period of ['2026-10','2026-10-04'])await pool.query('INSERT INTO sophie_ai.budget_periods(guild_id,period,reserved_nanos,attempts) VALUES($1,$2,150,2)',[guildId,period]);
    for(const [messageId,state,amount] of [['704','uncertain',100],['705','reserved',50]])await pool.query(`INSERT INTO sophie_ai.provider_attempts(guild_id,message_id,fence,state,policy_revision,price,month_period,day_period,control_epoch,input_revision,reserved_nanos,deadline,prompt_bytes,output_tokens)
      VALUES($1,$2,gen_random_uuid(),$3,1,$4,'2026-10','2026-10-04',0,$5,$6,clock_timestamp()+interval '15 seconds',1,1)`,[guildId,messageId,state,DEFAULT_AI_BUDGET,'a'.repeat(64),amount]);
    await leave();await privacy().maintain();assert.equal(await departures.pending(actor.userId),true);
    assert.deepEqual((await pool.query('SELECT message_id,state FROM sophie_ai.provider_attempts WHERE guild_id=$1',[guildId])).rows,[{message_id:'704',state:'uncertain'}]);
    assert.ok((await pool.query('SELECT reserved_nanos FROM sophie_ai.budget_periods WHERE guild_id=$1',[guildId])).rows.every(row=>row.reserved_nanos==='100'));
    // Synthetic acknowledgement of the existing operator resolution flow, not an automatic write-off.
    await admin.query("UPDATE sophie_ai.provider_attempts SET state='settled',settled_nanos=100 WHERE guild_id=$1 AND message_id='704'",[guildId]);
    await admin.query('UPDATE sophie_ai.budget_periods SET reserved_nanos=0,settled_nanos=100 WHERE guild_id=$1',[guildId]);
    await privacy().maintain();assert.equal(await departures.pending(actor.userId),false);
    assert.equal((await pool.query('SELECT 1 FROM sophie_ai.provider_attempts WHERE guild_id=$1',[guildId])).rowCount,0);
    assert.ok((await pool.query('SELECT settled_nanos FROM sophie_ai.budget_periods WHERE guild_id=$1',[guildId])).rows.every(row=>row.settled_nanos==='100'));
  });
}
