import { requireCondition, requireInteger } from '../../contracts/validation.js';
import { paginateStaticText } from './presentation.js';
import { requireScreenId, validatePublication, validateOnboardingPayload, screenMarker } from './screens.js';

/** Exact pre-051 format, accepted only when recovering an uncertain historical create. Never sent. */
export function renderLegacyOnboardingScreen({ screenId, session, publication, retired = false, helpRequested = false }) {
  requireScreenId(screenId); validatePublication(publication);
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
    custom_id: `sophie:shuttle:v1:${screenId}:${action}` });
  let title, parts, buttons = [];
  if (retired) {
    title = 'Shuttle'; parts = ['This Shuttle screen is no longer current. Use /shuttle start to return.'];
  } else if (session.status === 'complete') {
    title = 'Shuttle complete';
    parts = ['Your Whitelist role was confirmed. You can use /shuttle start again to review the latest published guidance.'];
  } else if (session.status === 'role_pending') {
    title = 'Whitelist delivery pending';
    parts = ['Your acknowledgement of all Shuttle steps is recorded. Whitelist delivery is pending. Use Check completion or Ask Staff if it remains pending.'];
    buttons = [button('retry', 'Check completion', 1), button('help', 'Ask Staff', 2)];
  } else {
    const stage = publication.stages[session.stepIndex];
    title = `${navigable ? 'Step' : 'Page'} ${session.stepIndex + 1} of ${publication.stages.length} · ${stage.title}`;
    parts = stage.screens ? [stage.screens[session.screenIndex]] : paginateStaticText(stage.body);
    const more = stage.screens && session.screenIndex < stage.screens.length - 1;
    if (stage.screens) title += ` · ${session.screenIndex + 1}/${stage.screens.length}`;
    buttons = [button(more ? 'next-screen' : 'advance', more ? 'Next screen' :
      session.stepIndex === publication.stages.length - 1 ? 'Complete Shuttle' : navigable ? 'Acknowledge & continue' : 'Continue', 1, session.helpPaused),
      button(session.screenIndex > 0 ? 'previous-screen' : 'back', session.screenIndex > 0 ? 'Back screen' : 'Back', 2,
        (session.stepIndex === 0 && !(session.screenIndex > 0)) || session.helpPaused), button('help', 'Ask Staff', 2)];
  }
  if ((helpRequested || session.helpPaused) && !retired && session.status !== 'complete') {
    parts = [...parts, session.helpPaused ? 'Your request for Staff assistance is recorded. Progression is paused until Staff resumes this session. You can speak with Staff here.' :
      'Your request for Staff assistance is recorded in this case. You can speak with Staff here and continue the Shuttle.'];
  }
  const embeds = parts.map((description, index) => ({ ...(index === 0 ? { title } : {}), description,
    ...(index === parts.length - 1 ? { footer: { text: screenMarker(screenId) } } : {}) }));
  const result = { content: '', embeds, components: buttons.length ? [{ type: 1, components: buttons }] : [], allowed_mentions: { parse: [] } };
  validateOnboardingPayload(result, screenId);
  return result;
}
