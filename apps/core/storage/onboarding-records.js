import { randomBytes, createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { canonicalPublication } from '../../../modules/onboarding/screens.js';
import { enqueue } from './outbox.js';

export async function getDefinition(client, id, version) {
  const result = await client.query('SELECT definition FROM sophie_core.definitions WHERE id = $1 AND version = $2 FOR SHARE', [id, version]);
  requireCondition(result.rowCount === 1, 'DEFINITION_NOT_FOUND');
  return result.rows[0].definition;
}

export async function getSession(client, id, guildId, userId) {
  const result = await client.query('SELECT state FROM sophie_core.sessions WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE', [id, guildId, userId]);
  requireCondition(result.rowCount === 1, 'SESSION_NOT_FOUND');
  return result.rows[0].state;
}

export async function getPublication(client, session) {
  const record = (await client.query(`SELECT publication, sha256 FROM sophie_core.shuttle_publications
    WHERE definition_id = $1 AND definition_version = $2 FOR SHARE`, [session.definitionId, session.definitionVersion])).rows[0];
  requireCondition(record !== undefined, 'SHUTTLE_CONTENT_REQUIRED');
  const publication = canonicalPublication(record.publication);
  requireCondition(createHash('sha256').update(JSON.stringify(publication)).digest('hex') === record.sha256, 'SHUTTLE_COPY_INVALID');
  return publication;
}

/** Caller holds the member lock. Compiled message bodies never enter the outbox. */
export async function requestOnboardingScreen(client, member, session, reason, { recover = false, replace = false } = {}) {
  const bound = await client.query('SELECT 1 FROM sophie_core.shuttle_cases WHERE session_id = $1', [session.id]);
  if (!bound.rowCount) return null; // Internal, unbound domain fixtures have no Discord screen.
  await client.query(`UPDATE sophie_core.case_reservations r SET onboarding_activity_ms=$2 FROM sophie_core.shuttle_cases b
    WHERE b.session_id=$1 AND r.id=b.case_id AND r.onboarding_retirement IS NULL`, [session.id, member.observation.observedAt]);
  await getPublication(client, session);
  const help = (await client.query("SELECT 1 FROM sophie_core.shuttle_help_requests WHERE session_id = $1 AND status = 'open' LIMIT 1", [session.id])).rowCount > 0;
  const previous = (await client.query(`SELECT * FROM sophie_core.shuttle_screens
    WHERE guild_id = $1 AND user_id = $2 AND current FOR UPDATE`, [member.guildId, member.userId])).rows[0];
  let abandonUncertain = false;
  if (recover && previous?.create_started && previous.message_id === null) {
    abandonUncertain = (await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND kind = 'shuttle.render'
      AND effect->>'screenId' = $2 AND status = 'parked' LIMIT 1`, [member.guildId, previous.id])).rowCount > 0;
  }
  if (previous && !replace && !abandonUncertain && previous.session_id === session.id &&
    previous.snapshot.version === session.version && Number(previous.access_epoch) === member.accessEpoch && previous.help_requested === help) {
    const pending = (await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND kind = 'shuttle.render'
      AND effect->>'screenId' = $2 AND (status IN ('ready', 'leased') OR (status = 'parked' AND NOT $3)) LIMIT 1`, [member.guildId, previous.id, recover])).rowCount > 0;
    if (!pending) await enqueue(client, { kind: 'shuttle.render', operationId: `screen.refresh.${previous.id}.${reason}`,
      guildId: member.guildId, userId: member.userId, screenId: previous.id });
    return previous.id;
  }
  // Keep one Discord message throughout a run. Old controls are fenced by the
  // revision; queued and late render jobs always reconcile the latest snapshot.
  if (previous && !abandonUncertain && previous.session_id === session.id && Number(previous.access_epoch) === member.accessEpoch) {
    await client.query(`UPDATE sophie_core.shuttle_screens SET snapshot = $2, help_requested = $3,
      control_version = control_version + 1, wording_revision = NULL, ready = false WHERE id = $1`, [previous.id, session, help]);
    await enqueue(client, { kind: 'shuttle.render', operationId: `screen.update.${previous.id}.${reason}`,
      guildId: member.guildId, userId: member.userId, screenId: previous.id });
    return previous.id;
  }
  if (previous) {
    await client.query('UPDATE sophie_core.shuttle_screens SET current = false, ready = false WHERE id = $1', [previous.id]);
    await enqueue(client, { kind: 'shuttle.render', operationId: `screen.retire.${previous.id}.${reason}`,
      guildId: member.guildId, userId: member.userId, screenId: previous.id });
  }
  const id = randomBytes(16).toString('hex');
  await client.query(`INSERT INTO sophie_core.shuttle_screens (id, session_id, guild_id, user_id, snapshot, access_epoch, help_requested)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, session.id, member.guildId, member.userId, session, member.accessEpoch, help]);
  await enqueue(client, { kind: 'shuttle.render', operationId: `screen.render.${id}`,
    guildId: member.guildId, userId: member.userId, screenId: id });
  return id;
}

export async function saveSession(client, session, member) {
  await client.query('UPDATE sophie_core.sessions SET state = $2, current = $3 WHERE id = $1', [session.id, session, session.status !== 'complete']);
  await requestOnboardingScreen(client, member, session, `version.${session.version}`);
}
