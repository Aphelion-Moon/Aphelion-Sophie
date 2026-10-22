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
| `content/shuttle-activity/viewscreens/*.json`, `moments.json` | Viewscreen art with link cards, and which section stages which beat. Written by `scripts/author-shuttle-viewscreens.mjs`; validated by `modules/onboarding/activity-media.js`. |
| `scripts/author-shuttle-scenes.mjs` | The drawing tool that writes those files. Output is deterministic. |
| `tests/shuttle-scenes.test.js`, `tests/shuttle-scene-player.test.js` | Format, safety and playback tests. |

## The six scenes

| Scene | Used for | Moving parts |
|---|---|---|
| `hangar-viewport` | Title screen | Drifting stars, a shuttle crossing the orbit, station beacon, console flaps (SM engine, carp count, honk level), screen waveform, panel scan, cable pulse, a passing space carp. The Shuttle Link panel says what the server last reported (`link`); in portrait it floats above the console so the menu never covers it. |
| `departure-lounge` | Rules entry, The Brochure | Panelled back wall with framed, gridded windows (stars only behind the glass); APC, air alarm and fire alarm; tiled floor with scuffs, cracks and dropped things; split-flap departures (mining shuttle delayed by carp, clown car); help desk; Ian trotting past. Beats: 18+ check, pride banner and tail, lit EXIT, help desk `#open-a-ticket` and blinking fire alarm, rules terminal, Meridian Rift and Wolfgate on the board. |
| `baggage-hall` | Pack Your Bags | Conveyor belt and rollers moving with the suitcases, scanner sweep, locker tags, cart, a monkey, a clown passing. Beats: bags tagged BUBBER/SPLURT/NOVA retagged MERIDIAN with the preferences console, an unclaimed locker with a hero's cape, a LOOC bubble. |
| `boarding-cabin` | Board the Shuttle | Portholes, aisle lights, fasten-straps sign, carp. Beats: passengers fill the seats, "ONE PASSENGER PER SEAT", a sea lion on the KEEP CLEAR pad under the shuttle's shadow. |
| `viewport` | Admire the Lights | Station lights, a drifting band of light, stars, carp, a shooting star, deck and bench. Beats: a festive band, a "10,000 TODAY" counter, a camera flash and photo strip. |
| `pressure-door` | Disembarking | Lamp and control panel follow Whitelist status; the door slides open onto the laboratory once it is confirmed, and an ID card reading ACCESS: WHITELIST appears only then. Beats: wet floor and NO RUNNING signs, suggestion box, emergency locker, a ticking checklist, a game monitor with `[ Get Whitelisted ]`. |

Each scene has a landscape grid (120 by 40 cells, desktop and web) and a portrait grid (72 by 57 cells, phones),
with alt text for each Whitelist state that changes the picture.

## Scene format

A scene is JSON with exactly `schema`, `id`, `title`, `alt`, `provenance` and `layouts`. Each layout has:

- **Layers:** glyph rows with a matching colour mask, positioned on the grid. A layer may have up to 24 frames at up
  to 12 frames a second, may be opaque, and may slide with the door. A layer or effect can apply only in some states
  (`when`): Whitelist status (`none`, `requested`, `confirmed`), whether there is a run to show (`stop`: `none`
  or `some`, which is `some` once the stop number and count are known), the beat being staged (`beat`: one the
  scene declares in its optional `beats` list, or `none`; an unknown beat draws the plain scene) and the title
  panel's link state (`link`: `none`, `ready`, `closed`, `channel`, `arrived`, `held`, `offline`).
- **Effects** from a fixed list: `blink`, `flicker`, `drift`, `scan`, `pulse`, `flap` (optionally left or right
  aligned), `text` and `sprite` (a small multi-line figure, up to 8 by 24 cells and 4 frames, crossing along a line
  in a window every so many seconds; hidden with motion off). Each has bounded parameters. There is no code, URL, HTML
  or free-form script anywhere in the format. A layout has at most 48 layers and 64 effects.

The validator enforces:

- Only printable ASCII plus a short list of box, block and mark characters (`SCENE_GLYPHS`), and only the palette's
  colour keys.
- Every part fits the grid; ids are unique; unknown fields are refused.
- **Photosensitivity:** blinking and flicker no faster than three times a second, and flicker over no more than 3% of
  the grid.
- Text templates may use only the stop title, stop number and count, section and section count. Numbers can be
  zero-padded to up to three digits, as in `{stopNumber:2}`. Run state is normalised before drawing: unknown characters
  become `?`, and text is never read as markup.
- **Truthfulness:** the door counts as open only when the Whitelist status is `confirmed`, whatever the animation
  value says. A requested or missing status always draws it shut.

## Rendering

The composer returns rows of glyphs and colour keys. The canvas renderer draws block shading as exact rectangles and
single and double line characters as strokes that reach the cell edges, so borders join cleanly whatever the font.
Other glyphs use Cozette, the font chosen in D4. The renderer measures the font's height and width, sizes each glyph
to the cell's height, stretches it to the cell's width and centres it on the font's own metrics, so text keeps the
grid's spacing. It re-measures once the web font has loaded. Cozette 1.30.0 (MIT) ships at
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

## Moments and viewscreens

`moments.json` maps each stage's section headings (normalised by `headingKey`: no markdown, plain quotes, lower case,
no closing punctuation) to a beat and optionally a viewscreen. A transmission stages its first heading, or else the
last heading before it; a top-level heading with no moment returns to the plain scene. The layout editor can replace
any of these per stop. Viewscreens are at most 40 by 16 cells of the same glyphs and colours as scenes, with alt text,
up to six https link cards and a provenance record. All of them were made by the coding agent; SS13 references are
shared community culture only (owner decision of 22 October 2026), and no SS13 sprite or sound is copied.

```bash
node scripts/author-shuttle-viewscreens.mjs
```

## Still open

- Owner review of the second-pass art in the test Discord.
