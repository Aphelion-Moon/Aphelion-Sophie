import pg from 'pg';
import { requireCondition, requireInteger, requireKeys } from '../../../contracts/validation.js';

/** Explicit configuration only: never fall back to another service's PG* environment. */
export function createDatabasePool(configuration, onUnavailable) {
  requireKeys(configuration, ['host', 'port', 'database', 'user', 'password']);
  requireCondition(configuration.host === '127.0.0.1', 'LOOPBACK_DATABASE_REQUIRED');
  requireInteger(configuration.port, 1024, 65535);
  for (const key of ['database', 'user']) requireCondition(/^sophie_[a-z0-9_]{1,48}$/.test(configuration[key]), 'INVALID_DATABASE_IDENTITY');
  requireCondition(typeof configuration.password === 'string' && configuration.password.length >= 24, 'DATABASE_PASSWORD_REQUIRED');
  requireCondition(typeof onUnavailable === 'function', 'DATABASE_ERROR_HANDLER_REQUIRED');
  const pool = new pg.Pool({
    ...configuration, ssl: false, application_name: 'sophie-core',
    max: 4, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000,
    statement_timeout: 10_000, idle_in_transaction_session_timeout: 10_000,
    // No raw SQL/credentials/errors are sent to logs by this adapter.
  });
  pool.on('error', () => onUnavailable('DATABASE_UNAVAILABLE'));
  return pool;
}

/**
 * The central identity database (C:\Aphelion\Central, docs/decisions/0006-central-identity.md): Symphony's account links
 * and the game servers' character names, which Sophie reads and never writes. Its own identity, read-only for every
 * session; explicit configuration only, as for Sophie's own database (./pool.js).
 */
export function createCentralIdentityPool(configuration, onUnavailable) {
  requireKeys(configuration, ['host', 'port', 'database', 'user', 'password']);
  requireCondition(configuration.host === '127.0.0.1', 'LOOPBACK_DATABASE_REQUIRED');
  requireInteger(configuration.port, 1024, 65535);
  requireCondition(configuration.database === 'aphelion_central' && configuration.user === 'sophie_central_reader', 'INVALID_DATABASE_IDENTITY');
  requireCondition(typeof configuration.password === 'string' && configuration.password.length >= 24, 'DATABASE_PASSWORD_REQUIRED');
  requireCondition(typeof onUnavailable === 'function', 'DATABASE_ERROR_HANDLER_REQUIRED');
  const pool = new pg.Pool({
    ...configuration, ssl: false, application_name: 'sophie-core-central', options: '-c default_transaction_read_only=on',
    max: 2, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 10_000, statement_timeout: 10_000, idle_in_transaction_session_timeout: 10_000,
  });
  pool.on('error', () => onUnavailable('CENTRAL_DATABASE_UNAVAILABLE'));
  return pool;
}
