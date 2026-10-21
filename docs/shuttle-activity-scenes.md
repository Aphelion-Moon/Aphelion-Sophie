# Shuttle Activity scenes

Scope: P42 (owner decisions of 21 October 2026: D2 artwork, D4 Cozette, and the visual novel plan). The Activity draws
each stop's backdrop as animated ASCII art. Scenes are bounded data, drawn by a pure module and painted by a canvas
renderer. No AI is involved, no member or case data enters a scene, and nothing in a scene grants access or changes
a run.

## Files

| Path | What it is |
|---|---|
| `modules/onboarding/scenes.js` | Scene format, validator and frame composer. Pure: runs in Node and in the browser. |
| `apps/activity/scene-canvas.js` | Paints composed frames on a canvas, redrawing only changed cells. |
| `apps/activity/scene-player.js` | Picks the grid, runs playback at up to 12 frames a second, holds still frames, opens the door. |
| `content/shuttle-activity/scenes/*.json` | The six scenes, as validated data. |
| `scripts/author-shuttle-scenes.mjs` | The drawing tool that writes those files. Output is deterministic. |
| `tests/shuttle-scenes.test.js`, `tests/shuttle-scene-player.test.js` | Format, safety and playback tests. |

## The six scenes

| Scene | Used for | Moving parts |
|---|---|---|
| `hangar-viewport` | Title screen | Drifting stars, a shuttle crossing the orbit, station beacon, console lamps, screen waveform, panel scan and cable pulse. The panel shows the stop and Whitelist status. |
| `departure-lounge` | Rules entry, The Brochure | Split-flap status, window stars, a flickering tube, dust, a sign chase. The board and strip show the stop and section. |
| `baggage-hall` | Pack Your Bags | Conveyor belt with suitcases, scanner sweep, blinking locker tags. |
| `boarding-cabin` | Board the Shuttle | Stars in the portholes, running aisle lights, the fasten-straps sign. |
| `viewport` | Admire the Lights | Station lights, a drifting band of light, stars. |
| `pressure-door` | Disembarking | Lamp and control panel follow Whitelist status; the door slides open onto the laboratory once it is confirmed. |

Each scene has a landscape grid (120 by 40 cells, desktop and web) and a portrait grid (72 by 57 cells, phones),
with alt text for each Whitelist state that changes the picture.

## Scene format

A scene is JSON with exactly `schema`, `id`, `title`, `alt`, `provenance` and `layouts`. Each layout has:

- **Layers:** glyph rows with a matching colour mask, positioned on the grid. A layer may have up to 24 frames at up
  to 12 frames a second, may apply only in some Whitelist states (`when`), may be opaque, and may slide with the door.
- **Effects** from a fixed list: `blink`, `flicker`, `drift`, `scan`, `pulse`, `flap` and `text`. Each has bounded
  parameters. There is no code, URL, HTML or free-form script anywhere in the format.

The validator enforces:

- Only printable ASCII plus a short list of box, block and mark characters (`SCENE_GLYPHS`), and only the palette's
  colour keys.
- Every part fits the grid; ids are unique; unknown fields are refused.
- **Photosensitivity:** blinking and flicker no faster than three times a second, and flicker over no more than 3% of
  the grid.
- Text templates may use only the stop title, stop number and count, section and section count. Run state is
  normalised before drawing: unknown characters become `?`, and text is never read as markup.
- **Truthfulness:** the door counts as open only when the Whitelist status is `confirmed`, whatever the animation
  value says. A requested or missing status always draws it shut.

## Rendering

The composer returns rows of glyphs and colour keys. The canvas renderer draws block characters as exact rectangles
and other glyphs with Cozette, the font chosen in D4. Cozette 1.30.0 (MIT) ships at
`apps/activity/fonts/CozetteVector.woff2`, pinned with its hash in `legal/DEPENDENCIES.json` (`activityFont`). Its
notice is in `legal/notices/cozette-1.30.0.txt`. The Activity page loads it under the family name the renderer
expects:

```css
@font-face { font-family: Cozette; src: url(fonts/CozetteVector.woff2) format('woff2'); font-display: block; }
```

`tests/shuttle-font.test.js` checks the file and notice hashes, and that the font maps every character in
`SCENE_GLYPHS` and every character the committed scenes use. Widening `SCENE_GLYPHS` fails that test until the font
covers the new character. The canvas is hidden from
assistive technology; the page shows the scene's alt text. Playback stops on a still frame when reduced motion is
set, the Motion setting is off, the page is hidden, or the player is paused for picture-in-picture or a heat warning.
The door's opening animation still plays once after confirmation, then the player goes idle.

## Provenance

Every scene records who made it, when, under which decision, the generator, and its rights: the coding agent made
them at owner direction, and machine-made art may not attract copyright in every jurisdiction. To change a scene, edit
`scripts/author-shuttle-scenes.mjs`, run it, and review the result.

```bash
node scripts/author-shuttle-scenes.mjs
```

## Still open

- Owner review of the scene art.
- Wiring the player into the Activity client and its title screen (P43).
