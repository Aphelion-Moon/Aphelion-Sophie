import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { requireCondition, requireInteger } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';
import { aiBootPipe, authenticateAiBootPipe } from './boot-pipe.js';
import { createAiWorkerQualification } from './qualification.js';

function waitForTurn(socket,signal) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{socket.off('readable',ready);socket.off('close',fail);socket.off('end',fail);signal.removeEventListener('abort',fail);};
    const fail=()=>{cleanup();reject(Error('AI_WORKER_UNAVAILABLE'));};
    const ready=()=>{if(signal.aborted || socket.destroyed)fail();else if(socket.readableLength>0){cleanup();resolve();}};
    socket.on('readable',ready);socket.once('close',fail);socket.once('end',fail);signal.addEventListener('abort',fail,{once:true});ready();
  });
}

/**
 * The worker initiates each physical connection to core and keeps `connections` authenticated idle connections, so
 * that many turns can run at once. A connection carries one turn and is then replaced; a reconnection never replays a
 * turn. While core is unreachable (restarting, for example) the worker waits and retries instead of exiting; only a
 * lost installation qualification stops it.
 */
export function createAiInferenceDialer({identity,key,worker,qualified,onFault,connectPipe=connect,connections=2,retry={initialMs:1000,maximumMs:10000}}) {
  const fixed=canonicalAiWorkerIdentity(identity),path=aiBootPipe(fixed,'inference');
  requireCondition(Buffer.isBuffer(key) && key.length===32 && typeof worker?.accept==='function' &&
    typeof qualified==='function' && typeof onFault==='function','AI_IPC_CONFIGURATION_INVALID');
  requireInteger(connections,1,4);requireInteger(retry.initialMs,1,60000);requireInteger(retry.maximumMs,retry.initialMs,600000);
  const secret=Buffer.from(key),lifetime=new AbortController(),qualification=createAiWorkerQualification({identity:fixed,qualified});
  const sockets=new Set();let phase='idle',loops=[],closing=null,authenticated=0;
  function stop() {
    if(closing)return closing;
    phase='stopped';lifetime.abort();qualification.stop();secret.fill(0);for(const socket of sockets)socket.destroy();
    closing=Promise.allSettled(loops).then(()=>{});return closing;
  }
  async function connection() {
    const socket=connectPipe(path);socket.on('error',()=>{});sockets.add(socket);
    try {
      await authenticateAiBootPipe({stream:socket,identity:fixed,key:secret,side:'worker',signal:lifetime.signal,purpose:'inference'});
      authenticated++;
      await waitForTurn(socket,lifetime.signal);
      requireCondition(await qualification.current(lifetime.signal) && !lifetime.signal.aborted,'AI_WORKER_NOT_QUALIFIED');
      await worker.accept(socket);
      if(!socket.closed)await new Promise(resolve=>socket.once('close',resolve));
    } finally {socket.destroy();sockets.delete(socket);}
  }
  async function loop() {
    let wait=retry.initialMs;
    while(!lifetime.signal.aborted){
      if(!await qualification.current(lifetime.signal)){
        if(!lifetime.signal.aborted){phase='failed';try{onFault('AI_WORKER_NOT_QUALIFIED');}catch{}}
        return;
      }
      const before=authenticated;
      try {await connection();} catch {/* Core unreachable, restarting or the turn ended: reconnect below. */}
      if(lifetime.signal.aborted)return;
      // A connection that authenticated proves core is up: reconnect at once. Otherwise back off.
      if(authenticated>before)wait=retry.initialMs;
      else {await delay(wait,undefined,{signal:lifetime.signal}).catch(()=>{});wait=Math.min(retry.maximumMs,wait*2);}
    }
  }
  return Object.freeze({
    async start() {
      requireCondition(phase==='idle','AI_IPC_ALREADY_STARTED');
      requireCondition(await qualification.current(lifetime.signal),'AI_WORKER_NOT_QUALIFIED');
      phase='running';loops=Array.from({length:connections},()=>loop());
    },
    status(){return {phase,connections:sockets.size};},stop,
  });
}
