import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseMessageCapture } from '../apps/core/discord/case-message-capture.js';
import { syntheticConversation } from './fixtures/case-conversations.js';
import { gatewayEvent } from './fixtures/gateway.js';
import { GUILD, NOW } from './fixtures/domain.js';

const capture = () => createCaseMessageCapture({ guildId: GUILD, clock: () => NOW });
test('case capture hands off opaque core proofs and does not read body fields during routing', () => {
  const c = capture(), data = syntheticConversation('710000000000000001');
  Object.defineProperty(data, 'content', { get() { throw new Error('BODY_READ'); } });
  const proof = c.prepare(gatewayEvent(3, 'MESSAGE_CREATE', data));
  assert.deepEqual(proof, {}); assert.equal(c.inspect(proof).channelId, data.channel_id);
  assert.throws(() => c.inspect({}), /UNTRUSTED_CASE_CAPTURE/); c.discard(proof); assert.throws(() => c.inspect(proof), /UNTRUSTED_CASE_CAPTURE/);
  assert.equal(c.prepare(gatewayEvent(4, 'MESSAGE_CREATE', { guild_id: '99' })), null);
  assert.equal(c.prepare(gatewayEvent(4, 'MESSAGE_CREATE', { channel_id: data.channel_id, flags: 64 })), null);
});
test('partial message updates distinguish omitted, empty and explicit null values without copying role or referenced-message content', () => {
  const c = capture(), data = { guild_id: GUILD, channel_id: '71', id: '72', content: '', edited_timestamp: null,
    member: { roles: ['99'] }, referenced_message: { content: 'Synthetic foreign message' }, token: 'synthetic-private-token' };
  const body = c.content(c.prepare(gatewayEvent(3, 'MESSAGE_UPDATE', data)));
  assert.deepEqual(body, { patch: { content: '', edited_timestamp: null }, issues: [] });
});
test('invalid or over-limit message fields leave explicit loss markers while retaining valid fields', () => {
  const c = capture(), data = syntheticConversation('71', { content: 'x'.repeat(16385), embeds: [{ description: '\0' }], attachments: [] });
  const body = c.content(c.prepare(gatewayEvent(3, 'MESSAGE_CREATE', data)));
  assert.equal(Object.hasOwn(body.patch, 'content'), false); assert.deepEqual(body.patch.attachments, []);
  assert.ok(body.issues.includes('unavailable:content')); assert.ok(body.issues.includes('unavailable:embeds')); assert.ok(body.issues.includes('incomplete-create'));
  const malformed = syntheticConversation('71', { content: '\uD800', message_snapshots: [{ message: { content: 'Synthetic forwarded text' } }] });
  assert.deepEqual(c.content(c.prepare(gatewayEvent(4, 'MESSAGE_CREATE', malformed))).issues, ['unavailable:content', 'incomplete-create', 'forwarded-snapshot-not-captured']);
});
test('case capture bounds bulk deletes and channel snapshots, and expired proofs cannot supply content', () => {
  let now = NOW; const c = createCaseMessageCapture({ guildId: GUILD, clock: () => now });
  const proof = c.prepare(gatewayEvent(3, 'MESSAGE_DELETE_BULK', { guild_id: GUILD, channel_id: '71', ids: Array.from({ length: 101 }, (_, i) => String(i + 1)) }));
  assert.equal(c.inspect(proof).kind, 'rejected');
  assert.throws(() => c.prepare(gatewayEvent(3, 'THREAD_LIST_SYNC', { guild_id: GUILD, threads: Array(1001).fill({ id: '71' }) })), /CASE_CAPTURE_CHANNEL_LIMIT/);
  now += 60001; assert.throws(() => c.inspect(proof), /CASE_CAPTURE_EXPIRED/);
});
