import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createDiscordTransport } from '../apps/core/discord/transport.js';
import { administrationCommandDefinitions, registerStagingCommands } from '../apps/core/discord/command-registration.js';
import { validateStagingRuntime } from '../apps/core/runtime/configuration.js';
import { requireStagingDatabase, requireStagingOwnerDatabase } from '../apps/core/runtime/database.js';
import { runRuntimeHost } from '../apps/core/runtime/host.js';
import { stagingConfiguration } from './fixtures/staging.js';
import { syntheticInteractions, APPLICATION } from './fixtures/interactions.js';
import { GUILD, USER } from './fixtures/domain.js';
import { BOT } from './fixtures/discord.js';

test('staging configuration rejects production scope mismatched role policy ports and extra secret fields', () => {
  const value = stagingConfiguration('a'.repeat(64)); validateStagingRuntime(value);
  for (const update of [v => { v.environment = 'production'; }, v => { v.isolatedGuild = false; },
    v => { v.capabilityPolicy.staff = '99'; }, v => { v.dashboard.guildId = '99'; },
    v => { v.casePolicy.attachmentsAllowed = true; },
    v => { v.dashboardPort = v.interactionPort; }, v => { v.token = 'private'; }]) {
    const candidate = structuredClone(value); update(candidate); assert.throws(() => validateStagingRuntime(candidate));
  }
  requireStagingDatabase({ host: '127.0.0.1', database: 'sophie_stage_test', user: 'sophie_stage_core' });
  assert.throws(() => requireStagingDatabase({ host: '127.0.0.1', database: 'sophie_production', user: 'sophie_stage_core' }), /ISOLATED_STAGING_DATABASE_REQUIRED/);
});

test('staging accepts independent configured operator roles without changing case or member role ownership', () => {
  const value = stagingConfiguration('a'.repeat(64));
  value.capabilityPolicy.grants['shuttle.publish'] = ['701', '702', '703'];
  value.capabilityPolicy.grants['member.mute'] = ['704'];
  assert.doesNotThrow(() => validateStagingRuntime(value));
  assert.equal(value.casePolicy.staff, value.mapping.staff);
  assert.equal(value.casePolicy.leadOps, value.mapping.leadOps);
});

test('configurable host requires distinct database identities on the same isolated database', () => {
  const core = { host: '127.0.0.1', port: 5433, database: 'sophie_stage_test', user: 'sophie_stage_core' };
  const owner = { ...core, user: 'sophie_stage_owner' };
  requireStagingOwnerDatabase(core, owner);
  for (const change of [{ user: core.user }, { port: 5434 }, { database: 'sophie_stage_other' }, { host: 'example.invalid' }]) {
    assert.throws(() => requireStagingOwnerDatabase(core, { ...owner, ...change }));
  }
});

test('host abort during startup waits for startup and drains runtime exactly once', async () => {
  const controller = new AbortController(), events = [];
  let release;
  const starting = new Promise(resolve => { release = resolve; });
  const running = runRuntimeHost({ signal: controller.signal, report: () => assert.fail('Stopped startup was reported ready'),
    runtime: { start: async () => { events.push('starting'); await starting; events.push('started'); },
      status: () => assert.fail('Stopped host polled'), stop: async () => events.push('stopped') } });
  controller.abort(); assert.deepEqual(events, ['starting']); release(); await running;
  assert.deepEqual(events, ['starting', 'started', 'stopped']);
});

test('host shuts down partial startup and propagates startup or shutdown failures', async () => {
  let stopped = 0;
  const args = { signal: new AbortController().signal, report: () => {},
    runtime: { start: async () => { throw Error('Synthetic startup failure'); }, stop: async () => { stopped++; } } };
  await assert.rejects(runRuntimeHost(args), /Synthetic startup failure/); assert.equal(stopped, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runRuntimeHost({ ...args, signal: controller.signal,
    runtime: { start: () => assert.fail('Aborted host started'), stop: async () => { throw Error('Synthetic shutdown failure'); } } }), /Synthetic shutdown failure/);
});

