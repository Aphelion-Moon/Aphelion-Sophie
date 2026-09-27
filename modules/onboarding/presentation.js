import { requireCondition, requireInteger } from '../../contracts/validation.js';

/** Deterministic draft-copy pagination. Discord compatibility still needs staging. */
export function paginateStaticText(text, limit = 1_800) {
  requireCondition(typeof text === 'string' && text.trim().length > 0 && text.length <= 50_000, 'INVALID_STATIC_COPY');
  requireInteger(limit, 100, 1_800);
  const messages = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const paragraph = rest.lastIndexOf('\n\n', limit);
    const line = rest.lastIndexOf('\n', limit);
    const space = rest.lastIndexOf(' ', limit);
    const boundary = paragraph > 0 ? paragraph : line > 0 ? line : space;
    requireCondition(boundary > 0, 'STATIC_COPY_BLOCK_TOO_LONG');
    messages.push(rest.slice(0, boundary).trimEnd());
    rest = rest.slice(boundary).trimStart();
  }
  if (rest) messages.push(rest);
  return messages;
}
/** Optional explicit screens preserve legacy documents and their publication hashes. */
export function requireAuthoredScreens(stage, complete = false) {
  if (!Object.hasOwn(stage, 'screens')) return;
  requireCondition(Array.isArray(stage.screens) && stage.screens.length >= 1 && stage.screens.length <= 5, 'INVALID_SHUTTLE_SCREENS');
  for (const text of stage.screens) requireCondition(typeof text === 'string' && text.length <= 1_800 &&
    text.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) &&
    (!complete || (text.length > 0 && text.trim() === text)), 'INVALID_STATIC_COPY');
  requireCondition(stage.body === stage.screens.join('\n\n'), 'SHUTTLE_SCREENS_MISMATCH');
}
