import { requireCondition, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { requireEditorRequestId } from '../../../modules/onboarding/authoring.js';
import { canonicalPermissions, initialPermissions, permissionBase, permissionCandidate, permissionDigest } from '../runtime/permission-configuration.js';
import { requireConfiguredCapability } from '../../../platform/authorization/actor-policy.js';
import { inTransaction } from './transaction.js';
import { reviewPermissionDeployment } from './permission-deployment-review.js';

const metadata = row => row ? { revision: row.revision, ...(row.version ? { version: row.version, status: row.status } : {}),
  sha256: row.sha256, authorId: row.operator_grant.userId, createdAt: row.created_at.toISOString() } : null;

/** Retained deployment candidates only. Approval neither registers a policy nor edits Discord. */
export function createPermissionEditor({ pool, authorize, configuration, options, observeActor, clock, applyEnabled = false }) {
  const fixed = structuredClone(configuration), guildId = fixed.mapping.guildId, baseHash = permissionDigest(permissionBase(fixed));
  const access = async actor => {
    requireCondition(await authorize('permissions.publish', actor, { guildId }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  };
  const operation = (actor, work) => inTransaction(pool, async client => {
    const grant = await access(actor);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,45))', [guildId]);
    const result = await work(client, grant); await access(actor); return result;
  });
  async function draft(client, revision = null) {
    const row = (await client.query(`SELECT * FROM sophie_core.permission_drafts WHERE guild_id=$1 AND ($2::integer IS NULL OR revision=$2)
      ORDER BY revision DESC LIMIT 1`, [guildId, revision])).rows[0] ?? null;
    if (row) requireCondition(permissionDigest(row.document) === row.sha256, 'PERMISSION_RECORD_CORRUPT'); return row;
  }
  async function publication(client, version = null) {
    const row = (await client.query(`SELECT * FROM sophie_core.permission_candidates WHERE guild_id=$1 AND ($2::integer IS NULL OR version=$2)
      ORDER BY version DESC LIMIT 1`, [guildId, version])).rows[0] ?? null;
    if (row) requireCondition(permissionDigest({ document: row.document, candidate: row.candidate }) === row.sha256, 'PERMISSION_RECORD_CORRUPT'); return row;
  }
  async function inspect(document, actor) {
    const candidate = permissionCandidate(canonicalPermissions(document, fixed), fixed);
    requireCondition(document.baseHash === baseHash, 'PERMISSION_BASE_STALE');
    const available = await options.read(), roleIds = new Set(available.roles.map(row => row.id));
    const selected = [candidate.mapping.crew, candidate.mapping.muzzled, candidate.mapping.whitelist, document.staff, document.leadOps, ...Object.values(document.grants).flat(), ...Object.values(document.responders).flat()];
    requireCondition(selected.every(id => roleIds.has(id)) && available.categories.some(row => row.id === document.categoryId), 'PERMISSION_SELECTION_UNAVAILABLE');
    // A nonempty grant is insufficient: the current editor must actually retain usable authority.
    const observation = await observeActor(actor.userId);
    requireCondition(observation.userId === actor.userId, 'OPERATION_DENIED');
    const retired = ['crew','muzzled','whitelist'].filter(key=>fixed.mapping[key]!==candidate.mapping[key]).map(key=>fixed.mapping[key]);
    if(fixed.mapping.whitelist!==candidate.mapping.whitelist)retired.push(candidate.mapping.whitelist);
    const finalRoles=observation.roleIds.filter(id=>!retired.includes(id));
    if(!finalRoles.includes(candidate.mapping.crew))finalRoles.push(candidate.mapping.crew);
    try {
      requireConfiguredCapability(candidate.capabilityPolicy, 'permissions.publish', observation, clock());
      // The applying administrator must retain authority throughout owned-role migration.
      for(const policy of [fixed.capabilityPolicy,candidate.capabilityPolicy])
        requireConfiguredCapability(policy, 'permissions.publish', {...observation,roleIds:finalRoles}, clock());
    }
    catch (error) { if (error.code === 'OPERATION_DENIED') requireCondition(false, 'PERMISSION_LOCKOUT'); throw error; }
    return candidate;
  }
  async function mutate(actor, requestId, request, work) {
    requireEditorRequestId(requestId);
    return operation(actor, async (client, grant) => {
      const prior = (await client.query('SELECT * FROM sophie_core.permission_editor_actions WHERE guild_id=$1 AND request_id=$2', [guildId, requestId])).rows[0];
      if (prior) {
        requireCondition(prior.operator_grant.userId === grant.userId && prior.request_sha256 === permissionDigest(request), 'PERMISSION_REQUEST_COLLISION');
        return { ...prior.result, duplicate: true };
      }
      requireCondition(!(await client.query("SELECT 1 FROM sophie_core.permission_applications WHERE guild_id=$1 AND state IN ('queued','applying','blocked')", [guildId])).rowCount, 'PERMISSION_APPLICATION_BUSY');
      const result = await work(client, grant);
      await client.query(`INSERT INTO sophie_core.permission_editor_actions (guild_id,request_id,request_sha256,operator_grant,result)
        VALUES ($1,$2,$3,$4,$5)`, [guildId, requestId, permissionDigest(request), grant, result]);
      return { ...result, duplicate: false };
    });
  }
  return Object.freeze({
    async read({ actor, revision = null }) {
      if (revision !== null) requireInteger(revision, 1);
      return operation(actor, async client => {
        const row = await draft(client, revision), latest = await publication(client);
        if (revision !== null) requireCondition(row, 'PERMISSION_NOT_FOUND');
        return { draft: row ? { ...metadata(row), document: row.document } : null, initial: initialPermissions(fixed),
          running: permissionBase(fixed), options: await options.read(), latest: metadata(latest), applyEnabled, activation: 'deployment-required' };
      });
    },
    async save({ actor, requestId, expectedRevision, document }) {
      requireInteger(expectedRevision, 0, 2_147_483_646); const canonical = canonicalPermissions(document, fixed);
      requireCondition(canonical.baseHash === baseHash, 'PERMISSION_BASE_STALE');
      return mutate(actor, requestId, { action: 'save', expectedRevision, document: canonical }, async (client, grant) => {
        requireCondition(((await draft(client))?.revision ?? 0) === expectedRevision, 'PERMISSION_STALE');
        const revision = expectedRevision + 1, sha256 = permissionDigest(canonical);
        await client.query('INSERT INTO sophie_core.permission_drafts (guild_id,revision,document,sha256,operator_grant) VALUES ($1,$2,$3,$4,$5)',
          [guildId, revision, canonical, sha256, grant]); return { action: 'save', revision, sha256 };
      });
    },
    async review({ actor, revision }) {
      requireInteger(revision, 1);
      return operation(actor, async client => {
        const row = await draft(client, revision); requireCondition(row, 'PERMISSION_NOT_FOUND');
        const candidate = await inspect(row.document, actor);
        return { draft: { ...metadata(row), document: row.document }, currentRevision: (await draft(client)).revision,
          latest: metadata(await publication(client)), candidate, running: permissionBase(fixed), valid: true, activation: 'deployment-required',
          deployment: await reviewPermissionDeployment(client, { guildId, running: permissionBase(fixed), candidate,
            binding: { revision: row.revision, sha256: row.sha256 } }) };
      });
    },
    async publish({ actor, requestId, expectedRevision, expectedHash, expectedLatestVersion, expectedLatestStatus }) {
      requireInteger(expectedRevision, 1); requireInteger(expectedLatestVersion, 0, 2_147_483_646); requireEditorRequestId(expectedHash);
      requireCondition(['none', 'published', 'withdrawn'].includes(expectedLatestStatus), 'PERMISSION_INPUT_INVALID');
      return mutate(actor, requestId, { action: 'publish', expectedRevision, expectedHash, expectedLatestVersion, expectedLatestStatus }, async (client, grant) => {
        const row = await draft(client), latest = await publication(client);
        requireCondition(row?.revision === expectedRevision && row.sha256 === expectedHash && (latest?.version ?? 0) === expectedLatestVersion &&
          (latest?.status ?? 'none') === expectedLatestStatus, 'PERMISSION_STALE');
        const candidate = await inspect(row.document, actor), version = expectedLatestVersion + 1;
        const sha256 = permissionDigest({ document: row.document, candidate });
        await client.query(`INSERT INTO sophie_core.permission_candidates (guild_id,version,revision,status,document,candidate,sha256,operator_grant)
          VALUES ($1,$2,$3,'published',$4,$5,$6,$7)`, [guildId, version, row.revision, row.document, candidate, sha256, grant]);
        return { action: 'publish', revision: row.revision, version, sha256, activation: 'deployment-required' };
      });
    },
    async publication({ actor, version }) {
      requireInteger(version, 1); return operation(actor, async client => {
        const row = await publication(client, version); requireCondition(row, 'PERMISSION_NOT_FOUND');
        return { ...metadata(row), document: row.document, candidate: row.candidate, activation: 'deployment-required' };
      });
    },
    async deploymentReview({ actor, version, expectedReviewHash = null }) {
      requireInteger(version, 1); if (expectedReviewHash !== null) requireEditorRequestId(expectedReviewHash);
      return operation(actor, async client => {
        const row = await publication(client, version), latest = await publication(client);
        requireCondition(row, 'PERMISSION_NOT_FOUND');
        requireCondition(row.status === 'published' && latest.version === version, 'PERMISSION_STALE');
        const candidate = await inspect(row.document, actor);
        requireCondition(permissionDigest(candidate) === permissionDigest(row.candidate), 'PERMISSION_RECORD_CORRUPT');
        const result = await reviewPermissionDeployment(client, { guildId, running: permissionBase(fixed), candidate,
          binding: { version, revision: row.revision, sha256: row.sha256, status: row.status } });
        requireCondition(expectedReviewHash === null || result.reviewHash === expectedReviewHash, 'PERMISSION_DEPLOYMENT_REVIEW_STALE');
        return { version, sha256: row.sha256, candidate, running: permissionBase(fixed), ...result };
      });
    },
    async history({ actor, kind, before = null }) {
      requireCondition(['drafts', 'publications'].includes(kind), 'PERMISSION_INPUT_INVALID'); if (before !== null) requireInteger(before, 1);
      return operation(actor, async client => {
        const [table, key] = kind === 'drafts' ? ['permission_drafts', 'revision'] : ['permission_candidates', 'version'];
        const rows = (await client.query(`SELECT * FROM sophie_core.${table} WHERE guild_id=$1 AND ($2::integer IS NULL OR ${key}<$2) ORDER BY ${key} DESC LIMIT 11`, [guildId, before])).rows;
        return { entries: rows.slice(0, 10).map(metadata), nextBefore: rows.length > 10 ? rows[9][key] : null };
      });
    },
    async application({ actor }) {
      return operation(actor, async client => {
        const row = (await client.query('SELECT request_id,candidate_version,state,summary,updated_at FROM sophie_core.permission_applications WHERE guild_id=$1 ORDER BY created_at DESC LIMIT 1', [guildId])).rows[0];
        return { enabled: applyEnabled, application: row ? { requestId: row.request_id, version: row.candidate_version, state: row.state, summary: row.summary, updatedAt: row.updated_at.toISOString() } : null };
      });
    },
    async retryApplication({ actor, requestId, confirm }) {
      requireCondition(applyEnabled === true && confirm === true,'PERMISSION_CONFIRMATION_REQUIRED');requireEditorRequestId(requestId);
      return operation(actor, async client => {
        const row=(await client.query('SELECT state FROM sophie_core.permission_applications WHERE guild_id=$1 AND request_id=$2 FOR UPDATE',[guildId,requestId])).rows[0];
        requireCondition(row?.state==='blocked','PERMISSION_STALE');
        await client.query("UPDATE sophie_core.permission_applications SET state='applying',updated_at=clock_timestamp() WHERE guild_id=$1 AND request_id=$2",[guildId,requestId]);
        return {requestId,state:'applying'};
      });
    },
    async apply({ actor, requestId, version, expectedHash, expectedReviewHash, confirm }) {
      requireCondition(applyEnabled === true, 'PERMISSION_APPLICATION_UNAVAILABLE');
      requireInteger(version, 1); for (const hash of [requestId,expectedHash,expectedReviewHash]) requireEditorRequestId(hash);
      requireCondition(confirm === true, 'PERMISSION_CONFIRMATION_REQUIRED');
      return operation(actor, async (client, grant) => {
        const prior = (await client.query('SELECT * FROM sophie_core.permission_applications WHERE guild_id=$1 AND request_id=$2', [guildId,requestId])).rows[0];
        if (prior) {
          requireCondition(prior.candidate_version === version && prior.candidate_sha256 === expectedHash && prior.review_sha256 === expectedReviewHash && prior.operator_grant.userId === grant.userId, 'PERMISSION_REQUEST_COLLISION');
          return { requestId, version, state: prior.state };
        }
        requireCondition(!(await client.query("SELECT 1 FROM sophie_core.permission_applications WHERE guild_id=$1 AND state IN ('queued','applying','blocked')", [guildId])).rowCount, 'PERMISSION_APPLICATION_BUSY');
        const row = await publication(client), candidate = row && await inspect(row.document, actor);
        requireCondition(row?.version === version && row.status === 'published' && row.sha256 === expectedHash, 'PERMISSION_STALE');
        const review = await reviewPermissionDeployment(client, { guildId, running: permissionBase(fixed), candidate,
          binding: { version, revision: row.revision, sha256: row.sha256, status: row.status } });
        requireCondition(review.reviewHash === expectedReviewHash, 'PERMISSION_DEPLOYMENT_REVIEW_STALE');
        requireCondition(review.blockers.length === 0, 'PERMISSION_DEPLOYMENT_BLOCKED');
        await client.query(`INSERT INTO sophie_core.permission_applications (guild_id,request_id,candidate_version,candidate_sha256,review_sha256,operator_grant)
          VALUES ($1,$2,$3,$4,$5,$6)`, [guildId,requestId,version,expectedHash,expectedReviewHash,grant]);
        return { requestId, version, state: 'queued' };
      });
    },
    async withdraw({ actor, requestId, version, expectedHash, confirm }) {
      requireInteger(version, 1); requireEditorRequestId(expectedHash); requireCondition(confirm === true, 'PERMISSION_CONFIRMATION_REQUIRED');
      return mutate(actor, requestId, { action: 'withdraw', version, expectedHash }, async (client) => {
        requireCondition(!(await client.query("SELECT 1 FROM sophie_core.permission_applications WHERE guild_id=$1 AND candidate_version=$2 AND state IN ('queued','applying','blocked')", [guildId,version])).rowCount, 'PERMISSION_APPLICATION_BUSY');
        const row = await publication(client, version); requireCondition(row?.sha256 === expectedHash && row.status === 'published', 'PERMISSION_STALE');
        await client.query("UPDATE sophie_core.permission_candidates SET status='withdrawn' WHERE guild_id=$1 AND version=$2", [guildId, version]);
        return { action: 'withdraw', version, activation: 'deployment-required' };
      });
    },
  });
}
