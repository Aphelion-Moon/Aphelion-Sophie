import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys, requireRecord } from '../../contracts/validation.js';
import { CASE_TYPES } from './index.js';

export const PUBLIC_CASE_TYPES = Object.freeze(CASE_TYPES.filter(type => type.publicEntry).map(type => type.id));
export const INTAKE_CASE_TYPES = Object.freeze([...PUBLIC_CASE_TYPES, 'player-report', 'staff-contact']);
export const FORM_CASE_TYPES = Object.freeze(INTAKE_CASE_TYPES.filter(type => type !== 'quick-help'));
/** A reported identity is retained context only, never a case participant or authorization target. */
export function requireCaseSubject(caseType, subjectId) {
  requireCondition(INTAKE_CASE_TYPES.includes(caseType) && (subjectId === null || caseType === 'player-report'), 'INVALID_CASE_SUBJECT');
  if (subjectId !== null) requireId(subjectId);
}
export function requireFormToken(value) { requireCondition(typeof value === 'string' && /^[a-f0-9]{48}$/.test(value), 'INVALID_CASE_FORM_TOKEN'); }
const fieldId = value => requireCondition(typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value), 'INVALID_CASE_FORM_FIELD');
function text(value, maximum, { empty = false, multiline = false } = {}) {
  requireCondition(typeof value === 'string' && value.length <= maximum && (empty || value.trim().length > 0) && value.isWellFormed() &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) && (multiline || !/[\r\n]/.test(value)), 'INVALID_CASE_FORM_TEXT');
}

/** Bounded authored data only. No participant grants, executable conditions, files or remote sources. */
function canonicalForm(value, draft) {
  requireKeys(value, ['caseType', 'title', 'fields']);
  requireCondition(FORM_CASE_TYPES.includes(value.caseType), 'INVALID_CASE_FORM_TYPE'); text(value.title, 45, { empty: draft });
  requireCondition(Array.isArray(value.fields) && value.fields.length >= (draft ? 0 : 1) && value.fields.length <= 5, 'INVALID_CASE_FORM_FIELDS');
  const fields = value.fields.map(field => {
    requireCondition(['short', 'paragraph', 'select'].includes(field?.kind), 'INVALID_CASE_FORM_FIELD');
    requireKeys(field, ['id', 'kind', 'label', 'description', 'required', field.kind === 'select' ? 'options' : 'maxLength']);
    fieldId(field.id); text(field.label, 45, { empty: draft }); text(field.description, 100, { empty: true });
    requireCondition(typeof field.required === 'boolean', 'INVALID_CASE_FORM_FIELD');
    const base = { id: field.id, kind: field.kind, label: field.label, description: field.description, required: field.required };
    if (field.kind !== 'select') { requireInteger(field.maxLength, 1, 4_000); return { ...base, maxLength: field.maxLength }; }
    requireCondition(Array.isArray(field.options) && field.options.length >= (draft ? 0 : 1) && field.options.length <= 25, 'INVALID_CASE_FORM_OPTIONS');
    const options = field.options.map(option => { requireKeys(option, ['value', 'label']); fieldId(option.value); text(option.label, 100, { empty: draft }); return { value: option.value, label: option.label }; });
    requireCondition(new Set(options.map(option => option.value)).size === options.length, 'INVALID_CASE_FORM_OPTIONS'); return { ...base, options };
  });
  requireCondition(new Set(fields.map(field => field.id)).size === fields.length, 'INVALID_CASE_FORM_FIELDS');
  return { caseType: value.caseType, title: value.title, fields };
}
export const canonicalCaseForm = value => canonicalForm(value, false);
/** Incomplete authored copy only; never accepted by intake or modal rendering. */
export const canonicalCaseFormDraft = value => canonicalForm(value, true);

