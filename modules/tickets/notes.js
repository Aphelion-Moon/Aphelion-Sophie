import { requireCondition, requireInteger } from '../../contracts/validation.js';

export const CASE_NOTE_PAGE_SIZE = 25;
export function requireNoteText(text) {
  requireCondition(typeof text === 'string' && text.length >= 1 && text.length <= 4000 && text.trim().length > 0 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), 'CASE_NOTE_TEXT_INVALID');
}
export function requireNoteRequestId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'CASE_NOTE_REQUEST_INVALID');
}
export function requireNotePosition(value) { if (value !== null) requireInteger(value, 1, 2147483647); }
