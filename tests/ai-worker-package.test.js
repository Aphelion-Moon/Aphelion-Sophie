import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, connect } from 'node:net';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAiReversePipeClient } from '../apps/core/runtime/ai-reverse-pipe.js';
import { createMeteredAiWorker } from '../apps/core/runtime/ai-provider.js';
import { createAiWorkerRuntime } from '../apps/knowledge-worker/runtime.js';
import { createMistralClient, MISTRAL_MODEL } from '../apps/knowledge-worker/mistral-client.js';
import { authenticateAiBootPipe } from '../apps/knowledge-worker/boot-pipe.js';
import { readInstallationFile } from '../apps/installation/configuration.js';

const key=Buffer.alloc(32,7),apiKey='synthetic-package-provider-key';
const acceptedFingerprints=[MISTRAL_MODEL],native={skip:process.platform!=='win32',timeout:20000};
const identity=()=>({workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
  profileHash:createMistralClient({apiKey,acceptedFingerprints}).profileHash,provider:'mistral',domain:'public'});
const payload=identity=>({workerDomain:'public',releaseHash:identity.releaseHash,requesterId:'404',restricted:false,
  boundary:{guildId:'101',channelId:'202',continuity:'synthetic',boundaryEpoch:1},
  local:{deadline:Date.now()+14000,messageId:'505',inputRevision:'a'.repeat(64),controlEpoch:1},
  messages:[{role:'system',content:'Synthetic policy'},{role:'user',content:'Synthetic hello'}],
  outputContract:{outcomes:['reply','silent'],answerOnly:false,sourceIds:[],emojiKeys:[]}});
const response=()=>new Response(JSON.stringify({model:MISTRAL_MODEL,
  usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:40}},
  choices:[{finish_reason:'stop',message:{role:'assistant',content:'{"kind":"silent"}'}}]}),{headers:{'content-type':'application/json'}});
