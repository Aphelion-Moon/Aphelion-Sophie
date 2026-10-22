/**
 * The Shuttle Activity's sound (P43): the 24 approved cues in content/shuttle-activity/sounds, played with Web Audio.
 * Ogg Opus where the browser decodes it, the MP3 fallback otherwise (older iPhones). Nothing plays before the member
 * presses a key or taps, every group has its own level, and all sound stops while the Activity is hidden.
 */
export const SOUND_GROUPS = Object.freeze(['interface', 'radio', 'scenes', 'ambience', 'music']);
const FADE_SECONDS = 1.5;

export function createSoundboard({ index, base, fetchBytes, createContext, canPlayOpus, levels = {} }) {
  const cues = new Map(index.sounds.map(sound => [sound.cue, sound]));
  const format = canPlayOpus ? 'opus' : 'mp3';
  const buffers = new Map(), channels = new Map();
  let context = null, master = null, groups = null, muted = false;
  const level = group => Math.max(0, Math.min(1, levels[group] ?? 1)) * (index.suggestedMix?.[group] ?? 1);

  function ensure() {
    if (context) return context;
    context = createContext();
    master = context.createGain(); master.gain.value = muted ? 0 : 1; master.connect(context.destination);
    groups = Object.fromEntries(SOUND_GROUPS.map(group => { const gain = context.createGain(); gain.gain.value = level(group); gain.connect(master); return [group, gain]; }));
    return context;
  }
  function buffer(cue) {
    const sound = cues.get(cue);
    if (!sound) return Promise.reject(new Error('UNKNOWN_CUE'));
    if (!buffers.has(cue)) {
      buffers.set(cue, fetchBytes(`${base}${sound[format]}`).then(bytes => ensure().decodeAudioData(bytes)).catch(error => { buffers.delete(cue); throw error; }));
    }
    return buffers.get(cue);
  }
  function source(decoded, group) {
    const node = context.createBufferSource(); node.buffer = decoded;
    const gain = context.createGain(); node.connect(gain); gain.connect(groups[group]);
    return { node, gain };
  }
  /** Starts a loop (or a music track with its restart gap) on a named channel, fading out whatever played there. */
  async function playOn(channel, cue) {
    const current = channels.get(channel);
    if (current?.cue === cue) return;
    if (current) stopChannel(channel);
    if (!cue || !context) return;
    const token = {};
    channels.set(channel, { cue, token, voice: null });
    const sound = cues.get(cue);
    let decoded;
    try { decoded = await buffer(cue); } catch { return; }
    const startVoice = () => {
      const held = channels.get(channel);
      if (held?.token !== token || !context) return;
      const voice = source(decoded, sound.group), now = context.currentTime;
      const fadeIn = sound.loop?.fadeInSeconds ?? FADE_SECONDS;
      voice.gain.gain.setValueAtTime(0, now); voice.gain.gain.linearRampToValueAtTime(1, now + fadeIn);
      if (sound.kind === 'loop' && sound.loop) {
        voice.node.loop = true; voice.node.loopStart = sound.loop.start; voice.node.loopEnd = sound.loop.end;
        voice.node.start(now, sound.loop.start);
      } else {
        voice.node.start(now);
        voice.node.onended = () => { if (channels.get(channel)?.token === token) setTimeout(startVoice, (sound.loop?.restartGapSeconds ?? 2) * 1000); };
      }
      held.voice = voice;
    };
    startVoice();
  }
  function stopChannel(channel) {
    const held = channels.get(channel);
    channels.delete(channel);
    if (!held?.voice || !context) return;
    const { node, gain } = held.voice, now = context.currentTime, fadeOut = cues.get(held.cue)?.loop?.fadeOutSeconds ?? FADE_SECONDS;
    node.onended = null;
    gain.gain.cancelScheduledValues(now); gain.gain.setValueAtTime(gain.gain.value, now); gain.gain.linearRampToValueAtTime(0, now + fadeOut);
    node.stop(now + fadeOut + 0.05);
  }
  return Object.freeze({
    /** Call from a key press or tap: browsers only start audio after one. */
    async unlock() { await ensure().resume?.(); },
    get unlocked() { return context !== null && context.state !== 'suspended'; },
    async play(cue) {
      if (!context || muted) return;
      try { const decoded = await buffer(cue); const voice = source(decoded, cues.get(cue).group); voice.node.start(); } catch { /* A missing sound never blocks the Shuttle. */ }
    },
    ambience(cue) { return playOn('ambience', cue); },
    music(cue) { return playOn('music', cue); },
    radio(on) { return playOn('radio', on ? 'DLG-05' : null); },
    preload(list) { for (const cue of list) buffer(cue).catch(() => {}); },
    setLevel(group, value) {
      levels[group] = value;
      if (groups?.[group]) groups[group].gain.setTargetAtTime(level(group), context.currentTime, 0.05);
    },
    setMuted(value) { muted = Boolean(value); if (master) master.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.05); },
    /** Hidden Activity: suspend everything; shown again: resume where it was. */
    setHidden(hidden) { if (!context) return; if (hidden) context.suspend?.(); else context.resume?.(); },
  });
}
