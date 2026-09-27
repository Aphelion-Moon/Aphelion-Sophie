import { requireCondition } from '../../../contracts/validation.js';

export const CASE_TRANSCRIPT_ROUTES = Object.freeze({ '/api/cases/transcript': 'GET', '/api/cases/transcript/channel': 'GET' });

export function createCaseTranscriptsHttp({ auth, authorization, transcripts }) {
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CASE_TRANSCRIPT_ROUTES, path) && method === 'GET' && body === null, 'TRANSCRIPT_INPUT_INVALID');
    const byChannel = path.endsWith('/channel');
    const names = [...query.keys()];
    requireCondition(new Set(names).size === names.length && (byChannel ? names.length === 1 && names[0] === 'channelId' :
      names.includes('caseToken') && names.every(name => ['caseToken', 'channelId', 'after', 'gapsAfter'].includes(name))), 'TRANSCRIPT_INPUT_INVALID');
    const { proof } = await auth.authenticate({ ...credentials, method });
    const actor = await authorization.resolveActor(proof);
    const result = byChannel ? await transcripts.readChannel({ actor, channelId: query.get('channelId') }) : await transcripts.read({ actor, caseToken: query.get('caseToken'), channelId: query.get('channelId'),
      after: query.get('after'), gapsAfter: query.get('gapsAfter') });
    await auth.resolvePrincipal(proof);
    return result;
  } });
}
