import { connect } from 'node:net';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';
import { aiBootPipe, authenticateAiBootPipe } from './boot-pipe.js';
import { createAiWorkerQualification } from './windows-pipe.js';

function waitForTurn(socket,signal) {
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{socket.off('readable',ready);socket.off('close',fail);socket.off('end',fail);signal.removeEventListener('abort',fail);};
    const fail=()=>{cleanup();reject(Error('AI_WORKER_UNAVAILABLE'));};
    const ready=()=>{if(signal.aborted || socket.destroyed)fail();else if(socket.readableLength>0){cleanup();resolve();}};
    socket.on('readable',ready);socket.once('close',fail);socket.once('end',fail);signal.addEventListener('abort',fail,{once:true});ready();
  });
}

/** Guest initiates each physical connection. Reconnection starts a new IPC channel, never replays a turn. */
export function createAiInferenceDialer({identity,key,worker,qualified,onFault}) {
  const fixed=canonicalAiWorkerIdentity(identity),path=aiBootPipe(fixed,'inference');
  requireCondition(Buffer.isBuffer(key) && key.length===32 && typeof worker?.accept==='function' &&
    typeof qualified==='function' && typeof onFault==='function','AI_IPC_CONFIGURATION_INVALID');
  const secret=Buffer.from(key),lifetime=new AbortController(),qualification=createAiWorkerQualification({identity:fixed,qualified});
  let phase='idle',socket=null,loop=null,closing=null,firstReady,firstFailed;
  function stop() {
    if(closing)return closing;
    phase='stopped';lifetime.abort();qualification.stop();secret.fill(0);socket?.destroy();firstFailed?.(Error('AI_WORKER_UNAVAILABLE'));
    closing=Promise.resolve(loop).then(()=>{});return closing;
  }
  return Object.freeze({
    start() {
      requireCondition(phase==='idle','AI_IPC_ALREADY_STARTED');phase='starting';
      const ready=new Promise((resolve,reject)=>{firstReady=resolve;firstFailed=reject;});
      loop=(async()=>{
        try {
          while(!lifetime.signal.aborted){
            requireCondition(await qualification.current(lifetime.signal) && !lifetime.signal.aborted,'AI_WORKER_NOT_QUALIFIED');
            socket=connect(path);socket.on('error',()=>{});
            await authenticateAiBootPipe({stream:socket,identity:fixed,key:secret,side:'worker',signal:lifetime.signal,purpose:'inference'});
            phase='waiting';firstReady();
            await waitForTurn(socket,lifetime.signal);
            requireCondition(await qualification.current(lifetime.signal) && !lifetime.signal.aborted,'AI_WORKER_NOT_QUALIFIED');
            phase='working';await worker.accept(socket);
            if(!socket.closed)await new Promise(resolve=>socket.once('close',resolve));socket=null;
          }
        } catch {
          if(!lifetime.signal.aborted){phase='failed';try{onFault('AI_WORKER_CONNECTION_LOST');}catch{}}
          firstFailed(Error('AI_WORKER_UNAVAILABLE'));
        } finally {
          socket?.destroy();if(socket && !socket.closed)await new Promise(resolve=>socket.once('close',resolve));socket=null;
        }
      })();return ready;
    },
    status(){return {phase,connected:socket!==null};},stop,
  });
}
