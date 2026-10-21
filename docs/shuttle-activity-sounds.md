# Shuttle Activity sounds

Scope: P42 (owner decisions of 21 October 2026, D10 and the encoding tool). The Activity has 24 sound cues. The owner
chose one CC0 or CC BY sound for each; the record of sources, licences and hashes is
[`legal/shuttle-activity-sounds.json`](../legal/shuttle-activity-sounds.json). No AI is involved anywhere in this
pipeline, and no member or case data touches it.

## Files

| Path | What it is |
|---|---|
| `.local/shuttle-sounds/shuttle-sounds-originals/` | The 24 originals the owner downloaded. Ignored by Git; their SHA-256 hashes are pinned in the sounds record. |
| `content/shuttle-activity/sound-edits.json` | Cut, loop, level and bitrate data per cue, as bounded data. |
| `scripts/build-shuttle-sounds.mjs` | Converts the originals with the pinned build-time FFmpeg. |
| `content/shuttle-activity/sounds/*.opus`, `*.mp3` | The converted sounds: Ogg Opus, plus an MP3 copy of each. |
| `content/shuttle-activity/sounds/index.json` | What the Activity reads: files, loop markers, sample counts, suggested mix and the CC BY credit. |

## Rebuilding

```bash
node scripts/build-shuttle-sounds.mjs
```

The script refuses to run unless `ffmpeg.exe` matches the hash in
[`legal/ffmpeg-build-time-encoder.json`](../legal/ffmpeg-build-time-encoder.json) and every original matches its
pinned hash. It writes both formats, decodes each output to check its length, measures every loop seam, and records
each output's size and SHA-256 in the sounds record. Outputs are byte-identical between runs (checked on
21 October 2026). FFmpeg is approved only on the development machine at build time; it is never shipped or run in
production. Use `--ffmpeg` and `--originals` to point at other locations.

## How the cuts were chosen

The cut and loop points were chosen by analysing each original's loudness envelope, not by ear. Each cue's reasoning is
in `sound-edits.json` under `basis`. They need the owner's audition before release.

- **One-shots** lose leading and trailing near-silence (40 dB below the sound's own peak) and get a short fade at each
  end. Three are cut further: the stop transition keeps up to 2.5 s from its first sound, the split-flap keeps the
  busiest 3.2 s, and the pressure door keeps the most energetic 5 s of the airlock sequence.
- **Loops** use the steadiest window of each recording. Its end is crossfaded into its start with an equal-power curve,
  so the loop is seamless, and 0.5 s of the loop's own audio pads each side. Players loop between the markers in
  `index.json` (`loop.start` to `loop.end`), so codec start-up and any decoder delay fall outside the loop. Measured
  seam jumps are between 0.06 and 1.3 times a normal sample step in both formats.
- **Music** is unchanged apart from level. Fades and the restart gap are applied at playback.
- **Level:** one-shots peak at -3 dBFS; loops and music are set to -23 LUFS with peaks at or below -1 dBFS. The
  Activity's mixer sets each group's volume (suggested values are in `index.json`).

## Playback rules

- Use Ogg Opus where the client can decode it, and the MP3 copy otherwise. Safari and iOS before 18.4 cannot play Ogg
  Opus; Discord supports iOS 16 and later.
- Sound starts only after the member interacts, with volume and mute in Settings.
- MUS-02 (arrival theme) plays only after Discord confirms Whitelist.
- The CC BY credit in `index.json` appears on the Credits screen; it also appears in
  [`legal/THIRD-PARTY-NOTICES`](../legal/THIRD-PARTY-NOTICES).

## Rollback

Delete the converted files and `index.json`, and restore the previous `legal/shuttle-activity-sounds.json`. The
originals and their pinned hashes are unaffected.
