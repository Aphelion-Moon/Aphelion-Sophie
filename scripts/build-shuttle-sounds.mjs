// Converts the chosen Shuttle Activity sound originals to Ogg Opus with MP3 fallbacks using the pinned
// build-time FFmpeg (owner decision of 21 October 2026). Development machine only; never run in production.
// Usage: node scripts/build-shuttle-sounds.mjs [--ffmpeg <ffmpeg.exe>] [--originals <dir>]
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const option = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ffmpeg = resolve(root, option('--ffmpeg') ?? '.local/tools/ffmpeg/extracted/ffmpeg-n9.0.2-17-g2a571b6068-win64-lgpl-9.0/bin/ffmpeg.exe');
const originals = resolve(root, option('--originals') ?? '.local/shuttle-sounds/shuttle-sounds-originals');
const outputDir = 'content/shuttle-activity/sounds';
const RATE = 48000;
// Loops carry this much of their own wrapped-around audio on each side, so codec start-up and decoder delay fall
// outside the loop markers.
const PAD = 0.5;

const json = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestPath = 'legal/shuttle-activity-sounds.json';
const manifest = await json(manifestPath);
const encoderReview = await json('legal/ffmpeg-build-time-encoder.json');
const { edits, suggestedMix } = await json('content/shuttle-activity/sound-edits.json');

if (sha256(await readFile(ffmpeg)) !== encoderReview.files['bin/ffmpeg.exe']) throw new Error('FFMPEG_PIN_MISMATCH');

/** @param {string[]} args */
function run(args, binary = false) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, windowsHide: true, encoding: binary ? 'buffer' : 'utf8' });
  if (result.status !== 0) throw new Error(`FFMPEG_FAILED: ${result.stderr}`);
  return result.stdout;
}
const n = value => Number(value).toFixed(6);

/** Builds the filter graph for one cue; times are seconds in the original. */
function graph(edit) {
  const head = `[0:a]aresample=${RATE}:resampler=soxr:precision=28`;
  const level = `volume=${edit.gainDb}dB`;
  if (edit.kind === 'music') return `${head},${level}[out]`;
  if (edit.kind === 'loop') {
    const { length: L, crossfade: X } = edit.loop;
    return [
      `${head},atrim=start=${n(edit.start)}:duration=${n(L + X)},asetpts=PTS-STARTPTS,${level},asplit=3[a][b][c]`,
      `[a]atrim=start=${n(X)}:end=${n(L)},asetpts=PTS-STARTPTS[body]`,
      `[b]atrim=start=${n(L)}:end=${n(L + X)},asetpts=PTS-STARTPTS,afade=t=out:st=0:d=${n(X)}:curve=qsin[tail]`,
      `[c]atrim=start=0:end=${n(X)},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${n(X)}:curve=qsin[lead]`,
      '[tail][lead]amix=inputs=2:normalize=0:duration=first[seam]',
      '[body][seam]concat=n=2:v=0:a=1,asplit=3[l1][l2][l3]',
      `[l1]atrim=start=${n(L - PAD)}:end=${n(L)},asetpts=PTS-STARTPTS[before]`,
      `[l3]atrim=start=0:end=${n(PAD)},asetpts=PTS-STARTPTS[after]`,
      '[before][l2][after]concat=n=3:v=0:a=1[out]',
    ].join(';');
  }
  return `${head},atrim=start=${n(edit.start)}:duration=${n(edit.duration)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=${n(edit.fadeIn)},afade=t=out:st=${n(edit.duration - edit.fadeOut)}:d=${n(edit.fadeOut)},${level}[out]`;
}

