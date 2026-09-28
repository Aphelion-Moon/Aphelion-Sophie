import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { requireCondition, requireInteger } from '../../contracts/validation.js';

/** One bounded disposable parser worker. No DB, network adapter, credentials, HTML renderer or publication path. */
export function createWikiExtractor() {
  let active = false;
  return Object.freeze({ async extract({ html, htmlHash, signal = new AbortController().signal, timeoutMs = 3000 }) {
    requireCondition(!active, 'WIKI_EXTRACTION_BUSY');
    requireCondition(typeof html === 'string' && html.isWellFormed() && Buffer.byteLength(html) <= 786432 &&
      typeof htmlHash === 'string' && createHash('sha256').update(html).digest('hex') === htmlHash, 'WIKI_SNAPSHOT_INVALID');
    requireInteger(timeoutMs, 1, 5000); requireCondition(!signal.aborted, 'WIKI_EXTRACTION_CANCELLED');
    active = true; let worker, timer, onAbort;
    try {
      worker = new Worker(new URL('./extraction-worker.js', import.meta.url), { workerData: { html }, env: {}, execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 48, maxYoungGenerationSizeMb: 8, stackSizeMb: 2 } });
      return await new Promise((resolve, reject) => {
        const fail = code => reject(new Error(code));
        timer = setTimeout(() => fail('WIKI_EXTRACTION_TIMEOUT'), timeoutMs);
        onAbort = () => fail('WIKI_EXTRACTION_CANCELLED'); signal.addEventListener('abort', onAbort, { once: true });
        worker.once('error', () => fail('WIKI_EXTRACTION_FAILED'));
        worker.once('exit', () => fail('WIKI_EXTRACTION_FAILED'));
        worker.once('message', message => {
          if (signal.aborted) { onAbort(); return; }
          if (message?.ok !== true) { fail(/^WIKI_[A-Z_]+$/u.test(message?.error) ? message.error : 'WIKI_EXTRACTION_FAILED'); return; }
          const value = message.value;
          resolve({ ...value, htmlHash, extractHash: createHash('sha256').update(JSON.stringify(value)).digest('hex') });
        });
        if (signal.aborted) onAbort();
      });
    } finally {
      clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort);
      if (worker) await worker.terminate(); active = false;
    }
  } });
}