async function until(check,ms=4000){const deadline=Date.now()+ms;while(!check()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(check());}
// An ephemeral loopback port per fixture, so these tests never meet a live Sophie core on the fixed channel port.
const freePort=()=>new Promise(resolve=>{const probe=createServer();probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});
const portPipes=port=>({
  createPipeServer:callback=>{const server=createServer(callback),listen=server.listen.bind(server);server.listen=()=>listen(port,'127.0.0.1');return server;},
  connectPipe:()=>connect(port,'127.0.0.1')});
const metered=(broker,events=[])=>createMeteredAiWorker({worker:broker,accounting:{reserve:async()=>({}),dispatch:async()=>true,
  settle:async()=>{events.push('settled');return true;},finish:async(_token,possible)=>{events.push(possible);}}});
async function fixture({fetchImpl,qualified=async()=>true}={}){
  const fixed=identity(),revocation=new AbortController(),port=await freePort(),{createPipeServer,connectPipe}=portPipes(port);let calls=0,stopped=false;
  const transport={fetch:async(...args)=>{calls++;return fetchImpl?fetchImpl(...args):response();},status:()=>({calls,stopped}),stop:async()=>{stopped=true;}};
  const broker=()=>createAiReversePipeClient({identity:fixed,key,qualified,revocationSignal:revocation.signal,createPipeServer});
  const value={fixed,port,broker:broker(),transport,revocation,connectPipe,
    worker:createAiWorkerRuntime({identity:fixed,key,apiKey,acceptedFingerprints,qualified,revocationSignal:revocation.signal,transport,connectPipe}),
    async replaceBroker(){await value.broker.stop();value.broker=broker();await value.broker.start();},
    async close(){await value.worker.stop();await value.broker.stop();}};
  await value.broker.start();
  return value;
}

test('DS04-P01 the worker channel probes and handles distinct metered turns without replay',native,async()=>{
  const f=await fixture(),events=[],worker=metered(f.broker,events);
  try {
    await f.worker.start();await until(()=>f.broker.inboxStatus().available===2);
    assert.deepEqual(await f.broker.probe(),f.fixed);assert.equal(f.transport.status().calls,0);
    for(let n=0;n<3;n++){
      const request=payload(f.fixed);
      assert.deepEqual(await worker.generate(request,{signal:new AbortController().signal,deadline:request.local.deadline,beforeDispatch:async()=>true}),{kind:'silent'});
    }
    assert.equal(events.filter(event=>event==='settled').length,3);assert.equal(f.transport.status().calls,3);
    await f.worker.stop();await until(()=>f.broker.inboxStatus().connections===0);assert.equal(f.worker.status().transport.stopped,true);
  } finally {await f.close();}
});

test('RB-P01b two turns generate at once over separate authenticated connections',native,async()=>{
  let inside=0,peak=0,release;const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture({fetchImpl:async()=>{inside++;peak=Math.max(peak,inside);if(inside===2)release();await gate;inside--;return response();}});
  const worker=metered(f.broker);
  try {
    await f.worker.start();await until(()=>f.broker.inboxStatus().available===2);
    const turns=[payload(f.fixed),payload(f.fixed)].map(request=>worker.generate(request,{signal:new AbortController().signal,deadline:request.local.deadline,beforeDispatch:async()=>true}));
    assert.deepEqual(await Promise.all(turns),[{kind:'silent'},{kind:'silent'}]);assert.equal(peak,2);
  } finally {await f.close();}
});

test('DS04-P02 cancellation while waiting for a worker does not consume its later connection',native,async()=>{
  const f=await fixture(),abort=new AbortController();
  try {
    const pending=assert.rejects(f.broker.probe({signal:abort.signal}),/AI_WORKER|AI_IPC/);await until(()=>f.broker.inboxStatus().waiting===1);
    abort.abort();await pending;
    assert.equal(f.broker.inboxStatus().waiting,0);await f.worker.start();assert.deepEqual(await f.broker.probe(),f.fixed);
  } finally {await f.close();}
});

test('DS04-P03 an incorrect profile is never admitted to the inference inbox',native,async()=>{
  const f=await fixture();
  try {
    const socket=f.connectPipe();socket.on('error',()=>{});
    await assert.rejects(authenticateAiBootPipe({stream:socket,key,identity:{...f.fixed,profileHash:'9'.repeat(64)},
      side:'worker',purpose:'inference',signal:new AbortController().signal}),/AI_EGRESS_UNAVAILABLE/);
    await until(()=>f.broker.inboxStatus().connections===0);assert.equal(f.broker.inboxStatus().available,0);
    const wrongKey=f.connectPipe();wrongKey.on('error',()=>{});
    await assert.rejects(authenticateAiBootPipe({stream:wrongKey,key:Buffer.alloc(32,9),identity:f.fixed,
      side:'worker',purpose:'inference',signal:new AbortController().signal}),/AI_EGRESS_UNAVAILABLE/);
    assert.equal(f.transport.status().calls,0);
  } finally {await f.close();}
});

test('DS04-P04 revocation closes in-flight inference and preserves uncertain accounting',native,async()=>{
  let entered;const ready=new Promise(resolve=>entered=resolve);
  const f=await fixture({fetchImpl:async(_url,options)=>{entered();await new Promise(resolve=>options.signal.addEventListener('abort',resolve,{once:true}));throw Error('synthetic cancelled');}});
  const events=[],worker=metered(f.broker,events);
  try {
    await f.worker.start();const request=payload(f.fixed);
    const failed=assert.rejects(worker.generate(request,{signal:new AbortController().signal,deadline:request.local.deadline,beforeDispatch:async()=>true}),/AI_IPC|AI_WORKER/);
    await ready;f.revocation.abort();await failed;await f.worker.stop();await f.broker.stop();
    assert.deepEqual(events,[true]);assert.equal(f.transport.status().calls,1);assert.equal(f.broker.inboxStatus().connections,0);
    assert.equal(await f.broker.current(request),false);
  } finally {await f.close();}
});

test('RB-P05 the worker survives a core restart: it keeps retrying and reconnects to the new core',native,async()=>{
  const f=await fixture();
  try {
    await f.worker.start();await until(()=>f.broker.inboxStatus().available===2);
    await f.broker.stop();await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(f.worker.status().stopped,false,'a core restart is not a reason for the worker to exit');
    await f.replaceBroker();await until(()=>f.broker.inboxStatus().available>0,8000);
    assert.deepEqual(await f.broker.probe(),f.fixed);
  } finally {await f.close();}
});

test('RB-P05b losing installation qualification stops the worker',native,async()=>{
  let qualified=true;const f=await fixture({qualified:async()=>qualified});
  try {
    await f.worker.start();await until(()=>f.broker.inboxStatus().available===2);
    qualified=false;await f.broker.stop();await until(()=>f.worker.status().stopped,8000);assert.equal(f.transport.status().stopped,true);
  } finally {await f.close();}
});

test('DS04-P06 stop releases a pending broker connection without a worker process',native,async()=>{
  const f=await fixture();
  try {
    const pending=assert.rejects(f.broker.probe(),/AI_WORKER|AI_IPC/);await until(()=>f.broker.inboxStatus().waiting===1);await f.broker.stop();await pending;
    const socket=f.connectPipe();await new Promise(resolve=>socket.once('error',resolve));
  } finally {await f.close();}
});

test('DS04-P08 installation file reader rejects oversized and invalid UTF-8 contents before parsing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sophie-package-')),path=join(dir,'worker.json');
  try {
    await writeFile(path,Buffer.alloc(8193,65));await assert.rejects(readInstallationFile(path,8192),/AI_INSTALLATION_INVALID/);
    await writeFile(path,Buffer.from([255,254,128]));await assert.rejects(readInstallationFile(path,8192));
    await writeFile(path,'{"ok":true}');assert.equal(await readInstallationFile(path,8192),'{"ok":true}');
  } finally {await unlink(path);await rmdir(dir);}
});
