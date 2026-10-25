import test from 'node:test';
import assert from 'node:assert/strict';
import { ContractError } from '../contracts/validation.js';
import { shuttleProgressReply } from '../modules/onboarding/progress.js';
import { createShuttleProgress } from '../apps/core/discord/shuttle-progress.js';
import { createAdministrationCommands } from '../apps/core/discord/onboarding-commands.js';
import { syntheticInteractions } from './fixtures/interactions.js';
import { GUILD, USER, OTHER } from './fixtures/domain.js';

const NOW = 1_800_000_000_000;
const member = { present: true, crew: true, muzzled: false, whitelist: false };
const timing = { startedAtMs: NOW - 600_000, lastActiveAtMs: NOW - 60_000, completedAtMs: null, focusedMs: 300_000, pages: 10,
  stops: [{ stop: 0, focusedMs: 120_000, pages: 4 }, { stop: 1, focusedMs: 180_000, pages: 6 }], timed: true, fromStop: 0 };
const run = { current: true, activity: true, status: 'active', helpPaused: false, stop: 2, stops: 5, title: 'Board the shuttle', definitionVersion: 6, timing };
const view = (changes = {}) => ({ state: 'ready', userId: OTHER, member, run, grant: null, now: NOW, ...changes });
const progressCommand = options => ({ data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'progress', options }] } });

test('T-PROGRESS-01 /whitelist progress carries only the member ID; anything else is refused', () => {
  // Owner request, 25 October 2026: a command Staff can run to check a member's current Shuttle progress.
  const identities = syntheticInteractions();
  const envelope = identities.mint({ ...progressCommand([{ type: 6, name: 'member', value: OTHER }]), resolved: { members: { [OTHER]: { roles: ['1'] } } } });
  assert.equal(envelope.command, 'shuttle.progress'); assert.equal(envelope.subjectId, OTHER); assert.equal(envelope.targetId, envelope.userId);
  assert.equal(Object.hasOwn(envelope, 'resolved'), false);
  for (const options of [[], [{ type: 3, name: 'member', value: OTHER }], [{ type: 6, name: 'member', value: '@everyone' }],
    [{ type: 6, name: 'member', value: OTHER }, { type: 6, name: 'member', value: USER }]])
    assert.throws(() => identities.mint(progressCommand(options)));
});

test('T-PROGRESS-02 only Staff or Lead Ops (case.manage for the Shuttle) get a member progress; one read of the member', async () => {
  const identities = syntheticInteractions(), envelope = identities.mint(progressCommand([{ type: 6, name: 'member', value: OTHER }]));
  let allowed = false, observed = 0, reads = 0, overtaken = 0;
  const progress = createShuttleProgress({ enabled: async () => true, clock: () => NOW,
    authorization: { resolveActor: async () => ({ userId: envelope.userId }), authorize: async (capability, actor, scope) => {
      assert.equal(capability, 'case.manage'); assert.deepEqual(scope, { guildId: GUILD, type: 'shuttle', openerId: envelope.userId }); return allowed; } },
    discord: { guildId: GUILD, observe: async userId => {
      observed++; if (overtaken-- > 0) throw new ContractError('OBSERVATION_INVALIDATED');
      assert.equal(userId, OTHER); return { ...member, known: true }; } },
    read: async (guildId, userId) => { reads++; assert.deepEqual([guildId, userId], [GUILD, OTHER]); return { run, grant: null }; } });
  assert.equal(await progress.execute(envelope), 'shuttle_progress');
  assert.deepEqual(await progress.view(envelope), { state: 'denied' }); assert.equal(observed + reads, 0, 'nothing read for a refused actor');
  allowed = true; overtaken = 1;
  assert.equal(await progress.execute(envelope), 'shuttle_progress');
  assert.deepEqual(await progress.view(envelope), view()); assert.equal(observed, 2); assert.equal(reads, 1);
  assert.equal(await createAdministrationCommands({ moderation: null, onboarding: null, shuttleProgress: progress }).execute(envelope), 'shuttle_progress');
  assert.equal(await createAdministrationCommands({ moderation: null, onboarding: null }).execute(envelope), 'denied');
});

test('T-PROGRESS-03 the reply says where the member is and their focused time; metadata only and bounded', () => {
  const reading = shuttleProgressReply(view()).embeds[0];
  assert.equal(reading.title, 'Shuttle progress');
  assert.equal(reading.description, [`<@${OTHER}> · in the server: yes · Crew: yes · Muzzled: no · Whitelist: no`,
    'Reading stop 3 of 5: Board the shuttle', `Boarded <t:${(NOW - 600_000) / 1000}:R> · last moved <t:${(NOW - 60_000) / 1000}:R>`,
    'So far: 5m 00s focused (10m 00s from boarding) · 10 pages, average 30s a page', 'Focused time by stop: 1: 2m 00s · 2: 3m 00s'].join('\n'));
  const pending = shuttleProgressReply(view({ run: { ...run, status: 'role_pending', stop: 4, timing: { ...timing, completedAtMs: NOW - 30_000 } },
    grant: { status: 'parked', code: 'ROLE_HIERARCHY' } })).embeds[0].description;
  assert.match(pending, /waiting for Whitelist\. Grant: stopped \(ROLE_HIERARCHY\)/);
  assert.match(pending, /Time to completion: 5m 00s focused \(9m 30s from boarding\)/);
  assert.match(shuttleProgressReply(view({ run: null })).embeds[0].description, /No Shuttle run is recorded/);
  assert.match(shuttleProgressReply(view({ run: { ...run, helpPaused: true } })).embeds[0].description, /Paused for assistance at stop 3 of 5/);
  const channel = shuttleProgressReply(view({ run: { ...run, activity: false, timing: null } })).embeds[0].description;
  assert.match(channel, /Onboarding channel/); assert.doesNotMatch(channel, /focused/);
  const untimed = { ...timing, stops: [], timed: false, fromStop: null, focusedMs: 0, pages: 0 };
  assert.match(shuttleProgressReply(view({ run: { ...run, timing: untimed } })).embeds[0].description, /Reading time not recorded/);
  assert.match(shuttleProgressReply(view({ run: { ...run, current: false, status: 'complete', stop: 4 } })).embeds[0].description, /No current run[\s\S]*received Whitelist/);
  for (const state of ['denied', 'disabled', 'unavailable']) assert.deepEqual(shuttleProgressReply({ state }).embeds, []);
  for (const invalid of [view({ userId: '@everyone' }), view({ extra: 1 }), view({ grant: { status: 'deleted', code: null }, run: { ...run, status: 'role_pending' } }),
    view({ run: { ...run, status: 'gone' } }), view({ member: { ...member, crew: 'maybe' } }), { state: 'other' }])
    assert.throws(() => shuttleProgressReply(invalid));
});
