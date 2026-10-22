import { requireCondition, requireInteger } from '../../contracts/validation.js';
import { defaultSystemText } from '../../contracts/system-messages.js';
import { MEMORY_NOTE_LENGTH, MEMORY_NOTE_LIMIT } from './preferences.js';

// Owner decision, 23 October 2026: members choose Yes or No for the whole server, and manage what Sophie keeps, from a
// private panel in Discord (an ephemeral reply or a DM). Rendering only: every control is re-checked by core when used,
// and a component ID never carries authority (only the notice a Yes accepts, which core compares with the current one).
export const SOPHIE_CONTROL_PREFIX = 'sophie:me:v1:';
export const SOPHIE_NOTES_FORM = `${SOPHIE_CONTROL_PREFIX}notes-form`;
const NOTICE_DISPLAY_LIMIT = 4096;
const actions = Object.freeze({ panel: 'sophie.panel', notice: 'sophie.notice', no: 'sophie.no', notes: 'sophie.notes', export: 'sophie.export',
  'delete-ask': 'sophie.delete.ask', delete: 'sophie.delete', 'forget-ask': 'sophie.forget.ask', forget: 'sophie.forget', dm: 'sophie.dm' });

export function sophieCommandDefinition() {
  return { type: 1, name: 'sophie', description: 'Choose whether Sophie talks with you, and manage what she keeps.', options: [] };
}

export function parseSophieCommand(options) {
  requireCondition(options === undefined || Array.isArray(options) && options.length === 0, 'INTERACTION_OPTIONS_INVALID');
  return { command: 'sophie.panel' };
}

/** `agree:<revision>:<binding>` names the notice the member read; `retain:on|off` the keep-on-leave choice. */
export function parseSophieControl(customId) {
  requireCondition(typeof customId === 'string' && customId.startsWith(SOPHIE_CONTROL_PREFIX) && customId.length <= 100, 'INTERACTION_COMPONENT_UNSUPPORTED');
  const [action, ...rest] = customId.slice(SOPHIE_CONTROL_PREFIX.length).split(':');
  if (action === 'agree') {
    requireCondition(rest.length === 2 && /^[1-9][0-9]{0,9}$/u.test(rest[0]) && (rest[1] === 'none' || /^[a-f0-9]{64}$/u.test(rest[1])), 'INTERACTION_COMPONENT_UNSUPPORTED');
    const noticeRevision = Number(rest[0]); requireInteger(noticeRevision, 1, 2147483646);
    return { command: 'sophie.agree', noticeRevision, noticeBinding: rest[1] === 'none' ? null : rest[1] };
  }
  if (action === 'retain') {
    requireCondition(rest.length === 1 && ['on', 'off'].includes(rest[0]), 'INTERACTION_COMPONENT_UNSUPPORTED');
    return { command: 'sophie.retain', retainOnLeave: rest[0] === 'on' };
  }
  requireCondition(rest.length === 0 && Object.hasOwn(actions, action), 'INTERACTION_COMPONENT_UNSUPPORTED');
  return { command: actions[action] };
}

/** One paragraph field, one note per line. Validation of each note is the preference contract's. */
export function parseSophieNotes(data) {
  requireCondition(data?.custom_id === SOPHIE_NOTES_FORM && Array.isArray(data.components) && data.components.length === 1, 'INTERACTION_FORM_INVALID');
  const row = data.components[0], field = row?.components?.[0];
  requireCondition(row?.type === 1 && row.components.length === 1 && field?.type === 4 && field.custom_id === 'notes' &&
    typeof field.value === 'string' && field.value.length <= MEMORY_NOTE_LIMIT * (MEMORY_NOTE_LENGTH + 1) && field.value.isWellFormed(), 'INTERACTION_FORM_INVALID');
  const notes = field.value.split(/\r?\n/u).map(line => line.trim()).filter(line => line.length > 0);
  requireCondition(notes.length <= MEMORY_NOTE_LIMIT && notes.every(note => note.length <= MEMORY_NOTE_LENGTH), 'INTERACTION_FORM_INVALID');
  return [...new Set(notes)];
}

export function sophieNotesModal(notes, text = defaultSystemText) {
  requireCondition(Array.isArray(notes) && notes.length <= MEMORY_NOTE_LIMIT, 'INTERACTION_RESPONSE_INVALID');
  return { type: 9, data: { custom_id: SOPHIE_NOTES_FORM, title: text('ai.notes.title'), components: [{ type: 1, components: [{ type: 4, custom_id: 'notes', style: 2,
    label: text('ai.notes.label'), placeholder: text('ai.notes.placeholder'), required: false, max_length: MEMORY_NOTE_LIMIT * (MEMORY_NOTE_LENGTH + 1),
    ...(notes.length ? { value: notes.join('\n') } : {}) }] }] } };
}

const button = (label, action, style = 2, disabled = false) => ({ type: 2, style, label, custom_id: `${SOPHIE_CONTROL_PREFIX}${action}`, ...(disabled ? { disabled: true } : {}) });
const row = (...components) => ({ type: 1, components: components.filter(Boolean) });

