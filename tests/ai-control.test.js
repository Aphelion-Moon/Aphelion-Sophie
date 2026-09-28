import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { createServer as createHttpsServer } from 'node:https';
import { connect as connectTls } from 'node:tls';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, rmdir, realpath, readFile, access } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createAiIpcChannel } from '../apps/knowledge-worker/ipc-channel.js';
import { createAiControlServer } from '../apps/ai-control/server.js';
import { createAiControlClient } from '../apps/ai-control/client.js';
import { aiControlPipe } from '../apps/ai-control/contract.js';
import { createAiSupervisorControlApi, createAiSupervisorControlService } from '../apps/ai-supervisor/control.js';
import { provisionAiSupervisorJournal, openAiSupervisorJournal } from '../apps/ai-supervisor/journal.js';
import { createAiSupervisorSlot } from '../apps/ai-supervisor/slot.js';
import { createAiSupervisorWorkerSlot } from '../apps/ai-supervisor/worker-slot.js';
import { createAiRelayController } from '../apps/ai-supervisor/relays.js';
import { createAiEgressService } from '../apps/ai-egress/service.js';
import { createAiEgressBridge } from '../apps/ai-egress/runtime.js';
import { createAiWindowsLifecycle } from '../apps/core/runtime/ai-lifecycle.js';
import { createMeteredAiWorker } from '../apps/core/runtime/ai-provider.js';
import { createAiWorkerRuntime } from '../apps/knowledge-worker/runtime.js';
import { createDeepSeekClient } from '../apps/knowledge-worker/deepseek-client.js';
import { createAiWorkerLease } from '../apps/knowledge-worker/bootstrap.js';
import { createDeepSeekPipeConnector } from '../apps/knowledge-worker/egress-client.js';
import { createDeepSeekTransport } from '../apps/knowledge-worker/http-transport.js';
import { hash, inputs, deferred, engineFixture, json } from './fixtures/ai-supervisor.js';

const native={skip:process.platform!=='win32',timeout:15000};

test('DS04-C25 relay preparation is reserved before immediate quiesce and late grants are drained',async()=>{
  const {identity,operationId}=inputs(),signal=new AbortController().signal,calls=[];
  const pipes={signal,relayControl:async(...args)=>{calls.push(args);}};
  const controller=createAiRelayController({pipes,signal,qualified:async()=>true});
  const preparing=assert.rejects(controller.prepare({identity,operationId,signal}),/AI_RELAY_UNQUALIFIED/);
  await controller.quiesce();await preparing;assert.deepEqual(calls,[]);
  assert.equal(controller.current(identity,operationId),false);
  assert.throws(()=>controller.prepare({identity,operationId,signal}),/AI_RELAY_GRANT_REUSED/);
  const entered=deferred(),answer=deferred();let grants=0;
  pipes.relayControl=async(command,purpose,grant)=>{
    calls.push([command,purpose,grant]);
    if(command==='prepare'){assert.deepEqual(Object.keys(grant).sort(),['bootId','operationId']);if(++grants===2)entered.resolve();await answer.promise;}
  };
  const next={identity:{...identity,bootId:hash()},operationId:randomUUID(),signal};
  const pending=assert.rejects(controller.prepare(next),/AI_RELAY_UNAVAILABLE/);await entered.promise;
  let stopped=false;const closing=controller.quiesce().then(()=>{stopped=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);answer.resolve();await pending;await closing;
  assert.deepEqual(calls.filter(([command])=>command==='quiesce').map(([,purpose])=>purpose).sort(),['egress','inference']);
});

test('DS04-C26 unconfirmed relay closure stays failed across repeated quiesce and blocks fresh grants',async()=>{
  const {identity,operationId}=inputs(),signal=new AbortController().signal;
  const controller=createAiRelayController({signal,qualified:async()=>true,pipes:{signal,async relayControl(command,purpose){
    if(command==='quiesce' && purpose==='inference')throw Error('synthetic uncertain closure');
  }}});
  await controller.prepare({identity,operationId,signal});
  await assert.rejects(controller.quiesce(),/AI_RELAY_STOP_UNCONFIRMED/);
  await assert.rejects(controller.quiesce(),/AI_RELAY_STOP_UNCONFIRMED/);
  assert.throws(()=>controller.prepare({identity:{...identity,bootId:hash()},operationId:randomUUID(),signal}),/AI_RELAY_BUSY/);
});

test('DS04-C27 stalled relay qualification cannot hold shutdown indefinitely or issue a late grant',{timeout:3000},async()=>{
  const {identity,operationId}=inputs(),signal=new AbortController().signal,entered=deferred(),answer=deferred(),calls=[];
  const controller=createAiRelayController({signal,pipes:{signal,relayControl:async(...args)=>{calls.push(args);}},qualified:()=>{entered.resolve();return answer.promise;}});
  const pending=assert.rejects(controller.prepare({identity,operationId,signal}),/AI_RELAY_UNQUALIFIED/);await entered.promise;
  await controller.quiesce();await pending;answer.resolve(true);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[]);
});

