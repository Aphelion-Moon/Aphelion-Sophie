import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCaseReply, validateCaseReplyPayload } from '../modules/tickets/replies.js';
import { createCaseReplyMessages } from '../apps/core/discord/case-reply-messages.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { simulatedCases, casePlan, casePolicy } from './fixtures/cases.js';
import { mapping, BOT } from './fixtures/discord.js';
import { NOW, STAFF, OTHER } from './fixtures/domain.js';

const recordId = 'a'.repeat(32), channelId = '100000000000000055';
const payload = () => renderCaseReply({ id: recordId, authorId: STAFF, text: 'Synthetic human reply. @everyone <@123> <@&456> **authored Markdown** 🛰️' });
function fixture() {
  let now = NOW, continuity = 'reply-1', enabled = true;
  const clock = () => now, discord = simulatedCases({ clock, readContinuity: () => continuity, enabled: () => enabled });
  const plan = structuredClone(casePlan);
  discord.state.channels.set(channelId, { ...caseChannelPayload(plan, casePolicy, false), id: channelId, guild_id: plan.guildId });
  const messages = createCaseReplyMessages({ ...discord, mapping, policy: casePolicy, clock });
  const expected = { plan, channelId, recordId, payload: payload() };
  return { ...discord, messages, expected, plan, advance: () => { now += 6000; }, invalidate: () => { continuity = 'reply-2'; },
    disable: () => { enabled = false; }, create: async () => messages.create(await messages.prepare(plan, channelId), expected) };
}
const deletes = f => f.state.calls.filter(call => call.method === 'DELETE');

test('human reply text retains exact Unicode/whitespace and an immutable format with a visible human ID and no mentions', () => {
  const text = ' \n' + '🛰️'.repeat(799) + '\tend\n ';
  const body = renderCaseReply({ id: recordId, authorId: STAFF, text });
  validateCaseReplyPayload(body, recordId);
  assert.equal(body.embeds[0].description, text); assert.equal(body.embeds[0].title, `Staff reply · user ${STAFF}`);
  assert.deepEqual(body.allowed_mentions, { parse: [], roles: [], users: [], replied_user: false });
  validateCaseReplyPayload(renderCaseReply({ id: recordId, authorId: STAFF, text: 'x'.repeat(4000) }), recordId);
  for (const invalid of ['', ' \n\t', '\ud800', 'x\0y', 'x'.repeat(4001)]) assert.throws(() => renderCaseReply({ id: recordId, authorId: STAFF, text: invalid }), /INVALID_CASE_REPLY/);
});

test('reply payloads reject extra content, attachments, forged attribution format, controls and every mention allowance', () => {
  const body = payload(), embed = body.embeds[0];
  const changed = [{ ...body, files: [] }, { ...body, content: 'unreviewed extra text' }, { ...body, components: [{}] },
    { ...body, embeds: [embed, embed] }, { ...body, embeds: [{ ...embed, image: { url: 'https://example.invalid/a.png' } }] },
    { ...body, embeds: [{ ...embed, title: 'Reply from Sophie' }] },
    { ...body, embeds: [{ ...embed, footer: { text: 'sophie:ticket-intake:v1:' + recordId } }] },
    ...[{ parse: ['everyone'] }, { roles: [STAFF] }, { users: [OTHER] }, { replied_user: true }].map(value => ({ ...body, allowed_mentions: { ...body.allowed_mentions, ...value } }))];
  for (const value of changed) assert.throws(() => validateCaseReplyPayload(value, recordId));
});

test('reply send requires an exact private channel and a fresh one-use preparation; withdrawal preparation cannot send', async () => {
  const f = fixture(), prepared = await f.messages.prepare(f.plan, channelId);
  const receipt = await f.messages.create(prepared, f.expected);
  assert.equal(await f.messages.verification.matches(receipt, f.expected), true);
  await assert.rejects(f.messages.create(prepared, f.expected), /SHUTTLE_MESSAGE_UNTRUSTED/);
  const withdrawing = await f.messages.prepare(f.plan, channelId, true);
  await assert.rejects(f.messages.create(withdrawing, f.expected), /SHUTTLE_MESSAGE_UNTRUSTED/);
  f.state.channels.get(channelId).permission_overwrites = [];
  await assert.rejects(f.messages.prepare(f.plan, channelId), /CASE_CHANNEL_ACL_MISMATCH/);
  assert.equal(f.state.calls.filter(call => call.method === 'POST').length, 1);
});

test('actual reply verification detects unexpected mentions, changed text and changed human attribution', async () => {
  const f = fixture(), receipt = await f.create(), stored = f.state.messages.get(receipt.messageId), original = structuredClone(stored);
  for (const change of [{ mentions: [{ id: OTHER }] }, { mention_roles: [STAFF] }, { mention_everyone: true },
    { embeds: [{ ...stored.embeds[0], description: 'Changed synthetic reply' }] },
    { embeds: [{ ...stored.embeds[0], title: `Staff reply · user ${OTHER}` }] }]) {
    Object.assign(stored, structuredClone(original), change);
    const proof = await f.messages.inspect({ ...f.expected, messageId: receipt.messageId });
    assert.equal(await f.messages.verification.matches(proof, f.expected), false);
  }
  Object.assign(stored, original); stored.embeds[0].content_scan_version = 3;
  assert.equal(await f.messages.verification.matches(await f.messages.inspect({ ...f.expected, messageId: receipt.messageId }), f.expected), true);
});

