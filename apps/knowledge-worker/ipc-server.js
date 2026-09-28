import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { createAiIpcChannel } from './ipc-channel.js';
import { canonicalAiWorkerIdentity, validateAiWorkerPayload } from './ipc-contract.js';

/** One prepared/in-flight turn. The host supplies the private transport; no listener, credentials or service provisioning here. */
export function createAiIpcWorker({ identity, key, adapter, qualified = async()=>false, clock = Date.now }) {
  const fixed = canonicalAiWorkerIdentity(identity), connections = new Set();
  requireCondition(Buffer.isBuffer(key) && key.length === 32,'AI_IPC_CONFIGURATION_INVALID');
  requireCondition(typeof qualified === 'function','TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(adapter?.provider === fixed.provider && adapter.profileHash === fixed.profileHash &&
    ['prepare','generatePrepared'].every(name => typeof adapter[name] === 'function'),'AI_IPC_ADAPTER_INVALID');
  let active = false, stopping = false;
  return Object.freeze({
    accept(stream) {
      if (stopping || connections.size >= 4) { stream.destroy(); return Promise.resolve(); }
      const channel = createAiIpcChannel({stream,key,side:'worker',clock}); let ownsSlot = false;
      const release = () => { if (ownsSlot) { active = false; ownsSlot = false; } };
      const task = (async () => {
        try {
          requireKeys(await channel.receive('challenge'),[],'AI_IPC_INVALID');
          // The authenticated greeting is the worker's fresh pre-transfer readiness acknowledgement.
          requireCondition(await qualified(fixed,{signal:channel.signal}) === true && !channel.signal.aborted && !stopping,'AI_WORKER_NOT_QUALIFIED');
          const challenge = randomBytes(32).toString('hex');
          const hello = channel.send('hello',{identity:fixed,challenge}); channel.bind(challenge); await hello;
          const request = await channel.receive();
          if(request.kind==='probe') {
            requireKeys(request.body,[],'AI_IPC_INVALID');
            requireCondition(await qualified(fixed,{signal:channel.signal}) === true && !channel.signal.aborted && !stopping,'AI_WORKER_NOT_QUALIFIED');
            await channel.send('ready',{});requireKeys(await channel.receive('received'),[],'AI_IPC_INVALID');return;
          }
          requireCondition(request.kind==='prepare','AI_IPC_INVALID');const input=request.body;
          requireKeys(input,['deadline','payload'],'AI_IPC_PAYLOAD_INVALID');
          channel.tighten(input.deadline); validateAiWorkerPayload(input.payload,fixed);
          requireCondition(!active && !stopping,'AI_IPC_BUSY'); active = true; ownsSlot = true;
          const prepared = await adapter.prepare(input.payload);
          requireCondition(!channel.signal.aborted,'AI_IPC_CLOSED');
          await channel.send('prepared',{bytes:prepared.bytes,outputTokens:prepared.outputTokens,contract:prepared.contract});
          const generation = await channel.receive('generate'); requireKeys(generation,['deadline'],'AI_IPC_INVALID'); channel.tighten(generation.deadline);
          async function acknowledgement(kind,body = {}) {
            await channel.send(kind,body); const result = await channel.receive('ack'); requireKeys(result,['kind','accepted'],'AI_IPC_INVALID');
            requireCondition(result.kind === kind && typeof result.accepted === 'boolean','AI_IPC_INVALID'); return result.accepted;
          }
          const output = await adapter.generatePrepared(prepared,{signal:channel.signal,deadline:generation.deadline,
            beforeDispatch: () => acknowledgement('authorize'),
            recordDispatch: () => acknowledgement('dispatch'),
            recordResponse: async observation => { requireCondition(await acknowledgement('usage',observation),'AI_IPC_ACCOUNTING_FAILED'); },
            recordUndispatched: async () => { requireCondition(await acknowledgement('undispatched'),'AI_IPC_ACCOUNTING_FAILED'); },
          });
          release(); await channel.send('result',output); requireKeys(await channel.receive('received'),[],'AI_IPC_INVALID');
        } catch {
          release();
          if (!channel.signal.aborted) try { await channel.send('failed',{}); requireKeys(await channel.receive('received'),[],'AI_IPC_INVALID'); } catch { /* The core retains any uncertain dispatch. */ }
        } finally { release(); channel.close(); }
      })();
      connections.add({channel,task});
      void task.finally(() => { for (const connection of connections) if (connection.task === task) connections.delete(connection); });
      return task;
    },
    status() { return {active,stopping,connections:connections.size}; },
    async stop() { stopping = true; for (const connection of connections) connection.channel.close(); await Promise.all([...connections].map(connection => connection.task)); },
  });
}
import { randomBytes } from 'node:crypto';
