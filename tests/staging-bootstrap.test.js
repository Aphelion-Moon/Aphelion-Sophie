import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rmdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { createStagingBootstrap, newStagingBootstrapReceipt, stagingBootstrapPlan } from '../apps/core/runtime/staging-bootstrap.js';
import { openBootstrapJournal } from '../apps/core/runtime/bootstrap-journal.js';
import { STAGING_BOT_PERMISSIONS, STAGING_ROLE_KEYS } from '../apps/core/discord/staging-resources.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';
import { simulatedDiscord, BOT, BOT_ROLE } from './fixtures/discord.js';
import { GUILD } from './fixtures/domain.js';
import { APPLICATION } from './fixtures/interactions.js';

const seed = { schemaVersion: 1, environment: 'staging', isolatedGuild: true, guildId: GUILD,
  applicationId: APPLICATION, publicKeyHex: 'a'.repeat(64), ownerUserId: '100000000000000099',
  dashboardOrigin: 'https://synthetic.invalid', interactionPort: 38121, dashboardPort: 38122 };
function fixture() {
  const discord = simulatedDiscord(), clock = { now: Date.now() }, hooks = { beforeRole: null, afterRole: null, applicationId: APPLICATION };
  discord.state.roles.find(role => role.id === BOT_ROLE).permissions = String(STAGING_BOT_PERMISSIONS);
  discord.state.members.set(seed.ownerUserId, []);
  let next = 800000000000000000n, state = newStagingBootstrapReceipt(seed, 'a'.repeat(16));
  const journal = { read: async () => structuredClone(state), save: async value => { state = structuredClone(value); } };
  discord.state.before = async (call, options) => {
    if (call.path === '/api/v10/oauth2/applications/@me') return Response.json({ id: hooks.applicationId });
    if (call.path.endsWith('/channels') && call.method === 'POST' && JSON.parse(options.body).permission_overwrites.some(
      row => ((BigInt(row.allow) | BigInt(row.deny)) & PERMISSIONS.manageRoles) !== 0n)) {
      return Response.json({ code: 50013 }, { status: 403 });
    }
    if (call.path.endsWith('/roles') && call.method === 'POST') {
      const replacement = await hooks.beforeRole?.(); if (replacement) return replacement;
      const role = { ...JSON.parse(options.body), id: String(++next), managed: false, position: 1 }; discord.state.roles.push(role);
      await hooks.afterRole?.(); return Response.json(role);
    }
    if (call.path === `/api/v10/applications/${APPLICATION}/guilds/${GUILD}/commands` && call.method === 'POST') {
      return Response.json({ ...JSON.parse(options.body), id: String(++next), application_id: APPLICATION, guild_id: GUILD }, { status: 201 });
    }
  };
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-staging-bootstrap-token', fetch: discord.fetch, clock: () => clock.now, enabled: () => true });
  const bootstrap = createStagingBootstrap({ seed, transport, journal });
  return { discord, clock, hooks, journal, transport, bootstrap,
    writes: () => discord.state.calls.filter(call => call.method !== 'GET'),
    creates: () => discord.state.calls.filter(call => call.method === 'POST' && !call.path.endsWith('/commands')) };
}
test('bootstrap preview needs no token and exact guild confirmation precedes any connection', async () => {
  assert.equal(stagingBootstrapPlan(seed).productionReady, false);
  assert.throws(() => stagingBootstrapPlan({ ...seed, environment: 'production' }), /ISOLATED_STAGING_REQUIRED/);
  const f = fixture(); await assert.rejects(f.bootstrap.apply('99'), /STAGING_BOOTSTRAP_CONFIRMATION_REQUIRED/);
  assert.equal(f.discord.state.calls.length, 0);
});
test('bootstrap creates only five zero-permission roles and two scoped channels, verifies owner grant and safely reuses IDs', async () => {
  const f = fixture(), previous = structuredClone(f.discord.state.roles);
  const first = await f.bootstrap.apply(GUILD); assert.equal(f.creates().length, 7);
  for (const key of STAGING_ROLE_KEYS) assert.equal(f.discord.state.roles.find(role => role.id === first.configuration.mapping[key]).permissions, '0');
  assert.deepEqual(f.discord.state.roles.slice(0, previous.length), previous);
  assert.deepEqual(f.discord.state.members.get(seed.ownerUserId), [first.configuration.mapping.leadOps]);
  const category = f.discord.state.channels.get(first.configuration.casePolicy.categoryId);
  assert.equal(category.type, 4); assert.equal(category.permission_overwrites.length, 2);
  assert.equal(category.permission_overwrites.find(row => row.id === GUILD).deny, String(PERMISSIONS.viewChannel));
  for (const channel of [category, f.discord.state.channels.get(first.lobbyId)]) {
    const botOverwrite = channel.permission_overwrites.find(row => row.id === BOT);
    assert.equal(BigInt(botOverwrite.allow) & PERMISSIONS.manageRoles, 0n);
    assert.equal(BigInt(botOverwrite.allow) & PERMISSIONS.viewChannel, PERMISSIONS.viewChannel);
  }
  const second = await f.bootstrap.apply(GUILD); assert.deepEqual(second, first); assert.equal(f.creates().length, 7);
  assert.equal(f.writes().filter(call => call.method === 'PUT').length, 1);
  assert.equal(f.writes().some(call => ['DELETE', 'PATCH'].includes(call.method)), false);
});
test('wrong application, owner or bot permission fails before resource creation', async () => {
  for (const change of [f => { f.hooks.applicationId = '99'; }, f => { f.discord.state.ownerId = '99'; },
    f => { f.discord.state.roles.find(role => role.id === BOT_ROLE).permissions = '0'; },
    f => { f.discord.state.roles.find(role => role.id === BOT_ROLE).permissions = String(PERMISSIONS.administrator); }]) {
    const f = fixture(); change(f); await assert.rejects(f.bootstrap.apply(GUILD)); assert.equal(f.writes().length, 0);
  }
});
test('lost create response remains uncertain across retry and never guesses by role name', async () => {
  const f = fixture(); f.hooks.afterRole = async () => { throw new Error('SYNTHETIC_LOST_RESPONSE'); };
  await assert.rejects(f.bootstrap.apply(GUILD), /DELIVERY_UNCERTAIN/);
  assert.equal((await f.journal.read()).steps.crew.status, 'started'); assert.equal(f.creates().length, 1);
  f.hooks.afterRole = null; await assert.rejects(f.bootstrap.apply(GUILD), /STAGING_BOOTSTRAP_UNCERTAIN/);
  assert.equal(f.creates().length, 1); assert.deepEqual(f.discord.state.members.get(seed.ownerUserId), []);
});

