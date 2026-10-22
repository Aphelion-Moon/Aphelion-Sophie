import { createServer } from 'node:http';
import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';
import { validateActivityConfiguration } from '../../../modules/onboarding/activity.js';

// Scripts, styles, fonts, sounds and API calls come from this origin only; no inline code, frames or third parties.
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const COMMON = Object.freeze({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
const BODY_LIMIT = 4_096, MAX_ACTIVE = 16, SIGN_INS_PER_MINUTE = 60;
const TRANSIENT = new Set(['OBSERVATION_INVALIDATED', 'OBSERVATION_UNAVAILABLE', 'OBSERVATION_OUT_OF_ORDER', 'MEMBERSHIP_STALE', 'DISCORD_BUSY',
  'RATE_LIMITED', 'DISCORD_UNAVAILABLE', 'AUTHORITY_UNCERTAIN', 'OAUTH_PROVIDER_UNAVAILABLE']);
const RETRY_DELAYS_MS = Object.freeze([150, 400]);
// What the Activity is told about a refusal: a fixed word per outcome, never an internal code, ID or message.
const OUTCOMES = [
  [401, 'signin', ['ACTIVITY_SESSION_INVALID', 'UNTRUSTED_PRINCIPAL']],
  [403, 'closed', ['ACTIVITY_CLOSED']],
  [403, 'denied', ['OPERATION_DENIED', 'FOREIGN_GUILD', 'ACTIVITY_INSTANCE_INVALID', 'OAUTH_IDENTITY_INVALID', 'OAUTH_CODE_INVALID',
    'OAUTH_RESPONSE_INVALID', 'NOT_IN_GUILD', 'MEMBER_MUZZLED', 'CAPABILITY_REVOKED']],
  [409, 'elsewhere', ['SHUTTLE_ELSEWHERE']],
  [409, 'paused', ['SHUTTLE_PAUSED']],
  [409, 'unpublished', ['DEFINITION_NOT_FOUND', 'SHUTTLE_CONTENT_REQUIRED']],
  [409, 'stale', ['STALE_SHUTTLE_CONTROL', 'SHUTTLE_NOT_ACTIVE', 'BACK_UNAVAILABLE', 'NO_PENDING_GRANT', 'SHUTTLE_RESTART_REQUIRED',
    'DEFINITION_WITHDRAWN', 'DEFINITION_MISMATCH', 'INTERACTION_ID_COLLISION']],
  [400, 'invalid', ['ACTIVITY_REQUEST_INVALID', 'INVALID_SHUTTLE_ACTION', 'INVALID_INTEGER', 'ACTIVITY_BODY_INVALID']],
];

/**
 * The Shuttle Activity's listener in core (P40/P41), the only process holding the Discord token. It serves the client
 * files given to it and JSON routes to read its public application ID, sign in, read the Shuttle, board, and
 * Continue/Back/Check. Requests carry an
 * in-memory bearer token, not cookies; each Shuttle request resolves the member through core principals, reads Discord
 * afresh and authorizes again in the store. Logs are fixed codes only. No AI, no ticket data, no case routes.
 */
export function createActivityHttpServer({ configuration, applicationId, port, assets, auth, authorization, discord, store, enabled, onFault, wake = () => {}, clock = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  validateActivityConfiguration(configuration); requireId(applicationId);
  requireCondition(assets instanceof Map && assets.has('/') && typeof auth?.signIn === 'function' && typeof authorization?.resolveActor === 'function' &&
    typeof discord?.observe === 'function' && typeof store?.describe === 'function' && typeof enabled === 'function' && typeof onFault === 'function' &&
    typeof wake === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const hosts = new Set([new URL(configuration.origin).host, `127.0.0.1:${port}`]);
  const fault = code => { try { onFault(code); } catch { /* Never log request content. */ } };
  let active = 0, stopping = false, window = { startedAt: -Infinity, count: 0 };
  const running = new Set();

  function send(response, status, body, headers = {}) {
    if (response.headersSent || response.destroyed) return;
    response.writeHead(status, { ...COMMON, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    response.end(body === null ? undefined : JSON.stringify(body));
  }
  function serveFile(request, response, path) {
    const file = assets.get(path);
    if (!file) { response.writeHead(404, { ...COMMON, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); response.end('Not found\n'); return; }
    const headers = { ...COMMON, 'Content-Type': file.type, 'Cache-Control': 'no-cache', ETag: file.etag,
      ...(file.type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP } : {}) };
    if (request.headers['if-none-match'] === file.etag) { response.writeHead(304, headers); response.end(); return; }
    response.writeHead(200, { ...headers, 'Content-Length': file.body.length });
    response.end(request.method === 'HEAD' ? undefined : file.body);
  }
  async function readJson(request) {
    requireCondition(['application/json', 'application/json; charset=utf-8'].includes(request.headers['content-type']) &&
      request.headers['transfer-encoding'] === undefined && Number(request.headers['content-length'] ?? -1) >= 0 &&
      Number(request.headers['content-length']) <= BODY_LIMIT, 'ACTIVITY_BODY_INVALID');
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; requireCondition(size <= BODY_LIMIT, 'ACTIVITY_BODY_INVALID'); chunks.push(chunk); }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { requireCondition(false, 'ACTIVITY_BODY_INVALID'); }
    requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'ACTIVITY_BODY_INVALID');
    return value;
  }
  function bearer(request) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(String(request.headers.authorization ?? ''));
    requireCondition(match !== null, 'ACTIVITY_SESSION_INVALID'); return match[1];
  }
  const only = (value, keys) => requireCondition(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'ACTIVITY_BODY_INVALID');
  /** The member behind a request, resolved and observed afresh. */
  async function member(request) {
    const proof = await auth.authenticate(bearer(request));
    return { actor: await authorization.resolveActor(proof), observation: await discord.observe(proof.userId) };
  }
  async function attempt(work) {
    for (let tries = 0; ; tries++) {
      try { return await work(); } catch (error) {
        if (!(error instanceof ContractError) || !TRANSIENT.has(error.code) || tries >= RETRY_DELAYS_MS.length) throw error;
        await pause(RETRY_DELAYS_MS[tries]);
      }
    }
  }
  async function api(request, response, path) {
    if (path === '/api/session' && request.method === 'POST') {
      const now = clock();
      if (now - window.startedAt >= 60_000) window = { startedAt: now, count: 0 };
      if (++window.count > SIGN_INS_PER_MINUTE) { send(response, 503, { error: 'retry' }, { 'Retry-After': '10' }); return; }
      const body = await readJson(request); only(body, ['code', 'instanceId']);
      send(response, 200, await auth.signIn({ code: body.code, instanceId: body.instanceId })); return;
    }
    if (path === '/api/session/end' && request.method === 'POST') { auth.signOut(bearer(request)); send(response, 204, null); return; }
    if (path === '/api/shuttle' && request.method === 'GET') {
      send(response, 200, await attempt(async () => store.describe(await member(request)))); return;
    }
    if (path === '/api/shuttle/board' && request.method === 'POST') {
      const body = await readJson(request); only(body, ['requestId']);
      const result = await attempt(async () => store.board({ ...await member(request), requestId: body.requestId }));
      send(response, 200, { run: result.run }); return;
    }
    if (path === '/api/shuttle/act' && request.method === 'POST') {
      const body = await readJson(request); only(body, ['requestId', 'action', 'expectedVersion']);
      const result = await attempt(async () => store.act({ ...await member(request), requestId: body.requestId, action: body.action, expectedVersion: body.expectedVersion }));
      // A recorded grant intent is delivered now rather than at the next interval.
      if (result.queued) wake();
      send(response, 200, { run: result.run }); return;
    }
    send(response, 404, { error: 'not_found' });
  }
  async function handle(request, response) {
    const host = String(request.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) { send(response, 421, { error: 'misdirected' }); return; }
    let path;
    try { path = new URL(request.url ?? '/', 'http://activity.invalid').pathname; } catch { send(response, 400, { error: 'invalid' }); return; }
    if (!path.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) { send(response, 405, { error: 'method' }, { Allow: 'GET, HEAD' }); return; }
      serveFile(request, response, path); return;
    }
    // The public application ID the SDK needs; no member, token or Discord read involved.
    if (path === '/api/config' && request.method === 'GET') { send(response, 200, { applicationId }); return; }
    if (stopping || await enabled() !== true) { send(response, 503, { error: 'unavailable' }, { 'Retry-After': '30' }); return; }
    if (active >= MAX_ACTIVE) { send(response, 503, { error: 'retry' }, { 'Retry-After': '2' }); return; }
    active++;
    try { await api(request, response, path); }
    catch (error) {
      const code = error instanceof ContractError ? error.code : null;
      const outcome = OUTCOMES.find(([, , codes]) => codes.includes(code));
      if (outcome) send(response, outcome[0], { error: outcome[1] });
      else if (TRANSIENT.has(code) || code === 'OAUTH_DISABLED') send(response, 503, { error: 'retry' }, { 'Retry-After': '3' });
      else { fault('ACTIVITY_REQUEST_UNAVAILABLE'); send(response, 503, { error: 'unavailable' }, { 'Retry-After': '10' }); }
    } finally { active--; }
  }
  const server = createServer({ maxHeaderSize: 16_384 }, (request, response) => {
    const task = handle(request, response).catch(() => {
      fault('ACTIVITY_TRANSPORT_INVALID');
      if (!response.headersSent && !response.destroyed) send(response, 503, { error: 'unavailable' }); else response.destroy();
    }).finally(() => running.delete(task));
    running.add(task);
  });
  server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  return Object.freeze({
    listen(listenPort = port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, '127.0.0.1', () => { server.off('error', reject); resolve(server.address()); });
      });
    },
    async close() {
      stopping = true;
      await new Promise(resolve => server.close(() => resolve()));
      await Promise.allSettled([...running]);
    },
  });
}
