import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const AI_ROUTES = Object.freeze({ '/api/ai/publication': 'GET', '/api/ai/review': 'POST', '/api/ai/publish': 'POST',
  '/api/ai/disable': 'POST', '/api/ai/budget': 'GET', '/api/ai/resolve-spending': 'POST',
  '/api/ai/review-spending-hold': 'POST', '/api/ai/clear-spending-hold': 'POST',
  '/api/ai/worker':'GET',
  '/api/ai/review-activation':'POST', '/api/ai/activate':'POST',
  '/api/ai/diagnostics':'GET','/api/ai/overview':'GET',
  '/api/ai/memories':'GET', '/api/ai/memory-audit':'GET', '/api/ai/forget-memory':'POST', '/api/ai/edit-memory':'POST', '/api/ai/remove-memory':'POST',
  // The member's own Sophie choices and data (owner decision, 23 October 2026), the same use cases as the Discord panel.
  '/api/ai/me':'GET', '/api/ai/me/export':'GET', '/api/ai/me/choice':'POST', '/api/ai/me/notes':'POST', '/api/ai/me/retention':'POST',
  '/api/ai/me/forget':'POST', '/api/ai/me/delete':'POST' });
const MEMBER_ROUTES = Object.freeze({ '/api/ai/me': ['status', []], '/api/ai/me/export': ['exportData', []], '/api/ai/me/choice': ['setChoice', ['enabled', 'noticeRevision', 'noticeBinding']],
  '/api/ai/me/notes': ['saveNotes', ['notes']], '/api/ai/me/retention': ['setRetainOnLeave', ['retainOnLeave']], '/api/ai/me/forget': ['forgetMemories', ['confirmed']],
  '/api/ai/me/delete': ['deleteData', ['confirmed']] });

export function createAiControlsHttp({ auth, authorization, controls, member = null, trace = () => {} }) {
  async function memberRoute({ path, method, query, body, credentials }) {
    requireCondition(member !== null, 'AI_MEMORY_UNAVAILABLE');
    const [operation, keys] = MEMBER_ROUTES[path];
    requireCondition([...query].length === 0 && (method === 'GET' ? body === null : true), 'AI_INPUT_INVALID');
    if (method === 'POST') requireKeys(body, keys, 'AI_INPUT_INVALID');
    if (keys.includes('confirmed')) requireCondition(body.confirmed === true, 'AI_CONFIRMATION_REQUIRED');
    if (operation === 'setChoice') requireCondition(typeof body.enabled === 'boolean' && (body.noticeRevision === null || Number.isSafeInteger(body.noticeRevision)) &&
      (body.noticeBinding === null || typeof body.noticeBinding === 'string' && /^[a-f0-9]{64}$/u.test(body.noticeBinding)), 'AI_INPUT_INVALID');
    if (operation === 'saveNotes') requireCondition(Array.isArray(body.notes), 'AI_PREFERENCE_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof, { reuse: true });
    const { confirmed: _confirmed, ...fields } = body ?? {};
    const result = await member[operation]({ ...fields, actor });
    await auth.resolvePrincipal(proof);
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  }
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(AI_ROUTES, path) && AI_ROUTES[path] === method, 'AI_INPUT_INVALID');
    if (Object.hasOwn(MEMBER_ROUTES, path)) return memberRoute({ path, method, query, body, credentials });
    let operation, fields;
    if (method === 'GET') {
      requireCondition(body === null, 'AI_INPUT_INVALID');
      if(path==='/api/ai/diagnostics'){
        requireCondition([...query.keys()].length===1 && query.has('channelId'),'AI_INPUT_INVALID');
        fields={channelId:query.get('channelId')};operation='diagnostics';
      } else if (path === '/api/ai/memory-audit') {
        const keys = [...query.keys()];
        requireCondition(keys.length <= 1 && keys.every(key => key === 'before'), 'AI_INPUT_INVALID');
        fields = query.has('before') ? { before: query.get('before') } : {}; operation = 'auditMemories';
      } else if (path === '/api/ai/memories') {
        requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); fields = {}; operation = 'ownMemories';
      } else if (path === '/api/ai/overview') {
        requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); fields = {}; operation = 'overview';
      } else if (path === '/api/ai/publication') {
        requireCondition([...query.keys()].length === 1 && query.has('kind'), 'AI_INPUT_INVALID');
        fields = { kind: query.get('kind') }; operation = 'current';
      } else { requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); fields = {}; operation = path === '/api/ai/worker' ? 'workerStatus' : 'budgetStatus'; }
    } else {
      requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); operation = path.split('/').at(-1);
      const keys = { review: ['kind', 'expectedRevision', 'document'], publish: ['kind', 'expectedRevision', 'document', 'requestId', 'reviewSha256', 'confirmed'],
        disable: [], 'resolve-spending':['messageId','fence','requestId','confirmed'],
        'review-spending-hold': ['expectedRevision','evidenceHash'], 'clear-spending-hold': ['expectedRevision','evidenceHash','reviewSha256','requestId','confirmed'],
        'review-activation':['channelId'], activate:['channelId','reviewSha256','requestId','confirmed'],
        'forget-memory':['id','confirmed'], 'edit-memory':['id','text','confirmed'], 'remove-memory':['id','confirmed'] };
      requireKeys(body, keys[operation], 'AI_INPUT_INVALID'); fields = body;
      if (operation === 'resolve-spending') operation = 'resolveSpending';
      if (operation === 'review-spending-hold') operation = 'reviewSpendingHold';
      if (operation === 'clear-spending-hold') operation = 'clearSpendingHold';
      if (operation === 'review-activation') operation = 'reviewActivation';
      operation = { 'forget-memory': 'forgetMemory', 'edit-memory': 'editMemory', 'remove-memory': 'removeMemory' }[operation] ?? operation;
    }
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof, { reuse: true });
    // The AI page's whole saved state in one request. Each part still authorizes its own capability; a part the
    // actor may not read is null rather than failing the page, and any other error fails the request.
    const permitted = async (part, work) => { try { return await work(); } catch (error) {
      if (error?.code !== 'OPERATION_DENIED') throw error; try { trace(`AI_OVERVIEW_WITHHELD_${part}`); } catch { /* Diagnostics only. */ } return null; } };
    const result = operation === 'overview' ? {
      configuration: await permitted('CONFIGURATION', () => controls.current({ actor, kind: 'configuration' })),
      budgetPublication: await permitted('BUDGET_POLICY', () => controls.current({ actor, kind: 'budget' })),
      budget: await permitted('BUDGET', () => controls.budgetStatus({ actor })),
      worker: await permitted('WORKER', () => controls.workerStatus({ actor })),
      personality: await permitted('PERSONALITY', () => controls.current({ actor, kind: 'personality' })) } : await controls[operation]({ ...fields, actor });
    await auth.resolvePrincipal(proof);
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
