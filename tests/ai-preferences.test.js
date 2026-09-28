import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPreferenceJournal, initializePreferenceJournal } from '../apps/core/storage/preference-journal.js';
import { createAiControlsHttp } from '../apps/core/http/ai-controls.js';

async function fixture() {
  const base=resolve('.local/preference-unit');await mkdir(base,{recursive:true});const root=await mkdtemp(resolve(base,'run-'));
  const path=resolve(root,'journal.jsonl'),id='a'.repeat(64);await initializePreferenceJournal({path,id});
  return {path,id,journal:createPreferenceJournal({path,id,qualified:async()=>true})};
}
test('DS-08 independent journal rejects missing, truncated, changed-identity and concurrently locked authority',async()=>{
  const f=await fixture();assert.equal(await f.journal.read('101','202'),0);
  await f.journal.advance('101','202',0,1);await f.journal.advance('101','202',1,2);
  assert.equal(await f.journal.read('101','202'),2);
  await assert.rejects(createPreferenceJournal({path:resolve(f.path,'missing'),id:f.id,qualified:async()=>true}).read('101','202'),/AI_PREFERENCE_JOURNAL_UNAVAILABLE/);
  await assert.rejects(createPreferenceJournal({path:f.path,id:'b'.repeat(64),qualified:async()=>true}).read('101','202'),/AI_PREFERENCE_JOURNAL_UNAVAILABLE/);
  const text=await readFile(f.path,'utf8');await writeFile(f.path,text.slice(0,-1));await assert.rejects(f.journal.read('101','202'),/AI_PREFERENCE_JOURNAL_UNAVAILABLE/);
  await writeFile(f.path,text);await writeFile(`${f.path}.lock`,'synthetic abandoned lock');await assert.rejects(f.journal.read('101','202'),/AI_PREFERENCE_JOURNAL_UNAVAILABLE/);
  assert.equal(await readFile(`${f.path}.lock`,'utf8'),'synthetic abandoned lock');
});
test('DS-08 preference HTTP binds the member and requires explicit save or delete without extra data fields',async()=>{
  const actor={guildId:'101',userId:'202'},proof={},seen=[];
  const http=createAiControlsHttp({auth:{authenticate:async()=>({proof}),resolvePrincipal:async()=>({})},authorization:{resolveActor:async()=>actor},
    controls:{ownPreferences:async input=>{seen.push(input);return {remoteUse:false};},savePreferences:async input=>{seen.push(input);return {remoteUse:false};},deletePreferences:async input=>{seen.push(input);return {remoteUse:false};}}});
  const input={path:'/api/ai/preferences',method:'GET',query:new URLSearchParams(),body:null,credentials:{}};
  assert.equal((await http.execute(input)).actorId,actor.userId);
  const save={...input,path:'/api/ai/save-preferences',method:'POST',body:{expectedEpoch:0,settings:{replyLength:'brief',language:'en'},confirmed:true}};
  await http.execute(save);assert.equal(seen.at(-1).actor,actor);
  await assert.rejects(http.execute({...save,body:{...save.body,userId:'303'}}),/AI_INPUT_INVALID/);
  await http.execute({...save,path:'/api/ai/delete-preferences',body:{expectedEpoch:1,confirmed:true}});assert.equal(seen.length,3);
});
