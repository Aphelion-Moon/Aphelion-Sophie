import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const CASE_REPLY_ROUTES = Object.freeze({ '/api/cases/replies': 'GET', '/api/cases/replies/request': 'POST' });
export function createCaseRepliesHttp({ auth, authorization, replies }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_REPLY_ROUTES, path) && method === CASE_REPLY_ROUTES[path], 'CASE_REPLY_INPUT_INVALID');
    let request;
    if (method === 'POST') {
      requireCondition([...query].length === 0, 'CASE_REPLY_INPUT_INVALID');
      requireKeys(body, ['channelId','requestId','expectedVersion','text','confirmed', ...(body && Object.hasOwn(body, 'answer') ? ['answer'] : [])], 'CASE_REPLY_INPUT_INVALID');
      requireCondition(body.confirmed === true, 'CASE_REPLY_CONFIRMATION_REQUIRED');
      const { confirmed: _, ...fields } = body; request = fields;
    } else {
      const keys = [...query.keys()], beforeId = query.get('beforeId'), beforeAt = query.get('beforeAt');
      requireCondition(body === null && new Set(keys).size === keys.length && keys.includes('channelId') &&
        keys.every(key => ['channelId','beforeId','beforeAt'].includes(key)) && (beforeId === null) === (beforeAt === null) &&
        (beforeAt === null || /^(0|[1-9][0-9]{0,15})$/.test(beforeAt)), 'CASE_REPLY_INPUT_INVALID');
      request = { channelId: query.get('channelId'), before: beforeId === null ? null : { id: beforeId, createdAt: Number(beforeAt) } };
    }
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const result = await replies[method === 'POST' ? 'request' : 'read']({ ...request, actor });
    await auth.resolvePrincipal(proof); return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
