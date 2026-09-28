import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ContractError, requireCondition, requireKeys } from '../../contracts/validation.js';

const MAX_FRAME = 1048576, MAX_TOTAL = 2097152, MAX_MESSAGES = 24;

/** Authenticates bounded frames on an injected private stream. Transport confidentiality/ACLs are separate gates. */
export function createAiIpcChannel({ stream, key, side, clock = Date.now }) {
  requireCondition(Buffer.isBuffer(key) && key.length === 32 && ['broker','worker'].includes(side) &&
    stream && ['on','write','destroy'].every(name => typeof stream[name] === 'function'), 'AI_IPC_CONFIGURATION_INVALID');
  const secret = Buffer.from(key), controller = new AbortController(), queue = [];
  let session = side === 'broker' ? randomBytes(32).toString('hex') : null, incoming = 0, outgoing = 0, bound = false;
  let received = 0, sent = 0, buffer = Buffer.alloc(0), waiting = null, stopped = false;
  let deadline = clock() + 15000, timer;
  const mac = (direction, bytes) => createHmac('sha256',secret).update(`sophie-ai-ipc-v1:${direction}:`).update(bytes).digest();
  function close() {
    if (stopped) return; stopped = true; clearTimeout(timer); controller.abort();
    buffer = Buffer.alloc(0); queue.length = 0; secret.fill(0);
    waiting?.reject(new ContractError('AI_IPC_CLOSED')); waiting = null; stream.destroy();
  }
  function tighten(expiresAt) {
    requireCondition(Number.isSafeInteger(expiresAt) && expiresAt > clock() && expiresAt <= deadline, 'AI_IPC_DEADLINE_INVALID');
    deadline = expiresAt; clearTimeout(timer); timer = setTimeout(close,Math.max(1,deadline-clock())); timer.unref();
  }
  tighten(deadline);
  stream.on('error',close); stream.on('end',close); stream.on('close',close);
  stream.on('data',chunk => {
    try {
      requireCondition(!stopped && Buffer.isBuffer(chunk) && clock() < deadline, 'AI_IPC_CLOSED');
      received += chunk.length; requireCondition(received <= MAX_TOTAL, 'AI_IPC_LIMIT');
      buffer = Buffer.concat([buffer,chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        requireCondition(length > 32 && length <= MAX_FRAME, 'AI_IPC_LIMIT');
        if (buffer.length < length+4) break;
        const signature = buffer.subarray(4,36), bytes = buffer.subarray(36,length+4);
        requireCondition(timingSafeEqual(signature,mac(side === 'worker' ? 'broker' : 'worker',bytes)), 'AI_IPC_UNAUTHENTICATED');
        const frame = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        requireKeys(frame,['version','session','sequence','kind','body'],'AI_IPC_INVALID');
        requireCondition(frame.version === 1 && /^[a-f0-9]{64}$/u.test(frame.session) && frame.sequence === incoming++ &&
          incoming <= MAX_MESSAGES && typeof frame.kind === 'string' && /^[a-z-]{1,32}$/u.test(frame.kind), 'AI_IPC_INVALID');
        if (session === null) { requireCondition(frame.kind === 'challenge' && incoming === 1,'AI_IPC_INVALID'); session = frame.session; }
        requireCondition(frame.session === session,'AI_IPC_INVALID');
        buffer = buffer.subarray(length+4);
        if (waiting) { const { resolve } = waiting; waiting = null; resolve(frame); }
        else { requireCondition(queue.length < 2,'AI_IPC_LIMIT'); queue.push(frame); }
      }
    } catch { close(); }
  });
  // The authenticated inbox/dialer hands over a paused byte stream after its boot handshake.
  stream.resume?.();
  return Object.freeze({
    signal: controller.signal, close, tighten,
    bind(challenge) {
      requireCondition(!bound && !stopped && incoming === 1 && outgoing === 1 && /^[a-f0-9]{64}$/u.test(challenge),'AI_IPC_INVALID');
      session = createHash('sha256').update(`sophie-ai-ipc-v1:${session}:${challenge}`).digest('hex'); bound = true;
    },
    async send(kind,body) {
      try {
        requireCondition(!stopped && session !== null && outgoing < MAX_MESSAGES && clock() < deadline,'AI_IPC_CLOSED');
        const bytes = Buffer.from(JSON.stringify({version:1,session,sequence:outgoing++,kind,body}),'utf8');
        requireCondition(bytes.length+32 <= MAX_FRAME && sent+bytes.length+36 <= MAX_TOTAL,'AI_IPC_LIMIT');
        const frame = Buffer.allocUnsafe(bytes.length+36); frame.writeUInt32BE(bytes.length+32); mac(side,bytes).copy(frame,4); bytes.copy(frame,36); sent += frame.length;
        await new Promise((resolve,reject) => stream.write(frame,error => error ? reject(new ContractError('AI_IPC_CLOSED')) : resolve()));
      } catch { close(); throw new ContractError('AI_IPC_CLOSED'); }
    },
    async receive(kind = null) {
      requireCondition(!stopped && waiting === null && clock() < deadline,'AI_IPC_CLOSED');
      const frame = queue.length ? queue.shift() : await new Promise((resolve,reject) => { waiting = {resolve,reject}; });
      if (kind !== null && frame.kind !== kind) { close(); throw new ContractError('AI_IPC_INVALID'); }
      return kind === null ? {kind:frame.kind,body:frame.body} : frame.body;
    },
  });
}
