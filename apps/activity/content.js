import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateScene } from '../../modules/onboarding/scenes.js';
import { validateMoments, validateViewscreen } from '../../modules/onboarding/activity-media.js';

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
  for (const name of await list('content/shuttle-activity/scenes')) {
    const scene = await json(`content/shuttle-activity/scenes/${name}`); validateScene(scene); sceneBeats.set(scene.id, Object.freeze([...(scene.beats ?? [])]));
  }
  const defaults = validateMoments(await json('content/shuttle-activity/moments.json'), new Set(viewscreens.keys()));
  return Object.freeze({ defaults, sceneBeats, viewscreens });
}