test('withdrawal rejects fabricated/cross-message proofs and observed human/webhook/unmarked messages before DELETE', async () => {
  const f = fixture(), receipt = await f.create(), stored = f.state.messages.get(receipt.messageId), original = structuredClone(stored);
  const prepared = await f.messages.prepare(f.plan, channelId, true), expected = { ...f.expected, messageId: receipt.messageId };
  await assert.rejects(f.messages.withdraw(prepared, { ...expected, message: { ...receipt } }), /SHUTTLE_MESSAGE_UNTRUSTED/);
  await assert.rejects(f.messages.withdraw(prepared, { ...expected, messageId: OTHER, message: receipt }), /SHUTTLE_MESSAGE_UNTRUSTED/);
  for (const change of [{ author: { id: OTHER, bot: false } }, { webhook_id: BOT }, { embeds: [{ ...original.embeds[0], footer: { text: 'synthetic-unmarked' } }] }]) {
    Object.assign(stored, structuredClone(original), change);
    await assert.rejects(f.messages.inspect(expected), /SHUTTLE_MESSAGE_OWNERSHIP/);
  }
  assert.deepEqual(deletes(f), []);
});

test('a late authentic reply can retain its ID but cannot send or withdraw across stale observations or a continuity loss', async () => {
  for (const reason of ['advance', 'invalidate']) {
    const f = fixture(), receipt = await f.create(), prepared = await f.messages.prepare(f.plan, channelId, true);
    f[reason]();
    assert.equal(f.messages.verification.receipt(receipt, f.expected).messageId, receipt.messageId);
    await assert.rejects(f.messages.withdraw(prepared, { ...f.expected, messageId: receipt.messageId, message: receipt }), /MEMBERSHIP_STALE|OBSERVATION_INVALIDATED/);
    assert.deepEqual(deletes(f), []);
  }
});

test('known own reply withdrawal works after ACL drift, then observes absence without issuing another DELETE', async () => {
  const f = fixture(), receipt = await f.create(), expected = { ...f.expected, messageId: receipt.messageId };
  f.state.channels.get(channelId).permission_overwrites = [];
  const prepared = await f.messages.prepare(f.plan, channelId, true), message = await f.messages.inspect(expected);
  await f.messages.withdraw(prepared, { ...expected, message });
  assert.equal(f.state.messages.has(receipt.messageId), false);
  await assert.rejects(f.messages.withdraw(prepared, { ...expected, message }), /SHUTTLE_MESSAGE_UNTRUSTED/);
  const absent = await f.messages.inspect(expected); assert.equal(absent.missing, true);
  await f.messages.withdraw(await f.messages.prepare(f.plan, channelId, true), { ...expected, message: absent });
  assert.equal(deletes(f).length, 1);
});

test('withdrawal remains fail-closed on a foreign channel, changed case marker or disabled delivery', async () => {
  for (const reason of ['guild', 'marker', 'disabled']) {
    const f = fixture(), receipt = await f.create(), expected = { ...f.expected, messageId: receipt.messageId, message: receipt };
    if (reason === 'disabled') {
      const prepared = await f.messages.prepare(f.plan, channelId, true); f.disable();
      await assert.rejects(f.messages.withdraw(prepared, expected), /DISCORD_TRANSPORT_DISABLED/);
    } else {
      f.state.channels.get(channelId)[reason === 'guild' ? 'guild_id' : 'topic'] = reason === 'guild' ? OTHER : 'synthetic-unbound-channel';
      await assert.rejects(f.messages.prepare(f.plan, channelId, true), /FOREIGN_GUILD|CASE_CHANNEL_MISMATCH/);
    }
    assert.deepEqual(deletes(f), []);
  }
});

test('lost DELETE response is uncertain; a fresh absence check recovers without a second write', async () => {
  const f = fixture(), receipt = await f.create(), expected = { ...f.expected, messageId: receipt.messageId };
  f.state.afterWrite = async call => { if (call.method === 'DELETE') throw new Error('synthetic lost response'); };
  await assert.rejects(f.messages.withdraw(await f.messages.prepare(f.plan, channelId, true), { ...expected, message: receipt }), /DELIVERY_UNCERTAIN/);
  f.state.afterWrite = null;
  const absent = await f.messages.inspect(expected);
  await f.messages.withdraw(await f.messages.prepare(f.plan, channelId, true), { ...expected, message: absent });
  assert.equal(deletes(f).length, 1); assert.equal(absent.missing, true);
});

test('only an explicit unknown-message GET proves absence; missing channels and DELETE errors do not', async () => {
  const f = fixture(), receipt = await f.create(), expected = { ...f.expected, messageId: receipt.messageId };
  for (const code of [10003, 10007]) {
    f.state.before = async call => call.path.endsWith('/messages/' + receipt.messageId) ? new Response(JSON.stringify({ code }), { status: 404 }) : null;
    await assert.rejects(f.messages.inspect(expected), /DISCORD_RESOURCE_MISSING/);
  }
  f.state.before = null;
  const prepared = await f.messages.prepare(f.plan, channelId, true);
  f.state.before = async call => call.method === 'DELETE' ? new Response(JSON.stringify({ code: 10008 }), { status: 404 }) : null;
  await assert.rejects(f.messages.withdraw(prepared, { ...expected, message: receipt }), /DISCORD_RESOURCE_MISSING/);
});