test('fatal Gateway and failed health reads reject so service recovery sees failure', async () => {
  for (const failedRead of [false, true]) {
    let stopped = 0; const reports = [];
    await assert.rejects(runRuntimeHost({ signal: new AbortController().signal, report: value => reports.push(value),
      runtime: { start: async () => ({}), stop: async () => { stopped++; }, status: async () => {
        if (failedRead) throw Error('Synthetic private connection detail');
        return { stopping: true, current: false, gateway: { phase: 'halted' } };
      } } }), failedRead ? /RUNTIME_HEALTH_UNAVAILABLE/ : /RUNTIME_GATEWAY_HALTED/);
    assert.equal(stopped, 1); assert.equal(JSON.stringify(reports).includes('private'), false);
  }
});

test('host tolerates reconnect and held configuration, then drains a pending health read on operator stop', async () => {
  const controller = new AbortController(), events = [], reports = [];
  const phases = ['backoff', 'configuration', 'configuration-blocked', 'current'];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const running = runRuntimeHost({ signal: controller.signal, intervalMs: 1, report: value => reports.push(value),
    runtime: { start: async () => ({}), stop: async () => events.push('stopped'), status: async () => {
      const phase = phases.shift();
      if (!phase) { controller.abort(); await pending; events.push('read-finished'); }
      return { current: phase === 'current', stopping: false, gateway: { phase: phase ?? 'current' } };
    } } });
  await new Promise(resolve => controller.signal.addEventListener('abort', resolve, { once: true }));
  assert.deepEqual(events, []); release(); await running;
  assert.deepEqual(events, ['read-finished', 'stopped']);
  assert.deepEqual(reports.filter(item => item.health).map(item => item.health.phase), ['backoff', 'configuration', 'configuration-blocked', 'current']);
});

test('registered recovery commands are accepted by the existing signed parser and keep guild-only fields', () => {
  const f = syntheticInteractions(), commands = administrationCommandDefinitions();
  assert.deepEqual(commands.map(command => command.name), ['whitelist', 'ticket', 'answer', 'lookup', 'mute', 'unmute']);
  for (const command of commands) { assert.equal('contexts' in command, false); assert.ok(command.options.length <= 25); }
  for (const name of ['whitelist', 'ticket']) for (const action of ['issues', 'recover', 'choose']) {
    const option = commands.find(command => command.name === name).options.find(item => item.name === action); assert.ok(option);
    const fields = action === 'issues' ? [] : [{ type: 3, name: 'issue', value: `${'a'.repeat(32)}.1` },
      { type: 3, name: action === 'recover' ? 'message' : 'channel', value: USER }];
    const envelope = f.mint({ data: { type: 1, name, options: [{ type: 1, name: action, options: fields }] } });
    assert.ok(envelope.command.startsWith(name === 'whitelist' ? 'shuttle.' : 'ticket.'));
  }
});

test('registration checks the application and exact guild before writes, upserts only named commands and accepts 201/200', async () => {
  const calls = []; let applicationId = APPLICATION;
  const transport = createDiscordTransport({ guildId: GUILD, token: 'synthetic-registration-token', clock: Date.now, enabled: () => true,
    fetch: async (url, options) => {
      calls.push({ url, method: options.method });
      if (url.endsWith('/users/@me')) return Response.json({ id: BOT, bot: true });
      if (url.endsWith('/oauth2/applications/@me')) return Response.json({ id: applicationId });
      assert.equal(url, `https://discord.com/api/v10/applications/${APPLICATION}/guilds/${GUILD}/commands`);
      assert.equal(options.method, 'POST'); const body = JSON.parse(options.body);
      return Response.json({ id: '99', application_id: APPLICATION, guild_id: GUILD, type: 1, name: body.name }, { status: calls.length % 2 ? 201 : 200 });
    } });
  await assert.rejects(registerStagingCommands({ transport, applicationId: APPLICATION, botUserId: BOT, confirmGuildId: '99' }), /COMMAND_REGISTRATION_CONFIRMATION_REQUIRED/);
  assert.equal(calls.length, 0);
  applicationId = '99'; await assert.rejects(registerStagingCommands({ transport, applicationId: APPLICATION, botUserId: BOT, confirmGuildId: GUILD }), /GATEWAY_IDENTITY_MISMATCH/);
  assert.equal(calls.some(call => call.method !== 'GET'), false);
  applicationId = APPLICATION; const result = await registerStagingCommands({ transport, applicationId: APPLICATION, botUserId: BOT, confirmGuildId: GUILD });
  assert.equal(result.length, 6); assert.equal(calls.filter(call => call.method === 'POST').length, 6);
});

