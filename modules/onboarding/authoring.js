import { ContractError, requireCondition, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';
import { canonicalPublication } from './screens.js';
import { paginateStaticText, requireAuthoredScreens } from './presentation.js';
import { requireOnboardingSteps } from './index.js';

export function requireEditorRequestId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'SHUTTLE_EDITOR_REQUEST_INVALID');
}

/** Bounded authored copy may be incomplete while saved; publishing uses the stricter runtime contract. */
export function canonicalOnboardingDraft(value) {
  requireKeys(value, ['helpPauses', 'stages']);
  requireCondition(typeof value.helpPauses === 'boolean', 'SHUTTLE_HELP_MODE_UNSUPPORTED');
  requireOnboardingSteps(value.stages);
  const text = (value, maximum) => requireCondition(typeof value === 'string' && value.length <= maximum && value.isWellFormed() &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'INVALID_STATIC_COPY');
  const document = { helpPauses: value.helpPauses, stages: value.stages.map(stage => {
    requireKeys(stage, ['id', 'title', 'body', ...(Object.hasOwn(stage, 'screens') ? ['screens'] : [])]); requireName(stage.id); text(stage.title, 80); text(stage.body, 5_000);
    requireAuthoredScreens(stage);
    return { id: stage.id, title: stage.title, body: stage.body, ...(stage.screens ? { screens: [...stage.screens] } : {}) };
  }) };
  requireCondition(new TextEncoder().encode(JSON.stringify(document)).length <= 100_000, 'SHUTTLE_DOCUMENT_TOO_LARGE');
  return document;
}

/** Static authored pages only. No session, member, case or executable preview input. */
export function reviewOnboardingDraft(id, version, document) {
  requireName(id); requireInteger(version, 1, 2_147_483_647);
  const fixed = canonicalOnboardingDraft(document);
  try {
    const publication = canonicalPublication({ id, version, ...fixed });
    return { valid: true, errors: [], publication, pages: publication.stages.map(stage => ({
      id: stage.id, title: stage.title, segments: stage.screens ?? paginateStaticText(stage.body),
    })) };
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return { valid: false, errors: [error.code], publication: null, pages: [] };
  }
}
