import { requireCondition } from '../../../contracts/validation.js';
export const SYSTEM_WORDING_ROUTES = Object.freeze({ '/api/system-wording': 'GET', '/api/system-wording/save': 'POST' });
export function createSystemWordingHttp({ auth, authorization, store }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(SYSTEM_WORDING_ROUTES[path] === method && [...query.keys()].length === 0, 'SYSTEM_WORDING_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    if (method === 'GET') { requireCondition(body === null, 'SYSTEM_WORDING_INVALID'); return store.read({ actor }); }
    // Never accept actor or authority fields from browser data.
    requireCondition(body && Object.keys(body).sort().join(',') === 'expectedRevision,requestId,wording', 'SYSTEM_WORDING_INVALID');
    return store.save({ actor, ...body });
  } });
}
