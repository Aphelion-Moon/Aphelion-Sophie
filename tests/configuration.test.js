import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateOfflineConfiguration } from '../platform/configuration/index.js';

const example = JSON.parse(await readFile(new URL('../config/example.json', import.meta.url), 'utf8'));

test('T01/T37 offline config preserves unset IDs without authorising delivery', () => {
  const validated = validateOfflineConfiguration(example);
  assert.equal(validated.guildId, null);
  assert.equal(validated.deliveryEnabled, false);
  assert.notEqual(validated, example);
});

test('T01/T22 toggles and unknown fields cannot activate a live or AI path', () => {
  assert.throws(() => validateOfflineConfiguration({ ...example, deliveryEnabled: true }), { code: 'LIVE_ACTIVATION_UNAVAILABLE' });
  assert.throws(() => validateOfflineConfiguration({ ...example, assistantEnabled: true }), { code: 'LIVE_ACTIVATION_UNAVAILABLE' });
  assert.throws(() => validateOfflineConfiguration({ ...example, environment: 'production' }), { code: 'LIVE_ADAPTER_NOT_IMPLEMENTED' });
  assert.throws(() => validateOfflineConfiguration({ ...example, ticketAi: true }), { code: 'INVALID_FIELDS' });
});

test('T21/T37 IDs stay strings and role ownership must be unambiguous', () => {
  assert.throws(() => validateOfflineConfiguration({ ...example, guildId: 123 }), { code: 'INVALID_DISCORD_ID' });
  assert.throws(() => validateOfflineConfiguration({ ...example, roles: { ...example.roles, staff: '9', crew: '9' } }), { code: 'ROLE_OWNERSHIP_CONFLICT' });
});

test('T33/T57 the current config includes the hardware overlay and retention decision', () => {
  assert.equal(example.hostEvaluation.maxWaitingRequests, 3);
  assert.equal(example.hostEvaluation.generationThreads, 4);
  assert.equal(example.hostEvaluation.promptThreads, 4);
  assert.throws(() => validateOfflineConfiguration({ ...example, hostEvaluation: { ...example.hostEvaluation, maxWaitingRequests: 8 } }), { code: 'HOST_OVERLAY_MISMATCH' });
  assert.throws(() => validateOfflineConfiguration({ ...example, retention: { ...example.retention, transcripts: '30_days' } }), { code: 'RETENTION_POLICY_MISMATCH' });
});
