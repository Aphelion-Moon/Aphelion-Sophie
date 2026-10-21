import { createServer } from 'node:http';

/**
 * The Shuttle Activity's closed screen (P40). Until the Activity opens, every launch shows one static "not boarding
 * yet" page. It serves only that page and the pinned Cozette font: no Discord token, no database, no member data, no
 * AI, no scripts, and no request content is read or logged. Hosts other than the configured ones are refused.
 */
const HEADERS = Object.freeze({
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-cache',
});

/**
 * @param {{ page: Uint8Array, font: Uint8Array, allowedHosts: string[] }} options
 * @returns {(req: object, res: object) => void} A node:http request listener.
 */
export function createClosedScreenHandler({ page, font, allowedHosts }) {
  const hosts = new Set(allowedHosts.map(host => host.toLowerCase()));
  return (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { ...HEADERS, ...(type ? { 'content-type': type } : {}), 'content-length': body ? body.length : 0 });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const host = String(req.headers.host || '').toLowerCase();
    if (!hosts.has(host)) return send(421, 'text/plain; charset=utf-8', Buffer.from('Misdirected request\n'));
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('allow', 'GET, HEAD'); return send(405, 'text/plain; charset=utf-8', Buffer.from('Method not allowed\n')); }
    const path = (req.url || '/').split('?')[0];
    if (path === '/' || path === '/index.html') return send(200, 'text/html; charset=utf-8', page);
    if (path === '/fonts/CozetteVector.woff2') return send(200, 'font/woff2', font);
    return send(404, 'text/plain; charset=utf-8', Buffer.from('Not found\n'));
  };
}

/** Starts the closed screen on a loopback port. */
export function startClosedScreenHost({ page, font, allowedHosts, port, address = '127.0.0.1' }) {
  const server = createServer(createClosedScreenHandler({ page, font, allowedHosts }));
  server.headersTimeout = 10_000;
  server.requestTimeout = 10_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, address, () => resolve(server));
  });
}