/**
 * view: { state: 'yes'|'renew'|'no'|'none'|'deleting'|'unavailable', optInAvailable, noticeRevision, notes: string[],
 * memories: { active, count }, retainOnLeave, direct }
 */
export function renderSophiePanel(view, text = defaultSystemText, banner = null) {
  requireCondition(['yes', 'renew', 'no', 'none', 'deleting', 'unavailable'].includes(view?.state), 'INTERACTION_RESPONSE_INVALID');
  const lines = [text(`ai.panel.${view.state}`)];
  if (view.state !== 'deleting' && view.state !== 'unavailable') {
    lines.push(text('ai.panel.notes', { count: String(view.notes.length) }));
    if (view.memories.active) lines.push(text('ai.panel.memories', { count: String(view.memories.count) }));
    lines.push(text(view.retainOnLeave ? 'ai.panel.retain_on' : 'ai.panel.retain_off'));
  }
  const embed = { title: text('ai.panel.title'), description: lines.join('\n\n') };
  if (view.state === 'deleting' || view.state === 'unavailable') {
    return { content: banner ?? '', embeds: [embed], components: [row(button(text('ai.button.refresh'), 'panel'))] };
  }
  const canSayYes = view.optInAvailable && view.state !== 'yes';
  return { content: banner ?? '', embeds: [embed], components: [
    row(canSayYes ? button(text(view.state === 'renew' ? 'ai.button.renew' : 'ai.button.yes'), 'notice', 3) : null,
      view.state === 'yes' || view.state === 'renew' ? button(text('ai.button.no'), 'no', 4) : null,
      button(text('ai.button.notes'), 'notes')),
    row(button(text('ai.button.export'), 'export'), button(text('ai.button.forget'), 'forget-ask', 2, view.memories.count === 0),
      button(text('ai.button.delete'), 'delete-ask', 4)),
    row(button(text(view.retainOnLeave ? 'ai.button.retain_off' : 'ai.button.retain_on'), `retain:${view.retainOnLeave ? 'off' : 'on'}`),
      view.direct ? null : button(text('ai.button.dm'), 'dm'), button(text('ai.button.refresh'), 'panel')),
  ].filter(item => item.components.length > 0) };
}

/** The notice is shown whole before a Yes; one too long for a Discord embed is refused rather than cut. */
export function renderSophieNotice(view, text = defaultSystemText) {
  const notice = typeof view?.noticeText === 'string' ? view.noticeText : '';
  if (!view?.optInAvailable || notice.length === 0 || notice.length > NOTICE_DISPLAY_LIMIT) {
    return { content: text('ai.notice.unavailable'), embeds: [], components: [row(button(text('ai.button.back'), 'panel'))] };
  }
  requireInteger(view.noticeRevision, 1, 2147483646);
  requireCondition(view.noticeBinding === null || /^[a-f0-9]{64}$/u.test(view.noticeBinding), 'INTERACTION_RESPONSE_INVALID');
  return { content: text('ai.notice.intro'), embeds: [{ title: text('ai.notice.title'), description: notice }],
    components: [row(button(text('ai.button.agree'), `agree:${view.noticeRevision}:${view.noticeBinding ?? 'none'}`, 3), button(text('ai.button.back'), 'panel'))] };
}

export function renderSophieConfirmation(kind, text = defaultSystemText) {
  requireCondition(['delete', 'forget'].includes(kind), 'INTERACTION_RESPONSE_INVALID');
  return { content: text(`ai.confirm.${kind}`), embeds: [], components: [row(button(text(`ai.button.${kind}_confirm`), kind, 4), button(text('ai.button.back'), 'panel'))] };
}

/** What the transport may send outside an interaction reply: fixed panel text and Sophie panel buttons only. */
export function validateSophiePanel(panel) {
  requireCondition(panel !== null && typeof panel === 'object' && Object.keys(panel).every(key => ['content', 'embeds', 'components'].includes(key)) &&
    typeof panel.content === 'string' && panel.content.length <= 2000 && Array.isArray(panel.components) && panel.components.length <= 5, 'SOPHIE_PANEL_INVALID');
  const embeds = panel.embeds ?? [];
  requireCondition(Array.isArray(embeds) && embeds.length <= 1 && embeds.every(embed => Object.keys(embed).every(key => ['title', 'description'].includes(key)) &&
    typeof embed.title === 'string' && embed.title.length <= 256 && typeof embed.description === 'string' && embed.description.length <= NOTICE_DISPLAY_LIMIT), 'SOPHIE_PANEL_INVALID');
  for (const line of panel.components) requireCondition(line?.type === 1 && Array.isArray(line.components) && line.components.length >= 1 && line.components.length <= 5 &&
    line.components.every(item => item?.type === 2 && typeof item.custom_id === 'string' && item.custom_id.startsWith(SOPHIE_CONTROL_PREFIX) && item.custom_id.length <= 100 &&
      typeof item.label === 'string' && item.label.length <= 80), 'SOPHIE_PANEL_INVALID');
  return panel;
}

/** Static, non-AI invitation posted once a day at most to a member without a choice who addresses Sophie. */
export function renderSophieInvitation(text = defaultSystemText) {
  return { content: text('ai.invite'), components: [row(button(text('ai.button.setup'), 'panel', 1))] };
}
