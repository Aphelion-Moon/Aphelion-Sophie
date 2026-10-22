import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { requireCondition, requireId, requireName } from '../../../contracts/validation.js';
import { createOnboardingAuthoringStore } from '../storage/onboarding-authoring.js';

/**
 * Host-only Shuttle publishing (owner decision, 22 October 2026). Server administrator access is the authority: the
 * command needs an elevated session and core's database login, which only administrators can read. The recorded author
 * must be the guild owner as Sophie last observed them, and that record is re-read for every operation. Saving,
 * review and publishing go through the dashboard's own store (the same validation, revision, hash and publication
 * checks and audit), marked as local operator actions. No Discord token, listener or tunnel route.
 */
export function createLocalShuttlePublisher({ pool, guildId, definitionId, authorId, requestId = () => randomBytes(32).toString('hex'),
  createStore = createOnboardingAuthoringStore }) {
  requireId(guildId); requireName(definitionId); requireId(authorId);
  requireCondition(typeof pool?.query === 'function' && typeof requestId === 'function' && typeof createStore === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  let actor = null;
  async function ownerGrant() {
    const latest = (await pool.query('SELECT max(version) AS version FROM sophie_core.capability_policies WHERE guild_id = $1', [guildId])).rows[0]?.version ?? null;
    const row = (await pool.query(`SELECT capability_epoch, policy_version, observation FROM sophie_core.actor_authority
      WHERE guild_id = $1 AND user_id = $2`, [guildId, authorId])).rows[0];
    requireCondition(row !== undefined, 'LOCAL_OPERATOR_AUTHOR_UNKNOWN');
    const seen = row.observation;
    requireCondition(seen?.guildOwner === true && seen.present === true && seen.bot === false && latest !== null &&
      row.policy_version === latest, 'LOCAL_OPERATOR_AUTHOR_NOT_OWNER');
    return { guildId, userId: authorId, capabilityEpoch: Number(row.capability_epoch), policyVersion: row.policy_version };
  }
  // Only this command's own actor, only for publishing this definition, and only while the owner record is unchanged.
  async function authorize(capability, candidate, scope) {
    if (capability !== 'shuttle.publish' || actor === null || candidate !== actor || scope?.guildId !== guildId || scope.definitionId !== definitionId) return false;
    const grant = await ownerGrant();
    return grant.capabilityEpoch === actor.capabilityEpoch && grant.policyVersion === actor.policyVersion;
  }
  const store = createStore({ pool, authorize, guildId, definitionId, origin: 'local-operator' });
  const begin = async () => { actor = Object.freeze(await ownerGrant()); return actor; };
  const brief = review => ({ valid: review.valid, errors: review.errors, version: review.publication?.version ?? null,
    stages: review.pages.map(page => ({ id: page.id, title: page.title, messages: page.segments.length })),
    latest: review.latest, currentPublishedVersion: review.currentPublishedVersion, latestImpact: review.latestImpact });
  return Object.freeze({
    async status() {
      const overview = await store.readOnboardingDraft({ actor: await begin() });
      const { document: _document, ...draft } = overview.draft ?? {};
      return { definitionId, draft: overview.draft ? draft : null, latest: overview.latest, currentPublishedVersion: overview.currentPublishedVersion };
    },
    /** Saves the document as the next draft revision and reviews it; nothing is published. */
    async save(document) {
      const current = await begin(), overview = await store.readOnboardingDraft({ actor: current });
      const saved = await store.saveOnboardingDraft({ actor: current, requestId: requestId(), expectedRevision: overview.draft?.revision ?? 0, document });
      return { ...saved, review: brief(await store.reviewOnboardingDraft({ actor: current, revision: saved.revision })) };
    },
    /** Publishes exactly the reviewed revision, as the dashboard does: the revision, its hash and the latest version must still match. */
    async publish({ revision, sha256, expectedLatestVersion, expectedLatestStatus }) {
      return store.publishOnboardingDraft({ actor: await begin(), requestId: requestId(), expectedRevision: revision, expectedHash: sha256,
        expectedLatestVersion, expectedLatestStatus });
    },
  });
}

/** The command runs only in an elevated session: High (or System) mandatory level in the process token. */
export function requireElevatedSession({ run = spawnSync, platform = process.platform, systemRoot = process.env.SystemRoot } = {}) {
  requireCondition(platform === 'win32' && typeof systemRoot === 'string' && systemRoot.length > 0, 'LOCAL_OPERATOR_ELEVATION_REQUIRED');
  const result = run(join(systemRoot, 'System32', 'whoami.exe'), ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  requireCondition(result?.status === 0 && typeof result.stdout === 'string' && /"S-1-16-(?:12288|16384)"/u.test(result.stdout), 'LOCAL_OPERATOR_ELEVATION_REQUIRED');
}
