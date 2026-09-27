import { ContractError, requireCondition, requireKeys } from '../../contracts/validation.js';
import { readRuntimeJson } from './runtime/files.js';
import { requireStagingDatabase } from './runtime/database.js';
import { createDatabasePool } from './storage/pool.js';
import { reviewedRecoveryTools } from './recovery/local-operations.js';
import { createRecoveryBundle, prepareRecoveryBundle, restoreRecoveryBundle } from './recovery/bundle.js';

// Local isolated operations only. No Discord token, HTTP listener, role grant or production path.
const report = value => process.stdout.write(`${JSON.stringify(value)}\n`);
let pool, key;
try {
  const [mode, option, path, ...extra] = process.argv.slice(2);
  requireCondition(['backup', 'preserve-staging-032', 'restore'].includes(mode) && option === '--request' && path && extra.length === 0, 'RECOVERY_ARGUMENTS_INVALID');
  const backup = mode !== 'restore';
  requireCondition(process.version === 'v24.19.0', 'REVIEWED_NODE_RUNTIME_REQUIRED');
  const request = await readRuntimeJson(path);
  requireKeys(request, ['environment', 'databasePath', 'keyPath', 'binaryRoot', 'parent', 'maxDatabaseBytes', 'confirmGuildId',
    ...(backup ? ['configurationPath', 'buildId', 'vaultRoots'] : ['bundleDirectory', 'manifestSha256'])]);
  requireCondition(request.environment === 'staging', 'ISOLATED_RECOVERY_REQUIRED');
  const database = await readRuntimeJson(request.databasePath);
  if (backup) requireStagingDatabase(database);
  else requireCondition(database.host === '127.0.0.1' && /^sophie_restore_[a-f0-9]{16,32}$/.test(database.database), 'ISOLATED_RESTORE_REQUIRED');
  const secret = await readRuntimeJson(request.keyPath); requireKeys(secret, ['keyHex']);
  requireCondition(typeof secret.keyHex === 'string' && /^[a-f0-9]{64}$/.test(secret.keyHex), 'BACKUP_KEY_INVALID');
  key = Buffer.from(secret.keyHex, 'hex'); secret.keyHex = null;
  const tools = await reviewedRecoveryTools(request.binaryRoot);
  pool = createDatabasePool(database, () => report({ fault: 'DATABASE_UNAVAILABLE' }));
  if (backup) {
    const configuration = await readRuntimeJson(request.configurationPath);
    requireCondition(configuration?.mapping?.guildId === request.confirmGuildId, 'BACKUP_SELECTION_MISMATCH');
    report(await createRecoveryBundle({ pool, database, tools, configuration, buildId: request.buildId,
      vaultRoots: request.vaultRoots, parent: request.parent, key, maxDatabaseBytes: request.maxDatabaseBytes,
      preserveStaging032: mode === 'preserve-staging-032' }));
  } else {
    const prepared = await prepareRecoveryBundle({ directory: request.bundleDirectory, parent: request.parent, key,
      maxDatabaseBytes: request.maxDatabaseBytes, confirmGuildId: request.confirmGuildId, expectedManifestSha256: request.manifestSha256 });
    report({ ...await restoreRecoveryBundle({ prepared, pool, database, tools }), workingDirectory: prepared.working });
  }
} catch (error) {
  report({ fault: error instanceof ContractError ? error.code : 'RECOVERY_OPERATION_FAILED', productionReady: false }); process.exitCode = 1;
} finally { key?.fill(0); await pool?.end(); }
