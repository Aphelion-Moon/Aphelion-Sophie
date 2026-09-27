import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { requireCondition } from '../../../contracts/validation.js';
import { lockCaseForms, readCaseForm } from './case-form-records.js';
import { requireCaseCapacity } from './case-records.js';

/** Shared bounded reservation for ordinary forms and explicitly selected Staff contacts. */
export async function reserveCaseFormSlot(client, member, { interactionId, caseType, subjectId = null, contactGrants = null,
  contactGrant = null, policy, limits, clock, isCurrent }) {
  requireCondition(isCurrent(), 'CASE_FORM_DEADLINE'); await lockCaseForms(client, member.guildId);
  const previous = (await client.query('SELECT *, expires_at > clock_timestamp() AS active FROM sophie_core.case_form_slots WHERE guild_id = $1 AND interaction_id = $2 FOR UPDATE',
    [member.guildId, interactionId])).rows[0];
  if (previous) {
    requireCondition(previous.user_id === member.userId && previous.case_type === caseType && previous.subject_id === subjectId &&
      isDeepStrictEqual(previous.contact_grants, contactGrants) && isDeepStrictEqual(previous.contact_operator_grant, contactGrant), 'INTERACTION_ID_COLLISION');
    requireCondition(previous.active && !previous.contact_cancelled && previous.consumed_case_id === null &&
      Number(previous.presence_epoch) === member.presenceEpoch && previous.case_policy_version === policy.version, 'CASE_FORM_EXPIRED');
    const published = await readCaseForm(client, member.guildId, caseType, previous.form_version);
    requireCondition(published.status === 'published' && isCurrent(), 'CASE_FORM_UNAVAILABLE');
    return { token: previous.token, version: previous.form_version, form: published.form };
  }
  const published = await readCaseForm(client, member.guildId, caseType); requireCondition(published.status === 'published', 'CASE_FORM_UNAVAILABLE');
  await requireCaseCapacity(client, member, { limits, clock });
  const usage = (await client.query(`SELECT count(*)::integer AS count, bool_or(issued_at > clock_timestamp() - interval '3 seconds') AS recent
    FROM sophie_core.case_form_slots WHERE guild_id = $1 AND user_id = $2 AND expires_at > clock_timestamp()`, [member.guildId, member.userId])).rows[0];
  requireCondition(usage.count < 4 && !usage.recent, 'CASE_FORM_BUSY');
  const slot = (await client.query(`SELECT n FROM generate_series(1, 128) n LEFT JOIN sophie_core.case_form_slots s ON s.guild_id = $1 AND s.slot = n
    WHERE s.slot IS NULL OR s.expires_at <= clock_timestamp() ORDER BY n LIMIT 1`, [member.guildId])).rows[0]?.n;
  requireCondition(slot !== undefined, 'CASE_FORM_BUSY'); const token = randomBytes(24).toString('hex');
  await client.query(`INSERT INTO sophie_core.case_form_slots
    (guild_id, slot, token, user_id, interaction_id, case_type, form_version, case_policy_version, presence_epoch, issued_at, expires_at, consumed_case_id,
      subject_id, contact_grants, contact_operator_grant, contact_confirmed, contact_cancelled)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp(), clock_timestamp() + interval '10 minutes', NULL, $10, $11, $12, false, false)
    ON CONFLICT (guild_id, slot) DO UPDATE SET token = EXCLUDED.token, user_id = EXCLUDED.user_id, interaction_id = EXCLUDED.interaction_id,
      case_type = EXCLUDED.case_type, form_version = EXCLUDED.form_version, case_policy_version = EXCLUDED.case_policy_version,
      presence_epoch = EXCLUDED.presence_epoch, issued_at = EXCLUDED.issued_at, expires_at = EXCLUDED.expires_at, consumed_case_id = NULL,
      subject_id = EXCLUDED.subject_id, contact_grants = EXCLUDED.contact_grants, contact_operator_grant = EXCLUDED.contact_operator_grant,
      contact_confirmed = false, contact_cancelled = false`,
  [member.guildId, slot, token, member.userId, interactionId, caseType, published.version, policy.version, member.presenceEpoch,
    subjectId, contactGrants === null ? null : JSON.stringify(contactGrants), contactGrant]);
  requireCondition(isCurrent(), 'CASE_FORM_DEADLINE'); return { token, version: published.version, form: published.form };
}

export async function ownedCaseFormSlot(client, member, policy, token) {
  await lockCaseForms(client, member.guildId);
  const slot = (await client.query('SELECT *, expires_at > clock_timestamp() AS active FROM sophie_core.case_form_slots WHERE guild_id = $1 AND token = $2 FOR UPDATE',
    [member.guildId, token])).rows[0];
  requireCondition(slot?.user_id === member.userId, 'CASE_FORM_OWNER_MISMATCH');
  requireCondition(slot.active && Number(slot.presence_epoch) === member.presenceEpoch && slot.case_policy_version === policy.version, 'CASE_FORM_EXPIRED');
  return slot;
}
