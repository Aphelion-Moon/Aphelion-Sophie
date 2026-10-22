import { requireCondition, requireInteger } from '../../contracts/validation.js';
import { sourceErrorCode } from './sources/http.js';

const MINUTE = 60000;
/** Wiki revision checks are cheap (two API calls); the site is small; GitHub is rate-limited; the Guidebook is one index file. */
export const SOURCE_INTERVALS = Object.freeze({ wiki: 30 * MINUTE, site: 180 * MINUTE, gh: 180 * MINUTE, guide: 180 * MINUTE });
const RETRY_MS = 15 * MINUTE, RATE_LIMIT_RETRY_MS = 60 * MINUTE;

/**
 * Runs each due source collection in turn and hands the result to the mirror. One failing source never blocks another;
 * its published documents stay until they expire (seven days), so a short outage costs nothing and a long one fails closed.
 */
export function createSourceSync({ mirror, collectors, clock = Date.now, onFault = () => {}, intervals = SOURCE_INTERVALS }) {
  requireCondition(mirror && ['knownRevisions', 'apply'].every(key => typeof mirror[key] === 'function') && Array.isArray(collectors), 'TRUSTED_ADAPTERS_REQUIRED');
  const state = new Map(collectors.map(collector => {
    requireCondition(typeof collector.collect === 'function' && typeof collector.prefix === 'string', 'TRUSTED_ADAPTERS_REQUIRED');
    requireInteger(intervals[collector.prefix], MINUTE);
    return [collector.prefix, { collector, nextAt: 0, running: false, last: null }];
  }));
  const label = prefix => prefix === 'gh' ? 'GITHUB' : prefix.toUpperCase();
  return Object.freeze({
    async runDue({ signal }) {
      for (const [prefix, entry] of state) {
        if (signal.aborted) return;
        if (clock() < entry.nextAt) continue;
        entry.running = true; const startedAt = clock();
        try {
          const known = await mirror.knownRevisions(prefix);
          const result = await entry.collector.collect({ signal, known });
          requireCondition(!signal.aborted, `${label(prefix)}_SYNC_CANCELLED`);
          const counts = await mirror.apply(prefix, result);
          entry.last = { ok: true, startedAt, finishedAt: clock(), listed: result.listed ?? null, skipped: result.skipped ?? 0, truncated: result.truncated ?? 0, ...counts };
          entry.nextAt = clock() + intervals[prefix];
        } catch (error) {
          if (signal.aborted) return;
          const code = /^KNOWLEDGE_[A-Z_]+$/u.test(error?.message) ? error.message : sourceErrorCode(error, label(prefix), signal);
          entry.last = { ok: false, startedAt, finishedAt: clock(), code };
          entry.nextAt = clock() + (code.endsWith('_RATE_LIMITED') ? RATE_LIMIT_RETRY_MS : RETRY_MS);
          try { onFault(`KNOWLEDGE_SOURCE_${code}`); } catch { /* Reporting never affects sync. */ }
        } finally { entry.running = false; }
      }
    },
    /** Marks every source due; the synchronizer picks them up on its next tick (at most a few minutes later). */
    requestAll() { for (const entry of state.values()) entry.nextAt = 0; },
    status() {
      return Object.fromEntries([...state].map(([prefix, entry]) => [prefix, { running: entry.running, nextAt: entry.nextAt, last: entry.last && { ...entry.last } }]));
    },
  });
}
