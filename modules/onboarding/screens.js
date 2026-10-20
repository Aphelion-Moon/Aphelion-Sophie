import { defaultSystemText } from '../../contracts/system-messages.js';
import { requireCondition, requireInteger, requireKeys, requireName } from '../../contracts/validation.js';
import { paginateStaticText, requireAuthoredScreens } from './presentation.js';
import { requireOnboardingSteps } from './index.js';

export function validatePublication(value) {
  requireKeys(value, ['id', 'version', 'stages', 'helpPauses']);
  requireName(value.id); requireInteger(value.version, 1);
  requireCondition(typeof value.helpPauses === 'boolean', 'SHUTTLE_HELP_MODE_UNSUPPORTED');
  requireOnboardingSteps(value.stages);
  for (const stage of value.stages) {
    requireKeys(stage, ['id', 'title', 'body', ...['screens', 'linkPreviews'].filter(key => Object.hasOwn(stage, key))]); requireName(stage.id);
    requireAuthoredScreens(stage, true);
    requireCondition(typeof stage.title === 'string' && stage.title.trim() === stage.title &&
      stage.title.length > 0 && stage.title.length <= 80 && !/[\r\n]/.test(stage.title), 'INVALID_STATIC_TITLE');
    requireCondition(typeof stage.body === 'string' && stage.body.trim() === stage.body &&
      stage.body.length > 0 && stage.body.length <= 5_000, 'INVALID_STATIC_COPY');
    requireCondition(paginateStaticText(stage.body).length <= 5, 'STATIC_COPY_TOO_MANY_SEGMENTS');
  }
  requireCondition(new Set(value.stages.map(stage => stage.id)).size === value.stages.length, 'DUPLICATE_SHUTTLE_STEPS');
  requireCondition(new TextEncoder().encode(JSON.stringify({ helpPauses: value.helpPauses, stages: value.stages })).length <= 100_000, 'SHUTTLE_DOCUMENT_TOO_LARGE');
}

export function canonicalPublication(value) {
  validatePublication(value);
  return { id: value.id, version: value.version, helpPauses: value.helpPauses,
    stages: value.stages.map(stage => ({ id: stage.id, title: stage.title, body: stage.body,
      ...(stage.screens ? { screens: [...stage.screens] } : {}), ...(stage.linkPreviews ? { linkPreviews: [...stage.linkPreviews] } : {}) })) };
}

export function requireScreenId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'INVALID_SHUTTLE_SCREEN');
}

export function screenMarker(screenId) { requireScreenId(screenId); return `sophie:shuttle-screen:v1:${screenId}`; }

export function parseOnboardingControl(value) {
  requireCondition(typeof value === 'string', 'INTERACTION_COMPONENT_UNSUPPORTED');
  const match = /^sophie:shuttle:v1:([a-f0-9]{32}):(advance|back|retry|help|next-screen|previous-screen)(?::(0|[1-9][0-9]{0,9}))?$/.exec(value);
  requireCondition(match !== null, 'INTERACTION_COMPONENT_UNSUPPORTED');
  return Object.freeze({ screenId: match[1], action: match[2], ...(match[3] === undefined ? {} : { controlVersion: Number(match[3]) }) });
}

/**
 * Pre-message-group format (migrations 051-070): one message holding the whole step, edited in place. It is no longer
 * sent; it stays exact so recovery can still recognise messages posted before the upgrade.
 * Approved static copy and stored state only; no user text, remote assets or model output.
 */
