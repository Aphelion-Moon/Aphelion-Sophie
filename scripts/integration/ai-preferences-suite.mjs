import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAiControls } from '../../apps/core/storage/ai-controls.js';
import { createPreferenceJournal, initializePreferenceJournal } from '../../apps/core/storage/preference-journal.js';
import { PREFERENCE_LIFETIME_MS } from '../../modules/assistant/preferences.js';

export async function runAiPreferencesSuite(cluster,run) {
  const {adminPool:admin,corePool:pool}=cluster;
  await admin.query('GRANT SELECT,INSERT,UPDATE ON sophie_ai.response_preferences TO sophie_test_core');
  const actor={guildId:'919',userId:'202',capabilityEpoch:1,policyVersion:1},path=resolve(cluster.recovery.directory,'independent-preferences.jsonl'),id='9'.repeat(64);
  await initializePreferenceJournal({path,id});let qualified=true,permitted=true,revokeAfterWrite=false,checks=0;
  const ledger=createPreferenceJournal({path,id,qualified:async()=>qualified});
  const options={pool,guildId:actor.guildId,authorize:async(action,candidate,scope)=>{
    checks++;assert.equal(action,'ai.self');assert.equal(scope.userId,actor.userId);return permitted && candidate===actor;
  },inspectChannel:async()=>null,memberPresence:async()=>1};
  const store=createAiControls({...options,preferenceJournal:{read:ledger.read,advance:async(...args)=>{const result=await ledger.advance(...args);if(revokeAfterWrite)permitted=false;return result;}}});
  const own=()=>store.ownPreferences({actor}),row=async()=>(await admin.query('SELECT * FROM sophie_ai.response_preferences WHERE guild_id=$1 AND user_id=$2',[actor.guildId,actor.userId])).rows[0];
  const save=(expectedEpoch,settings={replyLength:'brief',language:'pt-br'})=>store.savePreferences({actor,expectedEpoch,settings,confirmed:true});
  const remove=expectedEpoch=>store.deletePreferences({actor,expectedEpoch,confirmed:true});
  let epoch=0;
  await run('DS-08 M01 explicit typed self preferences are inspectable and separately held from remote use',async()=>{
    assert.equal((await own()).epoch,0);const before=Date.now(),saved=await save(0);epoch=saved.epoch;
    assert.deepEqual(saved.settings,{replyLength:'brief',language:'pt-BR'});assert.equal(saved.remoteUse,false);
    assert.ok(saved.expiresAt>=before+PREFERENCE_LIFETIME_MS);assert.deepEqual((await own()).settings,saved.settings);assert.ok(checks>=6);
    await assert.rejects(store.ownPreferences({actor:{...actor}}),/OPERATION_DENIED/);
    assert.equal((await createAiControls(options).ownPreferences({actor})).available,false);
    assert.equal((await readFile(path,'utf8')).includes('pt-BR'),false);
  });
  await run('DS-08 M02 concurrent edits serialize and arbitrary facts or private language payloads cannot be saved',async()=>{
    const edits=await Promise.allSettled([save(epoch,{replyLength:'standard',language:'pl'}),save(epoch,{replyLength:'detailed',language:'de'})]);
    assert.equal(edits.filter(item=>item.status==='fulfilled').length,1);epoch++;
    assert.match(edits.find(item=>item.status==='rejected').reason.message,/AI_PREFERENCE_STALE/);
    for(const settings of [{replyLength:'brief',language:'en-x-private'},{replyLength:'brief',language:'en',biography:'sensitive'},{replyLength:'do what I say',language:null}])await assert.rejects(save(epoch,settings),/AI_PREFERENCE_INVALID/);
    assert.equal(await ledger.read(actor.guildId,actor.userId),epoch);
  });
  await run('DS-08 M03 delete tombstones prevent old database copies and stale writes from resurrecting settings',async()=>{
    const old=await row();await remove(epoch);epoch++;assert.equal((await row()).settings,null);
    await assert.rejects(save(epoch-1),/AI_PREFERENCE_STALE/);
    await admin.query('UPDATE sophie_ai.response_preferences SET epoch=$3,settings=$4,expires_at=$5 WHERE guild_id=$1 AND user_id=$2',[actor.guildId,actor.userId,old.epoch,old.settings,old.expires_at]);
    assert.equal((await own()).quarantined,true);assert.equal((await own()).settings,null);
    await assert.rejects(save(epoch),/AI_PREFERENCE_RESTORE_QUARANTINED/);
    await remove(epoch);epoch++;assert.equal((await own()).quarantined,false);assert.equal((await own()).settings,null);
  });
  await run('DS-08 M04 a watermark committed without the database is recoverable only by a fresh explicit deletion',async()=>{
    await ledger.advance(actor.guildId,actor.userId,epoch,epoch+1);epoch++;
    const current=await own();assert.equal(current.quarantined,true);assert.equal(current.epoch,epoch);
    qualified=false;await assert.rejects(own(),/AI_PREFERENCE_JOURNAL_UNAVAILABLE/);qualified=true;
    await remove(epoch);epoch++;await save(epoch);epoch++;
  });
  await run('DS-08 M05 expired plaintext is removed and an old expiry cannot be renewed by a read',async()=>{
    await admin.query("UPDATE sophie_ai.response_preferences SET expires_at=clock_timestamp()-interval '1 second' WHERE guild_id=$1 AND user_id=$2",[actor.guildId,actor.userId]);
    assert.equal((await own()).settings,null);assert.equal((await row()).settings,null);assert.equal(await ledger.read(actor.guildId,actor.userId),epoch);
  });
  await run('DS-08 M06 authority loss after journal sync rolls back values and leaves a restore quarantine',async()=>{
    revokeAfterWrite=true;await assert.rejects(save(epoch),/OPERATION_DENIED/);epoch++;
    permitted=true;revokeAfterWrite=false;const current=await own();assert.equal(current.epoch,epoch);assert.equal(current.quarantined,true);assert.equal(current.settings,null);
    await remove(epoch);epoch++;
  });
}
