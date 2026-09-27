import { ContractError, requireCondition } from '../../contracts/validation.js';
import { readRuntimeJson } from './runtime/files.js';
import { validateStagingRuntime } from './runtime/configuration.js';
import { requireStagingDatabase, checkRuntimeDatabase } from './runtime/database.js';
import { createDatabasePool } from './storage/pool.js';
import { createAttachmentVault } from './storage/attachment-vault.js';
import { createAttachmentInventory } from './storage/attachment-inventory.js';

// Explicit local staging operator tool; never loads a Discord token or starts acquisition.
const report = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let pool, client;
try {
  const [mode, ...args] = process.argv.slice(2), options = {};
  requireCondition(['inventory', 'verify'].includes(mode) && args.length % 2 === 0, 'ATTACHMENT_OPERATIONS_ARGUMENTS_INVALID');
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(['--config', '--database', '--vault', '--confirm-guild', ...(mode === 'inventory' ? ['--after'] : ['--job'])].includes(args[index]) &&
      !Object.hasOwn(options, args[index]) && typeof args[index + 1] === 'string' && args[index + 1].length > 0, 'ATTACHMENT_OPERATIONS_ARGUMENTS_INVALID');
    options[args[index]] = args[index + 1];
  }
  requireCondition(['--config', '--database', '--vault', '--confirm-guild', ...(mode === 'verify' ? ['--job'] : [])].every(key => options[key]), 'ATTACHMENT_OPERATIONS_ARGUMENTS_INVALID');
  requireCondition(process.version === 'v24.19.0', 'REVIEWED_NODE_RUNTIME_REQUIRED');
  const configuration = await readRuntimeJson(options['--config']); validateStagingRuntime(configuration);
  requireCondition(configuration.mapping.guildId === options['--confirm-guild'], 'ATTACHMENT_INVENTORY_GUILD_REQUIRED');
  const database = await readRuntimeJson(options['--database']); requireStagingDatabase(database);
  pool = createDatabasePool(database, () => report({ fault: 'DATABASE_UNAVAILABLE' }));
  client = await pool.connect();
  await client.query('SET default_transaction_read_only = on');
  await checkRuntimeDatabase(client);
  const vault = await createAttachmentVault({ root: options['--vault'], clock: Date.now, readOnly: true });
  const inventory = createAttachmentInventory({ pool: client, guildId: configuration.mapping.guildId, vault });
  report({ environment: 'staging', productionReady: false, ...(mode === 'inventory' ? await inventory.page(options['--after'] ?? null) : await inventory.verify(options['--job'])) });
} catch (error) {
  report({ fault: error instanceof ContractError ? error.code : 'ATTACHMENT_OPERATIONS_UNAVAILABLE' }); process.exitCode = 1;
} finally { client?.release(); await pool?.end(); }
