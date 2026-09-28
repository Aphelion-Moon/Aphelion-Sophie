import { createHash, createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { ContractError, requireCondition, requireKeys } from '../../contracts/validation.js';

const profiles=Object.freeze({
  inference:{frame:1048576,total:2097152,messages:24,lifetime:15000,domain:'sophie-ai-ipc-v2'},
  control:{frame:8192,total:32768,messages:4,lifetime:5000,domain:'sophie-ai-control-v2'},
});

/** Encrypts bounded frames. Key custody, endpoint identity and OS access remain separate qualification gates. */
export function createAiIpcChannel({ stream, key, side, clock = Date.now, profile='inference' }) {
  requireCondition(Buffer.isBuffer(key) && key.length === 32 && ['broker','worker'].includes(side) &&
    Object.hasOwn(profiles,profile) && stream && ['on','write','destroy'].every(name => typeof stream[name] === 'function'), 'AI_IPC_CONFIGURATION_INVALID');
  const limits=profiles[profile];
  const secret = Buffer.from(key), controller = new AbortController(), queue = [];
  const peerSide = side === 'worker' ? 'broker' : 'worker', salt = randomBytes(32);
  const domain = direction => Buffer.from(`${limits.domain}:${direction}:`,'utf8');
  const derive = (direction,value) => Buffer.from(hkdfSync('sha256',secret,value,domain(direction),32));
  const sendKey = derive(side,salt); let receiveKey = null, receiveSalt = null;
  // A fresh 256-bit salt gives each sender/channel a distinct key. Sequence never resets under that key.
  const nonce = sequence => { const value=Buffer.alloc(12);value.writeUInt32BE(sequence,8);return value; };
  let session = side === 'broker' ? randomBytes(32).toString('hex') : null, incoming = 0, outgoing = 0, bound = false;
  let received = 0, sent = 0, buffer = Buffer.alloc(0), waiting = null, stopped = false;
  let deadline = clock() + limits.lifetime, timer;
  function close() {
    if (stopped) return; stopped = true; clearTimeout(timer); controller.abort();
    buffer = Buffer.alloc(0); queue.length = 0; secret.fill(0); sendKey.fill(0); receiveKey?.fill(0);
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
      received += chunk.length; requireCondition(received <= limits.total, 'AI_IPC_LIMIT');
      buffer = Buffer.concat([buffer,chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        requireCondition(length > 48 && length <= limits.frame && incoming < limits.messages, 'AI_IPC_LIMIT');
        if (buffer.length < length+4) break;
        const peerSalt = buffer.subarray(4,36);
        if (receiveSalt === null) { receiveSalt=Buffer.from(peerSalt);receiveKey=derive(peerSide,receiveSalt); }
        requireCondition(peerSalt.equals(receiveSalt),'AI_IPC_UNAUTHENTICATED');
        const decipher=createDecipheriv('aes-256-gcm',receiveKey,nonce(incoming),{authTagLength:16});
        decipher.setAAD(Buffer.concat([domain(peerSide),buffer.subarray(0,36)]));
        decipher.setAuthTag(buffer.subarray(36,52));
        // No decoded bytes reach JSON parsing or a caller until the full tag verifies.
        const pending=decipher.update(buffer.subarray(52,length+4)); let bytes;
        try { bytes=Buffer.concat([pending,decipher.final()]); } finally { pending.fill(0); }
        let frame;
        try { frame=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } finally { bytes.fill(0); }
        requireKeys(frame,['version','session','sequence','kind','body'],'AI_IPC_INVALID');
        requireCondition(frame.version === 2 && /^[a-f0-9]{64}$/u.test(frame.session) && frame.sequence === incoming++ &&
          incoming <= limits.messages && typeof frame.kind === 'string' && /^[a-z-]{1,32}$/u.test(frame.kind), 'AI_IPC_INVALID');
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
      session = createHash('sha256').update(`${limits.domain}:${session}:${challenge}`).digest('hex'); bound = true;
    },
    async send(kind,body) {
      try {
        requireCondition(!stopped && session !== null && outgoing < limits.messages && clock() < deadline,'AI_IPC_CLOSED');
        const sequence=outgoing++,bytes=Buffer.from(JSON.stringify({version:2,session,sequence,kind,body}),'utf8');
        let frame;
        try {
          requireCondition(bytes.length+48 <= limits.frame && sent+bytes.length+52 <= limits.total,'AI_IPC_LIMIT');
          frame=Buffer.allocUnsafe(bytes.length+52);frame.writeUInt32BE(bytes.length+48);salt.copy(frame,4);
          const cipher=createCipheriv('aes-256-gcm',sendKey,nonce(sequence),{authTagLength:16});
          cipher.setAAD(Buffer.concat([domain(side),frame.subarray(0,36)]));
          Buffer.concat([cipher.update(bytes),cipher.final()]).copy(frame,52);cipher.getAuthTag().copy(frame,36);
        } finally { bytes.fill(0); }
        sent += frame.length;
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