export function renderOnboardingScreen({ screenId, session, publication, retired = false, helpRequested = false, controlVersion = 0 }, text = defaultSystemText) {
  requireScreenId(screenId); validatePublication(publication); requireInteger(controlVersion, 0, 2_147_483_647);
  requireCondition(session.definitionId === publication.id && session.definitionVersion === publication.version, 'DEFINITION_MISMATCH');
  requireInteger(session.stepIndex, 0, publication.stages.length - 1);
  const navigable = publication.stages.some(stage => stage.screens);
  requireCondition(Object.hasOwn(session, 'screenIndex') === navigable, 'INVALID_SESSION_PROGRESS');
  if (navigable) {
    const last = (publication.stages[session.stepIndex].screens?.length ?? 1) - 1;
    requireInteger(session.screenIndex, 0, last);
    requireCondition(session.status === 'active' || session.screenIndex === last, 'INVALID_SESSION_PROGRESS');
  }
  requireCondition(['active', 'role_pending', 'complete'].includes(session.status), 'INVALID_SESSION_STATUS');
  requireCondition(session.status === 'active' || session.stepIndex === publication.stages.length - 1, 'INVALID_SESSION_PROGRESS');
  requireCondition(typeof session.helpPaused === 'boolean' && (!session.helpPaused ||
    (publication.helpPauses && session.status === 'active')), 'INVALID_SHUTTLE_PAUSE');
  requireCondition(typeof retired === 'boolean' && typeof helpRequested === 'boolean', 'INVALID_SHUTTLE_SCREEN');
  const button = (action, label, style, disabled = false) => ({ type: 2, style, label, disabled,
    custom_id: `sophie:shuttle:v1:${screenId}:${action}:${controlVersion}` });
  let title, parts, buttons = [];
  if (retired) {
    title = text('onboarding.ended.title'); parts = [text('onboarding.ended.body')];
    buttons = [button('help', text('onboarding.ended.button'), 2, true)];
  } else if (session.status === 'complete') {
    title = text('onboarding.complete.title');
    parts = [text('onboarding.complete.body')];
    buttons = [button('help', text('onboarding.complete.button'), 2, true)];
  } else if (session.status === 'role_pending') {
    title = text('onboarding.pending.title');
    parts = [text('onboarding.pending.body')];
    buttons = [button('retry', text('onboarding.check'), 1), button('help', text('onboarding.help'), 2)];
  } else {
    const stage = publication.stages[session.stepIndex];
    title = text(navigable ? 'onboarding.step' : 'onboarding.page', { step: session.stepIndex + 1, total: publication.stages.length, title: stage.title });
    parts = stage.screens ? [stage.screens[session.screenIndex]] : paginateStaticText(stage.body);
    const more = stage.screens && session.screenIndex < stage.screens.length - 1;
    if (stage.screens) title += text('onboarding.screen', { screen: session.screenIndex + 1, screens: stage.screens.length });
    buttons = [button(more ? 'next-screen' : 'advance', more ? text('onboarding.next') :
      session.stepIndex === publication.stages.length - 1 ? text('onboarding.finish') : navigable ? text('onboarding.acknowledge') : text('onboarding.continue'), 1, session.helpPaused),
      button(session.screenIndex > 0 ? 'previous-screen' : 'back', session.screenIndex > 0 ? text('onboarding.previous') : text('onboarding.back'), 2,
        (session.stepIndex === 0 && !(session.screenIndex > 0)) || session.helpPaused), button('help', text('onboarding.help'), 2)];
  }
  if ((helpRequested || session.helpPaused) && !retired && session.status !== 'complete') {
    parts = [...parts, session.helpPaused ? text('onboarding.help.paused') :
      text('onboarding.help.waiting')];
  }
  const embeds = parts.map((description, index) => ({ ...(index === 0 ? { title } : {}), description }));
  const result = { content: '', embeds, components: buttons.length ? [{ type: 1, components: buttons }] : [], allowed_mentions: { parse: [] } };
  validateOnboardingPayload(result, screenId);
  return result;
}

