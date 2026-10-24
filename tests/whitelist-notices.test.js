import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { whitelistNotice } from '../apps/core/discord/whitelist-notices.js';
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
  assert.equal(ok.content, `**Whitelist granted** · <@${MEMBER}> finished the Arrivals Shuttle and Sophie gave them Whitelist.`);
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
