import { readSystemWording } from './system-wording.js';
import { renderLegacyOnboardingScreen } from '../../../modules/onboarding/legacy-screen.js';
import { requireCondition } from '../../../contracts/validation.js';
import { renderOnboardingScreen } from '../../../modules/onboarding/screens.js';
import { renderOnboardingAlert } from '../../../modules/onboarding/alerts.js';
import { getPublication } from './onboarding-records.js';

export const isOnboardingMessageJob = kind => ['shuttle.render', 'shuttle.alert'].includes(kind);

/** Fixed schema reads shared by queue descriptors and locked repair transactions. */
export async function onboardingArtifact(client, job, bound, lock = false) {
  let row;
  const tail = lock ? ' FOR UPDATE' : '';
  if (job.kind === 'shuttle.render') {
    row = (await client.query(`SELECT * FROM sophie_core.shuttle_screens
      WHERE id = $1 AND guild_id = $2 AND user_id = $3 AND session_id = $4${tail}`,
    [job.effect.screenId, job.guild_id, job.user_id, job.session_id])).rows[0];
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
    const expected = { plan: bound.plan, channelId: artifact.channel_id,
      ...(job.kind === 'shuttle.render' ? { screenId: artifact.id } : { alertId: artifact.id }) };
    const observed = await verification.candidate(message, expected);
    requireCondition(!observed.missing && observed.messageId === resultId, 'SHUTTLE_RECOVERY_MESSAGE_MISSING');
    const wording = await readSystemWording(client, job.guild_id, artifact.wording_revision ?? 0);
    let matches;
    if (job.kind === 'shuttle.render') {
      const publication = await getPublication(client, session);
      const payload = retired => renderOnboardingScreen({ screenId: artifact.id, session: artifact.snapshot, publication,
        retired, helpRequested: artifact.help_requested, controlVersion: artifact.control_version }, wording.text);
      matches = await verification.matches(message, { ...expected, payload: payload(false) }) ||
        await verification.matches(message, { ...expected, payload: payload(true) });
      if (!matches && artifact.control_version === 0 && wording.revision === 0) {
        for (const retired of [false, true]) matches ||= await verification.matches(message, { ...expected,
          payload: renderLegacyOnboardingScreen({ screenId: artifact.id, session: artifact.snapshot, publication, retired, helpRequested: artifact.help_requested }) });
      }
    } else matches = await verification.matches(message, { ...expected,
      payload: renderOnboardingAlert({ alertId: artifact.id, kind: artifact.kind, staffRoleId: responderRoles(policy, 'shuttle')[0] }, wording.text) });
    requireCondition(matches, 'SHUTTLE_RECOVERY_MESSAGE_CHANGED');
    if (job.kind === 'shuttle.render') await client.query('UPDATE sophie_core.shuttle_screens SET message_id = $2 WHERE id = $1', [artifact.id, resultId]);
    else await client.query('UPDATE sophie_core.shuttle_alerts SET message_id = $2 WHERE id = $1', [artifact.id, resultId]);
  };
}
import { responderRoles } from '../../../platform/authorization/case-responders.js';
