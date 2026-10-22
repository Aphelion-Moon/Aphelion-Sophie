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
| `content/shuttle-activity/scenes/*.json` | The eight scenes, as validated data. |
| `content/shuttle-activity/viewscreens/*.json`, `moments.json` | Viewscreen art with link cards, and which section stages which beat. Written by `scripts/author-shuttle-viewscreens.mjs`; validated by `modules/onboarding/activity-media.js`. |
| `scripts/author-shuttle-scenes.mjs` | The drawing tool that writes those files. Output is deterministic. |
| `tests/shuttle-scenes.test.js`, `tests/shuttle-scene-player.test.js` | Format, safety and playback tests. |

## The eight scenes

| Scene | Used for | Moving parts |
|---|---|---|
| `hangar-viewport` | Title screen | Drifting stars, a shuttle crossing the orbit to Aphelion station (a ring on cross spokes round a lit hub, solar arrays, antenna beacon, docking collar, blinking windows; drawn from its left half and mirrored), console flaps (SM engine, carp count, honk level), screen waveform, panel scan, cable pulse, a passing space carp. The Shuttle Link panel says what the server last reported (`link`); in portrait it floats above the console so the menu never covers it. |
| `departure-lounge` | Rules entry, The Brochure | Panelled back wall with framed, gridded windows (stars only behind the glass); APC, air alarm and fire alarm; tiled floor with scuffs, cracks and dropped things; split-flap departures (mining shuttle delayed by carp, clown car) with the section strip centred under it; help desk; wet floor sign; Ian trotting past. Beats: 18+ check, pride banner and tail, lit EXIT, help desk `#open-a-ticket` and blinking fire alarm, rules terminal, Meridian Rift and Wolfgate on the board. |
| `baggage-hall` | Pack Your Bags | Lockers; the claim terminal up on the wall left of the belt; one `conveyor` of thirteen bags through the scanner arch, the scale reading each bag's weight or DENIED; refused bags pushed off into DISPOSALS; the BLASTWAVE bag burning on the floor while a firebot foams it out and it lights itself again; cart, monkey, clown. Beats: while migrating, SS 13 bags (BUBBER, SPLURT, NOVA, OCULIS, RATWOOD, MARINES) come out MERIDIAN and SS 14 bags (MONOLITH, HARDLIGHT, AFTERLIGHT, FRONTIER, WAYFARER) come out WOLFGATE beside the preferences console; refused bags are labelled for the section (CONTRABAND/TOXICITY, BIGOTRY/BLASTWAVE, GRUDGES/OLD DRAMA, METAGAME/ASSUMPTION); an unclaimed locker with a hero's cape; two passengers walk in and talk the LOOC section through in `(( ))` bubbles. |
| `landing-bay` | Board the Shuttle: *You are not travelling alone* | The bay open to space behind a shimmering field, the Arrivals Shuttle on its pad with the ramp down, passengers crossing the bay in small groups and climbing the ramp, ground crew with light wands, the gate board, a baggage tug. |
| `boarding-cabin` | Board the Shuttle (the stop's scene; *A shared seat*) | Portholes, aisle lights, fasten-straps sign, a sleeping assistant and a lizard already aboard. Beat: passengers walk in and sit down, "ONE PASSENGER PER SEAT", and in the front row someone asks "Is this seat free?" before sitting (and takes no for an answer). |
| `cabin-turbulence` | Board the Shuttle: *sea-lions* | The cabin's forward window on final approach: the KEEP CLEAR pad comes up past chasing approach lights, a sea lion on it looks up, THUMP, a jolt in the cabin (bins, a bag and a cup hop, passengers start), then a dazed, unhurt sea lion beside the marking. |
| `viewport` | Admire the Lights | A ringed gas giant, a nebula wisp, the station arc with lights, a satellite, a comet, meteors, a cargo hauler, a school of carp and a greytide adrift with a toolbox, all kept behind the glass. A tidy row of panels: OBSERVATION DECK, SPACE WEATHER (a flap) and PHOTO BOOTH; on the deck a bench of people looking out, a telescope, a star map, the old camera, a SPACE COLA machine and plants; someone strolls past. Beats: festive lights and confetti, "Everyone was new once", SMILE! and a photo strip, and on the page that links xkcd's Ten Thousand two crew meet and play it out in four rotating exchanges (water in a banana, a monkey cube, a welder and a fuel tank, Ian) under the "10,000 today" counter. |
| `pressure-door` | Disembarking | WELCOME TO APHELION banner and bunting; the STATION BOARD with the server's crew and online counts; lamp and control panel follow Whitelist status; the door slides open onto the laboratory once it is confirmed, and an ID card reading ACCESS: WHITELIST appears only then; two crew wave arrivals in; a janitor mops; luggage carts, a vending machine, new arrivals walking across, the cleanbot. Beats: the janitor's wet floor sign and NO RUNNING, a note going into the feedback box, the emergency locker's internals, a ticking checklist, a game monitor with `[ Get Whitelisted ]`. |

Each scene has a landscape grid (96 by 40 cells, the area beside the reading column on desktop and web) and a
portrait grid (72 by 57 cells, phones), with alt text for each Whitelist state that changes the picture. The whole grid
is in view: nothing is drawn under the text.

## Scene format

A scene is JSON with exactly `schema`, `id`, `title`, `alt`, `provenance` and `layouts`. Each layout has:

- **Layers:** glyph rows with a matching colour mask, positioned on the grid. A layer may have up to 24 frames at up
  to 12 frames a second, may be opaque, and may slide with the door. A layer or effect can apply only in some states
  (`when`): Whitelist status (`none`, `requested`, `confirmed`), whether there is a run to show (`stop`: `none`
  or `some`, which is `some` once the stop number and count are known), the beat being staged (`beat`: one the
  scene declares in its optional `beats` list, or `none`; an unknown beat draws the plain scene) and the title
  panel's link state (`link`: `none`, `ready`, `closed`, `channel`, `arrived`, `held`, `offline`).
- **Effects** from a fixed list: `blink`, `flicker`, `drift`, `scan`, `pulse`, `flap` (optionally left or right
  aligned), `text` (optionally centred or right-aligned), `sprite`, `dialogue` and `conveyor`. Each has bounded
  parameters. There is no code, URL, HTML or free-form script anywhere in the format. A layout has at most 64 layers
  and 96 effects.
- **Sprites** are small multi-line figures (up to 8 by 24 cells and 4 frames) crossing along a line every so many
  seconds. A sprite may `hold` at its destination (people who walk in and stay), show a `rest` frame once there
  (sitting down), keep the section's `beat` clock (so it walks in when the section opens, not mid-cycle), and be
  `clip`ped to a window region (anything outside a window stays behind the glass). With motion off a sprite is hidden
  unless it names a `still` position or holds, in which case it is drawn where it ends up.
- **Dialogue:** two speakers' anchor points and up to six exchanges of up to six lines, each `[speaker, text]` of at
  most 120 characters, wrapped into a bubble up to 40 cells wide above whoever is speaking (`say` in quotes, `looc`
  in double brackets). Lines show one at a time with a pause between exchanges, after an optional delay, on the wall
  or beat clock. With motion off the opening line stays. The scene's alt text carries the content.
- **Conveyor:** up to 16 items riding one belt row through a gate at one speed, enough of them to fill the belt. Each
  item has its own art and weight, and a tag before and after the gate chosen per beat; a diverted item leaves the
  belt for a chute point instead of riding on. A readout at the gate shows the weight (or DENIED) of the item inside
  it, exactly while it is inside. With motion off the items rest at their spacing.

The validator enforces:

- Only printable ASCII plus a short list of box, block and mark characters (`SCENE_GLYPHS`), and only the palette's
  colour keys.
- Every part fits the grid; ids are unique; unknown fields are refused.
- **Photosensitivity:** blinking and flicker no faster than three times a second, and flicker over no more than 3% of
  the grid.
- Text templates may use only the stop title, stop number and count, section and section count, and the server's
  `{crew}` and `{online}` counts (digits, or `--` when core did not send them; never a member's details). Numbers can be
  zero-padded to up to three digits, as in `{stopNumber:2}`. Run state is normalised before drawing: unknown characters
  become `?`, and text is never read as markup.
- **Truthfulness:** the door counts as open only when the Whitelist status is `confirmed`, whatever the animation
  value says. A requested or missing status always draws it shut.

## Rendering

The composer returns rows of glyphs and colour keys. The canvas renderer clips every glyph to its own cell (an edge drawn past it would stay behind, since unchanged cells
are not redrawn), draws block shading as exact rectangles and
single and double line characters as strokes that reach the cell edges, and `■` and `□` as squares centred in the
cell, so borders join cleanly whatever the font.
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
no closing punctuation) to a beat and optionally a viewscreen and a scene of its own. A section with its own scene
swaps to it behind the usual wipe (Board the Shuttle uses `landing-bay` and `cabin-turbulence`); its beat must be
one that scene draws. A transmission stages its first heading, or else the
last heading before it; a top-level heading with no moment returns to the plain scene. The layout editor can replace
any of these per stop. Viewscreens are at most 40 by 16 cells of the same glyphs and colours as scenes, with alt text,
up to six https link cards and a provenance record. All of them were made by the coding agent; SS13 references are
shared community culture only (owner decision of 22 October 2026), and no SS13 sprite or sound is copied.

```bash
node scripts/author-shuttle-viewscreens.mjs
```

## Still open

- Owner review of the third-pass art in the test Discord.