/** Decodes an output to mono float samples at 48 kHz. */
function decode(path) {
  const bytes = run(['-i', path, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], true);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
/** Jump at the loop markers relative to the mean sample step: about 1 means the loop end flows into its start. */
function seamRatio(x, start, end) {
  let step = 0;
  for (let i = start + 1; i < end; i++) step += Math.abs(x[i] - x[i - 1]);
  step /= end - start - 1;
  return step > 0 ? Math.abs(x[start] - x[end - 1]) / step : 0;
}

const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const group = cue => ({ UI: 'interface', DLG: 'radio', SC: 'scenes', AMB: 'ambience', MUS: 'music' })[cue.split('-')[0]];
await mkdir(resolve(root, outputDir), { recursive: true });
const index = { schemaVersion: 1, generatedBy: 'scripts/build-shuttle-sounds.mjs', sampleRate: RATE, suggestedMix, sounds: [] };

for (const sound of manifest.sounds) {
  const edit = edits[sound.cue];
  if (!edit) throw new Error(`EDIT_MISSING: ${sound.cue}`);
  const source = resolve(originals, sound.file.name);
  if (sha256(await readFile(source)) !== sound.file.sha256) throw new Error(`ORIGINAL_HASH_MISMATCH: ${sound.cue}`);
  const base = `${outputDir}/${slug(sound.cue)}-${slug(sound.name)}`;
  const common = ['-y', '-i', source, '-filter_complex', graph(edit), '-map', '[out]', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
  run([...common, '-c:a', 'libopus', '-b:a', `${edit.opusKbps}k`, '-vbr', 'on', '-application', 'audio', '-f', 'ogg', resolve(root, `${base}.opus`)]);
  run([...common, '-c:a', 'libmp3lame', '-q:a', String(edit.mp3Quality), '-id3v2_version', '0', '-write_id3v1', '0', '-f', 'mp3', resolve(root, `${base}.mp3`)]);

  const expectedSeconds = edit.kind === 'loop' ? edit.loop.length + 2 * PAD : edit.duration;
  const outputs = {};
  for (const [format, ext] of [['opus', 'opus'], ['mp3', 'mp3']]) {
    const path = `${base}.${ext}`;
    const bytes = await readFile(resolve(root, path));
    const samples = decode(resolve(root, path));
    const seam = edit.kind === 'loop' ? seamRatio(samples, Math.round(PAD * RATE), Math.round((PAD + edit.loop.length) * RATE)) : null;
    outputs[format] = {
      path, bytes: bytes.length, sha256: sha256(bytes), seconds: Math.round(samples.length / RATE * 1000) / 1000,
      ...(format === 'opus' ? { kbps: edit.opusKbps } : { lameVbrQuality: edit.mp3Quality }),
      ...(seam === null ? {} : { seamRatio: Math.round(seam * 100) / 100 }),
    };
  }
  if (Math.abs(outputs.opus.seconds - expectedSeconds) > 0.03) throw new Error(`OUTPUT_LENGTH_MISMATCH: ${sound.cue} ${outputs.opus.seconds} vs ${expectedSeconds}`);

  const changes = ['Converted to Ogg Opus and MP3 at 48 kHz.'];
  if (edit.kind === 'oneshot') changes.push(`Cut to ${edit.duration} s starting at ${edit.start} s, with ${edit.fadeIn * 1000} ms fade-in and ${edit.fadeOut * 1000} ms fade-out.`);
  if (edit.kind === 'loop') changes.push(`Cut to ${edit.loop.length + edit.loop.crossfade} s starting at ${edit.start} s and made into a ${edit.loop.length} s seamless loop with a ${edit.loop.crossfade} s crossfade, padded by ${PAD} s of its own audio on each side.`);
  changes.push(`Level ${edit.gainDb >= 0 ? 'raised' : 'lowered'} by ${Math.abs(edit.gainDb)} dB.`);
  sound.outputs = outputs;
  sound.changes = changes;
  index.sounds.push({
    cue: sound.cue, name: sound.name, group: group(sound.cue), plays: sound.plays, kind: edit.kind,
    opus: outputs.opus.path.replace(`${outputDir}/`, ''), mp3: outputs.mp3.path.replace(`${outputDir}/`, ''),
    seconds: expectedSeconds, samples: Math.round(expectedSeconds * RATE),
    loop: edit.kind === 'loop' ? { start: PAD, end: PAD + edit.loop.length } : edit.kind === 'music' ? { start: 0, end: edit.duration, restartGapSeconds: 2, fadeInSeconds: 2, fadeOutSeconds: 4 } : null,
    ...(sound.attribution ? { credit: `${sound.attribution} Changes: ${changes.join(' ')}` } : {}),
  });
  console.log(sound.cue.padEnd(7), String(outputs.opus.bytes).padStart(8), String(outputs.mp3.bytes).padStart(8), outputs.opus.seconds, outputs.mp3.seconds, outputs.opus.seamRatio ?? '', outputs.mp3.seamRatio ?? '');
}

manifest.status = 'Originals verified (see each file). Converted to Ogg Opus with MP3 fallbacks by scripts/build-shuttle-sounds.mjs; outputs and their hashes are listed per cue. Owner review is recorded under "review".';
await writeFile(resolve(root, manifestPath), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(resolve(root, `${outputDir}/index.json`), `${JSON.stringify(index, null, 2)}\n`);
const total = manifest.sounds.reduce((sum, s) => ({ opus: sum.opus + s.outputs.opus.bytes, mp3: sum.mp3 + s.outputs.mp3.bytes }), { opus: 0, mp3: 0 });
console.log(JSON.stringify({ sounds: manifest.sounds.length, opusBytes: total.opus, mp3Bytes: total.mp3 }));
