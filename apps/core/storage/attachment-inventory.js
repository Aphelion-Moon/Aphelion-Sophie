import { attachmentFailureCodes, requireAttachmentToken } from '../../../contracts/case-attachment.js';
import { ContractError, requireCondition, requireId } from '../../../contracts/validation.js';

/** Local core operator metadata only. No HTTP route, URLs, filenames, message patches or file bytes. */
export function createAttachmentInventory({ pool, guildId, vault }) {
  requireId(guildId);
  requireCondition(typeof vault?.vaultId === 'string' && /^[a-f0-9]{64}$/.test(vault.vaultId), 'ATTACHMENT_VAULT_INVALID');
  async function retained(token) {
    return (await pool.query(`SELECT j.token, j.status, j.fence, j.retained_slot, j.retained_sha256,
      j.retained_bytes::text, a.vault_id, a.media_type, a.bytes::text AS expected_bytes
      FROM sophie_core.case_attachment_jobs j LEFT JOIN sophie_core.case_attachment_attempts a ON a.slot = j.retained_slot
      WHERE j.guild_id = $1 AND j.token = $2`, [guildId, token])).rows[0];
  }
  return Object.freeze({
    async page(after = null) {
      if (after !== null) requireAttachmentToken(after);
      // One database snapshot: the capacity ledger is vault-wide, job totals are guild-scoped.
      const result = (await pool.query(`WITH page AS (
        SELECT j.token, j.status, j.fence, j.last_error_code, j.retained_slot, j.retained_bytes::text, j.retained_sha256,
          COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.fence) FROM (
            SELECT slot, fence, bytes::text, media_type, vault_id = $3 AS selected_vault
            FROM sophie_core.case_attachment_attempts WHERE job_token = j.token ORDER BY fence LIMIT 4
          ) a), '[]'::jsonb) AS attempts
        FROM sophie_core.case_attachment_jobs j WHERE j.guild_id = $1 AND ($2::text IS NULL OR j.token COLLATE "C" > $2 COLLATE "C")
        ORDER BY j.token COLLATE "C" LIMIT 26
      ) SELECT COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.token COLLATE "C") FROM page p), '[]'::jsonb) AS entries,
        (SELECT count(*)::text FROM sophie_core.case_attachment_jobs WHERE guild_id = $1) AS guild_jobs,
        (SELECT count(*)::text FROM sophie_core.case_attachment_jobs WHERE guild_id = $1 AND status = 'pending') AS guild_pending,
        (SELECT count(*)::text FROM sophie_core.case_attachment_jobs WHERE guild_id = $1 AND status = 'unavailable') AS guild_unavailable,
        COALESCE((SELECT reserved_bytes::text FROM sophie_core.case_attachment_capacity WHERE vault_id = $3), '0') AS reserved_bytes,
        (SELECT COALESCE(sum(bytes),0)::text FROM sophie_core.case_attachment_attempts WHERE vault_id = $3) AS attempt_bytes,
        COALESCE((SELECT paused FROM sophie_core.case_attachment_capacity WHERE vault_id = $3), false) AS paused,
        COALESCE((SELECT until_at > clock_timestamp() FROM sophie_core.case_attachment_capacity WHERE vault_id = $3), false) AS cooling_down`,
      [guildId, after, vault.vaultId])).rows[0];
      const entries = result.entries.slice(0, 25).map(entry => ({ ...entry,
        last_error_code: entry.last_error_code === null ? null : attachmentFailureCodes.includes(entry.last_error_code) ? entry.last_error_code : 'UNRECOGNIZED_CODE',
        integrity: 'not_checked', downloadable: false,
      }));
      return { guildId, vaultId: vault.vaultId, entries, next: result.entries.length > 25 ? entries.at(-1).token : null,
        totals: { jobs: result.guild_jobs, pending: result.guild_pending, unavailable: result.guild_unavailable },
        capacity: { scope: 'whole-vault', reservedBytes: result.reserved_bytes, attemptBytes: result.attempt_bytes,
          accountingMatches: result.reserved_bytes === result.attempt_bytes, paused: result.paused, coolingDown: result.cooling_down },
        filesystemScanned: false, repaired: false };
    },
    async verify(token) {
      requireAttachmentToken(token);
      const row = await retained(token);
      requireCondition(row && row.status === 'retained' && row.vault_id === vault.vaultId && row.expected_bytes === row.retained_bytes,
        'ATTACHMENT_INVENTORY_SELECTION_INVALID');
      let integrity;
      try {
        const proof = await vault.recover(row.retained_slot, { size: Number(row.retained_bytes), type: row.media_type });
        if (proof === null) integrity = 'missing';
        else {
          const file = vault.inspect(proof);
          integrity = file.vaultId === vault.vaultId && file.slot === row.retained_slot && file.bytes === Number(row.retained_bytes) &&
            file.sha256 === row.retained_sha256 ? 'matches' : 'mismatch';
        }
      } catch (error) {
        if (!(error instanceof ContractError) || !['ATTACHMENT_CONTENT_INVALID', 'ATTACHMENT_SIZE_LIMIT', 'ATTACHMENT_STORAGE_UNAVAILABLE'].includes(error.code)) throw error;
        integrity = error.code === 'ATTACHMENT_STORAGE_UNAVAILABLE' ? 'unavailable' : 'mismatch';
      }
      // Never call an old hash result current after its database selection changes.
      if (JSON.stringify(await retained(token)) !== JSON.stringify(row)) integrity = 'changed';
      return { guildId, vaultId: vault.vaultId, token, slot: row.retained_slot, integrity,
        bytes: row.retained_bytes, scanStatus: 'unscanned', downloadable: false, repaired: false };
    },
  });
}
