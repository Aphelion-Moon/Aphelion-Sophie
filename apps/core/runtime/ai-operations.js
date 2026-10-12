import { randomUUID, randomBytes } from 'node:crypto';
import { requireCondition, requireKeys } from '../../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from '../../knowledge-worker/ipc-contract.js';
import { aiWorkerCatalogue, createAiWorkerJournal } from '../storage/ai-worker-operations.js';
import { aiDigest } from '../storage/ai-controls.js';

/** One public AI slot. The registered lifecycle adapter must fence/quiesce its own physical service, including pending starts. */
export function createAiOperationsRuntime({pool,guildId,lifecycle,createRuntime,onFault}) {
  requireCondition(lifecycle && ['quiesce','launch','qualified'].every(key=>typeof lifecycle[key]==='function') &&
    typeof createRuntime==='function' && typeof onFault==='function','TRUSTED_ADAPTERS_REQUIRED');
  const catalogue=aiWorkerCatalogue(lifecycle.releases),journal=createAiWorkerJournal({pool,guildId}),owner=randomUUID();
  let runtime=null,activeWorker=null,activeRelease=null,activeIdentity=null,session=null,timer=null,started=false,stopped=false,task=Promise.resolve(),operation=null,closing=null,starting=null,owns=false,running=false,automatic=true;
  const fault=()=>{try{onFault('AI_WORKER_OPERATIONS_UNAVAILABLE');}catch{}};
  async function quiesce(operationId) {
    const receipt=await lifecycle.quiesce({operationId});requireKeys(receipt,['operationId','stopped'],'AI_WORKER_STOP_UNCONFIRMED');
    requireCondition(receipt.operationId===operationId && receipt.stopped===true,'AI_WORKER_STOP_UNCONFIRMED');
  }
  async function drain(operationId) {
    const previous=runtime;runtime=null;activeWorker=null;activeRelease=null;activeIdentity=null;
    // Logical cancellation precedes physical termination; replacement waits for both.
    await previous?.stop();await quiesce(operationId);
  }
  async function reconcile() {
    if(stopped)return;
    const token=await journal.claim(owner);if(!token)return;
    const abort=new AbortController();operation=abort;let candidate=null,worker=null;
    const current=async()=>!stopped && !abort.signal.aborted && await journal.current(token);
    try {
      await drain(token.fence);
      if(token.action==='stop') {await journal.transition(token,'stopped');return;}
      await journal.transition(token,'starting');
      const selected=catalogue.find(item=>item.id===aiDigest(token.release));
      requireCondition(selected && await current() && await lifecycle.qualified(selected.release)===true,'AI_WORKER_NOT_QUALIFIED');
      const {workerId,releaseHash,profileHash,provider,domain}=selected.release;
      const identity=canonicalAiWorkerIdentity({workerId,releaseHash,profileHash,provider,domain,bootId:randomBytes(32).toString('hex')});
      worker=await lifecycle.launch({identity,operationId:token.fence,signal:abort.signal,
        beforeStart:async()=>await current() && await lifecycle.qualified(selected.release)===true});
      requireCondition(worker && typeof worker.probe==='function' && await current(),'AI_WORKER_NOT_QUALIFIED');
      const acknowledged=canonicalAiWorkerIdentity(await worker.probe({signal:abort.signal}));
      requireCondition(Object.keys(identity).every(key=>identity[key]===acknowledged[key]) && await current() &&
        await lifecycle.qualified(selected.release)===true,'AI_WORKER_ACK_MISMATCH');
      candidate=createRuntime(worker);await candidate.start();
      requireCondition(await current(),'AI_WORKER_OPERATION_STALE');
      requireCondition(await journal.transition(token,'ready',acknowledged),'AI_WORKER_OPERATION_STALE');
      runtime=candidate;activeWorker=worker;activeRelease=selected.release;activeIdentity=identity;candidate=null;worker=null;
    } catch {
      // An uncertain launch cannot be retried until the registered slot proves quiescence again.
      await candidate?.stop().catch(fault);if(worker?.stop)await Promise.resolve().then(()=>worker.stop()).catch(fault);
      try {await quiesce(token.fence);}catch{fault();}
      await journal.transition(token,'failed').catch(fault);fault();
    } finally {operation=null;}
  }
  // Owner decision, 12 October 2026: a running worker that loses readiness (one late heartbeat makes the supervisor
  // quiesce it) is relaunched in place with the same approved release and without re-disabling AI, at most
  // RESTART_LIMIT times per RESTART_WINDOW_MS. A relaunch that fails, or exceeds the limit, records the slot as failed
  // and disables AI, as start-up recovery does. An owner request (pending phase) always takes precedence.
  const RESTART_LIMIT=3,RESTART_WINDOW_MS=600_000,restarts=[];
  const lost=()=>runtime!==null && typeof activeWorker?.alive==='function' && activeWorker.alive()!==true;
  async function relaunch() {
    const row=await journal.read();
    if(stopped || row?.phase!=='ready' || row.owner)return reconcile();
    const abort=new AbortController();operation=abort;const fence=randomUUID(),selected=activeRelease,previous=row.active_identity;
    let candidate=null,worker=null;
    const current=async()=>!stopped && !abort.signal.aborted && await lifecycle.qualified(selected)===true;
    try {
      const now=Date.now();while(restarts.length && now-restarts[0]>RESTART_WINDOW_MS)restarts.shift();
      requireCondition(restarts.length<RESTART_LIMIT,'AI_WORKER_RESTART_LIMIT');restarts.push(now);
      await drain(fence);
      requireCondition(selected && await current(),'AI_WORKER_NOT_QUALIFIED');
      const {workerId,releaseHash,profileHash,provider,domain}=selected;
      const identity=canonicalAiWorkerIdentity({workerId,releaseHash,profileHash,provider,domain,bootId:randomBytes(32).toString('hex')});
      worker=await lifecycle.launch({identity,operationId:fence,signal:abort.signal,beforeStart:current});
      requireCondition(worker && typeof worker.probe==='function' && await current(),'AI_WORKER_NOT_QUALIFIED');
      const acknowledged=canonicalAiWorkerIdentity(await worker.probe({signal:abort.signal}));
      requireCondition(Object.keys(identity).every(key=>identity[key]===acknowledged[key]) && await current(),'AI_WORKER_ACK_MISMATCH');
      candidate=createRuntime(worker);await candidate.start();
      if(!await journal.relaunched(previous,acknowledged)){
        // The owner changed the slot meanwhile: hand back to the normal request path.
        await candidate.stop().catch(fault);candidate=null;await Promise.resolve().then(()=>worker.stop()).catch(fault);worker=null;
        await quiesce(fence);return;
      }
      runtime=candidate;activeWorker=worker;activeRelease=selected;activeIdentity=identity;candidate=null;worker=null;
      try{onFault('AI_WORKER_RELAUNCHED');}catch{}
    } catch(error) {
      await candidate?.stop().catch(fault);if(worker?.stop)await Promise.resolve().then(()=>worker.stop()).catch(fault);
      try {if(runtime)await drain(fence);else await quiesce(fence);await journal.recovered();}catch{fault();}
      try{onFault(error?.message==='AI_WORKER_RESTART_LIMIT'?'AI_WORKER_RESTART_LIMIT':'AI_WORKER_RELAUNCH_FAILED');}catch{}
    } finally {operation=null;}
  }
  function schedule() {
    clearTimeout(timer);if(stopped || !automatic)return;
    timer=setTimeout(()=>{void tick().catch(fault);},500);
  }
  function tick() {
    requireCondition(started && !stopped,'AI_RUNTIME_STOPPED');if(running)return task;
    clearTimeout(timer);running=true;task=(lost()?relaunch():reconcile()).finally(()=>{running=false;schedule();});return task;
  }
  async function stop() {
    if(closing)return closing;
    stopped=true;clearTimeout(timer);operation?.abort();runtime?.invalidate();
    closing=(async()=>{
      try {await starting?.catch(()=>{});await task.catch(fault);if(owns){await drain(randomUUID());await journal.recovered();}}
      finally {if(session){await session.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`sophie.ai.worker.${guildId}`]).catch(()=>{});session.release(true);session=null;}}
    })();return closing;
  }
  return Object.freeze({
    catalogue,
    async qualifiedRelease() {
      const current=activeWorker,release=activeRelease,identity=activeIdentity;
      if(stopped || operation || !runtime || !current || !await lifecycle.qualified(release))return null;
      try {
        const seen=await current.probe({signal:AbortSignal.timeout(5000)});
        return current===activeWorker && !stopped && !operation && Object.keys(identity).every(key=>seen[key]===identity[key]) &&
          await lifecycle.qualified(release) ? release : null;
      } catch {return null;}
    },
    diagnostics:channelId=>stopped?null:runtime?.diagnostics(channelId)??null,
    prepare:payload=>stopped?null:runtime?.prepare(payload)??null,
    committed:(proof,accepted)=>stopped?undefined:runtime?.committed(proof,accepted),
    invalidate(){runtime?.invalidate();operation?.abort();},
    start({automatic:requestedAutomatic=true}={}) {
      requireCondition(!started && !stopped,'AI_RUNTIME_ALREADY_STARTED');started=true;
      requireCondition(typeof requestedAutomatic==='boolean','AI_INPUT_INVALID');automatic=requestedAutomatic;
      starting=(async()=>{
      try {
        session=await pool.connect();
        const locked=(await session.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`sophie.ai.worker.${guildId}`])).rows[0].locked;
        requireCondition(locked,'AI_WORKER_OWNER_BUSY');
        owns=true;
        const lost=()=>{if(!stopped){fault();void stop().catch(fault);}};session.on('error',lost);session.on('end',lost);
        await drain(randomUUID());await journal.recovered();requireCondition(!stopped,'AI_RUNTIME_STOPPED');schedule();
      } catch {fault();if(session){session.release(true);session=null;}owns=false;stopped=true;throw Error('AI_WORKER_OPERATIONS_UNAVAILABLE');}
      })();return starting;
    },
    runOnce:tick,
    status(){return {started,stopped,applying:operation!==null,attached:runtime!==null};},
    stop,
  });
}
