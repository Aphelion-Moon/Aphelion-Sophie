import { createServer } from 'node:http';
import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';
import { validateActivityConfiguration } from '../../../modules/onboarding/activity.js';
import { DiscordError } from '../discord/transport.js';

// Scripts, styles, fonts, sounds and API calls come from this origin only; no inline code, frames or third parties.
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const COMMON = Object.freeze({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' });
const BODY_LIMIT = 4_096, MAX_ACTIVE = 16, SIGN_INS_PER_MINUTE = 60;
const TRANSIENT = new Set(['OBSERVATION_INVALIDATED', 'OBSERVATION_UNAVAILABLE', 'OBSERVATION_OUT_OF_ORDER', 'MEMBERSHIP_STALE', 'DISCORD_BUSY',
  'RATE_LIMITED', 'DISCORD_UNAVAILABLE', 'AUTHORITY_UNCERTAIN', 'OAUTH_PROVIDER_UNAVAILABLE']);
// PostgreSQL lock timeout, serialization failure and deadlock: raised before COMMIT, so the transaction rolled back and the
// request (keyed, or read-only) is safe to try again (owner report, 24 October 2026: ACTIVITY_REQUEST_UNAVAILABLE_PG_55P03).
const RETRYABLE_SQLSTATES = new Set(['55P03', '40001', '40P01']);
const RETRY_DELAYS_MS = Object.freeze([150, 400, 1_000]);
const ACTIONS = new Set(['advance', 'back', 'retry']);
// Each member's own budget (owner report, 24 October 2026: one member mashing the main menu made Discord busy for
// everyone, since every request reads Discord afresh). A member gets a burst of requests that refills one a second, and at
// most two at a time; past that they are asked to slow down before anything reaches Discord. Members idle for a while are
// forgotten.
const MEMBER_BURST = 8, MEMBER_REFILL_PER_SECOND = 1, MEMBER_IN_FLIGHT = 2, MEMBER_IDLE_MS = 120_000;
// Discord's own "not now" (a full read queue, a rate limit, an outage) is transient: the Activity tries again later. It is
// not a fault to alert on.
const DISCORD_TRANSIENT = new Set(['DISCORD_BUSY', 'RATE_LIMITED', 'DISCORD_UNAVAILABLE']);
const discordTransient = error => error instanceof DiscordError && DISCORD_TRANSIENT.has(error.code);
// The game servers' info channels, offered with their quick-connect buttons once the member has Whitelist (owner, 24 October
// 2026): before that they cannot see them.
const GAME_INFO_CHANNELS = Object.freeze(['ss13-info', 'ss14-info']);
// What the Activity is told about a refusal: a fixed word per outcome, never an internal code, ID or message.
const OUTCOMES = [
  [401, 'signin', ['ACTIVITY_SESSION_INVALID', 'UNTRUSTED_PRINCIPAL']],
  [403, 'closed', ['ACTIVITY_CLOSED']],
  // Discord may not list the member in the instance yet (the frame was just reopened); the Activity tries again.
  [403, 'instance', ['ACTIVITY_INSTANCE_INVALID']],
  [403, 'denied', ['OPERATION_DENIED', 'FOREIGN_GUILD', 'OAUTH_IDENTITY_INVALID', 'OAUTH_CODE_INVALID',
    'OAUTH_RESPONSE_INVALID', 'NOT_IN_GUILD', 'MEMBER_MUZZLED', 'CAPABILITY_REVOKED']],
  [429, 'slow', ['ACTIVITY_RATE_LIMITED']],
  [409, 'elsewhere', ['SHUTTLE_ELSEWHERE']],
  [409, 'paused', ['SHUTTLE_PAUSED']],
  [409, 'unpublished', ['DEFINITION_NOT_FOUND', 'SHUTTLE_CONTENT_REQUIRED']],
  [409, 'stale', ['STALE_SHUTTLE_CONTROL', 'SHUTTLE_NOT_ACTIVE', 'BACK_UNAVAILABLE', 'NO_PENDING_GRANT', 'SHUTTLE_RESTART_REQUIRED', 'SHUTTLE_RESET_PENDING',
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
export function createActivityHttpServer({ configuration, applicationId, guildId, port, assets, auth, authorization, discord, store, channels = null, station = null, enabled, onFault, wake = () => {}, clock = Date.now,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  validateActivityConfiguration(configuration); requireId(applicationId); requireId(guildId);
  requireCondition(assets instanceof Map && assets.has('/') && typeof auth?.signIn === 'function' && typeof authorization?.resolveActor === 'function' &&
    typeof discord?.observe === 'function' && typeof store?.describe === 'function' && typeof enabled === 'function' && typeof onFault === 'function' &&
    typeof wake === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const hosts = new Set([new URL(configuration.origin).host, `127.0.0.1:${port}`]);
  // The log takes the code only; the error alerts also get who was affected and the request (never its content).
  const fault = (code, context) => { try { onFault(code, context); } catch { /* Never log request content. */ } };
  let active = 0, stopping = false, window = { startedAt: -Infinity, count: 0 };
  /**
   * What an unexpected failure was, in fixed vocabulary only (owner request, 24 October 2026): a contract or library code,
   * a PostgreSQL SQLSTATE or a JavaScript error class. Never a message, ID or payload.
   */
  function causeOf(error) {
    const code = typeof error?.code === 'string' ? error.code : null;
    if (code !== null && /^[A-Z][A-Z0-9_]{1,62}$/u.test(code) && !/^[0-9A-Z]{5}$/u.test(code)) return code;
    if (code !== null && /^[0-9A-Z]{5}$/u.test(code)) return `PG_${code}`;
    return typeof error?.name === 'string' && /^[A-Za-z]{1,30}$/u.test(error.name) ? error.name.toUpperCase() : null;
  }
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
  const budgets = new Map();
  /**
   * Spends one of the member's requests, or refuses (ACTIVITY_RATE_LIMITED) when their burst is used up or two of theirs
   * are already running. Once per request: a retried attempt does not spend again. `seen.release` ends it.
   */
  function spend(userId, seen) {
    if (seen.release) return;
    const now = clock();
    if (budgets.size >= 1_024) for (const [id, b] of budgets) if (b.inFlight === 0 && now - b.at > MEMBER_IDLE_MS) budgets.delete(id);
    const budget = budgets.get(userId) ?? { tokens: MEMBER_BURST, at: now, inFlight: 0 };
    budget.tokens = Math.min(MEMBER_BURST, budget.tokens + (Math.max(0, now - budget.at) / 1_000) * MEMBER_REFILL_PER_SECOND); budget.at = now;
    budgets.set(userId, budget);
    if (budget.tokens < 1 || budget.inFlight >= MEMBER_IN_FLIGHT) throw new ContractError('ACTIVITY_RATE_LIMITED');
    budget.tokens -= 1; budget.inFlight++;
    let released = false;
    seen.release = () => { if (!released) { released = true; budget.inFlight--; } };
  }
  /**
   * The signed-in member's fresh context; `seen.userId` records who it is for the channel links. The session check is in
   * memory; the member's budget is spent before anything reads Discord.
   */
  async function member(request, seen = {}) {
    const proof = await auth.authenticate(bearer(request));
    seen.userId = proof.userId;
    spend(proof.userId, seen);
    const context = { actor: await authorization.resolveActor(proof), observation: await discord.observe(proof.userId) };
    // Whitelist as Discord shows it in this very request (never a stored snapshot), for the game buttons.
    seen.whitelisted = context.observation?.whitelist === true;
    return context;
  }
  /**
   * Channel links for a run: the channels its copy names, and after confirmation the arrival list (curated, or else the
   * channels the final stop names), each only if the member can see it now. Never blocks the Shuttle.
   */
  async function withChannels(result, seen) {
    const run = result?.run, userId = seen.userId;
    await withGames(result, seen);
    if (!run || channels === null) return withStation(result, userId);
    const confirmed = run.whitelist === 'confirmed';
    try {
      const found = await channels.resolve({ userId, pages: run.pages, arrival: confirmed ? run.arrivalChannels ?? [] : null });
      run.channels = found.mentions;
      if (confirmed) {
        const named = [...new Map(Object.values(found.mentions).map(channel => [channel.id, { id: channel.id, name: channel.name }])).values()];
        run.arrival = found.arrival.length ? found.arrival : named;
      }
    } catch (error) { if (!discordTransient(error)) fault('ACTIVITY_CHANNELS_UNAVAILABLE', { userId }); run.channels = {}; if (confirmed) run.arrival = []; }
    return withStation(result, userId);
  }
  /**
   * The game servers once the member has Whitelist now: their info channels the member can see, by name. The quick-connect
   * links are the client's own; this only says whether to offer them. Never blocks the Shuttle.
   */
  async function withGames(result, seen) {
    if (!result || typeof result !== 'object' || !seen.whitelisted) return;
    let found = {};
    if (channels !== null) {
      try { found = await channels.named({ userId: seen.userId, names: GAME_INFO_CHANNELS }); }
      catch (error) { if (!discordTransient(error)) fault('ACTIVITY_CHANNELS_UNAVAILABLE', { userId: seen.userId }); }
    }
    (result.run ?? result).games = { channels: found };
  }
  /**
   * At the last stop and after it: the station board's counts, and the member's own boarding pass (their name and the
   * date they joined), for that member only. Never blocks the Shuttle; on failure the fields are left out.
   */
  async function withStation(result, userId) {
    const run = result?.run;
    if (!run || station === null || (run.status === 'reading' && run.stop < run.stops.length - 1)) return result;
    try { run.station = await station.station(); } catch (error) { if (!discordTransient(error)) fault('ACTIVITY_STATION_UNAVAILABLE', { userId }); }
    try { const pass = await station.pass(userId); if (pass) run.pass = pass; } catch (error) { if (!discordTransient(error)) fault('ACTIVITY_PASS_UNAVAILABLE', { userId }); }
    return result;
  }
  async function attempt(work) {
    for (let tries = 0; ; tries++) {
      try { return await work(); } catch (error) {
        const retryable = error instanceof ContractError ? TRANSIENT.has(error.code) : RETRYABLE_SQLSTATES.has(error?.code);
        if (!retryable || tries >= RETRY_DELAYS_MS.length) throw error;
        await pause(RETRY_DELAYS_MS[tries]);
      }
    }
  }
  async function api(request, response, path, seen) {
    if (path === '/api/session' && request.method === 'POST') {
      const now = clock();
      if (now - window.startedAt >= 60_000) window = { startedAt: now, count: 0 };
      if (++window.count > SIGN_INS_PER_MINUTE) { send(response, 503, { error: 'retry' }, { 'Retry-After': '10' }); return; }
      const body = await readJson(request); only(body, ['code', 'instanceId']);
      send(response, 200, await auth.signIn({ code: body.code, instanceId: body.instanceId })); return;
    }
    if (path === '/api/session/end' && request.method === 'POST') { auth.signOut(bearer(request)); send(response, 204, null); return; }
    if (path === '/api/shuttle' && request.method === 'GET') {
      const result = await attempt(async () => store.describe(await member(request, seen)));
      send(response, 200, await withChannels(result, seen)); return;
    }
    if (path === '/api/shuttle/board' && request.method === 'POST') {
      const body = await readJson(request); only(body, ['requestId']);
      const result = await attempt(async () => store.board({ ...await member(request, seen), requestId: body.requestId }));
      send(response, 200, { run: (await withChannels(result, seen)).run }); return;
    }
    if (path === '/api/shuttle/act' && request.method === 'POST') {
      const body = await readJson(request); only(body, ['requestId', 'action', 'expectedVersion']);
      if (ACTIONS.has(body.action)) seen.action = body.action;
      const result = await attempt(async () => store.act({ ...await member(request, seen), requestId: body.requestId, action: body.action,
        expectedVersion: body.expectedVersion }));
      await withChannels(result, seen);
      // A recorded grant intent is delivered now rather than at the next interval.
      if (result.queued) wake();
      send(response, 200, { run: result.run }); return;
    }
    // Reset journey (Settings): the member's run still being read stops being current; boarding starts over.
    if (path === '/api/shuttle/reset' && request.method === 'POST') {
      const body = await readJson(request); only(body, ['requestId']);
      const result = await attempt(async () => store.reset({ ...await member(request, seen), requestId: body.requestId }));
      send(response, 200, { reset: result.reset === true }); return;
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
    if (path === '/api/config' && request.method === 'GET') { send(response, 200, { applicationId, guildId }); return; }
    if (stopping || await enabled() !== true) { send(response, 503, { error: 'unavailable' }, { 'Retry-After': '30' }); return; }
    if (active >= MAX_ACTIVE) { send(response, 503, { error: 'retry' }, { 'Retry-After': '2' }); return; }
    active++;
    const seen = {};
    try { await api(request, response, path, seen); }
    catch (error) {
      const code = error instanceof ContractError || discordTransient(error) ? error.code : null;
      const outcome = OUTCOMES.find(([, , codes]) => codes.includes(code));
      if (outcome) send(response, outcome[0], { error: outcome[1] }, outcome[1] === 'slow' ? { 'Retry-After': '2' } : {});
      else if (TRANSIENT.has(code) || code === 'OAUTH_DISABLED') send(response, 503, { error: 'retry' }, { 'Retry-After': '3' });
      else {
        const cause = causeOf(error);
        fault(`ACTIVITY_REQUEST_UNAVAILABLE${cause ? `_${cause}` : ''}`.slice(0, 64).replace(/_+$/u, ''),
          { userId: seen.userId ?? null, request: `${request.method} ${path}${seen.action ? ` (${seen.action})` : ''}` });
        send(response, 503, { error: 'unavailable' }, { 'Retry-After': '10' });
      }
    } finally { active--; seen.release?.(); }
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
