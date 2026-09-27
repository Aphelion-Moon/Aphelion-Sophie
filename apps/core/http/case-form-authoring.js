import { requireCondition, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { requireFormCaseType } from '../../../modules/tickets/form-authoring.js';

export const CASE_FORM_AUTHORING_ROUTES = Object.freeze({
  '/api/ticket-forms/draft': 'GET', '/api/ticket-forms/history': 'GET', '/api/ticket-forms/review': 'GET', '/api/ticket-forms/publication': 'GET',
  '/api/ticket-forms/save': 'POST', '/api/ticket-forms/publish': 'POST', '/api/ticket-forms/withdraw': 'POST',
});

/** Authored configuration only. There is no case-content or submitted-answer route. */
export function createCaseFormAuthoringHttp({ auth, authorization, store }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_FORM_AUTHORING_ROUTES, path) && method === CASE_FORM_AUTHORING_ROUTES[path], 'CASE_FORM_EDITOR_INPUT_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    const fields = (required, optional = []) => {
      const names = [...query.keys()]; requireCondition(new Set(names).size === names.length && required.every(name => names.includes(name)) &&
        names.every(name => [...required, ...optional].includes(name)), 'CASE_FORM_EDITOR_INPUT_INVALID');
    };
    const integer = name => {
      const value = query.get(name); requireCondition(typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value), 'CASE_FORM_EDITOR_INPUT_INVALID');
      const result = Number(value); requireInteger(result, 1, 2_147_483_647); return result;
    };
    let result, caseType;
    if (method === 'GET') {
      requireCondition(body === null, 'CASE_FORM_EDITOR_INPUT_INVALID'); caseType = query.get('caseType'); requireFormCaseType(caseType);
      if (path === '/api/ticket-forms/draft') { fields(['caseType'], ['revision']); result = await store.readCaseFormDraft({ actor, caseType, revision: query.has('revision') ? integer('revision') : null }); }
      else if (path === '/api/ticket-forms/history') { fields(['caseType', 'kind'], ['before']); result = await store.listCaseFormHistory({ actor, caseType, kind: query.get('kind'), before: query.has('before') ? integer('before') : null }); }
      else if (path === '/api/ticket-forms/review') { fields(['caseType', 'revision']); result = await store.reviewCaseFormDraft({ actor, caseType, revision: integer('revision') }); }
      else { fields(['caseType', 'version']); result = await store.readCaseFormPublication({ actor, caseType, version: integer('version') }); }
    } else {
      fields([]);
      if (path === '/api/ticket-forms/save') {
        requireKeys(body, ['caseType', 'requestId', 'expectedRevision', 'document']); result = await store.saveCaseFormDraft({ actor, ...body });
      } else if (path === '/api/ticket-forms/publish') {
        requireKeys(body, ['caseType', 'requestId', 'expectedRevision', 'expectedHash', 'expectedLatestVersion', 'expectedLatestStatus']); result = await store.publishCaseFormDraft({ actor, ...body });
      } else {
        requireKeys(body, ['caseType', 'requestId', 'version', 'expectedHash', 'confirm']); result = await store.withdrawCaseFormPublication({ actor, ...body });
      }
      caseType = body.caseType;
    }
    requireCondition(await authorization.authorize('case.forms.publish', actor, { guildId: actor.guildId, caseType }) === true, 'OPERATION_DENIED');
    return result;
  } });
}
