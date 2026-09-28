import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { connect, createServer as createNetServer } from 'node:net';
import { connect as connectTls, rootCertificates, checkServerIdentity } from 'node:tls';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createAiEgressBridge } from '../apps/ai-egress/runtime.js';
import { isPublicAiAddress } from '../apps/ai-egress/public-address.js';
import { aiEgressPipe, authenticateAiEgress } from '../apps/knowledge-worker/egress-channel.js';
import { createDeepSeekPipeConnector } from '../apps/knowledge-worker/egress-client.js';
import { createDeepSeekTransport } from '../apps/knowledge-worker/http-transport.js';

const certificates = JSON.parse(await readFile(new URL('./fixtures/ai-egress-tls.json',import.meta.url),'utf8'));
const key = Buffer.alloc(32,11), apiKey = 'synthetic-provider-credential';
const endpoint = 'https://api.deepseek.com/chat/completions';
const native = {skip:process.platform!=='win32',timeout:15000};
const tick = () => new Promise(resolve=>setImmediate(resolve));
const options = signal => ({method:'POST',redirect:'error',signal,
  headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:'{"question":"synthetic-private-prompt"}'});
async function until(check) {
  const deadline=Date.now()+2000;
  while(!check() && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(check());
}
async function readExactly(socket,length) {
  for(;;){const bytes=socket.read(length);if(bytes)return bytes;await once(socket,'readable');}
}

async function fixture({addresses=['93.184.215.14'],trust=true,wrongHost=false,qualified=async()=>true,resolve4,handler}={}) {
  const identity={workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
    profileHash:'4'.repeat(64),provider:'deepseek',domain:'public'};
  const revocation=new AbortController(), ciphertext=[], proofs=[];
  let dnsCalls=0,connects=0,requests=0,cancelled=0;
  const server=createServer({key:certificates.key,cert:wrongHost?certificates.wrongCert:certificates.cert},(request,response)=>{
    requests++;assert.equal(request.url,'/chat/completions');assert.equal(request.headers.authorization,`Bearer ${apiKey}`);
    request.resume();if(handler)handler(request,response);else response.end('{"synthetic":true}');
  });
  server.on('tlsClientError',()=>{});server.listen(0,'127.0.0.1');await once(server,'listening');
  const bridge=createAiEgressBridge({identity,key,qualified,revocationSignal:revocation.signal,
    createResolver:()=>({resolve4:async host=>{assert.equal(host,'api.deepseek.com');dnsCalls++;return resolve4?resolve4():addresses;},cancel(){cancelled++;}}),
    connectTcp(settings){
      assert.deepEqual(settings,{host:addresses[0],port:443,family:4});connects++;
      const socket=connect({host:'127.0.0.1',port:server.address().port});
      const write=socket.write.bind(socket);socket.write=(bytes,...args)=>{ciphertext.push(Buffer.from(bytes));return write(bytes,...args);};return socket;
    }});
  const connectorSettings={identity,key,revocationSignal:revocation.signal,connectPipe(path){
    assert.equal(path,aiEgressPipe(identity));const socket=connect(path),write=socket.write.bind(socket);
    socket.write=(bytes,...args)=>{if(Buffer.isBuffer(bytes)&&bytes.length===64)proofs.push(Buffer.from(bytes));return write(bytes,...args);};return socket;
  },tlsConnect(settings){
    assert.equal(settings.host,'api.deepseek.com');assert.equal(settings.servername,'api.deepseek.com');
    assert.equal(settings.rejectUnauthorized,true);assert.equal(settings.checkServerIdentity,checkServerIdentity);
    assert.equal(settings.ca,rootCertificates);assert.equal(settings.minVersion,'TLSv1.2');assert.deepEqual(settings.ALPNProtocols,['http/1.1']);
    return connectTls(trust?{...settings,ca:wrongHost?certificates.wrongCert:certificates.cert}:settings);
  }};
  const connector=createDeepSeekPipeConnector(connectorSettings),transport=createDeepSeekTransport({connector});
  await bridge.start();
  return {identity,bridge,connector,connectorSettings,transport,revocation,proofs,ciphertext,
    stats:()=>({dnsCalls,connects,requests,cancelled}),async close(){
      await transport.stop();await bridge.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }};
}

test('DS04-E01 special-purpose, malformed and non-IPv4 destinations are refused',()=>{
  for(const address of ['0.1.2.3','10.0.0.1','100.64.0.1','100.127.255.254','127.0.0.1','169.254.169.254','172.16.0.1','172.31.255.254',
    '192.0.0.9','192.0.2.1','192.31.196.1','192.52.193.1','192.88.99.1','192.168.0.1','192.175.48.1','198.18.0.1','198.19.0.1','198.51.100.1','203.0.113.1','224.0.0.1',
    '239.255.255.255','240.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','127.1','2130706433','01.2.3.4','api.deepseek.com'])
    assert.equal(isPublicAiAddress(address),false,address);
  assert.equal(isPublicAiAddress('93.184.215.14'),true);
});

test('DS04-E02 native pipe carries worker TLS and reuses one socket without exposing request text to the bridge',native,async()=>{
  const f=await fixture();
  try {
    for(let n=0;n<2;n++){
      const reply=await f.transport.fetch(endpoint,options(new AbortController().signal));assert.deepEqual(await reply.json(),{synthetic:true});await tick();
    }
    assert.equal(f.stats().connects,1);assert.equal(f.stats().requests,2);assert.equal(f.stats().dnsCalls,1);
    const wire=Buffer.concat(f.ciphertext);assert.ok(wire.length>0);
    for(const value of [apiKey,'synthetic-private-prompt','POST /chat/completions'])assert.equal(wire.includes(Buffer.from(value)),false);
    await f.transport.stop();await until(()=>f.bridge.status().connections===0);
  } finally {await f.close();}
});

test('DS04-E03 wrong boot profile or authentication key cannot cause DNS or outbound traffic',native,async()=>{
  for(const kind of ['key','profile']){
    const f=await fixture();
    const connector=createDeepSeekPipeConnector({...f.connectorSettings,
      ...(kind==='key'?{key:Buffer.alloc(32,12)}:{identity:{...f.identity,profileHash:'5'.repeat(64)}})});
    try {
      await assert.rejects(connector.open(new AbortController().signal),/AI_EGRESS_UNAVAILABLE/);
      assert.equal(f.stats().dnsCalls,0);assert.equal(f.stats().connects,0);
    } finally {await connector.stop();await f.close();}
  }
});

test('DS04-E04 replayed proof fails against the next connection challenge',native,async()=>{
  const f=await fixture();let peer;
  try {
    const reply=await f.transport.fetch(endpoint,options(new AbortController().signal));await reply.text();
    await f.transport.stop();await until(()=>f.bridge.status().connections===0);assert.equal(f.proofs.length,1);
    peer=connect(aiEgressPipe(f.identity));peer.on('error',()=>{});const closed=once(peer,'close');
    const greeting=await readExactly(peer,64);assert.equal(greeting.length,64);peer.write(f.proofs[0]);await closed;
    assert.equal(f.stats().dnsCalls,1);assert.equal(f.stats().connects,1);
  } finally {peer?.destroy();await f.close();}
});

test('DS04-E05 rejected or mixed DNS answers never reach a TCP connector',native,async()=>{
  for(const addresses of [['127.0.0.1'],['93.184.215.14','169.254.169.254'],[],Array(17).fill('93.184.215.14')]){
    const f=await fixture({addresses});
    try {await assert.rejects(f.connector.open(new AbortController().signal),/AI_EGRESS_UNAVAILABLE/);assert.equal(f.stats().connects,0);}
    finally {await f.close();}
  }
});

test('DS04-E06 untrusted certificate and trusted certificate for a different host send no HTTP request',native,async()=>{
  for(const settings of [{trust:false},{wrongHost:true}]){
    const f=await fixture(settings);
    try {
      await assert.rejects(f.transport.fetch(endpoint,options(new AbortController().signal)),/AI_HTTP_UNAVAILABLE/);
      assert.equal(f.stats().connects,1);assert.equal(f.stats().requests,0);
    } finally {await f.close();}
  }
});

test('DS04-E07 revocation or request cancellation closes in-flight TLS and both bridge sockets',native,async()=>{
  for(const mode of ['revoke','abort','stop']){
    let entered;const ready=new Promise(resolve=>entered=resolve);
    const f=await fixture({handler:()=>entered()}),abort=new AbortController();
    try {
      const pending=assert.rejects(f.transport.fetch(endpoint,options(abort.signal)),/AI_HTTP|abort/iu);await ready;
      if(mode==='revoke')f.revocation.abort();else if(mode==='abort')abort.abort();else await f.transport.stop();
      await pending;await until(()=>f.bridge.status().connections===0);
      assert.equal(f.stats().requests,1);assert.equal(f.stats().connects,1);
    } finally {await f.close();}
  }
});

test('DS04-E08 stop cancels pending DNS and cannot create a late outbound connection',native,async()=>{
  let entered,release;const ready=new Promise(resolve=>entered=resolve),lookup=new Promise(resolve=>release=resolve);
  const f=await fixture({resolve4:()=>{entered();return lookup;}});
  try {
    const pending=assert.rejects(f.connector.open(new AbortController().signal),/AI_EGRESS_UNAVAILABLE/);await ready;
    const closing=f.bridge.stop();release(['93.184.215.14']);await closing;await pending;
    assert.ok(f.stats().cancelled>0);assert.equal(f.stats().connects,0);assert.equal(f.bridge.status().connections,0);
  } finally {await f.close();}
});

test('DS04-E09 one physical connection bounds admission even during authentication',native,async()=>{
  const f=await fixture();let first,second;
  try {
    first=connect(aiEgressPipe(f.identity));first.on('error',()=>{});await readExactly(first,64);
    second=connect(aiEgressPipe(f.identity));second.on('error',()=>{});await once(second,'close');
    assert.equal(f.bridge.status().connections,1);assert.equal(f.stats().dnsCalls,0);
    first.destroy();await until(()=>f.bridge.status().connections===0);
  } finally {first?.destroy();second?.destroy();await f.close();}
});

test('DS04-E10 qualification is checked after DNS and before creating the destination socket',native,async()=>{
  let qualified=true;
  const f=await fixture({qualified:async()=>qualified,resolve4:async()=>{qualified=false;return ['93.184.215.14'];}});
  try {await assert.rejects(f.connector.open(new AbortController().signal),/AI_EGRESS_UNAVAILABLE/);assert.equal(f.stats().connects,0);}
  finally {await f.close();}
});

test('DS04-E11 handshake cancellation rejects without holding a live pipe',native,async()=>{
  const f=await fixture();let peer;
  try {
    peer=connect(aiEgressPipe(f.identity));peer.on('error',()=>{});await readExactly(peer,64);
    const abort=new AbortController();
    const pending=assert.rejects(authenticateAiEgress({stream:peer,identity:f.identity,key,side:'worker',signal:abort.signal}),/AI_EGRESS_UNAVAILABLE/);
    abort.abort();await pending;await until(()=>f.bridge.status().connections===0);assert.equal(f.stats().dnsCalls,0);
  } finally {peer?.destroy();await f.close();}
});

test('DS04-E12 a stalled unauthenticated peer expires before any DNS or TCP activity',native,async()=>{
  const f=await fixture();let peer;
  try {
    peer=connect(aiEgressPipe(f.identity));peer.on('error',()=>{});const closed=once(peer,'close');
    await readExactly(peer,64);await closed;await until(()=>f.bridge.status().connections===0);
    assert.equal(f.stats().dnsCalls,0);assert.equal(f.stats().connects,0);
  } finally {peer?.destroy();await f.close();}
});

test('DS04-E13 opaque encrypted byte limits close both directions even for a worker bypassing the HTTP adapter',native,async()=>{
  for(const mode of ['outbound','inbound']){
    const f=await fixture({handler:(_request,response)=>{if(mode==='inbound')response.end(Buffer.alloc(2097153,65));}});let tls;
    try {
      tls=await f.connector.open(new AbortController().signal);let received=0;
      tls.on('data',chunk=>received+=chunk.length);const closed=once(tls,'close');
      const length=mode==='outbound'?1048577:0;
      tls.write(`POST /chat/completions HTTP/1.1\r\nHost: api.deepseek.com\r\nAuthorization: Bearer ${apiKey}\r\nContent-Length: ${length}\r\n\r\n`);
      if(length)tls.write(Buffer.alloc(length,65));await closed;await until(()=>f.bridge.status().connections===0);
      assert.equal(f.stats().connects,1);assert.ok(Buffer.concat(f.ciphertext).length<=1048576);
      if(mode==='inbound'){assert.ok(received>0);assert.ok(received<2097152);}
    } finally {tls?.destroy();await f.close();}
  }
});

test('DS04-E14 concurrent stop and denied startup cannot expose the bridge pipe',native,async()=>{
  for(const mode of ['stop','deny']){
    const identity={workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
      profileHash:'4'.repeat(64),provider:'deepseek',domain:'public'};
    let release;const qualified=new Promise(resolve=>release=resolve);
    const bridge=createAiEgressBridge({identity,key,qualified:()=>qualified,revocationSignal:new AbortController().signal});
    const pending=assert.rejects(bridge.start(),/AI_EGRESS_UNAVAILABLE/);
    const stopped=mode==='stop'?bridge.stop():null;release(mode==='stop');await pending;await stopped;await bridge.stop();
    const peer=connect(aiEgressPipe(identity));await once(peer,'error');assert.equal(bridge.status().phase,'stopped');
  }
});

test('DS04-E15 byte-fragmented challenges, proofs and acknowledgement authenticate with reordered identity keys',native,async()=>{
  const identity={workerId:randomBytes(32).toString('hex'),bootId:randomBytes(32).toString('hex'),releaseHash:'3'.repeat(64),
    profileHash:'4'.repeat(64),provider:'deepseek',domain:'public'};
  const fragment=socket=>{
    const write=socket.write.bind(socket);
    socket.write=(bytes,callback)=>{
      let offset=0;
      const next=()=>{
        if(offset===bytes.length){callback();return;}
        const part=bytes.subarray(offset,offset+7);offset+=part.length;
        write(part,error=>error?callback(error):setImmediate(next));
      };next();return true;
    };return socket;
  };
  let serverPeer,complete;
  const accepted=new Promise(resolve=>complete=resolve);
  const server=createNetServer(peer=>{
    serverPeer=fragment(peer);complete(authenticateAiEgress({stream:peer,identity,key,side:'bridge',signal:new AbortController().signal}));
  });
  server.listen(aiEgressPipe(identity));await once(server,'listening');const peer=fragment(connect(aiEgressPipe(identity)));
  try {
    await Promise.all([accepted,authenticateAiEgress({stream:peer,identity:Object.fromEntries(Object.entries(identity).reverse()),
      key,side:'worker',signal:new AbortController().signal})]);
    assert.equal(peer.destroyed,false);assert.equal(serverPeer.destroyed,false);
  } finally {peer.destroy();serverPeer?.destroy();await new Promise(resolve=>server.close(resolve));}
});

test('DS04-E16 a provider closing its connection still delivers the complete final response',native,async()=>{
  const f=await fixture({handler:(_request,response)=>{response.setHeader('connection','close');response.end('x'.repeat(64000));}});
  try {
    const response=await f.transport.fetch(endpoint,options(new AbortController().signal));
    assert.equal((await response.text()).length,64000);await until(()=>f.bridge.status().connections===0);
  } finally {await f.close();}
});
