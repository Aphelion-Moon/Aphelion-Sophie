import { fileURLToPath } from 'node:url';
import { requireCondition } from '../../contracts/validation.js';
import { readRuntimeJson } from './runtime/files.js';
import { openBootstrapJournal } from './runtime/bootstrap-journal.js';
import { createStagingBootstrap, stagingBootstrapPlan, validateStagingSeed } from './runtime/staging-bootstrap.js';
import { createDiscordTransport } from './discord/transport.js';

const report = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let journal = null;
try {
  const [mode, ...args] = process.argv.slice(2), options = {};
  requireCondition(['plan', 'apply'].includes(mode) && args.length % 2 === 0, 'STAGING_ARGUMENTS_INVALID');
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(['--seed', '--confirm-guild'].includes(args[index]) && !Object.hasOwn(options, args[index]), 'STAGING_ARGUMENTS_INVALID');
    options[args[index]] = args[index + 1];
  }
  requireCondition(process.version === 'v24.19.0', 'REVIEWED_NODE_RUNTIME_REQUIRED');
  const seed = await readRuntimeJson(options['--seed']); validateStagingSeed(seed);
  if (mode === 'plan') { requireCondition(Object.keys(options).length === 1, 'STAGING_ARGUMENTS_INVALID'); report(stagingBootstrapPlan(seed)); }
  else {
    requireCondition(Object.keys(options).length === 2 && options['--confirm-guild'] === seed.guildId, 'STAGING_BOOTSTRAP_CONFIRMATION_REQUIRED');
    const transport = createDiscordTransport({ guildId: seed.guildId, token: process.env.SOPHIE_DISCORD_TOKEN, fetch, clock: Date.now, enabled: () => true });
    journal = await openBootstrapJournal(fileURLToPath(new URL('../../.local/', import.meta.url)), seed);
    const result = await createStagingBootstrap({ seed, transport, journal }).apply(options['--confirm-guild']);
    report({ configured: true, environment: 'staging', configuration: await journal.writeConfiguration(result.configuration),
      receipt: journal.path, lobbyId: result.lobbyId, productionReady: false });
  }
} catch (error) {
  report({ error: /^[A-Z][A-Z_0-9]{1,63}$/.test(error.code ?? '') ? error.code : 'STAGING_BOOTSTRAP_FAILED', productionReady: false }); process.exitCode = 1;
} finally {
  try { await journal?.close(); } catch { report({ error: 'STAGING_BOOTSTRAP_CLOSE_FAILED' }); process.exitCode = 1; }
}
