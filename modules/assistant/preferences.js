import { requireCondition, requireKeys } from '../../contracts/validation.js';

export const PREFERENCE_LIFETIME_MS = 90 * 86400000;
/** Explicit response settings only; no biography, arbitrary instruction or private-use language subtag. */
export function canonicalResponsePreferences(value) {
  requireKeys(value,['replyLength','language'],'AI_PREFERENCE_INVALID');
  requireCondition([null,'brief','standard','detailed'].includes(value.replyLength),'AI_PREFERENCE_INVALID');
  let language = null;
  if (value.language !== null) {
    requireCondition(typeof value.language === 'string' && value.language.length <= 16,'AI_PREFERENCE_INVALID');
    try { language = Intl.getCanonicalLocales(value.language)[0]; } catch { requireCondition(false,'AI_PREFERENCE_INVALID'); }
    requireCondition(typeof language === 'string' && /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$/.test(language),'AI_PREFERENCE_INVALID');
  }
  return { replyLength:value.replyLength, language };
}
