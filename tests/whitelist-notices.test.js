import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { whitelistNotice } from '../apps/core/discord/whitelist-notices.js';
import { formatDuration, runTimingSummary, timingLine } from '../modules/onboarding/timing.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { productionConfiguration } from '../apps/core/runtime/production-configuration.js';

const ids = n => `1${String(n).padStart(17, '0')}`;
const CHANNEL = ids(70), MEMBER = ids(12);

test('T-NOTICE-01 a Whitelist notice names the member without notifying anyone, and the transport refuses anything louder', async () => {
  // Owner request, 24 October 2026: a line in the staff bot channel when the Onboarding Activity gives Whitelist.
  const calls = [];
  const transport = createDiscordTransport({ guildId: ids(1), token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    fetch: async (url, init) => { calls.push([init.method, new URL(url).pathname, JSON.parse(init.body)]); return Response.json({ id: ids(30), channel_id: CHANNEL }); } });
  const ok = whitelistNotice(MEMBER);
  assert.equal(ok.content, `**Whitelist granted** · <@${MEMBER}> finished the Arrivals Shuttle and Sophie gave them Whitelist.
Reading time not recorded for this run.`);
  await transport.createWhitelistNotice(CHANNEL, 'c'.repeat(24), ok);
  assert.deepEqual(calls[0], ['POST', `/api/v10/channels/${CHANNEL}/messages`, { ...ok, nonce: 'c'.repeat(24), enforce_nonce: true }]);
  for (const body of [{ ...ok, content: 'ping @here' }, { ...ok, content: `<@&${ids(71)}>` }, { ...ok, content: `<@!${MEMBER}>` },
    { ...ok, allowed_mentions: { ...ok.allowed_mentions, users: [MEMBER] } }, { ...ok, allowed_mentions: { ...ok.allowed_mentions, parse: ['users'] } },
    { ...ok, embeds: [] }, { ...ok, content: '' }, { ...ok, content: 'x'.repeat(2_001) }, { content: ok.content }])
    await assert.rejects(transport.createWhitelistNotice(CHANNEL, 'c'.repeat(24), body), /INVALID_DISCORD_PAYLOAD/, JSON.stringify(body).slice(0, 80));
  await assert.rejects(transport.createWhitelistNotice(CHANNEL, 'not-a-nonce', ok), /INVALID_DISCORD_PAYLOAD/);
  assert.equal(calls.length, 1);
  assert.throws(() => whitelistNotice('everyone'));
});

test('T-NOTICE-02 the production configuration carries the notice channel, validated', () => {
  const input = { guildId: ids(1), applicationId: ids(2), publicKeyHex: 'a'.repeat(64), botUserId: ids(3),
    roles: { crew: ids(4), muzzled: ids(5), whitelist: ids(6), staff: ids(7), leadOps: ids(8) }, protectedCategoryId: ids(9),
    dashboardOrigin: 'https://sophie.example.test', activityOrigin: 'https://onboarding.example.test', interactionPort: 38121, dashboardPort: 38122, activityPort: 38125 };
  assert.equal(Object.hasOwn(productionConfiguration(input), 'whitelistNotices'), false, 'off unless configured');
  const configured = productionConfiguration({ ...input, whitelistNotices: { channelId: CHANNEL } });
  assert.deepEqual(configured.whitelistNotices, { channelId: CHANNEL }); validateStagingRuntime(configured);
  for (const whitelistNotices of [{ channelId: 'x' }, {}, { channelId: CHANNEL, roleName: 'matriarch' }, { channelId: ids(9) }, { channelId: ids(1) }])
    assert.throws(() => validateStagingRuntime({ ...configured, whitelistNotices }), JSON.stringify(whitelistNotices));
});

test('T-NOTICE-03 the notice gives the run focused time, time from boarding, pages and the average a page; numbers only', () => {
  // Owner request, 25 October 2026: time to completion and average time per page, counting only focused time.
  const timing = { focusedMs: 845_000, pages: 23, wallMs: 3_130_000, fromStop: 0 };
  assert.equal(whitelistNotice(MEMBER, timing).content, `**Whitelist granted** · <@${MEMBER}> finished the Arrivals Shuttle and Sophie gave them Whitelist.
` +
    'Time to completion: 14m 05s focused (52m 10s from boarding) · 23 pages, average 37s a page');
  assert.match(whitelistNotice(MEMBER, { ...timing, fromStop: 2 }).content, / · timed from stop 3$/);
  assert.match(whitelistNotice(MEMBER, { ...timing, pages: 0 }).content, /· no pages reported$/);
  assert.doesNotMatch(whitelistNotice(MEMBER, { ...timing, focusedMs: 23_000 }).content, /⚠|skip|fast/iu, 'no flag');
  for (const bad of [{ ...timing, pages: -1 }, { ...timing, extra: 1 }, { focusedMs: 1, pages: 1, wallMs: 1 }, { ...timing, wallMs: 1.5 }])
    assert.throws(() => whitelistNotice(MEMBER, bad), /INVALID_RUN_TIMING/);
  assert.deepEqual([0, 999, 42_000, 60_000, 845_000, 3_599_000, 7_380_000, 90_000_000 + 3_600_000 * 3].map(formatDuration),
    ['0s', '1s', '42s', '1m 00s', '14m 05s', '59m 59s', '2h 03m', '1d 04h']);
  assert.equal(runTimingSummary({ timed: false }, 1), null); assert.equal(runTimingSummary(null, 1), null);
  assert.deepEqual(runTimingSummary({ timed: true, focusedMs: 5, pages: 2, startedAtMs: 100, completedAtMs: null, fromStop: 0 }, 400),
    { focusedMs: 5, pages: 2, wallMs: 300, fromStop: 0 });
  assert.equal(timingLine('So far', { focusedMs: 1_000, pages: 1, wallMs: 2_000, fromStop: 0 }), 'So far: 1s focused (2s from boarding) · 1 page, average 1s a page');
});
