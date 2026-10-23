import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectAutomationChannel } from '../apps/core/storage/automation-channel-policy.js';
import { productionConfiguration } from '../apps/core/runtime/production-configuration.js';

const ids = n => `1${String(n).padStart(17, '0')}`;
const CATEGORY = ids(9), ASK = ids(30), TICKET = ids(31);
const client = (excluded = []) => ({ query: async (_sql, [, list]) => ({ rowCount: list.some(id => excluded.includes(id)) ? 1 : 0 }) });
const channels = { inspect: async id => ({ id, guildId: ids(1), type: 0, parentId: CATEGORY }) };
const inspect = (channelId, exceptions, excluded = []) => inspectAutomationChannel(client(excluded), { guildId: ids(1), protectedCategoryId: CATEGORY, channels, channelId, exceptions });

test('only the named channel inside the ticket category is usable by the AI', async () => {
  assert.equal((await inspect(ASK, [ASK]))?.id, ASK);
  assert.equal(await inspect(TICKET, [ASK]), null, 'a ticket channel beside it stays excluded');
  assert.equal(await inspect(ASK, []), null, 'without the exception the category excludes it');
  assert.equal(await inspect(CATEGORY, [ASK]), null);
  assert.equal(await inspect(ASK, [ASK], [ASK]), null, 'a recorded case exclusion of the channel still wins');
});

test('the exception is bounded configuration and can never name the category itself', () => {
  const input = { guildId: ids(1), applicationId: ids(2), publicKeyHex: 'a'.repeat(64), botUserId: ids(3),
    roles: { crew: ids(4), muzzled: ids(5), whitelist: ids(6), staff: ids(7), leadOps: ids(8) }, protectedCategoryId: CATEGORY,
    dashboardOrigin: 'https://sophie.example.test', activityOrigin: 'https://onboarding.example.test', interactionPort: 38121, dashboardPort: 38122, activityPort: 38125 };
  assert.deepEqual(productionConfiguration({ ...input, aiChannelExceptions: [ASK] }).aiChannelExceptions, [ASK]);
  for (const aiChannelExceptions of [[CATEGORY], [ASK, ASK], [ids(1)], ['ask-sophie'], Array.from({ length: 6 }, (_, i) => ids(40 + i))])
    assert.throws(() => productionConfiguration({ ...input, aiChannelExceptions }), JSON.stringify(aiChannelExceptions));
});
