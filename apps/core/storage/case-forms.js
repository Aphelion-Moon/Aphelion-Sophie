import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalCaseForm, FORM_CASE_TYPES } from '../../../modules/tickets/intake.js';
import { inTransaction } from './transaction.js';
import { lockCaseForms, writeCaseForm, withdrawCaseForm } from './case-form-records.js';

/** Authored forms only. No submitted answers are returned by this configuration interface. */
export function createCaseFormStore({ pool, authorize, guildId }) {
  requireId(guildId); requireCondition(typeof authorize === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const access = async (actor, caseType) => {
    requireCondition(await authorize('case.forms.publish', actor, { guildId, caseType }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  };
  return Object.freeze({
    async publishCaseForm({ actor, version, form }) {
      requireInteger(version, 1, 2_147_483_647); const fixed = canonicalCaseForm(form);
      return inTransaction(pool, async client => {
        const grant = await access(actor, fixed.caseType); await lockCaseForms(client, guildId);
        const result = await writeCaseForm(client, guildId, version, fixed, grant);
        await access(actor, fixed.caseType); return result;
      });
    },
    async withdrawCaseForm({ actor, caseType, version, expectedHash, confirm }) {
      requireCondition(FORM_CASE_TYPES.includes(caseType), 'INVALID_CASE_FORM_TYPE'); requireInteger(version, 1, 2_147_483_647);
      requireCondition(typeof expectedHash === 'string' && /^[a-f0-9]{64}$/.test(expectedHash) && confirm === true, 'CASE_FORM_WITHDRAWAL_INVALID');
      return inTransaction(pool, async client => {
        const grant = await access(actor, caseType); await lockCaseForms(client, guildId);
        const result = await withdrawCaseForm(client, guildId, caseType, version, expectedHash, grant);
        await access(actor, caseType); return result;
      });
    },
  });
}
