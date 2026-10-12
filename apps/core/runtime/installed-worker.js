import { canonicalAiWorkerRelease } from '../../../modules/assistant/worker-release.js';
import { installedRoleContext, installedWorkerIdentity } from '../../installation/context.js';
import { createAiReversePipeClient } from './ai-reverse-pipe.js';

/**
 * Core's connection to the worker service: a loopback listener that accepts only the installation's worker (channel-key
 * handshake), plus the turn protocol. The worker is an ordinary service running alongside core; core neither starts nor
 * stops it. Configuration Apply replaces this object together with the runtime that owns it.
 */
export function createInstalledAiWorker({pipes,signal}) {
  const {configuration,qualified,revocationSignal,keys}=installedRoleContext(pipes,'core',signal);
  try {
    const release=canonicalAiWorkerRelease(configuration.release);
    // The IPC client keeps its key for every connection; it receives its own copy before the context keys are cleared.
    const client=createAiReversePipeClient({identity:installedWorkerIdentity(configuration),key:Buffer.from(keys.channel),qualified,revocationSignal,
      createPipeServer:pipes.createServer});
    return Object.freeze({...client,release});
  } finally {Object.values(keys).forEach(key=>key.fill(0));}
}
