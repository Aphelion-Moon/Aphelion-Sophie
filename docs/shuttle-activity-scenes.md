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
| `hangar-viewport` | Title screen (the whole window) | The rainbow stripes and the APHELION logo top left; Aphelion station top right (a beacon on a mast with a dish and two modules, a ring with lit windows round a cyan hub, solar arrays on trusses, a docking module with a pulsing light; drawn from its left half and mirrored); a small sun and a dotted orbit under the logo, the shuttle running along its upper half clear of the subtitle; a carp swimming out from behind the station; drifting stars. Below, the console: a terminal window titled `sophie@aphelion: shuttle` whose inside is the `menu` slot (the page puts its splash prompt and real menu there), the Shuttle Link panel (what the server last reported, `link`), the old status screen with its flaps and waveform, lamps, switches and knobs, a new cable with a pulse and a cyan seam in the metal. |
| `departure-lounge` | Rules entry, The Brochure | Panelled back wall with framed, gridded windows (stars only behind the glass); APC, air alarm and fire alarm; tiled floor with scuffs, cracks and dropped things; split-flap departures (mining shuttle delayed by carp, clown car) with the section strip centred under it; the help desk (take a number, NOW SERVING flipping on) standing on two legs; a MOTHROACH CROSSING sign; benches that a mothroach scuttles under now and then; Ian trotting past (one bark). Rook and Pip wait on the benches, not yet met. Beats: 18+ check, the pride banner and tail (up from *pride* on, and they stay), the boxed EXIT always lit and chasing at *voluntary*, help desk `#open-a-ticket` and blinking fire alarm, rules terminal, Meridian Rift and Wolfgate on the board. |
| `baggage-hall` | Pack Your Bags | Lockers, with a mothroach walking their tops past the ceiling lights; the BAGGAGE CHECK-IN terminal up on the wall left of the belt; one `conveyor` of sixteen bags (every design in the owner's pick) through the scanner arch, its beam sweeping and two lamps blinking on top, the scale reading each bag's weight or DENIED (with the scanner's buzz); refused bags pushed off into DISPOSALS (a whoosh); the BLASTWAVE bag on the floor on a 24-second cycle (flames for 15 seconds, the firebot rolls out of its dock and foams it out with the extinguisher sound, smoke, cold, a spark at 23 seconds with the flame sound, alight again); cart, monkey, clown in big shoes (HONK, not during the LOOC talk). Beats: while migrating, SS 13 bags (BUBBER, SPLURT, NOVA, OCULIS, RATWOOD, MARINES) come out MERIDIAN and SS 14 bags (MONOLITH, HARDLIGHT, AFTERLIGHT, FRONTIER, WAYFARER) come out WOLFGATE beside the preferences console; refused bags are labelled for the section (CONTRABAND/TOXICITY, BIGOTRY/BAN DODGE, GRUDGES/OLD DRAMA, METAGAME/ASSUMPTION); the cape left in locker 12 (from *past* on); at *looc* Rook and Pip walk up to the belt, talk the copy's LOOC exchange through once in `(( ))` bubbles, and walk off towards the gate. |
| `landing-bay` | Board the Shuttle: *You are not travelling alone* | The departure bay open to space behind a shimmering field, the Arrivals Shuttle on its pad with its engines glowing and the ramp down, "GATE 03 · DEPARTURES" and "ARRIVALS SHUTTLE » APHELION", passengers crossing the bay in small groups and climbing the ramp behind the hull, ground crew waving light wands up and across, a baggage tug. Rook and Pip lead the first group up the ramp, once. Ambience AMB-07. |
| `boarding-cabin` | Board the Shuttle (the stop's scene; *A shared seat*) | Portholes, aisle lights, fasten-straps sign, an assistant asleep in a nightcap (snoring) and a horned lizard already aboard. Beat: passengers file along the row behind the seat backs and sit down, "ONE PASSENGER PER SEAT"; Pip asks a stranger "ooh, mind if I squeeze in next to you?", is told no, says "all good!", asks Rook, and sits beside them. The talk plays once. |
| `cabin-turbulence` | Board the Shuttle: *sea-lions* | The cabin's forward window on the launch rail, played once on the section's clock and then held: straps click, the rail comes up, a sea lion on the KEEP CLEAR line says "Explain.", "Explain again." and "Just asking questions.", THUMP, a jolt in the cabin (bins, a bag and a cup hop, passengers start, Rook and Pip bounce in the front row), the sea lion slides off dazed and unhurt, and the rail drops away into stars. |
| `viewport` | Admire the Lights | A ringed gas giant, a nebula wisp, the station arc with lights, four satellites, a comet whose tail flickers, meteors, a cargo hauler, a container hauler, a tug and a ring freighter in their own lanes, a school of carp and a greytide adrift with a toolbox, all kept behind the glass. A tidy row of panels: OBSERVATION DECK, SPACE WEATHER (a flap) and PHOTO BOOTH; on the deck hydroponics trays, a bench of people looking out, a telescope, a deck lamp with a mothroach on its shade, a star map, the old camera and a SPACE COLA machine standing a step nearer (strollers pass behind it); someone strolls past. Rook and Pip walk in at *enjoy* (festive lights, a confetti pop) and stay at the star map; at *valuable* Pip asks what a greytide is and one drifts past for Rook to point at ("Everyone was new once"); at *photos* the shutter clicks, they talk about posting it, and the prints stay pinned to the booth; at *The lucky ten thousand* they play out the four exchanges once (water in a banana, a monkey cube, a welder and a fuel tank, Ian) under the "10,000 today" counter and leave together. |
| `pressure-door` | Disembarking | WELCOME TO APHELION banner and bunting; the STATION BOARD with the server's crew and online counts; lamp and control panel follow Whitelist status; the door slides open onto the station concourse (a CONCOURSE directory to Meridian Rift, Wolfgate and #general, people, lights) once it is confirmed, and a swipe card reading CREW · ACCESS: WHITELIST appears only then; two crew wave arrivals in under bobbing WELCOME signs; a luggage cart under MERIDIAN and WOLFGATE destination cards, a vending machine, hydroponics trays, a bench, new arrivals walking across behind them, the cleanbot puck. Rook and Pip step off the shuttle, queue at the door through the sections and clearance, say goodbye at *get-whitelisted*, and walk through ahead of the member once the door opens. Beats: the janitor arrives and mops at *watch-step* and leaves at *feedback*; the wet floor sign, a board with NO RUNNING built in and centred (blinking at *watch-step*), stays until *ready*; a note goes into the FEEDBACK drop terminal and it says it received it; the red-cross emergency locker's internals; the BOARDING CHECK wall screen ticks once with a stamp and stays ticked; the game monitor with `[ Get Whitelisted ]` stays lit from its section through clearance and arrival. Ambience after the door opens: AMB-06. |

Each scene has a landscape grid (96 by 40 cells, the area beside the reading column on desktop and web) and a
portrait grid (72 by 57 cells, phones), with alt text for each Whitelist state that changes the picture. The whole grid
is in view: nothing is drawn under the text. The title screen has no column: the hangar fills the window, its cells
stretched to the window's shape, and the menu sits in the art's own terminal window.

## Scene format

A scene is JSON with exactly `schema`, `id`, `title`, `alt`, `provenance` and `layouts`. Each layout has:

- **Layers:** glyph rows with a matching colour mask, positioned on the grid. A layer may have up to 24 frames at up
  to 12 frames a second, may be opaque, and may slide with the door. A layer or effect can apply only in some states
  (`when`): Whitelist status (`none`, `requested`, `confirmed`), whether there is a run to show (`stop`: `none`
  or `some`, which is `some` once the stop number and count are known), the beat being staged (`beat`: one the
  scene declares in its optional `beats` list, or `none`; an unknown beat draws the plain scene), the title
  panel's link state (`link`: `none`, `ready`, `closed`, `channel`, `arrived`, `held`, `offline`), and progress
  through the stop: `after` (any of these beats has been reached) and `until` (none of them has been reached yet).
  Reached beats come from position, not history: the beats staged on the pages up to the one being read, so Back
  takes them away again; while clearance runs and on arrival, every beat of the last stop counts as reached. That is
  how results stay once introduced (the pride banner, the cape, the ticked checklist) and props leave once their
  section is over (the wet floor sign).
- A layer may keep the section's `clock: 'beat'` and play `once`, holding its last frame (and showing the last frame
  with motion off).
- **Standing objects:** a layer marked `front: true` is something people walk behind (a sign, a desk, a cart, a seat
  row, the shuttle's hull). Sprites and belt items are never drawn on the cells it draws (all of its box, if it is
  opaque); speech bubbles still are. `tests/shuttle-scene-depth.test.js` lists the standing props each scene must mark.
- **Slots:** a layout may name regions for the page's own controls, `slots: { menu: [x, y, w, h] }`, on the grid. The
  title screen's `menu` slot is the inside of its terminal window; the player reports the slot's rectangle in CSS
  pixels from the live cell size (`slotRect`), and tells the page whenever it moves (`setLayoutHandler`), so the page
  can lay its splash prompt and menu over it.
- **Effects** from a fixed list: `blink`, `flicker`, `drift`, `scan`, `pulse`, `flap` (optionally left or right
  aligned), `text` (optionally centred or right-aligned), `sprite`, `dialogue`, `conveyor` and `cue`. Each has bounded
  parameters. There is no code, URL, HTML or free-form script anywhere in the format. A layout has at most 64 layers
  and 96 effects.
- **Cue:** a sound event, `{ at, cue }` on the wall clock (optionally repeating `every` so many seconds, kept in step
  with a looping effect) or on the beat clock (once per section). The cue must be a sound in
  `content/shuttle-activity/sounds/index.json` or one still being chosen (`PENDING_SOUND_CUES`); the Activity refuses
  to start otherwise. Cues fire only while the scene animates, so a still frame or Back plays nothing.
- **Sprites** are small multi-line figures (up to 8 by 24 cells and 4 frames) crossing along a line every so many
  seconds. A sprite may `hold` at its destination (people who walk in and stay), show a `rest` frame once there
  (sitting down), keep the section's `beat` clock (so it walks in when the section opens, not mid-cycle), and be
  `clip`ped to a window region (anything outside a window stays behind the glass). On the beat clock a sprite can
  play `once` after an optional `delay`, and `exit` after its hold (a third leg to a point off stage, then gone): an
  actor who stays across sections is an entrance on the first beat, a standing pose on the middle ones and an exit on
  the last. With motion off a sprite is hidden unless it names a `still` position or holds without an exit, in which
  case it is drawn where it ends up.
- **Dialogue:** two speakers' anchor points and up to six exchanges of up to six lines, each `[speaker, text]` of at
  most 120 characters, wrapped into a bubble up to 40 cells wide above whoever is speaking (`say` in quotes, `looc`
  in double brackets). Lines show one at a time with a pause between exchanges, after an optional delay, on the wall
  or beat clock, and play `once` (then the bubbles are gone). With motion off the opening line stays, unless the
  dialogue says `still: false`. The scene's alt text carries the content, and every line a companion says is also in
  the transcript.
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

In the fifth pass (22 October 2026) the owner chose each asset's design in a design picker: for every creature,
person, machine, prop, sign and the title screen, the coding agent drew three original alternatives beside the
current design, and the owner picked one per group (sometimes with a note, such as the clown's big shoes or the
scanner's lamps). Each picked asset is one named constant or drawing in the authoring script (`CORGI`, `CARP`,
`MOTHROACH`, `LOOKS`, `ROOK_LOOK`, `PIP_LOOK`, `JANITOR`, `GREETER`, `CLOWN`, `BAGS`, `FIRE`, `FIREBOT`, `VENDING`,
`PLANT`, `WET_SIGN`, `LOUNGE_SIGN`, `SHUTTLE_SIDE`, `COMET`, `HAULER`, `TUG`, `FREIGHTER`, `STATION_LEFT` and the
inline props), commented with the pick. All of it is original art; established ASCII art practice (line-style figures,
consistent light, glyph weight, keeping floor noise out from under figures) was used for technique only.

```bash
node scripts/author-shuttle-scenes.mjs
```

## Moments and viewscreens

`moments.json` maps each stage's section headings (normalised by `headingKey`: no markdown, plain quotes, lower case,
no closing punctuation) to a beat and optionally a viewscreen and a scene of its own. A section with its own scene
swaps to it behind the usual wipe (Board the Shuttle uses `landing-bay` and `cabin-turbulence`); its beat must be
one that scene draws. Pages break at every heading, so each section opens a page of its own and a page stages
exactly the section being read (its first heading, or else the last heading before it); a top-level heading with no
moment returns to the plain scene. A section scene swap plays that scene's announcement and ambience. The layout editor can replace
any of these per stop. Viewscreens are at most 40 by 16 cells of the same glyphs and colours as scenes, with alt text,
up to six https link cards and a provenance record. All of them were made by the coding agent; SS13 references are
shared community culture only (owner decision of 22 October 2026), and no SS13 sprite or sound is copied.

```bash
node scripts/author-shuttle-viewscreens.mjs
```

## Still open

- Owner review of the fifth pass (the picked designs, the full-page title screen, the BLASTWAVE cycle, walk-behind
  depth and the mothroaches) in the test Discord, installed as `ceb46cb`.
- None for sound: SC-07 (the launch roll) is approved, so every scene cue has its sound.