test('DS04-C28 a partial relay start drains both purposes before reporting failure',async()=>{
  const {identity,operationId}=inputs(),signal=new AbortController().signal,entered=deferred(),physical=deferred(),stopped=[];
  const controller=createAiRelayController({signal,qualified:async()=>true,pipes:{signal,async relayControl(command,purpose){
    if(command==='start' && purpose==='egress')throw Error('synthetic start failure');
    if(command==='quiesce'){stopped.push(purpose);if(stopped.length===2)entered.resolve();await physical.promise;}
  }}});
  await controller.prepare({identity,operationId,signal});let failed=false;
  const starting=assert.rejects(controller.start({identity,operationId,signal}),/AI_RELAY_UNAVAILABLE/).then(()=>{failed=true;});
  await entered.promise;assert.equal(controller.current(identity,operationId),false);
  assert.equal(failed,false);physical.resolve();await starting;await controller.quiesce();
  assert.deepEqual(stopped.sort(),['egress','inference']);
});

test('DS04-C23 relay readiness precedes create and physical quiescence fences reuse',native,async t=>{
  const entered=deferred(),ready=deferred(),closing=deferred(),closed=deferred();let active=false,armed=false,grant;
  const relays={
    async prepare(value){assert.deepEqual(Object.keys(value).sort(),['identity','operationId','signal']);grant=value;},
    async start(value){assert.deepEqual(value.identity,grant.identity);entered.resolve();await ready.promise;active=true;armed=true;},
    current:()=>active,
    async quiesce(){active=false;if(armed){closing.resolve();await closed.promise;}},
  };
  const f=await composition(t,{booted:true,relays});t.after(()=>{ready.resolve();closed.resolve();});await prepared(f);
  for(const role of ['core','egress']){
    f.slot.channel({role,identity:f.identity,operationId:f.operationId});
    f.slot.ready({role,identity:f.identity,operationId:f.operationId});
  }
  const created=f.slot.create({revision:f.journal.snapshot().revision});await entered.promise;
  assert.equal(f.engine.calls.some(call=>call.path.includes('/containers/create')),false);
  ready.resolve();await created;assert.equal(f.engine.container!==null,true);
  let settled=false;const stopped=f.slot.quiesce().then(()=>{settled=true;});await closing.promise;
  assert.equal(grant.signal.aborted,true);assert.equal(settled,false);
  await new Promise(resolve=>setImmediate(resolve));assert.notEqual(f.engine.container,null);
  assert.equal(f.engine.calls.some(call=>call.method==='DELETE'),false);
  assert.throws(()=>f.slot.prepare({revision:f.journal.snapshot().revision,identity:f.identity,operationId:randomUUID()}),/AI_SUPERVISOR_NOT_READY/);
  closed.resolve();await stopped;assert.equal(settled,true);assert.equal(f.engine.container,null);
});

