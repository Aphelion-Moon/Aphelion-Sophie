import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { requireCaseIssueId } from '../../../modules/tickets/delivery-issues.js';
import { createCaseDeliveryRecovery } from '../discord/case-delivery-recovery.js';

export const CASE_DELIVERY_ROUTES = Object.freeze({ '/api/cases/delivery': 'GET', '/api/cases/delivery/change': 'POST' });

/** Only bounded repair intent enters from the browser; no case contents or external proofs. */
export function createCaseDeliveryIssuesHttp({ auth, authorization, store, discord, channels, messages, replyMessages, enabled }) {
  const recovery = createCaseDeliveryRecovery({ store, discord, channels, messages, replyMessages, enabled });
  const active = async () => requireCondition(await enabled() === true, 'CASE_RECOVERY_DISABLED');
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_DELIVERY_ROUTES, path) && method === CASE_DELIVERY_ROUTES[path], 'CASE_DELIVERY_INPUT_INVALID');
    let input;
    if (method === 'GET') {
      requireCondition(body === null && [...query.keys()].every(key => key === 'after') && query.getAll('after').length <= 1, 'CASE_DELIVERY_INPUT_INVALID');
      input = { after: query.get('after') }; if (input.after !== null) requireCaseIssueId(input.after);
    } else {
      requireCondition([...query].length === 0, 'CASE_DELIVERY_INPUT_INVALID');
      requireKeys(body, ['issueId', 'expectedRevision', 'action', 'resultId', 'requestId', 'confirmed'], 'CASE_DELIVERY_INPUT_INVALID');
      requireCaseIssueId(body.issueId); requireInteger(body.expectedRevision, 0, 2_147_483_644);
      requireCondition(body.confirmed === true && typeof body.requestId === 'string' && /^[a-f0-9]{64}$/.test(body.requestId) &&
        ['recheck', 'adopt_message', 'select_channel'].includes(body.action), 'CASE_DELIVERY_INPUT_INVALID');
      if (body.action === 'recheck') requireCondition(body.resultId === null, 'CASE_DELIVERY_INPUT_INVALID'); else requireId(body.resultId);
      input = structuredClone(body);
    }
    await active(); const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const result = method === 'GET' ? await store.listCaseDeliveryIssues({ actor, guildId: actor.guildId, after: input.after }) :
      await recovery.change({ actor, guildId: actor.guildId, issueId: input.issueId, expectedRevision: input.expectedRevision,
        action: input.action, resultId: input.resultId,
        interactionId: `dashboard.${createHash('sha256').update(JSON.stringify([actor.guildId, actor.userId, input.requestId])).digest('hex')}` });
    await auth.resolvePrincipal(proof); await active(); return result;
  } });
}
