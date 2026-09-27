import { requireCondition, requireInteger, requireName } from '../../../contracts/validation.js';
import { gatewayClosePolicy, gatewayDiscovery, gatewayWireUrl, parseGatewayFrame } from './gateway-protocol.js';

/** Core-only, single guild/application. Explicit connector; construction never opens a socket.
 * start() lives until stop or failure. Callers own that promise and must await shutdown.
 * enabled is a synchronous operator/recovery gate, independent of Gateway health.
 */
export function createGatewaySupervisor({ observer, transport, connect, token, clock, random, enabled,
  timers = { setTimeout, clearTimeout } }) {
  requireCondition(typeof token === 'string' && token.length >= 20 && token.length <= 2_000 && !/\s/.test(token), 'DISCORD_TOKEN_REQUIRED');
  const intents = observer.intents ?? 3;
  requireCondition([3, 33283].includes(intents), 'GATEWAY_INTENTS_INVALID');
  for (const fn of [connect, clock, random, enabled, timers.setTimeout, timers.clearTimeout]) {
    requireCondition(typeof fn === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  }
  let started = false, running = false, task = null, active = null, handle = null;
  let phase = 'idle', code = null, failures = 0, resumable = false;
  let wake = null, renewalTimer = null, renewalWork = Promise.resolve();
  const permitted = () => running && enabled() === true;
  function jitter() { const value = random(); requireCondition(Number.isFinite(value) && value >= 0 && value < 1, 'GATEWAY_RANDOM_INVALID'); return value; }
  function now() { const value = clock(); requireInteger(value); return value; }
  const snapshot = () => ({ phase, code, failures });
  const pauseReason = reason => reason === 'GATEWAY_HEARTBEAT_MISSED' ? 'HEARTBEAT_MISSED' :
    reason === 'GATEWAY_STOPPED' ? 'STOPPED' : ['GATEWAY_PROCESSING_FAILED', 'GATEWAY_PAYLOAD_INVALID',
      'GATEWAY_SUPERVISOR_FAILED', 'GATEWAY_AUTHENTICATION_FAILED'].includes(reason) ? 'PROCESSING_FAILED' : 'DISCONNECTED';
  function halt(reason) {
    code = reason; running = false; active?.finish({ code: reason, fatal: true }); wake?.();
  }
  async function delay(ms) {
    if (!running) return;
    await new Promise(resolve => {
      const timer = timers.setTimeout(done, ms);
      function done() { timers.clearTimeout(timer); wake = null; resolve(); }
      wake = done;
    });
  }
  function renewLater() {
    if (!running) return;
    renewalTimer = timers.setTimeout(() => {
      renewalWork = (async () => {
        if (!permitted()) { halt('GATEWAY_DISABLED'); return; }
        try {
          await observer.renew();
          if (active && now() - active.startedAt >= 60_000 && await observer.isCurrent()) failures = 0;
        } catch { halt('GATEWAY_LEASE_UNAVAILABLE'); }
        if (running) renewLater();
      })().catch(() => { halt('GATEWAY_SUPERVISOR_FAILED'); });
    }, 10_000);
  }

  function session({ connection, resume, url, discoveredAt }) {
    return new Promise(resolve => {
      let socket = null, closed = false, hello = false, authenticating = false, authenticated = false;
      let interval = 0, nextBeatAt = 0, heartbeatTimer = null, deadlineTimer = null, lastSequence = resume?.sequence ?? null;
      let outstanding = [], sent = [];
      let authenticationWork = Promise.resolve();
      const startedAt = now();
      const current = { startedAt, finish };
      active = current;
      function finish(result) {
        if (closed) return;
        closed = true;
        timers.clearTimeout(heartbeatTimer); timers.clearTimeout(deadlineTimer);
        // pause invalidates health synchronously, before closing or awaiting outstanding work.
        const paused = observer.pause(connection, pauseReason(result.code));
        try { socket?.close(3000); } catch { /* Late callbacks are ignored regardless of socket state. */ }
        Promise.all([paused, authenticationWork]).then(([saved]) => {
          if (active === current) active = null;
          resolve({ waitMs: 0, fatal: false, ...result, resume: result.resume !== false && saved.resumable });
        }, () => {
          if (active === current) active = null;
          resolve({ code: 'GATEWAY_STORAGE_UNAVAILABLE', fatal: true, resume: false, waitMs: 0 });
        });
      }
      function send(payload) {
        requireCondition(!closed && permitted() && socket?.readyState === 1, 'GATEWAY_SOCKET_UNAVAILABLE');
        const time = now();
        requireCondition(sent.length === 0 || time >= sent.at(-1), 'GATEWAY_CLOCK_INVALID');
        sent = sent.filter(at => time - at < 60_000);
        requireCondition(sent.length < 110 && socket.bufferedAmount <= 16_384, 'GATEWAY_SEND_LIMIT');
        const wire = JSON.stringify(payload);
        requireCondition(Buffer.byteLength(wire, 'utf8') <= 4_096, 'GATEWAY_SEND_LIMIT');
        sent.push(time); socket.send(wire);
      }
      function beat() {
        outstanding.push(now()); send({ op: 1, d: lastSequence });
      }
      function regularBeat() {
        if (closed) return;
        try {
          if (outstanding.length) { finish({ code: 'GATEWAY_HEARTBEAT_MISSED' }); return; }
          nextBeatAt = now() + interval; beat();
          heartbeatTimer = timers.setTimeout(regularBeat, interval);
        } catch { finish({ code: 'GATEWAY_SEND_FAILED', fatal: true }); }
      }
      async function authenticate() {
        try {
          if (!resume) {
            const before = now();
            requireCondition(before >= discoveredAt && before - discoveredAt <= 60_000, 'GATEWAY_DISCOVERY_STALE');
            const budget = await observer.reserveIdentify();
            if (closed) return;
            requireInteger(budget.waitMs, 0, 86_400_000);
            if (budget.waitMs) { finish({ code: 'GATEWAY_IDENTIFY_LIMIT', resume: false, waitMs: budget.waitMs + 1_000 }); return; }
            // The durable six-second spacing allows at most one second between reserve and send.
            requireCondition(now() >= before && now() - before <= 1_000, 'GATEWAY_IDENTIFY_RESERVATION_STALE');
          } else {
            await observer.renew();
            if (closed) return;
          }
          send(resume ? { op: 6, d: { token, session_id: resume.sessionId, seq: resume.sequence } } :
            { op: 2, d: { token, intents, properties: { os: 'windows', browser: 'Sophie', device: 'Sophie' } } });
          authenticated = true;
        } catch { if (!closed) finish({ code: 'GATEWAY_AUTHENTICATION_FAILED', fatal: true }); }
      }
      function message(event) {
        if (closed) return;
        try {
          const payload = parseGatewayFrame(event.data);
          if (payload.op === 7) { finish({ code: 'GATEWAY_RECONNECT' }); return; }
          if (payload.op === 9) { finish({ code: 'GATEWAY_SESSION_INVALID', resume: payload.d, waitMs: 1_000 + Math.floor(jitter() * 4_000) }); return; }
          if (payload.op === 10) {
            requireCondition(!hello, 'GATEWAY_DUPLICATE_HELLO'); hello = true;
            interval = payload.d.heartbeat_interval;
            timers.clearTimeout(deadlineTimer);
            deadlineTimer = timers.setTimeout(() => finish({ code: 'GATEWAY_HANDSHAKE_TIMEOUT' }), 60_000);
            nextBeatAt = now() + Math.floor(interval * jitter());
            heartbeatTimer = timers.setTimeout(regularBeat, nextBeatAt - now());
            authenticating = true; authenticationWork = authenticate(); return;
          }
          requireCondition(hello, 'GATEWAY_HELLO_REQUIRED');
          if (payload.op === 1) { beat(); return; }
          if (payload.op === 11) {
            requireCondition(outstanding.length > 0, 'GATEWAY_UNEXPECTED_ACK');
            const sentAt = outstanding.shift(), time = now();
            requireCondition(time >= sentAt && time - sentAt < interval, 'GATEWAY_HEARTBEAT_MISSED');
            const validFor = Math.min(120_000, nextBeatAt + interval - time);
            requireCondition(validFor >= 1_000, 'GATEWAY_HEARTBEAT_MISSED');
            observer.heartbeatAcknowledged(connection, validFor); return;
          }
          requireCondition(authenticating && authenticated, 'GATEWAY_AUTHENTICATION_REQUIRED');
          lastSequence = Math.max(lastSequence ?? 0, payload.s);
          const established = payload.t === (resume ? 'RESUMED' : 'READY');
          // Core retains only bounded queued work; case bodies have a separate registered-channel handoff.
          const work = observer.accept(connection, payload);
          work.then(() => {
            if (closed) return;
            if (established) { timers.clearTimeout(deadlineTimer); phase = 'observing'; }
          }, () => finish({ code: 'GATEWAY_PROCESSING_FAILED', fatal: true }));
        } catch { finish({ code: 'GATEWAY_PAYLOAD_INVALID', fatal: true }); }
      }
      try {
        requireCondition(permitted(), 'GATEWAY_DISABLED');
        socket = connect(gatewayWireUrl(url));
        socket.addEventListener('message', message);
        socket.addEventListener('close', event => finish(gatewayClosePolicy(event.code)));
        socket.addEventListener('error', () => finish({ code: 'GATEWAY_DISCONNECTED' }));
        deadlineTimer = timers.setTimeout(() => finish({ code: 'GATEWAY_HELLO_TIMEOUT' }), 15_000);
      } catch { finish({ code: 'GATEWAY_CONNECTION_FAILED' }); }
    });
  }

  async function run(owner) {
    try {
      requireCondition(permitted(), 'GATEWAY_DISABLED');
      phase = 'acquiring'; ({ resumable } = await observer.acquire(owner));
      if (running) renewLater();
      while (running) {
        requireCondition(permitted(), 'GATEWAY_DISABLED');
        phase = 'connecting';
        let discovered = null, discoveredAt = null;
        if (!resumable) {
          try { discovered = gatewayDiscovery(await transport.getGatewayBot()); discoveredAt = now(); }
          catch (error) {
            if (!running) break;
            if (['DISCORD_UNAVAILABLE', 'DISCORD_BUSY', 'RATE_LIMITED'].includes(error.code)) {
              requireCondition(++failures < 10, 'GATEWAY_RETRY_LIMIT');
              code = 'GATEWAY_DISCOVERY_UNAVAILABLE'; phase = 'waiting';
              await delay(Math.max(Math.min(60_000, 1_000 * 2 ** failures), error.retryAfterMs ?? 0)); continue;
            }
            throw error;
          }
          if (!running) break;
          if (discovered.remaining === 0) {
            code = 'GATEWAY_IDENTIFY_LIMIT'; phase = 'waiting'; await delay(Math.max(6_000, discovered.resetAfterMs + 1_000)); continue;
          }
        }
        if (!running) break;
        await observer.renew();
        const next = resumable ? await observer.beginResume() : await observer.beginIdentify();
        handle = next.connection;
        if (!running) break;
        const result = await session({ ...next, url: next.resume?.resumeUrl ?? discovered.url, discoveredAt });
        resumable = result.resume;
        if (running) code = result.code;
        if (result.fatal) { running = false; break; }
        if (!running) break;
        if (result.code !== 'GATEWAY_IDENTIFY_LIMIT') requireCondition(++failures < 10, 'GATEWAY_RETRY_LIMIT');
        phase = 'waiting';
        await delay(Math.max(result.waitMs, Math.min(60_000, 1_000 * 2 ** Math.max(0, failures - 1)) + Math.floor(jitter() * 1_000)));
      }
    } catch (error) {
      if (running) code = ['GATEWAY_DISABLED', 'GATEWAY_RETRY_LIMIT', 'GATEWAY_OWNER_ACTIVE', 'GATEWAY_CONFIGURATION_CHANGED',
        'GATEWAY_SHARDING_UNSUPPORTED', 'DISCORD_AUTHORIZATION_FAILED'].includes(error.code) ? error.code : 'GATEWAY_SUPERVISOR_FAILED';
    } finally {
      running = false; timers.clearTimeout(renewalTimer); wake?.();
      await renewalWork;
      if (handle) { try { await observer.pause(handle, pauseReason(code)); } catch { code = 'GATEWAY_STORAGE_UNAVAILABLE'; } }
      phase = code === 'GATEWAY_STOPPED' ? 'stopped' : 'halted';
    }
    return snapshot();
  }
  return Object.freeze({
    start(owner) {
      requireName(owner); requireCondition(!started, 'GATEWAY_ALREADY_STARTED');
      started = true; running = true; task = run(owner); return task;
    },
    async stop() { if (running) halt('GATEWAY_STOPPED'); return task ? await task : snapshot(); },
    async readStatus() {
      const current = snapshot();
      if (running && current.phase === 'observing' && await observer.isCurrent()) current.phase = 'current';
      return current;
    },
  });
}
