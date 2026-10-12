import { requireCondition } from '../../contracts/validation.js';
import { createKnowledgeLibrary } from './library.js';
import { createMediaWikiCollector } from './mediawiki.js';
import { createWikiExtractor } from './extraction.js';
import { createKnowledgeSynchronizer } from './synchronizer.js';
import { createSourceSync } from './source-sync.js';
import { createWikiCollector } from './sources/wiki.js';
import { createWebsiteCollector } from './sources/website.js';
import { createGithubCollector } from './sources/github.js';

/** Native-process composition. Inject a separately restricted DB identity and current host qualification. */
export function createKnowledgeRuntime({pool,guildId,authorize,restoreCurrent,qualified,fetchImpl=fetch,clock=Date.now,onFault=()=>{},invalidate=()=>{},syncSources=true}) {
  requireCondition(typeof qualified==='function','TRUSTED_ADAPTERS_REQUIRED');
  const ready=async()=>await qualified()===true && await restoreCurrent()===true;
  const library=createKnowledgeLibrary({pool,guildId,authorize,restoreCurrent:ready,clock,
    collector:createMediaWikiCollector({fetchImpl,clock}),extractor:createWikiExtractor(),invalidate,syncAuthorized:ready});
  // The public-source collections get their own parser so they never contend with a Policies refresh.
  const sourceExtractor=createWikiExtractor();
  const sources=syncSources?createSourceSync({mirror:library.mirror,clock,onFault,collectors:[
    createWikiCollector({fetchImpl,extractor:sourceExtractor,clock}),createWebsiteCollector({fetchImpl,extractor:sourceExtractor,clock}),createGithubCollector({fetchImpl,clock})]}):null;
  const synchronizer=createKnowledgeSynchronizer({library,qualified:ready,sources,onFault});
  const sourcesStatus=async({actor})=>{
    const published=await library.mirror.summary({actor});
    return {available:sources!==null,publishesAutomatically:sources!==null,published,runs:sources?.status() ?? {}};
  };
  return Object.freeze({
    publicKnowledge:Object.freeze({lookup:library.lookup,current:library.current,currentReferences:library.currentReferences}),
    editor:Object.freeze({...Object.fromEntries(['catalogue','read','review','publish','withdraw','markSourceStale','policiesStatus','policiesSnapshot','refreshPolicies'].map(key=>[key,library[key]])),
      sourcesStatus,
      async syncSources({actor}){const status=await sourcesStatus({actor});requireCondition(sources!==null,'KNOWLEDGE_IMPORT_UNAVAILABLE');sources.requestAll();return {...status,requested:true};}}),
    async start(){requireCondition(await ready(),'KNOWLEDGE_SYNC_UNQUALIFIED');synchronizer.start();},
    stop:synchronizer.stop,status:synchronizer.status,
  });
}
