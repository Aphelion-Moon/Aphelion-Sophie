import { requireCondition } from '../../contracts/validation.js';
import { createMistralTransport } from './http-transport.js';
import { createAiWorkerRuntime } from './runtime.js';

/** Runs under the dedicated restricted worker account, with direct outbound network access scoped by the host firewall
 * to TCP 443. The transport fixes the provider origin and checks public IPv4. No relay or supervisor process is needed. */
export function createInstalledWorker({identity,key,apiKey,acceptedFingerprints,qualified,revocationSignal,onFault}) {
  requireCondition(revocationSignal instanceof AbortSignal,'AI_WORKER_NOT_QUALIFIED');
  return createAiWorkerRuntime({identity,key,apiKey,acceptedFingerprints,qualified,revocationSignal,transport:createMistralTransport(),onFault});
}
