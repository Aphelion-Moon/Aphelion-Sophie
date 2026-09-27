import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { MAX_CASE_PARTICIPANTS } from './participants.js';
import { requireCaseToken } from './references.js';

export const CONTACT_SELECT_ID = 'sophie:contact:v1:select';
export const CONTACT_PAGE_SIZE = 5;
export const contactScope = (guildId, openerId) => ({ guildId, type: 'staff-contact', openerId });

export function contactRecipientIds(values) {
  requireCondition(Array.isArray(values) && values.length >= 1 && values.length <= MAX_CASE_PARTICIPANTS && new Set(values).size === values.length,
    'INVALID_CONTACT_RECIPIENTS');
  values.forEach(requireId); return [...values].sort();
}

/** Resolved Discord members/roles are deliberately ignored. Current core policy decides eligibility. */
export function parseContactSelection(data) {
  requireKeys(data, ['component_type', 'custom_id', 'values', ...(Object.hasOwn(data, 'resolved') ? ['resolved'] : []), ...(Object.hasOwn(data, 'id') ? ['id'] : [])]);
  if (Object.hasOwn(data, 'id')) requireInteger(data.id, 0, 4_294_967_295);
  requireCondition(data.component_type === 5 && data.custom_id === CONTACT_SELECT_ID, 'INVALID_CONTACT_CONTROL');
  return { command: 'ticket.contact.select', recipientIds: Object.freeze(contactRecipientIds(data.values)) };
}
export function parseContactControl(value) {
  const match = /^sophie:contact:v1:(confirm|cancel|destination|queue):([a-f0-9]{48}|start)$/.exec(value);
  requireCondition(match !== null && (match[2] !== 'start' || match[1] === 'queue'), 'INVALID_CONTACT_CONTROL');
  if (match[2] !== 'start') requireCaseToken(match[2]);
  const key = match[1] === 'queue' ? 'after' : match[1] === 'destination' ? 'caseToken' : 'formToken';
  return { command: `ticket.contact.${match[1]}`, [key]: match[2] === 'start' ? null : match[2] };
}
const button = (action, token, label, style = 2) => ({ type: 2, style, label, custom_id: `sophie:contact:v1:${action}:${token}` });
const row = components => ({ type: 1, components });
export function caseContactReply(value, text = defaultSystemText) {
  const base = { embeds: [], components: [] };
  if (value.state === 'select') return { ...base, content: text("tickets.contacts.choose_the_people_for_this_staff_contact_you__a9b2c8"),
    components: [row([{ type: 5, custom_id: CONTACT_SELECT_ID, min_values: 1, max_values: MAX_CASE_PARTICIPANTS, placeholder: text("tickets.contacts.select_contact_recipients_e5f48b") }])] };
  if (value.state === 'review') {
    requireCaseToken(value.token); requireId(value.openerId); const ids = contactRecipientIds(value.recipientIds);
    return { ...base, content: text("tickets.contacts.staff_contact_audience_creator_selected_recip_6bd64b", { openerId: value.openerId, value: ids.join(', ') }),
      components: [row([button('confirm', value.token, text("tickets.contacts.confirm_audience_and_open_form_4eac1d"), 1), button('cancel', value.token, text("tickets.contacts.cancel_19766e"))])] };
  }
  if (value.state === 'queue') {
    requireCondition(Array.isArray(value.items) && value.items.length <= CONTACT_PAGE_SIZE, 'INVALID_CONTACT_QUEUE');
    const descriptions = [], buttons = value.items.map((item, index) => {
      requireCaseToken(item.token); requireId(item.openerId); requireInteger(item.createdAt, 0, 8_640_000_000_000_000);
      requireCondition(['preparing', 'open', 'closed'].includes(item.access), 'INVALID_CONTACT_QUEUE');
      descriptions.push(text("tickets.contacts.created_by_utc_8169f3", { value: index + 1, openerId: item.openerId, value3: new Date(item.createdAt).toISOString().slice(0, 16).replace('T', ' '), value4: item.access === 'closed' ? text("tickets.contacts.read_only_72bb90") : item.access === 'open' ? text("tickets.contacts.open_ed077f") : text("tickets.contacts.preparing_cf1aa6") }));
      return button('destination', item.token, text("tickets.contacts.open_contact_07e561", { value: index + 1 }));
    });
    if (value.next !== null) requireCaseToken(value.next);
    return { ...base, content: value.items.length ? text("tickets.contacts.your_staff_contacts_each_destination_is_check_a00e47", { value: descriptions.join('\n') }) : text("tickets.contacts.no_available_staff_contacts_on_this_page_08acfc"),
      components: [...(buttons.length ? [row(buttons)] : []), row([button('queue', 'start', text("tickets.contacts.refresh_0e9161")), ...(value.next === null ? [] : [button('queue', value.next, text("tickets.contacts.next_1ff57a"))])])] };
  }
  if (value.state === 'ready') {
    requireId(value.guildId); requireId(value.channelId);
    return { ...base, content: value.access === 'closed' ? text("tickets.contacts.this_staff_contact_is_closed_and_available_to_a364e6") : text("tickets.contacts.your_staff_contact_is_ready_6a0626"),
      components: [row([{ type: 2, style: 5, label: text("tickets.contacts.open_staff_contact_2465b0"), url: `https://discord.com/channels/${value.guildId}/${value.channelId}` }])] };
  }
  if (value.state === 'preparing') {
    requireCaseToken(value.caseToken); return { ...base, content: text("tickets.contacts.this_staff_contact_is_waiting_for_its_current_062683"),
      components: [row([button('destination', value.caseToken, text("tickets.contacts.check_contact_597227"))])] };
  }
  return { ...base, content: value.state === 'cancelled' ? text("tickets.contacts.contact_selection_cancelled_no_case_was_creat_62ff9c") :
    value.state === 'denied' ? text("tickets.contacts.this_staff_contact_is_not_available_under_you_5d6527") : text("tickets.contacts.this_staff_contact_is_currently_unavailable_u_7413a7") };
}

export const caseContactCommandOptions = () => [
  { type: 1, name: 'contact', description: 'Staff: select recipients and create a private contact' },
  { type: 1, name: 'contacts', description: 'Find your currently available Staff contacts' },
];