/** Closed message shape for the core's fixed Onboarding write routes. */
export function validateOnboardingPayload(value, screenId) {
  requireScreenId(screenId); requireKeys(value, ['content', 'embeds', 'components', 'allowed_mentions']);
  requireCondition(value.content === '' && Array.isArray(value.embeds) && value.embeds.length > 0 && value.embeds.length <= 6, 'INVALID_SHUTTLE_PAYLOAD');
  requireKeys(value.allowed_mentions, ['parse']);
  requireCondition(Array.isArray(value.allowed_mentions.parse) && value.allowed_mentions.parse.length === 0, 'INVALID_SHUTTLE_PAYLOAD');
  let length = 0;
  value.embeds.forEach((embed, index) => {
    const keys = ['description', ...(index === 0 ? ['title'] : []), ...(index === value.embeds.length - 1 && embed.footer ? ['footer'] : [])];
    requireKeys(embed, keys);
    requireCondition(typeof embed.description === 'string' && embed.description.length > 0 && embed.description.length <= 1_800, 'INVALID_SHUTTLE_PAYLOAD');
    length += embed.description.length;
    if (embed.footer) {
      requireKeys(embed.footer, ['text']); requireCondition(embed.footer.text === screenMarker(screenId), 'INVALID_SHUTTLE_PAYLOAD'); length += embed.footer.text.length;
    }
    if (index === 0) { requireCondition(typeof embed.title === 'string' && embed.title.length > 0 && embed.title.length <= 120, 'INVALID_SHUTTLE_PAYLOAD'); length += embed.title.length; }

  });
  requireCondition(length <= 6_000 && Array.isArray(value.components) && value.components.length <= 1, 'INVALID_SHUTTLE_PAYLOAD');
  for (const row of value.components) {
    requireKeys(row, ['type', 'components']);
    requireCondition(row.type === 1 && Array.isArray(row.components) && row.components.length > 0 && row.components.length <= 3, 'INVALID_SHUTTLE_PAYLOAD');
    const actions = new Set();
    for (const button of row.components) {
      requireKeys(button, ['type', 'style', 'label', 'disabled', 'custom_id']);
      const parsed = parseOnboardingControl(button.custom_id);
      requireCondition(button.type === 2 && [1, 2].includes(button.style) && parsed.screenId === screenId &&
        typeof button.disabled === 'boolean' && typeof button.label === 'string' && button.label.length > 0 && button.label.length <= 80 &&
        !actions.has(parsed.action), 'INVALID_SHUTTLE_PAYLOAD');
      actions.add(parsed.action);
    }
  }
}

// Message groups (migration 071): a status card edited in place, the step as plain messages, and a navigation card.
// Approved static copy, fixed wording and stored state only; no user text, remote assets, mentions or model output.

const SUPPRESS_EMBEDS = 4;
const NAV_ACTIONS = Object.freeze(['advance', 'back', 'retry']);

function requireRenderableSession(session, publication) {
  validatePublication(publication);
  requireCondition(session.definitionId === publication.id && session.definitionVersion === publication.version, 'DEFINITION_MISMATCH');
  requireInteger(session.stepIndex, 0, publication.stages.length - 1);
  requireCondition(Object.hasOwn(session, 'screenIndex') === publication.stages.some(stage => stage.screens), 'INVALID_SESSION_PROGRESS');
  requireCondition(['active', 'role_pending', 'complete'].includes(session.status), 'INVALID_SESSION_STATUS');
  requireCondition(session.status === 'active' || session.stepIndex === publication.stages.length - 1, 'INVALID_SESSION_PROGRESS');
  requireCondition(typeof session.helpPaused === 'boolean' && (!session.helpPaused ||
    (publication.helpPauses && session.status === 'active')), 'INVALID_SHUTTLE_PAUSE');
  requireCondition(['refresh', 'qualification'].includes(session.mode), 'INVALID_SESSION_MODE');
}

/** A step's messages: its authored screens, or deterministic segments of its body. Each is one plain message. */
export function onboardingStepMessages(publication, stepIndex) {
  validatePublication(publication); requireInteger(stepIndex, 0, publication.stages.length - 1);
  const stage = publication.stages[stepIndex];
  return (stage.screens ?? paginateStaticText(stage.body)).map((content, index) => ({ content, previews: stage.linkPreviews?.[index] === true }));
}

/** One step message. Link previews stay off unless the author turned them on for this message. */
export function renderOnboardingContent({ content, previews }) {
  requireCondition(typeof previews === 'boolean', 'INVALID_SHUTTLE_PAYLOAD');
  const result = { content, embeds: [], components: [], allowed_mentions: { parse: [] }, flags: previews ? 0 : SUPPRESS_EMBEDS };
  validateOnboardingContentPayload(result);
  return result;
}

