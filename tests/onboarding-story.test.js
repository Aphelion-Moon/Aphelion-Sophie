import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { paginateStaticText } from '../modules/onboarding/presentation.js';
import { validatePublication } from '../modules/onboarding/screens.js';
import { canonicalOnboardingDraft, reviewOnboardingDraft } from '../modules/onboarding/authoring.js';

const root = new URL('../', import.meta.url);
const story = JSON.parse(await readFile(new URL('content/onboarding/story-definition.json', root), 'utf8'));
const stage = id => story.stages.find(item => item.id === id).body;

test('T-STORY-01 the story draft is built from its source, five stages, Discord-sized and publishable', async () => {
  assert.equal(createHash('sha256').update(await readFile(new URL(story.source.path, root))).digest('hex'), story.source.sha256, 'rebuild after editing story.md');
  assert.equal(story.status, 'draft');
  assert.deepEqual(story.stages.map(item => item.id), ['the-brochure', 'pack-your-bags', 'board-the-shuttle', 'admire-the-lights', 'disembarking']);
  assert.equal('entry' in story, false, 'publications have no entry text; the launch post is the welcome');
  for (const page of story.stages) {
    assert.deepEqual(page.messages, paginateStaticText(page.body));
    assert.ok(page.messages.every(message => message.length > 0 && message.length <= 1_800));
  }
  validatePublication({ id: story.id, version: story.version, helpPauses: false, stages: story.stages.map(({ id, title, body }) => ({ id, title, body })) });
  // The editor document that gets published is exactly these stages, and the editor's own review accepts it.
  const draft = JSON.parse(await readFile(new URL('content/onboarding/story-draft.json', root), 'utf8'));
  assert.deepEqual(draft, { helpPauses: false, stages: story.stages.map(({ id, title, body }) => ({ id, title, body })) });
  assert.deepEqual(canonicalOnboardingDraft(draft), draft);
  const review = reviewOnboardingDraft('shuttle', 2, draft);
  assert.equal(review.valid, true); assert.deepEqual(review.pages.map(page => page.segments), story.stages.map(item => item.messages));
});

