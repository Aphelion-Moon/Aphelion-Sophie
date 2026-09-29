import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createAiIpcChannel } from '../apps/knowledge-worker/ipc-channel.js';
import { createAiControlServer } from '../apps/ai-control/server.js';
import { createAiControlClient } from '../apps/ai-control/client.js';
import { aiControlPipe } from '../apps/ai-control/contract.js';
import { createServer as createNetServer } from 'node:net';
// The installed supervisor may already hold the default control port on this host.
const port=await new Promise((resolve,reject)=>{const probe=createNetServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const {port}=probe.address();probe.close(()=>resolve(port));});});


const native={skip:process.platform!=='win32',timeout:15000};
const hash=()=>createHash('sha256').update(randomBytes(32)).digest('hex');
const keys=()=>({core:randomBytes(32)});
const empty=()=>({revision:0,phase:'empty',identity:null,operationId:null,recovered:false,readiness:{core:false},job:null});
async function until(check,ms=3000){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('CONDITION_TIMEOUT');}
async function transport(t,{handle=()=>empty(),qualified=async()=>true,keySet=keys(),installationId=hash()}={}) {
  const lifetime=new AbortController(),server=createAiControlServer({port,installationId,keys:keySet,handle,qualified,revocationSignal:lifetime.signal,onFault:()=>{}}),clients=new Set();
  const client=(key=keySet.core)=>{const value=createAiControlClient({port,installationId,role:'core',key,revocationSignal:lifetime.signal});clients.add(value);return value;};
  t.after(async()=>{for(const value of clients)await value.stop();await server.stop();});
  await server.start();return {server,client,lifetime,keys:keySet,installationId};
}
async function rawRequest(f,{command='inspect',body={},session,profile='control',key=f.keys.core}={}) {
  const socket=connect(aiControlPipe(f.installationId,'core',port));socket.on('error',()=>{});const closed=new Promise(resolve=>socket.once('close',resolve));
  const channel=createAiIpcChannel({stream:socket,key,side:'worker',profile});
  try{
    const greeting=await channel.receive('challenge'),nonce=hash();await channel.send('proof',{installationId:f.installationId,role:'core',nonce});channel.bind(nonce);
    await channel.receive('ready');await channel.send('request',{session:session??greeting.session,command,body});return await channel.receive('result');
  }finally{channel.close();await closed;}
}

test('DS04-C02 wrong key cannot reach a handler',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}});
  await assert.rejects(f.client(randomBytes(32)).request('inspect'),/AI_CONTROL_UNAVAILABLE/);assert.equal(calls,0);
  assert.throws(()=>createAiControlServer({port,installationId:f.installationId,keys:{},qualified:async()=>true,
    handle:()=>empty(),revocationSignal:new AbortController().signal,onFault:()=>{}}),/AI_CONTROL_CONFIGURATION_INVALID/);
});

test('DS04-C22 peer readiness before the proof write callback preserves the bound control session',native,async t=>{
  const f=await transport(t);let reordered=false;
  const client=createAiControlClient({port,installationId:f.installationId,role:'core',key:f.keys.core,revocationSignal:f.lifetime.signal,
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

test('DS04-C03 exact request fields reject mutation, unknown commands and extra content',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}});
  for(const input of [{command:'execute',body:{path:'synthetic'}},{body:{text:'synthetic unexpected content'}}])await assert.rejects(rawRequest(f,input),/AI_IPC/);
  assert.equal(calls,0);
});

test('DS04-C04 supervisor restart revokes a pinned client and old-session requests cannot dispatch',native,async t=>{
  let calls=0;const f=await transport(t,{handle:()=>{calls++;return empty();}}),client=f.client();await client.request('inspect');const oldSession=client.session();
  await f.server.stop();const replacement=createAiControlServer({port,installationId:f.installationId,keys:f.keys,qualified:async()=>true,
    handle:()=>{calls++;return empty();},revocationSignal:new AbortController().signal,onFault:()=>{}});t.after(()=>replacement.stop());await replacement.start();
  await assert.rejects(client.request('inspect'),/AI_CONTROL_SESSION_CHANGED/);assert.equal(client.signal.aborted,true);
  await assert.rejects(rawRequest(f,{session:oldSession}),/AI_IPC/);assert.equal(calls,1);
  const fresh=f.client();await fresh.request('inspect');assert.equal(fresh.session(),replacement.session);assert.notEqual(fresh.session(),oldSession);
});

test('DS04-C07 cancellation and server stop release a connection with a stalled handler',native,async t=>{
  const entered=Promise.withResolvers(),answer=Promise.withResolvers(),f=await transport(t,{handle:()=>{entered.resolve();return answer.promise;}}),client=f.client(),abort=new AbortController();
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
  const socket=connect(aiControlPipe(f.installationId,'core',port));socket.on('error',()=>{});socket.resume();const closed=new Promise(resolve=>socket.once('close',resolve));
  const header=Buffer.alloc(4);header.writeUInt32BE(8193);socket.write(header);await closed;assert.equal(calls,0);
});

test('DS04-C11 control errors and invalid handler results never serialize private error details',native,async t=>{
  let invalid=false;const f=await transport(t,{handle:()=>{if(invalid)return {...empty(),extra:'synthetic-private-detail'};throw Error('synthetic-private-detail');}}),client=f.client();
  await assert.rejects(client.request('inspect'),/^Error: AI_CONTROL_UNAVAILABLE$/);invalid=true;
  await assert.rejects(client.request('inspect'),/^Error: AI_CONTROL_UNAVAILABLE$/);
});

test('DS04-C10 a second server cannot bind the same control port while the first is listening',native,async t=>{
  const f=await transport(t);
  const second=createAiControlServer({port,installationId:f.installationId,keys:f.keys,qualified:async()=>true,handle:()=>empty(),revocationSignal:new AbortController().signal,onFault:()=>{}});
  await assert.rejects(second.start(),/AI_CONTROL_UNAVAILABLE/);await second.stop();
});