test('DS04-C24 quiesce cancels a relay prepare before a live boot is published',native,async t=>{
  const entered=deferred();let cancelled=false;
  const relays={
    prepare:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{cancelled=true;reject(Error('cancelled'));},{once:true});entered.resolve();}),
    start:async()=>{assert.fail('must not start');},current:()=>false,quiesce:async()=>{},
  };
  const f=await composition(t,{booted:true,relays});await f.slot.quiesce();
  const preparing=f.slot.prepare({revision:f.journal.snapshot().revision,identity:f.identity,operationId:f.operationId});
  const rejected=assert.rejects(preparing);await entered.promise;await f.slot.quiesce();await rejected;
  assert.equal(cancelled,true);assert.equal(f.journal.snapshot().phase,'empty');
  assert.equal(f.engine.calls.some(call=>call.path.includes('/containers/create')),false);
});
const keys=()=>({core:randomBytes(32),egress:randomBytes(32)});
const empty=()=>({revision:0,phase:'empty',identity:null,operationId:null,recovered:false,readiness:{core:false,egress:false},job:null});
async function until(check,ms=3000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('CONDITION_TIMEOUT');}
async function transport(t,{handle=()=>empty(),qualified=async()=>true,keySet=keys(),installationId=hash()}={}) {
  const lifetime=new AbortController(),server=createAiControlServer({installationId,keys:keySet,handle,qualified,revocationSignal:lifetime.signal,onFault:()=>{}}),clients=new Set();
  const client=(role='core',key=keySet[role])=>{const value=createAiControlClient({installationId,role,key,revocationSignal:lifetime.signal});clients.add(value);return value;};
  t.after(async()=>{for(const value of clients)await value.stop();await server.stop();});
  await server.start();return {server,client,lifetime,keys:keySet,installationId};
}
async function rawRequest(f,{role='core',command='inspect',body={},session,profile='control',key=f.keys[role]}={}) {
  const socket=connect(aiControlPipe(f.installationId,role));socket.on('error',()=>{});const closed=new Promise(resolve=>socket.once('close',resolve));
  const channel=createAiIpcChannel({stream:socket,key,side:'worker',profile});
  try{
    const greeting=await channel.receive('challenge'),nonce=hash();await channel.send('proof',{installationId:f.installationId,role,nonce});channel.bind(nonce);
    await channel.receive('ready');await channel.send('request',{session:session??greeting.session,command,body});return await channel.receive('result');
  }finally{channel.close();await closed;}
}
const acceptedFingerprints=['synthetic-control'],apiKey='synthetic-control-provider-key';
async function composition(t,{beforeStart=async()=>true,service=false,booted=false,monotonic,relays}={}) {
  const root=await mkdtemp(join(tmpdir(),'sophie-control-')),fixed=inputs(),bootRoot=join(root,'boots'),providerDirectory=join(root,'provider'),directory=join(root,'state');
  for(const path of [bootRoot,providerDirectory,directory])await mkdir(path);fixed.registration={...fixed.registration,bootRoot,providerDirectory};
  if(booted)fixed.identity.profileHash=fixed.registration.release.profileHash=createDeepSeekClient({apiKey,acceptedFingerprints}).profileHash;
  await provisionAiSupervisorJournal({...fixed,directory});const journal=await openAiSupervisorJournal({...fixed,directory});
  let closeEngine;
  const engine=await engineFixture({after:cleanup=>{closeEngine=cleanup;}},fixed),durable=createAiSupervisorSlot({registration:fixed.registration,journal,docker:engine.slot});
  const slot=booted?createAiSupervisorWorkerSlot({registration:fixed.registration,slot:durable,relays,acceptedFingerprints,qualified:async()=>true,
    revocationSignal:new AbortController().signal,onFault:()=>{},...(monotonic?{monotonic}:{})}):durable;
  const api=createAiSupervisorControlApi({slot,beforeStart});let f;
  if(service){
    const keySet=keys(),lifetime=new AbortController(),server=createAiSupervisorControlService({installationId:fixed.registration.installationId,keys:keySet,
      qualified:async()=>true,slot,beforeStart,revocationSignal:lifetime.signal,onFault:()=>{}});
    await server.start();const client=createAiControlClient({installationId:fixed.registration.installationId,role:'core',key:keySet.core,revocationSignal:new AbortController().signal});
    t.after(async()=>{await client.stop();await server.stop();});f={server,lifetime,core:client};
  }else{f=await transport(t,{installationId:fixed.registration.installationId,handle:api.handle});f.core=f.client();}
  t.after(async()=>{try{await api.close();}finally{await closeEngine();await journal.close();
    assert.equal(await realpath(root),resolve(root));assert.equal(dirname(resolve(root)),resolve(tmpdir()));
    assert.ok(basename(root).startsWith('sophie-control-'));await rm(root,{recursive:true});}});
  return {...f,...fixed,journal,engine,slot,api};
}
async function job(client,command,body) {
  const accepted=await client.request(command,body);let state;
  await until(async()=>{state=await client.request('inspect');return state.job?.id===accepted.job.id && state.job.state!=='running';});
  assert.equal(state.job.state,'complete');return {state,accepted};
}
async function prepared(f){await f.core.request('inspect');await job(f.core,'quiesce',{revision:f.journal.snapshot().revision,operationId:randomUUID()});
  return job(f.core,'prepare',{revision:f.journal.snapshot().revision,operationId:f.operationId,identity:f.identity});}

test('DS04-C01 core control composes journaled prepare/create/start/quiesce through authenticated native pipes',native,async t=>{
  const f=await composition(t),egress=f.client('egress');await prepared(f);
  let current=(await job(f.core,'create',{revision:f.journal.snapshot().revision,operationId:f.operationId})).state;
  assert.equal(current.phase,'created');current=(await job(f.core,'start',{revision:current.revision,operationId:f.operationId})).state;
  assert.equal(current.phase,'running');assert.equal(f.engine.container.State.Running,true);
  assert.equal((await egress.request('inspect')).phase,'running');
  current=(await job(f.core,'quiesce',{revision:current.revision,operationId:randomUUID()})).state;
  assert.equal(current.phase,'empty');assert.equal(f.engine.container,null);assert.equal(f.core.session(),f.server.session);
});

