import { requireCondition, requireRecord } from '../../contracts/validation.js';
import { SCENE_COLOURS, SCENE_GLYPHS } from './scenes.js';

/**
 * Viewscreens and moments for the Shuttle Activity (P43; owner decisions of 22 October 2026). A viewscreen is a small
 * pop-up of original ASCII art with up to six https link cards; a moment ties a section heading of the published copy
 * to a scene beat and, optionally, a viewscreen. Data only: no code, HTML, images or member data. No AI.
 */
export const VIEWSCREEN_SCHEMA_VERSION = 1;
const LIMITS = Object.freeze({ cols: 40, rows: 16, links: 6, title: 60, alt: 400, label: 60, url: 300, headings: 40, heading: 200 });
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const BEAT = /^[a-z][a-z0-9-]{0,31}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const exactKeys = (value, required, optional = [], code) => {
  requireRecord(value, code);
  requireCondition(required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key)), code);
};
const text = (value, max, code) => requireCondition(typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
  value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value), code);

/** An https link with no credentials, at most 300 characters. */
export function requireMediaLink(value) {
  requireCondition(typeof value === 'string' && value.length <= LIMITS.url, 'INVALID_VIEWSCREEN_LINK');
  let url; try { url = new URL(value); } catch { requireCondition(false, 'INVALID_VIEWSCREEN_LINK'); }
  requireCondition(url.protocol === 'https:' && !url.username && !url.password && url.href === value, 'INVALID_VIEWSCREEN_LINK');
}

export function validateViewscreen(value) {
  const code = 'INVALID_VIEWSCREEN';
  exactKeys(value, ['schema', 'id', 'title', 'art', 'alt', 'links', 'provenance'], [], code);
  requireCondition(value.schema === VIEWSCREEN_SCHEMA_VERSION && ID.test(value.id), code);
  text(value.title, LIMITS.title, code); text(value.alt, LIMITS.alt, code);
  exactKeys(value.art, ['text', 'colours'], [], code);
  requireCondition(Array.isArray(value.art.text) && value.art.text.length >= 1 && value.art.text.length <= LIMITS.rows &&
    Array.isArray(value.art.colours) && value.art.colours.length === value.art.text.length, code);
  value.art.text.forEach((row, r) => {
    const chars = [...(typeof row === 'string' ? row : '')], keys = [...(typeof value.art.colours[r] === 'string' ? value.art.colours[r] : '')];
    requireCondition(typeof row === 'string' && chars.length <= LIMITS.cols && keys.length === chars.length, code);
    chars.forEach(ch => requireCondition(SCENE_GLYPHS.has(ch), 'INVALID_VIEWSCREEN_GLYPH'));
    keys.forEach(key => requireCondition(key === ' ' || Object.hasOwn(SCENE_COLOURS, key), 'INVALID_VIEWSCREEN_COLOUR'));
  });
  requireCondition(Array.isArray(value.links) && value.links.length <= LIMITS.links, code);
  for (const link of value.links) { exactKeys(link, ['label', 'url'], [], code); text(link.label, LIMITS.label, code); requireMediaLink(link.url); }
  exactKeys(value.provenance, ['author', 'created', 'decision', 'rights'], [], code);
  for (const key of ['author', 'decision', 'rights']) text(value.provenance[key], 300, code);
  requireCondition(DATE.test(value.provenance.created), code);
  return value;
}

/** A moment: the beat a section stages and, optionally, the viewscreen it opens. */
export function validateMoment(value, viewscreens = null) {
  exactKeys(value, ['beat'], ['viewscreen'], 'INVALID_MOMENT');
  requireCondition(typeof value.beat === 'string' && BEAT.test(value.beat), 'INVALID_MOMENT');
  if (value.viewscreen !== undefined) {
    requireCondition(typeof value.viewscreen === 'string' && ID.test(value.viewscreen) && (viewscreens === null || viewscreens.has(value.viewscreen)), 'INVALID_MOMENT');
  }
}

/**
 * The key a section heading is known by in moments: markdown links and emphasis removed, typographic quotes made plain,
 * lower case, single spaces, no closing punctuation. Shared by the client, the layout store and the authoring script.
 */
export function headingKey(text) {
  return String(text).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~|]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?:…]+$/, '').trim();
}

/** Moments for one stage, keyed by headingKey(). */
export function validateStageMoments(value, viewscreens = null) {
  requireRecord(value, 'INVALID_MOMENTS');
  const keys = Object.keys(value);
  requireCondition(keys.length <= LIMITS.headings, 'INVALID_MOMENTS');
  for (const key of keys) {
    requireCondition(key.length > 0 && key.length <= LIMITS.heading && key === key.toLowerCase().trim() && !/[\u0000-\u001f]/.test(key), 'INVALID_MOMENTS');
    validateMoment(value[key], viewscreens);
  }
}

/** The default moments document: stage id -> heading -> moment. */
export function validateMoments(value, viewscreens = null) {
  exactKeys(value, ['schema', 'stages'], [], 'INVALID_MOMENTS');
  requireCondition(value.schema === 1, 'INVALID_MOMENTS');
  requireRecord(value.stages, 'INVALID_MOMENTS');
  requireCondition(Object.keys(value.stages).length <= 20 && Object.keys(value.stages).every(id => ID.test(id)), 'INVALID_MOMENTS');
  for (const stage of Object.values(value.stages)) validateStageMoments(stage, viewscreens);
  return value;
}
