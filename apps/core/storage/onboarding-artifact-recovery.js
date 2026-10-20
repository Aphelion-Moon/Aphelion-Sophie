import { createHash } from 'node:crypto';
import { readSystemWording } from './system-wording.js';
import { renderLegacyOnboardingScreen } from '../../../modules/onboarding/legacy-screen.js';
import { requireCondition } from '../../../contracts/validation.js';
import { onboardingStepMessages, renderOnboardingContent, renderOnboardingNav, renderOnboardingScreen, renderOnboardingStatus } from '../../../modules/onboarding/screens.js';
import { renderOnboardingAlert } from '../../../modules/onboarding/alerts.js';
import { responderRoles } from '../../../platform/authorization/case-responders.js';
import { getPublication } from './onboarding-records.js';

export const isOnboardingMessageJob = kind => ['shuttle.render', 'shuttle.alert'].includes(kind);

/**
 * Fixed schema reads shared by queue descriptors and locked repair transactions. For a Shuttle run the artifact is its
 * status card, or, once that exists, the first message of the current step whose create was never confirmed.
 */
export async function onboardingArtifact(client, job, bound, lock = false) {
  let row;
  const tail = lock ? ' FOR UPDATE' : '';
  if (job.kind === 'shuttle.render') {
    row = (await client.query(`SELECT * FROM sophie_core.shuttle_screens
      WHERE id = $1 AND guild_id = $2 AND user_id = $3 AND session_id = $4${tail}`,
    [job.effect.screenId, job.guild_id, job.user_id, job.session_id])).rows[0];
    if (row && !(row.create_started && row.message_id === null)) {
      const part = (await client.query(`SELECT * FROM sophie_core.shuttle_screen_parts WHERE screen_id = $1 AND generation = $2
        AND create_started AND message_id IS NULL AND NOT gone ORDER BY position LIMIT 1${tail}`, [row.id, row.part_generation])).rows[0];
      if (part) row = { ...part, screen: row };
    }
  } else if (job.kind === 'shuttle.alert') {
    row = (await client.query(`SELECT * FROM sophie_core.shuttle_alerts
      WHERE id = $1 AND guild_id = $2 AND user_id = $3 AND session_id = $4${tail}`,
    [job.effect.alertId, job.guild_id, job.user_id, job.session_id])).rows[0];
  } else if (job.kind === 'case.provision') {
    row = (await client.query(`SELECT create_started, channel_id FROM sophie_core.case_provisions
      WHERE case_id = $1 AND guild_id = $2${tail}`, [bound.plan.id, job.guild_id])).rows[0];
  } else return null;
  requireCondition(row !== undefined, 'SHUTTLE_ARTIFACT_NOT_FOUND');
  return row;
}

/** Every exact format this run's message could have been sent in, newest first. Older formats are never sent again. */
function screenCandidates({ artifact, screen, publication, wording }) {
  const session = screen.snapshot, helpRequested = screen.help_requested;
  if (artifact.screen) {
    if (artifact.kind === 'nav') return [{ kind: 'nav', payload: renderOnboardingNav({ screenId: screen.id, session, publication,
      helpRequested, controlVersion: screen.control_version }, wording.text) }];
    const message = onboardingStepMessages(publication, session.stepIndex)[artifact.position];
    return message ? [{ kind: 'content', payload: renderOnboardingContent(message) }] : [];
  }
  const candidates = [false, true].map(retired => ({ kind: 'status', payload: renderOnboardingStatus({ session, publication, retired, helpRequested }, wording.text) }));
  for (const retired of [false, true]) candidates.push({ kind: 'screen', payload: renderOnboardingScreen({ screenId: screen.id, session, publication,
    retired, helpRequested, controlVersion: screen.control_version }, wording.text) });
  if (screen.control_version === 0 && wording.revision === 0) for (const retired of [false, true]) candidates.push({ kind: 'screen',
    payload: renderLegacyOnboardingScreen({ screenId: screen.id, session, publication, retired, helpRequested }) });
  return candidates;
}

/** Verify an exact static own-message; persisting its ID does not confirm delivery. */
export function createOnboardingMessageRecovery({ policy, screenVerification, alertVerification, caseAccess }) {
  return async function adopt(client, { job, artifact, bound, session, resultId, proof, message }) {
    requireCondition(isOnboardingMessageJob(job.kind), 'SHUTTLE_RECOVERY_KIND_INVALID');
    requireCondition(artifact.create_started && artifact.channel_id !== null, 'SHUTTLE_RECOVERY_NOT_STARTED');
    requireCondition(artifact.message_id === null || artifact.message_id === resultId, 'SHUTTLE_MESSAGE_COLLISION');
    requireCondition(artifact.channel_id === bound.row.channel_id, 'CASE_CHANNEL_MISMATCH');
    if (job.kind === 'shuttle.alert') requireCondition(job.effect.revision === artifact.revision, 'STALE_SHUTTLE_ISSUE');
    await caseAccess.verify(proof, bound.plan, artifact.channel_id, false);
    const verification = job.kind === 'shuttle.render' ? screenVerification : alertVerification;
    requireCondition(typeof verification?.candidate === 'function' && typeof verification?.matches === 'function', 'SHUTTLE_VERIFIER_REQUIRED');
    const screen = artifact.screen ?? artifact;
    const expected = { plan: bound.plan, channelId: artifact.channel_id,
      ...(job.kind === 'shuttle.render' ? { recordId: artifact.id, screenId: screen.id } : { alertId: artifact.id }) };
    const observed = await verification.candidate(message, expected);
    requireCondition(!observed.missing && observed.messageId === resultId, 'SHUTTLE_RECOVERY_MESSAGE_MISSING');
    const wording = await readSystemWording(client, job.guild_id, screen.wording_revision ?? 0);
    let matches = false, confirmed = null;
    if (job.kind === 'shuttle.render') {
      const publication = await getPublication(client, session);
      for (const candidate of screenCandidates({ artifact, screen, publication, wording })) {
        if (matches) break;
        matches = await verification.matches(message, { ...expected, ...candidate });
        // A body in the current format was just read and matched exactly, so it needs no further edit.
        if (matches && candidate.kind !== 'screen') confirmed = createHash('sha256').update(JSON.stringify(candidate.payload)).digest('hex');
      }
    } else matches = await verification.matches(message, { ...expected,
      payload: renderOnboardingAlert({ alertId: artifact.id, kind: artifact.kind, staffRoleId: responderRoles(policy, 'shuttle')[0] }, wording.text) });
    requireCondition(matches, 'SHUTTLE_RECOVERY_MESSAGE_CHANGED');
    const table = job.kind === 'shuttle.alert' ? 'shuttle_alerts' : artifact.screen ? 'shuttle_screen_parts' : 'shuttle_screens';
    if (table === 'shuttle_alerts') await client.query('UPDATE sophie_core.shuttle_alerts SET message_id = $2 WHERE id = $1', [artifact.id, resultId]);
    else await client.query(`UPDATE sophie_core.${table} SET message_id = $2, rendered_sha256 = $3 WHERE id = $1`, [artifact.id, resultId, confirmed]);
  };
}
