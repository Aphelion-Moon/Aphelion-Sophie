import { ContractError, requireCondition } from '../../contracts/validation.js';
import { readRuntimeJson } from './runtime/files.js';
import { validateStagingRuntime } from './runtime/configuration.js';
import { requireStagingDatabase, checkRuntimeDatabase } from './runtime/database.js';
import { createDatabasePool } from './storage/pool.js';
import { createLocalShuttlePublisher, requireElevatedSession } from './operator/local-shuttle-publisher.js';

// Host-only Shuttle publishing (owner decision, 22 October 2026). An administrator runs it on the server; it never loads
// a Discord token, starts a listener or is reachable through the tunnel. Modes:
//   status  --config <runtime.json> --database <core.json> --confirm-guild <id> --author <owner id>
//   save    ... --document <draft.json>                      saves the next draft revision and prints its review
//   publish ... --revision <n> --sha256 <hash> --expect-version <n> --expect-status <none|published|withdrawn>
const report = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const COMMON = ['--config', '--database', '--confirm-guild', '--author'];
const MODES = { status: [], save: ['--document'], publish: ['--revision', '--sha256', '--expect-version', '--expect-status'] };
const whole = (value, minimum) => { requireCondition(/^(0|[1-9][0-9]{0,9})$/.test(value) && Number(value) >= minimum, 'SHUTTLE_PUBLISHING_ARGUMENTS_INVALID'); return Number(value); };
let pool;
try {
  const [mode, ...args] = process.argv.slice(2), options = {};
  requireCondition(Object.hasOwn(MODES, mode) && args.length % 2 === 0, 'SHUTTLE_PUBLISHING_ARGUMENTS_INVALID');
  const names = [...COMMON, ...MODES[mode]];
  for (let index = 0; index < args.length; index += 2) {
    requireCondition(names.includes(args[index]) && !Object.hasOwn(options, args[index]) && typeof args[index + 1] === 'string' &&
      args[index + 1].length > 0, 'SHUTTLE_PUBLISHING_ARGUMENTS_INVALID');
    options[args[index]] = args[index + 1];
  }
  requireCondition(names.every(name => Object.hasOwn(options, name)), 'SHUTTLE_PUBLISHING_ARGUMENTS_INVALID');
  requireCondition(process.version === 'v24.22.1', 'REVIEWED_NODE_RUNTIME_REQUIRED');
  requireElevatedSession();
  const configuration = await readRuntimeJson(options['--config']); validateStagingRuntime(configuration);
  requireCondition(configuration.mapping.guildId === options['--confirm-guild'], 'SHUTTLE_PUBLISHING_GUILD_REQUIRED');
  const database = await readRuntimeJson(options['--database']); requireStagingDatabase(database);
  pool = createDatabasePool(database, () => report({ fault: 'DATABASE_UNAVAILABLE' }));
  // Core's own least-privilege identity and the maintenance barrier, as the running service checks them.
  await checkRuntimeDatabase(pool);
  const publisher = createLocalShuttlePublisher({ pool, guildId: configuration.mapping.guildId, definitionId: configuration.definitionId,
    authorId: options['--author'] });
  const result = mode === 'status' ? await publisher.status() : mode === 'save' ? await publisher.save(await readRuntimeJson(options['--document'])) :
    await publisher.publish({ revision: whole(options['--revision'], 1), sha256: options['--sha256'],
      expectedLatestVersion: whole(options['--expect-version'], 0), expectedLatestStatus: options['--expect-status'] });
  report({ environment: 'staging', mode, ...result });
} catch (error) {
  report({ fault: error instanceof ContractError ? error.code : 'SHUTTLE_PUBLISHING_UNAVAILABLE' }); process.exitCode = 1;
} finally { await pool?.end(); }
