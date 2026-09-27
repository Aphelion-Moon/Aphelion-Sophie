import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const CASE_EXPORT_ROUTES = Object.freeze({ '/api/cases/export/review': 'POST', '/api/cases/export/download': 'POST' });

export function createCaseExportsHttp({ auth, authorization, exports }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_EXPORT_ROUTES, path) && method === 'POST' && [...query].length === 0, 'CASE_EXPORT_INPUT_INVALID');
    const confirming = path.endsWith('/download');
    requireKeys(body, ['caseToken', 'channelId', ...(confirming ? ['requestId', 'reviewHash', 'confirmed'] : [])], 'CASE_EXPORT_INPUT_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    const result = await exports[confirming ? 'confirm' : 'review']({ ...body, actor });
    await auth.resolvePrincipal(proof);
    return result;
  } });
}

/** Only a successful confirmed export reaches this sender; filename and headers contain no retained text. */
export function sendCaseExport(response, result) {
  requireCondition(/^sophie-transcript-[a-f0-9]{48}-[1-9][0-9]{0,19}\.html$/.test(result.filename) &&
    typeof result.body === 'string' && Buffer.byteLength(result.body) === result.bytes && result.bytes <= 2_097_152, 'CASE_EXPORT_INPUT_INVALID');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${result.filename}"`,
    'Content-Length': String(result.bytes), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
  response.end(result.body);
}
