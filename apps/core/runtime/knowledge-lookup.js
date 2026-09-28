import { requireCondition } from '../../../contracts/validation.js';
import { requireLookupQuery,presentLookupSource } from '../../../modules/assistant/lookup.js';

/** Shared direct lookup. Current public sources and member authority; no model or query archive. */
export function createKnowledgeLookup({authorization,knowledge,clock}) {
  const prepared=new WeakMap();
  async function valid(actor,request,sources,current) {
    requireCondition(await authorization.authorize('answers.read',actor,{guildId:actor.guildId})===true && await current()===true,'OPERATION_DENIED');
    requireCondition(await knowledge.current(sources,request)===true && clock()<request.deadline,'KNOWLEDGE_SOURCE_STALE');
  }
  return Object.freeze({async execute({actor,query,current=async()=>true}) {
    const value=requireLookupQuery(query),request={guildId:actor.guildId,deadline:clock()+10000};
    const allowed=()=>authorization.authorize('answers.read',actor,{guildId:actor.guildId});
    requireCondition(await allowed()===true && await current()===true,'OPERATION_DENIED');
    const sources=await knowledge.lookup(value,request);
    requireCondition(Array.isArray(sources) && sources.length<=4,'KNOWLEDGE_RESULT_INVALID');
    await valid(actor,request,sources,current);
    const result={actorId:actor.userId,guildId:actor.guildId,sources:sources.map(presentLookupSource)};
    prepared.set(result,{actor,request,sources,current});return result;
  },async current(result) {
    const value=prepared.get(result);requireCondition(value,'KNOWLEDGE_RESULT_INVALID');
    await valid(value.actor,value.request,value.sources,value.current);return true;
  }});
}
