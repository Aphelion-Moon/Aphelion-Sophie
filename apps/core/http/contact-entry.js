import { createHash } from 'node:crypto';
import { requireCondition, requireKeys } from '../../../contracts/validation.js';
import { contactRecipientIds, contactScope } from '../../../modules/tickets/contacts.js';
import { requireFormToken } from '../../../modules/tickets/intake.js';

export const CONTACT_ENTRY_ROUTES = Object.freeze({ '/api/contacts/access': 'GET', '/api/contacts/review': 'GET',
  '/api/contacts/select': 'POST', '/api/contacts/confirm': 'POST', '/api/contacts/cancel': 'POST',
  '/api/contacts/submit': 'POST', '/api/contacts/destination': 'GET' });

/** Private intake stays in core and calls the same retained selection/submission services as Discord. */
export function createContactEntryHttp({ auth, authorization, store, discord, channels, enabled }) {
  const active = async () => requireCondition(await enabled() === true, 'OPERATION_DENIED');
  const requestId = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'CONTACT_ENTRY_INPUT_INVALID');
  const receiptId = (actor, purpose, value) => `dashboard.${createHash('sha256').update(JSON.stringify([actor.guildId, actor.userId, purpose, value])).digest('hex')}`;
  return Object.freeze({ async execute({ path, method, query, body, credentials }) {
    requireCondition(Object.hasOwn(CONTACT_ENTRY_ROUTES, path) && method === CONTACT_ENTRY_ROUTES[path], 'CONTACT_ENTRY_INPUT_INVALID');
    const action = path.split('/').at(-1); let input;
    if (method === 'GET') {
      requireCondition(body === null && [...query.keys()].length === (action === 'access' ? 0 : 1), 'CONTACT_ENTRY_INPUT_INVALID');
      if (action !== 'access') { requireCondition(query.has('requestId'), 'CONTACT_ENTRY_INPUT_INVALID'); requestId(query.get('requestId')); }
      input = { requestId: query.get('requestId') };
    } else {
      requireCondition([...query].length === 0, 'CONTACT_ENTRY_INPUT_INVALID');
      requireKeys(body, action === 'select' ? ['requestId', 'recipientIds'] : action === 'submit' ? ['requestId', 'formToken', 'values', 'confirmed'] :
        action === 'confirm' ? ['formToken', 'confirmed'] : ['formToken'], 'CONTACT_ENTRY_INPUT_INVALID');
      if (action === 'select') { requestId(body.requestId); contactRecipientIds(body.recipientIds); }
      else {
        requireFormToken(body.formToken);
        if (action !== 'cancel') requireCondition(body.confirmed === true, 'CONTACT_ENTRY_INPUT_INVALID');
        if (action === 'submit') { requestId(body.requestId); requireCondition(Array.isArray(body.values) && body.values.length >= 1 && body.values.length <= 5, 'CONTACT_ENTRY_INPUT_INVALID'); }
      }
      input = structuredClone(body);
    }
    await active(); const { proof } = await auth.authenticate({ ...credentials, method }), actor = await authorization.resolveActor(proof);
    const access = async () => requireCondition(await authorization.authorize('case.manage', actor, contactScope(actor.guildId, actor.userId)) === true, 'OPERATION_DENIED');
    await access(); let result;
    if (action === 'access') result = { canCreate: true };
    else {
      const observation = await discord.observe(actor.userId); await active();
      const common = { actor, observation };
      if (action === 'select') {
        const interactionId = receiptId(actor, 'contact.select', input.requestId);
        await store.beginStaffContact({ ...common, interactionId, recipientIds: input.recipientIds });
        result = await store.reviewStaffContact({ ...common, interactionId });
      } else if (action === 'review') result = await store.reviewStaffContact({ ...common, interactionId: receiptId(actor, 'contact.select', input.requestId) });
      else if (action === 'confirm') result = await store.confirmStaffContact({ ...common, formToken: input.formToken });
      else if (action === 'cancel') { await store.cancelStaffContact({ ...common, formToken: input.formToken }); result = { cancelled: true }; }
      else if (action === 'submit') {
        // A web token must refer to a Staff-contact selection, never to an ordinary member form.
        const saved = await store.submitCaseForm({ ...common, interactionId: receiptId(actor, 'contact.submit', input.requestId),
          formToken: input.formToken, values: input.values, expectedCaseType: 'staff-contact' });
        result = { recorded: true, duplicate: saved.duplicate };
      } else {
        const current = await store.describeTicketDestination({ ...common, interactionId: receiptId(actor, 'contact.submit', input.requestId) });
        if (current.state !== 'inspect') result = current;
        else {
          const channelProof = await channels.inspect(current.plan, current.channelId); await active();
          result = await store.confirmTicketDestination({ actor, observation: await discord.observe(actor.userId), caseToken: current.plan.token, proof: channelProof });
        }
      }
    }
    await access(); await auth.resolvePrincipal(proof); await active(); return result;
  } });
}
