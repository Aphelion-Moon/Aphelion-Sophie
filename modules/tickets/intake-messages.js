import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { CASE_TYPES } from './index.js';
import { responderRoles } from '../../platform/authorization/case-responders.js';
import { canonicalCaseForm, canonicalCaseAnswers, INTAKE_CASE_TYPES, requireCaseSubject } from './intake.js';

export const requireIntakeMessageId = value => requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'INVALID_INTAKE_MESSAGE');
export function intakeMessageMarker(id) { requireIntakeMessageId(id); return `sophie:ticket-intake:v1:${id}`; }
export function intakeResponderRole(type, policy) {
  requireCondition(INTAKE_CASE_TYPES.includes(type), 'INVALID_PUBLIC_CASE_TYPE');
  const role = responderRoles(policy, type)[0]; requireId(role); return role;
}
const markdown = new Set([92, 96, 42, 95, 123, 125, 91, 93, 40, 41, 35, 43, 46, 33, 60, 62, 124, 126, 61, 45]);
/** Split escaped characters as units: neither surrogate pairs nor escape sequences are divided. */
export function intakeTextParts(value) {
  requireCondition(typeof value === 'string' && value.length <= 4_000 && value.isWellFormed(), 'INVALID_INTAKE_MESSAGE');
  const parts = []; let part = '';
  for (const character of value) {
    const escaped = markdown.has(character.codePointAt(0)) ? String.fromCharCode(92) + character : character;
    if (part.length + escaped.length > 3_500) { parts.push(part); part = ''; }
    part += escaped;
  }
  parts.push(part); return parts;
}

/** Exact submitted values rendered as labelled text, never a summary or access decision. Format v1 is retained. */
export function caseIntakePages({ caseType, form, formVersion, answers, subjectId = null }, localize = defaultSystemText) {
  requireCondition(INTAKE_CASE_TYPES.includes(caseType), 'INVALID_PUBLIC_CASE_TYPE'); requireCaseSubject(caseType, subjectId); const pages = [];
  if (caseType === 'quick-help') requireCondition(form === null && formVersion === null && Array.isArray(answers) && answers.length === 0, 'INVALID_INTAKE_MESSAGE');
  else {
    requireInteger(formVersion, 1); const fixed = canonicalCaseForm(form), values = canonicalCaseAnswers(fixed, answers);
    requireCondition(fixed.caseType === caseType, 'INVALID_INTAKE_MESSAGE');
    for (const [index, field] of fixed.fields.entries()) {
      const answer = values[index], text = field.kind === 'select' ? (answer.value.length ? field.options.find(option => option.value === answer.value[0]).label : '') : answer.value;
      const parts = intakeTextParts(text || localize('tickets.intake.empty'));
      for (const [fragment, part] of parts.entries()) pages.push({ kind: 'answer',
        title: `${index + 1}. ${field.label}${parts.length > 1 ? ` (${fragment + 1}/${parts.length})` : ''}`,
        description: localize('tickets.intake.response', { answer: part }) });
    }
  }
  pages.push({ kind: 'notice', title: localize('tickets.intake.title', { type: localize(`tickets.type.${caseType}`) }),
    description: caseType === 'quick-help' ? localize('tickets.intake.quick') :
      localize('tickets.intake.submitted', { version: formVersion }) });
  if (caseType === 'player-report') pages.at(-1).description += subjectId === null ?
    localize('tickets.intake.no_subject') :
    localize('tickets.intake.subject', { userId: subjectId });
  requireCondition(pages.length >= 1 && pages.length <= 16, 'INVALID_INTAKE_MESSAGE'); return pages;
}

export function renderCaseIntakeMessage({ id, page, caseType, policy }) {
  requireIntakeMessageId(id); requireKeys(page, ['kind', 'title', 'description']);
  requireCondition(['answer', 'notice'].includes(page.kind), 'INVALID_INTAKE_MESSAGE');
  const roles = page.kind === 'notice' ? [intakeResponderRole(caseType, policy)] : [];
  const payload = { content: roles.length ? `<@&${roles[0]}>` : '', embeds: [{ title: page.title, description: page.description, footer: { text: intakeMessageMarker(id) } }],
    components: [], allowed_mentions: { parse: [], roles, users: [], replied_user: false } };
  validateCaseIntakePayload(payload, id); return payload;
}
export function validateCaseIntakePayload(value, id) {
  requireIntakeMessageId(id); requireKeys(value, ['content', 'embeds', 'components', 'allowed_mentions']);
  const mentions = value.allowed_mentions; requireKeys(mentions, ['parse', 'roles', 'users', 'replied_user']);
  requireCondition(Array.isArray(mentions.roles) && mentions.roles.length <= 1 && Array.isArray(mentions.users) && mentions.users.length === 0 &&
    Array.isArray(mentions.parse) && mentions.parse.length === 0 && mentions.replied_user === false, 'INVALID_INTAKE_MESSAGE'); mentions.roles.forEach(requireId);
  requireCondition(value.content === (mentions.roles.length ? `<@&${mentions.roles[0]}>` : '') && Array.isArray(value.components) && value.components.length === 0 &&
    Array.isArray(value.embeds) && value.embeds.length === 1, 'INVALID_INTAKE_MESSAGE');
  const embed = value.embeds[0]; requireKeys(embed, ['title', 'description', 'footer']); requireKeys(embed.footer, ['text']);
  requireCondition(embed.footer.text === intakeMessageMarker(id) && typeof embed.title === 'string' && embed.title.length > 0 && embed.title.length <= 256 &&
    typeof embed.description === 'string' && embed.description.length > 0 && embed.description.length <= 4_096 &&
    embed.title.isWellFormed() && embed.description.isWellFormed(), 'INVALID_INTAKE_MESSAGE');
}
