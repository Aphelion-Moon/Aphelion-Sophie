import { requireCondition, requireId, requireRecord } from '../../contracts/validation.js';
import { ACTIVITY_STOP_SCENES, activityStopScene } from './activity.js';
import { validateStageMoments } from './activity-media.js';

/**
 * The Shuttle Activity's layout (P44 editor; owner decision of 22 October 2026): which scene each stop uses, extra or
 * replacement moments per section, and the curated arrival list shown after Whitelist is confirmed. Bounded data only;
 * it changes what is drawn and linked, never a run, a permission or the published copy.
 */
export const ACTIVITY_LAYOUT_SCHEMA_VERSION = 1;
const LIMITS = Object.freeze({ stops: 20, arrival: 12, note: 120 });
const STAGE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;

const exactKeys = (value, required, optional, code) => {
  requireRecord(value, code);
  requireCondition(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), code);
};

export function emptyActivityLayout() {
  return { schema: ACTIVITY_LAYOUT_SCHEMA_VERSION, stops: {}, arrival: [] };
}

export function validateActivityLayout(value, { viewscreens = null } = {}) {
  const code = 'INVALID_ACTIVITY_LAYOUT';
  exactKeys(value, ['schema', 'stops', 'arrival'], [], code);
  requireCondition(value.schema === ACTIVITY_LAYOUT_SCHEMA_VERSION, code);
  requireRecord(value.stops, code);
  requireCondition(Object.keys(value.stops).length <= LIMITS.stops && Object.keys(value.stops).every(id => STAGE.test(id)), code);
  for (const stop of Object.values(value.stops)) {
    exactKeys(stop, [], ['scene', 'moments'], code);
    if (stop.scene !== undefined) requireCondition(ACTIVITY_STOP_SCENES.includes(stop.scene), code);
    if (stop.moments !== undefined) validateStageMoments(stop.moments, viewscreens, new Set(ACTIVITY_STOP_SCENES));
  }
  requireCondition(Array.isArray(value.arrival) && value.arrival.length <= LIMITS.arrival, code);
  const seen = new Set();
  for (const entry of value.arrival) {
    exactKeys(entry, ['channelId'], ['note'], code);
    requireId(entry.channelId); requireCondition(!seen.has(entry.channelId), code); seen.add(entry.channelId);
    if (entry.note !== undefined) requireCondition(typeof entry.note === 'string' && entry.note.trim().length > 0 && entry.note.length <= LIMITS.note &&
      entry.note.isWellFormed() && !/[\u0000-\u001f\u007f<>]/.test(entry.note), code);
  }
  return value;
}

/** A fixed key order, so the document hashes the same after a database round trip. Validates first. */
export function canonicalActivityLayout(value, options = {}) {
  validateActivityLayout(value, options);
  const moment = item => ({ beat: item.beat, ...(item.viewscreen === undefined ? {} : { viewscreen: item.viewscreen }), ...(item.scene === undefined ? {} : { scene: item.scene }) });
  return { schema: value.schema,
    stops: Object.fromEntries(Object.keys(value.stops).sort().map(id => [id, { ...(value.stops[id].scene === undefined ? {} : { scene: value.stops[id].scene }),
      ...(value.stops[id].moments === undefined ? {} : { moments: Object.fromEntries(Object.keys(value.stops[id].moments).sort().map(key => [key, moment(value.stops[id].moments[key])])) }) }])),
    arrival: value.arrival.map(entry => ({ channelId: entry.channelId, ...(entry.note === undefined ? {} : { note: entry.note }) })) };
}

/**
 * The layout a run is shown with: for each published stage its id, title, scene and moments (defaults, then the
 * published layout's overrides), plus the curated arrival list. Stages the layout does not name use the defaults.
 */
export function effectiveLayout({ stages, defaults, layout = null }) {
  requireCondition(Array.isArray(stages) && stages.length >= 1, 'INVALID_ACTIVITY_LAYOUT');
  const published = layout ?? emptyActivityLayout();
  return {
    stops: stages.map((stage, index) => ({
      id: stage.id, title: stage.title,
      scene: published.stops[stage.id]?.scene ?? activityStopScene(index, stages.length),
      moments: { ...(defaults?.stages?.[stage.id] ?? {}), ...(published.stops[stage.id]?.moments ?? {}) },
    })),
    arrival: published.arrival.map(entry => ({ ...entry })),
  };
}
