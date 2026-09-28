import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiReversePipeClient } from '../apps/core/runtime/ai-reverse-pipe.js';
import { createMeteredAiWorker } from '../apps/core/runtime/ai-provider.js';
import { createAiWorkerRuntime } from '../apps/knowledge-worker/runtime.js';
import { createDeepSeekClient } from '../apps/knowledge-worker/deepseek-client.js';
import { aiBootPipe, authenticateAiBootPipe } from '../apps/knowledge-worker/boot-pipe.js';
import { AI_WORKER_FILES, loadAiWorkerBootstrap, readAiWorkerFile, signAiWorkerLease, createAiWorkerLease } from '../apps/knowledge-worker/bootstrap.js';

const key=Buffer.alloc(32,7),leaseKey=Buffer.alloc(32,8),qualificationHash='6'.repeat(64),apiKey='synthetic-package-provider-key';
const acceptedFingerprints=['synthetic-package'],native={skip:process.platform!=='win32',timeout:15000};
const identity=()=>({workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
  profileHash:createDeepSeekClient({apiKey,acceptedFingerprints}).profileHash,provider:'deepseek',domain:'public'});
const payload=identity=>({workerDomain:'public',releaseHash:identity.releaseHash,requesterId:'404',restricted:false,
  boundary:{guildId:'101',channelId:'202',continuity:'synthetic',boundaryEpoch:1},
  local:{deadline:Date.now()+14000,messageId:'505',inputRevision:'a'.repeat(64),controlEpoch:1},
  messages:[{role:'system',content:'Synthetic policy'},{role:'user',content:'Synthetic hello'}],
  outputContract:{outcomes:['reply','silent'],answerOnly:false,sourceIds:[],emojiKeys:[]}});
const response=()=>new Response(JSON.stringify({model:'deepseek-flash',system_fingerprint:'synthetic-package',
  usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:40,prompt_cache_miss_tokens:60},
  choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"kind":"silent"}'}}]}),{headers:{'content-type':'application/json'}});
async function until(check){const deadline=Date.now()+2000;while(!check()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(check());}
async function fixture({fetchImpl,qualified=async()=>true}={}){
  const fixed=identity(),revocation=new AbortController();let calls=0,stopped=false;
  const transport={fetch:async(...args)=>{calls++;return fetchImpl?fetchImpl(...args):response();},status:()=>({calls,stopped}),stop:async()=>{stopped=true;}};
  const broker=createAiReversePipeClient({identity:fixed,key,qualified,revocationSignal:revocation.signal});
  const worker=createAiWorkerRuntime({identity:fixed,key,apiKey,acceptedFingerprints,qualified,revocationSignal:revocation.signal,transport,connectionMode:'dial-host'});
  await broker.start();
  return {fixed,broker,worker,transport,revocation,async close(){await worker.stop();await broker.stop();}};
}

test('DS04-P01 reverse native pipe probes and handles distinct metered turns without replay',native,async()=>{
  const f=await fixture(),settled=[];
  const metered=createMeteredAiWorker({worker:f.broker,accounting:{reserve:async()=>({}),dispatch:async()=>true,
    settle:async()=>{settled.push(true);return true;},finish:async()=>{}}});
  try {
    await f.worker.start();assert.equal(f.worker.status().listener.phase,'waiting');assert.equal(f.worker.status().worker.connections,0);
    assert.deepEqual(await f.broker.probe(),f.fixed);assert.equal(f.transport.status().calls,0);
    for(let n=0;n<3;n++){
      const request=payload(f.fixed);
      assert.deepEqual(await metered.generate(request,{signal:new AbortController().signal,deadline:request.local.deadline,beforeDispatch:async()=>true}),{kind:'silent'});
    }
    assert.equal(settled.length,3);assert.equal(f.transport.status().calls,3);
    await f.worker.stop();await until(()=>f.broker.inboxStatus().connections===0);assert.equal(f.worker.status().transport.stopped,true);
  } finally {await f.close();}
});

test('DS04-P02 cancellation while waiting for a worker neither consumes its later connection nor admits concurrent opens',native,async()=>{
  const f=await fixture(),abort=new AbortController();
  try {
    const pending=assert.rejects(f.broker.probe({signal:abort.signal}),/AI_WORKER|AI_IPC/);await until(()=>f.broker.inboxStatus().waiting);
    await assert.rejects(f.broker.probe(),/AI_IPC_BUSY/);abort.abort();await pending;
    assert.equal(f.broker.inboxStatus().waiting,false);await f.worker.start();assert.deepEqual(await f.broker.probe(),f.fixed);
  } finally {await f.close();}
});

test('DS04-P03 egress-purpose proof and incorrect profile are never admitted to the inference inbox',native,async()=>{
  const f=await fixture();
  try {
    for(const mode of ['purpose','profile']){
      const socket=connect(aiBootPipe(f.fixed,'inference'));socket.on('error',()=>{});
      await assert.rejects(authenticateAiBootPipe({stream:socket,key,identity:mode==='profile'?{...f.fixed,profileHash:'9'.repeat(64)}:f.fixed,
        side:'worker',purpose:mode==='purpose'?'egress':'inference',signal:new AbortController().signal}),/AI_EGRESS_UNAVAILABLE/);
      await until(()=>f.broker.inboxStatus().connections===0);assert.equal(f.broker.inboxStatus().available,false);
    }
    assert.equal(f.transport.status().calls,0);
  } finally {await f.close();}
});

test('DS04-P04 revoked boot closes in-flight inference and preserves uncertain accounting',native,async()=>{
  let entered;const ready=new Promise(resolve=>entered=resolve);
  const f=await fixture({fetchImpl:async(_url,options)=>{entered();await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));throw Error('synthetic cancelled');}});
  const events=[],metered=createMeteredAiWorker({worker:f.broker,accounting:{reserve:async()=>({}),dispatch:async()=>true,
    settle:async()=>{events.push('settled');return true;},finish:async(_token,possible)=>events.push(possible)}});
  try {
    await f.worker.start();const request=payload(f.fixed);
    const failed=assert.rejects(metered.generate(request,{signal:new AbortController().signal,deadline:request.local.deadline,beforeDispatch:async()=>true}),/AI_IPC|AI_WORKER/);
    await ready;f.revocation.abort();await failed;await f.worker.stop();await f.broker.stop();
    assert.deepEqual(events,[true]);assert.equal(f.transport.status().calls,1);assert.equal(f.broker.inboxStatus().connections,0);
    assert.equal(await f.broker.current(request),false);
  } finally {await f.close();}
});

