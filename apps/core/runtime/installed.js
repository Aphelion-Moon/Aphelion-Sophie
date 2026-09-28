import { requireCondition, requireKeys } from '../../../contracts/validation.js';
import { createDatabasePool } from '../storage/pool.js';
import { createStagingRuntime } from './staging.js';
import { createConfigurableStagingRuntime } from './configurable-staging.js';
import { requireStagingDatabase, requireStagingOwnerDatabase, checkRuntimeDatabase } from './database.js';
import { requireUnquarantinedDatabase } from './recovery.js';
import { createKnowledgeLibrary } from '../../knowledge/library.js';
import { installedRoleContext } from '../../installation/context.js';
import { createInstalledCoreLifecycle } from './installed-lifecycle.js';

export async function requireInstalledAiDatabase(pool,kind) {
  requireCondition(['control','knowledge'].includes(kind),'AI_DATABASE_IDENTITY_INVALID');
  await requireUnquarantinedDatabase(pool);
  const row=(await pool.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_schema_privilege(current_user,'sophie_core','USAGE') AS core,
    has_schema_privilege(current_user,'sophie_ai','USAGE') AS ai,
    has_schema_privilege(current_user,'sophie_knowledge','USAGE') AS knowledge
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  requireCondition(row && ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','core'].every(name=>row[name]===false) &&
    (kind==='knowledge'?row.knowledge===true && row.ai===false:row.ai===true && row.knowledge===false),'AI_DATABASE_IDENTITY_INVALID');
  const privileges=(await pool.query(`SELECT
    has_schema_privilege(current_user,'sophie_knowledge','CREATE') OR has_schema_privilege(current_user,'sophie_ai','CREATE') AS schema_create,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='sophie_knowledge' AND c.relkind IN ('r','p','v','m','f','S') AND
        (pg_has_role(c.relowner,'USAGE') OR
        CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE') OR has_sequence_privilege(c.oid,'UPDATE')
        ELSE has_table_privilege(c.oid,'INSERT') OR has_table_privilege(c.oid,'UPDATE') OR
         has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR
         has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER') END)) AS knowledge_write`)).rows[0];
  requireCondition(privileges?.schema_create===false && privileges.knowledge_write===false,'AI_DATABASE_IDENTITY_INVALID');
}

/** Core reads public knowledge through a restricted database identity. Ingestion/publication stays outside this entrypoint. */
export async function createInstalledCoreService({pipes,signal,onFault,createPool=createDatabasePool,runtimeFactory=createStagingRuntime,
  configurableFactory=createConfigurableStagingRuntime,fetchImpl=fetch,connect=url=>new WebSocket(url)}) {
  const {configuration,qualified,keys}=installedRoleContext(pipes,'core',signal);Object.values(keys).forEach(key=>key.fill(0));
  const options=configuration.core;
  requireKeys(options,['runtime','database','ownerDatabase','controlDatabase','knowledgeDatabase','credentials'],'AI_INSTALLATION_INVALID');
  requireKeys(options.credentials,['token','clientSecret'],'AI_INSTALLATION_INVALID');
  const databases=[options.database,options.controlDatabase,options.knowledgeDatabase];
  for(const database of databases){requireStagingDatabase(database);requireCondition(database.host===options.database.host &&
    database.port===options.database.port && database.database===options.database.database,'AI_DATABASE_IDENTITY_INVALID');}
  requireCondition(new Set(databases.map(database=>database.user)).size===3,'AI_DATABASE_IDENTITY_INVALID');
  if(options.ownerDatabase){requireStagingOwnerDatabase(options.database,options.ownerDatabase);
    requireCondition(!databases.some(database=>database.user===options.ownerDatabase.user),'AI_DATABASE_IDENTITY_INVALID');}
  const pools=[];let runtime,closing;
  const stop=()=>closing??=(async()=>{
    let failure;try{await runtime?.stop();}catch(error){failure=error;}
    const results=await Promise.allSettled(pools.map(pool=>pool.end()));
    requireCondition(!failure && results.every(result=>result.status==='fulfilled'),'AI_CORE_STOP_UNCONFIRMED');
  })();
  try {
    requireCondition(await qualified(),'AI_INSTALLATION_UNQUALIFIED');
    const pool=add(options.database),controlPool=add(options.controlDatabase),knowledgePool=add(options.knowledgeDatabase);
    const ownerPool=options.ownerDatabase?add(options.ownerDatabase):null;
    function add(database){const value=createPool(database,onFault);pools.push(value);return value;}
    if(!ownerPool)await checkRuntimeDatabase(pool);
    await requireInstalledAiDatabase(controlPool,'control');await requireInstalledAiDatabase(knowledgePool,'knowledge');
    const library=createKnowledgeLibrary({pool:knowledgePool,guildId:options.runtime.mapping.guildId,authorize:async()=>false,clock:Date.now,
      restoreCurrent:async()=>{if(!await qualified())return false;await requireUnquarantinedDatabase(knowledgePool);return true;}});
    const aiKnowledge=Object.freeze({lookup:library.lookup,current:library.current,currentReferences:library.currentReferences});
    // Configuration Apply destroys its old AI owner and constructs a fresh one.
    // A stopped control client/boot must never be reused by the replacement runtime.
    const compose=async input=>{
      const lifecycle=createInstalledCoreLifecycle({pipes,signal,onFault});let instance,closed;
      try {instance=await runtimeFactory({...input,aiControlPool:controlPool,aiKnowledge,aiLifecycle:lifecycle});}
      catch(error){await lifecycle.stop().catch(()=>{});throw error;}
      return Object.freeze({...instance,stop:()=>closed??=(async()=>{try{await instance.stop();}finally{await lifecycle.stop();}})()});
    };
    const input={configuration:options.runtime,pool,...options.credentials,fetch:fetchImpl,connect,onFault};
    runtime=ownerPool?await configurableFactory({...input,ownerPool,runtimeFactory:compose}):await compose(input);
    return Object.freeze({start:()=>runtime.start(),status:()=>runtime.status(),stop});
  } catch(error){await stop().catch(()=>{});throw error;}
}
