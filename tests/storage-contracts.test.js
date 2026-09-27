import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabasePool } from '../apps/core/storage/pool.js';
import { createCoreStore } from '../apps/core/storage/core-store.js';
import { validateClaim } from '../apps/core/storage/outbox.js';

test('T01 storage refuses ambient credentials, external endpoints and incomplete trusted adapters', () => {
  const configuration = { host: '127.0.0.1', port: 55555, database: 'sophie_synthetic', user: 'sophie_test', password: 'synthetic-development-password-only' };
  assert.throws(() => createDatabasePool({ ...configuration, host: 'example.invalid' }, () => {}), /LOOPBACK_DATABASE_REQUIRED/);
  assert.throws(() => createDatabasePool({ ...configuration, database: 'postgres' }, () => {}), /INVALID_DATABASE_IDENTITY/);
  assert.throws(() => createDatabasePool({ ...configuration, password: '' }, () => {}), /DATABASE_PASSWORD_REQUIRED/);
  assert.throws(() => createDatabasePool({ ...configuration, connectionString: 'do-not-use' }, () => {}), /INVALID_FIELDS/);
  assert.throws(() => createCoreStore({ pool: {}, clock: Date.now }), /TRUSTED_ADAPTERS_REQUIRED/);
});

test('T18 outbox claims reject missing fencing, arbitrary job data and invalid IDs', () => {
  const claim = { guildId: '100000000000000001', operationId: 'session.grant.5', owner: 'worker', fence: 1 };
  assert.doesNotThrow(() => validateClaim(claim));
  assert.throws(() => validateClaim({ ...claim, fence: 0 }), /INVALID_INTEGER/);
  assert.throws(() => validateClaim({ ...claim, payload: 'disallowed' }), /INVALID_FIELDS/);
  assert.throws(() => validateClaim({ ...claim, operationId: '../arbitrary' }), /INVALID_OPERATION_ID/);
});
