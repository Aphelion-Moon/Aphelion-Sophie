import test from 'node:test';
import assert from 'node:assert/strict';
import { alertable, createErrorAlerts } from '../apps/core/runtime/error-alerts.js';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { productionConfiguration } from '../apps/core/runtime/production-configuration.js';

const ids = n => `1${String(n).padStart(17, '0')}`;
const CHANNEL = ids(70), ROLE = ids(71);

function harness({ roles = [{ id: ROLE, name: '👑 Matriarch' }], fail = false } = {}) {
  let now = 1_800_000_000_000, roleReads = 0;
  const posts = [];
  const transport = {
    getRoles: async () => { roleReads++; return roles; },
    createErrorAlert: async (channelId, nonce, body) => { if (fail) throw new Error('DISCORD_FORBIDDEN'); posts.push({ channelId, nonce, body }); },
  };
  const alerts = createErrorAlerts({ transport, channelId: CHANNEL, roleName: 'matriarch', clock: () => now, nonce: () => 'a'.repeat(24) });
  return { alerts, posts, advance: ms => { now += ms; }, roleReads: () => roleReads };
}

test('T-ALERT-01 only errors alert: routine traces and member refusals never do', () => {
  for (const code of ['ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR', 'DATABASE_UNAVAILABLE', 'AI_WORKER_RELAUNCHED', 'AI_TURN_UNCERTAIN_DELIVER_1S_AI_DEADLINE_EXPIRED',
    'KNOWLEDGE_SYNC_UNAVAILABLE', 'DASHBOARD_AUTH_UNAVAILABLE_DISCORD_BUSY', 'AI_TURN_SILENT_VALIDATE_1S']) assert.equal(alertable(code), true, code);
  for (const code of ['AI_ADMISSION_SKIPPED_AI_DISABLED', 'AI_TURN_ADMITTED_INFER_0S', 'AI_TURN_DELIVERED_DELIVER_2S', 'DASHBOARD_DENIED_DASHBOARD_CREDENTIAL_INVALID',
    'AI_GUILD_STATE_HYDRATED', 'AI_EFFECT_CHECK_DEFERRED', 'lowercase_unavailable', 'X', '', null, 42]) assert.equal(alertable(code), false, String(code));
});

test('T-ALERT-02 an error posts its code and pings the matriarch role; repeats wait out the cooldown and are counted', async () => {
  const h = harness();
  h.alerts.report('ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR'); await h.alerts.settled();
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].channelId, CHANNEL);
  assert.equal(h.posts[0].body.content, `**Sophie error** \`ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR\`\n<@&${ROLE}>`, 'the decorated role is found by its bare name');
  assert.deepEqual(h.posts[0].body.allowed_mentions, { parse: [], users: [], roles: [ROLE], replied_user: false });
  // Within 30 minutes the same code only counts; afterwards one alert says how many times since, without a second ping.
  for (let i = 0; i < 4; i++) { h.advance(60_000); h.alerts.report('ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR'); }
  await h.alerts.settled(); assert.equal(h.posts.length, 1);
  h.advance(26 * 60_000); h.alerts.report('ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR'); await h.alerts.settled();
  assert.equal(h.posts.length, 2); assert.match(h.posts[1].body.content, /^\*\*Sophie error\*\* `ACTIVITY_REQUEST_UNAVAILABLE_TYPEERROR` ×5 since <t:\d+:R>\n<@&/);
  // Routine codes post nothing.
  h.alerts.report('AI_ADMISSION_SKIPPED_AI_DISABLED'); await h.alerts.settled(); assert.equal(h.posts.length, 2);
});

test('T-ALERT-03 a burst of different errors pings once in 30 minutes and stops at twelve alerts an hour; knowledge sync every six hours', async () => {
  const h = harness();
  for (let i = 0; i < 20; i++) h.alerts.report(`SYNTHETIC_${String.fromCharCode(65 + i)}_UNAVAILABLE`);
  await h.alerts.settled();
  assert.equal(h.posts.length, 12, 'hourly cap');
  assert.equal(h.posts.filter(post => post.body.allowed_mentions.roles.length).length, 1, 'one ping');
  assert.ok(h.posts.slice(1).every(post => !/<@&/.test(post.body.content)));
  assert.equal(h.roleReads(), 1);
  const k = harness();
  k.alerts.report('KNOWLEDGE_SYNC_UNAVAILABLE'); k.advance(60 * 60_000); k.alerts.report('KNOWLEDGE_SYNC_UNAVAILABLE'); await k.alerts.settled();
  assert.equal(k.posts.length, 1); k.advance(5 * 60 * 60_000); k.alerts.report('KNOWLEDGE_SYNC_UNAVAILABLE'); await k.alerts.settled(); assert.equal(k.posts.length, 2);
});

test('T-ALERT-04 no role found, two candidates, or Discord refusing: the alert never throws, and never pings anyone else', async () => {
  for (const roles of [[], [{ id: ids(72), name: 'Matriarch ✦' }, { id: ids(73), name: '👑 Matriarch' }]]) {
    const h = harness({ roles });
    h.alerts.report('DATABASE_UNAVAILABLE'); await h.alerts.settled();
    assert.equal(h.posts[0].body.content, '**Sophie error** `DATABASE_UNAVAILABLE`'); assert.deepEqual(h.posts[0].body.allowed_mentions.roles, []);
  }
  const h = harness({ fail: true });
  assert.doesNotThrow(() => h.alerts.report('DATABASE_UNAVAILABLE')); await h.alerts.settled();
});

