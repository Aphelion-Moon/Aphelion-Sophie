import { requireCondition } from '../../contracts/validation.js';

export const TRANSCRIPT_PAGE_SIZE = 5;
export const TRANSCRIPT_GAP_PAGE_SIZE = 25;
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n;

/** Cursors select positions only; they never carry authority. Bind them to the exact ledger. */
export function transcriptCursor(caseToken, channelId, position) {
  return Buffer.from(JSON.stringify([caseToken, channelId, ...position])).toString('base64url');
}
export function readTranscriptCursor(value, caseToken, channelId, gaps = false) {
  if (value === null) return null;
  requireCondition(typeof value === 'string' && /^[A-Za-z0-9_-]{1,320}$/.test(value), 'TRANSCRIPT_INPUT_INVALID');
  let parts;
  try { parts = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { /* Rejected below. */ }
  requireCondition(Array.isArray(parts) && parts.length === (gaps ? 3 : 5) && parts[0] === caseToken && parts[1] === channelId &&
    (gaps ? typeof parts[2] === 'string' && /^[a-f0-9]{48}$/.test(parts[2]) :
      decimal(parts[2]) && decimal(parts[3]) && typeof parts[4] === 'string' && /^[1-9][0-9]{0,19}$/.test(parts[4])), 'TRANSCRIPT_INPUT_INVALID');
  return parts.slice(2);
}

export const escapeTranscriptText = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// Retained embeds/components are inert text, with remote media/link fields omitted.
function inert(value) {
  if (Array.isArray(value)) return value.map(inert);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:url|proxy|href|src|path|token)/i.test(key)).map(([key, item]) => [key, inert(item)]));
}
export function transcriptObservation(row) {
  const { attachments, ...fields } = row.patch;
  const patch = inert(fields);
  if (attachments !== undefined) patch.attachments = attachments.map((item, ordinal) => {
    const job = row.attachments.find(candidate => candidate.ordinal === ordinal);
    const result = { ordinal, status: job?.status ?? 'unavailable', scanStatus: 'unscanned', downloadable: false };
    for (const key of ['id', 'filename', 'title', 'description', 'content_type', 'size'])
      if (typeof item[key] === 'string' || typeof item[key] === 'number') result[key] = item[key];
    if (job?.bytes !== null && job?.bytes !== undefined) result.retainedBytes = job.bytes;
    return result;
  });
  return { messageId: row.message_id, epoch: row.continuity_epoch, sequence: row.sequence, kind: row.kind,
    observedAt: row.observed_at_ms, patch, issues: row.issues };
}

/** The only content surface is escaped HTML; no retained value enters an attribute or executable element. */
export function renderTranscript({ observations, gaps, captureAvailable }) {
  const text = value => escapeTranscriptText(JSON.stringify(value, null, 2));
  return '<section><h1>Retained conversation observations</h1>' +
    '<p>Partial record only. History before capture is unavailable. Edits contain only observed fields; deletions do not erase earlier observations.</p>' +
    `<p>Current capture: ${captureAvailable ? 'available' : 'unavailable or unverified'}. Reconnection and received messages do not establish complete history.</p>` +
    '<p>Attachments are status metadata only. Retained files are quarantined and unscanned; downloads are unavailable.</p>' +
    '<h2>Observations</h2>' + observations.map(row => `<article><pre>${text(transcriptObservation(row))}</pre></article>`).join('') +
    '<h2>Capture gaps (this page)</h2><pre>' + text(gaps) + '</pre></section>';
}
