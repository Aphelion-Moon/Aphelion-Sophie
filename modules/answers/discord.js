import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireInteger } from '../../contracts/validation.js';
import { canonicalAnswer, requireAnswerName, requireAnswerHash } from './index.js';

export function answerCommandDefinition() {
  return { type: 1, name: 'answer', description: 'Look up approved public answers.', options: [
    { type: 1, name: 'list', description: 'List currently published answers.', options: [
      { type: 3, name: 'after', description: 'Continue after the name shown on the previous page.', max_length: 40 },
    ] },
    { type: 1, name: 'show', description: 'Read a currently published answer.', options: [
      { type: 3, name: 'name', description: 'Exact answer name from /answer list.', required: true, max_length: 40 },
    ] },
  ] };
}

export function parseAnswerCommand(options) {
  requireCondition(Array.isArray(options) && options.length === 1 && options[0]?.type === 1 &&
    ['list', 'show'].includes(options[0].name) && options[0].value === undefined, 'INTERACTION_OPTIONS_INVALID');
  const action = options[0].name, fields = options[0].options ?? [], field = action === 'list' ? 'after' : 'name';
  requireCondition(Array.isArray(fields) && (fields.length === 1 || (action === 'list' && fields.length === 0)) &&
    fields.every(value => value?.type === 3 && value.name === field && value.options === undefined), 'INTERACTION_OPTIONS_INVALID');
  if (fields.length) requireAnswerName(fields[0].value);
  return { command: `answer.${action}`, ...(action === 'list' ? { after: fields[0]?.value ?? null } : { answerName: fields[0].value }) };
}

/** Full approved text fits a single embed; no truncation, fetched URLs or case data. */
export function answerLookupReply(view, text = defaultSystemText) {
  if (view.status !== 'available') return { content: view.status === 'denied' ?
    text("answers.discord.this_lookup_requires_current_guild_membership_f22249") : view.status === 'disabled' ? text("answers.discord.sophie_commands_are_currently_disabled_4b861d") :
      text("answers.discord.this_public_answer_is_unavailable_use_answer__a4f121"), embeds: [], components: [] };
  if (view.kind === 'show') {
    const entry = view.entry, document = canonicalAnswer(entry.document);
    requireAnswerName(entry.name); requireAnswerHash(entry.sha256); requireInteger(entry.revision, 1, 2_147_483_646);
    requireCondition(entry.action === 'publish', 'ANSWER_UNAVAILABLE');
    return { content: text("answers.discord.approved_public_answer_revision_7365b1", { name: entry.name, revision: entry.revision }),
      embeds: [{ title: document.title, description: document.text, footer: { text: document.source } }], components: [] };
  }
  requireCondition(view.kind === 'list' && Array.isArray(view.entries) && view.entries.length <= 25, 'ANSWER_INPUT_INVALID');
  // Names alone keep the page bounded and avoid treating authored titles as navigation markup.
  const lines = view.entries.map(entry => { requireAnswerName(entry.name); return entry.name; });
  if (view.next !== null) requireAnswerName(view.next);
  return { content: lines.length ? text("answers.discord.use_answer_show_name_name_to_read_an_answer_a1a94e", { value: lines.join('\n'), value2: view.next === null ?
    text("answers.discord.end_of_current_publications_c566a7") : text("answers.discord.next_page_answer_list_after_400e91", { next: view.next }) }) : text("answers.discord.no_published_answers_on_this_page_70f527"), embeds: [], components: [] };
}
