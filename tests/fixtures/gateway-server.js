import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { SYNTHETIC_GATEWAY_TOKEN } from './gateway-supervisor.js';

/** Test-only, loopback RFC 6455 peer for our small uncompressed JSON payloads. No reusable server API. */
export async function createLoopbackGateway({ onPacket, heartbeatInterval = 1_000 }) {
  const connections = [], sockets = new Set(), errors = [], pending = new Set();
  const server = createServer((_, response) => { response.writeHead(404); response.end(); });
  server.on('upgrade', (request, socket, head) => {
    const key = request.headers['sec-websocket-key'];
    if (request.url !== '/?v=10&encoding=json' || typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16 ||
        request.headers['sec-websocket-version'] !== '13') { socket.destroy(); return; }
    sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let bytes = Buffer.alloc(0), closed = false;
    function frame(op, body) {
      if (closed || socket.destroyed) return;
      const header = Buffer.alloc(body.length < 126 ? 2 : 4); header[0] = 0x80 | op;
      header[1] = body.length < 126 ? body.length : 126;
      if (body.length >= 126) header.writeUInt16BE(body.length, 2);
      socket.write(Buffer.concat([header, body]));
    }
    const peer = { received: [],
      send(value) { frame(1, Buffer.from(JSON.stringify(value))); },
      close(code) { const body = Buffer.alloc(2); body.writeUInt16BE(code); frame(8, body); },
    };
    connections.push(peer);
    function receive(chunk) {
      try {
        if (closed) return;
        bytes = Buffer.concat([bytes, chunk]);
        if (bytes.length > 32_768) throw new Error('BOUNDED_TEST_FRAME_REQUIRED');
        while (bytes.length >= 2) {
          if (bytes[0] & 0x70 || !(bytes[0] & 0x80) || !(bytes[1] & 0x80)) throw new Error('UNSUPPORTED_TEST_FRAME');
          const opcode = bytes[0] & 0x0f;
          let length = bytes[1] & 0x7f, offset = 2;
          if (length === 127) throw new Error('BOUNDED_TEST_FRAME_REQUIRED');
          if (length === 126) { if (bytes.length < 4) return; length = bytes.readUInt16BE(2); offset = 4; }
          if (bytes.length < offset + 4 + length) return;
          const mask = bytes.subarray(offset, offset + 4), body = Buffer.from(bytes.subarray(offset + 4, offset + 4 + length));
          bytes = bytes.subarray(offset + 4 + length);
          for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
          if (opcode === 8) { frame(8, body); closed = true; socket.end(); return; }
          if (opcode === 9) { frame(10, body); continue; }
          if (opcode !== 1 || length > 4_096) throw new Error('UNSUPPORTED_TEST_FRAME');
          const raw = JSON.parse(body.toString('utf8'));
          if (![1, 2, 6].includes(raw.op)) throw new Error('UNSUPPORTED_TEST_OPCODE');
          if (raw.op !== 1 && raw.d.token !== SYNTHETIC_GATEWAY_TOKEN) throw new Error('SYNTHETIC_CREDENTIAL_REQUIRED');
          // Retain no credential even in this loopback-only fixture.
          const metadata = raw.op === 1 ? { op: 1, sequence: raw.d } : raw.op === 2 ?
            { op: 2, intents: raw.d.intents, properties: raw.d.properties } :
            { op: 6, sessionId: raw.d.session_id, sequence: raw.d.seq };
          peer.received.push(metadata);
          if (raw.op === 1) peer.send({ op: 11 });
          const work = Promise.resolve().then(() => onPacket(metadata, peer));
          pending.add(work); void work.catch(() => { errors.push('TEST_HANDLER_FAILED'); socket.destroy(); }).finally(() => pending.delete(work));
        }
      } catch { errors.push('TEST_PROTOCOL_FAILED'); socket.destroy(); }
    }
    socket.on('data', receive); if (head.length) receive(head);
    peer.send({ op: 10, d: { heartbeat_interval: heartbeatInterval } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `ws://127.0.0.1:${server.address().port}/?v=10&encoding=json`;
  return { connections, errors,
    connect(discordUrl) {
      if (!/^wss:\/\/gateway(?:-[a-z0-9-]+)?\.discord\.gg\/\?v=10&encoding=json$/.test(discordUrl)) throw new Error('TEST_GATEWAY_URL_INVALID');
      return new WebSocket(url);
    },
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await Promise.allSettled(pending);
    },
  };
}

export async function waitForGateway(condition, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('SYNTHETIC_GATEWAY_DEADLINE');
}
