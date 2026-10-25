import { requireCondition } from '../../contracts/validation.js';

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const pad = value => String(value).padStart(2, '0');

/** A duration for Staff to read: `42s`, `14m 05s`, `2h 03m`, `3d 04h`. */
export function formatDuration(ms) {
  requireCondition(Number.isSafeInteger(ms) && ms >= 0, 'INVALID_DURATION');
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds}s`;
  if (ms < HOUR) return `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
  const minutes = Math.floor(ms / MINUTE);
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
  return `${Math.floor(minutes / 1_440)}d ${pad(Math.floor(minutes / 60) % 24)}h`;
}

/** A run's timing as the notice and the progress check carry it: focused time, pages, time since boarding, first stop timed. */
export function requireRunTiming(timing) {
  requireCondition(timing !== null && typeof timing === 'object' && Object.keys(timing).length === 4 &&
    [timing.focusedMs, timing.pages, timing.wallMs, timing.fromStop].every(value => Number.isSafeInteger(value) && value >= 0) &&
    timing.pages <= 64 * 64, 'INVALID_RUN_TIMING');
  return timing;
}

/**
 * Focused time, time since boarding, pages and the average time a page (owner request, 25 October 2026: numbers only, no
 * flag). `label` begins the line. A run timed only from a later stop says so, since its earlier stops are not counted.
 */
export function timingLine(label, timing) {
  requireRunTiming(timing);
  const pages = timing.pages === 0 ? 'no pages reported'
    : `${timing.pages} ${timing.pages === 1 ? 'page' : 'pages'}, average ${formatDuration(Math.round(timing.focusedMs / timing.pages))} a page`;
  return `${label}: ${formatDuration(timing.focusedMs)} focused (${formatDuration(timing.wallMs)} from boarding) · ${pages}` +
    `${timing.fromStop > 0 ? ` · timed from stop ${timing.fromStop + 1}` : ''}`;
}

/** The notice's and progress check's timing from a stored run's timing, at `atMs` (its completion, or now). */
export function runTimingSummary(run, atMs) {
  if (!run?.timed) return null;
  return { focusedMs: run.focusedMs, pages: run.pages, wallMs: Math.max(0, (run.completedAtMs ?? atMs) - run.startedAtMs), fromStop: run.fromStop };
}
