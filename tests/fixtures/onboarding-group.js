import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../contracts/validation.js';
import { pauseOnboarding } from '../../modules/onboarding/index.js';
import { createMemberOperation } from '../../apps/core/storage/members.js';
import { recordOnboardingAlert } from '../../apps/core/storage/onboarding-alert-records.js';
import { getDefinition, getPublication, saveSession, requestOnboardingScreen } from '../../apps/core/storage/onboarding-records.js';
import { enqueue } from '../../apps/core/storage/outbox.js';
import { GUILD, USER } from './domain.js';

/**
 * Members can no longer ask Staff for help from the Shuttle, but help requests, Staff alerts, the assistance queue and
 * pauses made before that change are still handled. This records one exactly as the retired Ask Staff click did, so
 * those retained paths stay covered. Synthetic test data only.
 */
export async function seedOnboardingHelp({ pool, clock, observation, interactionId, guildId = GUILD, userId = USER }) {
  const operation = createMemberOperation({ pool, clock });
  return operation(observation, async (client, member) => {
    const row = (await client.query('SELECT state FROM sophie_core.sessions WHERE guild_id = $1 AND user_id = $2 AND current FOR UPDATE',
      [guildId, userId])).rows[0];
    requireCondition(row !== undefined, 'SESSION_NOT_FOUND');
    let session = row.state;
    requireCondition(session.status !== 'complete', 'SHUTTLE_NOT_ACTIVE');
    const requested = (await client.query("SELECT 1 FROM sophie_core.shuttle_help_requests WHERE session_id = $1 AND status = 'open' LIMIT 1", [session.id])).rowCount > 0;
    if (!requested) {
      await client.query(`INSERT INTO sophie_core.shuttle_help_requests (guild_id, interaction_id, session_id, user_id, session_version)
        VALUES ($1, $2, $3, $4, $5)`, [guildId, interactionId, session.id, userId, session.version]);
      const alert = await recordOnboardingAlert(client, { guildId, userId, sessionId: session.id, kind: 'help', sourceId: interactionId });
      if (alert) await enqueue(client, alert);
      const publication = await getPublication(client, session);
      if (publication.helpPauses) {
        const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
        session = pauseOnboarding(session, member, definition, { guildId, userId, expectedVersion: session.version, nonce: session.nonce,
          nextNonce: randomBytes(16).toString('hex') }, clock()).session;
        await saveSession(client, session, member);
      } else await requestOnboardingScreen(client, member, session, interactionId, { replace: true });
    }
    return session.helpPaused ? 'shuttle_help_paused' : 'shuttle_help_recorded';
  });
}

/** The current navigation card of a screen row: where a member's Continue, Back or Check click now lands. */
export async function navigationMessage(admin, screen) {
  if (!screen) return null;
  const row = (await admin.query(`SELECT message_id FROM sophie_core.shuttle_screen_parts WHERE screen_id = $1 AND generation = $2
    AND kind = 'nav' AND NOT gone AND message_id IS NOT NULL`, [screen.id, screen.part_generation])).rows[0];
  return row?.message_id ?? null;
}

/**
 * A run as members see it in the simulated channel: the status card, the current step's plain messages in order and
 * its navigation card. Only messages of the screen's current part generation that were confirmed are included.
 */
export async function shuttleGroup(admin, state, screen) {
  const parts = (await admin.query(`SELECT kind, message_id FROM sophie_core.shuttle_screen_parts WHERE screen_id = $1 AND generation = $2
    AND NOT gone AND message_id IS NOT NULL ORDER BY position`, [screen.id, screen.part_generation])).rows;
  const message = id => (id ? state.messages.get(id) ?? null : null);
  return { status: message(screen.message_id), content: parts.filter(part => part.kind === 'content').map(part => message(part.message_id)),
    nav: message(parts.find(part => part.kind === 'nav')?.message_id) };
}
