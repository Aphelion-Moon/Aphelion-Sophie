import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const CURATED_ANSWER_ROUTES = Object.freeze({ '/api/answers': 'GET', '/api/answers/lookup': 'GET',
  '/api/answers/history': 'GET', '/api/answers/review': 'POST', '/api/answers/change': 'POST' });
export function createCuratedAnswersHttp({ auth, authorization, answers }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CURATED_ANSWER_ROUTES, path) && method === CURATED_ANSWER_ROUTES[path], 'ANSWER_INPUT_INVALID');
    let operation, fields;
    if (method === 'POST') {
      requireCondition([...query].length === 0, 'ANSWER_INPUT_INVALID'); operation = path.endsWith('/review') ? 'review' : 'change';
      requireKeys(body, ['name','expectedRevision','action','document', ...(operation === 'change' ? ['requestId','reviewSha256','confirmed','approvedPublic'] : [])], 'ANSWER_INPUT_INVALID');
      fields = body;
    } else {
      const keys = [...query.keys()]; requireCondition(body === null && new Set(keys).size === keys.length, 'ANSWER_INPUT_INVALID');
      operation = path === '/api/answers' ? 'list' : path.endsWith('/lookup') ? 'lookup' : 'history';
      const allowed = operation === 'list' ? ['after'] : operation === 'lookup' ? ['name'] : ['name','before'];
      requireCondition(keys.every(key => allowed.includes(key)) && (operation === 'list' || keys.includes('name')), 'ANSWER_INPUT_INVALID');
      if (operation === 'list') fields = { after: query.get('after') };
      else {
        fields = { name: query.get('name') };
        if (operation === 'history') {
          const before = query.get('before'); requireCondition(before === null || /^[1-9][0-9]{0,9}$/.test(before), 'ANSWER_INPUT_INVALID');
          fields.before = before === null ? null : Number(before);
        }
      }
    }
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const result = await answers[operation]({ ...fields, actor }); await auth.resolvePrincipal(proof);
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
