import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const KNOWLEDGE_ROUTES = Object.freeze({ '/api/ai/knowledge': 'GET', '/api/ai/knowledge/document': 'GET',
  '/api/ai/knowledge/review': 'POST', '/api/ai/knowledge/publish': 'POST', '/api/ai/knowledge/withdraw': 'POST' });

/** Authenticated public-source editing through a narrow knowledge-service interface. No core store is passed to it. */
export function createAiKnowledgeHttp({ auth, authorization, knowledge, invalidate = () => {} }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(KNOWLEDGE_ROUTES[path] === method, 'KNOWLEDGE_INPUT_INVALID');
    let operation, fields;
    if (method === 'GET') {
      requireCondition(body === null, 'KNOWLEDGE_INPUT_INVALID');
      if (path.endsWith('/document')) { requireCondition([...query.keys()].length === 1 && query.has('id'), 'KNOWLEDGE_INPUT_INVALID'); operation = 'read'; fields = { id: query.get('id') }; }
      else { requireCondition([...query.keys()].length === 0, 'KNOWLEDGE_INPUT_INVALID'); operation = 'catalogue'; fields = {}; }
    } else {
      requireCondition([...query.keys()].length === 0, 'KNOWLEDGE_INPUT_INVALID'); operation = path.split('/').at(-1);
      const keys = { review: ['expectedEpoch','document'], publish: ['expectedEpoch','document','reviewHash','requestId','confirmed','approvedPublic'], withdraw: ['id','expectedEpoch','confirmed'] };
      requireKeys(body, keys[operation], 'KNOWLEDGE_INPUT_INVALID');
      if (operation !== 'review') requireCondition(body.confirmed === true, 'KNOWLEDGE_CONFIRMATION_REQUIRED');
      if (operation === 'publish') requireCondition(body.approvedPublic === true, 'KNOWLEDGE_CONFIRMATION_REQUIRED');
      fields = { ...body }; delete fields.approvedPublic;
      if (operation === 'withdraw') delete fields.confirmed;
    }
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    requireCondition(await authorization.authorize('ai.knowledge.publish',actor,{ guildId: actor.guildId }) === true, 'OPERATION_DENIED');
    let result;
    try { result = await knowledge[operation]({ ...fields, actor }); }
    finally { if (['publish', 'withdraw'].includes(operation)) invalidate(); }
    requireCondition(await authorization.authorize('ai.knowledge.publish',actor,{ guildId: actor.guildId }) === true, 'OPERATION_DENIED'); await auth.resolvePrincipal(proof);
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