// The owner's guidance in the original copy, point by point (decision "The Shuttle as a story"): the wording is casual,
// the meaning is not optional. Revision 1 (owner, 24 October 2026) rewords several points and removes some on purpose:
// the refresher line, "not changing ourselves", the invite link and Wolfgate's early-development note.
const REQUIRED = [
  // The Brochure opens with the boarding call: five phases, finishing brings Whitelist, and where to get help.
  ['the-brochure', /^# Boarding call[\s\S]*five phases[\s\S]*you'll get your \*\*Whitelist\*\*[\s\S]*#crew-support/, 'boarding call'],
  ['the-brochure', /Whitelist[\s\S]*@matriarch in #crew-support/, 'help in #crew-support'],
  // Sixth pass: Beepsky stops the reader for the age check, and the sign explains what NSFW means for you on its own.
  ['the-brochure', /\*\*Beepsky:\*\* "HALT[^\n]*"\n\n> \*\*NOTICE · 18\+ ONLY/, "Beepsky's age check, then the sign"],
  ['the-brochure', /> That means you might \*see\* things\. It doesn't mean anybody here is up for anything with you/, 'seeing is not consent'],
  // The sea lion: lined up and named, then the boundaries line, the punchline and the THUMP, in that order.
  ['board-the-shuttle', /^# Real questions are welcome[\s\S]*sea lion on the rail[\s\S]*politely[\s\S]*Nobody owes you an endless defen[cs]e[\s\S]*\*\*We crush sea-lions with shuttles\.\*\*\n\n\*THUMP\.\*/m, 'sea lion, boundaries, punchline, THUMP'],
  ['the-brochure', /18 or older/, 'age 18+'],
  ['the-brochure', /play on our servers, hang out in our Discord, or have any account tied to Aphelion/, 'servers, Discord and any account'],
  ['the-brochure', /under 18 at any point/, 'ever underage'],
  ['the-brochure', /Permanently/, 'permanent removal'],
  ['the-brochure', /Doesn't matter how long you've been around or what you've made/, 'standing makes no exception'],
  ['the-brochure', /already did an age check\. This applies on top of it/, 'earlier age check does not replace it'],
  ['the-brochure', /European Union and runs under EU law/, 'EU base and law'],
  ['the-brochure', /allowed to be here where you live is on you/, 'own jurisdiction'],
  ['the-brochure', /sexual or NSFW stuff in passing/, 'incidental NSFW exposure'],
  ['the-brochure', /doesn't mean anybody here is up for anything with you/, 'not permission or availability'],
  ['the-brochure', /queers, furries, and freaks/, 'who runs Aphelion'],
  ['the-brochure', /decent to the people who are/, 'respect required'],
  ['the-brochure', /joining us voluntarily/, 'boarding is voluntary'],
  ['the-brochure', /make everybody else miserable until they leave/, 'not boarding to drive people out'],
  ['the-brochure', /#open-a-ticket/, 'tickets'],
  ['the-brochure', /Cry wolf/, 'cry wolf'],
  ['the-brochure', /don't need proof first/, 'no finished investigation needed'],
  ['the-brochure', /#ask-mewn[\s\S]*#ask-mal[\s\S]*#ask-cobalt/, 'leadership channels'],
  ['the-brochure', /rough idea of what's in there before you get Whitelisted/, 'passing understanding of the rules'],
  ['the-brochure', /told the same thing five times/, 'low tolerance for repeatedly ignoring guidance'],
  ['the-brochure', /Policies#RP-01/, 'recommended reading'],
  ['the-brochure', /doesn't replace the real rules/, 'the Shuttle does not replace the rules'],
  ['the-brochure', /Wiki and Rule References have the final word/, 'the Wiki is authoritative'],
  ['the-brochure', /meridian\.a13\.info\/about[\s\S]*Main_Page[\s\S]*wiki\/Policies[\s\S]*Meridian-Rift/, 'Meridian links'],
  ['pack-your-bags', /Bubber, Splurt, Nova Sector/, 'import origins'],
  ['pack-your-bags', /Export-Preferences[\s\S]*Import-Character-Preferences[\s\S]*Reconnect/, 'import steps'],
  ['pack-your-bags', /own lore/, 'own lore'],
  ['pack-your-bags', /rework their backstory/, 'backgrounds fit our lore'],
  ['pack-your-bags', /doesn't come with rank, authority, or a spotlight/, 'no status from familiar names'],
  ['pack-your-bags', /wipe most of your old character relationships/, 'relationship reset'],
  ['pack-your-bags', /LOOC/, 'LOOC check'],
  ['pack-your-bags', /both want to keep the history/, 'both players agree'],
  ['pack-your-bags', /Nobody owes you an old friendship, romance, rivalry, or grudge/, 'no owed relationships'],
  ['pack-your-bags', /safety thing[\s\S]*bring it to staff/i, 'safety concerns to staff'],
  ['pack-your-bags', /inheriting old problems/, 'feuds stay behind'],
  ['board-the-shuttle', /You are not the main character\. None of us are\./, 'not the main character'],
  ['board-the-shuttle', /owes you their time, attention, or a spot in their scene/, 'no entitlement'],
  ['board-the-shuttle', /Ask, don't assume/, 'ask rather than assume'],
  ['board-the-shuttle', /don't make them justify it/, 'respect a refusal'],
  ['board-the-shuttle', /A yes last week isn't a yes forever/, 'earlier yes is not permanent'],
  ['board-the-shuttle', /players' boundaries come first/, 'player boundaries'],
  ['board-the-shuttle', /without being cruel/, 'difficult stories without cruelty'],
  ['board-the-shuttle', /Sealioning/i, 'sealioning'],
  ['board-the-shuttle', /bad faith/, 'bad faith'],
  ['board-the-shuttle', /doesn't stop this being harassment/, 'polite harassment is harassment'],
  ['board-the-shuttle', /endless defen[cs]e of who they are/, 'no endless defence'],
  ['board-the-shuttle', /debate service/, 'staff are not a debate service'],
  ['board-the-shuttle', /tell us which bit/, 'sincere questions welcome'],
  ['admire-the-lights', /hobby/, 'it is a hobby'],
  ['admire-the-lights', /somebody else's bad night/, 'no trampling'],
  ['admire-the-lights', /Need a break\? Take one/, 'breaks'],
  ['admire-the-lights', /Nobody arrives knowing everything/, 'nobody arrives knowing everything'],
  ['admire-the-lights', /punchline/, 'new is not the joke'],
  ['admire-the-lights', /crossed a line, listen/, 'patience both ways'],
  ['admire-the-lights', /private conversation or a sexual scene\? Get the OK/, 'consent before sharing'],
  ['admire-the-lights', /Crop personal info/, 'personal info out'],
  ['admire-the-lights', /sending evidence to staff/, 'evidence to staff'],
  ['admire-the-lights', /xkcd\.com\/1053/, 'Ten Thousand'],
  ['disembarking', /Take two extra seconds/, 'take your time'],
  ['disembarking', /something we run, one of our services, [^,]*someone's behavio(?:u)?r, a call we made/i, 'what to give feedback on'],
  ['disembarking', /#open-a-ticket \*\*, the leadership question channels, or public discussion/, 'feedback routes'],
  ['disembarking', /don't need a finished fix/, 'no finished solution needed'],
  ['disembarking', /can't fix stuff nobody tells us about/, 'tell us'],
  ['disembarking', /If something's wrong, say so\. If you need help, ask/, 'be safe'],
  ['disembarking', /18 or older, and you've got the adult-content stuff/, 'confirm: age and notice'],
  ['disembarking', /published rules apply to you, and that keeping Whitelist means following them/, 'confirm: rules'],
  ['disembarking', /respect other players' boundaries and their place in the stories/, 'confirm: boundaries'],
  ['disembarking', /where to find the rules, where to ask questions, and where to raise concerns/, 'confirm: where to ask'],
  ['disembarking', /FINISHING THE SHUTTLE MEANS YOU'RE TELLING US/, 'what finishing confirms'],
  ['disembarking', /Get Whitelisted[\s\S]*Discord sign-in/, 'in-game step'],
];

test('T-STORY-02 every point of the original guidance is still in the story (meaning checklist)', () => {
  for (const [where, pattern, point] of REQUIRED) {
    assert.match(stage(where), pattern, `${where}: ${point}`);
  }
});

test('T-STORY-03 the story reads like people talking: no em dashes or stock AI phrasing', () => {
  const all = story.stages.map(item => item.body).join('\n');
  assert.doesNotMatch(all, /—/, 'no em dashes');
  // One text serves the Activity and the text version: it says what you do, not the name of a button only one has.
  assert.doesNotMatch(all, /Complete Shuttle|Start Shuttle/i, 'no button that only one surface has');
  for (const word of ['journey', 'ensure', 'foster', 'embrace', 'navigate', 'vibrant', 'tapestry', "that's all it takes", 'worth noting', 'delve']) {
    assert.doesNotMatch(all.toLowerCase(), new RegExp(`\\b${word}\\b`), word);
  }
  // Dialogue lines name their speaker; every sign is a quote block with a NOTICE label.
  for (const line of all.split('\n').filter(text => /^\*\*[A-Z][a-z]+:\*\*/.test(text))) assert.match(line, /^\*\*(Rook|Pip|Passenger|Beepsky):\*\* /);
  // The text flows forward: it never sends the reader back a page (owner review, sixth pass).
  assert.doesNotMatch(all, /read that (last )?bit again|go back a page|scroll (back )?up/i, 'no going back to re-read');
  for (const block of all.split('\n\n').filter(text => text.startsWith('> '))) assert.match(block, /^> \*\*NOTICE · /);
});