/** Canonical field order and exact types; never truncate or silently drop a submitted value. */
export function canonicalCaseAnswers(form, values) {
  const fixed = canonicalCaseForm(form);
  requireCondition(Array.isArray(values) && values.length === fixed.fields.length &&
    new Set(values.map(value => value?.id)).size === values.length, 'INVALID_CASE_FORM_ANSWERS');
  return fixed.fields.map(field => {
    const supplied = values.find(value => value?.id === field.id); requireKeys(supplied, ['id', 'kind', 'value'], 'INVALID_CASE_FORM_ANSWERS');
    if (field.kind === 'select') {
      requireCondition(supplied.kind === 'select' && Array.isArray(supplied.value) && supplied.value.length <= 1 &&
        (!field.required || supplied.value.length === 1) && supplied.value.every(value => field.options.some(option => option.value === value)), 'INVALID_CASE_FORM_ANSWERS');
      return { id: field.id, kind: 'select', value: [...supplied.value] };
    }
    requireCondition(supplied.kind === 'text', 'INVALID_CASE_FORM_ANSWERS');
    text(supplied.value, field.maxLength, { empty: !field.required, multiline: field.kind === 'paragraph' });
    return { id: field.id, kind: 'text', value: supplied.value };
  });
}

/** Parse only the supported modal wire fields; resolved entities/files and extra nesting are rejected. */
export function parseCaseFormSubmission(data) {
  requireKeys(data, ['custom_id', 'components'], 'INVALID_CASE_FORM_SUBMISSION');
  const match = /^sophie:ticket-form:v1:([a-f0-9]{48})$/.exec(data.custom_id); requireCondition(match !== null, 'INVALID_CASE_FORM_TOKEN');
  requireCondition(Array.isArray(data.components) && data.components.length >= 1 && data.components.length <= 5, 'INVALID_CASE_FORM_SUBMISSION');
  const values = data.components.map(label => {
    requireRecord(label, 'INVALID_CASE_FORM_SUBMISSION');
    requireKeys(label, ['type', 'component', ...(Object.hasOwn(label, 'id') ? ['id'] : [])], 'INVALID_CASE_FORM_SUBMISSION');
    requireCondition(label.type === 18, 'INVALID_CASE_FORM_SUBMISSION'); if (label.id !== undefined) requireInteger(label.id, 0, 4_294_967_295);
    const child = label.component; requireCondition(child?.type === 4 || child?.type === 3, 'INVALID_CASE_FORM_SUBMISSION');
    requireKeys(child, ['type', 'custom_id', child.type === 4 ? 'value' : 'values', ...(Object.hasOwn(child, 'id') ? ['id'] : [])], 'INVALID_CASE_FORM_SUBMISSION');
    if (child.id !== undefined) requireInteger(child.id, 0, 4_294_967_295); fieldId(child.custom_id);
    if (child.type === 4) { text(child.value, 4_000, { empty: true, multiline: true }); return { id: child.custom_id, kind: 'text', value: child.value }; }
    requireCondition(Array.isArray(child.values) && child.values.length <= 1, 'INVALID_CASE_FORM_SUBMISSION'); child.values.forEach(fieldId);
    return { id: child.custom_id, kind: 'select', value: [...child.values] };
  });
  requireCondition(new Set(values.map(value => value.id)).size === values.length, 'INVALID_CASE_FORM_SUBMISSION');
  return { formToken: match[1], values };
}

export function caseFormModal({ form, token }) {
  const fixed = canonicalCaseForm(form); requireFormToken(token);
  return { type: 9, data: { custom_id: `sophie:ticket-form:v1:${token}`, ...caseFormPresentation(fixed) } };
}

/** Static authored presentation, without a usable modal handle or submitted content. */
export function caseFormPresentation(form) {
  const fixed = canonicalCaseForm(form);
  return { title: fixed.title, components: fixed.fields.map(field => ({
    type: 18, label: field.label, ...(field.description ? { description: field.description } : {}), component: field.kind === 'select' ? {
      type: 3, custom_id: field.id, options: field.options, min_values: field.required ? 1 : 0, max_values: 1, required: field.required,
    } : { type: 4, custom_id: field.id, style: field.kind === 'short' ? 1 : 2, required: field.required,
      min_length: field.required ? 1 : 0, max_length: field.maxLength },
  })) };
}

