import { randomUUID } from 'node:crypto';
import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../../modules/assistant/worker-release.js';
import { canonicalAiWorkerIdentity } from '../../knowledge-worker/ipc-contract.js';
import { aiDigest } from './ai-controls.js';
import { inTransaction } from './transaction.js';

const hash=value=>requireCondition(typeof value==='string' && /^[a-f0-9]{64}$/u.test(value),'AI_HASH_INVALID');
const HISTORY_LIMIT=1000;
const lock=client=>client.query('SELECT pg_advisory_xact_lock(182745,56)');
const view=row=>({desiredRevision:row?.desired_revision??0,activeRevision:row?.active_revision??null,
  acknowledged:row?.active_identity ? canonicalAiWorkerIdentity(row.active_identity) : null,
  phase:row?.phase??'stopped',observedAt:row?.updated_at?.toISOString()??null});
export function aiWorkerCatalogue(releases=[]) {
  requireCondition(Array.isArray(releases) && releases.length<=8,'AI_WORKER_RELEASE_INVALID');
  const entries=releases.map(value=>{const release=canonicalAiWorkerRelease(value);return Object.freeze({id:aiDigest(release),release});});
  requireCondition(new Set(entries.map(item=>item.id)).size===entries.length,'AI_WORKER_RELEASE_INVALID');return Object.freeze(entries);
}
async function initialize(client,guildId) {
  await client.query('INSERT INTO sophie_ai.worker_state(guild_id) VALUES($1) ON CONFLICT DO NOTHING',[guildId]);
  return (await client.query('SELECT * FROM sophie_ai.worker_state WHERE guild_id=$1 FOR UPDATE',[guildId])).rows[0];
}
async function queue(client,guildId,state,worker,{actorId,requestId,reviewSha256,action,release,budgetRevision}) {
  // Reserve one final stop intent so a full history can never strand a running worker.
  requireCondition(worker.desired_revision<HISTORY_LIMIT || action==='stop' && worker.desired_revision===HISTORY_LIMIT,'AI_WORKER_HISTORY_FULL');
  const revision=worker.desired_revision+1,epoch=Number(state.epoch)+1;
  await client.query(`INSERT INTO sophie_ai.worker_requests(guild_id,revision,request_id,actor_id,review_sha256,action,release,control_epoch,configuration_revision,personality_revision,budget_revision)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[guildId,revision,requestId,actorId,reviewSha256,action,release,epoch,state.configuration_revision,state.personality_revision,budgetRevision]);
  // Restrictions commit before any process work. An existing owner finishes/compensates before the next request can be claimed.
  await client.query("UPDATE sophie_ai.worker_state SET desired_revision=$2,phase=CASE WHEN owner IS NULL THEN 'pending' ELSE phase END,updated_at=clock_timestamp() WHERE guild_id=$1",[guildId,revision]);
  await client.query('UPDATE sophie_ai.state SET disabled=true,epoch=$2 WHERE guild_id=$1',[guildId,epoch]);
  return {revision,queued:true,disabled:true,duplicate:false};
}

/** Shared authenticated operator use cases; transaction performs current capability checks on both sides. */
export function createAiWorkerOperations({guildId,transaction,catalogue=[],available=false}) {
  // Exact lost-response retries cannot abort their own launch; uncertain writes still invalidate.
  const mutate=(actor,work)=>transaction(actor,'ai.control',work,{},result=>result?.duplicate!==true);
  async function review(client,state,candidateId,expectedRevision) {
    hash(candidateId);requireInteger(expectedRevision,0,1000);
    requireCondition(available,'AI_WORKER_OPERATIONS_UNAVAILABLE');
    const release=catalogue.find(item=>item.id===candidateId)?.release;
    requireCondition(release,'AI_WORKER_RELEASE_UNAVAILABLE');
    const worker=await initialize(client,guildId);requireCondition(worker.desired_revision===expectedRevision,'AI_WORKER_OPERATION_STALE');
    requireCondition(worker.desired_revision<HISTORY_LIMIT,'AI_WORKER_HISTORY_FULL');
    const budget=(await client.query('SELECT revision FROM sophie_ai.budget_policies WHERE guild_id=$1',[guildId])).rows[0];
    requireCondition(state.configuration_revision>0 && state.personality_revision>0 && budget,'AI_PUBLICATION_REQUIRED');
    return {candidateId,expectedRevision,release,controlEpoch:Number(state.epoch),configurationRevision:state.configuration_revision,
      personalityRevision:state.personality_revision,budgetRevision:budget.revision};
  }
  return Object.freeze({
    workerStatus:({actor})=>transaction(actor,'ai.control',async(client,state)=>{
      const row=(await client.query('SELECT * FROM sophie_ai.worker_state WHERE guild_id=$1',[guildId])).rows[0];
      const request=row?.desired_revision ? (await client.query('SELECT action,release,configuration_revision,personality_revision,budget_revision FROM sophie_ai.worker_requests WHERE guild_id=$1 AND revision=$2',[guildId,row.desired_revision])).rows[0] : null;
      return {...view(row),available,historyFull:(row?.desired_revision??0)>=HISTORY_LIMIT,disabled:state.disabled,candidates:catalogue,desired:request,activation:'separate-qualification-required'};
    }),
    reviewWorker:({actor,candidateId,expectedRevision})=>transaction(actor,'ai.control',async(client,state)=>{
      const candidate=await review(client,state,candidateId,expectedRevision);return {...candidate,reviewSha256:aiDigest(candidate)};
    }),
    async applyWorker({actor,candidateId,expectedRevision,requestId,reviewSha256,confirmed}) {
      hash(requestId);hash(reviewSha256);hash(candidateId);requireCondition(confirmed===true,'AI_CONFIRMATION_REQUIRED');
      return mutate(actor,async(client,state)=>{
        const previous=(await client.query('SELECT * FROM sophie_ai.worker_requests WHERE guild_id=$1 AND request_id=$2',[guildId,requestId])).rows[0];
        if(previous){requireCondition(previous.actor_id===actor.userId && previous.review_sha256===reviewSha256 && previous.action==='apply' &&
          aiDigest(canonicalAiWorkerRelease(previous.release))===candidateId && previous.revision===expectedRevision+1,'AI_REQUEST_COLLISION');
          return {revision:previous.revision,queued:true,disabled:state.disabled,duplicate:true};}
        const candidate=await review(client,state,candidateId,expectedRevision);requireCondition(aiDigest(candidate)===reviewSha256,'AI_REVIEW_STALE');
        return queue(client,guildId,state,await initialize(client,guildId),{actorId:actor.userId,requestId,reviewSha256,action:'apply',release:candidate.release,budgetRevision:candidate.budgetRevision});
      });
    },
    async stopWorker({actor,requestId}) {
      hash(requestId);
      return mutate(actor,async(client,state)=>{
        const previous=(await client.query('SELECT * FROM sophie_ai.worker_requests WHERE guild_id=$1 AND request_id=$2',[guildId,requestId])).rows[0];
        if(previous){requireCondition(previous.actor_id===actor.userId && previous.action==='stop','AI_REQUEST_COLLISION');return {revision:previous.revision,queued:true,disabled:state.disabled,duplicate:true};}
        const worker=await initialize(client,guildId);
        if(worker.desired_revision===HISTORY_LIMIT+1){
          const terminal=(await client.query('SELECT action FROM sophie_ai.worker_requests WHERE guild_id=$1 AND revision=$2',[guildId,worker.desired_revision])).rows[0];
          requireCondition(terminal?.action==='stop','AI_WORKER_OPERATION_CORRUPT');
          // No apply can follow this terminal intent. Re-arm failed quiescence without growing history or replaying inference.
          await client.query("UPDATE sophie_ai.worker_state SET phase=CASE WHEN owner IS NULL AND phase='failed' THEN 'pending' ELSE phase END,updated_at=clock_timestamp() WHERE guild_id=$1",[guildId]);
          await client.query('UPDATE sophie_ai.state SET disabled=true,epoch=epoch+1 WHERE guild_id=$1 AND NOT disabled',[guildId]);
          return {revision:worker.desired_revision,queued:true,disabled:true,duplicate:false,coalesced:true};
        }
        return queue(client,guildId,state,worker,{actorId:actor.userId,requestId,reviewSha256:aiDigest(['stop',requestId]),action:'stop',release:null,budgetRevision:0});
      });
    },
  });
}

/** Trusted runtime journal. Every transition is fenced; no external work happens in a database transaction. */
export function createAiWorkerJournal({pool,guildId}) {
  requireId(guildId);
  const transaction=work=>inTransaction(pool,async client=>{await lock(client);return work(client);});
  const owned=(client,token)=>client.query('SELECT * FROM sophie_ai.worker_state WHERE guild_id=$1 AND owner=$2 AND fence=$3 FOR UPDATE',[guildId,token.owner,token.fence]);
  return Object.freeze({
    async read(){return (await pool.query('SELECT * FROM sophie_ai.worker_state WHERE guild_id=$1',[guildId])).rows[0]??null;},
    async claim(owner) {
      return transaction(async client=>{
        const row=(await client.query('SELECT * FROM sophie_ai.worker_state WHERE guild_id=$1 FOR UPDATE',[guildId])).rows[0];
        if(!row || row.phase!=='pending' || row.owner)return null;
        const request=(await client.query('SELECT * FROM sophie_ai.worker_requests WHERE guild_id=$1 AND revision=$2',[guildId,row.desired_revision])).rows[0];
        requireCondition(request,'AI_WORKER_OPERATION_CORRUPT');const fence=randomUUID();
        await client.query("UPDATE sophie_ai.worker_state SET owner=$2,fence=$3,phase='draining',updated_at=clock_timestamp() WHERE guild_id=$1",[guildId,owner,fence]);
        return {...request,owner,fence,activeIdentity:row.active_identity};
      });
    },
    async current(token) {
      const result=await pool.query(`SELECT 1 FROM sophie_ai.worker_state w JOIN sophie_ai.state s USING(guild_id)
        WHERE w.guild_id=$1 AND w.owner=$2 AND w.fence=$3 AND w.desired_revision=$4 AND s.epoch=$5 AND s.disabled`,[guildId,token.owner,token.fence,token.revision,token.control_epoch]);
      return result.rowCount===1;
    },
    async transition(token,phase,identity=null) {
      requireCondition(['starting','ready','stopped','failed'].includes(phase),'AI_WORKER_PHASE_INVALID');
      if(phase==='ready')identity=canonicalAiWorkerIdentity(identity);else requireCondition(identity===null,'AI_WORKER_PHASE_INVALID');
      return transaction(async client=>{
        const row=(await owned(client,token)).rows[0];if(!row)return false;
        if(phase==='ready'){
          const state=(await client.query('SELECT epoch,disabled FROM sophie_ai.state WHERE guild_id=$1',[guildId])).rows[0];
          requireCondition(row.phase==='starting' && row.desired_revision===token.revision && Number(state.epoch)===Number(token.control_epoch) && state.disabled,'AI_WORKER_OPERATION_STALE');
          const release=canonicalAiWorkerRelease(token.release);
          requireCondition(['workerId','releaseHash','profileHash','provider','domain'].every(key=>release[key]===identity[key]),'AI_WORKER_ACK_MISMATCH');
        }
        const terminal=phase!=='starting',next=row.desired_revision!==token.revision && terminal ? 'pending' : phase;
        await client.query(`UPDATE sophie_ai.worker_state SET phase=$2,
          active_revision=CASE WHEN $3='ready' THEN $4 WHEN $3 IN ('starting','stopped') THEN NULL ELSE active_revision END,
          active_identity=CASE WHEN $3='ready' THEN $5 WHEN $3 IN ('starting','stopped') THEN NULL ELSE active_identity END,
          owner=CASE WHEN $6 THEN NULL ELSE owner END,fence=CASE WHEN $6 THEN NULL ELSE fence END,updated_at=clock_timestamp() WHERE guild_id=$1`,
        [guildId,next,phase,token.revision,identity,terminal]);return true;
      });
    },
    async recovered() {
      return transaction(async client=>{
        const row=(await client.query('SELECT * FROM sophie_ai.worker_state WHERE guild_id=$1 FOR UPDATE',[guildId])).rows[0];
        if(!row)return;
        // Called only after the registered lifecycle adapter positively confirms physical quiescence.
        await client.query("UPDATE sophie_ai.worker_state SET owner=NULL,fence=NULL,active_revision=NULL,active_identity=NULL,phase=CASE WHEN desired_revision=0 THEN 'stopped' WHEN phase='pending' AND owner IS NULL THEN 'pending' ELSE 'failed' END,updated_at=clock_timestamp() WHERE guild_id=$1",[guildId]);
        await client.query('UPDATE sophie_ai.state SET disabled=true,epoch=epoch+1 WHERE guild_id=$1 AND NOT disabled',[guildId]);
      });
    },
  });
}