test('DS04-C02 wrong and cross-role keys cannot reach a handler',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}});
  await assert.rejects(f.client('core',randomBytes(32)).request('inspect'),/AI_CONTROL_UNAVAILABLE/);
  await assert.rejects(f.client('egress',f.keys.core).request('inspect'),/AI_CONTROL_UNAVAILABLE/);assert.equal(calls,0);
  assert.throws(()=>createAiControlServer({installationId:f.installationId,keys:{core:f.keys.core,egress:f.keys.core},qualified:async()=>true,
    handle:()=>empty(),revocationSignal:new AbortController().signal,onFault:()=>{}}),/AI_CONTROL_CONFIGURATION_INVALID/);
});

test('DS04-C22 peer readiness before the proof write callback preserves the bound control session',native,async t=>{
  const f=await transport(t);let reordered=false;
  const client=createAiControlClient({installationId:f.installationId,role:'core',key:f.keys.core,revocationSignal:f.lifetime.signal,
    connectPipe:path=>{
      const socket=connect(path),write=socket.write.bind(socket);let first=true,callback=null,chunks=0;
      socket.on('data',()=>{if(++chunks===2){reordered=true;queueMicrotask(()=>callback?.());}});
      socket.write=(bytes,done)=>{
        if(!first)return write(bytes,done);first=false;
        return write(bytes,error=>{if(error)done(error);else {callback=done;if(chunks>=2)queueMicrotask(done);}});
      };
      return socket;
    }});
  try {assert.deepEqual(await client.request('inspect'),empty());assert.equal(reordered,true);}
  finally {await client.stop();}
});

test('DS04-C03 endpoint role and exact request fields reject mutation, unknown commands and extra content',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}});
  for(const input of [{role:'egress',command:'quiesce',body:{revision:0,operationId:randomUUID()}},
    {command:'execute',body:{path:'synthetic'}},{body:{text:'synthetic unexpected content'}}])await assert.rejects(rawRequest(f,input),/AI_IPC/);
  assert.equal(calls,0);
});

test('DS04-C04 supervisor restart revokes a pinned client and old-session requests cannot dispatch',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}}),client=f.client();await client.request('inspect');const oldSession=client.session();
  await f.server.stop();const replacement=createAiControlServer({installationId:f.installationId,keys:f.keys,qualified:async()=>true,
    handle:()=>{calls++;return empty();},revocationSignal:new AbortController().signal,onFault:()=>{}});t.after(()=>replacement.stop());await replacement.start();
  await assert.rejects(client.request('inspect'),/AI_CONTROL_SESSION_CHANGED/);assert.equal(client.signal.aborted,true);
  await assert.rejects(rawRequest(f,{session:oldSession}),/AI_IPC/);assert.equal(calls,1);
  const fresh=f.client();await fresh.request('inspect');assert.equal(fresh.session(),replacement.session);assert.notEqual(fresh.session(),oldSession);
});

test('DS04-C05 exact lost-response retry returns its job while stale revisions cannot start another operation',native,async t=>{
  const f=await composition(t);await f.core.request('inspect');await job(f.core,'quiesce',{revision:0,operationId:randomUUID()});
  const body={revision:0,operationId:f.operationId,identity:f.identity},first=await job(f.core,'prepare',body);
  const retry=await f.core.request('prepare',body);assert.equal(retry.job.id,first.accepted.job.id);assert.equal(retry.job.state,'complete');
  await assert.rejects(f.core.request('prepare',{...body,operationId:randomUUID()}),/AI_CONTROL_STALE/);assert.equal(f.journal.snapshot().revision,1);
});

test('DS04-C06 quiesce preempts a running start job and late approval never reaches Docker',native,async t=>{
  const entered=deferred(),answer=deferred(),f=await composition(t,{beforeStart:()=>{entered.resolve();return answer.promise;}});await prepared(f);
  await job(f.core,'create',{revision:f.journal.snapshot().revision,operationId:f.operationId});
  await f.core.request('start',{revision:f.journal.snapshot().revision,operationId:f.operationId});await entered.promise;
  await job(f.core,'quiesce',{revision:f.journal.snapshot().revision,operationId:randomUUID()});answer.resolve(true);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.engine.calls.some(call=>call.path.endsWith('/start')),false);assert.equal(f.journal.snapshot().phase,'empty');
});

