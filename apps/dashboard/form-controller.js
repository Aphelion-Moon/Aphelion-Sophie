import { createAuthoringController } from './authoring-controller.js';

export const FORM_CATEGORIES = Object.freeze([
  ['admin-help', 'Admin Help'], ['staff-report', 'Staff Report'], ['tech-support', 'Tech Support'],
  ['database-support', 'Database Support'], ['head-admin-contact', 'Head Admin contact'], ['player-report', 'Player report'], ['staff-contact', 'Staff contact'],
]);
const unique = (prefix, values) => { let index = 1; while (values.includes(`${prefix}_${index}`)) index++; return `${prefix}_${index}`; };
export const emptyForm = caseType => ({ caseType, title: '', fields: [] });
const kinds = ['short', 'paragraph', 'select'];

export function createFormController({ api, onChange, newRequestId }) {
  const { edit, ...workflow } = createAuthoringController({ onChange, newRequestId,
    api: { session: () => api.session(), logout: () => api.logout(), draft: (...args) => api.formDraft(...args), history: (...args) => api.formHistory(...args), review: (...args) => api.formReview(...args),
      publication: (...args) => api.formPublication(...args), save: body => api.formSave(body), publish: body => api.formPublish(body), withdraw: body => api.formWithdraw(body) },
    profile: { capability: 'canEditForms', resources: FORM_CATEGORIES.map(([id]) => id), emptyDraft: emptyForm,
      draftOf: record => structuredClone(record.form), comparisonOf: record => record.form, pageCount: document => document?.fields.length ?? 0,
      scope: caseType => ({ caseType }), currentVersion: review => review.newRequestVersion,
      invalidMessage: 'Check the form title, questions, choices and length limits, then review the saved draft again.',
      withdrawNotice: receipt => `Withdrawal of version ${receipt.version} was recorded. Submitted answers and history are retained.` },
  });
  const field = index => Number.isInteger(index) && index >= 0 ? workflow.snapshot().document?.fields[index] : null;
  return Object.freeze({ ...workflow,
    updateTitle(value) { if (typeof value === 'string' && value.length <= 45) edit(document => { document.title = value; }); },
    addField(kind = 'paragraph') {
      if (!kinds.includes(kind)) return;
      edit(document => { if (document.fields.length === 5) return; const id = unique('question', document.fields.map(field => field.id));
        document.fields.push({ id, kind, label: '', description: '', required: true, ...(kind === 'select' ? { options: [] } : { maxLength: kind === 'short' ? 200 : 2_000 }) }); });
      workflow.selectPage((workflow.snapshot().document?.fields.length ?? 1) - 1);
    },
    updateField(index, key, value) {
      const current = field(index); if (!current) return;
      if (['label', 'description'].includes(key)) { if (typeof value !== 'string' || value.length > (key === 'label' ? 45 : 100)) return; }
      else if (key === 'required') { if (typeof value !== 'boolean') return; }
      else if (key === 'maxLength') { if (current.kind === 'select' || !Number.isInteger(value) || value < 1 || value > 4_000) return; }
      else return;
      edit(document => { document.fields[index][key] = value; });
    },
    changeKind(index, kind) {
      const current = field(index); if (!current || !kinds.includes(kind) || current.kind === kind) return;
      edit(document => { const { maxLength, options, ...base } = document.fields[index]; document.fields[index] = { ...base, kind,
        ...(kind === 'select' ? { options: [] } : { maxLength: maxLength ?? (kind === 'short' ? 200 : 2_000) }) }; },
      current.kind === 'select' && current.options.length ? 'Changing this question to text removes its choices from the draft. Published versions and retained answers stay unchanged.' : null);
    },
    removeField(index) { if (field(index)) edit(document => { document.fields.splice(index, 1); }, 'Remove this question from the draft? Published versions and retained answers stay unchanged.'); },
    moveField(index, direction) {
      if (!field(index) || ![-1, 1].includes(direction) || !field(index + direction)) return;
      edit(document => { const [entry] = document.fields.splice(index, 1); document.fields.splice(index + direction, 0, entry); }); workflow.selectPage(index + direction);
    },
    addOption(index) {
      const current = field(index); if (current?.kind !== 'select' || current.options.length >= 25) return;
      edit(document => { const options = document.fields[index].options; options.push({ value: unique('choice', options.map(option => option.value)), label: '' }); });
    },
    updateOption(index, option, label) {
      const current = field(index); if (current?.kind !== 'select' || !Number.isInteger(option) || option < 0 || !current.options[option] || typeof label !== 'string' || label.length > 100) return;
      edit(document => { document.fields[index].options[option].label = label; });
    },
    removeOption(index, option) {
      const current = field(index); if (current?.kind !== 'select' || !Number.isInteger(option) || option < 0 || !current.options[option]) return;
      edit(document => { document.fields[index].options.splice(option, 1); });
    },
    moveOption(index, option, direction) {
      const current = field(index); if (current?.kind !== 'select' || !Number.isInteger(option) || ![-1, 1].includes(direction) || !current.options[option] || !current.options[option + direction]) return;
      edit(document => { const options = document.fields[index].options, [entry] = options.splice(option, 1); options.splice(option + direction, 0, entry); });
    },
  });
}
