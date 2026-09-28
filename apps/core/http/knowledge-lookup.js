import { requireCondition, requireKeys } from '../../../contracts/validation.js';
import { createKnowledgeLookup } from '../runtime/knowledge-lookup.js';
import { requireLookupQuery } from '../../../modules/assistant/lookup.js';

export const KNOWLEDGE_LOOKUP_ROUTES = Object.freeze({ '/api/knowledge/lookup': 'POST' });

/** Public published sources only. No inference adapter, conversational admission or case store. */
export function createKnowledgeLookupHttp({ auth, authorization, knowledge, clock }) {
  const lookup=createKnowledgeLookup({authorization,knowledge,clock});
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(path === '/api/knowledge/lookup' && method === 'POST' && [...query].length === 0, 'KNOWLEDGE_INPUT_INVALID');
    requireKeys(body, ['query'], 'KNOWLEDGE_INPUT_INVALID');
    requireLookupQuery(body.query);
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    return lookup.execute({actor,query:body.query,current:async()=>{await auth.resolvePrincipal(proof);return true;}});
  } });
}