test('DS04-P05 losing the idle host inbox stops the worker rather than silently reconnecting to a replacement',native,async()=>{
  const f=await fixture();
  try {await f.worker.start();await f.broker.stop();await until(()=>f.worker.status().stopped);await f.worker.stop();assert.equal(f.transport.status().stopped,true);}
  finally {await f.close();}
});

test('DS04-P06 stop releases a pending broker connection without a worker process',native,async()=>{
  const f=await fixture();
  try {
    const pending=assert.rejects(f.broker.probe(),/AI_WORKER|AI_IPC/);await until(()=>f.broker.inboxStatus().waiting);await f.broker.stop();await pending;
    const socket=connect(aiBootPipe(f.fixed,'inference'));await once(socket,'error');
  } finally {await f.close();}
});

const boot=()=>({version:1,identity:identity(),qualificationHash,ipcKey:key.toString('hex'),egressKey:'a'.repeat(64),leaseKey:leaseKey.toString('hex'),acceptedFingerprints});
test('DS04-P07 fixed bootstrap paths and distinct credentials reject unregistered data and unsafe key profiles',async()=>{
  const value=boot(),reads=[];
  const loaded=await loadAiWorkerBootstrap(async(path,limit)=>{reads.push([path,limit]);return path===AI_WORKER_FILES.bootstrap?JSON.stringify(value):apiKey;});
  assert.deepEqual(reads,[[AI_WORKER_FILES.bootstrap,8192],[AI_WORKER_FILES.provider,512]]);assert.deepEqual(loaded.identity,value.identity);
  for(const change of [{extra:'unregistered'}, {egressKey:value.ipcKey}, {version:2}, {qualificationHash:'bad'}, {acceptedFingerprints:['bad name']}, {acceptedFingerprints:[]}])
    await assert.rejects(loadAiWorkerBootstrap(async()=>JSON.stringify({...value,...change})),/AI_BOOT_INVALID/);
  await assert.rejects(loadAiWorkerBootstrap(async path=>path===AI_WORKER_FILES.bootstrap?JSON.stringify(value):'short'),/AI_BOOT_INVALID/);
});

