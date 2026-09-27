import { requireCondition, requireKeys } from '../../../contracts/validation.js';

export const AUTOMATION_ROUTES = Object.freeze({ '/api/automation': 'GET','/api/automation/history':'GET',
  '/api/automation/review':'POST','/api/automation/preview':'POST','/api/automation/change':'POST',
  '/api/automation/issues':'GET','/api/automation/issue':'GET','/api/automation/repair':'POST' });
export function createAutomationPoliciesHttp({auth,authorization,automation,recovery=null}) {
  return Object.freeze({async execute({path,method,query,body,credentials}) {
    requireCondition(Object.hasOwn(AUTOMATION_ROUTES,path) && method === AUTOMATION_ROUTES[path],'AUTOMATION_INPUT_INVALID');
    let operation,fields;const repairing=['/api/automation/issues','/api/automation/issue','/api/automation/repair'].includes(path);
    if(repairing) {
      requireCondition(recovery!==null,'AUTOMATION_RECOVERY_UNAVAILABLE');
      if(method==='POST') {
        requireCondition([...query].length===0,'AUTOMATION_INPUT_INVALID');
        requireKeys(body,['deliveryId','expectedVersion','action','messageId','requestId','confirmed'],'AUTOMATION_INPUT_INVALID');operation='change';fields=body;
      } else {
        const keys=[...query.keys()];requireCondition(body===null&&new Set(keys).size===keys.length,'AUTOMATION_INPUT_INVALID');
        const detail=path==='/api/automation/issue';requireCondition(keys.every(key=>key==='before'||(detail&&key==='deliveryId')),'AUTOMATION_INPUT_INVALID');
        operation=detail?'detail':'list';const before=query.get('before');
        requireCondition(before===null||(detail?/^[1-9][0-9]{0,9}$/:/^[a-f0-9]{32}$/).test(before),'AUTOMATION_INPUT_INVALID');
        fields=detail?{deliveryId:query.get('deliveryId'),before:before===null?null:Number(before)}:{before};
      }
    } else if (method === 'POST') {
      requireCondition([...query].length === 0,'AUTOMATION_INPUT_INVALID'); operation = path.split('/').at(-1);
      requireKeys(body,operation === 'preview' ? ['expectedRevision','document','events','synthetic'] :
        ['expectedRevision','action','document',...(operation === 'change' ? ['requestId','reviewSha256','confirmed','approvedPublic'] : [])],'AUTOMATION_INPUT_INVALID');
      fields = body;
    } else {
      const keys = [...query.keys()]; requireCondition(body === null && new Set(keys).size === keys.length,'AUTOMATION_INPUT_INVALID');
      operation = path === '/api/automation' ? 'current' : 'history';
      requireCondition(keys.every(key => operation === 'history' && key === 'before'),'AUTOMATION_INPUT_INVALID');
      const before = query.get('before'); requireCondition(before === null || /^[1-9][0-9]{0,9}$/.test(before),'AUTOMATION_INPUT_INVALID');
      fields = operation === 'current' ? {} : {before:before === null ? null : Number(before)};
    }
    const {proof} = await auth.authenticate({...credentials,method}), actor = await authorization.resolveActor(proof);
    const result = await (repairing?recovery:automation)[operation]({...fields,actor}); await auth.resolvePrincipal(proof);
    return {...result,actorId:actor.userId,guildId:actor.guildId};
  } });
}
