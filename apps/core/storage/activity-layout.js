import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireName } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { ACTIVITY_STOP_SCENES } from '../../../modules/onboarding/activity.js';
import { canonicalActivityLayout, effectiveLayout, emptyActivityLayout } from '../../../modules/onboarding/activity-layout.js';
import { headingKey } from '../../../modules/onboarding/activity-media.js';
import { canonicalPublication } from '../../../modules/onboarding/screens.js';
import { inTransaction } from './transaction.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const headings = body => [...body.matchAll(/^(#{1,3}) (.+)$/gm)].map(match => ({ level: match[1].length, text: match[2] }));

/** The latest published layout document for a server, or null. Caller supplies the transaction. */
export async function readPublishedActivityLayout(client, guildId) {
  const row = (await client.query(`SELECT version, document, sha256 FROM sophie_core.activity_layouts WHERE guild_id = $1
    ORDER BY version DESC LIMIT 1`, [guildId])).rows[0];
  if (!row) return null;
  const document = canonicalActivityLayout(row.document);
  requireCondition(digest(document) === row.sha256, 'ACTIVITY_LAYOUT_CORRUPT');
  return { version: row.version, document };
}

/**
 * The Activity layout editor's use cases (P44): read the published layout with what the editor needs to choose from,
 * and publish a new version. Guidance publishers only (shuttle.publish), checked before and after each operation.
 * sceneBeats lists each scene's beats; viewscreens the known viewscreen ids; defaults the default moments.
 */
export function createActivityLayoutStore({ pool, authorize, guildId, definitionId, defaults, sceneBeats, viewscreens }) {
  requireId(guildId); requireName(definitionId);
  requireCondition(typeof authorize === 'function' && viewscreens instanceof Map && sceneBeats instanceof Map, 'TRUSTED_ADAPTERS_REQUIRED');
  const access = async actor => {
    requireCondition(await authorize('shuttle.publish', actor, { guildId, definitionId }) === true, 'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId, 'FOREIGN_GUILD'); return grant;
  };
  async function currentStages(client) {
    const row = (await client.query(`SELECT p.publication FROM sophie_core.definitions d JOIN sophie_core.shuttle_publications p
      ON p.definition_id = d.id AND p.definition_version = d.version WHERE d.id = $1 AND d.definition->>'status' = 'published'
      ORDER BY d.version DESC LIMIT 1`, [definitionId])).rows[0];
    return row ? canonicalPublication(row.publication).stages : [];
  }
  /** Beats must belong to the scene the stop will use; viewscreens must exist; stages must be published ones. */
  function requireConsistent(document, stages) {
    const ids = new Set(stages.map(stage => stage.id));
    requireCondition(Object.keys(document.stops).every(id => ids.has(id)), 'ACTIVITY_LAYOUT_UNKNOWN_STOP');
    if (!stages.length) return;
    const layout = effectiveLayout({ stages, defaults, layout: document });
    for (const stop of layout.stops) {
      const beats = sceneBeats.get(stop.scene) ?? [];
      const own = document.stops[stop.id]?.moments ?? {};
      for (const moment of Object.values(own)) requireCondition(moment.beat === 'none' || beats.includes(moment.beat), 'ACTIVITY_LAYOUT_UNKNOWN_BEAT');
    }
  }
  return Object.freeze({
    async readActivityLayout({ actor }) {
      return inTransaction(pool, async client => {
        await access(actor);
        const published = await readPublishedActivityLayout(client, guildId), stages = await currentStages(client);
        const result = {
          version: published?.version ?? 0, document: published?.document ?? emptyActivityLayout(),
          stages: stages.map((stage, index) => ({ id: stage.id, title: stage.title,
            headings: headings(stage.screens?.join('\n\n') ?? stage.body).map(item => ({ level: item.level, text: item.text, key: headingKey(item.text) })),
            defaultScene: effectiveLayout({ stages, defaults }).stops[index].scene })),
          scenes: ACTIVITY_STOP_SCENES.map(id => ({ id, beats: sceneBeats.get(id) ?? [] })),
          viewscreens: [...viewscreens.entries()].map(([id, title]) => ({ id, title })),
          defaults: defaults ?? { schema: 1, stages: {} },
        };
        await access(actor);
        return result;
      });
    },
    async publishActivityLayout({ actor, requestId, expectedVersion, document }) {
      requireCondition(typeof requestId === 'string' && /^[a-f0-9]{64}$/.test(requestId), 'ACTIVITY_LAYOUT_INPUT_INVALID');
      requireInteger(expectedVersion, 0, 2_147_483_647);
      const canonical = canonicalActivityLayout(document, { viewscreens: new Set(viewscreens.keys()) });
      return inTransaction(pool, async client => {
        const grant = await access(actor);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`activity-layout:${guildId}`]);
        const previous = (await client.query('SELECT version, sha256 FROM sophie_core.activity_layouts WHERE guild_id = $1 AND request_id = $2',
          [guildId, requestId])).rows[0];
        if (previous) { requireCondition(previous.sha256 === digest(canonical), 'ACTIVITY_LAYOUT_REQUEST_REUSED'); return { version: previous.version, sha256: previous.sha256, duplicate: true }; }
        const latest = (await client.query('SELECT coalesce(max(version), 0)::integer AS version FROM sophie_core.activity_layouts WHERE guild_id = $1', [guildId])).rows[0].version;
        requireCondition(latest === expectedVersion, 'ACTIVITY_LAYOUT_CHANGED');
        requireConsistent(canonical, await currentStages(client));
        const sha256 = digest(canonical);
        await client.query(`INSERT INTO sophie_core.activity_layouts (guild_id, version, document, sha256, request_id, operator_grant)
          VALUES ($1, $2, $3, $4, $5, $6)`, [guildId, latest + 1, canonical, sha256, requestId, grant]);
        await access(actor);
        return { version: latest + 1, sha256, duplicate: false };
      });
    },
  });
}
