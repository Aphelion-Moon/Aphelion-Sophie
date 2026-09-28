import { createServer, connect } from 'node:net';
import { Resolver } from 'node:dns/promises';
import { Transform } from 'node:stream';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../knowledge-worker/ipc-contract.js';
import { aiEgressPipe, authenticateAiEgress } from '../knowledge-worker/egress-channel.js';
import { createAiWorkerQualification } from '../knowledge-worker/windows-pipe.js';
import { isPublicAiAddress } from './public-address.js';

const host = 'api.deepseek.com';

function boundedBytes(limit) {
  let total = 0;
  return new Transform({ transform(chunk,_encoding,done) {
    total += chunk.length;
    done(total > limit ? Error('AI_EGRESS_LIMIT') : null,total > limit ? undefined : chunk);
  } });
}

/** One boot, one fixed destination, one opaque TLS stream. This identity has no provider key or Docker authority. */
export function createAiEgressBridge({ identity, key, qualified, revocationSignal,
  createResolver = () => new Resolver({timeout:2000,tries:1}), connectTcp = connect, createPipeServer = createServer }) {
  const fixed = canonicalAiWorkerIdentity(identity), path = aiEgressPipe(fixed);
  requireCondition(Buffer.isBuffer(key) && key.length === 32 && typeof qualified === 'function' &&
    revocationSignal instanceof AbortSignal && typeof createResolver === 'function' && typeof connectTcp === 'function',
  'AI_EGRESS_CONFIGURATION_INVALID');
  const secret = Buffer.from(key), lifetime = new AbortController();
  const qualification = createAiWorkerQualification({identity:fixed,qualified});
  const signal = AbortSignal.any([lifetime.signal,revocationSignal]);
  const sessions = new Set(); let phase = 'idle', starting, closing;
  const server = createPipeServer(peer => {
    peer.on('error',()=>{});
    if (phase !== 'listening' || signal.aborted || sessions.size !== 0) { peer.destroy(); return; }
    const session = { peer, upstream:null, resolver:null, task:null };
    sessions.add(session);
    const abort = new AbortController(), currentSignal = AbortSignal.any([signal,abort.signal]);
    const close = () => { abort.abort(); peer.destroy(); session.upstream?.destroy(); session.resolver?.cancel(); };
    const timer = setTimeout(close,60000);
    peer.setTimeout(15000,close); peer.once('close',close); peer.once('end',close);
    currentSignal.addEventListener('abort',close,{once:true});
    session.task = (async()=>{
      try {
        requireCondition(await qualification.current(currentSignal) && !currentSignal.aborted,'AI_EGRESS_UNAVAILABLE');
        await authenticateAiEgress({stream:peer,identity:fixed,key:secret,side:'bridge',signal:currentSignal});
        requireCondition(await qualification.current(currentSignal) && !currentSignal.aborted,'AI_EGRESS_UNAVAILABLE');
        session.resolver = createResolver();
        const addresses = await session.resolver.resolve4(host);
        requireCondition(Array.isArray(addresses) && addresses.length > 0 && addresses.length <= 16 &&
          addresses.every(isPublicAiAddress) && !currentSignal.aborted,'AI_EGRESS_UNAVAILABLE');
        requireCondition(await qualification.current(currentSignal) && !currentSignal.aborted,'AI_EGRESS_UNAVAILABLE');
        // Connect to the checked numeric address: no second DNS lookup, caller destination, retry or proxy.
        const upstream = connectTcp({host:addresses[0],port:443,family:4}); session.upstream = upstream;
        upstream.on('error',close);
        // A normal provider EOF must drain the encrypted reply through the pipe before it closes.
        upstream.once('close',()=>{if(!upstream.readableEnded)close();}); upstream.setTimeout(15000,close);
        await new Promise((resolve,reject)=>{
          const fail=()=>{upstream.off('connect',ready);reject(Error('AI_EGRESS_UNAVAILABLE'));};
          const ready=()=>{upstream.off('close',fail);resolve();};
          upstream.once('connect',ready);upstream.once('close',fail);
          if (currentSignal.aborted) close();
        });
        requireCondition(!currentSignal.aborted,'AI_EGRESS_UNAVAILABLE');
        const outbound = boundedBytes(1048576), inbound = boundedBytes(2097152);
        outbound.on('error',close); inbound.on('error',close);
        const ended = new Promise(resolve=>peer.once('close',resolve));
        peer.pipe(outbound).pipe(upstream); upstream.pipe(inbound).pipe(peer);
        await ended; outbound.destroy(); inbound.destroy();
      } catch { close(); }
      finally {
        close(); clearTimeout(timer); currentSignal.removeEventListener('abort',close);
        // Keep the physical slot occupied until both sockets have closed.
        await Promise.all([peer,session.upstream].filter(socket=>socket && !socket.closed)
          .map(socket=>new Promise(resolve=>socket.once('close',resolve))));
        sessions.delete(session);
      }
    })();
  });
  server.on('error',()=>{phase='failed';void stop();});
  function stop() {
    if (closing) return closing;
    phase='stopped'; lifetime.abort(); qualification.stop(); secret.fill(0);
    revocationSignal.removeEventListener('abort',revoke);
    closing=(async()=>{
      await starting?.catch(()=>{});
      const closed = new Promise(resolve=>server.listening ? server.close(()=>resolve()) : resolve());
      await Promise.all([closed,...[...sessions].map(session=>session.task)]);
    })(); return closing;
  }
  const revoke=()=>{void stop();}; revocationSignal.addEventListener('abort',revoke,{once:true});
  if (revocationSignal.aborted) revoke();
  return Object.freeze({
    start() {
      requireCondition(phase === 'idle','AI_EGRESS_ALREADY_STARTED'); phase='starting';
      starting=(async()=>{
        try {
          requireCondition(await qualification.current(signal) && phase === 'starting' && !signal.aborted,'AI_EGRESS_UNAVAILABLE');
          await new Promise((resolve,reject)=>{
            const error=()=>{server.off('listening',ready);reject(Error('AI_EGRESS_UNAVAILABLE'));};
            const ready=()=>{server.off('error',error);resolve();};
            server.once('error',error);server.once('listening',ready);server.listen(path);
          });
          requireCondition(phase === 'starting' && !signal.aborted,'AI_EGRESS_UNAVAILABLE');phase='listening';
        } catch { if (phase !== 'stopped') phase='failed';throw Error('AI_EGRESS_UNAVAILABLE'); }
      })();return starting;
    },
    status() { return {phase,connections:sessions.size,destination:host,port:443}; },
    stop,
  });
}
