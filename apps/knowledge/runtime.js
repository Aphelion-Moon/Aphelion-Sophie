import { requireCondition } from '../../contracts/validation.js';
import { createKnowledgeLibrary } from './library.js';
import { createMediaWikiCollector } from './mediawiki.js';
import { createWikiExtractor } from './extraction.js';
import { createKnowledgeSynchronizer } from './synchronizer.js';

/** Native-process composition. Inject a separately restricted DB identity and current host qualification. */
export function createKnowledgeRuntime({pool,guildId,authorize,restoreCurrent,qualified,fetchImpl=fetch,clock=Date.now,onFault=()=>{},invalidate=()=>{}}) {
  requireCondition(typeof qualified==='function','TRUSTED_ADAPTERS_REQUIRED');
  const ready=async()=>await qualified()===true && await restoreCurrent()===true;
  const library=createKnowledgeLibrary({pool,guildId,authorize,restoreCurrent:ready,clock,
    collector:createMediaWikiCollector({fetchImpl,clock}),extractor:createWikiExtractor(),invalidate,syncAuthorized:ready});
  const synchronizer=createKnowledgeSynchronizer({library,qualified:ready,onFault});
  return Object.freeze({
    publicKnowledge:Object.freeze({lookup:library.lookup,current:library.current,currentReferences:library.currentReferences}),
    editor:Object.freeze(Object.fromEntries(['catalogue','read','review','publish','withdraw','markSourceStale','policiesStatus','policiesSnapshot','refreshPolicies'].map(key=>[key,library[key]]))),
    async start(){requireCondition(await ready(),'KNOWLEDGE_SYNC_UNQUALIFIED');synchronizer.start();},
    stop:synchronizer.stop,status:synchronizer.status,
  });
}
