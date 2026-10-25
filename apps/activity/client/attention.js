/** How long after the member's last input the Shuttle still counts them as reading (owner request, 25 October 2026). */
export const IDLE_MS = 120_000;
/** The most one stop's reading can report: core refuses more. */
export const ATTENTION_MAX_MS = 3_600_000;

/**
 * Focused reading time for the stop on screen (owner request, 25 October 2026: "only count time when people are actually
 * interacting with / focused on the activity"). Time counts only while a stop is being read, the page is visible, the
 * window has focus, Discord is not showing it picture-in-picture, and the member's last input was within IDLE_MS. A
 * member who stops interacting stops counting when the idle window ran out, not when it is next noticed. Input is also
 * taken as focus, since some of Discord's frames never report it. Nothing here leaves the page except the total sent with
 * the member's own Continue or Back.
 */
export function createAttention({ now, focused = true }) {
  const state = { reading: false, visible: true, focused, pip: false };
  let ms = 0, since = null, lastInput = -Infinity;
  const counting = t => state.reading && state.visible && state.focused && !state.pip && t < lastInput + IDLE_MS;
  function update(change) {
    const t = now();
    if (since !== null) ms += Math.max(0, Math.min(t, lastInput + IDLE_MS) - since);
    change(t);
    since = counting(t) ? t : null;
  }
  return Object.freeze({
    /** A key, tap, click, pointer move, wheel or scroll. */
    input() { update(t => { lastInput = t; state.focused = true; }); },
    /** reading, visible, focused or pip changed. */
    set(key, value) { if (Object.hasOwn(state, key) && state[key] !== value) update(() => { state[key] = value; }); },
    /** The stop's focused time so far, in whole milliseconds, and a fresh count from now. */
    take() {
      let taken = 0;
      update(() => { taken = Math.min(ATTENTION_MAX_MS, Math.round(ms)); ms = 0; });
      return taken;
    },
    /** Time taken for a request core never applied counts towards the next one. */
    restore(value) { if (Number.isFinite(value) && value > 0) update(() => { ms += value; }); },
  });
}
