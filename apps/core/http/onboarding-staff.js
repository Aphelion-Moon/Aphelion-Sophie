import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { requireOnboardingIssueId as requireIssueId } from '../../../modules/onboarding/delivery-issues.js';
import { createOnboardingStaffOperations } from '../discord/onboarding-staff-operations.js';

export const ONBOARDING_STAFF_ROUTES = Object.freeze({ '/api/shuttle/help': 'GET', '/api/shuttle/help/resolve': 'POST',
  '/api/shuttle/delivery': 'GET', '/api/shuttle/delivery/change': 'POST' });

/** OAuth owns the actor; the browser supplies only reviewed, versioned intent. */
export function createOnboardingStaffHttp({ auth, authorization, store, discord, channels, screenMessages, alertMessages, enabled }) {
  const operations = createOnboardingStaffOperations({ store, discord, channels, screenMessages, alertMessages, enabled });
  const active = async () => requireCondition(await enabled() === true, 'SHUTTLE_STAFF_DISABLED');
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(ONBOARDING_STAFF_ROUTES, path) && method === ONBOARDING_STAFF_ROUTES[path], 'SHUTTLE_STAFF_INPUT_INVALID');
    const help = path === '/api/shuttle/help' || path === '/api/shuttle/help/resolve'; let input;
    if (method === 'GET') {
      requireCondition(body === null && [...query.keys()].every(key => key === 'after') && query.getAll('after').length <= 1, 'SHUTTLE_STAFF_INPUT_INVALID');
      input = { after: query.get('after') }; if (input.after !== null) (help ? requireId : requireIssueId)(input.after);
    } else {
      requireCondition([...query].length === 0, 'SHUTTLE_STAFF_INPUT_INVALID');
      requireKeys(body, help ? ['helpId', 'expectedRevision', 'requestId', 'confirmed'] :
        ['issueId', 'expectedRevision', 'action', 'resultId', 'requestId', 'confirmed'], 'SHUTTLE_STAFF_INPUT_INVALID');
      requireInteger(body.expectedRevision, 0, help ? 2_147_483_646 : 2_147_483_645);
      requireCondition(body.confirmed === true && typeof body.requestId === 'string' && /^[a-f0-9]{64}$/.test(body.requestId), 'SHUTTLE_STAFF_INPUT_INVALID');
      if (help) requireId(body.helpId);
      else {
        requireIssueId(body.issueId);
        requireCondition(['recheck', 'adopt_message', 'select_channel'].includes(body.action), 'SHUTTLE_STAFF_INPUT_INVALID');
        if (body.action === 'recheck') requireCondition(body.resultId === null, 'SHUTTLE_STAFF_INPUT_INVALID'); else requireId(body.resultId);
      }
      input = structuredClone(body);
    }
    await active(); const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const principal = { actor, guildId: actor.guildId }; let result;
    if (method === 'GET') result = await (help ? store.listOnboardingHelp : store.listOnboardingDeliveryIssues)({ ...principal, after: input.after });
    else {
      const request = { ...principal, expectedRevision: input.expectedRevision,
        interactionId: `dashboard.${createHash('sha256').update(JSON.stringify([actor.guildId, actor.userId, input.requestId])).digest('hex')}` };
      result = help ? await operations.resolve({ ...request, requestId: input.helpId }) :
        await operations.repair({ ...request, issueId: input.issueId, action: input.action, resultId: input.resultId });
    }
    await auth.resolvePrincipal(proof); await active(); return result;
  } });
}
