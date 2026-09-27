import { ContractError, requireCondition, requireInteger } from '../../../contracts/validation.js';

/** Process lifetime only. The runtime retains ownership of workers, leases and listeners. */
export async function runRuntimeHost({ runtime, signal, report, intervalMs = 5000 }) {
  requireInteger(intervalMs, 1, 60000);
  let finish, timer, polling, failure = null, finished = false, health = null;
  const stopped = new Promise(resolve => { finish = resolve; });
  const stop = error => {
    if (finished) return;
    finished = true; failure = error; clearTimeout(timer); finish();
  };
  const abort = () => stop(null);
  signal.addEventListener('abort', abort, { once: true });
  async function poll() {
    try {
      const status = await runtime.status();
      if (finished) return;
      const next = JSON.stringify({ current: status.current, phase: status.gateway.phase });
      if (next !== health) { health = next; report({ health: JSON.parse(next) }); }
      // Reconnection and configuration maintenance are expected; an internally stopped
      // runtime is a failure so a service manager can apply its restart policy.
      requireCondition(!status.stopping, 'RUNTIME_GATEWAY_HALTED');
    } catch (error) {
      stop(error?.code === 'RUNTIME_GATEWAY_HALTED' ? error : new ContractError('RUNTIME_HEALTH_UNAVAILABLE'));
    } finally {
      if (!finished) timer = setTimeout(() => { polling = poll(); }, intervalMs);
    }
  }
  try {
    if (signal.aborted) abort();
    if (!finished) {
      const addresses = await runtime.start();
      if (!finished) {
        report({ started: true, environment: 'staging', productionReady: false, ...addresses });
        polling = poll();
      }
    }
    await stopped;
    if (failure) throw failure;
  } finally {
    finished = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
    // Drain a pending status read before closing its database/listeners. Also stop a
    // partially started runtime when a signal arrived while start() was pending.
    await polling;
    await runtime.stop();
  }
}
