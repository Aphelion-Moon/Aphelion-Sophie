import { requireCondition } from '../../../contracts/validation.js';
import { requireCaseChannel } from '../../../modules/tickets/channel-policy.js';

/** Retained inventory is authoritative even when a channel is no longer discoverable. */
export async function caseCandidateIds(client, plan) {
  return (await client.query(`SELECT channel_id FROM sophie_core.case_channels
    WHERE guild_id = $1 AND case_id = $2 ORDER BY channel_id COLLATE "C"`, [plan.guildId, plan.id])).rows.map(row => row.channel_id);
}

export function selectedCaseChannel(row, ids) {
  if (ids.length === 1) return ids[0];
  return ids.length > 1 && ids.includes(row.chosen_channel_id) &&
    JSON.stringify(row.chosen_candidates) === JSON.stringify(ids) ? row.chosen_channel_id : null;
}

/** Every noncanonical candidate needs an opaque, fresh, independently checked seal. */
export async function requireOtherCaseSeals({ verification, policy, plan, ids, channelId, proofs }) {
  requireCondition(Array.isArray(proofs) && proofs.length === ids.length - 1, 'CASE_CHANNEL_DUPLICATE');
  requireCondition(typeof verification?.channel === 'function', 'CASE_VERIFIER_REQUIRED');
  const seen = new Set([channelId]);
  for (const proof of proofs) {
    const channel = await verification.channel(proof, plan, true);
    requireCondition(ids.includes(channel.id) && !seen.has(channel.id), 'CASE_CHANNEL_DUPLICATE');
    requireCaseChannel(channel, plan, policy, true); seen.add(channel.id);
  }
}

/** A choice records intent only. The worker still seals all other candidates. */
export async function chooseCaseChannel(client, { job, bound, resultId, proof, verification }) {
  requireCondition(job.kind === 'case.provision' && job.effect.caseId === bound.plan.id, 'SHUTTLE_CHANNEL_CHOICE_INVALID');
  const row = (await client.query('SELECT * FROM sophie_core.case_provisions WHERE case_id = $1 AND guild_id = $2 FOR UPDATE',
    [bound.plan.id, bound.plan.guildId])).rows[0];
  const ids = await caseCandidateIds(client, bound.plan);
  requireCondition(row.create_started && ids.length > 1 && ids.length <= 500 && ids.includes(resultId), 'SHUTTLE_CHANNEL_CHOICE_INVALID');
  // Once a case has opened, its retained messages and controls keep their destination.
  requireCondition(bound.row.channel_id === null || bound.row.channel_id === resultId, 'CASE_CHANNEL_ALREADY_BOUND');
  requireCondition(typeof verification?.candidate === 'function', 'CASE_VERIFIER_REQUIRED');
  const channel = await verification.candidate(proof, bound.plan);
  requireCondition(channel.id === resultId, 'CASE_CHANNEL_MISMATCH');
  await client.query(`UPDATE sophie_core.case_provisions SET chosen_channel_id = $2, chosen_candidates = $3, channel_id = $2
    WHERE case_id = $1`, [bound.plan.id, resultId, ids]);
  await client.query("UPDATE sophie_core.case_reservations SET state = 'pending', version = version + 1 WHERE id = $1 AND state = 'open'", [bound.plan.id]);
  return ids;
}

// Preserve the existing Onboarding interface while sharing the same constrained case operation.
export const chooseOnboardingCaseChannel = chooseCaseChannel;