test('DS04-P08 mounted-file reader rejects oversized and invalid UTF-8 contents before parsing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sophie-package-')),path=join(dir,'boot.json');
  try {
    await writeFile(path,Buffer.alloc(8193,65));await assert.rejects(readAiWorkerFile(path,8192),/AI_BOOT_INVALID/);
    await writeFile(path,Buffer.from([255,254,128]));await assert.rejects(readAiWorkerFile(path,8192));
  } finally {await unlink(path);await rmdir(dir);}
});

function leaseFixture(){
  const fixed=identity();let wall=100000,mono=0,reads=0;
  const make=(sequence=1,changes={})=>signAiWorkerLease({identity:fixed,qualificationHash,key:leaseKey,sequence,issuedAt:wall,expiresAt:wall+5000,...changes});
  let record=make(),reader=async()=>JSON.stringify(record);
  const lease=createAiWorkerLease({identity:fixed,qualificationHash,key:leaseKey,clock:()=>wall,monotonic:()=>mono,read:async(path,limit)=>{
    assert.equal(path,AI_WORKER_FILES.lease);assert.equal(limit,2048);reads++;return reader();
  }});
  return {lease,make,get record(){return record;},set record(value){record=value;},advance(ms){wall+=ms;mono+=ms;},
    setReader(value){reader=value;},rollback(){wall-=10000;mono+=6000;},reads:()=>reads};
}

test('DS04-P09 signed lease renews only for the exact boot/evidence and rejects replay or modification',async()=>{
  for(const mode of ['replay','same-sequence','tamper','boot','evidence']){
    const f=leaseFixture();
    try {
      await f.lease.start();assert.equal(await f.lease.current(),true);const first=f.record;f.advance(100);f.record=f.make(2);
      assert.equal(await f.lease.current(),true);
      if(mode==='replay')f.record=first;
      if(mode==='same-sequence')f.record=f.make(2,{expiresAt:f.record.expiresAt-1});
      if(mode==='tamper')f.record={...f.record,expiresAt:f.record.expiresAt+1};
      if(mode==='boot')f.record=f.make(3,{identity:identity()});
      if(mode==='evidence')f.record=f.make(3,{qualificationHash:'b'.repeat(64)});
      assert.equal(await f.lease.current(),false);assert.equal(f.lease.signal.aborted,true);
      f.record=f.make(4);assert.equal(await f.lease.current(),false);
    } finally {f.lease.stop();}
  }
});

test('DS04-P10 monotonic expiry cannot be extended by a wall-clock rollback or a late fresh sequence',async()=>{
  const f=leaseFixture();
  try {
    await f.lease.start();f.rollback();f.record=f.make(2);assert.equal(await f.lease.current(),false);
    // Poll refresh must also reject the expired generation when the event loop resumes.
    await until(()=>f.lease.signal.aborted);
  } finally {f.lease.stop();}
});

test('DS04-P11 a hung initial lease read expires and its later result cannot revive the worker',{timeout:5000},async()=>{
  const f=leaseFixture();let release;f.setReader(()=>new Promise(resolve=>release=resolve));
  try {await assert.rejects(f.lease.start(),/AI_LEASE_INVALID/);assert.equal(f.lease.signal.aborted,true);release(JSON.stringify(f.record));assert.equal(await f.lease.current(),false);}
  finally {f.lease.stop();}
});

test('DS04-P12 one pending lease read is shared and explicit stop releases all its callers',async()=>{
  const f=leaseFixture();let release;
  try {
    await f.lease.start();f.setReader(()=>new Promise(resolve=>release=resolve));
    const one=f.lease.current(),two=f.lease.current();assert.equal(f.reads(),2);f.lease.stop();
    assert.deepEqual(await Promise.all([one,two]),[false,false]);release(JSON.stringify(f.record));assert.equal(await f.lease.current(),false);
  } finally {f.lease.stop();}
});
