import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';

export const MODERATION_ROUTES = Object.freeze({ '/api/moderation/review': 'GET', '/api/moderation/retry': 'POST' });

/** Only a fresh, authenticated target observation reaches the member recovery use case. */
export function createModerationRecoveryHttp({ auth, authorization, store, discord, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const active = async () => requireCondition(await enabled() === true, 'OPERATION_DENIED');
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(MODERATION_ROUTES, path) && method === MODERATION_ROUTES[path], 'MODERATION_INPUT_INVALID');
    let input;
    if (method === 'GET') {
      requireCondition(body === null && [...query.keys()].length === 1 && query.has('userId'), 'MODERATION_INPUT_INVALID');
      input = { userId: query.get('userId') };
    } else {
      requireCondition([...query].length === 0, 'MODERATION_INPUT_INVALID');
      requireKeys(body, ['userId', 'operationId', 'expectedFence', 'expectedActionRevision', 'expectedEligibilityEpoch', 'requestId', 'confirmed'], 'MODERATION_INPUT_INVALID');
      requireCondition(body.confirmed === true && /^[a-f0-9]{64}$/.test(body.requestId) && typeof body.requestId === 'string' &&
        typeof body.operationId === 'string' && /^[A-Za-z0-9._-]{1,160}$/.test(body.operationId), 'MODERATION_INPUT_INVALID');
      requireInteger(body.expectedFence); requireInteger(body.expectedActionRevision, 1); requireInteger(body.expectedEligibilityEpoch);
      input = structuredClone(body);
    }
    requireId(input.userId);
    await active(); const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const target = { guildId: actor.guildId, userId: input.userId };
    requireCondition(await authorization.authorize('member.mute', actor, target) === true ||
      await authorization.authorize('member.unmute', actor, target) === true, 'OPERATION_DENIED');
    const observation = await discord.observe(input.userId);
    requireCondition(observation.guildId === actor.guildId && observation.userId === input.userId, 'OPERATION_DENIED');
    await active();
    const result = method === 'GET' ? await store.reviewModeration({ actor, observation }) :
      await store.retryModeration({ actor, observation, operationId: input.operationId, expectedFence: input.expectedFence,
        expectedActionRevision: input.expectedActionRevision, expectedEligibilityEpoch: input.expectedEligibilityEpoch,
        interactionId: `dashboard.${createHash('sha256').update(JSON.stringify([actor.guildId, actor.userId, input.requestId])).digest('hex')}` });
    await auth.resolvePrincipal(proof); await active();
    return result;
  } });
}
