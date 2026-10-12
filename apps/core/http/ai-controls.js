import { requireCondition, requireId, requireKeys } from '../../../contracts/validation.js';

export const AI_ROUTES = Object.freeze({ '/api/ai/publication': 'GET', '/api/ai/review': 'POST', '/api/ai/publish': 'POST',
  '/api/ai/disable': 'POST', '/api/ai/consents': 'GET', '/api/ai/consents/export': 'GET', '/api/ai/consent': 'POST', '/api/ai/budget': 'GET', '/api/ai/resolve-spending': 'POST',
  '/api/ai/review-spending-hold': 'POST', '/api/ai/clear-spending-hold': 'POST',
  '/api/ai/worker':'GET','/api/ai/review-worker':'POST','/api/ai/apply-worker':'POST','/api/ai/stop-worker':'POST',
  '/api/ai/review-activation':'POST', '/api/ai/activate':'POST',
  '/api/ai/diagnostics':'GET','/api/ai/overview':'GET','/api/ai/preferences':'GET','/api/ai/preferences/export':'GET', '/api/ai/save-preferences':'POST', '/api/ai/delete-preferences':'POST','/api/ai/save-retention':'POST' });

export function createAiControlsHttp({ auth, authorization, controls }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(AI_ROUTES, path) && AI_ROUTES[path] === method, 'AI_INPUT_INVALID');
    let operation, fields;
    if (method === 'GET') {
      requireCondition(body === null, 'AI_INPUT_INVALID');
      if(path==='/api/ai/consents'){
        const keys=[...query.keys()];
        requireCondition(keys.length<=1 && keys.every(key=>['afterChannelId','channelId'].includes(key)),'AI_INPUT_INVALID');
        fields=Object.fromEntries(query);Object.values(fields).forEach(requireId);operation='ownConsents';
      } else if(path==='/api/ai/diagnostics'){
        requireCondition([...query.keys()].length===1 && query.has('channelId'),'AI_INPUT_INVALID');
        fields={channelId:query.get('channelId')};operation='diagnostics';
      } else if (path === '/api/ai/overview') {
        requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); fields = {}; operation = 'overview';
      } else if (path === '/api/ai/publication') {
        requireCondition([...query.keys()].length === 1 && query.has('kind'), 'AI_INPUT_INVALID');
        fields = { kind: query.get('kind') }; operation = 'current';
      } else { requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); fields = {}; operation = path === '/api/ai/worker' ? 'workerStatus' : path === '/api/ai/budget' ? 'budgetStatus' : ['/api/ai/preferences','/api/ai/preferences/export'].includes(path) ? 'ownPreferences' : 'ownConsents'; }
    } else {
      requireCondition([...query].length === 0, 'AI_INPUT_INVALID'); operation = path.split('/').at(-1);
      const keys = { review: ['kind', 'expectedRevision', 'document'], publish: ['kind', 'expectedRevision', 'document', 'requestId', 'reviewSha256', 'confirmed'],
        disable: [], consent: ['channelId', 'enabled', 'expectedEpoch', 'acceptedNoticeRevision'], 'resolve-spending':['messageId','fence','requestId','confirmed'],
        'review-spending-hold': ['expectedRevision','evidenceHash'], 'clear-spending-hold': ['expectedRevision','evidenceHash','reviewSha256','requestId','confirmed'],
        'review-worker':['candidateId','expectedRevision'],'apply-worker':['candidateId','expectedRevision','reviewSha256','requestId','confirmed'],'stop-worker':['requestId'],
        'review-activation':['channelId'], activate:['channelId','reviewSha256','requestId','confirmed'],
        'save-preferences':['expectedEpoch','settings','confirmed'], 'delete-preferences':['expectedEpoch','confirmed'],'save-retention':['expectedEpoch','retainOnLeave','confirmed'] };
      const optionalBinding = operation === 'consent' && body && Object.hasOwn(body, 'acceptedNoticeBinding') ? ['acceptedNoticeBinding'] : [];
      requireKeys(body, [...keys[operation], ...optionalBinding], 'AI_INPUT_INVALID'); fields = body;
      if (operation === 'resolve-spending') operation = 'resolveSpending';
      if (operation === 'review-spending-hold') operation = 'reviewSpendingHold';
      if (operation === 'clear-spending-hold') operation = 'clearSpendingHold';
      if (operation === 'save-preferences') operation = 'savePreferences';
      if (operation === 'save-retention') operation = 'saveRetention';
      if (operation === 'delete-preferences') operation = 'deletePreferences';
      if (operation === 'review-worker') operation = 'reviewWorker';
      if (operation === 'apply-worker') operation = 'applyWorker';
      if (operation === 'stop-worker') operation = 'stopWorker';
      if (operation === 'review-activation') operation = 'reviewActivation';
    }
    if (path === '/api/ai/consents/export') operation = 'exportConsents';
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof, { reuse: true });
    // The AI page's whole saved state in one request. Each part still authorizes its own capability; a part the
    // actor may not read is null rather than failing the page, and any other error fails the request.
    const permitted = async work => { try { return await work(); } catch (error) { if (error?.code === 'OPERATION_DENIED') return null; throw error; } };
    const result = operation === 'overview' ? {
      configuration: await permitted(() => controls.current({ actor, kind: 'configuration' })),
      budgetPublication: await permitted(() => controls.current({ actor, kind: 'budget' })),
      budget: await permitted(() => controls.budgetStatus({ actor })),
      worker: await permitted(() => controls.workerStatus({ actor })),
      personality: await permitted(() => controls.current({ actor, kind: 'personality' })) } : await controls[operation]({ ...fields, actor });
    await auth.resolvePrincipal(proof);
    if(path==='/api/ai/preferences/export'){
      requireCondition(result.available===true,'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
      requireCondition(result.quarantined===false,'AI_PREFERENCE_RESTORE_QUARANTINED');
    }
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
