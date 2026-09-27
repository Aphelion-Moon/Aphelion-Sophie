import test from 'node:test';
import assert from 'node:assert/strict';
import { renderOnboardingAlert, validateOnboardingAlertPayload } from '../modules/onboarding/alerts.js';
import { simulatedOnboarding } from './fixtures/onboarding.js';
import { casePlan, casePolicy } from './fixtures/cases.js';
import { caseChannelPayload } from '../modules/tickets/channel-policy.js';
import { STAFF, LEAD, GUILD, NOW } from './fixtures/domain.js';
import { BOT_ROLE } from './fixtures/discord.js';

const alertId = 'a'.repeat(32), channelId = '100000000000000055';
function fixture() {
  let now = NOW;
  const discord = simulatedOnboarding({ clock: () => now });
  const plan = { ...casePlan, type: 'shuttle' };
  discord.state.channels.set(channelId, { ...caseChannelPayload(plan, casePolicy, false), id: channelId, guild_id: GUILD });
  return { discord, plan, advance: () => { now += 6_000; } };
}

test('Shuttle alert templates reject free text, broad mentions and arbitrary controls', () => {
  for (const kind of ['help', 'delivery']) {
    const body = renderOnboardingAlert({ alertId, kind, staffRoleId: STAFF });
    validateOnboardingAlertPayload(body, alertId);
    assert.deepEqual(body.allowed_mentions, { parse: [], roles: [STAFF], users: [], replied_user: false });
    assert.throws(() => validateOnboardingAlertPayload({ ...body, content: '@everyone' }, alertId));
    assert.throws(() => validateOnboardingAlertPayload({ ...body, components: [{ type: 1 }] }, alertId));
    assert.throws(() => validateOnboardingAlertPayload({ ...body, embeds: [{ title: 'arbitrary', description: 'unapproved' }] }, alertId));
  }
  assert.throws(() => renderOnboardingAlert({ alertId, kind: 'head-admins', staffRoleId: STAFF }));
});

test('alert preparation checks the mapped role mention and exact case audience', async () => {
  const { discord, plan } = fixture();
  discord.state.roles.find(role => role.id === STAFF).mentionable = false;
  await assert.rejects(discord.alerts.prepare(plan, channelId), /STAFF_MENTION_UNAVAILABLE/);
  const bot = discord.state.roles.find(role => role.id === BOT_ROLE);
  bot.permissions = String(BigInt(bot.permissions) | (1n << 17n));
  const prepared = await discord.alerts.prepare(plan, channelId);
  await assert.rejects(discord.alerts.create(prepared, { plan, channelId, alertId,
    payload: renderOnboardingAlert({ alertId, kind: 'help', staffRoleId: LEAD }) }), /INVALID_SHUTTLE_ALERT/);
  discord.state.channels.get(channelId).permission_overwrites = [];
  await assert.rejects(discord.alerts.prepare(plan, channelId), /CASE_CHANNEL_ACL_MISMATCH/);
});

test('alert proofs bind the bot, marker, case, current observation and actual mention', async () => {
  const { discord, plan, advance } = fixture();
  const expected = { plan, channelId, alertId, payload: renderOnboardingAlert({ alertId, kind: 'help', staffRoleId: STAFF }) };
  const prepared = await discord.alerts.prepare(plan, channelId);
  const proof = await discord.alerts.create(prepared, expected);
  assert.equal(await discord.alerts.verification.matches(proof, expected), true);
  await assert.rejects(discord.alerts.create(prepared, expected), /SHUTTLE_MESSAGE_UNTRUSTED/);
  await assert.rejects(discord.alerts.verification.candidate({ ...proof }, expected), /SHUTTLE_MESSAGE_UNTRUSTED/);
  const stored = discord.state.messages.get(proof.messageId);
  delete stored.components; // Discord documents this field as optional.
  const withoutComponents = await discord.alerts.inspect({ ...expected, messageId: proof.messageId });
  assert.equal(await discord.alerts.verification.matches(withoutComponents, expected), true);
  stored.components = null;
  await assert.rejects(discord.alerts.inspect({ ...expected, messageId: proof.messageId }), /SHUTTLE_MESSAGE_OWNERSHIP/);
  stored.components = [];
  discord.state.messages.get(proof.messageId).mention_roles = [];
  const missingMention = await discord.alerts.inspect({ ...expected, messageId: proof.messageId });
  assert.equal(await discord.alerts.verification.matches(missingMention, expected), false);
  advance(); await assert.rejects(discord.alerts.verification.candidate(proof, expected), /MEMBERSHIP_STALE/);
  assert.equal(discord.alerts.verification.receipt(proof, expected).messageId, proof.messageId);
});

test('own-message verification ignores bounded Discord scan metadata but rejects changed visible fields and malformed metadata', async () => {
  const { discord, plan } = fixture();
  const expected = { plan, channelId, alertId, payload: renderOnboardingAlert({ alertId, kind: 'help', staffRoleId: STAFF }) };
  const proof = await discord.alerts.create(await discord.alerts.prepare(plan, channelId), expected);
  const stored = discord.state.messages.get(proof.messageId), original = structuredClone(stored.embeds[0]);
  for (const version of [0, 1, 3, Number.MAX_SAFE_INTEGER]) {
    stored.embeds[0] = { ...original, content_scan_version: version };
    const observed = await discord.alerts.inspect({ ...expected, messageId: proof.messageId });
    assert.equal(await discord.alerts.verification.matches(observed, expected), true);
  }
  for (const changed of [{ description: 'Changed synthetic content' }, { title: 'Unexpected title' },
    { image: { url: 'https://example.invalid/synthetic.png' } }, { footer: { ...original.footer, icon_url: 'https://example.invalid/icon.png' } },
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '3', null, {}].map(content_scan_version => ({ content_scan_version }))]) {
    stored.embeds[0] = { ...original, content_scan_version: 3, ...changed };
    const observed = await discord.alerts.inspect({ ...expected, messageId: proof.messageId });
    assert.equal(await discord.alerts.verification.matches(observed, expected), false);
  }
});