test('DS04-C07 cancellation and server stop release a connection with a stalled handler',native,async t=>{
  const entered=deferred(),answer=deferred(),f=await transport(t,{handle:()=>{entered.resolve();return answer.promise;}}),client=f.client(),abort=new AbortController();
  const result=assert.rejects(client.request('inspect',{}, {signal:abort.signal}),/AI_CONTROL_UNAVAILABLE/);await entered.promise;abort.abort();await result;
  await f.server.stop();assert.equal(f.server.status().connections,0);assert.equal(f.server.status().pendingHandlers,1);
  answer.resolve(empty());await until(()=>f.server.status().pendingHandlers===0);
});

test('DS04-C08 stalled qualification checks stay bounded across disconnected callers',native,async t=>{
  let stall=false,calls=0;const f=await transport(t,{qualified:()=>{if(stall){calls++;return new Promise(()=>{});}return true;}});stall=true;
  for(let batch=0;batch<3;batch++)await Promise.all([f.client().request('inspect'),f.client().request('inspect')].map(request=>assert.rejects(request,/AI_CONTROL_UNAVAILABLE/)));
  assert.equal(calls,4);await f.server.stop();assert.equal(f.server.status().connections,0);
});

test('DS04-C09 inference-domain frames and oversized control frames are rejected before dispatch',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}});
  await assert.rejects(rawRequest(f,{profile:'inference'}),/AI_IPC/);
  const socket=connect(aiControlPipe(f.installationId,'core'));socket.on('error',()=>{});socket.resume();const closed=new Promise(resolve=>socket.once('close',resolve));
  const header=Buffer.alloc(4);header.writeUInt32BE(8193);socket.write(header);await closed;assert.equal(calls,0);
});

test('DS04-C10 failure to bind the second role closes the already-open first endpoint',native,async t=>{
  const installationId=hash(),blocker=createServer(socket=>socket.destroy());blocker.listen(aiControlPipe(installationId,'egress'));await once(blocker,'listening');
  t.after(()=>new Promise(resolve=>blocker.close(resolve)));
  const server=createAiControlServer({installationId,keys:keys(),qualified:async()=>true,handle:()=>empty(),revocationSignal:new AbortController().signal,onFault:()=>{}});
  await assert.rejects(server.start(),/AI_CONTROL_UNAVAILABLE/);await server.stop();
  const probe=createServer(socket=>socket.destroy());probe.listen(aiControlPipe(installationId,'core'));await once(probe,'listening');await new Promise(resolve=>probe.close(resolve));
});

test('DS04-C11 control errors and invalid handler results never serialize private error details',native,async t=>{
  let invalid=false;const f=await transport(t,{handle:()=>{if(invalid)return {...empty(),extra:'synthetic-private-detail'};throw Error('synthetic-private-detail');}}),client=f.client();
  await assert.rejects(client.request('inspect'),/^Error: AI_CONTROL_UNAVAILABLE$/);invalid=true;
  await assert.rejects(client.request('inspect'),/^Error: AI_CONTROL_UNAVAILABLE$/);
});

test('DS04-C12 service startup recovers and revocation closes RPC admission and its running owned slot',native,async t=>{
  const f=await composition(t,{service:true});await until(async()=>{const state=await f.core.request('inspect');return state.recovered;});
  await job(f.core,'prepare',{revision:f.journal.snapshot().revision,operationId:f.operationId,identity:f.identity});
  await job(f.core,'create',{revision:f.journal.snapshot().revision,operationId:f.operationId});
  await job(f.core,'start',{revision:f.journal.snapshot().revision,operationId:f.operationId});assert.equal(f.engine.container.State.Running,true);
  f.lifetime.abort();await f.server.stop();assert.equal(f.engine.container,null);assert.equal(f.slot.status().closed,true);
  await assert.rejects(f.core.request('inspect'),/AI_CONTROL_UNAVAILABLE/);
});

test('DS04-C13 a pending quiesce accepts its exact retry but cannot accumulate replacement jobs',native,async t=>{
  const f=await composition(t);await prepared(f);await job(f.core,'create',{revision:f.journal.snapshot().revision,operationId:f.operationId});
  const entered=deferred(),answer=deferred();f.engine.hook=async(req,res)=>{
    if(req.method!=='DELETE')return false;entered.resolve();await answer.promise;f.engine.container=null;json(res,204);return true;
  };
  const body={revision:f.journal.snapshot().revision,operationId:randomUUID()},accepted=await f.core.request('quiesce',body);await entered.promise;
  try {
    const retry=await f.core.request('quiesce',body);assert.equal(retry.job.id,accepted.job.id);assert.equal(retry.job.state,'running');
    await assert.rejects(f.core.request('quiesce',{revision:f.journal.snapshot().revision,operationId:randomUUID()}),/AI_CONTROL_BUSY/);
    assert.equal((await f.core.request('inspect')).job.id,accepted.job.id);
  }finally{answer.resolve();}
  await until(async()=>{const state=await f.core.request('inspect');return state.job.state==='complete' && state.phase==='empty';});
});

