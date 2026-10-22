import { browserScenePlayer } from '../scene-player.js';
import { createShuttleApi } from './api.js';
import { createSoundboard } from './audio.js';
import { connectDiscord, insideDiscord } from './discord.js';
import { SCENE_BACKGROUND, SCENE_PALETTE } from './palette.js';
import { createShuttle } from './shuttle.js';

/** Browser wiring for the Shuttle Activity (P43): real fetch, Web Audio, animation frames, storage and Discord. */
const SOUND_BASE = '/content/shuttle-activity/sounds/';
const json = async path => { const response = await fetch(path, { cache: 'no-cache' }); if (!response.ok) throw new Error('ASSET_UNAVAILABLE'); return response.json(); };
const scenes = new Map();
const loadScene = id => { if (!scenes.has(id)) scenes.set(id, json(`/content/shuttle-activity/scenes/${id}.json`).catch(error => { scenes.delete(id); throw error; })); return scenes.get(id); };
let storage = null;
try { storage = globalThis.localStorage ?? null; } catch { storage = null; }

let shuttle = null;
const api = createShuttleApi({ fetch: (...args) => fetch(...args), randomBytes: count => crypto.getRandomValues(new Uint8Array(count)),
  onSignal: online => shuttle?.setSignal(online) });
const player = browserScenePlayer({ host: document.getElementById('stage'), canvas: document.getElementById('scene'),
  altElement: document.getElementById('scene-alt'), palette: SCENE_PALETTE, background: SCENE_BACKGROUND });
const index = await json(`${SOUND_BASE}index.json`).catch(() => ({ sounds: [], suggestedMix: {} }));
const sound = createSoundboard({ index, base: SOUND_BASE, createContext: () => new AudioContext({ latencyHint: 'interactive' }),
  canPlayOpus: new Audio().canPlayType('audio/ogg; codecs=opus') !== '',
  fetchBytes: async path => { const response = await fetch(path); if (!response.ok) throw new Error('SOUND_UNAVAILABLE'); return response.arrayBuffer(); } });
const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
const timers = {
  now: () => performance.now(),
  after: (ms, fn) => setTimeout(fn, ms), every: (ms, fn) => setInterval(fn, ms), clear: handle => { clearTimeout(handle); clearInterval(handle); },
  frame: fn => requestAnimationFrame(fn), cancelFrame: handle => { if (handle !== undefined) cancelAnimationFrame(handle); },
};
shuttle = createShuttle({ document, api, player, loadScene, sound, storage, timers, reducedMotion: () => reduce?.matches === true,
  async connect(handlers) {
    if (!insideDiscord(location.search)) return null;
    const { applicationId } = await api.config();
    return connectDiscord({ applicationId, api, ...handlers });
  } });
await shuttle.start();
