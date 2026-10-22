import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const ACTIVITY_LAYOUT_ROUTES = Object.freeze({ '/api/activity-layout': 'GET', '/api/activity-layout/publish': 'POST' });

/**
 * The Shuttle Activity layout editor (P44): scenes per stop, moments per section and the curated arrival list. Fixed
 * core use cases only; it changes what the Activity draws and links, never a run, a permission or the published copy.
 */
export function createActivityLayoutHttp({ auth, authorization, store }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(ACTIVITY_LAYOUT_ROUTES, path) && method === ACTIVITY_LAYOUT_ROUTES[path] && [...query.keys()].length === 0,
      'ACTIVITY_LAYOUT_INPUT_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    if (method === 'GET') { requireCondition(body === null, 'ACTIVITY_LAYOUT_INPUT_INVALID'); return store.readActivityLayout({ actor }); }
    requireKeys(body, ['requestId', 'expectedVersion', 'document'], 'ACTIVITY_LAYOUT_INPUT_INVALID');
    return store.publishActivityLayout({ actor, ...body });
  } });
}
