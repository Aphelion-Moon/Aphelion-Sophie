import { requireCondition } from '../../../contracts/validation.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';
import { createContactNavigation } from '../discord/contact-navigation.js';

export const CONTACT_NAVIGATION_ROUTES = Object.freeze({ '/api/contacts/received': 'GET', '/api/contacts/received/destination': 'GET' });

/** Recipient-only metadata and exact destination checks; never returns contact forms or conversation excerpts. */
export function createContactNavigationHttp({ auth, authorization, store, discord, channels, enabled }) {
  const navigation = createContactNavigation({ authorization, store, discord, channels, enabled });
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CONTACT_NAVIGATION_ROUTES, path) && method === 'GET' && body === null, 'CONTACT_NAVIGATION_INPUT_INVALID');
    const listing = path === '/api/contacts/received', keys = [...query.keys()], key = listing ? 'after' : 'caseToken';
    requireCondition(keys.length <= 1 && keys.every(value => value === key) && (listing || keys.length === 1), 'CONTACT_NAVIGATION_INPUT_INVALID');
    const value = query.get(key); if (value !== null) requireCaseToken(value);
    requireCondition(await enabled() === true, 'OPERATION_DENIED');
    const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    let result;
    try { result = listing ? await navigation.list({ actor, after: value }) : await navigation.destination({ actor, caseToken: value }); }
    catch (error) { requireCondition(error.code !== 'CASE_NOT_FOUND', 'CASE_DESTINATION_DENIED'); throw error; }
    await auth.resolvePrincipal(proof); requireCondition(await enabled() === true, 'OPERATION_DENIED');
    return { ...result, actorId: actor.userId, guildId: actor.guildId };
  } });
}