/** The status card at the top of the channel. It holds no controls; it only reports recorded progress. */
export function renderOnboardingStatus({ session, publication, retired = false, helpRequested = false }, text = defaultSystemText) {
  requireRenderableSession(session, publication);
  requireCondition(typeof retired === 'boolean' && typeof helpRequested === 'boolean', 'INVALID_SHUTTLE_SCREEN');
  let title = text('onboarding.status.title'), description;
  if (retired) { title = text('onboarding.ended.title'); description = text('onboarding.ended.body'); } else {
    const reading = session.status === 'active';
    const lines = publication.stages.map((stage, index) => {
      const values = { step: index + 1, title: stage.title };
      if (!reading || index < session.stepIndex) return text('onboarding.status.done', values);
      return text(index === session.stepIndex ? 'onboarding.status.current' : 'onboarding.status.upcoming', values);
    });
    const whitelist = session.status === 'complete' ? 'confirmed' : session.status === 'role_pending' ? 'pending' : session.mode === 'refresh' ? 'kept' : 'none';
    lines.push('', `-# ${text(`onboarding.status.whitelist.${whitelist}`)}`);
    if (reading && (session.helpPaused || helpRequested)) lines.push(text(session.helpPaused ? 'onboarding.help.paused' : 'onboarding.help.waiting'));
    description = lines.join('\n');
  }
  const result = { content: '', embeds: [{ title, description }], components: [], allowed_mentions: { parse: [] } };
  validateOnboardingStatusPayload(result);
  return result;
}

/** The navigation card after a step's messages. Pending and finished runs keep only what still applies. */
export function renderOnboardingNav({ screenId, session, publication, helpRequested = false, controlVersion = 0 }, text = defaultSystemText) {
  requireScreenId(screenId); requireRenderableSession(session, publication); requireInteger(controlVersion, 0, 2_147_483_647);
  requireCondition(typeof helpRequested === 'boolean', 'INVALID_SHUTTLE_SCREEN');
  const button = (action, label, style, disabled = false) => ({ type: 2, style, label, disabled,
    custom_id: `sophie:shuttle:v1:${screenId}:${action}:${controlVersion}` });
  let title, description, buttons = [];
  if (session.status === 'complete') {
    title = text('onboarding.complete.title'); description = text('onboarding.complete.body');
  } else if (session.status === 'role_pending') {
    title = text('onboarding.pending.title'); description = text('onboarding.pending.body');
    buttons = [button('retry', text('onboarding.check'), 1)];
  } else {
    const last = session.stepIndex === publication.stages.length - 1;
    title = text('onboarding.step', { step: session.stepIndex + 1, total: publication.stages.length, title: publication.stages[session.stepIndex].title });
    description = last ? text('onboarding.nav.final') : text('onboarding.nav.next', { title: publication.stages[session.stepIndex + 1].title });
    if (session.helpPaused || helpRequested) description += `\n\n${text(session.helpPaused ? 'onboarding.help.paused' : 'onboarding.help.waiting')}`;
    buttons = [button('back', text('onboarding.back'), 2, session.stepIndex === 0 || session.helpPaused),
      button('advance', text(last ? 'onboarding.finish' : 'onboarding.continue'), 1, session.helpPaused)];
  }
  const result = { content: '', embeds: [{ title, description }], components: buttons.length ? [{ type: 1, components: buttons }] : [], allowed_mentions: { parse: [] } };
  validateOnboardingNavPayload(result, screenId);
  return result;
}

/** The interaction reply that answers a Continue/Back/Check click at once: the card stays, its buttons wait. */
export function renderOnboardingOpening({ screenId, controlVersion }, text = defaultSystemText) {
  requireScreenId(screenId); requireInteger(controlVersion, 0, 2_147_483_647);
  return { components: [{ type: 1, components: [{ type: 2, style: 2, label: text('onboarding.opening'), disabled: true,
    custom_id: `sophie:shuttle:v1:${screenId}:advance:${controlVersion}` }] }], allowed_mentions: { parse: [] } };
}

