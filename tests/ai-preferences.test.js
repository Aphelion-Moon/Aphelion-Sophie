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
import { createDashboardApi } from '../apps/dashboard/api.js';

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
test('member HTTP binds the signed-in member and refuses extra fields, other members and unconfirmed deletion',async()=>{
  const actor={guildId:'101',userId:'202'},proof={},seen=[];
  const record=name=>async input=>{seen.push([name,input]);return {state:'yes'};};
  const member={status:record('status'),exportData:record('exportData'),setChoice:record('setChoice'),saveNotes:record('saveNotes'),
    setRetainOnLeave:record('setRetainOnLeave'),forgetMemories:record('forgetMemories'),deleteData:record('deleteData')};
  const http=createAiControlsHttp({auth:{authenticate:async()=>({proof}),resolvePrincipal:async()=>({})},authorization:{resolveActor:async()=>actor},controls:{},member});
  const get={path:'/api/ai/me',method:'GET',query:new URLSearchParams(),body:null,credentials:{}};
  assert.equal((await http.execute(get)).actorId,actor.userId);assert.deepEqual(seen.at(-1),['status',{actor}]);
  await assert.rejects(http.execute({...get,query:new URLSearchParams('userId=303')}),/AI_INPUT_INVALID/);
  const post=(path,body)=>({...get,path,method:'POST',body});
  await http.execute(post('/api/ai/me/choice',{enabled:true,noticeRevision:4,noticeBinding:'a'.repeat(64)}));
  assert.deepEqual(seen.at(-1),['setChoice',{enabled:true,noticeRevision:4,noticeBinding:'a'.repeat(64),actor}]);
  await assert.rejects(http.execute(post('/api/ai/me/choice',{enabled:true,noticeRevision:4,noticeBinding:'a'.repeat(64),userId:'303'})),/AI_INPUT_INVALID/);
  await assert.rejects(http.execute(post('/api/ai/me/choice',{enabled:'yes',noticeRevision:null,noticeBinding:null})),/AI_INPUT_INVALID/);
  await http.execute(post('/api/ai/me/notes',{notes:['I play engineers']}));assert.deepEqual(seen.at(-1),['saveNotes',{notes:['I play engineers'],actor}]);
  await assert.rejects(http.execute(post('/api/ai/me/notes',{notes:'I play engineers'})),/AI_PREFERENCE_INVALID/);
  await http.execute(post('/api/ai/me/retention',{retainOnLeave:true}));assert.deepEqual(seen.at(-1),['setRetainOnLeave',{retainOnLeave:true,actor}]);
  for(const path of ['/api/ai/me/forget','/api/ai/me/delete']){
    await assert.rejects(http.execute(post(path,{confirmed:false})),/AI_CONFIRMATION_REQUIRED/);
    await http.execute(post(path,{confirmed:true}));assert.deepEqual(seen.at(-1)[1],{actor});
  }
  for(const removed of ['/api/ai/consents','/api/ai/consent','/api/ai/preferences','/api/ai/save-preferences','/api/ai/remembering'])
    await assert.rejects(http.execute({...get,path:removed}),/AI_INPUT_INVALID/);
  const paths=[],api=createDashboardApi({document:null,fetch:async path=>{paths.push(path);return Response.json({state:'none'});}});
  await api.aiMe();assert.deepEqual(paths,['/api/ai/me']);
});

test('the data export is a private attachment that rechecks the session and fails closed on access or restore changes',async()=>{
  const token='a'.repeat(64),actor={guildId:'101',userId:'202'},proof={};let principalCurrent=true,failure=null,reads=0;
  const auth={authenticate:async input=>{assert.equal(input.method,'GET');if(input.token!==token)throw new ContractError('DASHBOARD_SESSION_INVALID');return {proof};},
    resolvePrincipal:async input=>{assert.equal(input,proof);if(!principalCurrent)throw new ContractError('DASHBOARD_SESSION_INVALID');return {};}};
  const authorization={resolveActor:async input=>{assert.equal(input,proof);return actor;}};
  const member={exportData:async input=>{assert.equal(input.actor,actor);reads++;if(failure)throw new ContractError(failure);
    return {kind:'sophie-member-data',notes:{notes:['Synthetic note']},memories:[],choice:{enabled:true,receipt:{text:'Synthetic notice'}}};}};
  const ai=createAiControlsHttp({auth,authorization,controls:{},member});
  const server=createDashboardAuthHttpServer({configuration:dashboardConfiguration,auth,authorization,ai,enabled:async()=>true,onFault:()=>{}});
  const endpoint=await server.listen(),headers={Cookie:`__Host-sophie-session=${token}`},path='/api/ai/me/export';
  try {
    const response=await dashboardHttp(endpoint,path,{headers});
    assert.equal(response.status,200);assert.equal(response.headers['content-disposition'],'attachment; filename="sophie-my-data.json"');
    assert.equal(response.headers['content-type'],'application/json; charset=utf-8');assert.equal(response.headers['cache-control'],'no-store');
    assert.equal(response.body.actorId,actor.userId);assert.deepEqual(response.body.notes.notes,['Synthetic note']);
    for(const query of ['?userId=303','?guildId=404','?download=1'])assert.equal((await dashboardHttp(endpoint,path+query,{headers})).status,400);
    assert.equal((await dashboardHttp(endpoint,path)).status,403);assert.equal(reads,1);
    principalCurrent=false;let denied=await dashboardHttp(endpoint,path,{headers});
    assert.equal(denied.status,403);assert.equal(denied.headers['content-disposition'],undefined);assert.equal(Object.hasOwn(denied.body,'notes'),false);
    principalCurrent=true;
    for(const [code,status] of [['AI_PREFERENCE_JOURNAL_UNAVAILABLE',503],['AI_PREFERENCE_RESTORE_QUARANTINED',409]]){
      failure=code;denied=await dashboardHttp(endpoint,path,{headers});
      assert.equal(denied.status,status);assert.equal(denied.headers['content-disposition'],undefined);assert.equal(Object.hasOwn(denied.body,'notes'),false);
    }
  }finally{await server.close();}
});