test('CLI validates the filled template and previews commands offline but refuses an unconfirmed start', async () => {
  const template = await readFile(new URL('../config/staging.example.json', import.meta.url), 'utf8');
  const replacements = { APPLICATION_ID: APPLICATION, APPLICATION_PUBLIC_KEY_64_HEX_CHARACTERS: 'a'.repeat(64),
    GUILD_ID: GUILD, BOT_USER_ID: BOT, CREW_ROLE_ID: '21', MUZZLED_ROLE_ID: '22', WHITELIST_ROLE_ID: '23',
    STAFF_ROLE_ID: '24', HEAD_ADMIN_ROLE_ID: '25', PRIVATE_CASE_CATEGORY_ID: '26', STAGING_DASHBOARD_HOST: 'synthetic.invalid' };
  const value = JSON.parse(template.replace(/<([A-Z_0-9]+)>/g, (_, key) => replacements[key])); validateStagingRuntime(value);
  await mkdir(new URL('../.local/', import.meta.url), { recursive: true });
  const path = new URL(`../.local/staging-cli-${randomUUID()}.json`, import.meta.url);
  const { fileURLToPath } = await import('node:url');
  await writeFile(path, JSON.stringify(value), { flag: 'wx' });
  const corePath = new URL(`${path.href}.core`), ownerPath = new URL(`${path.href}.owner`), credentialsPath = new URL(`${path.href}.credentials`);
  const core = { host: '127.0.0.1', port: 5433, database: 'sophie_stage_synthetic', user: 'sophie_stage_core', password: 'synthetic-password-not-a-secret' };
  await writeFile(corePath, JSON.stringify(core), { flag: 'wx' });
  await writeFile(ownerPath, JSON.stringify({ ...core, database: 'sophie_stage_wrong', user: 'sophie_stage_owner' }), { flag: 'wx' });
  await writeFile(credentialsPath, JSON.stringify({ token: '', clientSecret: 'synthetic' }), { flag: 'wx' });
  const invoke = (mode, args = []) => spawnSync(process.execPath, ['apps/core/staging.mjs', mode, '--config', fileURLToPath(path), ...args],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  try {
    const check = invoke('check'); assert.equal(check.status, 0); assert.equal(JSON.parse(check.stdout).liveChecked, false);
    const commands = invoke('commands'); assert.equal(commands.status, 0); assert.equal(JSON.parse(commands.stdout).applied, false);
    const start = invoke('start'); assert.equal(start.status, 1); assert.equal(JSON.parse(start.stdout).error, 'COMMAND_REGISTRATION_CONFIRMATION_REQUIRED');
    const args = ['--database', fileURLToPath(corePath), '--confirm-guild', GUILD];
    const mismatched = invoke('start', [...args, '--owner-database', fileURLToPath(ownerPath)]);
    assert.equal(mismatched.status, 1); assert.equal(JSON.parse(mismatched.stdout).error, 'STAGING_OWNER_DATABASE_MISMATCH');
    const secret = invoke('start', [...args, '--credentials', fileURLToPath(credentialsPath)]);
    assert.equal(secret.status, 1); assert.equal(JSON.parse(secret.stdout).error, 'RUNTIME_CREDENTIALS_INVALID');
    assert.equal(secret.stdout.includes('synthetic'), false); assert.equal(secret.stderr, '');
  } finally { await Promise.all([path, corePath, ownerPath, credentialsPath].map(file => unlink(file))); }
});
