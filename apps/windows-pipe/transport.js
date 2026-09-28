import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { requireCondition } from '../../contracts/validation.js';

const signature=0x53505031, frameLimit=65536, queueLimit=1048576;
const fail=()=>Error('AI_NATIVE_PIPE_UNAVAILABLE');
const hex=(value,length)=>typeof value==='string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const number=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32BE(value);return bytes;};

/** Synthetic only: installed identities and pipe namespaces cannot be selected here. */
export async function createSyntheticWindowsPipeTransport({executable,sha256,role,installationId,workerId='0'.repeat(64),bootId='0'.repeat(64),testRun}) {
  requireCondition(process.platform==='win32' && isAbsolute(executable) && hex(sha256,64) &&
    ['supervisor','core','egress','worker'].includes(role) && hex(installationId,64) && hex(workerId,64) && hex(bootId,64) && hex(testRun,32),
  'AI_NATIVE_PIPE_CONFIGURATION_INVALID');
  const info=await stat(executable);
  requireCondition(info.isFile() && info.size>0 && info.size<=1048576 &&
    createHash('sha256').update(await readFile(executable)).digest('hex')===sha256 &&
    createHash('sha256').update(await readFile(process.execPath)).digest('hex')==='3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237',
  'AI_NATIVE_PIPE_BUILD_CHANGED');
  const child=spawn(executable,['synthetic',role,installationId,workerId,bootId,testRun,String(process.pid)],{
    shell:false,windowsHide:true,stdio:['overlapped','overlapped','ignore'],env:{SystemRoot:process.env.SystemRoot},
  });
  const endpoints=new Map(),streams=new Map(),requests=new Map();
  const revocation=new AbortController();
  let state='starting',nextConnection=1,received=Buffer.alloc(0),outbound=[],sending=false,stopped=false,exitError=null;
  let resolveReady,rejectReady,resolveExit;
  const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const exited=new Promise(resolve=>{resolveExit=resolve;});
  const watchdog=setTimeout(()=>abort(),5000);
  function abort() {
    if(state==='closed')return;
    exitError=fail();state='failed';child.stdin.destroy();child.kill();
  }
  function send(code,id,data=Buffer.alloc(0)) {
    if(state==='stopping' && code!==9)return;
    if(!['ready','stopping'].includes(state) || data.length>frameLimit || outbound.length>=16){abort();return;}
    const frame=Buffer.alloc(16+data.length);frame.writeUInt32BE(signature);frame[4]=code;frame.writeUInt32BE(id,8);frame.writeUInt32BE(data.length,12);data.copy(frame,16);
    outbound.push(frame);flush();
  }
  function flush() {
    if(sending || outbound.length===0 || state==='closed' || state==='failed')return;
    sending=true;
    child.stdin.write(outbound[0],error=>{sending=false;outbound.shift();if(error)abort();else flush();});
  }
  function request(code,id,data,reply) {
    const key=`${reply}:${id}`;
    return new Promise((resolve,reject)=>{
      if(state!=='ready' || requests.size>=16 || requests.has(key)){reject(fail());return;}
      const timer=setTimeout(abort,5000);
      requests.set(key,{resolve,reject,timer});send(code,id,data);
    });
  }
  function resolveRequest(code,id,data) {
    const key=`${code}:${id}`,pending=requests.get(key);
    if(!pending)throw fail();requests.delete(key);clearTimeout(pending.timer);pending.resolve(data);
  }
  function endpointFor(path) {
    let kind,worker='0'.repeat(64),boot='0'.repeat(64);
    const control=/^\\\\\.\\pipe\\sophie-ai-control-(core|egress)-([a-f0-9]{64})$/.exec(path);
    const turn=/^\\\\\.\\pipe\\sophie-ai-(inference|egress)-([a-f0-9]{64})-([a-f0-9]{64})$/.exec(path);
    if(control && control[2]===installationId)kind=control[1]==='core'?1:2;
    else if(turn){kind=turn[1]==='inference'?3:4;[, ,worker,boot]=turn;}
    else throw fail();
    const listen=role==='supervisor' && kind<3 || role==='core' && kind===3 || role==='egress' && kind===4;
    const connect=role==='core' && kind===1 || role==='egress' && kind===2 || role==='worker' && kind>=3 && worker===workerId && boot===bootId;
    if(!listen && !connect)throw fail();
    let endpoint=endpoints.get(path);
    if(endpoint)return endpoint;
    if(endpoints.size>=4)throw fail();
    const used=new Set([...endpoints.values()].map(value=>value.id));let id=1;while(used.has(id))id++;
    const data=Buffer.concat([Buffer.from([kind]),Buffer.from(worker+boot,'hex')]);
    endpoint={id,path,listen,connect,server:null,removing:false,ready:request(1,id,data,129)};
    endpoints.set(path,endpoint);endpoint.ready.catch(()=>{});return endpoint;
  }
  function dispatch(code,id,data) {
    if(code===128){
      if(state!=='starting' || id!==0 || !data.equals(Buffer.from([1,0])))throw fail();
      state='ready';clearTimeout(watchdog);resolveReady();return;
    }
    if(state==='starting')throw fail();
    if(code===138){if(state!=='stopping' || id!==0 || data.length!==0)throw fail();stopped=true;return;}
    if([129,130,137].includes(code)){if(data.length!==0)throw fail();resolveRequest(code,id,data);return;}
    if(code===132){
      if(id<0x80000000 || data.length!==4 || streams.has(id) || streams.size>=8)throw fail();
      const endpoint=[...endpoints.values()].find(value=>value.id===data.readUInt32BE());
      if(!endpoint?.server)throw fail();
      const stream=new PipeStream(id,endpoint);streams.set(id,stream);stream.connected();
      void endpoint.server.ready.then(()=>{
        if(endpoint.removing || stream.destroyed)stream.destroy();else endpoint.server.emit('connection',stream);
      },()=>stream.destroy());return;
    }
    const stream=streams.get(id);
    if(code===255){
      if(data.length!==1)throw fail();
      if(data[0]===4 && stream && stream.connecting){stream.physical(false);return;}
      throw fail();
    }
    if(!stream)throw fail();
    if(code===131){if(data.length!==4 || data.readUInt32BE()!==stream.endpoint.id)throw fail();stream.connected();}
    else if(code===133){if(data.length===0)throw fail();stream.receive(data);}
    else if(code===134){if(data.length!==0)throw fail();stream.eof();}
    else if(code===135){if(data.length!==1 || data[0]>1)throw fail();stream.physical(data[0]===0,true);}
    else if(code===136){if(data.length!==4)throw fail();stream.ack(data.readUInt32BE());}
    else throw fail();
  }
  child.stdout.on('data',chunk=>{
    try {
      // At most one incomplete bounded frame survives this callback. Process
      // complete frames before accepting the next OS chunk.
      received=Buffer.concat([received,chunk]);
      let offset=0;
      while(received.length-offset>=16){
        const header=received.subarray(offset,offset+16),length=header.readUInt32BE(12);
        if(header.readUInt32BE()!==signature || header[5] || header[6] || header[7] || length>frameLimit)throw fail();
        if(received.length-offset<16+length)break;
        dispatch(header[4],header.readUInt32BE(8),Buffer.from(received.subarray(offset+16,offset+16+length)));offset+=16+length;
      }
      received=Buffer.from(received.subarray(offset));if(received.length>frameLimit+16)throw fail();
    } catch {abort();}
  });
  child.stdin.on('error',abort);child.stdout.on('error',abort);child.on('error',abort);
  child.on('close',code=>{
    clearTimeout(watchdog);if(code!==0 || !stopped)exitError=fail();state='closed';outbound=[];received=Buffer.alloc(0);
    revocation.abort();
    rejectReady(exitError??fail());
    for(const pending of requests.values()){clearTimeout(pending.timer);pending.reject(fail());}requests.clear();
    for(const stream of [...streams.values()])stream.physical(false);
    for(const endpoint of endpoints.values())endpoint.server?.lost();
    resolveExit();
  });

  class PipeStream extends Duplex {
    constructor(id,endpoint) {
      super({allowHalfOpen:false,autoDestroy:true,readableHighWaterMark:frameLimit,writableHighWaterMark:frameLimit});
      this.id=id;this.endpoint=endpoint;this.connecting=true;this.open=false;this.credit=0;this.remoteEnded=false;
      this.pending=null;this.destroyDone=null;this.timer=null;this.timeout=0;this.orderly=false;
      // Existing callers install their own error handlers; helper loss must also
      // be safe in the interval before an accepted stream reaches its caller.
      this.on('error',()=>{});
    }
    connected() {
      if(!this.connecting)throw fail();this.connecting=false;this.open=true;
      if(this.destroyed){send(8,this.id);return;}
      this.touch();this.emit('connect');this.grant();this.pump();
    }
    write(chunk,encoding,callback) {
      const bytes=typeof chunk==='string'?Buffer.byteLength(chunk,typeof encoding==='string'?encoding:undefined):chunk?.byteLength;
      if(!Number.isSafeInteger(bytes) || bytes>queueLimit || this.writableLength+bytes>queueLimit){
        const done=typeof encoding==='function'?encoding:callback;this.destroy(fail());queueMicrotask(()=>done?.(fail()));return false;
      }
      return super.write(chunk,encoding,callback);
    }
    end(chunk,encoding,callback) {
      if(typeof chunk!=='function' && chunk!==undefined && chunk!==null){
        const bytes=typeof chunk==='string'?Buffer.byteLength(chunk,typeof encoding==='string'?encoding:undefined):chunk?.byteLength;
        if(!Number.isSafeInteger(bytes) || this.writableLength+bytes>queueLimit){
          const done=typeof encoding==='function'?encoding:callback;this.destroy(fail());queueMicrotask(()=>done?.(fail()));return this;
        }
      }
      return super.end(chunk,encoding,callback);
    }
    _write(chunk,_encoding,done) {
      if(chunk.length>queueLimit){done(fail());return;}
      this.pending={chunk,offset:0,expected:null,done};this.pump();
    }
    _final(done) {this.pending={chunk:null,offset:0,expected:null,done};this.pump();}
    pump() {
      const pending=this.pending;
      if(!this.open || this.destroyed || !pending || pending.expected!==null)return;
      if(pending.chunk===null){pending.expected=0;send(7,this.id);return;}
      if(pending.offset===pending.chunk.length){this.pending=null;pending.done();return;}
      const part=pending.chunk.subarray(pending.offset,pending.offset+frameLimit);pending.expected=part.length;send(5,this.id,part);
    }
    ack(length) {
      const pending=this.pending;
      if(this.destroyed && !pending && length===this.cancelledExpected){this.cancelledExpected=null;return;}
      if(!pending || pending.expected!==length)throw fail();
      pending.expected=null;this.touch();
      if(pending.chunk===null){this.pending=null;pending.done();return;}
      pending.offset+=length;this.pump();
    }
    _read() {this.grant();}
    read(size) {const chunk=super.read(size);this.grant();return chunk;}
    grant() {
      if(!this.open || this.destroyed || this.remoteEnded || this.readableLength!==0 || this.credit===frameLimit)return;
      const amount=frameLimit-this.credit;this.credit=frameLimit;send(6,this.id,number(amount));
    }
    receive(bytes) {
      if(!this.open || this.remoteEnded || bytes.length>this.credit)throw fail();
      this.credit-=bytes.length;this.touch();
      if(!this.destroyed){this.push(bytes);this.grant();}
    }
    eof() {
      if(!this.open || this.remoteEnded)throw fail();this.remoteEnded=true;this.push(null);
    }
    physical(orderly,receipt=false) {
      if(this.orderly || (!this.open && !this.connecting))return;
      if(orderly && !this.remoteEnded)throw fail();
      this.open=false;this.connecting=false;this.orderly=orderly;clearTimeout(this.timer);streams.delete(this.id);
      if(receipt && state==='ready')send(10,this.id);
      // An orderly native close must not discard unread final bytes. Duplex
      // auto-destruction waits for the caller to consume EOF and finish writing.
      if(this.destroyDone){const done=this.destroyDone;this.destroyDone=null;done();}
      else if(!orderly)this.destroy(fail());
    }
    _destroy(error,done) {
      clearTimeout(this.timer);
      if(this.pending){const pending=this.pending;this.pending=null;this.cancelledExpected=pending.expected;pending.done(error??fail());}
      if(this.open){this.destroyDone=()=>done(error);if(error || !this.readableEnded || !this.writableFinished)send(8,this.id);}
      else if(this.connecting)this.destroyDone=()=>done(error);
      else done(error);
    }
    setTimeout(milliseconds,callback) {
      if(!Number.isSafeInteger(milliseconds) || milliseconds<0 || milliseconds>60000)throw fail();
      this.timeout=milliseconds;if(callback)this.once('timeout',callback);this.touch();return this;
    }
    touch() {clearTimeout(this.timer);if(this.timeout && this.open)this.timer=setTimeout(()=>this.emit('timeout'),this.timeout);}
    setNoDelay() {return this;}
    setKeepAlive() {return this;}
    ref() {return this;}
    unref() {return this;}
  }
  class PipeServer extends EventEmitter {
    constructor(callback) {super();this.listening=false;this.endpoint=null;this.closing=null;this.on('connection',callback);this.on('error',()=>{});}
    listen(path) {
      try {
        if(this.endpoint)throw fail();const endpoint=endpointFor(path);
        if(!endpoint.listen || endpoint.server || endpoint.removing)throw fail();this.endpoint=endpoint;endpoint.server=this;
        this.ready=endpoint.ready.then(()=>request(3,endpoint.id,Buffer.alloc(0),130)).then(()=>{
          this.listening=true;this.emit('listening');
        });void this.ready.catch(()=>{this.emit('error',fail());});
      }catch{queueMicrotask(()=>this.emit('error',fail()));}return this;
    }
    close(callback) {
      if(callback)this.once('close',callback);
      if(this.closing)return this;
      const endpoint=this.endpoint;
      if(!endpoint){queueMicrotask(()=>this.emit('close'));return this;}
      endpoint.removing=true;
      this.closing=endpoint.ready.then(()=>request(2,endpoint.id,Buffer.alloc(0),137)).then(()=>{
        endpoints.delete(endpoint.path);this.listening=false;this.emit('close');
      },()=>{if(state==='closed')this.lost();else abort();});return this;
    }
    lost() {
      if(this.listening || this.endpoint){
        const fault=exitError && !this.endpoint?.removing;this.listening=false;this.endpoint=null;
        if(fault)this.emit('error',fail());this.emit('close');
      }
    }
  }
  await ready;
  let closing;
  return Object.freeze({
    profile:'synthetic',signal:revocation.signal,
    createServer(callback){requireCondition(typeof callback==='function','AI_NATIVE_PIPE_CONFIGURATION_INVALID');return new PipeServer(callback);},
    connect(path){
      const endpoint=endpointFor(path);
      requireCondition(state==='ready' && endpoint.connect && !endpoint.removing && streams.size<8 && nextConnection<0x80000000,'AI_NATIVE_PIPE_UNAVAILABLE');
      const stream=new PipeStream(nextConnection++,endpoint);streams.set(stream.id,stream);
      void endpoint.ready.then(()=>send(4,stream.id,number(endpoint.id)),()=>stream.physical(false));return stream;
    },
    status:()=>({profile:'synthetic',phase:state,pid:child.pid,streams:streams.size,endpoints:endpoints.size,pending:requests.size}),
    stop(){
      if(closing)return closing;
      closing=(async()=>{
        if(state==='ready'){state='stopping';for(const stream of streams.values())stream.destroy();send(9,0);}
        const timer=setTimeout(abort,5000);await exited;clearTimeout(timer);
        if(exitError)throw exitError;
      })();return closing;
    },
  });
}
