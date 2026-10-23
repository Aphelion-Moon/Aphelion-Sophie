import { createAuthoringController } from './authoring-controller.js';
import { paginateStaticText, STAGE_BODY_LIMIT } from '../../modules/onboarding/presentation.js';

export const INITIAL_STAGES = Object.freeze([
  ['the-brochure', 'The Brochure'], ['pack-your-bags', 'Pack Your Bags'], ['board-the-shuttle', 'Board the Shuttle'],
  ['admire-the-lights', 'Admire the Lights'], ['disembarking', 'Disembarking'],
]);
export const emptyDraft = () => ({ helpPauses: false, stages: INITIAL_STAGES.map(([id, title]) => ({ id, title, body: '', screens: [''] })) });
// Staff take no part in the Shuttle, so drafts never pause on help (owner direction, 20 October 2026).
export const draftOf = publication => ({ helpPauses: false, stages: publication.stages.map(({ id, title, body, screens, linkPreviews }) => ({ id, title, body,
  ...(screens ? { screens: [...screens] } : {}), ...(screens && linkPreviews ? { linkPreviews: [...linkPreviews] } : {}) })) });
/** Whether each message of a step shows Discord link previews; off unless the author turned it on. */
export function previewsOf(stage) { return screensOf(stage).map((_, index) => stage.linkPreviews?.[index] === true); }
// Messages and their preview choices change together, so the two always stay aligned.
function setMessages(stage, screens, previews) {
  Object.assign(stage, { screens, body: screens.join('\n\n') });
  if (previews.some(Boolean)) stage.linkPreviews = previews; else delete stage.linkPreviews;
}
export function screensOf(stage) {
  if (stage.screens) return [...stage.screens];
  if (!stage.body.trim()) return [''];
  try { return paginateStaticText(stage.body); }
  catch { // Incomplete drafts may contain an overlong unbroken block; keep it editable.
    const parts = []; let text = '';
    for (const character of stage.body) { if (text.length + character.length > 1_800) { parts.push(text); text = ''; } text += character; }
    if (text) parts.push(text); return parts;
  }
}

export function createGuidanceController({ api, onChange, newRequestId }) {
  const { edit, selectResource, confirmResource, cancelResource, ...workflow } = createAuthoringController({ onChange, newRequestId,
    api: { session: () => api.session(), logout: () => api.logout(), save: body => api.save(body), publish: body => api.publish(body), withdraw: body => api.withdraw(body),
      draft: (_, revision = null) => api.draft(revision), history: (_, ...args) => api.history(...args),
      review: (_, revision) => api.review(revision), publication: (_, version) => api.publication(version) },
    profile: { capability: 'canEditOnboarding', emptyDraft, draftOf: record => draftOf(record.publication), comparisonOf: record => record.publication, pageCount: document => document?.stages.length ?? 0, scope: () => ({}),
      currentVersion: review => review.currentPublishedVersion, invalidMessage: 'Use 1–20 steps with valid titles and text. Keep the whole draft below 100,000 UTF-8 bytes, then review again.',
      withdrawNotice: receipt => 'Withdrawal of version ' + receipt.version + ' was recorded. Screen cleanup may still be pending.' },
  });
  return Object.freeze({ ...workflow,
    updatePage(index, field, value) {
      if (!['title', 'body'].includes(field) || !Number.isInteger(index) || index < 0 || index >= (workflow.snapshot().document?.stages.length ?? 0) || typeof value !== 'string') return;
      edit(document => { const stage = document.stages[index]; stage[field] = value;
        if (field === 'body' && stage.screens) { delete stage.screens; delete stage.linkPreviews; }
      });
    },
    updateScreen(index, screen, value) {
      const stage = workflow.snapshot().document?.stages[index];
      if (!stage || !Number.isInteger(screen) || screen < 0 || typeof value !== 'string' || value.length > 1_800) return;
      const screens = screensOf(stage); if (screen >= screens.length) return; screens[screen] = value;
      if (screens.join('\n\n').length > STAGE_BODY_LIMIT) return;
      edit(document => { setMessages(document.stages[index], screens, previewsOf(stage)); });
    },
    setLinkPreview(index, screen, value) {
      const stage = workflow.snapshot().document?.stages[index];
      if (!stage || !Number.isInteger(screen) || screen < 0 || typeof value !== 'boolean') return;
      const screens = screensOf(stage), previews = previewsOf(stage); if (screen >= screens.length) return; previews[screen] = value;
      edit(document => { setMessages(document.stages[index], screens, previews); });
    },
    addScreen(index) {
      const stage = workflow.snapshot().document?.stages[index]; if (!stage) return;
      const screens = [...screensOf(stage), '']; if (screens.length > 5 || screens.join('\n\n').length > STAGE_BODY_LIMIT) return;
      edit(document => { setMessages(document.stages[index], screens, [...previewsOf(stage), false]); });
    },
    removeScreen(index, screen) {
      const stage = workflow.snapshot().document?.stages[index]; if (!stage) return;
      const screens = [...screensOf(stage)], previews = previewsOf(stage);
      if (!Number.isInteger(screen) || screen < 0 || screen >= screens.length || screens.length <= 1) return;
      screens.splice(screen, 1); previews.splice(screen, 1);
      edit(document => { setMessages(document.stages[index], screens, previews); },
        `Remove message ${screen + 1} from “${stage.title || 'Untitled step'}”? Saved versions and active runs remain unchanged.`);
    },
    moveScreen(index, screen, direction) {
      const stage = workflow.snapshot().document?.stages[index]; if (!stage || ![-1, 1].includes(direction)) return;
      const screens = screensOf(stage), previews = previewsOf(stage), target = screen + direction;
      if (!Number.isInteger(screen) || screen < 0 || screen >= screens.length || target < 0 || target >= screens.length) return;
      const [text] = screens.splice(screen, 1); screens.splice(target, 0, text);
      const [preview] = previews.splice(screen, 1); previews.splice(target, 0, preview);
      edit(document => { setMessages(document.stages[index], screens, previews); });
    },
    addPage() {
      const state = workflow.snapshot(); if (!state.document || state.document.stages.length >= 20) return;
      const id = `step-${newRequestId().slice(-32)}`;
      if (state.document.stages.some(stage => stage.id === id)) return;
      edit(document => { document.stages.splice(state.page + 1, 0, { id, title: '', body: '', screens: [''] }); });
      const index = workflow.snapshot().document?.stages.findIndex(stage => stage.id === id);
      if (index >= 0) workflow.selectPage(index);
    },
    movePage(direction) {
      const state = workflow.snapshot(), target = state.page + direction;
      if (![-1, 1].includes(direction) || !state.document || target < 0 || target >= state.document.stages.length) return;
      edit(document => { const [stage] = document.stages.splice(state.page, 1); document.stages.splice(target, 0, stage); });
      if (workflow.snapshot().document?.stages[target].id === state.document.stages[state.page].id) workflow.selectPage(target);
    },
    removePage() {
      const state = workflow.snapshot(); if (!state.document || state.document.stages.length <= 1) return;
      edit(document => { document.stages.splice(state.page, 1); },
        `Remove step ${state.page + 1}, “${state.document.stages[state.page].title || 'Untitled page'}”, from this draft? Saved versions and active runs remain unchanged.`);
    },
  });
}
