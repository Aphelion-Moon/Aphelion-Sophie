import { createServer, connect } from 'node:net';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';

/** Boot-specific name. The OS ACL, remote-pipe access and identity are separately qualified, never inferred from HMAC. */
export function aiWorkerPipe(identity) {
  const fixed = canonicalAiWorkerIdentity(identity);
  requireCondition(process.platform === 'win32', 'AI_WINDOWS_REQUIRED');
  return `\\\\.\\pipe\\sophie-ai-${fixed.workerId}-${fixed.bootId}`;
}

export function connectAiWorkerPipe(identity) { return connect(aiWorkerPipe(identity)); }

/** A stalled qualification service must neither hold prompt closures indefinitely nor accumulate unbounded checks. */
export function createAiWorkerQualification({identity,qualified}) {
  const fixed=canonicalAiWorkerIdentity(identity), stopped=new AbortController(); let pending=0;
  requireCondition(typeof qualified === 'function','TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({
    async current(signal) {
      if(stopped.signal.aborted || signal?.aborted || pending>=4)return false;
      pending++;
      const timeout=new AbortController(), combined=AbortSignal.any([stopped.signal,timeout.signal,...(signal?[signal]:[])]);
      const timer=setTimeout(()=>timeout.abort(),2000);let abort;
      const denied=new Promise(resolve=>{abort=()=>resolve(false);combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
      // The pending count follows the underlying check, even when cancellation wins the race.
      const check=Promise.resolve().then(()=>qualified(fixed,{signal:combined})).then(value=>value===true,()=>false).finally(()=>pending--);
      try {return await Promise.race([denied,check]) && !combined.aborted;}
      finally {clearTimeout(timer);combined.removeEventListener('abort',abort);}
    },
    stop() {stopped.abort();},
  });
}

export function createAiPipeListener({ identity, worker, qualified }) {
  const fixed = canonicalAiWorkerIdentity(identity), path = aiWorkerPipe(fixed), sockets = new Set();
  requireCondition(typeof worker?.accept === 'function' && typeof qualified === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const qualification=createAiWorkerQualification({identity:fixed,qualified});
  let phase = 'idle', closing = null, starting = null;
  const server = createServer(socket => {
    if (phase !== 'listening' || sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket); socket.once('close',()=>sockets.delete(socket)); socket.on('error',()=>{});
    const timer = setTimeout(()=>socket.destroy(),2000); timer.unref?.();
    void (async()=>{
      try {
        requireCondition(await qualification.current() && phase === 'listening' && !socket.destroyed,'AI_WORKER_NOT_QUALIFIED');
        clearTimeout(timer); await worker.accept(socket);
      } catch { socket.destroy(); }
      finally { clearTimeout(timer); }
    })();
  });
  server.on('error',()=>{phase='failed'; for (const socket of sockets) socket.destroy();});
  return Object.freeze({
    start() {
      requireCondition(phase === 'idle','AI_WORKER_ALREADY_STARTED'); phase='starting';
      starting = (async()=>{
      try {
        requireCondition(await qualification.current() && phase === 'starting','AI_WORKER_NOT_QUALIFIED');
        await new Promise((resolve,reject)=>{
          const error=()=>{server.off('listening',ready);reject(Error('AI_PIPE_UNAVAILABLE'));};
          const ready=()=>{server.off('error',error);resolve();};
          server.once('error',error);server.once('listening',ready);server.listen(path);
        });
        requireCondition(phase === 'starting','AI_WORKER_STOPPED'); phase='listening';
      } catch { if (phase !== 'stopped') phase='failed'; throw Error('AI_PIPE_UNAVAILABLE'); }
      })(); return starting;
    },
    status() { return {phase,connections:sockets.size}; },
    stop() {
      if (closing) return closing;
      phase='stopped'; qualification.stop(); for (const socket of sockets) socket.destroy();
      closing = (async()=>{
        await starting?.catch(()=>{});
        await new Promise(resolve => { if (server.listening) server.close(()=>resolve()); else resolve(); });
      })(); return closing;
    },
  });
}
