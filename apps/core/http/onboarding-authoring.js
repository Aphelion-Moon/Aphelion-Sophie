import { requireCondition, requireInteger, requireKeys } from '../../../contracts/validation.js';

const routes = {
  '/api/onboarding/draft': 'GET', '/api/onboarding/history': 'GET', '/api/onboarding/review': 'GET', '/api/onboarding/publication': 'GET',
  '/api/onboarding/save': 'POST', '/api/onboarding/publish': 'POST', '/api/onboarding/withdraw': 'POST',
};
// Older open editor tabs keep working through the terminology transition.
export const ONBOARDING_AUTHORING_ROUTES = Object.freeze({ ...routes, ...Object.fromEntries(Object.entries(routes).map(([path, method]) => [path.replace('/onboarding/', '/shuttle/'), method])) });

/** Fixed core use cases only. Authored guidance is never routed to AI or mixed with session content. */
export function createOnboardingAuthoringHttp({ auth, authorization, store }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(ONBOARDING_AUTHORING_ROUTES, path) && method === ONBOARDING_AUTHORING_ROUTES[path], 'SHUTTLE_EDITOR_INPUT_INVALID');
    path = path.replace('/api/shuttle/', '/api/onboarding/');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    const fields = (required, optional = []) => {
      const names = [...query.keys()]; requireCondition(new Set(names).size === names.length && required.every(name => names.includes(name)) &&
        names.every(name => [...required, ...optional].includes(name)), 'SHUTTLE_EDITOR_INPUT_INVALID');
    };
    const integer = name => {
      const value = query.get(name); requireCondition(typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value), 'SHUTTLE_EDITOR_INPUT_INVALID');
      const result = Number(value); requireInteger(result, 1, 2_147_483_647); return result;
    };
    let result;
    if (method === 'GET') {
      requireCondition(body === null, 'SHUTTLE_EDITOR_INPUT_INVALID');
      if (path === '/api/onboarding/draft') { fields([], ['revision']); result = await store.readOnboardingDraft({ actor, revision: query.has('revision') ? integer('revision') : null }); }
      else if (path === '/api/onboarding/history') { fields(['kind'], ['before']); result = await store.listOnboardingHistory({ actor, kind: query.get('kind'), before: query.has('before') ? integer('before') : null }); }
      else if (path === '/api/onboarding/review') { fields(['revision']); result = await store.reviewOnboardingDraft({ actor, revision: integer('revision') }); }
      else { fields(['version']); result = await store.readOnboardingPublication({ actor, version: integer('version') }); }
    } else {
      fields([]);
      if (path === '/api/onboarding/save') {
        requireKeys(body, ['requestId', 'expectedRevision', 'document']); result = await store.saveOnboardingDraft({ actor, ...body });
      } else if (path === '/api/onboarding/publish') {
        requireKeys(body, ['requestId', 'expectedRevision', 'expectedHash', 'expectedLatestVersion', 'expectedLatestStatus']); result = await store.publishOnboardingDraft({ actor, ...body });
      } else {
        requireKeys(body, ['requestId', 'version', 'expectedHash', 'confirm']); result = await store.withdrawOnboardingPublication({ actor, ...body });
      }
    }
    requireCondition(await authorization.authorize('shuttle.publish', actor, { guildId: actor.guildId, definitionId: result.definitionId }) === true, 'OPERATION_DENIED');
    return result;
  } });
}
