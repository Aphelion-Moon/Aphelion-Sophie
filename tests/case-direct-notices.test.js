import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseDirectNotices } from '../apps/core/discord/case-direct-notices.js';
import { ticketDirectNotice } from '../modules/tickets/direct-notice.js';
import { simulatedCases, casePlan, casePolicy } from './fixtures/cases.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { BOT } from './fixtures/discord.js';
import { NOW, GUILD, OTHER } from './fixtures/domain.js';

const channelId = '123', nonce = 'a'.repeat(24);
function fixture() {
  let now = NOW;
  const discord = simulatedCases({ clock: () => now });
  discord.state.channels.set(channelId, { ...caseChannelPayload(casePlan, casePolicy, false), id: channelId, guild_id: GUILD });
  const messages = createCaseDirectNotices({ ...discord, botUserId: BOT, clock: () => now });
  return { discord, messages, expire: () => { now += 6000; } };
}
test('ticket DMs are static unmentioned links, not copies of ticket content or interactive authority', () => {
  const body = ticketDirectNotice(GUILD, channelId);
  assert.equal(body.content.includes(`https://discord.com/channels/${GUILD}/${channelId}`), true);
  assert.deepEqual(body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.deepEqual(body.embeds, []); assert.deepEqual(body.components, []); assert.equal(body.flags, 4);
  assert.throws(() => ticketDirectNotice(GUILD, 'https://example.invalid'));
});
test('a DM receipt is bound to the exact recipient, case, destination and durable nonce', async () => {
  const { discord, messages } = fixture();
  const dm = await messages.prepare(casePlan), channel = await discord.channels.inspect(casePlan, channelId);
  const dmChannelId = await messages.verification.destination(dm, casePlan);
  const proof = await messages.send({ plan: casePlan, channelId, nonce, dm, channel });
  const expected = { caseId: casePlan.id, userId: casePlan.openerId, guildId: GUILD, dmChannelId, channelId, nonce };
  assert.match(messages.verification.receipt(proof, expected), /^\d+$/);
  assert.throws(() => messages.verification.receipt({ ...proof }, expected), /CASE_DM_UNTRUSTED/);
  assert.throws(() => messages.verification.receipt(proof, { ...expected, userId: OTHER }), /CASE_DM_UNTRUSTED/);
});
test('group DMs and foreign recipients are rejected before sending any link', async () => {
  for (const changed of [{ type: 3, recipients: [{ id: casePlan.openerId }] }, { type: 1, recipients: [{ id: OTHER }] },
    { type: 1, recipients: [{ id: casePlan.openerId }, { id: OTHER }] }]) {
    const { discord, messages } = fixture();
    discord.state.before = call => call.path.endsWith('/users/@me/channels') ? Response.json({ id: '456', ...changed }) : null;
    await assert.rejects(messages.prepare(casePlan), /CASE_DM_UNTRUSTED/);
    assert.equal(discord.state.messages.size, 0);
  }
});
test('stale and fabricated DM preparations cannot authorize delivery', async () => {
  const { discord, messages, expire } = fixture(), dm = await messages.prepare(casePlan);
  const channel = await discord.channels.inspect(casePlan, channelId);
  await assert.rejects(messages.send({ plan: casePlan, channelId, nonce, dm: {}, channel }), /CASE_DM_UNTRUSTED/);
  expire(); await assert.rejects(messages.send({ plan: casePlan, channelId, nonce, dm, channel }), /MEMBERSHIP_STALE/);
  assert.equal(discord.state.messages.size, 0);
});
test('changed DM response content or author cannot produce a trusted delivery receipt', async () => {
  for (const changed of [{ content: 'Unexpected synthetic text' }, { author: { id: OTHER, bot: false } }]) {
    const { discord, messages } = fixture(), dm = await messages.prepare(casePlan);
    const channel = await discord.channels.inspect(casePlan, channelId);
    discord.state.afterWrite = call => { if (/\/messages$/.test(call.path)) Object.assign([...discord.state.messages.values()].at(-1), changed); };
    await assert.rejects(messages.send({ plan: casePlan, channelId, nonce, dm, channel }), /CASE_DM_UNTRUSTED/);
  }
});
