import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPreferenceJournal, initializePreferenceJournal } from '../apps/core/storage/preference-journal.js';
import { createAiControlsHttp } from '../apps/core/http/ai-controls.js';
import { createDashboardAuthHttpServer } from '../apps/core/http/dashboard-auth.js';
import { ContractError } from '../contracts/validation.js';
import { dashboardConfiguration } from './fixtures/oauth.js';
import { dashboardHttp } from './fixtures/dashboard-http.js';

async function fixture() {
  const base=resolve('.local/preference-unit');await mkdir(base,{recursive:true});const root=await mkdtemp(resolve(base,'run-'));
  const path=resolve(root,'journal.jsonl'),id='a'.repeat(64);await initializePreferenceJournal({path,id});
  return {path,id,journal:createPreferenceJournal({path,id,qualified:async()=>true})};
}
test('DS-08 independent journal rejects missing, truncated, changed-identity and concurrently locked authority',async()=>{
  const f=await fixture();assert.equal(await f.journal.read('101','202'),0);
  await f.journal.advance('101','202',0,1);await f.journal.advance('101','202',1,2);
  assert.equal(await f.journal.read('101','202'),2);
  await assert.rejects(f.journal.advance('101','202',1,3),/AI_PREFERENCE_STALE/);
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

test('DS08-E01 attachment export binds the current member and fails closed on access or restore changes',async()=>{
  const token='a'.repeat(64),actor={guildId:'101',userId:'202'},proof={},reads=[];
  let principalCurrent=true,available=true,quarantined=false;
  const auth={authenticate:async input=>{assert.equal(input.method,'GET');if(input.token!==token)throw new ContractError('DASHBOARD_SESSION_INVALID');return {proof};},
    resolvePrincipal:async input=>{assert.equal(input,proof);if(!principalCurrent)throw new ContractError('DASHBOARD_SESSION_INVALID');return {};}},authorization={resolveActor:async input=>{assert.equal(input,proof);return actor;}};
  const controls={ownPreferences:async input=>{reads.push(input);return {available,quarantined,epoch:1,settings:{replyLength:'brief',language:'pl'},remoteUse:false,expiresAt:Date.now()+86400000,provenance:'member-saved',scope:'self'};}};
  const ai=createAiControlsHttp({auth,authorization,controls});
  const server=createDashboardAuthHttpServer({configuration:dashboardConfiguration,auth,authorization,ai,enabled:async()=>true,onFault:()=>assert.fail('unexpected fault')});
  const endpoint=await server.listen(),headers={Cookie:`__Host-sophie-session=${token}`},path='/api/ai/preferences/export';
  try {
    const response=await dashboardHttp(endpoint,path,{headers});
    assert.equal(response.status,200);assert.equal(response.headers['content-disposition'],'attachment; filename="sophie-response-preferences.json"');
    assert.equal(response.headers['content-type'],'application/json; charset=utf-8');assert.equal(response.headers['cache-control'],'no-store');
    assert.equal(response.body.actorId,actor.userId);assert.deepEqual(response.body.settings,{replyLength:'brief',language:'pl'});assert.equal(reads[0].actor,actor);
    for(const query of ['?userId=303','?guildId=404','?download=1'])assert.equal((await dashboardHttp(endpoint,path+query,{headers})).status,400);
    assert.equal((await dashboardHttp(endpoint,path)).status,403);assert.equal(reads.length,1);
    for(const state of ['revoked','unavailable','quarantined']){
      principalCurrent=state!=='revoked';available=state!=='unavailable';quarantined=state==='quarantined';
      const denied=await dashboardHttp(endpoint,path,{headers});assert.equal(denied.status,state==='revoked'?403:state==='unavailable'?503:409);
      assert.equal(denied.headers['content-disposition'],undefined);assert.equal(Object.hasOwn(denied.body,'settings'),false);
    }
  }finally{await server.close();}
});
