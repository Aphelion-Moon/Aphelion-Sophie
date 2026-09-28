import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { connect } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createDeepSeekTransport } from '../apps/knowledge-worker/http-transport.js';
import { createDeepSeekClient } from '../apps/knowledge-worker/deepseek-client.js';
import { createAiWorkerRuntime } from '../apps/knowledge-worker/runtime.js';
import { connectAiWorkerPipe } from '../apps/knowledge-worker/windows-pipe.js';
import { createAiIpcClient } from '../apps/core/runtime/ai-ipc.js';
import { createMeteredAiWorker } from '../apps/core/runtime/ai-provider.js';

const key=Buffer.alloc(32,9), apiKey='synthetic-worker-provider-key', acceptedFingerprints=['synthetic-build'];
const output={kind:'silent'};
const response=()=>JSON.stringify({model:'deepseek-flash',system_fingerprint:'synthetic-build',
  usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:40,prompt_cache_miss_tokens:60},
  choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}]});
const prompt=identity=>({workerDomain:'public',releaseHash:identity.releaseHash,requesterId:'404',restricted:false,
  boundary:{guildId:'101',channelId:'202',continuity:'synthetic',boundaryEpoch:1},
  local:{deadline:Date.now()+14000,messageId:'505',inputRevision:'a'.repeat(64),controlEpoch:1},
  messages:[{role:'system',content:'Synthetic policy'},{role:'user',content:'Synthetic hello'}],
  outputContract:{outcomes:['reply','silent'],answerOnly:false,sourceIds:[],emojiKeys:[]}});
const options=signal=>({method:'POST',redirect:'error',signal,headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:'{}'});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

