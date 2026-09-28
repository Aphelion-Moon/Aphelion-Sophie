import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';

export function aiEgressPipe(identity) {
  const fixed = canonicalAiWorkerIdentity(identity);
  requireCondition(process.platform === 'win32', 'AI_WINDOWS_REQUIRED');
  return `\\\\.\\pipe\\sophie-ai-egress-${fixed.workerId}-${fixed.bootId}`;
}

function readExactly(stream, length, signal) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off('readable', read); stream.off('end', fail); stream.off('close', fail); stream.off('error', fail);
      signal.removeEventListener('abort', fail);
    };
    const fail = () => { cleanup(); reject(Error('AI_EGRESS_UNAVAILABLE')); };
    const read = () => {
      if (signal.aborted || stream.destroyed || stream.readableEnded) { fail(); return; }
      const bytes = stream.read(length);
      if (bytes !== null) { cleanup(); resolve(bytes); }
    };
    stream.on('readable', read); stream.once('end', fail); stream.once('close', fail); stream.once('error', fail);
    signal.addEventListener('abort', fail, { once:true }); read();
  });
}

/** Fixed-size mutual boot authentication. The subsequent provider TLS session supplies confidentiality. */
export async function authenticateAiEgress({ stream, identity, key, side, signal }) {
  const fixed = canonicalAiWorkerIdentity(identity);
  requireCondition(Buffer.isBuffer(key) && key.length === 32 && ['bridge','worker'].includes(side) &&
    signal instanceof AbortSignal, 'AI_EGRESS_CONFIGURATION_INVALID');
  const secret = Buffer.from(key), timeout = new AbortController();
  const combined = AbortSignal.any([signal,timeout.signal]);
  const timer = setTimeout(() => timeout.abort(),2000);
  const destroy = () => stream.destroy();
  const ignore = () => {};
  stream.on('error',ignore); combined.addEventListener('abort',destroy,{once:true});
  // Ordered fields bind every release/profile attribute independently of object insertion order.
  const scope = JSON.stringify(['workerId','bootId','releaseHash','profileHash','provider','domain'].map(name => fixed[name]));
  const mac = (role, ...parts) => {
    const hmac = createHmac('sha256',secret).update(`sophie-egress-v1:${scope}:${role}:`);
    for (const part of parts) hmac.update(part);
    return hmac.digest();
  };
  const write = bytes => new Promise((resolve,reject) => stream.write(bytes,error => error ? reject(error) : resolve()));
  try {
    requireCondition(!combined.aborted && !stream.destroyed,'AI_EGRESS_UNAVAILABLE');
    if (side === 'bridge') {
      const challenge = randomBytes(32);
      await write(Buffer.concat([challenge,mac('challenge',challenge)]));
      const proof = await readExactly(stream,64,combined), nonce = proof.subarray(0,32);
      requireCondition(timingSafeEqual(proof.subarray(32),mac('worker',challenge,nonce)),'AI_EGRESS_UNAVAILABLE');
      await write(mac('accepted',challenge,nonce));
    } else {
      const greeting = await readExactly(stream,64,combined), challenge = greeting.subarray(0,32);
      requireCondition(timingSafeEqual(greeting.subarray(32),mac('challenge',challenge)),'AI_EGRESS_UNAVAILABLE');
      const nonce = randomBytes(32);
      await write(Buffer.concat([nonce,mac('worker',challenge,nonce)]));
      requireCondition(timingSafeEqual(await readExactly(stream,32,combined),mac('accepted',challenge,nonce)),'AI_EGRESS_UNAVAILABLE');
    }
    requireCondition(!combined.aborted && !stream.destroyed,'AI_EGRESS_UNAVAILABLE');
  } catch { stream.destroy(); throw Error('AI_EGRESS_UNAVAILABLE'); }
  finally { clearTimeout(timer); combined.removeEventListener('abort',destroy); stream.off('error',ignore); secret.fill(0); }
}
