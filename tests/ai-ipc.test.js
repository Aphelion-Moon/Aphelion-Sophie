import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createAiIpcClient } from '../apps/core/runtime/ai-ipc.js';
import { createMeteredAiWorker } from '../apps/core/runtime/ai-provider.js';
import { createAiIpcWorker } from '../apps/knowledge-worker/ipc-server.js';
import { createAiIpcChannel } from '../apps/knowledge-worker/ipc-channel.js';
import { createDeepSeekClient } from '../apps/knowledge-worker/deepseek-client.js';

const key = Buffer.alloc(32,7), identity = {workerId:'1'.repeat(64),bootId:'2'.repeat(64),releaseHash:'3'.repeat(64),profileHash:'4'.repeat(64),provider:'deepseek',domain:'public'};
const output = {kind:'reply',text:'Synthetic reply',purpose:'conversation',support:'current_conversation',citations:[]};
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done=>{resolve=done;}); return {promise,resolve}; };
const prompt = () => ({workerDomain:'public',releaseHash:identity.releaseHash,requesterId:'404',restricted:false,
  boundary:{guildId:'101',channelId:'202',continuity:'synthetic',boundaryEpoch:1},
  local:{deadline:Date.now()+14000,messageId:'505',inputRevision:'a'.repeat(64),controlEpoch:1},
  messages:[{role:'system',content:'Synthetic policy'},{role:'user',content:'Synthetic hello'}],
  outputContract:{outcomes:['reply','silent'],answerOnly:false,sourceIds:[],emojiKeys:[]}});
const response = (content = JSON.stringify(output)) => Response.json({model:'deepseek-flash',system_fingerprint:'synthetic-build',
  usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_cache_hit_tokens:40,prompt_cache_miss_tokens:60},
  choices:[{finish_reason:'stop',message:{role:'assistant',content}}]});

