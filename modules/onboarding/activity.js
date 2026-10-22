import { requireCondition, requireInteger, requireKeys } from '../../contracts/validation.js';
import { onboardingStepMessages, validatePublication } from './screens.js';

/**
 * The Shuttle Activity (P40-P44; owner decisions of 21 and 22 October 2026). While it is `testing`, only the server
 * owner and current holders of the lead ops role get past its closed screen; `open` admits every eligible member.
 * The Activity shows the same published copy and keeps the same session rules as the channel Shuttle. No AI.
 */
export const ACTIVITY_STATUSES = Object.freeze(['testing', 'open']);
export const ACTIVITY_ACTIONS = Object.freeze(['advance', 'back', 'retry']);
/** Scenes the client can show for a stop (content/shuttle-activity/scenes). The title screen uses hangar-viewport. */
// The first five are stop scenes by position (activityStopScene); the rest are scenes a section may use (moments).
export const ACTIVITY_STOP_SCENES = Object.freeze(['departure-lounge', 'baggage-hall', 'boarding-cabin', 'viewport', 'pressure-door', 'landing-bay', 'cabin-turbulence']);

export function validateActivityConfiguration(value) {
  requireKeys(value, ['origin', 'port', 'status'], 'ACTIVITY_CONFIGURATION_INVALID');
  requireCondition(typeof value.origin === 'string' && value.origin.length <= 256, 'ACTIVITY_CONFIGURATION_INVALID');
  let origin; try { origin = new URL(value.origin); } catch { requireCondition(false, 'ACTIVITY_CONFIGURATION_INVALID'); }
  requireCondition(origin.protocol === 'https:' && origin.origin === value.origin && !origin.username && !origin.password &&
    !origin.search && !origin.hash && origin.pathname === '/', 'ACTIVITY_CONFIGURATION_INVALID');
  requireInteger(value.port, 1024, 65535);
  requireCondition(ACTIVITY_STATUSES.includes(value.status), 'ACTIVITY_CONFIGURATION_INVALID');
}

/** A client-made key for one click, so a repeated request records nothing twice. */
export function requireActivityRequestId(value) {
  requireCondition(typeof value === 'string' && /^[a-f0-9]{32}$/.test(value), 'ACTIVITY_REQUEST_INVALID');
}

/** The lounge opens the run and the pressure door ends it; stops between take the hall, the cabin and the viewport in turn. */
export function activityStopScene(stop, stops) {
  requireInteger(stops, 1, 20); requireInteger(stop, 0, stops - 1);
  if (stop === stops - 1 && stops > 1) return 'pressure-door';
  if (stop === 0) return 'departure-lounge';
  return ACTIVITY_STOP_SCENES[1 + (stop - 1) % 3];
}

/**
 * What the Activity shows for one run: the stored progress and the current stop's published copy, split into the
 * same pages the channel posts. Whitelist reads "confirmed" only for a finished run while Discord currently shows the
 * role, and "requested" while delivery is pending; nothing here grants or implies access. layout is an effectiveLayout()
 * result (stage ids, scenes and moments); without one each stop gets its default scene and no moments.
 */
export function activityRunView({ session, publication, whitelist, layout = null }) {
  validatePublication(publication);
  requireCondition(session.definitionId === publication.id && session.definitionVersion === publication.version, 'DEFINITION_MISMATCH');
  requireInteger(session.stepIndex, 0, publication.stages.length - 1); requireInteger(session.version);
  requireCondition(['active', 'role_pending', 'complete'].includes(session.status) && typeof whitelist === 'boolean', 'INVALID_SESSION_STATUS');
  const stops = stopsFor(publication, layout);
  return {
    version: session.version,
    status: session.status === 'complete' ? 'boarded' : session.status === 'role_pending' ? 'pending' : session.helpPaused ? 'paused' : 'reading',
    mode: session.mode,
    stop: session.stepIndex,
    stops: stops.map(({ id, title, scene }) => ({ id, title, scene })),
    moments: stops[session.stepIndex].moments,
    pages: onboardingStepMessages(publication, session.stepIndex).map(message => message.content),
    whitelist: session.status === 'role_pending' ? 'requested' : session.status === 'complete' && whitelist ? 'confirmed' : 'none',
  };
}

/** The stops of a publication before a run starts, for the title screen. */
export function activityStops(publication, layout = null) {
  validatePublication(publication);
  return stopsFor(publication, layout).map(({ id, title, scene }) => ({ id, title, scene }));
}

function stopsFor(publication, layout) {
  if (layout) {
    requireCondition(layout.stops.length === publication.stages.length && layout.stops.every((stop, i) => stop.id === publication.stages[i].id), 'ACTIVITY_LAYOUT_MISMATCH');
    return layout.stops;
  }
  return publication.stages.map((stage, index) => ({ id: stage.id, title: stage.title, scene: activityStopScene(index, publication.stages.length), moments: {} }));
}