export function parseCaseIntakeControl(value) {
  requireCondition(typeof value === 'string', 'INVALID_CASE_INTAKE_CONTROL');
  const open = /^sophie:ticket:v1:open:([a-z-]+)$/.exec(value);
  if (open) { requireCondition(PUBLIC_CASE_TYPES.includes(open[1]), 'INVALID_PUBLIC_CASE_TYPE'); return { command: 'ticket.begin', caseType: open[1] }; }
  const status = /^sophie:ticket:v1:status:([a-f0-9]{48})$/.exec(value);
  requireCondition(status !== null, 'INVALID_CASE_INTAKE_CONTROL'); return { command: 'ticket.destination', caseToken: status[1] };
}

/** Static buttons; visibility/custom IDs confer no creation or case-read authority. */
export function ticketEntryPanel(text = defaultSystemText) {
  const buttons = CASE_TYPES.filter(type => type.publicEntry).map(type => ({ type: 2, style: type.id === 'head-admin-contact' ? 4 : 2,
    label: text(`tickets.type.${type.id}`), custom_id: `sophie:ticket:v1:open:${type.id}` }));
  return { content: text("tickets.intake.ticket_nexus_choose_the_help_you_need_quick_h_4fea6a"),
    allowed_mentions: { parse: [] }, components: [{ type: 1, components: buttons.slice(0, 5) }, { type: 1, components: buttons.slice(5) }] };
}

export function caseIntakeCommandOptions() {
  return [
    { type: 1, name: 'open', description: 'Open a private support request.', options: [
      { type: 3, name: 'type', description: 'The help you need.', required: true,
        choices: CASE_TYPES.filter(type => type.publicEntry).map(type => ({ name: type.label, value: type.id })) },
    ] },
    { type: 1, name: 'report', description: 'Open a private player report. The reported player is not invited.', options: [
      { type: 6, name: 'player', description: 'Optional reported Discord user; this does not grant them ticket access.' },
    ] },
  ];
}

export function ticketDestinationReply(view, text = defaultSystemText) {
  requireCondition(view !== null && typeof view === 'object', 'INVALID_CASE_DESTINATION');
  if (view.state === 'ready') {
    requireKeys(view, ['state', "guildId", "channelId"]); requireId(view.guildId); requireId(view.channelId);
    return { content: text("tickets.intake.your_private_ticket_channel_is_ready_7a0c67"), components: [{ type: 1, components: [{
      type: 2, style: 5, label: text("tickets.intake.open_ticket_d7e039"), url: `https://discord.com/channels/${view.guildId}/${view.channelId}`,
    }] }] };
  }
  if (view.state === 'preparing') {
    requireKeys(view, ['state', "caseToken"]); requireFormToken(view.caseToken);
    return { content: text("tickets.intake.your_ticket_request_is_recorded_its_channel_a_dc9321"), components: [{ type: 1, components: [{
      type: 2, style: 1, label: text("tickets.intake.check_ticket_0e2d88"), custom_id: `sophie:ticket:v1:status:${view.caseToken}`,
    }] }] };
  }
  requireKeys(view, ['state']); requireCondition(['denied', 'unavailable', 'closed', 'disabled'].includes(view.state), 'INVALID_CASE_DESTINATION');
  const messages = { denied: text("tickets.intake.this_ticket_is_not_available_under_your_curre_f445a0"), unavailable: text("tickets.intake.this_ticket_destination_could_not_be_verified_be3d3d"),
    closed: text("tickets.intake.this_ticket_is_closed_or_requires_staff_revie_5d5f69"), disabled: text("tickets.intake.sophie_commands_are_currently_disabled_4b861d") };
  return { content: messages[view.state], components: [] };
}
