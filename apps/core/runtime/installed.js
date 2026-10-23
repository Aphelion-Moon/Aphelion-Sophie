import { requireCondition, requireKeys } from '../../../contracts/validation.js';
import { installationHash } from '../../installation/configuration.js';
import { createDatabasePool } from '../storage/pool.js';
import { createStagingRuntime } from './staging.js';
import { createConfigurableStagingRuntime } from './configurable-staging.js';
import { requireStagingDatabase, requireStagingOwnerDatabase, checkRuntimeDatabase } from './database.js';
import { requireUnquarantinedDatabase } from './recovery.js';
import { createKnowledgeLibrary } from '../../knowledge/library.js';
import { installedRoleContext } from '../../installation/context.js';
import { createInstalledAiWorker } from './installed-worker.js';
import { createProcessingApproval } from '../../../modules/assistant/processing-policy.js';
import { createPreferenceJournal } from '../storage/preference-journal.js';
import { createKnowledgeRuntime } from '../../knowledge/runtime.js';
import { requireGithubToken } from '../../knowledge/sources/github.js';

export const INSTALLED_PREFERENCE_JOURNAL = 'C:\\Aphelion\\Sophie\\preferences\\watermarks.jsonl';

export async function requireInstalledAiDatabase(pool,kind) {
  requireCondition(['control','knowledge','knowledge-owner'].includes(kind),'AI_DATABASE_IDENTITY_INVALID');
  await requireUnquarantinedDatabase(pool);
  const row=(await pool.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    has_schema_privilege(current_user,'sophie_core','USAGE') AS core,
    has_schema_privilege(current_user,'sophie_ai','USAGE') AS ai,
    has_schema_privilege(current_user,'sophie_knowledge','USAGE') AS knowledge
    FROM pg_roles WHERE rolname=current_user`)).rows[0];
  requireCondition(row && ['rolsuper','rolcreatedb','rolcreaterole','rolreplication','rolbypassrls','core'].every(name=>row[name]===false) &&
    (kind.startsWith('knowledge')?row.knowledge===true && row.ai===false:row.ai===true && row.knowledge===false),'AI_DATABASE_IDENTITY_INVALID');
  const privileges=(await pool.query(`SELECT
    has_schema_privilege(current_user,'sophie_knowledge','CREATE') OR has_schema_privilege(current_user,'sophie_ai','CREATE') AS schema_create,
    EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='sophie_knowledge' AND c.relkind IN ('r','p','v','m','f','S') AND
        (pg_has_role(c.relowner,'USAGE') OR
        CASE WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE') OR has_sequence_privilege(c.oid,'UPDATE')
        ELSE has_table_privilege(c.oid,'INSERT') OR has_table_privilege(c.oid,'UPDATE') OR
         has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR
         has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER') END)) AS knowledge_write`)).rows[0];
  requireCondition(privileges?.schema_create===false && privileges.knowledge_write===(kind==='knowledge-owner'),'AI_DATABASE_IDENTITY_INVALID');
  if(kind==='control') {
    // Schema066 migration and its operator-owned grants are separate steps. Fail before admission/cleanup.
    const access=(await pool.query(`SELECT bool_and(has_table_privilege(current_user,table_name,privilege)) AS privacy_access
      FROM (VALUES ('sophie_ai.request_tombstones','SELECT'),('sophie_ai.request_tombstones','INSERT'),
        ('sophie_ai.effect_erasure','SELECT'),('sophie_ai.effect_erasure','INSERT'),('sophie_ai.effect_erasure','DELETE'),
        ('sophie_ai.consents','DELETE'),('sophie_ai.request_receipts','DELETE'),
        -- Schema073: Sophie's own memories; preference saves re-stamp them even while memory is off.
        ('sophie_ai.memories','SELECT'),('sophie_ai.memories','INSERT'),('sophie_ai.memories','UPDATE'),('sophie_ai.memories','DELETE'),
        ('sophie_ai.memory_optouts','SELECT'),('sophie_ai.memory_optouts','INSERT'),('sophie_ai.memory_optouts','DELETE'),
        -- Schema076: one server-wide choice per member and the daily invitation limit.
        ('sophie_ai.member_consents','SELECT'),('sophie_ai.member_consents','INSERT'),('sophie_ai.member_consents','UPDATE'),('sophie_ai.member_consents','DELETE'),
        ('sophie_ai.consent_invitations','SELECT'),('sophie_ai.consent_invitations','INSERT'),('sophie_ai.consent_invitations','UPDATE'),
        ('sophie_ai.consent_invitations','DELETE')) required(table_name,privilege)`)).rows[0];
    requireCondition(access?.privacy_access===true,'AI_DATABASE_PRIVILEGES_MISSING');
  }
}

/** Public lookup and optional administration use distinct knowledge-only database identities. */
export async function createInstalledCoreService({pipes,signal,onFault,onTrace=()=>{},createPool=createDatabasePool,runtimeFactory=createStagingRuntime,
  configurableFactory=createConfigurableStagingRuntime,fetchImpl=fetch,connect=url=>new WebSocket(url)}) {
  const {configuration,qualified,keys}=installedRoleContext(pipes,'core',signal);Object.values(keys).forEach(key=>key.fill(0));
  const options=configuration.core;
  requireKeys(options,['runtime','database','ownerDatabase','controlDatabase','knowledgeDatabase','credentials',
    ...['processingPolicy','preferenceJournal','knowledgeOwnerDatabase'].filter(key=>Object.hasOwn(options,key))],'AI_INSTALLATION_INVALID');
  // githubToken (optional; owner-supplied 23 October 2026): a read-only token that lifts GitHub's anonymous rate limit for the
  // repository sync and code search. Only core reads it; it is sent only to api.github.com.
  requireKeys(options.credentials,['token','clientSecret',...(Object.hasOwn(options.credentials,'githubToken')?['githubToken']:[])],'AI_INSTALLATION_INVALID');
  const githubToken=requireGithubToken(options.credentials.githubToken??null);
  const databases=[options.database,options.controlDatabase,options.knowledgeDatabase,...(options.knowledgeOwnerDatabase?[options.knowledgeOwnerDatabase]:[])];
  for(const database of databases){requireStagingDatabase(database);requireCondition(database.host===options.database.host &&
    database.port===options.database.port && database.database===options.database.database,'AI_DATABASE_IDENTITY_INVALID');}
  requireCondition(new Set(databases.map(database=>database.user)).size===databases.length,'AI_DATABASE_IDENTITY_INVALID');
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
    const knowledgeOwnerPool=options.knowledgeOwnerDatabase?add(options.knowledgeOwnerDatabase):null;
    function add(database){const value=createPool(database,onFault);pools.push(value);return value;}
    if(!ownerPool)await checkRuntimeDatabase(pool);
    await requireInstalledAiDatabase(controlPool,'control');await requireInstalledAiDatabase(knowledgePool,'knowledge');
    if(knowledgeOwnerPool)await requireInstalledAiDatabase(knowledgeOwnerPool,'knowledge-owner');
    const restoreCurrent=async()=>{if(!await qualified())return false;await requireUnquarantinedDatabase(controlPool);return true;};
    const aiApproval=createProcessingApproval({policy:options.processingPolicy??null,qualified:restoreCurrent,digest:installationHash});
    let aiPreferenceJournal=null;
    if(options.preferenceJournal){
      const receipt=options.preferenceJournal;
      // An install-time receipt binds the journal to its evidence. It no longer expires daily (owner decision, 12 October 2026);
      // a legacy expiresAt field is accepted and ignored.
      requireKeys(receipt,['id','evidenceHash',...(Object.hasOwn(receipt,'expiresAt')?['expiresAt']:[])],'AI_PREFERENCE_JOURNAL_INVALID');
      requireCondition(/^[a-f0-9]{64}$/u.test(receipt.evidenceHash) && receipt.evidenceHash!=='0'.repeat(64),'AI_PREFERENCE_JOURNAL_INVALID');
      aiPreferenceJournal=createPreferenceJournal({path:INSTALLED_PREFERENCE_JOURNAL,id:receipt.id,qualified:restoreCurrent});
    }
    const library=createKnowledgeLibrary({pool:knowledgePool,guildId:options.runtime.mapping.guildId,authorize:async()=>false,clock:Date.now,
      restoreCurrent:async()=>{if(!await qualified())return false;await requireUnquarantinedDatabase(knowledgePool);return true;}});
    const aiKnowledge=Object.freeze({lookup:library.lookup,current:library.current,currentReferences:library.currentReferences});
    // Configuration Apply destroys its old AI owner and constructs a fresh one with its own worker connection;
    // a stopped connection must never be reused by the replacement runtime.
    const compose=async input=>{
      const worker=createInstalledAiWorker({pipes,signal});let instance,closed;
      try {instance=await runtimeFactory({...input,aiControlPool:controlPool,aiKnowledge,aiWorker:worker,aiApproval,aiPreferenceJournal,
        aiActivationPool:ownerPool,aiRestoreCurrent:restoreCurrent,aiGithubToken:githubToken,
        aiKnowledgeAdminFactory:knowledgeOwnerPool===null?null:({authorize,invalidate})=>createKnowledgeRuntime({pool:knowledgeOwnerPool,
          guildId:input.configuration.mapping.guildId,authorize,qualified,restoreCurrent:async()=>{await requireUnquarantinedDatabase(knowledgeOwnerPool);return true;},
          fetchImpl,invalidate,onFault,githubToken})});}
      catch(error){await Promise.resolve().then(()=>worker.stop()).catch(()=>{});throw error;}
      return Object.freeze({...instance,stop:()=>closed??=(async()=>{try{await instance.stop();}finally{await worker.stop();}})()});
    };
    const input={configuration:options.runtime,pool,...options.credentials,fetch:fetchImpl,connect,onFault,onTrace};
    runtime=ownerPool?await configurableFactory({...input,ownerPool,runtimeFactory:compose}):await compose(input);
    return Object.freeze({start:()=>runtime.start(),status:()=>runtime.status(),stop});
  } catch(error){await stop().catch(()=>{});throw error;}
}
