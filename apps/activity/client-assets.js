import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { moduleClosure } from './module-closure.js';

export const CLIENT_PAGE = 'apps/activity/client/index.html';
export const CLIENT_ENTRY = 'apps/activity/client/app.js';
const TYPES = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.png': 'image/png' });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * Every file the Shuttle Activity client may load, read once at start and served at its repository path: the page,
 * the module graph of its entry (scene engine, shared validation, the vendored SDK), its stylesheet, the pinned font,
 * the scenes, the approved sounds, and the rules post's art images (fetched by Discord for the post, not by the client).
 * Pinned files are checked against their recorded hashes; nothing else is served.
 */
export async function loadActivityClient(root) {
  const files = new Map();
  const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
  async function add(path, expected = null) {
    const type = TYPES[extname(path)];
    if (!type) throw new Error(`ACTIVITY_ASSET_TYPE_UNSUPPORTED ${path}`);
    const body = await readFile(resolve(root, path)), digest = sha256(body);
    if (expected !== null && digest !== expected) throw new Error(`ACTIVITY_ASSET_PIN_MISMATCH ${path}`);
    files.set(`/${path}`, Object.freeze({ body, type, etag: `"${digest.slice(0, 32)}"` }));
  }
  await add(CLIENT_PAGE); files.set('/', files.get(`/${CLIENT_PAGE}`));
  const read = path => { try { return readFileSync(resolve(root, path), 'utf8'); } catch { return null; } };
  const sdk = await json('legal/embedded-app-sdk.json'), pinned = new Map(sdk.files.map(file => [file.path, file.sha256]));
  for (const path of moduleClosure(read, '', [CLIENT_ENTRY])) await add(path, pinned.get(path) ?? null);
  // The client must use every vendored module through the SDK's own imports, never a copy of its own.
  for (const path of pinned.keys()) if (!files.has(`/${path}`)) throw new Error(`ACTIVITY_SDK_INCOMPLETE ${path}`);
  await add('apps/activity/client/app.css');
  const font = (await json('legal/DEPENDENCIES.json')).activityFont;
  await add(font.path, font.sha256);
  for (const name of (await readdir(resolve(root, 'content/shuttle-activity/scenes'))).filter(name => name.endsWith('.json')).sort()) {
    await add(`content/shuttle-activity/scenes/${name}`);
  }
  for (const name of (await readdir(resolve(root, 'content/shuttle-activity/viewscreens'))).filter(name => name.endsWith('.json')).sort()) {
    await add(`content/shuttle-activity/viewscreens/${name}`);
  }
  await add('content/shuttle-activity/moments.json');
  await add('content/shuttle-activity/sounds/index.json');
  for (const sound of (await json('legal/shuttle-activity-sounds.json')).sounds) {
    for (const output of [sound.outputs.opus, sound.outputs.mp3]) await add(output.path, output.sha256);
  }
  for (const block of (await json('content/shuttle-activity/rules-post-banner.json')).blocks) await add(block.path, block.sha256);
  return files;
}
