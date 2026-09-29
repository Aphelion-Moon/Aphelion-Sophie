import { requireCondition } from '../../contracts/validation.js';
import { createDeepSeekTransport } from './http-transport.js';
import { createAiWorkerRuntime } from './runtime.js';

/** Runs under the dedicated restricted inference account, with direct outbound network access
 * scoped by the host firewall to the provider host only. No relay/tunnel process is needed. */
export function createInstalledWorker({boot,lease,onFault}) {
  requireCondition(lease.signal instanceof AbortSignal,'AI_WORKER_NOT_QUALIFIED');
  return createAiWorkerRuntime({identity:boot.identity,key:boot.ipcKey,apiKey:boot.apiKey,acceptedFingerprints:boot.acceptedFingerprints,
    qualified:lease.current,revocationSignal:lease.signal,transport:createDeepSeekTransport(),connectionMode:'dial-host',onFault});
}
