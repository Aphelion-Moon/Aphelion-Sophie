import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const CASE_LABEL_ROUTES = Object.freeze({ '/api/cases/labels': 'GET', '/api/cases/labels/save': 'POST' });
export function createCaseLabelsHttp({ auth, authorization, labels }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_LABEL_ROUTES, path) && method === CASE_LABEL_ROUTES[path], 'CASE_LABEL_INPUT_INVALID');
    let request;
    if (method === 'POST') {
      requireCondition([...query].length === 0, 'CASE_LABEL_INPUT_INVALID');
      requireKeys(body, ['channelId', 'requestId', 'expectedVersion', 'priority', 'tags'], 'CASE_LABEL_INPUT_INVALID'); request = body;
    } else {
      const keys = [...query.keys()], before = query.get('before');
      requireCondition(body === null && new Set(keys).size === keys.length && keys.includes('channelId') &&
        keys.every(key => ['channelId', 'before'].includes(key)) && (before === null || /^[1-9][0-9]{0,9}$/.test(before)), 'CASE_LABEL_INPUT_INVALID');
      request = { channelId: query.get('channelId'), before: before === null ? null : Number(before) };
    }
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const result = await labels[method === 'POST' ? 'changeCaseLabels' : 'readCaseLabels']({ ...request, actor });
    await auth.resolvePrincipal(proof); return result;
  } });
}
