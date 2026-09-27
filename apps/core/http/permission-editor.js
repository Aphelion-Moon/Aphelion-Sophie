import { requireCondition, requireInteger, requireKeys } from '../../../contracts/validation.js';

export const PERMISSION_EDITOR_ROUTES = Object.freeze(Object.fromEntries([
  ['draft', 'GET'], ['review', 'GET'], ['publication', 'GET'], ['deployment-review', 'GET'], ['application', 'GET'], ['history', 'GET'], ['save', 'POST'], ['publish', 'POST'], ['withdraw', 'POST'], ['apply', 'POST'], ['retryApplication','POST'],
].map(([name, method]) => [`/api/permissions/${name}`, method])));

export function createPermissionEditorHttp({ auth, authorization, store }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(PERMISSION_EDITOR_ROUTES[path] === method, 'PERMISSION_INPUT_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const action = path.slice('/api/permissions/'.length), names = [...query.keys()];
    const integer = key => {
      requireCondition(/^[1-9][0-9]{0,9}$/.test(query.get(key) ?? ''), 'PERMISSION_INPUT_INVALID');
      const value = Number(query.get(key)); requireInteger(value, 1, 2_147_483_647); return value;
    };
    let result;
    if (method === 'GET') {
      const accepted = { draft: ['revision'], review: ['revision'], publication: ['version'], 'deployment-review': ['version', 'expectedReviewHash'], application: [], history: ['kind', 'before'] }[action];
      requireCondition(body === null && new Set(names).size === names.length && names.every(key => accepted.includes(key)), 'PERMISSION_INPUT_INVALID');
      if (action === 'draft') result = await store.read({ actor, revision: query.has('revision') ? integer('revision') : null });
      else if (action === 'review') result = await store.review({ actor, revision: integer('revision') });
      else if (action === 'publication') result = await store.publication({ actor, version: integer('version') });
      else if (action === 'deployment-review') result = await store.deploymentReview({ actor, version: integer('version'), expectedReviewHash: query.get('expectedReviewHash') });
      else if (action === 'application') result = await store.application({ actor });
      else result = await store.history({ actor, kind: query.get('kind'), before: query.has('before') ? integer('before') : null });
    } else {
      requireCondition(names.length === 0, 'PERMISSION_INPUT_INVALID');
      requireKeys(body, { save: ['requestId', 'expectedRevision', 'document'], publish: ['requestId', 'expectedRevision', 'expectedHash', 'expectedLatestVersion', 'expectedLatestStatus'],
        withdraw: ['requestId', 'version', 'expectedHash', 'confirm'], apply: ['requestId', 'version', 'expectedHash', 'expectedReviewHash', 'confirm'], retryApplication:['requestId','confirm'] }[action]);
      result = await store[action]({ actor, ...body });
    }
    requireCondition(await authorization.authorize('permissions.publish', actor, { guildId: actor.guildId }) === true, 'OPERATION_DENIED'); return result;
  } });
}
