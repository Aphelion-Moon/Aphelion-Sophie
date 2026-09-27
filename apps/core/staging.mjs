import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { readRuntimeJson } from './runtime/files.js';
import { validateStagingRuntime } from './runtime/configuration.js';
import { requireStagingDatabase, requireStagingOwnerDatabase, checkRuntimeDatabase } from './runtime/database.js';
import { createStagingRuntime } from './runtime/staging.js';
import { createConfigurableStagingRuntime } from './runtime/configurable-staging.js';
import { runRuntimeHost } from './runtime/host.js';
import { createDatabasePool } from './storage/pool.js';
import { migrateCore } from './storage/migrate.js';
import { createDiscordTransport } from './discord/transport.js';
import { administrationCommandDefinitions, registerStagingCommands } from './discord/command-registration.js';

// All diagnostics are fixed codes. No original errors, request bodies, tokens or connection strings.
const report = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let pool = null, ownerPool = null;
async function main() {
  const [mode, ...args] = process.argv.slice(2), options = {};
  requireCondition(['check', 'commands', 'migrate', 'start'].includes(mode) && args.length % 2 === 0, 'STAGING_ARGUMENTS_INVALID');
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(['--config', '--database', '--owner-database', '--credentials', '--confirm-guild', '--confirm-database'].includes(args[index]) &&
      !Object.hasOwn(options, args[index]), 'STAGING_ARGUMENTS_INVALID'); options[args[index]] = args[index + 1];
  }
  requireCondition(mode === 'start' || (!options['--owner-database'] && !options['--credentials']), 'STAGING_ARGUMENTS_INVALID');
  requireCondition(process.version === 'v24.19.0', 'REVIEWED_NODE_RUNTIME_REQUIRED');
  const configuration = await readRuntimeJson(options['--config']); validateStagingRuntime(configuration);
  if (mode === 'check') {
    requireCondition(Object.keys(options).length === 1, 'STAGING_ARGUMENTS_INVALID');
    report({ configurationValid: true, environment: 'staging', liveChecked: false, productionReady: false,
      captureEnabled: configuration.captureEnabled, attachmentAcquisitionEnabled: false,
      dashboardConfigured: configuration.dashboard !== null, intents: configuration.captureEnabled ? 33283 : 3 }); return;
  }
  if (mode === 'commands' && options['--confirm-guild'] === undefined) {
    requireCondition(Object.keys(options).length === 1, 'STAGING_ARGUMENTS_INVALID');
    report({ applied: false, commands: administrationCommandDefinitions() }); return;
  }
  if (mode === 'migrate') {
    requireCondition(Object.keys(options).length === 3 && options['--database'] && options['--confirm-database'], 'STAGING_ARGUMENTS_INVALID');
  } else {
    const expected = mode === 'start' ? 3 + Number(Boolean(options['--owner-database'])) + Number(Boolean(options['--credentials'])) : 2;
    requireCondition(options['--confirm-guild'] === configuration.mapping.guildId && Object.keys(options).length === expected, 'COMMAND_REGISTRATION_CONFIRMATION_REQUIRED');
    if (mode === 'start') requireCondition(options['--database'] && !options['--confirm-database'], 'STAGING_ARGUMENTS_INVALID');
  }
  if (mode === 'commands') {
    const transport = createDiscordTransport({ guildId: configuration.mapping.guildId, token: process.env.SOPHIE_DISCORD_TOKEN,
      fetch, clock: Date.now, enabled: () => true });
    report({ applied: true, commands: await registerStagingCommands({ transport, applicationId: configuration.applicationId,
      botUserId: configuration.mapping.botUserId, confirmGuildId: options['--confirm-guild'] }) }); return;
  }
  const database = await readRuntimeJson(options['--database']); requireStagingDatabase(database);
  const ownerDatabase = options['--owner-database'] ? await readRuntimeJson(options['--owner-database']) : null;
  if (ownerDatabase) requireStagingOwnerDatabase(database, ownerDatabase);
  pool = createDatabasePool(database, () => { report({ fault: 'DATABASE_UNAVAILABLE' }); });
  if (mode === 'migrate') {
    requireCondition(options['--confirm-database'] === database.database, 'STAGING_DATABASE_CONFIRMATION_REQUIRED');
    report({ migrated: await migrateCore(pool), productionReady: false }); return;
  }
  let credentials = { token: process.env.SOPHIE_DISCORD_TOKEN, clientSecret: process.env.SOPHIE_OAUTH_CLIENT_SECRET ?? null };
  if (options['--credentials']) {
    credentials = await readRuntimeJson(options['--credentials']);
    requireKeys(credentials, ['token', 'clientSecret']);
    requireCondition(typeof credentials.token === 'string' && credentials.token.length > 0 &&
      (configuration.dashboard === null ? credentials.clientSecret === null : typeof credentials.clientSecret === 'string' && credentials.clientSecret.length > 0), 'RUNTIME_CREDENTIALS_INVALID');
  }
  const controller = new AbortController(), signal = () => controller.abort();
  process.once('SIGINT', signal); process.once('SIGTERM', signal);
  try {
    if (ownerDatabase) ownerPool = createDatabasePool(ownerDatabase, () => report({ fault: 'CONFIGURATION_DATABASE_UNAVAILABLE' }));
    else await checkRuntimeDatabase(pool);
    // The configurable host checks the core identity even while maintenance is held,
    // then resumes its durable journal before starting the normal runtime.
    const factory = ownerPool ? createConfigurableStagingRuntime : createStagingRuntime;
    const runtime = await factory({ ...(ownerPool ? { ownerPool } : {}), configuration, pool, ...credentials,
      fetch, connect: url => new WebSocket(url), onFault: code => report({ fault: code }) });
    await runRuntimeHost({ runtime, signal: controller.signal, report });
  } finally { process.off('SIGINT', signal); process.off('SIGTERM', signal); }
}
try { await main(); }
catch (error) { report({ error: /^[A-Z][A-Z_0-9]{1,63}$/.test(error.code ?? '') ? error.code : 'STAGING_OPERATION_FAILED', productionReady: false }); process.exitCode = 1; }
finally {
  const closed = await Promise.allSettled([pool?.end(), ownerPool?.end()]);
  if (closed.some(result => result.status === 'rejected')) { report({ error: 'DATABASE_SHUTDOWN_INCOMPLETE' }); process.exitCode = 1; }
}