async function transportFixture(handler) {
  let connections=0,requests=0;
  const server=createServer((req,res)=>{requests++;req.resume();handler(req,res);});
  server.on('connection',()=>connections++);server.listen(0,'127.0.0.1');await once(server,'listening');
  // Exercise the real https.Agent/request lifecycle over a synthetic loopback socket. TLS/production egress is a separate gate.
  const transport=createDeepSeekTransport({requestImpl:(url,settings,callback)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(settings.agent.options.rejectUnauthorized,true);
    assert.deepEqual(settings.agent.options.proxyEnv,{});
    settings.agent.createConnection=()=>connect({host:'127.0.0.1',port:server.address().port});
    return request(url,settings,callback);
  }});
  return {transport,stats:()=>({connections,requests}),async close(){await transport.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

test('DS04-N01 one worker-local socket is reused, fixed origin is enforced and shutdown closes the pool',async()=>{
  const f=await transportFixture((_req,res)=>{res.setHeader('content-type','application/json');res.end(response());});
  try {
    for(let n=0;n<2;n++) {
      const reply=await f.transport.fetch('https://api.deepseek.com/chat/completions',options(new AbortController().signal));
      assert.equal((await reply.json()).model,'deepseek-flash');await tick();
    }
    assert.deepEqual(f.stats(),{connections:1,requests:2});
    assert.throws(()=>f.transport.fetch('https://example.com',options(new AbortController().signal)),/AI_HTTP_REQUEST_INVALID/);
    await f.transport.stop();assert.equal(f.transport.status().stopped,true);
    assert.throws(()=>f.transport.fetch('https://api.deepseek.com/chat/completions',options(new AbortController().signal)),/AI_HTTP_UNAVAILABLE/);
  } finally {await f.close();}
});

test('DS04-N02 cancellation closes the physical request; oversized and invalid responses do not retry',async()=>{
  for(const mode of ['abort','stop','oversize','status']) {
    let entered;const ready=new Promise(resolve=>entered=resolve);
    const f=await transportFixture((_req,res)=>{
      entered();res.setHeader('content-type','application/json');
      if(mode==='oversize') res.end(' '.repeat(65537));
      else if(mode==='status') {res.statusCode=204;res.end();}
    });
    try {
      const abort=new AbortController();
      const pending=f.transport.fetch('https://api.deepseek.com/chat/completions',options(abort.signal)).then(reply=>reply.text());
      const rejected=assert.rejects(pending,/AI_HTTP|abort|terminated/iu);await ready;
      if(mode==='abort') abort.abort();if(mode==='stop') f.transport.stop();
      await rejected;
      const until=Date.now()+1000;
      while(f.transport.status().requests && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(f.stats().requests,1);assert.equal(f.transport.status().requests,0);
    } finally {await f.close();}
  }
});

test('DS04-N03 qualified Windows pipe composition completes metered turns and stops only its own worker', {skip:process.platform!=='win32'},async()=>{
  const f=await transportFixture((_req,res)=>{res.setHeader('content-type','application/json');res.end(response());});
  const identity={workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
    profileHash:createDeepSeekClient({apiKey,acceptedFingerprints}).profileHash,provider:'deepseek',domain:'public'};
  let qualified=true;const worker=createAiWorkerRuntime({identity,key,apiKey,acceptedFingerprints,qualified:async()=>qualified,revocationSignal:new AbortController().signal,transport:f.transport});
  const broker=createAiIpcClient({identity,key,qualified:async()=>qualified,connect:()=>connectAiWorkerPipe(identity)});
  const events=[];const metered=createMeteredAiWorker({worker:broker,accounting:{reserve:async()=>({}),dispatch:async()=>true,
    settle:async()=>{events.push('settled');return true;},finish:async()=>{}}});
  try {
    await worker.start();assert.equal(worker.status().listener.phase,'listening');
    for(let n=0;n<2;n++){const payload=prompt(identity);assert.deepEqual(await metered.generate(payload,{signal:new AbortController().signal,deadline:payload.local.deadline,beforeDispatch:async()=>true}),output);await tick();}
    assert.deepEqual(f.stats(),{connections:1,requests:2});assert.equal(events.length,2);
    qualified=false;await assert.rejects(broker.prepare(prompt(identity)),/AI_WORKER_NOT_QUALIFIED/);
    await worker.stop();assert.equal(worker.status().transport.stopped,true);assert.equal(worker.status().listener.phase,'stopped');
    assert.equal(worker.status().worker.connections,0);
  } finally {broker.stop();await worker.stop();await f.close();}
});

test('DS04-N04 denied or concurrently stopped startup cannot expose a pipe', {skip:process.platform!=='win32'},async()=>{
  for(const mode of ['denied','stopped','hung']) {
    let release;const gate=new Promise(resolve=>release=resolve);
    const identity={workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
      profileHash:createDeepSeekClient({apiKey,acceptedFingerprints}).profileHash,provider:'deepseek',domain:'public'};
    const worker=createAiWorkerRuntime({identity,key,apiKey,acceptedFingerprints,qualified:()=>gate,revocationSignal:new AbortController().signal});
    const pending=assert.rejects(worker.start(),/AI_PIPE_UNAVAILABLE/);
    const closing=mode!=='denied'?worker.stop():null;
    if(mode!=='hung')release(mode!=='denied');await pending;await closing;await worker.stop();
    const socket=connectAiWorkerPipe(identity);await once(socket,'error');assert.equal(worker.status().listener.phase,'stopped');
  }
});

test('DS04-N05 qualification revocation closes an in-flight provider request and preserves uncertain accounting', {skip:process.platform!=='win32'},async()=>{
  let entered;const ready=new Promise(resolve=>entered=resolve);
  const f=await transportFixture(()=>entered());
  const identity={workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
    profileHash:createDeepSeekClient({apiKey,acceptedFingerprints}).profileHash,provider:'deepseek',domain:'public'};
  const revocation=new AbortController();
  const worker=createAiWorkerRuntime({identity,key,apiKey,acceptedFingerprints,qualified:async()=>true,revocationSignal:revocation.signal,transport:f.transport});
  const broker=createAiIpcClient({identity,key,qualified:async()=>true,connect:()=>connectAiWorkerPipe(identity)});
  const events=[];const metered=createMeteredAiWorker({worker:broker,accounting:{reserve:async()=>({}),dispatch:async()=>true,
    settle:async()=>{events.push('settled');return true;},finish:async(_token,possible)=>events.push(possible)}});
  try {
    await worker.start();const payload=prompt(identity);
    const pending=assert.rejects(metered.generate(payload,{signal:new AbortController().signal,deadline:payload.local.deadline,beforeDispatch:async()=>true}),/AI_IPC|AI_WORKER/);
    await ready;revocation.abort();await pending;await worker.stop();
    assert.deepEqual(events,[true]);assert.equal(f.stats().requests,1);
    assert.equal(worker.status().transport.requests,0);assert.equal(worker.status().worker.connections,0);
    assert.equal(worker.status().listener.phase,'stopped');
  } finally {broker.stop();await worker.stop();await f.close();}
});
