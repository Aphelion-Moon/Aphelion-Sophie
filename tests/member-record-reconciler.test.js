import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemberRecordReconciler } from '../apps/core/discord/member-record-reconciler.js';
import { DiscordError } from '../apps/core/discord/transport.js';

// Synthetic data only; every ID is made up.
const ids = n => `1${String(n).padStart(17, '0')}`;
const mapping = { botUserId: ids(2), guildId: ids(1) };

function harness({ failures = {} } = {}) {
  let now = Date.UTC(2026, 10, 18, 0, 0);
  const waits = [], calls = [];
  const remaining = Object.fromEntries(Object.entries(failures).map(([name, list]) => [name, [...list]]));
  const read = (name, value) => async () => {
    calls.push(name);
    const next = remaining[name]?.shift();
    if (next) throw new DiscordError(next.code, next.retryAfterMs ?? 0);
    return value;
  };
  const transport = {
    getRecordChannelMap: read('getRecordChannelMap', []),
    getMemberRecordMembers: read('getMemberRecordMembers', [{ userId: ids(12) }]),
    getApprovedJoinRequests: read('getApprovedJoinRequests', []),
    getRecordUser: read('getRecordUser', null),
  };
  const store = {
    recordChannels: async () => {}, expireMessages: async () => ({ textCleared: 0 }),
    reconcile: async () => ({ opened: 0, changed: 0, left: 0 }), recordedMembers: async () => [ids(12)],
    seenUserIds: async () => [], open: async () => ({ opened: false }),
  };
  const reconciler = createMemberRecordReconciler({ store, transport, mapping, enabled: async () => true, clock: () => now,
    wait: async ms => { waits.push(ms); now += ms; } });
  return { reconciler, waits, calls, advance: ms => { now += ms; } };
}

test('MR-RC1 a check whose reads pass first time is reconciled and waits for nothing', async () => {
  const { reconciler, waits } = harness();
  assert.deepEqual(await reconciler.runDue('staging.test'), { status: 'reconciled', opened: 0, changed: 0, left: 0, departed: 0, textCleared: 0 });
  assert.deepEqual(waits, []);
});

test('MR-RC2 a moment of shut gate (DISCORD_TRANSPORT_DISABLED, DISCORD_BUSY) is waited out, not a failed check', async () => {
  const { reconciler, waits, calls } = harness({ failures: {
    getMemberRecordMembers: [{ code: 'DISCORD_TRANSPORT_DISABLED' }, { code: 'DISCORD_TRANSPORT_DISABLED' }, { code: 'DISCORD_BUSY' }] } });
  assert.equal((await reconciler.runDue('staging.test')).status, 'reconciled');
  assert.deepEqual(waits, [250, 500, 750]);
  assert.equal(calls.filter(name => name === 'getMemberRecordMembers').length, 4);
});

test('MR-RC3 a Discord read timeout or 5xx (DISCORD_UNAVAILABLE) is asked again with backoff, at most four tries', async () => {
  const passes = harness({ failures: { getRecordChannelMap: [{ code: 'DISCORD_UNAVAILABLE' }, { code: 'DISCORD_UNAVAILABLE' }] } });
  assert.equal((await passes.reconciler.runDue('staging.test')).status, 'reconciled');
  assert.deepEqual(passes.waits, [1_000, 2_000]);
  const fails = harness({ failures: { getRecordChannelMap: Array.from({ length: 4 }, () => ({ code: 'DISCORD_UNAVAILABLE' })) } });
  assert.deepEqual(await fails.reconciler.runDue('staging.test'), { status: 'failed', code: 'DISCORD_UNAVAILABLE' });
  assert.deepEqual(fails.waits, [1_000, 2_000, 4_000]);
});

test('MR-RC4 a short rate limit is waited out once; a long one, a second one, or another error fails the check as before', async () => {
  const short = harness({ failures: { getApprovedJoinRequests: [{ code: 'RATE_LIMITED', retryAfterMs: 1_200 }] } });
  assert.equal((await short.reconciler.runDue('staging.test')).status, 'reconciled');
  assert.deepEqual(short.waits, [1_200]);
  const long = harness({ failures: { getApprovedJoinRequests: [{ code: 'RATE_LIMITED', retryAfterMs: 60_000 }] } });
  assert.deepEqual(await long.reconciler.runDue('staging.test'), { status: 'failed', code: 'RATE_LIMITED' });
  const twice = harness({ failures: { getApprovedJoinRequests: [{ code: 'RATE_LIMITED', retryAfterMs: 500 }, { code: 'RATE_LIMITED', retryAfterMs: 500 }] } });
  assert.deepEqual(await twice.reconciler.runDue('staging.test'), { status: 'failed', code: 'RATE_LIMITED' });
  const other = harness({ failures: { getMemberRecordMembers: [{ code: 'DISCORD_AUTHORIZATION_FAILED' }] } });
  assert.deepEqual(await other.reconciler.runDue('staging.test'), { status: 'failed', code: 'DISCORD_AUTHORIZATION_FAILED' });
  assert.deepEqual(other.waits, []);
});

test('MR-RC5 a gate that stays shut still fails the check, which is tried again in ten minutes', async () => {
  const { reconciler, waits, advance } = harness({ failures: { getRecordChannelMap: Array.from({ length: 41 }, () => ({ code: 'DISCORD_TRANSPORT_DISABLED' })) } });
  assert.deepEqual(await reconciler.runDue('staging.test'), { status: 'failed', code: 'DISCORD_TRANSPORT_DISABLED' });
  assert.ok(waits.reduce((sum, ms) => sum + ms, 0) <= 30_000);
  assert.deepEqual(await reconciler.runDue('staging.test'), { status: 'idle' });
  advance(600_000);
  assert.equal((await reconciler.runDue('staging.test')).status, 'reconciled');
});
