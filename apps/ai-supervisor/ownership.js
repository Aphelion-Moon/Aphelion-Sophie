import { createServer } from 'node:net';
import { requireCondition } from '../../contracts/validation.js';

/** Kernel-held name ownership, not caller authentication or a substitute for Windows pipe ACLs. */
export async function acquireAiSupervisorOwnership(installationId) {
  requireCondition(process.platform==='win32' && typeof installationId==='string' && /^[a-f0-9]{64}$/u.test(installationId),'AI_SUPERVISOR_IDENTITY_INVALID');
  const signal=new AbortController(),peers=new Set();let closing=null;
  const server=createServer(peer=>{peers.add(peer);peer.on('error',()=>{});peer.once('close',()=>peers.delete(peer));peer.destroy();});
  server.on('error',()=>signal.abort());server.on('close',()=>signal.abort());
  try {
    await new Promise((resolve,reject)=>{
      const ready=()=>{server.off('error',failed);resolve();};
      const failed=()=>{server.off('listening',ready);reject(Error('AI_SUPERVISOR_OWNER_BUSY'));};
      server.once('error',failed);server.once('listening',ready);
      server.listen(`\\\\.\\pipe\\sophie-ai-owner-${installationId}`);
    });
    requireCondition(!signal.signal.aborted && server.listening,'AI_SUPERVISOR_OWNER_BUSY');
  } catch {server.close();throw Error('AI_SUPERVISOR_OWNER_BUSY');}
  return Object.freeze({signal:signal.signal,
    close(){
      if(closing)return closing;signal.abort();
      closing=new Promise(resolve=>server.close(resolve));for(const peer of peers)peer.destroy();return closing;
    },
  });
}
