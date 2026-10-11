import { requireCondition, requireKeys } from '../../contracts/validation.js';

export const PREFERENCE_LIFETIME_MS = 90 * 86400000;
export const MEMORY_NOTE_LIMIT = 8;
export const MEMORY_NOTE_LENGTH = 200;
const legacyKeys = ['replyLength','language'], keys = [...legacyKeys,'notes','useWithAi'];

/**
 * Explicit member-saved settings only. Notes are short statements a member wrote about themselves; nothing is
 * extracted from conversation, and no arbitrary instruction or private-use language subtag is accepted.
 * Records saved before notes existed hold only the two response settings: they read as no notes, not shared.
 */
export function canonicalResponsePreferences(value) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value),'AI_PREFERENCE_INVALID');
  requireKeys(value,Object.hasOwn(value,'notes') || Object.hasOwn(value,'useWithAi') ? keys : legacyKeys,'AI_PREFERENCE_INVALID');
  requireCondition([null,'brief','standard','detailed'].includes(value.replyLength),'AI_PREFERENCE_INVALID');
  let language = null;
  if (value.language !== null) {
    requireCondition(typeof value.language === 'string' && value.language.length <= 16,'AI_PREFERENCE_INVALID');
    try { language = Intl.getCanonicalLocales(value.language)[0]; } catch { requireCondition(false,'AI_PREFERENCE_INVALID'); }
    requireCondition(typeof language === 'string' && /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/.test(language),'AI_PREFERENCE_INVALID');
  }
  const supplied = value.notes ?? [], useWithAi = value.useWithAi ?? false;
  requireCondition(typeof useWithAi === 'boolean' && Array.isArray(supplied) && supplied.length <= MEMORY_NOTE_LIMIT,'AI_PREFERENCE_INVALID');
  const notes = supplied.map(note => {
    requireCondition(typeof note === 'string' && note.length <= MEMORY_NOTE_LENGTH * 4 && note.isWellFormed(),'AI_PREFERENCE_INVALID');
    const text = note.normalize('NFC').trim();
    // One line each: a note is a statement, not a document or a block of instructions.
    requireCondition(text.length >= 1 && text.length <= MEMORY_NOTE_LENGTH && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text),'AI_PREFERENCE_INVALID');
    return text;
  });
  requireCondition(new Set(notes).size === notes.length,'AI_PREFERENCE_INVALID');
  return { replyLength:value.replyLength, language, notes, useWithAi };
}

/** What may accompany this member's own turn, or null. Sharing is the member's separate explicit choice. */
export function memberMemoryForInference(settings) {
  if (settings === null || settings === undefined) return null;
  const { replyLength, language, notes, useWithAi } = canonicalResponsePreferences(settings);
  if (!useWithAi || (replyLength === null && language === null && notes.length === 0)) return null;
  return Object.freeze({ replyLength, language, notes:Object.freeze([...notes]) });
}
