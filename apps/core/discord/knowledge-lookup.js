import { ContractError,requireCondition } from '../../../contracts/validation.js';
import { createKnowledgeLookup } from '../runtime/knowledge-lookup.js';

/** Signed one-use query; fixed private response. Excluded channel checks precede query consumption. */
export function createKnowledgeLookupCommands({authorization,verifier,knowledge,inspectChannel,guildId,enabled,clock}) {
  const lookup=createKnowledgeLookup({authorization,knowledge,clock}),views=new WeakMap();
  async function actorFor(envelope) {
    requireCondition(envelope.guildId===guildId && envelope.command==='knowledge.lookup' && envelope.targetId===envelope.userId,'OPERATION_DENIED');
    const actor=await authorization.resolveActor(envelope);
    requireCondition(await authorization.authorize('answers.read',actor,{guildId})===true && await inspectChannel(envelope.channelId)!==null,'OPERATION_DENIED');
    return actor;
  }
  return Object.freeze({
    async execute(envelope) {
      if(await enabled()!==true)return 'disabled';
      try {await actorFor(envelope);return 'knowledge_lookup';}catch{return 'denied';}
    },
    async view(envelope) {
      try {
        requireCondition(await enabled()===true,'DISCORD_TRANSPORT_DISABLED');const actor=await actorFor(envelope);
        const result=await lookup.execute({actor,query:verifier.takeLookupQuery(envelope),current:async()=>{
          await authorization.resolveActor(envelope);return await enabled()===true && await inspectChannel(envelope.channelId)!==null;
        }});
        const view={status:'available',sources:result.sources};views.set(view,result);return view;
      } catch(error) {return {status:error instanceof ContractError && ['OPERATION_DENIED','UNTRUSTED_PRINCIPAL','MEMBER_ABSENT','CAPABILITY_REVOKED'].includes(error.code)?'denied':'unavailable'};}
    },
    async current(view) {return view.status!=='available' || await lookup.current(views.get(view));},
  });
}
