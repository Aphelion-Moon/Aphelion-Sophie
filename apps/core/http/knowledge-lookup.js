import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const KNOWLEDGE_LOOKUP_ROUTES = Object.freeze({ '/api/knowledge/lookup': 'POST' });

/** Public published sources only. No inference adapter, conversational admission or case store. */
export function createKnowledgeLookupHttp({ auth, authorization, knowledge, clock }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(path === '/api/knowledge/lookup' && method === 'POST' && [...query].length === 0, 'KNOWLEDGE_INPUT_INVALID');
    requireKeys(body, ['query'], 'KNOWLEDGE_INPUT_INVALID');
    requireCondition(typeof body.query === 'string' && body.query.trim().length > 0 && body.query.length <= 200 &&
      body.query.isWellFormed() && !/[\x00-\x1f\x7f]/.test(body.query), 'KNOWLEDGE_INPUT_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const request = { guildId: actor.guildId, deadline: clock() + 10000 };
    const allowed = () => authorization.authorize('answers.read', actor, { guildId: actor.guildId });
    requireCondition(await allowed() === true, 'OPERATION_DENIED');
    const sources = await knowledge.lookup(body.query.trim(), request);
    requireCondition(Array.isArray(sources) && sources.length <= 4, 'KNOWLEDGE_RESULT_INVALID');
    requireCondition(await allowed() === true, 'OPERATION_DENIED');
    await auth.resolvePrincipal(proof);
    requireCondition(await knowledge.current(sources, request) === true && clock() < request.deadline, 'KNOWLEDGE_SOURCE_STALE');
    // Expose reviewed presentation fields, never publication internals or editorial history.
    const fields = ['id','title','heading','text','url','authority','rights','attribution','sourceRevision','validUntil'];
    return { actorId: actor.userId, guildId: actor.guildId,
      sources: sources.map(source => Object.fromEntries(fields.map(field => [field, source[field]]))) };
  } });
}
