import { requireCondition, requireId } from '../../../contracts/validation.js';
import { requireGames, requireModerationRow } from '../../../modules/member-records/index.js';

export { createCentralIdentityPool } from './pool.js';

const CHARACTERS_KEPT = 200;

/** One server as identity.member_game_records gives it, in the shape the games message renders. */
function serverOf(item) {
  const linkedAtMs = typeof item?.linked_at === 'string' ? Date.parse(item.linked_at) : NaN;
  return {
    kind: item?.kind, server: typeof item?.server === 'string' ? item.server : null, accountId: String(item?.account_id ?? ''),
    displayName: typeof item?.display_name === 'string' ? item.display_name : null, linkedAtMs: Number.isSafeInteger(linkedAtMs) ? linkedAtMs : null,
    conflict: item?.conflict === true,
    characters: (Array.isArray(item?.characters) ? item.characters : []).slice(0, CHARACTERS_KEPT)
      .filter(character => typeof character?.name === 'string' && character.name.trim())
      .map(character => ({ slot: Number(character.slot), name: character.name, selected: character.selected === true })),
  };
}

/**
 * Sophie's reader of the central identity database (C:\Aphelion\Central, docs/decisions/0006-central-identity.md):
 * Symphony's account links and the game servers' character names, which she reads and never writes.
 */
export function createCentralIdentity({ pool }) {
  requireCondition(typeof pool?.query === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  return Object.freeze({
    /** Every Discord member linked on a live server: Discord ID to `{ status: 'linked', servers }`. */
    async readGameRecords() {
      const rows = (await pool.query('SELECT discord_id::text AS discord_id, servers FROM identity.member_game_records')).rows;
      requireCondition(rows.length <= 100_000, 'CENTRAL_IDENTITY_RESPONSE_INVALID');
      const byUser = new Map();
      for (const row of rows) {
        requireId(row.discord_id);
        byUser.set(row.discord_id, requireGames({ status: 'linked', servers: (Array.isArray(row.servers) ? row.servers : []).map(serverOf) }));
      }
      return byUser;
    },
    /**
     * Every game moderation record (ban, note, admin help ticket) of a live server, once for each Discord member linked to
     * its account (docs/decisions/0006-central-identity.md, amendment of 2 November 2026), as `requireModerationRow` reads it.
     */
    async readModerationRecords() {
      const rows = (await pool.query(`SELECT discord_id::text AS discord_id, server_id, kind, source_key, record_kind,
          (extract(epoch FROM occurred_at) * 1000)::bigint::text AS occurred_at_ms, final, revision, detail, present
        FROM identity.member_moderation ORDER BY occurred_at NULLS FIRST, server_id, source_key`)).rows;
      requireCondition(rows.length <= 100_000, 'CENTRAL_IDENTITY_RESPONSE_INVALID');
      return rows.map(row => requireModerationRow({ discordId: row.discord_id, serverId: row.server_id, game: row.kind, sourceKey: row.source_key,
        recordKind: row.record_kind, occurredAtMs: row.occurred_at_ms === null ? null : Number(row.occurred_at_ms), final: row.final, revision: row.revision,
        detail: row.detail, present: row.present }));
    },
  });
}
