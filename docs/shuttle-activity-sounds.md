# Shuttle Activity sounds

Scope: P42 (owner decisions of 21 October 2026, D10 and the encoding tool) and the story pass (The Shuttle as a story,
22 October 2026). The Activity has 41 sound cues. The owner chose one CC0 or CC BY sound for each; the record of
sources, licences and hashes is [`legal/shuttle-activity-sounds.json`](../legal/shuttle-activity-sounds.json). No AI is
involved anywhere in this pipeline, and no member or case data touches it.

| Set | Cues | State |
|---|---|---|
| 21 October | UI-01–05, DLG-01–05, SC-01–06, AMB-01–05, MUS-01–02 | Auditioned and approved by the owner on 21 October. |
| Story, 22 October | DLG-06, SC-08–SC-21, AMB-07, and a new AMB-06 (the arrival concourse, replacing New laboratory) | Picked, verified and encoded on 22 October; auditioned and approved by the owner the same day, all 17 without changes (`review.story` in the record). |
| Second round, 22 October | SC-07 (launch roll) | Picked in a second round and encoded on 22 October; auditioned and approved by the owner the same day (`review.launchRoll`). A scene may name a cue that is still being chosen (`PENDING_SOUND_CUES` in `apps/activity/content.js`, now empty); it plays nothing until it is encoded. |

## Files

| Path | What it is |
|---|---|
| `.local/shuttle-sounds/shuttle-sounds-originals/` | The 21 October originals the owner downloaded. Ignored by Git; their SHA-256 hashes are pinned in the sounds record. |
| `.local/shuttle-sounds/story-originals/` | The story's originals (22 October), with the owner's `story-SHA256.csv` beside the folder. Ignored by Git; pinned the same way. |
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
21 October 2026, and again on 22 October, when the rebuild with the story's sounds reproduced all 23 unchanged approved
outputs). It looks for each original in both originals folders, and deletes the outputs of a cue that was replaced or
removed (the old AMB-06 files on 22 October). FFmpeg is approved only on the development machine at build time; it is
never shipped or run in production. Use `--ffmpeg` and `--originals` (folders separated by `;`) to point at other
locations.

## How the cuts were chosen

The cut and loop points were chosen by analysing each original's loudness envelope, not by ear. Each cue's reasoning is
in `sound-edits.json` under `basis`. The owner auditioned the results on 21 October 2026, in both formats with loops
and their seams, and approved all 24 without changes. Any later change to the edit data needs a new audition. The
story's cues were chosen by the same analysis on 22 October (each marked `chosenAt`); the extinguisher (SC-12) and the
mop (SC-19) keep up to their first 2 s and 4 s, faded out. The owner auditioned them on a second private page the
same day and approved all 17 without changes.

- **One-shots** lose leading and trailing near-silence (40 dB below the sound's own peak) and get a short fade at each
  end. Three are cut further: the stop transition keeps up to 2.5 s from its first sound, the split-flap keeps the
  busiest 3.2 s, and the pressure door keeps the most energetic 5 s of the airlock sequence.
- **Loops** use the steadiest window of each recording. Its end is crossfaded into its start with an equal-power curve,
  so the loop is seamless, and 0.5 s of the loop's own audio pads each side. Players loop between the markers in
  `index.json` (`loop.start` to `loop.end`), so codec start-up and any decoder delay fall outside the loop. Measured
  seam jumps are between 0.06 and 1.3 times a normal sample step in both formats for the 21 October set; the story's
  AMB-07 measures 1.42 (Opus) and 0.61 (MP3), and the new AMB-06 2.13 and 1.53; the owner's audition, which included
  a seam check, approved both.
- **Music** is unchanged apart from level. Fades and the restart gap are applied at playback.
- **Level:** one-shots peak at -3 dBFS; loops and music are set to -23 LUFS with peaks at or below -1 dBFS. The
  Activity's mixer sets each group's volume (suggested values are in `index.json`).

## Playback rules

- Use Ogg Opus where the client can decode it, and the MP3 copy otherwise. Safari and iOS before 18.4 cannot play Ogg
  Opus; Discord supports iOS 16 and later.
- Sound starts only after the member interacts, with volume and mute in Settings.
- MUS-02 (arrival theme) plays only after Discord confirms Whitelist.
- Scene event sounds (the story's SC cues and DLG-06) are named by the scene itself as `cue` effects and play on the
  scene's clock only while motion is on, so Back never replays a THUMP out of context. They are fetched with the
  scene. Ambience follows the scene on screen: the departure bay plays AMB-07, the arrival concourse AMB-06.
- The CC BY credit in `index.json` appears on the Credits screen; it also appears in
  [`legal/THIRD-PARTY-NOTICES`](../legal/THIRD-PARTY-NOTICES).

## Rollback

Delete the converted files and `index.json`, and restore the previous `legal/shuttle-activity-sounds.json`. The
originals and their pinned hashes are unaffected.
