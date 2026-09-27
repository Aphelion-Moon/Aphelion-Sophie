import { createHash } from 'node:crypto';
import { requireCondition, requireInteger, requireName } from '../../../contracts/validation.js';
import { canonicalPublication } from '../../../modules/onboarding/screens.js';
import { enqueue } from './outbox.js';

// All publication writers share this lock; hash collisions only serialize unrelated definitions.
export async function lockOnboardingDefinition(client, id) {
  requireName(id); await client.query('SELECT pg_advisory_xact_lock(182746, hashtext($1))', [id]);
}

/** Caller holds the definition lock and authorizes its operation in the same transaction. */
export async function writeOnboardingPublication(client, publication, grant) {
  const fixed = canonicalPublication(publication); requireInteger(fixed.version, 1, 2_147_483_647);
  const definition = { id: fixed.id, version: fixed.version, status: 'published', stepIds: fixed.stages.map(stage => stage.id),
    ...(fixed.stages.some(stage => stage.screens) ? { screenCounts: fixed.stages.map(stage => stage.screens?.length ?? 1) } : {}) };
  await client.query('INSERT INTO sophie_core.definitions (id, version, definition) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [fixed.id, fixed.version, definition]);
  const existing = (await client.query('SELECT definition = $3::jsonb AS same FROM sophie_core.definitions WHERE id = $1 AND version = $2 FOR SHARE', [fixed.id, fixed.version, definition])).rows[0];
  requireCondition(existing?.same, 'DEFINITION_IMMUTABLE');
  const sha256 = createHash('sha256').update(JSON.stringify(fixed)).digest('hex');
  await client.query(`INSERT INTO sophie_core.shuttle_publications (definition_id, definition_version, publication, sha256, operator_grant)
    VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`, [fixed.id, fixed.version, fixed, sha256, grant]);
  const recorded = (await client.query(`SELECT publication = $3::jsonb AS same FROM sophie_core.shuttle_publications
    WHERE definition_id = $1 AND definition_version = $2`, [fixed.id, fixed.version, fixed])).rows[0];
  requireCondition(recorded?.same, 'SHUTTLE_COPY_IMMUTABLE'); return sha256;
}

/** Withdrawal retains publication/history and queues the existing private-screen cleanup. */
export async function withdrawOnboardingPublication(client, id, version) {
  requireName(id); requireInteger(version, 1, 2_147_483_647);
  const result = await client.query(`UPDATE sophie_core.definitions SET definition = jsonb_set(definition, '{status}', '"withdrawn"') WHERE id = $1 AND version = $2 RETURNING id`, [id, version]);
  requireCondition(result.rowCount === 1, 'DEFINITION_NOT_FOUND');
  // Do not take member/screen locks behind the definition lock.
  const screens = await client.query(`SELECT id, guild_id, user_id FROM sophie_core.shuttle_screens WHERE current
    AND snapshot->>'definitionId' = $1 AND (snapshot->>'definitionVersion')::integer = $2`, [id, version]);
  for (const screen of screens.rows) await enqueue(client, { kind: 'shuttle.render',
    operationId: `screen.withdraw.${screen.id}`, guildId: screen.guild_id, userId: screen.user_id, screenId: screen.id });
}
