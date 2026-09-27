import { randomBytes, createHash } from 'node:crypto';
import { attachmentReference, validateAttachmentPolicy, requireAttachmentToken, attachmentFailureCodes } from '../../../contracts/case-attachment.js';
import { requireCondition, requireId, requireInteger, requireKeys, requireName } from '../../../contracts/validation.js';
import { inTransaction } from './transaction.js';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validateClaim(claim) {
  requireKeys(claim, ['token', 'owner', 'fence']); requireAttachmentToken(claim.token); requireName(claim.owner); requireInteger(claim.fence, 1);
}

/** Acquisition state belongs to core, separate from the Discord delivery outbox and case read authorization. */
export function createCaseAttachments({ pool, guildId, vault, readPolicy, enabled }) {
  requireId(guildId);
  requireCondition(/^[a-f0-9]{64}$/.test(vault?.vaultId) && typeof vault.inspect === 'function' &&
    typeof readPolicy === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function policy(expected = null) {
    requireCondition(await enabled() === true, 'ATTACHMENT_POLICY_DISABLED');
    const value = await readPolicy(); requireCondition(value !== null, 'ATTACHMENT_POLICY_DISABLED');
    const fixed = structuredClone(value); validateAttachmentPolicy(fixed); fixed.allowedTypes.sort();
    const hash = digest(fixed); requireCondition(expected === null || expected === hash, 'ATTACHMENT_POLICY_DISABLED');
    return { value: fixed, hash };
  }
  async function locked(client, claim) {
    validateClaim(claim);
    const row = (await client.query(`SELECT * FROM sophie_core.case_attachment_jobs WHERE token = $1 AND guild_id = $4
      AND status = 'leased' AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp() FOR UPDATE`,
    [claim.token, claim.owner, claim.fence, guildId])).rows[0];
    requireCondition(row !== undefined, 'ATTACHMENT_LEASE_LOST'); return row;
  }
  async function source(client, row) {
    const record = (await client.query(`SELECT channel_id, patch->'attachments'->$5::integer AS attachment FROM sophie_core.case_message_observations
      WHERE guild_id = $1 AND continuity_epoch = $2 AND sequence = $3 AND message_id = $4`,
    [guildId, row.continuity_epoch, row.sequence, row.message_id, row.ordinal])).rows[0];
    requireCondition(record !== undefined, 'ATTACHMENT_REFERENCE_INVALID');
    return { channelId: record.channel_id, ordinal: row.ordinal, attachment: record.attachment };
  }
  async function available(client) {
    const row = (await client.query('SELECT NOT paused AND until_at <= clock_timestamp() AS ready FROM sophie_core.case_attachment_capacity WHERE vault_id = $1', [vault.vaultId])).rows[0];
    return row === undefined || row.ready;
  }
  return Object.freeze({
    async canRun() { try { await policy(); return true; } catch { return false; } },
    async claim(owner) {
      requireName(owner); await policy();
      return inTransaction(pool, async client => {
        if (!await available(client)) return null;
        const row = (await client.query(`WITH candidate AS (SELECT token FROM sophie_core.case_attachment_jobs
          WHERE guild_id = $1 AND ((status = 'pending' AND available_at <= clock_timestamp()) OR (status = 'leased' AND lease_until <= clock_timestamp()))
          ORDER BY available_at, token LIMIT 1 FOR UPDATE SKIP LOCKED)
          UPDATE sophie_core.case_attachment_jobs j SET status = 'leased', lease_owner = $2,
            lease_until = clock_timestamp() + interval '60 seconds', fence = fence + 1
          FROM candidate c WHERE j.token = c.token RETURNING j.token, j.fence`, [guildId, owner])).rows[0];
        return row ? { token: row.token, fence: row.fence, owner } : null;
      });
    },
    async prepare(claim) {
      const current = await policy();
      return inTransaction(pool, async client => {
        const row = await locked(client, claim), record = await source(client, row), reference = attachmentReference(record, current.value);
        const attempts = (await client.query(`SELECT slot, bytes, media_type, source_hash FROM sophie_core.case_attachment_attempts
          WHERE job_token = $1 AND vault_id = $2 ORDER BY fence DESC`, [claim.token, vault.vaultId])).rows;
        return { reference, sourceHash: digest(record), policy: current.value, policyHash: current.hash, attempts };
      });
    },
    async check(claim, policyHash) {
      await policy(policyHash);
      return inTransaction(pool, async client => { await locked(client, claim); requireCondition(await available(client), 'ATTACHMENT_RATE_LIMITED'); });
    },
    /** A server pause remains authoritative even when the reporting job lease has expired. */
    async defer(retryAfterMs) {
      requireInteger(retryAfterMs, 1, 86400000);
      await pool.query(`INSERT INTO sophie_core.case_attachment_capacity (vault_id, until_at)
        VALUES ($1, clock_timestamp() + $2 * interval '1 millisecond') ON CONFLICT (vault_id) DO UPDATE
        SET until_at = GREATEST(sophie_core.case_attachment_capacity.until_at, EXCLUDED.until_at)`, [vault.vaultId, retryAfterMs]);
    },
    async pause() {
      await pool.query(`INSERT INTO sophie_core.case_attachment_capacity (vault_id, paused) VALUES ($1, true)
        ON CONFLICT (vault_id) DO UPDATE SET paused = true`, [vault.vaultId]);
    },
    async reserve(claim, prepared) {
      const current = await policy(prepared.policyHash);
      return inTransaction(pool, async client => {
        const row = await locked(client, claim), record = await source(client, row), reference = attachmentReference(record, current.value);
        requireCondition(digest(record) === prepared.sourceHash, 'ATTACHMENT_REFERENCE_INVALID');
        const attempts = (await client.query('SELECT count(*)::integer AS count FROM sophie_core.case_attachment_attempts WHERE job_token = $1', [claim.token])).rows[0].count;
        requireCondition(attempts < 3, 'ATTACHMENT_ATTEMPT_LIMIT');
        await client.query('INSERT INTO sophie_core.case_attachment_capacity (vault_id) VALUES ($1) ON CONFLICT DO NOTHING', [vault.vaultId]);
        const capacity = await client.query(`UPDATE sophie_core.case_attachment_capacity SET reserved_bytes = reserved_bytes + $2
          WHERE vault_id = $1 AND reserved_bytes + $2 <= $3 RETURNING vault_id`, [vault.vaultId, reference.size, current.value.maxStoredBytes]);
        requireCondition(capacity.rowCount === 1, 'ATTACHMENT_CAPACITY_LIMIT');
        const slot = randomBytes(24).toString('hex');
        await client.query(`INSERT INTO sophie_core.case_attachment_attempts
          (slot, job_token, vault_id, fence, bytes, media_type, policy_hash, source_hash, policy) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [slot, claim.token, vault.vaultId, claim.fence, reference.size, reference.type, current.hash, prepared.sourceHash, current.value]);
        await locked(client, claim); return slot;
      });
    },
    async complete(claim, prepared, proof) {
      const current = await policy(prepared.policyHash), file = vault.inspect(proof);
      return inTransaction(pool, async client => {
        const row = await locked(client, claim), record = await source(client, row), reference = attachmentReference(record, current.value);
        requireCondition(digest(record) === prepared.sourceHash && file.vaultId === vault.vaultId && file.bytes === reference.size, 'UNTRUSTED_ATTACHMENT_FILE');
        const attempt = (await client.query(`SELECT 1 FROM sophie_core.case_attachment_attempts WHERE slot = $1 AND job_token = $2
          AND vault_id = $3 AND bytes = $4 AND media_type = $5 AND source_hash = $6`,
        [file.slot, claim.token, vault.vaultId, file.bytes, reference.type, prepared.sourceHash])).rowCount;
        requireCondition(attempt === 1, 'UNTRUSTED_ATTACHMENT_FILE');
        const saved = await client.query(`UPDATE sophie_core.case_attachment_jobs SET status = 'retained', lease_owner = NULL, lease_until = NULL,
          retained_slot = $4, retained_sha256 = $5, retained_bytes = $6, retained_at = clock_timestamp(), last_error_code = NULL
          WHERE token = $1 AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp()`,
        [claim.token, claim.owner, claim.fence, file.slot, file.sha256, file.bytes]);
        requireCondition(saved.rowCount === 1, 'ATTACHMENT_LEASE_LOST');
        await policy(prepared.policyHash);
      });
    },
    async failed(claim, code) {
      requireCondition(attachmentFailureCodes.includes(code), 'ATTACHMENT_FAILURE_INVALID');
      return inTransaction(pool, async client => {
        await locked(client, claim);
        const retry = ['ATTACHMENT_NETWORK_UNAVAILABLE', 'ATTACHMENT_STORAGE_UNAVAILABLE', 'ATTACHMENT_RATE_LIMITED'].includes(code);
        const saved = await client.query(`UPDATE sophie_core.case_attachment_jobs SET status = $4, lease_owner = NULL, lease_until = NULL,
          last_error_code = $5, available_at = GREATEST(clock_timestamp() + interval '5 seconds',
            (SELECT until_at FROM sophie_core.case_attachment_capacity WHERE vault_id = $6))
          WHERE token = $1 AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp()`,
        [claim.token, claim.owner, claim.fence, retry ? 'pending' : 'unavailable', code, vault.vaultId]);
        requireCondition(saved.rowCount === 1, 'ATTACHMENT_LEASE_LOST');
        return retry ? 'pending' : 'unavailable';
      });
    },
    async result(token) {
      requireAttachmentToken(token);
      return (await pool.query('SELECT status FROM sophie_core.case_attachment_jobs WHERE token = $1 AND guild_id = $2', [token, guildId])).rows[0]?.status;
    },
  });
}
