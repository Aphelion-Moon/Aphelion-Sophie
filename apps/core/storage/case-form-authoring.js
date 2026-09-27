import { requireCondition, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalCaseFormDraft } from '../../../modules/tickets/intake.js';
import { requireFormCaseType, requireFormEditorRequestId, reviewCaseFormDraft } from '../../../modules/tickets/form-authoring.js';
import { caseFormHash as digest, lockCaseForms, readCaseForm, writeCaseForm, withdrawCaseForm } from './case-form-records.js';
import { inTransaction } from './transaction.js';

const number = (value, minimum = 1) => requireInteger(value, minimum, 2_147_483_647);
const draftMetadata = row => row ? { revision: row.revision, sha256: row.sha256,
  authorId: row.operator_grant.userId, createdAt: row.created_at.toISOString() } : null;
const publicationMetadata = row => row ? { version: row.version, status: row.status, sha256: row.sha256,
  authorId: row.operator_grant.userId, createdAt: row.created_at.toISOString() } : null;
const selected = latest => latest?.status === 'published' ? latest.version : null;

/** Core configuration only: never reads case records, modal handles, answers or transcripts. */
export function createCaseFormAuthoringStore({ pool, authorize, guildId }) {
  requireId(guildId); requireCondition(typeof authorize === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const access = async (actor, caseType) => {
    requireCondition(await authorize('case.forms.publish', actor, { guildId, caseType }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  };
  const operation = (actor, caseType, work) => {
    requireFormCaseType(caseType);
    return inTransaction(pool, async client => {
      const grant = await access(actor, caseType); await lockCaseForms(client, guildId);
      const result = await work(client, grant); await access(actor, caseType); return result;
    });
  };
  async function draft(client, caseType, revision = null) {
    const row = (await client.query(`SELECT * FROM sophie_core.case_form_drafts WHERE guild_id = $1 AND case_type = $2
      AND ($3::integer IS NULL OR revision = $3) ORDER BY revision DESC LIMIT 1`, [guildId, caseType, revision])).rows[0] ?? null;
    if (row) {
      row.document = canonicalCaseFormDraft(row.document);
      requireCondition(row.document.caseType === caseType && digest(row.document) === row.sha256, 'CASE_FORM_DRAFT_CORRUPT');
    }
    return row;
  }
  async function publications(client, caseType, before = null) {
    return (await client.query(`SELECT f.version, f.status, f.sha256, a.operator_grant, a.created_at
      FROM sophie_core.case_forms f JOIN sophie_core.case_form_actions a USING (guild_id, case_type, version)
      WHERE f.guild_id = $1 AND f.case_type = $2 AND a.action = 'publish' AND ($3::integer IS NULL OR f.version < $3)
      ORDER BY f.version DESC LIMIT 11`, [guildId, caseType, before])).rows;
  }
  async function prior(client, grant, caseType, requestId, request) {
    const row = (await client.query('SELECT * FROM sophie_core.case_form_editor_actions WHERE guild_id = $1 AND request_id = $2', [guildId, requestId])).rows[0];
    if (!row) return null;
    requireCondition(row.case_type === caseType && row.operator_grant.userId === grant.userId && row.request_sha256 === digest(request), 'CASE_FORM_EDITOR_REQUEST_COLLISION');
    return { ...row.result, duplicate: true };
  }
  async function audit(client, grant, caseType, requestId, request, before, after, version, result) {
    await client.query(`INSERT INTO sophie_core.case_form_editor_actions
      (guild_id, request_id, case_type, request_sha256, action, before_revision, after_revision, publication_version, operator_grant, result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [guildId, requestId, caseType, digest(request), request.action, before, after, version, grant, result]);
    return { ...result, duplicate: false };
  }
  return Object.freeze({
    async readCaseFormDraft({ actor, caseType, revision = null }) {
      if (revision !== null) number(revision);
      return operation(actor, caseType, async client => {
        const row = await draft(client, caseType, revision), latest = (await publications(client, caseType))[0];
        if (revision !== null) requireCondition(row !== null, 'CASE_FORM_DRAFT_NOT_FOUND');
        return { caseType, draft: row ? { ...draftMetadata(row), document: row.document } : null,
          latest: publicationMetadata(latest), newRequestVersion: selected(latest) };
      });
    },
    async listCaseFormHistory({ actor, caseType, kind, before = null }) {
      requireCondition(['drafts', 'publications'].includes(kind), 'CASE_FORM_EDITOR_INPUT_INVALID'); if (before !== null) number(before);
      return operation(actor, caseType, async client => {
        const rows = kind === 'publications' ? await publications(client, caseType, before) : (await client.query(`SELECT revision, sha256, operator_grant, created_at
          FROM sophie_core.case_form_drafts WHERE guild_id = $1 AND case_type = $2 AND ($3::integer IS NULL OR revision < $3)
          ORDER BY revision DESC LIMIT 11`, [guildId, caseType, before])).rows;
        const entries = rows.slice(0, 10).map(kind === 'publications' ? publicationMetadata : draftMetadata);
        return { caseType, entries, nextBefore: rows.length > 10 ? (kind === 'publications' ? entries.at(-1).version : entries.at(-1).revision) : null };
      });
    },
    async saveCaseFormDraft({ actor, caseType, requestId, expectedRevision, document }) {
      requireFormEditorRequestId(requestId); number(expectedRevision, 0); const fixed = canonicalCaseFormDraft(document);
      requireCondition(fixed.caseType === caseType, 'INVALID_CASE_FORM_TYPE'); const request = { action: 'save', expectedRevision, document: fixed };
      return operation(actor, caseType, async (client, grant) => {
        const previous = await prior(client, grant, caseType, requestId, request); if (previous) return previous;
        const old = await draft(client, caseType); requireCondition((old?.revision ?? 0) === expectedRevision, 'CASE_FORM_DRAFT_STALE');
        const revision = expectedRevision + 1; number(revision); const sha256 = digest(fixed);
        await client.query(`INSERT INTO sophie_core.case_form_drafts (guild_id, case_type, revision, document, sha256, operator_grant)
          VALUES ($1, $2, $3, $4, $5, $6)`, [guildId, caseType, revision, fixed, sha256, grant]);
        return audit(client, grant, caseType, requestId, request, expectedRevision, revision, null, { caseType, action: 'save', revision, sha256 });
      });
    },
    async reviewCaseFormDraft({ actor, caseType, revision }) {
      number(revision);
      return operation(actor, caseType, async client => {
        const row = await draft(client, caseType, revision); requireCondition(row !== null, 'CASE_FORM_DRAFT_NOT_FOUND');
        const current = await draft(client, caseType), latest = (await publications(client, caseType))[0], nextVersion = (latest?.version ?? 0) + 1; number(nextVersion);
        return { caseType, draft: draftMetadata(row), currentRevision: current.revision, latest: publicationMetadata(latest),
          ...reviewCaseFormDraft(row.document), nextVersion, newRequestVersion: selected(latest), preservesOpenForms: true, preservesSubmittedAnswers: true };
      });
    },
    async publishCaseFormDraft({ actor, caseType, requestId, expectedRevision, expectedHash, expectedLatestVersion, expectedLatestStatus }) {
      requireFormEditorRequestId(requestId); requireFormEditorRequestId(expectedHash); number(expectedRevision); number(expectedLatestVersion, 0);
      requireCondition(['none', 'published', 'withdrawn'].includes(expectedLatestStatus), 'CASE_FORM_EDITOR_INPUT_INVALID');
      const request = { action: 'publish', expectedRevision, expectedHash, expectedLatestVersion, expectedLatestStatus };
      return operation(actor, caseType, async (client, grant) => {
        const previous = await prior(client, grant, caseType, requestId, request); if (previous) return previous;
        const row = await draft(client, caseType), latest = (await publications(client, caseType))[0];
        requireCondition(row?.revision === expectedRevision && row.sha256 === expectedHash, 'CASE_FORM_DRAFT_STALE');
        requireCondition((latest?.version ?? 0) === expectedLatestVersion && (latest?.status ?? 'none') === expectedLatestStatus, 'CASE_FORM_PUBLICATION_STALE');
        const version = expectedLatestVersion + 1; number(version); const review = reviewCaseFormDraft(row.document);
        requireCondition(review.valid, 'CASE_FORM_DRAFT_INVALID');
        const written = await writeCaseForm(client, guildId, version, review.form, grant);
        return audit(client, grant, caseType, requestId, request, row.revision, row.revision, version,
          { caseType, action: 'publish', revision: row.revision, version, sha256: written.sha256, preservesOpenForms: true, preservesSubmittedAnswers: true });
      });
    },
    async readCaseFormPublication({ actor, caseType, version }) {
      number(version); return operation(actor, caseType, async client => {
        const row = await readCaseForm(client, guildId, caseType, version), latest = (await publications(client, caseType))[0];
        const metadata = (await publications(client, caseType, version === 2_147_483_647 ? null : version + 1)).find(item => item.version === version);
        requireCondition(metadata !== undefined, 'CASE_FORM_CORRUPT');
        return { caseType, ...publicationMetadata(metadata), form: row.form, preview: reviewCaseFormDraft(row.form).preview,
          newRequestVersion: selected(latest), newRequestVersionAfterWithdrawal: selected(latest) === version ? null : selected(latest),
          invalidatesOpenForms: true, preservesSubmittedAnswers: true };
      });
    },
    async withdrawCaseFormPublication({ actor, caseType, requestId, version, expectedHash, confirm }) {
      requireFormEditorRequestId(requestId); requireFormEditorRequestId(expectedHash); number(version);
      requireCondition(confirm === true, 'CASE_FORM_WITHDRAWAL_INVALID');
      const request = { action: 'withdraw', version, expectedHash, confirm };
      return operation(actor, caseType, async (client, grant) => {
        const previous = await prior(client, grant, caseType, requestId, request); if (previous) return previous;
        const row = await readCaseForm(client, guildId, caseType, version), current = await draft(client, caseType);
        requireCondition(row.sha256 === expectedHash && row.status === 'published', 'CASE_FORM_PUBLICATION_STALE');
        await withdrawCaseForm(client, guildId, caseType, version, expectedHash, grant);
        return audit(client, grant, caseType, requestId, request, current?.revision ?? 0, current?.revision ?? 0, version,
          { caseType, action: 'withdraw', version, sha256: row.sha256, invalidatesOpenForms: true, preservesSubmittedAnswers: true,
            newRequestVersionAtWithdrawal: selected((await publications(client, caseType))[0]) });
      });
    },
  });
}
