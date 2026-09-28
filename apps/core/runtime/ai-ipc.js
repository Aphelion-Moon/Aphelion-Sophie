import { ContractError, requireCondition, requireKeys } from '../../../contracts/validation.js';
import { validateAiOutput } from '../../../modules/assistant/output.js';
import { createAiIpcChannel } from '../../knowledge-worker/ipc-channel.js';
import { canonicalAiWorkerIdentity, aiWorkerPayload, validateAiPreparedMetadata } from '../../knowledge-worker/ipc-contract.js';

/** Core-side adapter. Qualification is a required fresh trusted check, never inferred from a successful socket connection. */
export function createAiIpcClient({ identity, key, connect, qualified, clock = Date.now }) {
  const fixed = canonicalAiWorkerIdentity(identity), preparations = new WeakMap(), channels = new Set(); let stopped = false;
  requireCondition(typeof connect === 'function' && typeof qualified === 'function','TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(Buffer.isBuffer(key) && key.length === 32,'AI_IPC_CONFIGURATION_INVALID');
  const current = async payload => !stopped && payload?.restricted === false && payload.workerDomain === fixed.domain &&
    payload.releaseHash === fixed.releaseHash && await qualified(fixed,payload) === true;
  function discardPrepared(prepared) { const state = preparations.get(prepared); if (state) { state.signal?.removeEventListener('abort',state.abort); state.channel.close(); channels.delete(state.channel); preparations.delete(prepared); } }
  return Object.freeze({
    provider:'deepseek', current, discardPrepared,
    async probe({signal}={}) {
      requireCondition(!stopped && !signal?.aborted && channels.size===0 && await qualified(fixed)===true,'AI_WORKER_NOT_QUALIFIED');
      const channel=createAiIpcChannel({stream:connect(),key,side:'broker',clock});channels.add(channel);
      const abort=()=>channel.close();signal?.addEventListener('abort',abort,{once:true});
      try {
        channel.tighten(clock()+2000);await channel.send('challenge',{});
        const hello=await channel.receive('hello');requireKeys(hello,['identity','challenge'],'AI_IPC_INVALID');channel.bind(hello.challenge);
        const peer=canonicalAiWorkerIdentity(hello.identity);
        requireCondition(Object.keys(fixed).every(name=>peer[name]===fixed[name]) && !stopped && !signal?.aborted && await qualified(fixed)===true,'AI_WORKER_NOT_QUALIFIED');
        await channel.send('probe',{});requireKeys(await channel.receive('ready'),[],'AI_IPC_INVALID');
        requireCondition(!stopped && !signal?.aborted && await qualified(fixed)===true,'AI_WORKER_NOT_QUALIFIED');
        await channel.send('received',{});return peer;
      } finally {signal?.removeEventListener('abort',abort);channel.close();channels.delete(channel);}
    },
    async prepare(payload,context = {}) {
      requireCondition(await current(payload),'AI_WORKER_NOT_QUALIFIED');
      requireCondition(!context.signal?.aborted,'AI_IPC_CLOSED');
      requireCondition(channels.size === 0,'AI_IPC_BUSY');
      const outbound = aiWorkerPayload(payload,fixed), deadline = Math.min(payload.local?.deadline,context.deadline ?? payload.local?.deadline);
      requireCondition(Number.isSafeInteger(deadline) && deadline > clock() && deadline <= clock()+15000,'AI_IPC_DEADLINE_INVALID');
      const channel = createAiIpcChannel({stream:connect(),key,side:'broker',clock}); channels.add(channel);
      const abort = () => channel.close(); context.signal?.addEventListener('abort',abort,{once:true});
      try {
        channel.tighten(deadline);
        await channel.send('challenge',{});
        const hello = await channel.receive('hello'); requireKeys(hello,['identity','challenge'],'AI_IPC_INVALID'); channel.bind(hello.challenge);
        const peer = canonicalAiWorkerIdentity(hello.identity);
        requireCondition(Object.keys(fixed).every(name => peer[name] === fixed[name]) && await current(payload) &&
          (!context.beforeDispatch || await context.beforeDispatch() === true) && !context.signal?.aborted,'AI_WORKER_NOT_QUALIFIED');
        await channel.send('prepare',{deadline,payload:outbound});
        const prepared = validateAiPreparedMetadata(await channel.receive('prepared'),outbound);
        preparations.set(prepared,{channel,payload,used:false,signal:context.signal,abort}); return prepared;
      } catch { context.signal?.removeEventListener('abort',abort); channel.close(); channels.delete(channel); throw new ContractError('AI_WORKER_UNAVAILABLE'); }
    },
    async generatePrepared(prepared,context) {
      const state = preparations.get(prepared);
      requireCondition(state && !state.used,'AI_PREPARATION_UNTRUSTED'); state.used = true;
      const {channel,payload} = state; let phase = 'authorize';
      const abort = () => channel.close(); context.signal.addEventListener('abort',abort,{once:true});
      try {
        requireCondition(!context.signal.aborted && await current(payload),'AI_WORKER_NOT_QUALIFIED');
        channel.tighten(context.deadline); await channel.send('generate',{deadline:context.deadline});
        for (;;) {
          const {kind,body} = await channel.receive();
          if (kind === 'result' || kind === 'failed') {
            requireCondition(kind === 'failed' || phase === 'result','AI_IPC_INVALID');
            if (kind === 'failed') requireKeys(body,[],'AI_IPC_INVALID');
            const result = kind === 'result' ? validateAiOutput(body,{...prepared.contract,sources:prepared.contract.sourceIds.map(id=>({id}))}) : null;
            await channel.send('received',{});
            requireCondition(result !== null && !context.signal.aborted && clock() < context.deadline,'AI_WORKER_UNAVAILABLE'); return result;
          }
          requireCondition(['authorize','dispatch','usage','undispatched'].includes(kind),'AI_IPC_INVALID');
          if (kind !== 'usage') requireKeys(body,[],'AI_IPC_INVALID');
          let accepted = false;
          if (kind === 'authorize') {
            requireCondition(['authorize','reauthorize'].includes(phase),'AI_IPC_INVALID');
            accepted = !context.signal.aborted && await current(payload) && await context.beforeDispatch() === true;
            phase = accepted ? phase === 'authorize' ? 'dispatch' : 'usage' : 'undispatched';
          } else if (kind === 'dispatch') {
            requireCondition(phase === 'dispatch','AI_IPC_INVALID');
            accepted = !context.signal.aborted && await current(payload) && await context.recordDispatch() === true;
            phase = accepted ? 'reauthorize' : 'undispatched';
          } else if (kind === 'usage') {
            requireCondition(phase === 'usage','AI_IPC_INVALID'); requireKeys(body,['usage','model','fingerprint'],'AI_IPC_INVALID');
            await context.recordResponse(body); accepted = true; phase = 'result';
          } else {
            // After final authorization, only core-denied dispatch proves that no charge was possible.
            requireCondition(phase === 'undispatched','AI_IPC_INVALID');
            await context.recordUndispatched(); accepted = true; phase = 'failed';
          }
          await channel.send('ack',{kind,accepted});
        }
      } finally { context.signal.removeEventListener('abort',abort); discardPrepared(prepared); }
    },
    async generate() { throw new ContractError('AI_METERED_WORKER_REQUIRED'); },
    stop() { stopped = true; for (const channel of channels) channel.close(); channels.clear(); },
  });
}