function requireBareMessage(value, keys) {
  requireKeys(value, keys, 'INVALID_SHUTTLE_PAYLOAD');
  requireKeys(value.allowed_mentions, ['parse'], 'INVALID_SHUTTLE_PAYLOAD');
  requireCondition(Array.isArray(value.allowed_mentions.parse) && value.allowed_mentions.parse.length === 0 &&
    Array.isArray(value.embeds) && Array.isArray(value.components), 'INVALID_SHUTTLE_PAYLOAD');
}

function requireCard(value, descriptionLimit) {
  requireCondition(value.content === '' && value.embeds.length === 1, 'INVALID_SHUTTLE_PAYLOAD');
  const [embed] = value.embeds;
  requireKeys(embed, ['title', 'description'], 'INVALID_SHUTTLE_PAYLOAD');
  requireCondition(typeof embed.title === 'string' && embed.title.length > 0 && embed.title.length <= 120 &&
    typeof embed.description === 'string' && embed.description.length > 0 && embed.description.length <= descriptionLimit, 'INVALID_SHUTTLE_PAYLOAD');
}

/** Closed shape for one plain step message. */
export function validateOnboardingContentPayload(value) {
  requireBareMessage(value, ['content', 'embeds', 'components', 'allowed_mentions', 'flags']);
  requireCondition(typeof value.content === 'string' && value.content.trim().length > 0 && value.content.length <= 2_000 && value.content.isWellFormed() &&
    value.embeds.length === 0 && value.components.length === 0 && [0, SUPPRESS_EMBEDS].includes(value.flags), 'INVALID_SHUTTLE_PAYLOAD');
}

/** Closed shape for the status card: one card, no controls. */
export function validateOnboardingStatusPayload(value) {
  requireBareMessage(value, ['content', 'embeds', 'components', 'allowed_mentions']);
  requireCard(value, 4_096);
  requireCondition(value.components.length === 0, 'INVALID_SHUTTLE_PAYLOAD');
}

/** Closed shape for the navigation card: one card, at most one row of this run's Back/Continue/Check controls. */
export function validateOnboardingNavPayload(value, screenId) {
  requireScreenId(screenId);
  requireBareMessage(value, ['content', 'embeds', 'components', 'allowed_mentions']);
  requireCard(value, 1_800);
  requireCondition(value.components.length <= 1, 'INVALID_SHUTTLE_PAYLOAD');
  for (const row of value.components) {
    requireKeys(row, ['type', 'components'], 'INVALID_SHUTTLE_PAYLOAD');
    requireCondition(row.type === 1 && Array.isArray(row.components) && row.components.length > 0 && row.components.length <= 2, 'INVALID_SHUTTLE_PAYLOAD');
    const actions = new Set();
    for (const button of row.components) {
      requireKeys(button, ['type', 'style', 'label', 'disabled', 'custom_id'], 'INVALID_SHUTTLE_PAYLOAD');
      const parsed = parseOnboardingControl(button.custom_id);
      requireCondition(button.type === 2 && [1, 2].includes(button.style) && parsed.screenId === screenId && NAV_ACTIONS.includes(parsed.action) &&
        typeof button.disabled === 'boolean' && typeof button.label === 'string' && button.label.length > 0 && button.label.length <= 80 &&
        !actions.has(parsed.action), 'INVALID_SHUTTLE_PAYLOAD');
      actions.add(parsed.action);
    }
  }
}

/** One closed validator per part kind; transport routes never accept another shape. */
export function validateOnboardingPart(kind, value, screenId) {
  if (kind === 'status') return validateOnboardingStatusPayload(value);
  if (kind === 'content') return validateOnboardingContentPayload(value);
  requireCondition(kind === 'nav', 'INVALID_SHUTTLE_PAYLOAD');
  return validateOnboardingNavPayload(value, screenId);
}
