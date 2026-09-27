import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const CASE_NOTE_ROUTES = Object.freeze({ '/api/cases/notes': 'GET', '/api/cases/notes/append': 'POST' });
export function createCaseNotesHttp({ auth, authorization, notes }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_NOTE_ROUTES, path) && method === CASE_NOTE_ROUTES[path], 'CASE_NOTE_INPUT_INVALID');
    let request;
    if (method === 'POST') {
      requireCondition([...query].length === 0, 'CASE_NOTE_INPUT_INVALID');
      requireKeys(body, ['channelId', 'requestId', 'text'], 'CASE_NOTE_INPUT_INVALID'); request = body;
    } else {
      const keys = [...query.keys()];
      requireCondition(body === null && new Set(keys).size === keys.length && keys.includes('channelId') &&
        keys.every(key => ['channelId', 'before'].includes(key)), 'CASE_NOTE_INPUT_INVALID');
      const before = query.get('before'); requireCondition(before === null || /^[1-9][0-9]{0,9}$/.test(before), 'CASE_NOTE_INPUT_INVALID');
      request = { channelId: query.get('channelId'), before: before === null ? null : Number(before) };
    }
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const result = await notes[method === 'POST' ? 'append' : 'read']({ ...request, actor });
    await auth.resolvePrincipal(proof); return result;
  } });
}
