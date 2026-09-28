import { Agent, request } from 'node:https';
import { Readable, Transform } from 'node:stream';
import { requireCondition } from '../../contracts/validation.js';

const endpoint = 'https://api.deepseek.com/chat/completions';

/** Worker-owned, single-origin transport. No redirects, retries, proxy inheritance or global dispatcher changes. */
export function createDeepSeekTransport({ requestImpl = request, connector = null } = {}) {
  requireCondition(typeof requestImpl === 'function' && (connector === null ||
    (typeof connector.open === 'function' && typeof connector.stop === 'function')), 'TRUSTED_ADAPTERS_REQUIRED');
  const agent = new Agent({ keepAlive:true, maxSockets:1, maxTotalSockets:1, maxFreeSockets:1,
    maxCachedSessions:0, timeout:15000, rejectUnauthorized:true, proxyEnv:{} });
  const requests = new Set(), lifetime = new AbortController(); let stopped = false, closing = null, connectingSignal;
  if (connector) agent.createConnection = (_options,callback) => {
    const signal=connectingSignal;
    Promise.resolve().then(()=>connector.open(signal)).then(socket=>{
      if(signal.aborted || stopped){socket.destroy();callback(Error('AI_HTTP_UNAVAILABLE'));}
      else callback(null,socket);
    },()=>callback(Error('AI_HTTP_UNAVAILABLE')));
  };
  return Object.freeze({
    fetch(url, options) {
      requireCondition(!stopped && requests.size === 0, 'AI_HTTP_UNAVAILABLE');
      requireCondition(url === endpoint && options?.method === 'POST' && options.redirect === 'error' &&
        options.signal instanceof AbortSignal && !options.signal.aborted && typeof options.body === 'string' &&
        Buffer.byteLength(options.body) <= 32768 && options.headers?.['content-type'] === 'application/json' &&
        /^Bearer [a-zA-Z0-9_-]{16,256}$/u.test(options.headers?.authorization ?? '') &&
        Object.keys(options.headers).length === 2, 'AI_HTTP_REQUEST_INVALID');
      return new Promise((resolve,reject) => {
        let response, body, timer;
        const aborted = new AbortController();
        connectingSignal = AbortSignal.any([options.signal,lifetime.signal,aborted.signal]);
        const fail = () => {
          const error = Error('AI_HTTP_UNAVAILABLE');
          aborted.abort();
          response?.destroy(error); body?.destroy(error); outgoing.destroy(error); reject(error);
        };
        const outgoing = requestImpl(endpoint, { method:'POST', agent, signal:connectingSignal,
          headers:{...options.headers,'content-length':Buffer.byteLength(options.body)}, maxHeaderSize:8192 }, incoming => {
          response = incoming; let bytes = 0;
          if (!Number.isInteger(incoming.statusCode) || incoming.statusCode < 200 || incoming.statusCode > 599 ||
            [204,205,304].includes(incoming.statusCode)) { fail(); return; }
          body = new Transform({ transform(chunk,_encoding,done) {
            bytes += chunk.length;
            if (bytes > 65536) done(Error('AI_HTTP_RESPONSE_LIMIT')); else done(null,chunk);
          } });
          incoming.once('error', () => body.destroy(Error('AI_HTTP_UNAVAILABLE')));
          body.once('error', fail);
          body.once('close', () => { if (!incoming.complete) incoming.destroy(); });
          const headers = new Headers();
          for (const name of ['content-type','retry-after']) if (typeof incoming.headers[name] === 'string') headers.set(name,incoming.headers[name]);
          incoming.pipe(body);
          // The adapter consumes or cancels the stream before accepting another turn.
          resolve(new Response(Readable.toWeb(body), { status:incoming.statusCode, headers }));
        });
        requests.add(outgoing);
        outgoing.once('error', () => reject(Error('AI_HTTP_UNAVAILABLE')));
        outgoing.once('close', () => { clearTimeout(timer); requests.delete(outgoing); });
        // This hard upper bound also covers headers and whitespace-only bodies; the original turn signal is tighter.
        timer = setTimeout(fail,14000); timer.unref?.();
        outgoing.end(options.body);
      });
    },
    status() { return { stopped, requests:requests.size, sockets:Object.values(agent.sockets).reduce((sum,items)=>sum+items.length,0),
      idleSockets:Object.values(agent.freeSockets).reduce((sum,items)=>sum+items.length,0), concurrency:1 }; },
    stop() {
      if (closing) return closing;
      stopped = true; lifetime.abort();
      const handles = new Set([...requests,...Object.values(agent.sockets).flat(),...Object.values(agent.freeSockets).flat()]);
      closing = Promise.all([connector?.stop(), ...[...handles].filter(handle=>!handle.closed).map(handle=>new Promise(resolve=>handle.once('close',resolve)))]).then(()=>{});
      for (const outgoing of requests) outgoing.destroy(Error('AI_HTTP_UNAVAILABLE'));
      agent.destroy(); return closing;
    },
  });
}
