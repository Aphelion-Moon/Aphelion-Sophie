import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { canonicalCaseForm } from '../../../modules/tickets/intake.js';

export const caseFormHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const lockCaseForms = (client, guildId) => client.query('SELECT pg_advisory_xact_lock(182749, hashtext($1))', [guildId]);
export async function readCaseForm(client, guildId, caseType, version = null) {
  const row = (await client.query(`SELECT * FROM sophie_core.case_forms WHERE guild_id = $1 AND case_type = $2
    AND ($3::integer IS NULL OR version = $3) ORDER BY version DESC LIMIT 1`, [guildId, caseType, version])).rows[0];
  requireCondition(row !== undefined, 'CASE_FORM_UNAVAILABLE');
  const form = canonicalCaseForm(row.form); requireCondition(form.caseType === caseType && caseFormHash(form) === row.sha256, 'CASE_FORM_CORRUPT');
  return { ...row, form };
}

/** Caller holds the guild form lock and checks current authority before and after the transaction. */
export async function writeCaseForm(client, guildId, version, form, grant) {
  const fixed = canonicalCaseForm(form), hash = caseFormHash(fixed);
  const existing = (await client.query('SELECT version FROM sophie_core.case_forms WHERE guild_id = $1 AND case_type = $2 AND version = $3', [guildId, fixed.caseType, version])).rows[0];
  if (existing) {
    const row = await readCaseForm(client, guildId, fixed.caseType, version);
    requireCondition(row.sha256 === hash, 'CASE_FORM_IMMUTABLE');
    return { version, status: row.status, sha256: hash, duplicate: true };
  }
  const latest = (await client.query('SELECT max(version) AS version FROM sophie_core.case_forms WHERE guild_id = $1 AND case_type = $2', [guildId, fixed.caseType])).rows[0].version;
  requireCondition(version === (latest ?? 0) + 1, 'CASE_FORM_VERSION_STALE');
  await client.query(`INSERT INTO sophie_core.case_forms (guild_id, case_type, version, form, sha256, status)
    VALUES ($1, $2, $3, $4, $5, 'published')`, [guildId, fixed.caseType, version, fixed, hash]);
  await client.query(`INSERT INTO sophie_core.case_form_actions (guild_id, case_type, version, action, operator_grant)
    VALUES ($1, $2, $3, 'publish', $4)`, [guildId, fixed.caseType, version, grant]);
  return { version, status: 'published', sha256: hash, duplicate: false };
}

export async function withdrawCaseForm(client, guildId, caseType, version, expectedHash, grant) {
  const row = await readCaseForm(client, guildId, caseType, version);
  requireCondition(row.sha256 === expectedHash, 'CASE_FORM_VERSION_STALE');
  const duplicate = row.status === 'withdrawn';
  if (!duplicate) {
    await client.query("UPDATE sophie_core.case_forms SET status = 'withdrawn' WHERE guild_id = $1 AND case_type = $2 AND version = $3", [guildId, caseType, version]);
    await client.query(`INSERT INTO sophie_core.case_form_actions (guild_id, case_type, version, action, operator_grant)
      VALUES ($1, $2, $3, 'withdraw', $4)`, [guildId, caseType, version, grant]);
  }
  return { version, status: 'withdrawn', duplicate };
}
