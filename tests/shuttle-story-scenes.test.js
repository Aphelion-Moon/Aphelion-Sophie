import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { composeScene, validateScene } from '../modules/onboarding/scenes.js';

const shipped = async id => validateScene(JSON.parse(await readFile(new URL(`../content/shuttle-activity/scenes/${id}.json`, import.meta.url), 'utf8')));
const story = await readFile(new URL('../content/onboarding/story.md', import.meta.url), 'utf8');
const STATE = { beat: 'none', whitelist: 'none', stop: 'some', doorOpen: 0, reached: [], stopTitle: 'Stop', stopNumber: 1, stopCount: 5, section: 1, sections: 3,
  link: 'ready', crew: '--', online: '--' };
const picture = (scene, layout, beat, reached = [beat], time = 4) =>
  composeScene(scene, layout, { time, beatTime: time, state: { ...STATE, beat, reached } }).glyphs.join('\n');

// Where the story points at the scene ("see the…", "over there"), what it points at is drawn, on desktop and on phones.
test('T-STORY-SCENE-01 every scene the story points at shows what it names, in both layouts', async () => {
  const lounge = await shipped('departure-lounge'), hall = await shipped('baggage-hall'), door = await shipped('pressure-door');
  for (const layout of ['landscape', 'portrait']) {
    assert.match(story, /See the light over the gate\? Age check/);
    assert.match(picture(lounge, layout, 'adult'), /18\+/, `${layout}: the light over the gate`);
    assert.match(picture(lounge, layout, 'adult'), /GATE {2,3}03|GATE 03/, `${layout}: the gate`);
    assert.match(story, /Oh, you noticed the banner/); assert.match(picture(lounge, layout, 'pride'), /▄▄▄▄▄▄/, `${layout}: the banner`);
    assert.match(story, /See the EXIT sign\?/); assert.match(picture(lounge, layout, 'voluntary'), /EXIT/, `${layout}: EXIT`);
    assert.match(story, /Help desk's over there/); assert.match(picture(lounge, layout, 'amenities'), /HELP DESK/, `${layout}: the help desk`);
    assert.match(story, /Ooh, the board changed\. \*\*Meridian Rift\*\*/); assert.match(picture(lounge, layout, 'meridian'), /MERIDIAN RIFT/, `${layout}: the board`);
    assert.match(story, /See the box by the door\?/); assert.match(picture(door, layout, 'feedback', ['watch-step', 'feedback']), /FEEDBACK/, `${layout}: the box`);
    assert.match(story, /Mind the wet floor/); assert.match(picture(door, layout, 'watch-step'), /WET {2}FLOOR/, `${layout}: the wet floor`);
    assert.match(story, /That locker has internals/); assert.match(picture(door, layout, 'be-safe', ['watch-step', 'feedback', 'be-safe']), /INTERNALS ON/, `${layout}: internals`);
    assert.match(story, /click the \*\*Get Whitelisted\*\* button/); assert.match(picture(door, layout, 'get-whitelisted'), /\[ Get Whitelisted \]/, `${layout}: the game`);
  }
});

test('T-STORY-SCENE-02 the cape is in locker 12, between lockers 11 and 13, from Leave the past in the past on', async () => {
  assert.match(story, /Someone left a cape in locker 12/);
  const hall = await shipped('baggage-hall');
  for (const layout of ['landscape', 'portrait']) {
    const rows = picture(hall, layout, 'past', ['migrating', 'past']).split('\n');
    const y = rows.findIndex(row => row.includes('UNCLAIM')), x = rows[y].indexOf('UNCLAIM');
    assert.ok(y > 0, layout);
    // The lockers either side carry their numbers on the same row.
    assert.equal(rows[y].slice(x - 6, x - 4), '11', `${layout} left`); assert.equal(rows[y].slice(x + 10, x + 12), '13', `${layout} right`);
    // Before that section the locker stands open and empty: no number 12, no cape.
    const before = picture(hall, layout, 'migrating', ['migrating']);
    assert.doesNotMatch(before, /UNCLAIM/); assert.doesNotMatch(before.split('\n').slice(0, 12).join('\n'), /\b12\b/, layout);
  }
});