test('DS04-C14 recovery must finish before service admission and failure is visible to its starter',native,async()=>{
  const entered=deferred(),answer=deferred(),installationId=hash(),keySet=keys();let closed=false;
  const slot={status:()=>({journal:empty(),recovered:false}),prepare:async()=>{},create:async()=>{},start:async()=>{},
    quiesce:async()=>{entered.resolve();await answer.promise;throw Error('synthetic recovery failed');},close:async()=>{closed=true;}};
  const server=createAiSupervisorControlService({installationId,keys:keySet,qualified:async()=>true,slot,beforeStart:async()=>true,
    revocationSignal:new AbortController().signal,onFault:()=>{}});
  const client=createAiControlClient({installationId,role:'core',key:keySet.core,revocationSignal:new AbortController().signal});
  const failed=assert.rejects(server.start(),/AI_CONTROL_UNAVAILABLE/);await entered.promise;
  try{await assert.rejects(client.request('inspect'),/AI_CONTROL_UNAVAILABLE/);assert.equal(server.status().phase,'idle');}
  finally{answer.resolve();await failed;await client.stop();await server.stop();}
  assert.equal(server.status().failed,true);assert.equal(closed,true);
});

function services(f,createBridge){
  const lifetime=new AbortController(),faults=[];
  const egress=createAiEgressService({client:f.client('egress'),qualified:async()=>true,revocationSignal:lifetime.signal,onFault:code=>faults.push(code),
    ...(createBridge?{createBridge}:{})});
  const lifecycle=createAiWindowsLifecycle({client:f.core,release:f.registration.release,qualified:async()=>true,
    revocationSignal:lifetime.signal,onFault:code=>faults.push(code)});
  return {egress,lifecycle,faults,async close(){try{await lifecycle.stop();}finally{await egress.stop();}}};
}

test('DS04-C15 core and separate egress complete a metered TLS turn; losing egress removes the leased synthetic slot',native,async t=>{
  const f=await composition(t,{booted:true});let worker=null,lease=null,calls=0;
  const certificates=JSON.parse(await readFile(new URL('./fixtures/ai-egress-tls.json',import.meta.url),'utf8'));
  const provider=createHttpsServer({key:certificates.key,cert:certificates.cert},async(request,response)=>{
    calls++;assert.equal(request.headers.authorization,`Bearer ${apiKey}`);assert.equal(request.url,'/chat/completions');
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks)).messages.at(-1).content,'Synthetic hello');
    json(response,200,{model:'deepseek-flash',system_fingerprint:acceptedFingerprints[0],
      usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:40,prompt_cache_miss_tokens:60},
      choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"kind":"silent"}'}}]});
  });provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const s=services(f,options=>createAiEgressBridge({...options,
    createResolver:()=>({resolve4:async host=>{assert.equal(host,'api.deepseek.com');return ['93.184.215.14'];},cancel(){}}),
    connectTcp:settings=>{assert.deepEqual(settings,{host:'93.184.215.14',port:443,family:4});return connect({host:'127.0.0.1',port:provider.address().port});}}));
  const bootDirectory=join(f.registration.bootRoot,f.identity.bootId),bootPath=join(bootDirectory,'boot.json'),leasePath=join(bootDirectory,'lease.json');
  f.engine.hook=async(req,res)=>{
    if(req.method==='POST' && req.url.endsWith('/start')){
      const boot=JSON.parse(await readFile(bootPath,'utf8'));
      lease=createAiWorkerLease({identity:boot.identity,qualificationHash:boot.qualificationHash,key:Buffer.from(boot.leaseKey,'hex'),read:()=>readFile(leasePath,'utf8')});
      await lease.start();assert.equal(await lease.current(),true);
      const connector=createDeepSeekPipeConnector({identity:boot.identity,key:Buffer.from(boot.egressKey,'hex'),revocationSignal:lease.signal,
        tlsConnect:settings=>connectTls({...settings,ca:certificates.cert})});
      worker=createAiWorkerRuntime({identity:boot.identity,key:Buffer.from(boot.ipcKey,'hex'),apiKey,acceptedFingerprints,
        qualified:()=>lease.current(),revocationSignal:lease.signal,connectionMode:'dial-host',
        transport:createDeepSeekTransport({connector})});
      await worker.start();f.engine.container.State.Running=true;json(res,204);return true;
    }
    if(req.method==='DELETE'){await worker?.stop();lease?.stop();f.engine.container=null;json(res,204);return true;}
    return false;
  };
  try{
    await s.egress.start();await s.lifecycle.quiesce({operationId:randomUUID()});
    const broker=await s.lifecycle.launch({identity:f.identity,operationId:f.operationId,signal:new AbortController().signal,beforeStart:async()=>true});
    assert.deepEqual(await broker.probe(),f.identity);assert.equal(calls,0);assert.equal(s.egress.status().ready,true);
    const settlements=[],metered=createMeteredAiWorker({worker:broker,accounting:{reserve:async()=>({}),dispatch:async()=>true,
      settle:async()=>{settlements.push(true);return true;},finish:async()=>{}}});
    const payload={workerDomain:'public',releaseHash:f.identity.releaseHash,requesterId:'404',restricted:false,
      boundary:{guildId:'101',channelId:'202',continuity:'synthetic',boundaryEpoch:1},
      local:{deadline:Date.now()+14000,messageId:'505',inputRevision:'a'.repeat(64),controlEpoch:1},
      messages:[{role:'system',content:'Synthetic policy'},{role:'user',content:'Synthetic hello'}],
      outputContract:{outcomes:['reply','silent'],answerOnly:false,sourceIds:[],emojiKeys:[]}};
    assert.deepEqual(await metered.generate(payload,{signal:new AbortController().signal,deadline:payload.local.deadline,beforeDispatch:async()=>true}),{kind:'silent'});
    assert.equal(calls,1);assert.equal(settlements.length,1);
    await until(async()=>JSON.parse(await readFile(leasePath,'utf8')).sequence>=2);
    await s.egress.stop();await until(()=>f.engine.container===null && f.journal.snapshot().phase==='empty',6000);
    assert.equal(worker.status().stopped,true);await assert.rejects(access(bootPath),{code:'ENOENT'});await assert.rejects(access(leasePath),{code:'ENOENT'});
    assert.equal(f.slot.status().journal.phase,'empty');assert.equal(calls,1);
  }finally{try{await s.close();}finally{await worker?.stop();lease?.stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}}
});

