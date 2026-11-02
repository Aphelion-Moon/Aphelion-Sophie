/**
 * Reads an owner knowledge draft prepared offline (for example distilled from a Discord harvest packet) into the
 * knowledge editor's fields. It only fills the editor: the owner still reviews and confirms through the existing review
 * and publish flow, and the server checks the document again. The limits are those of modules/assistant/knowledge.js.
 */
export const KNOWLEDGE_DRAFT_FORMAT = 'sophie-knowledge-draft-1';
export const KNOWLEDGE_DRAFT_LIMITS = Object.freeze({ fileBytes: 262144, title: 200, url: 1000, rights: 300, attribution: 500, sourceRevision: 160,
  aliases: 20, alias: 100, sections: 16, heading: 160, sectionText: 4000, totalText: 32000 });
const KEYS = ['format', 'id', 'title', 'authority', 'url', 'rights', 'attribution', 'sourceRevision', 'aliases', 'sections'];
const AUTHORITIES = ['reference', 'policy', 'lore', 'community-event'];
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u;
const usable = (value, limit) => typeof value === 'string' && value.length <= limit && value.isWellFormed() && !control.test(value);
// The editor's single-line inputs cannot hold a line break, and its alias box splits on them.
const line = (value, limit) => usable(value, limit) && !/[\r\n]/u.test(value);
const filled = value => value.trim().length > 0;

/** @returns {{ ok: true, draft: object } | { ok: false, problem: string }} */
export function readKnowledgeDraft(text) {
  const L = KNOWLEDGE_DRAFT_LIMITS, refuse = problem => ({ ok: false, problem });
  if (typeof text !== 'string' || text.length > L.fileBytes) return refuse('The file is larger than a draft can be.');
  let value;
  try { value = JSON.parse(text); } catch { return refuse('The file is not JSON.'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value.format !== KNOWLEDGE_DRAFT_FORMAT) return refuse('The file is not a Sophie knowledge draft.');
  if (Object.keys(value).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(value, key))) return refuse(`A draft has exactly these fields: ${KEYS.join(', ')}.`);
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/u.test(value.id)) return refuse('The document name must start with a letter and use up to 48 lowercase letters, digits and hyphens.');
  if (!line(value.title, L.title) || !filled(value.title)) return refuse(`The title must be one line of 1 to ${L.title} characters.`);
  if (!AUTHORITIES.includes(value.authority)) return refuse(`The authority must be one of ${AUTHORITIES.join(', ')}.`);
  for (const [key, limit] of [['url', L.url], ['rights', L.rights], ['attribution', L.attribution], ['sourceRevision', L.sourceRevision]]) {
    if (!line(value[key], limit)) return refuse(`${key} must be one line of up to ${limit} characters (it may be empty).`);
  }
  if (value.url) {
    let url = null;
    try { url = new URL(value.url); } catch { /* Reported below. */ }
    if (url?.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return refuse('The source link must be an https address without a port or #fragment.');
  }
  const aliases = value.aliases;
  if (!Array.isArray(aliases) || aliases.length > L.aliases || new Set(aliases).size !== aliases.length) return refuse(`A draft has up to ${L.aliases} distinct lookup names.`);
  if (!aliases.every(alias => line(alias, L.alias) && filled(alias) && alias === alias.trim())) return refuse(`Each lookup name is one trimmed line of 1 to ${L.alias} characters.`);
  const sections = value.sections;
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > L.sections) return refuse(`A draft has 1 to ${L.sections} sections.`);
  let total = 0;
  for (const [index, section] of sections.entries()) {
    if (section === null || typeof section !== 'object' || Array.isArray(section) || Object.keys(section).length !== 2 ||
      !Object.hasOwn(section, 'heading') || !Object.hasOwn(section, 'text')) return refuse(`Section ${index + 1} must have exactly a heading and a text.`);
    if (!line(section.heading, L.heading) || !filled(section.heading)) return refuse(`Section ${index + 1}'s heading must be one line of 1 to ${L.heading} characters.`);
    if (!usable(section.text, L.sectionText) || !filled(section.text)) return refuse(`Section ${index + 1}'s text must be 1 to ${L.sectionText} characters.`);
    total += section.text.length;
  }
  if (total > L.totalText) return refuse(`The sections hold ${total} characters; a document holds up to ${L.totalText}.`);
  return { ok: true, draft: { id: value.id, title: value.title, authority: value.authority, url: value.url, rights: value.rights, attribution: value.attribution,
    sourceRevision: value.sourceRevision, aliases: [...aliases], sections: sections.map(section => ({ heading: section.heading, text: section.text })) } };
}
