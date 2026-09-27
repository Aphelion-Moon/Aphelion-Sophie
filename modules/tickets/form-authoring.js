import { ContractError, requireCondition } from '../../contracts/validation.js';
import { canonicalCaseForm, canonicalCaseFormDraft, caseFormPresentation, FORM_CASE_TYPES } from './intake.js';

export function requireFormEditorRequestId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'CASE_FORM_EDITOR_REQUEST_INVALID');
}
export function requireFormCaseType(value) { requireCondition(FORM_CASE_TYPES.includes(value), 'INVALID_CASE_FORM_TYPE'); }

/** Authored questions only. Preview uses the runtime renderer but cannot open or submit a form. */
export function reviewCaseFormDraft(document) {
  const fixed = canonicalCaseFormDraft(document);
  try {
    const form = canonicalCaseForm(fixed);
    return { valid: true, errors: [], form, preview: caseFormPresentation(form) };
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return { valid: false, errors: [error.code], form: null, preview: null };
  }
}