test('DS04-C16 role grants contain only their channel key and creation requires both listeners',native,async t=>{
  const f=await composition(t,{booted:true});await prepared(f);const egress=f.client('egress');await egress.request('inspect');
  const body={identity:f.identity,operationId:f.operationId};await assert.rejects(egress.request('ready',body),/AI_CONTROL_DENIED/);
  const coreGrant=await f.core.request('channel',body),egressGrant=await egress.request('channel',body);
  const boot=JSON.parse(await readFile(join(f.registration.bootRoot,f.identity.bootId,'boot.json'),'utf8'));
  assert.equal(coreGrant.purpose,'inference');assert.equal(coreGrant.key,boot.ipcKey);
  assert.equal(egressGrant.purpose,'egress');assert.equal(egressGrant.key,boot.egressKey);
  for(const grant of [coreGrant,egressGrant]){assert.equal(Object.values(grant).includes(boot.leaseKey),false);assert.equal(JSON.stringify(grant).includes(apiKey),false);}
  await assert.rejects(egress.request('channel',{...body,identity:{...f.identity,bootId:hash()}}),/AI_CONTROL_STALE/);
  await f.core.request('ready',body);
  const accepted=await f.core.request('create',{revision:f.journal.snapshot().revision,operationId:f.operationId});
  await until(async()=>{const state=await f.core.request('inspect');return state.job.id===accepted.job.id && state.job.state==='failed';});
  assert.equal(f.engine.calls.some(call=>call.path.includes('/containers/create')),false);
});

test('DS04-C17 cancelled core launch drains the listeners and a late approval cannot start its container',native,async t=>{
  const f=await composition(t,{booted:true}),s=services(f),entered=deferred(),answer=deferred(),abort=new AbortController();
  try{
    await s.egress.start();await s.lifecycle.quiesce({operationId:randomUUID()});
    const launching=assert.rejects(s.lifecycle.launch({identity:f.identity,operationId:f.operationId,signal:abort.signal,
      beforeStart:()=>{entered.resolve();return answer.promise;}}),/AI_WORKER_START_NOT_APPROVED/);
    await entered.promise;abort.abort();const receipt=await s.lifecycle.quiesce({operationId:randomUUID()});await launching;answer.resolve(true);
    assert.equal(receipt.stopped,true);assert.equal(f.engine.container,null);assert.equal(f.engine.calls.some(call=>call.path.endsWith('/start')),false);
    await until(()=>s.egress.status().bootId===null);assert.equal(s.egress.status().phase,'listening');
    // A fresh boot can use the still-running egress service after normal retirement.
    const identity={...f.identity,bootId:hash()},operationId=randomUUID();
    const next=await s.lifecycle.launch({identity,operationId,signal:new AbortController().signal,beforeStart:async()=>true});
    assert.equal(f.engine.container.State.Running,true);assert.equal(s.egress.status().bootId,identity.bootId);await next.stop();
    await s.lifecycle.quiesce({operationId:randomUUID()});assert.equal(f.engine.container,null);
  }finally{answer.resolve(true);await s.close();}
});

