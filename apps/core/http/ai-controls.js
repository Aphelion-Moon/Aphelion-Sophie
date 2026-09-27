import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const AI_ROUTES = Object.freeze({ '/api/ai/publication': 'GET', '/api/ai/review': 'POST', '/api/ai/publish': 'POST',
  '/api/ai/disable': 'POST', '/api/ai/consents': 'GET', '/api/ai/consent': 'POST' });

export function createAiControlsHttp({ auth, authorization, controls }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(AI_ROUTES, path) && AI_ROUTES[path] === method, 'AI_INPUT_INVALID');
    let operation, fields;
    if (method === 'GET') {
      requireCondition(body === null, 'AI_INPUT_INVALID');
      if (path === '/api/ai/publication') {
        requireCondition([...query.keys()].length === 1 && query.has('kind'), 'AI_INPUT_INVALID');
        fields = { kind: query.get('kind') }; operation = 'current';
      } else { requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); fields = {}; operation = 'ownConsents'; }
    } else {
      requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); operation = path.split('/').at(-1);
      const keys = { review: ['kind', 'expectedRevision', 'document'], publish: ['kind', 'expectedRevision', 'document', 'requestId', 'reviewSha256', 'confirmed'],
        disable: [], consent: ['channelId', 'enabled', 'expectedEpoch', 'acceptedNoticeRevision'] };
      requireKeys(body, keys[operation], 'AI_INPUT_INVALID'); fields = body;
    }
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    const result = await controls[operation]({ ...fields, actor });
    await auth.resolvePrincipal(proof);
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
