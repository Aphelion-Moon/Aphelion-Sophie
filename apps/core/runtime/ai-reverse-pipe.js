import { createAiIpcClient } from './ai-ipc.js';
import { createAiWorkerInbox } from './ai-worker-inbox.js';

/** Core owns the host listener; the container receives only this named pipe, never Docker access. */
export function createAiReversePipeClient(options) {
  const inbox=createAiWorkerInbox(options),client=createAiIpcClient({...options,connect:inbox.take,
    qualified:async(...args)=>!options.revocationSignal.aborted && await options.qualified(...args)===true && !options.revocationSignal.aborted});
  return Object.freeze({...client,start:inbox.start,inboxStatus:inbox.status,
    async stop(){client.stop();await inbox.stop();}});
}
