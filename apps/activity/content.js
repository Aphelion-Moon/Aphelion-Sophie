import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateScene } from '../../modules/onboarding/scenes.js';
import { validateMoments, validateViewscreen } from '../../modules/onboarding/activity-media.js';
import { ACTIVITY_STOP_SCENES } from '../../modules/onboarding/activity.js';

/**
 * Story-pass sound cues the owner is still choosing (the Story Sound Picker, 22 October 2026). A scene may name one
 * before its file exists; until then it plays nothing. Each moves into sounds/index.json once picked and encoded.
 * All of them, SC-07 (the launch roll) last, were picked and encoded on 22 October, so none is pending now.
 */
export const PENDING_SOUND_CUES = Object.freeze([]);

/**
 * The shipped Shuttle Activity content core needs beside the client files: the default moments, each scene's beats
 * and the viewscreens (id → title), all validated at start. Read once; the layout editor and run views use it.
 */
export async function loadActivityContent(root) {
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  const list = async folder => (await readdir(resolve(root, folder))).filter(name => name.endsWith('.json')).sort();
  const viewscreens = new Map(), sceneBeats = new Map();
  for (const name of await list('content/shuttle-activity/viewscreens')) {
    const screen = validateViewscreen(await json(`content/shuttle-activity/viewscreens/${name}`)); viewscreens.set(screen.id, screen.title);
  }
  const sounds = new Set((await json('content/shuttle-activity/sounds/index.json')).sounds.map(sound => sound.cue));
  for (const name of await list('content/shuttle-activity/scenes')) {
    const scene = await json(`content/shuttle-activity/scenes/${name}`); validateScene(scene); sceneBeats.set(scene.id, Object.freeze([...(scene.beats ?? [])]));
    // A scene's own sounds must be real cues (or ones being chosen), so a typo never ships as silence.
    for (const layout of Object.values(scene.layouts)) for (const fx of layout.effects) {
      if (fx.kind === 'cue' && !sounds.has(fx.cue) && !PENDING_SOUND_CUES.includes(fx.cue)) throw new Error(`ACTIVITY_SCENE_CUE ${scene.id} ${fx.cue}`);
    }
  }
  const defaults = validateMoments(await json('content/shuttle-activity/moments.json'), new Set(viewscreens.keys()), new Set(ACTIVITY_STOP_SCENES));
  for (const [stage, moments] of Object.entries(defaults.stages)) for (const moment of Object.values(moments)) {
    if (moment.scene !== undefined && !(sceneBeats.get(moment.scene) ?? []).includes(moment.beat) && moment.beat !== 'none') throw new Error(`ACTIVITY_MOMENT_BEAT ${stage}`);
  }
  return Object.freeze({ defaults, sceneBeats, viewscreens });
}
