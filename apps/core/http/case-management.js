import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { caseStatusView, requireCaseActionReason } from '../../../modules/tickets/lifecycle.js';
import { CASE_ASSIGN_REASONS, requireCaseQueueFilter } from '../../../modules/tickets/staff.js';
import { requireParticipantChange } from '../../../modules/tickets/participants.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';

export const CASE_MANAGEMENT_ROUTES = Object.freeze({ '/api/cases/manage': 'GET', '/api/cases/queue': 'GET', '/api/cases/manage/change': 'POST' });

/** Fixed operations call the same authorized stores as Discord; no supplied actor or membership snapshot is accepted. */
export function createCaseManagementHttp({ auth, authorization, store, discord, limits, enabled }) {
  validateTicketLimits(limits); requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const fixedLimits = structuredClone(limits);
  const active = async () => requireCondition(await enabled() === true, 'OPERATION_DENIED');
  async function describe(actor, reference) {
    try { return await store.describeCase({ actor, guildId: actor.guildId, ...reference }); }
    catch (error) { requireCondition(error.code !== 'CASE_NOT_FOUND', 'CASE_ACCESS_DENIED'); throw error; }
  }
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_MANAGEMENT_ROUTES, path) && method === CASE_MANAGEMENT_ROUTES[path], 'CASE_MANAGEMENT_INPUT_INVALID');
    let input;
    if (method === 'POST') {
      requireCondition([...query].length === 0, 'CASE_MANAGEMENT_INPUT_INVALID');
      requireKeys(body, ['channelId', 'requestId', 'expectedVersion', 'action', 'targetId', 'reason', 'confirmed'], 'CASE_MANAGEMENT_INPUT_INVALID');
      requireId(body.channelId); requireInteger(body.expectedVersion, 0, 2147483644);
      requireCondition(typeof body.requestId === 'string' && /^[a-f0-9]{64}$/.test(body.requestId) && body.confirmed === true, 'CASE_MANAGEMENT_INPUT_INVALID');
      if (['close', 'reopen'].includes(body.action)) { requireCaseActionReason(body.action, body.reason); requireCondition(body.targetId === null, 'CASE_MANAGEMENT_INPUT_INVALID'); }
      else if (['claim', 'unclaim'].includes(body.action)) requireCondition(body.targetId === null && body.reason === null, 'CASE_MANAGEMENT_INPUT_INVALID');
      else if (body.action === 'assign') { requireId(body.targetId); requireCondition(CASE_ASSIGN_REASONS.includes(body.reason), 'CASE_MANAGEMENT_INPUT_INVALID'); }
      else {
        requireCondition(['add-participant', 'remove-participant'].includes(body.action), 'CASE_MANAGEMENT_INPUT_INVALID');
        requireParticipantChange({ action: body.action.split('-')[0], userId: body.targetId, reason: body.reason, confirmed: body.confirmed });
      }
      input = structuredClone(body);
    } else {
      const keys = [...query.keys()]; requireCondition(body === null && new Set(keys).size === keys.length, 'CASE_MANAGEMENT_INPUT_INVALID');
      if (path === '/api/cases/queue') {
        requireCondition(keys.every(key => ['filter', 'after'].includes(key)), 'CASE_MANAGEMENT_INPUT_INVALID');
        input = { filter: query.get('filter') ?? 'active', after: query.get('after') }; requireCaseQueueFilter(input.filter);
        if (input.after !== null) requireCaseToken(input.after);
      } else { requireCondition(keys.length === 1 && keys[0] === 'channelId', 'CASE_MANAGEMENT_INPUT_INVALID'); input = { channelId: query.get('channelId') }; requireId(input.channelId); }
    }
    await active(); const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    if (path === '/api/cases/queue') {
      const result = await store.listCases({ actor, guildId: actor.guildId, ...input });
      await auth.resolvePrincipal(proof); await active(); return result;
    }
    const record = await describe(actor, { channelId: input.channelId });
    if (method === 'GET') { await auth.resolvePrincipal(proof); await active(); return { ...caseStatusView(record), actorId: actor.userId }; }
    const interactionId = `dashboard.${createHash('sha256').update(JSON.stringify([actor.guildId, actor.userId, input.requestId])).digest('hex')}`;
    const common = { actor, id: record.id, interactionId, expectedVersion: input.expectedVersion };
    let result;
    if (['claim', 'unclaim', 'assign'].includes(input.action)) {
      await active(); result = await store.changeCaseAssignment({ ...common, guildId: actor.guildId, action: input.action, assigneeId: input.targetId, reason: input.reason });
    } else {
      const observation = await discord.observe(record.userId); await active();
      if (['close', 'reopen'].includes(input.action)) result = await store[input.action === 'close' ? 'closeCase' : 'reopenCase']({ ...common, observation, reason: input.reason, limits: fixedLimits });
      else result = await store.changeCaseParticipant({ ...common, observation, action: input.action.split('-')[0], userId: input.targetId, reason: input.reason, confirmed: input.confirmed });
    }
    // A lost response can be retried with the same namespace and receipt; delivery remains separately tracked.
    await describe(actor, { id: record.id }); await auth.resolvePrincipal(proof); await active();
    return { recorded: true, duplicate: result.duplicate };
  } });
}
