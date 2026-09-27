import { defaultSystemText } from '../../../contracts/system-messages.js';
import { createServer } from 'node:http';
import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { caseFormModal } from '../../../modules/tickets/intake.js';

const MAX_BODY = 262_144;
const messages = {"disabled":"initial.disabled","busy":"initial.busy","denied":"initial.denied","unavailable":"initial.unavailable","ticket_busy":"initial.ticket_busy","ticket_form_unavailable":"initial.ticket_form_unavailable"};
const message = content => ({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });

/** Loopback-only receiver. External TLS/proxy configuration is a separate release gate. */
export function createInteractionHttpServer({ verifier, commands, respond, enabled, onFault, caseIntake = null, onboardingPanel = null, initialBudgetMs = 2_500, readSystemText = async () => defaultSystemText }) {
  requireCondition(typeof respond === 'function' && typeof enabled === 'function' && typeof onFault === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseIntake === null || typeof caseIntake.prepare === 'function', 'TRUSTED_ADAPTERS_REQUIRED'); requireInteger(initialBudgetMs, 50, 2_500);
  const running = new Set();
  let reserved = false, stopping = false;
  const fault = code => { try { onFault(code); } catch { /* Logging cannot change command state. */ } };
  function send(response, status, body) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  }
  async function handle(request, response) {
    const initialDeadline = performance.now() + initialBudgetMs;
    if (request.method !== 'POST' || request.url !== '/discord/interactions') { send(response, 404, { error: 'Not found.' }); return; }
    if (request.headers['content-encoding'] !== undefined || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
      send(response, 415, { error: 'JSON required.' }); return;
    }
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) { send(response, 413, { error: 'Request too large.' }); return; }
    for (const name of ['x-signature-ed25519', 'x-signature-timestamp']) {
      if (request.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === name).length !== 1) {
        send(response, 401, { error: 'Invalid signature.' }); return;
      }
    }
    let envelope;
    const deadline = setTimeout(() => request.destroy(), 1_500); deadline.unref();
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        requireCondition(size <= MAX_BODY, 'INTERACTION_BODY_INVALID'); chunks.push(chunk);
      }
      envelope = verifier.verify({ body: Buffer.concat(chunks), signature: request.headers['x-signature-ed25519'], timestamp: request.headers['x-signature-timestamp'] });
    } catch (error) {
      const status = ['INTERACTION_SIGNATURE_INVALID', 'INTERACTION_TIMESTAMP_INVALID'].includes(error.code) ? 401 : 400;
      if (!response.destroyed) send(response, status, { error: 'Invalid interaction.' });
      return;
    } finally { clearTimeout(deadline); }
    if (envelope.kind === 'ping') { send(response, 200, { type: 1 }); return; }
    let text = defaultSystemText, wordingTimer;
    try { text = await Promise.race([readSystemText(), new Promise(resolve => { wordingTimer = setTimeout(() => resolve(defaultSystemText), 100); })]); }
    catch { fault('SYSTEM_WORDING_UNAVAILABLE'); }
    finally { clearTimeout(wordingTimer); }
    const opensModal = (envelope.command === 'ticket.begin' && envelope.caseType !== 'quick-help') || envelope.command === 'ticket.contact.confirm';
    // The modal availability check belongs inside its initial-response deadline too.
    if (stopping || (!opensModal && await enabled() !== true)) { send(response, 200, message(text(messages.disabled))); return; }
    // One active command: no unbounded in-memory backlog and no concurrent member reads
    // through the same serial transport. Durable role work is separate in PostgreSQL.
    if (reserved) { send(response, 200, message(text(messages.busy))); return; }
    reserved = true;
    if (envelope.command === 'shuttle.panel') {
      let live = true, timer;
      const isCurrent = () => live && !stopping && !response.destroyed && performance.now() < initialDeadline;
      response.once('close', () => { live = false; });
      const task = Promise.resolve().then(() => onboardingPanel?.prepare(envelope, { isCurrent })).catch(() => null)
        .finally(() => { running.delete(task); reserved = false; });
      running.add(task);
      try {
        const data = await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, initialDeadline - performance.now())); })]);
        if (!response.destroyed) send(response, 200, data && isCurrent() ? { type: 4, data } : message(text(messages.denied)));
      } finally { live = false; clearTimeout(timer); }
      return;
    }
    // A modal is an initial response, never an edit of a deferred acknowledgement.
    if (opensModal) {
      if (caseIntake === null) { reserved = false; send(response, 200, message(text(messages.ticket_form_unavailable))); return; }
      let live = true, timer;
      const isCurrent = () => live && !stopping && !response.destroyed && performance.now() < initialDeadline;
      response.once('close', () => { live = false; });
      let task;
      task = Promise.resolve().then(async () => {
        if (await enabled() !== true) return { status: 'disabled' };
        if (!isCurrent()) return { status: 'unavailable' };
        return caseIntake.prepare(envelope, { isCurrent });
      }).catch(() => {
        fault('INTERACTION_MODAL_UNAVAILABLE'); return { status: 'unavailable' };
      }).finally(() => { running.delete(task); reserved = false; });
      running.add(task);
      try {
        const result = await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'unavailable' }), Math.max(0, initialDeadline - performance.now())); })]);
        let body = isCurrent() && result.status === 'modal' ? caseFormModal(result.modal) : message(text(messages[result.status] ?? messages.unavailable));
        if (body.type === 9 && !isCurrent()) body = message(text(messages.unavailable));
        if (!response.destroyed) send(response, 200, body);
      } finally { live = false; clearTimeout(timer); }
      return;
    }
    let started = false;
    response.once('close', () => { if (!started) reserved = false; });
    response.once('finish', () => {
      started = true;
      let task;
      task = (async () => {
        let result;
        try { result = await commands.execute(envelope); }
        catch { fault('INTERACTION_EXECUTION_UNAVAILABLE'); result = 'unavailable'; }
        try { await respond(envelope, result); }
        catch { fault('INTERACTION_RESPONSE_UNAVAILABLE'); }
      })().finally(() => { running.delete(task); reserved = false; });
      running.add(task);
    });
    // Acknowledge before database or Discord work. This is receipt, not completion.
    send(response, 200, envelope.command === 'shuttle.control' ? { type: 6 } : { type: 5, data: { flags: 64 } });
  }
  const server = createServer({ maxHeaderSize: 16_384 }, (request, response) => {
    handle(request, response).catch(() => {
      fault('INTERACTION_TRANSPORT_INVALID');
      if (!response.headersSent && !response.destroyed) send(response, 503, { error: 'Service unavailable.' });
      else response.destroy();
    });
  });
  server.maxConnections = 32;
  server.headersTimeout = 2_000; server.requestTimeout = 3_000;
  server.keepAliveTimeout = 1_000; server.maxRequestsPerSocket = 20;
  return Object.freeze({
    async listen(port = 0) {
      requireInteger(port, 0, 65535); requireCondition(port === 0 || port >= 1024, 'INVALID_HTTP_PORT');
      requireCondition(!server.listening && !stopping, 'HTTP_SERVER_ALREADY_STARTED');
      await new Promise((resolve, reject) => {
        const error = failure => { server.off('listening', ready); reject(failure); };
        const ready = () => { server.off('error', error); resolve(); };
        server.once('error', error); server.once('listening', ready); server.listen(port, '127.0.0.1');
      });
      return { host: '127.0.0.1', port: server.address().port };
    },
    async drain() { await Promise.all([...running]); },
    async close() {
      stopping = true;
      if (server.listening) {
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server.closeAllConnections(); await closed;
      }
      await Promise.all([...running]);
    },
  });
}
