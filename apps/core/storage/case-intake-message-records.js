import { readSystemWording } from './system-wording.js';
import { randomBytes } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { caseIntakePages, renderCaseIntakeMessage } from '../../../modules/tickets/intake-messages.js';
import { canonicalCaseAnswers } from '../../../modules/tickets/intake.js';
import { caseFormHash, readCaseForm } from './case-form-records.js';
import { enqueue } from './outbox.js';

/** Core-only retained source. No submitted values leave this module in a descriptor or outbox effect. */
export async function intakeMessagePages(client, { caseId, guildId, userId, caseType }) {
  const row = (await client.query('SELECT * FROM sophie_core.case_intakes WHERE case_id = $1 AND guild_id = $2 AND user_id = $3', [caseId, guildId, userId])).rows[0];
  requireCondition(row?.delivery_format === 1 && row.case_type === caseType && caseFormHash(row.answers) === row.answers_sha256, 'CASE_INTAKE_CORRUPT');
  const form = row.form_version === null ? null : (await readCaseForm(client, guildId, row.case_type, row.form_version)).form;
  if (form) requireCondition(caseFormHash(canonicalCaseAnswers(form, row.answers)) === row.answers_sha256, 'CASE_INTAKE_CORRUPT');
  const wording = await readSystemWording(client, guildId, row.wording_revision);
  if (row.wording_revision === null) await client.query('UPDATE sophie_core.case_intakes SET wording_revision=$2 WHERE case_id=$1', [caseId, wording.revision]);
  return caseIntakePages({ caseType: row.case_type, form, formVersion: row.form_version, answers: row.answers, subjectId: row.subject_id }, wording.text);
}
/** Caller holds the member/case transaction. First-time planning also backfills retained pre-022 intake. */
export async function planIntakeMessages(client, plan, policy) {
  const pages = await intakeMessagePages(client, { caseId: plan.id, guildId: plan.guildId, userId: plan.openerId, caseType: plan.type });
  let records = (await client.query('SELECT * FROM sophie_core.case_intake_messages WHERE case_id = $1 ORDER BY ordinal FOR UPDATE', [plan.id])).rows;
  if (!records.length) {
    for (const [index, page] of pages.entries()) {
      const id = randomBytes(16).toString('hex'), payload = renderCaseIntakeMessage({ id, page, caseType: plan.type, policy });
      await client.query(`INSERT INTO sophie_core.case_intake_messages (id, case_id, guild_id, user_id, ordinal, kind, payload_sha256)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, plan.id, plan.guildId, plan.openerId, index + 1, page.kind, caseFormHash(payload)]);
    }
    records = (await client.query('SELECT * FROM sophie_core.case_intake_messages WHERE case_id = $1 ORDER BY ordinal FOR UPDATE', [plan.id])).rows;
  }
  requireCondition(records.length === pages.length, 'CASE_INTAKE_CORRUPT');
  records.forEach((record, index) => {
    const payload = renderCaseIntakeMessage({ id: record.id, page: pages[index], caseType: plan.type, policy });
    requireCondition(record.guild_id === plan.guildId && record.user_id === plan.openerId && record.ordinal === index + 1 &&
      record.kind === pages[index].kind && record.payload_sha256 === caseFormHash(payload), 'CASE_INTAKE_CORRUPT');
  });
  return { records, pages };
}
export async function recordCaseIntakeDelivery(client, plan, policy) {
  await planIntakeMessages(client, plan, policy);
  await enqueue(client, { kind: 'case.intake', operationId: `intake.${plan.id}`, guildId: plan.guildId, userId: plan.openerId, caseId: plan.id });
}