test('T-ALERT-05 the transport sends an alert that may ping one role, and refuses anything else', async () => {
  const calls = [];
  const transport = createDiscordTransport({ guildId: ids(1), token: 'synthetic-token-not-a-secret-xx', clock: Date.now, enabled: async () => true, scope: 'activity-ai',
    fetch: async (url, init) => { calls.push([init.method, new URL(url).pathname, JSON.parse(init.body)]); return Response.json({ id: ids(30), channel_id: CHANNEL }); } });
  const ok = { content: `**Sophie error** \`X_UNAVAILABLE\`\n<@&${ROLE}>`, allowed_mentions: { parse: [], users: [], roles: [ROLE], replied_user: false } };
  await transport.createErrorAlert(CHANNEL, 'b'.repeat(24), ok);
  assert.deepEqual(calls[0].slice(0, 2), ['POST', `/api/v10/channels/${CHANNEL}/messages`]);
  // Members may be named (mentions that notify nobody, since allowed_mentions.users stays empty).
  await transport.createErrorAlert(CHANNEL, 'b'.repeat(24), { ...ok, content: `${ok.content}\n-# affected: <@${ids(12)}>` });
  assert.equal(calls.length, 2); calls.pop();
  for (const body of [{ ...ok, content: 'ping @everyone' }, { ...ok, content: `<@!${ids(12)}>` },{ ...ok, allowed_mentions: { ...ok.allowed_mentions, roles: [ROLE, ids(72)] } },
    { ...ok, allowed_mentions: { ...ok.allowed_mentions, users: [ids(12)] } }, { ...ok, allowed_mentions: { ...ok.allowed_mentions, parse: ['roles'] } },
    { ...ok, allowed_mentions: { ...ok.allowed_mentions, roles: [] } }, { ...ok, embeds: [] }, { ...ok, content: 'x'.repeat(2_001) }, { ...ok, allowed_mentions: { ...ok.allowed_mentions, roles: [ids(1)] } }])
    await assert.rejects(transport.createErrorAlert(CHANNEL, 'b'.repeat(24), body), /INVALID_DISCORD_PAYLOAD/, JSON.stringify(body).slice(0, 80));
  assert.equal(calls.length, 1);
});

test('T-ALERT-06 the production configuration carries the alert channel and role, validated', () => {
  const input = { guildId: ids(1), applicationId: ids(2), publicKeyHex: 'a'.repeat(64), botUserId: ids(3),
    roles: { crew: ids(4), muzzled: ids(5), whitelist: ids(6), staff: ids(7), leadOps: ids(8) }, protectedCategoryId: ids(9),
    dashboardOrigin: 'https://sophie.example.test', activityOrigin: 'https://onboarding.example.test', interactionPort: 38121, dashboardPort: 38122, activityPort: 38125 };
  const configured = productionConfiguration({ ...input, errorAlerts: { channelId: CHANNEL, roleName: 'matriarch' } });
  assert.deepEqual(configured.errorAlerts, { channelId: CHANNEL, roleName: 'matriarch' }); validateStagingRuntime(configured);
  for (const errorAlerts of [{ channelId: 'x', roleName: 'matriarch' }, { channelId: CHANNEL, roleName: '<@&1>' }, { channelId: CHANNEL }, { channelId: ids(9), roleName: 'matriarch' }])
    assert.throws(() => validateStagingRuntime({ ...configured, errorAlerts }), JSON.stringify(errorAlerts));
});

test('T-ALERT-07 an alert says who was affected and what they were doing, naming members without notifying them', async () => {
  const h = harness(), member = n => `1${String(n).padStart(17, '0')}`;
  h.alerts.report('ACTIVITY_REQUEST_UNAVAILABLE_PG_55P03', { userId: member(80), request: 'POST /api/shuttle/act (advance)' }); await h.alerts.settled();
  assert.equal(h.posts[0].body.content, `**Sophie error** \`ACTIVITY_REQUEST_UNAVAILABLE_PG_55P03\`\n-# affected: <@${member(80)}> · during \`POST /api/shuttle/act (advance)\`\n<@&${ROLE}>`);
  assert.deepEqual(h.posts[0].body.allowed_mentions.users, [], 'members are named, never notified');
  // Within the cooldown the affected members gather; the next alert lists five and counts the rest.
  for (let n = 81; n < 88; n++) { h.advance(60_000); h.alerts.report('ACTIVITY_REQUEST_UNAVAILABLE_PG_55P03', { userId: member(n), request: 'GET /api/shuttle' }); }
  h.advance(25 * 60_000); h.alerts.report('ACTIVITY_REQUEST_UNAVAILABLE_PG_55P03', { userId: member(81) }); await h.alerts.settled();
  const second = h.posts[1].body.content;
  assert.match(second, /×8 since <t:\d+:R>\n-# affected: /);
  assert.ok(second.includes(`affected: <@${member(81)}>, <@${member(82)}>, <@${member(83)}>, <@${member(84)}>, <@${member(85)}> (+2 more) · during \`GET /api/shuttle\``), second);
  // Anything that is not a member ID or a known request shape is left out.
  const k = harness();
  k.alerts.report('DATABASE_UNAVAILABLE', { userId: 'someone', request: 'GET /etc/passwd' }); await k.alerts.settled();
  assert.equal(k.posts[0].body.content, `**Sophie error** \`DATABASE_UNAVAILABLE\`\n<@&${ROLE}>`);
});