async function fixture({fetchImpl,generatePrepared,qualified = async()=>true,reserve = async()=>({}),dispatch = async()=>true,clientKey = key,clientIdentity} = {}) {
  const events = [], inputs = [];
  const raw = createDeepSeekClient({apiKey:'synthetic-provider-key-only-in-worker',acceptedFingerprints:['synthetic-build'],
    fetchImpl:async (...args)=>{events.push('network'); return fetchImpl ? fetchImpl(...args) : response();}});
  const actualIdentity = {...identity,profileHash:raw.profileHash};
  const worker = createAiIpcWorker({identity:actualIdentity,key,adapter:{provider:'deepseek',profileHash:raw.profileHash,prepare(value){inputs.push(value); return raw.prepare(value);},generatePrepared:generatePrepared ?? raw.generatePrepared}});
  const server = createServer(socket=>{void worker.accept(socket);}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const client = createAiIpcClient({identity:clientIdentity ? {...actualIdentity,...clientIdentity} : actualIdentity,key:clientKey,qualified,connect:()=>connect({host:'127.0.0.1',port:server.address().port})});
  const metered = createMeteredAiWorker({worker:client,accounting:{
    async reserve(value){events.push('reserve'); return reserve(value);},
    async dispatch(){events.push('dispatch'); return dispatch();},
    async settle(_token,usage){events.push('settle'); assert.equal(usage.total_tokens,120); return true;},
    async finish(_token,possible){events.push(`finish:${possible}`);},
  }});
  return {client,worker,events,inputs,
    generate(payload=prompt(),context={}) {return metered.generate(payload,{signal:new AbortController().signal,deadline:payload.local.deadline-100,
      beforeDispatch:async()=>true,...context});},
    async close(){client.stop(); await worker.stop(); await new Promise(resolve=>server.close(resolve));},
  };
}

test('DS04-I01 authenticated private-stream turn preserves dispatch/settlement ordering and excludes core-only metadata',async()=>{
  const f=await fixture(); try {
    assert.deepEqual(await f.generate(),output);
    assert.deepEqual(f.events,['reserve','dispatch','network','settle','finish:true']);
    assert.equal(Object.hasOwn(f.inputs[0],'local'),false); assert.equal(Object.hasOwn(f.inputs[0],'token'),false);
    await tick(); assert.equal(f.worker.status().active,false);
  } finally {await f.close();}
});

test('DS04-I02 wrong authentication, worker boot and qualification prevent prompt preparation',async()=>{
  for(const options of [{clientKey:Buffer.alloc(32,8)},{clientIdentity:{bootId:'5'.repeat(64)}},{clientIdentity:{profileHash:'5'.repeat(64)}},{qualified:async()=>false}]) {
    const f=await fixture(options); try {await assert.rejects(f.generate(),/AI_WORKER|AI_DISPATCH/); assert.deepEqual(f.inputs,[]); assert.deepEqual(f.events,[]);}
    finally {await f.close();}
  }
});

test('DS04-I03 post-reservation revocation prevents provider handoff and releases the prepared worker slot',async()=>{
  let current=true; const f=await fixture({dispatch:async()=>{current=false; return true;}});
  try {
    await assert.rejects(f.generate(prompt(),{beforeDispatch:async()=>current}),/AI_WORKER_UNAVAILABLE/);
    assert.deepEqual(f.events,['reserve','dispatch','finish:false']);
    await tick(); assert.equal(f.worker.status().active,false);
  } finally {await f.close();}
});

test('DS04-I04 denied budget and zero-byte silence discard prepared state without spending',async()=>{
  for(const silent of [false,true]) {
    const f=await fixture({reserve:async()=>null}); try {
      const payload=prompt(); if(silent) payload.outputContract.outcomes=['silent'];
      if(silent) assert.deepEqual(await f.generate(payload),{kind:'silent'}); else await assert.rejects(f.generate(payload),/AI_BUDGET_UNAVAILABLE/);
      await tick(); await tick(); assert.equal(f.worker.status().active,false);
      assert.deepEqual(f.events,silent?[]:['reserve']);
    } finally {await f.close();}
  }
});

test('DS04-I05 malformed paid output settles reported usage before rejection',async()=>{
  const f=await fixture({fetchImpl:async()=>response('not-json')}); try {
    await assert.rejects(f.generate(),/AI_WORKER_UNAVAILABLE/);
    assert.deepEqual(f.events,['reserve','dispatch','network','settle','finish:true']);
  } finally {await f.close();}
});

test('DS04-I06 cancellation retains uncertain dispatch and holds the physical worker until transport stops',async()=>{
  const entered=deferred(),held=deferred(),abort=new AbortController(); let networkSignal;
  const f=await fixture({fetchImpl:async(_url,options)=>{networkSignal=options.signal; entered.resolve(); await held.promise; return response();}});
  try {
    const pending=f.generate(prompt(),{signal:abort.signal}); await entered.promise; abort.abort();
    await assert.rejects(pending,/AI_IPC_CLOSED/); await tick();
    assert.equal(networkSignal.aborted,true); assert.equal(f.worker.status().active,true);
    assert.deepEqual(f.events,['reserve','dispatch','network','finish:true']);
    await assert.rejects(f.generate(),/AI_WORKER_UNAVAILABLE/); assert.equal(f.events.filter(value=>value==='network').length,1);
    held.resolve(); await tick(); await tick();
  } finally {held.resolve(); await f.close();}
});

test('DS04-I07 prepared turns are one-use, restricted scopes and expired input are rejected',async()=>{
  const f=await fixture(); try {
    const payload=prompt(),prepared=await f.client.prepare(payload);
    f.client.discardPrepared(prepared);
    await assert.rejects(f.client.generatePrepared(prepared,{}),/AI_PREPARATION_UNTRUSTED/);
    await assert.rejects(f.client.prepare({...prompt(),restricted:true}),/AI_WORKER_NOT_QUALIFIED/);
    await assert.rejects(f.client.prepare({...prompt(),local:{deadline:Date.now()-1}}),/AI_IPC_DEADLINE_INVALID/);
    assert.deepEqual(f.events,[]);
  } finally {await f.close();}
});

test('DS04-I08 duplicate, tampered, oversized and unexpected-kind frames terminate the channel',async()=>{
  for(const mode of ['replay','tamper','oversize','kind']) {
    const accepted=deferred(); let serverChannel;
    const server=createServer(socket=>{
      serverChannel=createAiIpcChannel({stream:socket,key,side:'worker'});
      void (async()=>{await serverChannel.receive('challenge');const sent=serverChannel.send('hello',{challenge:'a'.repeat(64)});serverChannel.bind('a'.repeat(64));await sent;accepted.resolve();})();
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const socket=connect({host:'127.0.0.1',port:server.address().port}); const clientChannel=createAiIpcChannel({stream:socket,key,side:'broker'});
    try {
      await clientChannel.send('challenge',{});const hello=await clientChannel.receive('hello');clientChannel.bind(hello.challenge);await accepted.promise;
      let captured; const write=socket.write.bind(socket); socket.write=(bytes,...rest)=>{captured=Buffer.from(bytes);return write(bytes,...rest);};
      await clientChannel.send('synthetic',{}); await serverChannel.receive('synthetic');
      const next=serverChannel.receive(mode==='kind'?'expected':null);
      if(mode==='oversize') {const header=Buffer.alloc(4);header.writeUInt32BE(1048577);write(header);}
      else if(mode==='kind') await clientChannel.send('wrong',{});
      else {if(mode==='tamper') captured[captured.length-1]^=1;write(captured);}
      await assert.rejects(next,/AI_IPC_(CLOSED|INVALID)/); assert.equal(serverChannel.signal.aborted,true);
    } finally {clientChannel.close();serverChannel?.close();await new Promise(resolve=>server.close(resolve));}
  }
});

test('DS04-I09 cancellation during the final qualification check prevents prompt transfer',async()=>{
  const entered=deferred(),held=deferred(),abort=new AbortController(); let checks=0;
  const f=await fixture({qualified:async()=>{if(++checks===2){entered.resolve();await held.promise;}return true;}});
  try {
    const pending=f.client.prepare(prompt(),{signal:abort.signal}); await entered.promise;
    abort.abort();held.resolve();await assert.rejects(pending,/AI_WORKER_UNAVAILABLE/);
    assert.deepEqual(f.inputs,[]);assert.deepEqual(f.events,[]);
  } finally {held.resolve();await f.close();}
});

test('DS04-I10 the original cutoff terminates transport and keeps a dispatched charge uncertain',async()=>{
  let networkSignal;
  const f=await fixture({fetchImpl:async(_url,{signal})=>{networkSignal=signal;await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw Error('synthetic cancellation');}});
  try {
    await assert.rejects(f.generate(prompt(),{deadline:Date.now()+100}),/AI_IPC_CLOSED|AI_WORKER_UNAVAILABLE/);
    await tick();assert.equal(networkSignal.aborted,true);
    assert.deepEqual(f.events,['reserve','dispatch','network','finish:true']);
  } finally {await f.close();}
});

test('DS04-I11 output or usage preceding the acknowledged dispatch is rejected',async()=>{
  for(const earlyUsage of [false,true]) {
    const f=await fixture({generatePrepared:async(_turn,context)=>{
      if(earlyUsage) await context.recordResponse({usage:{total_tokens:120},model:'deepseek-flash',fingerprint:'synthetic-build'});
      return output;
    }});
    try {await assert.rejects(f.generate(),/AI_IPC_INVALID/);assert.deepEqual(f.events,['reserve','finish:false']);}
    finally {await f.close();}
  }
});

test('DS04-I12 challenges from both peers prevent replaying a prior greeting or request into a new connection',async()=>{
  const sessions=[],clients=[];let priorGreeting,priorRequest;
  const server=createServer(socket=>{
    const channel=createAiIpcChannel({stream:socket,key,side:'worker'}),ready=deferred(),frames=[];
    const write=socket.write.bind(socket);socket.write=(bytes,...rest)=>{frames.push(Buffer.from(bytes));return write(bytes,...rest);};
    sessions.push({channel,ready,frames});
    void (async()=>{await channel.receive('challenge');const challenge=randomBytes(32).toString('hex');
      const sent=channel.send('hello',{challenge});channel.bind(challenge);await sent;ready.resolve();})().catch(()=>{});
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    for(let i=0;i<2;i++) {
      const socket=connect({host:'127.0.0.1',port:server.address().port}),frames=[],write=socket.write.bind(socket);
      socket.write=(bytes,...rest)=>{frames.push(Buffer.from(bytes));return write(bytes,...rest);};
      const channel=createAiIpcChannel({stream:socket,key,side:'broker'});clients.push(channel);
      await channel.send('challenge',{});const hello=await channel.receive('hello');channel.bind(hello.challenge);
      const peer=sessions[i];await peer.ready.promise;
      if(i===0) {
        await channel.send('synthetic',{});await peer.channel.receive('synthetic');
        priorGreeting=peer.frames[0];priorRequest=frames[1];channel.close();peer.channel.close();
      } else {
        const pending=peer.channel.receive();write(priorRequest);await assert.rejects(pending,/AI_IPC_CLOSED/);
      }
    }
  } finally {clients.forEach(channel=>channel.close());sessions.forEach(({channel})=>channel.close());await new Promise(resolve=>server.close(resolve));}
  const replay=createServer(socket=>{socket.on('error',()=>{});socket.once('data',()=>socket.end(priorGreeting));});
  replay.listen(0,'127.0.0.1');await once(replay,'listening');
  const channel=createAiIpcChannel({stream:connect({host:'127.0.0.1',port:replay.address().port}),key,side:'broker'});
  try {await channel.send('challenge',{});await assert.rejects(channel.receive('hello'),/AI_IPC_CLOSED/);}
  finally {channel.close();await new Promise(resolve=>replay.close(resolve));}
});