test('DS04-C18 expired role readiness cannot be healed by a late acknowledgement',native,async t=>{
  let mono=0;const f=await composition(t,{booted:true,monotonic:()=>mono});await prepared(f);
  const egress=f.client('egress');await egress.request('inspect');const body={identity:f.identity,operationId:f.operationId};
  for(const client of [f.core,egress]){await client.request('channel',body);await client.request('ready',body);}
  assert.deepEqual((await f.core.request('inspect')).readiness,{core:true,egress:true});mono=3001;
  await assert.rejects(f.core.request('ready',body),/AI_CONTROL_UNAVAILABLE/);
  assert.deepEqual((await f.core.request('inspect')).readiness,{core:false,egress:false});
  await until(()=>f.journal.snapshot().phase==='empty');
  await assert.rejects(egress.request('channel',body),/AI_CONTROL_STALE/);
});

test('DS04-C19 a failed egress listener consumes its boot without disabling a later fresh boot',native,async t=>{
  const f=await composition(t,{booted:true});let starts=0;
  const s=services(f,options=>{const bridge=createAiEgressBridge(options);starts++;
    return starts===1?{...bridge,start:async()=>{throw Error('synthetic listener denied');}}:bridge;});
  try{
    await s.egress.start();await s.lifecycle.quiesce({operationId:randomUUID()});
    const failed=assert.rejects(s.lifecycle.launch({identity:f.identity,operationId:f.operationId,signal:new AbortController().signal,beforeStart:async()=>true}));
    await until(()=>s.faults.length>0);await s.lifecycle.quiesce({operationId:randomUUID()});await failed;
    assert.equal(starts,1);assert.equal(f.engine.calls.some(call=>call.path.endsWith('/start')),false);
    assert.equal(s.egress.status().phase,'listening');
    const identity={...f.identity,bootId:hash()};
    const worker=await s.lifecycle.launch({identity,operationId:randomUUID(),signal:new AbortController().signal,beforeStart:async()=>true});
    assert.equal(starts,2);assert.equal(s.egress.status().ready,true);assert.equal(f.engine.container.State.Running,true);
    await worker.stop();await s.lifecycle.quiesce({operationId:randomUUID()});
  }finally{await s.close();}
});

test('DS04-C20 accepting quiesce synchronously fences new role grants and readiness',native,async t=>{
  const f=await composition(t,{booted:true});await prepared(f);
  const context={role:'core',signal:new AbortController().signal},body={identity:f.identity,operationId:f.operationId};
  const accepted=f.api.handle({session:f.server.session,command:'quiesce',body:{revision:f.journal.snapshot().revision,operationId:randomUUID()}},context);
  assert.equal(accepted.job.state,'running');
  for(const command of ['channel','ready'])assert.throws(()=>f.api.handle({session:f.server.session,command,body},context),/AI_CONTROL_BUSY/);
  await until(async()=>{const state=await f.core.request('inspect');return state.job.id===accepted.job.id && state.job.state==='complete';});
  assert.equal(f.journal.snapshot().phase,'empty');
});

test('DS04-C21 failed boot cleanup retains durable ownership and the next quiesce retries without a live boot object',native,async t=>{
  const f=await composition(t,{booted:true});await prepared(f);
  const directory=join(f.registration.bootRoot,f.identity.bootId),obstruction=join(directory,'lease.json');await mkdir(obstruction);
  try{
    await assert.rejects(f.slot.quiesce(),/AI_SUPERVISOR_STOP_UNCONFIRMED/);
    assert.equal(f.slot.status().recovered,false);assert.equal(f.journal.snapshot().phase,'removing');
    assert.deepEqual(f.journal.snapshot().identity,f.identity);await access(join(directory,'boot.json'));
  }finally{await rmdir(obstruction);}
  await f.slot.quiesce();assert.equal(f.journal.snapshot().phase,'empty');assert.equal(f.slot.status().recovered,true);
  await assert.rejects(access(join(directory,'boot.json')),{code:'ENOENT'});
});