test('equal numeric positions report hierarchy failure and resume the observed role after operator correction', async () => {
  const f = fixture(), botRole = f.discord.state.roles.find(role => role.id === BOT_ROLE);
  botRole.position = 1;
  await assert.rejects(f.bootstrap.apply(GUILD), /ROLE_HIERARCHY_BLOCKED/);
  const observed = (await f.journal.read()).steps.crew;
  assert.equal(observed.status, 'observed'); assert.equal(f.creates().length, 1);
  await assert.rejects(f.bootstrap.apply(GUILD), /ROLE_HIERARCHY_BLOCKED/);
  assert.equal(f.creates().length, 1);
  botRole.position = 10;
  const result = await f.bootstrap.apply(GUILD);
  assert.equal(result.configuration.mapping.crew, observed.id); assert.equal(f.creates().length, 7);
});

test('known rate limit before creation can resume after cooldown while modified resources fail closed', async () => {
  const f = fixture(); f.hooks.beforeRole = async () => Response.json({ retry_after: 1 }, { status: 429 });
  await assert.rejects(f.bootstrap.apply(GUILD), /RATE_LIMITED/); assert.equal((await f.journal.read()).steps.crew, null);
  f.hooks.beforeRole = null; f.clock.now += 2000; const result = await f.bootstrap.apply(GUILD);
  f.discord.state.roles.find(role => role.id === result.configuration.mapping.crew).permissions = String(PERMISSIONS.administrator);
  const count = f.writes().length; await assert.rejects(f.bootstrap.apply(GUILD), /STAGING_BOOTSTRAP_RESOURCE_CHANGED/);
  assert.equal(f.writes().length, count);
});
test('ownership change during bootstrap stops before the Head Admin role can be assigned', async () => {
  const f = fixture(); f.hooks.afterRole = async () => { f.discord.state.ownerId = '99'; };
  await assert.rejects(f.bootstrap.apply(GUILD), /STAGING_BOOTSTRAP_AUTHORITY_INVALID/);
  assert.equal(f.writes().some(call => call.method === 'PUT'), false);
});
test('durable local journal excludes a second owner and refuses to overwrite a different configuration', async () => {
  const directory = resolve('.local', `bootstrap-journal-${randomUUID()}`); await mkdir(directory, { recursive: true });
  let journal = await openBootstrapJournal(directory, seed), output;
  try {
    await assert.rejects(openBootstrapJournal(directory, seed), /STAGING_BOOTSTRAP_LOCKED/);
    const state = await journal.read(); state.steps.crew = { status: 'started' }; await journal.save(state);
    const receiptPath = journal.path; await journal.close(); journal = await openBootstrapJournal(directory, seed);
    assert.deepEqual(await journal.read(), state);
    output = await journal.writeConfiguration({ synthetic: true });
    assert.equal(await journal.writeConfiguration({ synthetic: true }), output);
    await assert.rejects(journal.writeConfiguration({ synthetic: false }), /STAGING_CONFIGURATION_EXISTS/);
    await journal.close(); journal = null; await unlink(receiptPath);
  } finally {
    await journal?.close(); if (output) await unlink(output); await rmdir(directory);
  }
});
