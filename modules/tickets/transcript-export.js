import { requireCondition, requireInteger, requireKeys } from '../../contracts/validation.js';

/** Explicit trusted policy; these are hard implementation ceilings, not approved production defaults. */
export function validateTranscriptExportPolicy(value) {
  requireKeys(value, ['version', 'enabled', 'audience', 'maxObservations', 'maxGaps', 'maxBytes']);
  requireInteger(value.version, 1, 2147483647);
  requireCondition(typeof value.enabled === 'boolean' && ['responders', 'current-readers'].includes(value.audience), 'CASE_EXPORT_POLICY_INVALID');
  requireInteger(value.maxObservations, 1, 100); requireInteger(value.maxGaps, 1, 200); requireInteger(value.maxBytes, 1024, 2_097_152);
}

export function requireExportHash(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'CASE_EXPORT_INPUT_INVALID');
}

/** No external styles, scripts, links, media or active retained markup. */
export function transcriptExportDocument(fragment) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">' +
    '<meta name="referrer" content="no-referrer"><title>Sophie retained observations</title></head><body>' +
    '<p>Confirmed export of one selected channel ledger. Other channels, Staff notes, form answers and file bytes are not included.</p>' +
    fragment + '</body></html>';
}
