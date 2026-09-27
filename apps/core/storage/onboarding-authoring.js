import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireName } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalOnboardingDraft, requireEditorRequestId, reviewOnboardingDraft } from '../../../modules/onboarding/authoring.js';
import { canonicalPublication } from '../../../modules/onboarding/screens.js';
import { lockOnboardingDefinition, writeOnboardingPublication, withdrawOnboardingPublication } from './onboarding-publication-records.js';
import { inTransaction } from './transaction.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revisionNumber = (value, minimum = 1) => requireInteger(value, minimum, 2_147_483_647);
const draftMetadata = row => row ? { revision: row.revision, sha256: row.sha256,
  authorId: row.operator_grant.userId, createdAt: row.created_at.toISOString() } : null;
const publicationMetadata = row => row ? { version: row.version, status: row.status, sha256: row.sha256,
  authorId: row.operator_grant?.userId ?? null, createdAt: row.created_at?.toISOString() ?? null, contentAvailable: row.sha256 !== null } : null;

/** A configured definition only; no actor overrides, member/session detail or arbitrary configuration keys. */
export function createOnboardingAuthoringStore({ pool, authorize, guildId, definitionId }) {
  requireId(guildId); requireName(definitionId); requireCondition(typeof authorize === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const args = [guildId, definitionId];
  const access = async actor => {
    requireCondition(await authorize('shuttle.publish', actor, { guildId, definitionId }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  };
  const operation = (actor, work) => inTransaction(pool, async client => {
    const grant = await access(actor); await lockOnboardingDefinition(client, definitionId);
    const result = await work(client, grant); await access(actor); return result;
  });
  async function draft(client, revision = null) {
    const row = (await client.query(`SELECT * FROM sophie_core.shuttle_draft_revisions WHERE guild_id = $1 AND definition_id = $2
      AND ($3::integer IS NULL OR revision = $3) ORDER BY revision DESC LIMIT 1`, [...args, revision])).rows[0] ?? null;
    if (row) { row.document = canonicalOnboardingDraft(row.document); requireCondition(digest(row.document) === row.sha256, 'SHUTTLE_DRAFT_CORRUPT'); }
    return row;
  }
  async function publications(client, before = null) {
    return (await client.query(`SELECT d.version, d.definition->>'status' AS status, p.sha256, p.operator_grant, p.created_at
      FROM sophie_core.definitions d LEFT JOIN sophie_core.shuttle_publications p ON p.definition_id = d.id AND p.definition_version = d.version
      WHERE d.id = $1 AND ($2::integer IS NULL OR d.version < $2) ORDER BY d.version DESC LIMIT 11`, [definitionId, before])).rows;
  }
  async function impact(client, version) {
    const rows = (await client.query(`SELECT state->>'status' AS status, count(*)::integer AS count FROM sophie_core.sessions
      WHERE guild_id = $1 AND definition_id = $2 AND definition_version = $3 AND (current OR state->>'status' = 'complete') GROUP BY state->>'status'`, [...args, version])).rows;
    return { active: rows.find(row => row.status === 'active')?.count ?? 0,
      rolePending: rows.find(row => row.status === 'role_pending')?.count ?? 0, complete: rows.find(row => row.status === 'complete')?.count ?? 0 };
  }
  async function selectedVersion(client, except = null) {
    return (await client.query(`SELECT version FROM sophie_core.definitions WHERE id = $1 AND definition->>'status' = 'published'
      AND ($2::integer IS NULL OR version <> $2) ORDER BY version DESC LIMIT 1`, [definitionId, except])).rows[0]?.version ?? null;
  }
  async function publication(client, version) {
    const row = (await client.query(`SELECT d.version, d.definition->>'status' AS status, p.sha256, p.operator_grant, p.created_at, p.publication
      FROM sophie_core.definitions d JOIN sophie_core.shuttle_publications p ON p.definition_id = d.id AND p.definition_version = d.version
      WHERE d.id = $1 AND d.version = $2`, [definitionId, version])).rows[0];
    requireCondition(row !== undefined, 'SHUTTLE_PUBLICATION_NOT_FOUND'); row.publication = canonicalPublication(row.publication);
    requireCondition(digest(row.publication) === row.sha256, 'SHUTTLE_COPY_INVALID'); return row;
  }
  async function prior(client, grant, requestId, request) {
    const row = (await client.query('SELECT * FROM sophie_core.shuttle_editor_actions WHERE guild_id = $1 AND request_id = $2', [guildId, requestId])).rows[0];
    if (!row) return null;
    requireCondition(row.definition_id === definitionId && row.operator_grant.userId === grant.userId && row.request_sha256 === digest(request), 'SHUTTLE_EDITOR_REQUEST_COLLISION');
    return { ...row.result, duplicate: true };
  }
  async function audit(client, grant, requestId, request, before, after, version, result) {
    await client.query(`INSERT INTO sophie_core.shuttle_editor_actions
      (guild_id, request_id, definition_id, request_sha256, action, before_revision, after_revision, publication_version, operator_grant, result)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [guildId, requestId, definitionId, digest(request), request.action, before, after, version, grant, result]);
    return { ...result, duplicate: false };
  }
  return Object.freeze({
    async readOnboardingDraft({ actor, revision = null }) {
      if (revision !== null) revisionNumber(revision);
      return operation(actor, async client => {
        const row = await draft(client, revision), latest = (await publications(client))[0];
        if (revision !== null) requireCondition(row !== null, 'SHUTTLE_DRAFT_NOT_FOUND');
        return { definitionId, draft: row ? { ...draftMetadata(row), document: row.document } : null,
          latest: publicationMetadata(latest), currentPublishedVersion: await selectedVersion(client) };
      });
    },
    async listOnboardingHistory({ actor, kind, before = null }) {
      requireCondition(['drafts', 'publications'].includes(kind), 'SHUTTLE_EDITOR_INPUT_INVALID'); if (before !== null) revisionNumber(before);
      return operation(actor, async client => {
        const rows = kind === 'publications' ? await publications(client, before) : (await client.query(`SELECT revision, sha256, operator_grant, created_at
          FROM sophie_core.shuttle_draft_revisions WHERE guild_id = $1 AND definition_id = $2 AND ($3::integer IS NULL OR revision < $3)
          ORDER BY revision DESC LIMIT 11`, [...args, before])).rows;
        const entries = rows.slice(0, 10).map(kind === 'publications' ? publicationMetadata : draftMetadata);
        return { definitionId, entries, nextBefore: rows.length > 10 ? (kind === 'publications' ? entries.at(-1).version : entries.at(-1).revision) : null };
      });
    },
    async saveOnboardingDraft({ actor, requestId, expectedRevision, document }) {
      requireEditorRequestId(requestId); revisionNumber(expectedRevision, 0); const fixed = canonicalOnboardingDraft(document);
      const request = { action: 'save', expectedRevision, document: fixed };
      return operation(actor, async (client, grant) => {
        const previous = await prior(client, grant, requestId, request); if (previous) return previous;
        const old = await draft(client); requireCondition((old?.revision ?? 0) === expectedRevision, 'SHUTTLE_DRAFT_STALE');
        const revision = expectedRevision + 1; revisionNumber(revision); const sha256 = digest(fixed);
        await client.query(`INSERT INTO sophie_core.shuttle_draft_revisions (guild_id, definition_id, revision, document, sha256, operator_grant)
          VALUES ($1, $2, $3, $4, $5, $6)`, [...args, revision, fixed, sha256, grant]);
        return audit(client, grant, requestId, request, expectedRevision, revision, null, { definitionId, action: 'save', revision, sha256 });
      });
    },
    async reviewOnboardingDraft({ actor, revision }) {
      revisionNumber(revision);
      return operation(actor, async client => {
        const row = await draft(client, revision); requireCondition(row !== null, 'SHUTTLE_DRAFT_NOT_FOUND');
        const current = await draft(client), latest = (await publications(client))[0], version = (latest?.version ?? 0) + 1;
        const review = reviewOnboardingDraft(definitionId, version, row.document);
        return { definitionId, draft: draftMetadata(row), currentRevision: current.revision, latest: publicationMetadata(latest),
          ...review, currentPublishedVersion: await selectedVersion(client), preservesExistingRuns: true,
          latestImpact: latest ? await impact(client, latest.version) : { active: 0, rolePending: 0, complete: 0 } };
      });
    },
    async publishOnboardingDraft({ actor, requestId, expectedRevision, expectedHash, expectedLatestVersion, expectedLatestStatus }) {
      requireEditorRequestId(requestId); requireEditorRequestId(expectedHash); revisionNumber(expectedRevision); revisionNumber(expectedLatestVersion, 0);
      requireCondition(['none', 'published', 'withdrawn'].includes(expectedLatestStatus), 'SHUTTLE_EDITOR_INPUT_INVALID');
      const request = { action: 'publish', expectedRevision, expectedHash, expectedLatestVersion, expectedLatestStatus };
      return operation(actor, async (client, grant) => {
        const previous = await prior(client, grant, requestId, request); if (previous) return previous;
        const row = await draft(client), latest = (await publications(client))[0];
        requireCondition(row?.revision === expectedRevision && row.sha256 === expectedHash, 'SHUTTLE_DRAFT_STALE');
        requireCondition((latest?.version ?? 0) === expectedLatestVersion && (latest?.status ?? 'none') === expectedLatestStatus, 'SHUTTLE_PUBLICATION_STALE');
        const version = expectedLatestVersion + 1, review = reviewOnboardingDraft(definitionId, version, row.document);
        requireCondition(review.valid, 'SHUTTLE_DRAFT_INVALID');
        const sha256 = await writeOnboardingPublication(client, review.publication, grant);
        return audit(client, grant, requestId, request, row.revision, row.revision, version,
          { definitionId, action: 'publish', revision: row.revision, version, sha256, preservesExistingRuns: true });
      });
    },
    async readOnboardingPublication({ actor, version }) {
      revisionNumber(version); return operation(actor, async client => {
        const row = await publication(client, version);
        return { definitionId, ...publicationMetadata(row), publication: row.publication, impact: await impact(client, version),
          currentPublishedVersion: await selectedVersion(client), newRunVersionAfterWithdrawal: await selectedVersion(client, version) };
      });
    },
    async withdrawOnboardingPublication({ actor, requestId, version, expectedHash, confirm }) {
      requireEditorRequestId(requestId); requireEditorRequestId(expectedHash); revisionNumber(version);
      requireCondition(confirm === true, 'SHUTTLE_WITHDRAWAL_CONFIRMATION_REQUIRED');
      const request = { action: 'withdraw', version, expectedHash, confirm };
      return operation(actor, async (client, grant) => {
        const previous = await prior(client, grant, requestId, request); if (previous) return previous;
        const row = await publication(client, version), current = await draft(client);
        requireCondition(row.sha256 === expectedHash && row.status === 'published', 'SHUTTLE_PUBLICATION_STALE');
        await withdrawOnboardingPublication(client, definitionId, version);
        return audit(client, grant, requestId, request, current?.revision ?? 0, current?.revision ?? 0, version,
          { definitionId, action: 'withdraw', version, sha256: row.sha256, impactAtWithdrawal: await impact(client, version),
            newRunVersionAtWithdrawal: await selectedVersion(client) });
      });
    },
  });
}
