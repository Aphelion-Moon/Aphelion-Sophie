import { createHash } from 'node:crypto';
import { requireCondition, requireId, requireInteger, requireName } from '../../../contracts/validation.js';
import { validateGatewayLease, validateGatewaySession, validateGatewayUrl, validateGatewayChange } from '../../../contracts/gateway.js';
import { invalidateMembership } from '../../../modules/membership/index.js';
import { validateRoleMapping } from '../../../modules/membership/discord-policy.js';
import { inTransaction } from './transaction.js';
import { lockMember, saveMember } from './members.js';
import { enqueue } from './outbox.js';
import { recordCaseConversation } from './case-conversations.js';
import { recordCaseCaptureGap, closeCaseCaptureGap, markCaseCapturePermissions } from './case-capture-coverage.js';

export const gatewayMappingHash = mapping => createHash('sha256').update(JSON.stringify([mapping.guildId,mapping.botUserId,mapping.crew,
  mapping.muzzled,mapping.whitelist,mapping.staff,mapping.leadOps,[...mapping.externallyOwnedRoleIds].sort()])).digest('hex');

/** Ordered metadata/revocations and a separate optional core case-content sink share one cursor commit. */
export function createGatewayJournal({ pool, mapping, clock, caseCapture = null, automation = null }) {
  validateRoleMapping(mapping); requireCondition(typeof clock === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(caseCapture === null || (caseCapture.guildId === mapping.guildId &&
    ['prepare', 'inspect', 'content', 'discard'].every(key => typeof caseCapture[key] === 'function')), 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(automation === null || (automation.guildId === mapping.guildId &&
    ['prepare','record','discard'].every(key=>typeof automation[key] === 'function')), 'TRUSTED_ADAPTERS_REQUIRED');
  const fixed = structuredClone(mapping);
  const mappingHash = gatewayMappingHash(fixed);
  async function locked(client, lease) {
    validateGatewayLease(lease); requireCondition(lease.guildId === fixed.guildId, 'FOREIGN_GUILD');
    const row = (await client.query(`SELECT * FROM sophie_core.gateway_lifecycle WHERE guild_id = $1
      AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp() FOR UPDATE`,
    [lease.guildId, lease.owner, lease.fence])).rows[0];
    requireCondition(row !== undefined, 'GATEWAY_LEASE_LOST');
    requireCondition(row.mapping_hash === mappingHash, 'GATEWAY_CONFIGURATION_CHANGED');
    requireCondition(row.capture_enabled === (caseCapture !== null), 'GATEWAY_CAPTURE_MODE_CHANGED');
    requireCondition(row.automation_enabled === (automation !== null),'GATEWAY_AUTOMATION_MODE_CHANGED');
    return row;
  }
  async function advance(client, lease, sequence, status, available) {
    const result = await client.query(`UPDATE sophie_core.gateway_lifecycle SET sequence = $4, status = $5,
      guild_available = $6 WHERE guild_id = $1 AND lease_owner = $2 AND fence = $3 AND lease_until > clock_timestamp()`,
    [lease.guildId, lease.owner, lease.fence, sequence, status, available]);
    requireCondition(result.rowCount === 1, 'GATEWAY_LEASE_LOST');
  }
  async function invalidateAll(client, presence) {
    const rows = (await client.query('SELECT state FROM sophie_core.members WHERE guild_id = $1 ORDER BY user_id FOR UPDATE', [fixed.guildId])).rows;
    for (const { state } of rows) await saveMember(client, invalidateMembership(state, { eligibility: true, access: true, presence }));
  }
  async function caseInspections(client, { userId = null, channelId = null, source }) {
    const rows = (await client.query(`SELECT r.id, r.user_id, r.type FROM sophie_core.case_reservations r
      JOIN sophie_core.case_provisions p ON p.case_id = r.id WHERE r.guild_id = $1 AND p.create_started
        AND ($2::text IS NULL OR r.user_id = $2 OR EXISTS (SELECT 1 FROM sophie_core.case_participants i
          WHERE i.guild_id = r.guild_id AND i.case_id = r.id AND i.user_id = $2 AND i.status IN ('pending', 'active'))) AND ($3::text IS NULL OR EXISTS (
          SELECT 1 FROM sophie_core.case_channels c WHERE c.guild_id = r.guild_id AND c.case_id = r.id AND c.channel_id = $3))
        ORDER BY r.id`, [fixed.guildId, userId, channelId])).rows;
    for (const row of rows) {
      const suffix = createHash('sha256').update(JSON.stringify([source, row.id])).digest('hex');
      await enqueue(client, { kind: 'case.provision', guildId: fixed.guildId, userId: row.user_id,
        operationId: `case.gateway.${suffix}`, caseId: row.id, type: row.type });
    }
  }
  return Object.freeze({
    messageIntents: caseCapture === null && automation === null ? 0 : 33280,
    prepareCaseMessage: payload => caseCapture?.prepare(payload) ?? null,
    prepareAutomationMessage: payload => automation?.prepare(payload) ?? null,
    async acquire(owner) {
      requireName(owner);
      return inTransaction(pool, async client => {
        const inserted = await client.query(`INSERT INTO sophie_core.gateway_lifecycle (guild_id, lease_owner, fence, lease_until, status, mapping_hash)
          VALUES ($1, $2, 1, '-infinity', 'offline', $3) ON CONFLICT DO NOTHING`, [fixed.guildId, owner, mappingHash]);
        const row = (await client.query(`SELECT *, lease_until > clock_timestamp() AS active
          FROM sophie_core.gateway_lifecycle WHERE guild_id = $1 FOR UPDATE`, [fixed.guildId])).rows[0];
        requireCondition(!row.active, 'GATEWAY_OWNER_ACTIVE');
        requireCondition(row.mapping_hash === mappingHash, 'GATEWAY_CONFIGURATION_CHANGED');
        const fence = row.fence + (inserted.rowCount ? 0 : 1); requireInteger(fence, 1);
        const changedCapture = row.capture_enabled !== (caseCapture !== null) || row.automation_enabled !== (automation !== null);
        await recordCaseCaptureGap(client, { guildId: fixed.guildId, from: row.capture_observed_at_ms === null ? null : Number(row.capture_observed_at_ms),
          reason: caseCapture === null ? 'capture-disabled' : 'gateway-owner-acquired' });
        await client.query(`UPDATE sophie_core.gateway_lifecycle SET lease_owner = $2, fence = $3,
          lease_until = clock_timestamp() + interval '30 seconds', status = 'offline', capture_enabled = $4, automation_enabled = $6,
          session_id = CASE WHEN $5 THEN NULL ELSE session_id END, resume_url = CASE WHEN $5 THEN NULL ELSE resume_url END,
          sequence = CASE WHEN $5 THEN NULL ELSE sequence END WHERE guild_id = $1`, [fixed.guildId, owner, fence, caseCapture !== null, changedCapture, automation !== null]);
        let resume = null;
        if (row.session_id !== null && !changedCapture) {
          validateGatewaySession(row.session_id); validateGatewayUrl(row.resume_url); requireInteger(Number(row.sequence));
          resume = { sessionId: row.session_id, resumeUrl: row.resume_url, sequence: Number(row.sequence) };
        }
        return { lease: { guildId: fixed.guildId, owner, fence }, resume };
      });
    },
    async renew(lease) {
      return inTransaction(pool, async client => {
        await locked(client, lease);
        const result = await client.query(`UPDATE sophie_core.gateway_lifecycle SET lease_until = clock_timestamp() + interval '30 seconds'
          WHERE guild_id = $1 AND lease_until > clock_timestamp()`, [fixed.guildId]);
        requireCondition(result.rowCount === 1, 'GATEWAY_LEASE_LOST');
      });
    },
    async pause(lease, code) {
      requireCondition(['DISCONNECTED', 'HEARTBEAT_MISSED', 'QUEUE_LIMIT', 'PROCESSING_FAILED', 'STOPPED'].includes(code), 'INVALID_GATEWAY_PAUSE');
      return inTransaction(pool, async client => {
        const row = await locked(client, lease);
        await recordCaseCaptureGap(client, { guildId: fixed.guildId, from: row.capture_observed_at_ms === null ? null : Number(row.capture_observed_at_ms), reason: 'gateway-disconnected' });
        await client.query("UPDATE sophie_core.gateway_lifecycle SET status = 'offline', last_error_code = $2 WHERE guild_id = $1", [fixed.guildId, code]);
        await locked(client, lease);
      });
    },
    async reserveIdentify(lease) {
      return inTransaction(pool, async client => {
        const row = await locked(client, lease);
        requireCondition(row.status === 'identifying', 'GATEWAY_STATE_CONFLICT');
        const budget = (await client.query(`SELECT
          identify_window_started_at IS NULL OR identify_window_started_at + interval '24 hours' <= clock_timestamp() AS expired,
          greatest(0, CASE WHEN identify_not_before > clock_timestamp() THEN
            ceil(extract(epoch FROM (identify_not_before - clock_timestamp())) * 1000) ELSE 0 END,
            CASE WHEN identify_attempts >= 20 THEN ceil(extract(epoch FROM
              (identify_window_started_at + interval '24 hours' - clock_timestamp())) * 1000) ELSE 0 END) AS wait_ms
          FROM sophie_core.gateway_lifecycle WHERE guild_id = $1`, [fixed.guildId])).rows[0];
        const waitMs = Number(budget.wait_ms); requireInteger(waitMs, 0, 86_400_000);
        if (waitMs > 0) return { waitMs };
        await client.query(`UPDATE sophie_core.gateway_lifecycle SET
          identify_window_started_at = CASE WHEN $2 THEN clock_timestamp() ELSE identify_window_started_at END,
          identify_attempts = CASE WHEN $2 THEN 1 ELSE identify_attempts + 1 END,
          identify_not_before = clock_timestamp() + interval '6 seconds' WHERE guild_id = $1`, [fixed.guildId, budget.expired]);
        await locked(client, lease);
        return { waitMs: 0 };
      });
    },
    async identify(lease) {
      return inTransaction(pool, async client => {
        const row = await locked(client, lease);
        requireCondition(['offline', 'resuming'].includes(row.status), 'GATEWAY_STATE_CONFLICT');
        await recordCaseCaptureGap(client, { guildId: fixed.guildId, from: row.capture_observed_at_ms === null ? null : Number(row.capture_observed_at_ms), reason: 'gateway-session-reset' });
        const epoch = Number(row.continuity_epoch) + 1; requireInteger(epoch, 1);
        await invalidateAll(client, true);
        await client.query('UPDATE sophie_core.actor_authority SET capability_epoch = capability_epoch + 1, presence_epoch = presence_epoch + 1 WHERE guild_id = $1', [fixed.guildId]);
        await client.query(`UPDATE sophie_core.gateway_lifecycle SET continuity_epoch = $2, status = 'identifying',
          session_id = NULL, resume_url = NULL, sequence = NULL, guild_available = false, last_error_code = NULL WHERE guild_id = $1`, [fixed.guildId, epoch]);
        await caseInspections(client, { source: `epoch.${epoch}` });
        await locked(client, lease);
        return { continuityEpoch: epoch };
      });
    },
    async resume(lease) {
      return inTransaction(pool, async client => {
        const row = await locked(client, lease);
        requireCondition(row.status === 'offline' && row.session_id !== null, 'GATEWAY_STATE_CONFLICT');
        validateGatewaySession(row.session_id); validateGatewayUrl(row.resume_url); requireInteger(Number(row.sequence));
        await client.query("UPDATE sophie_core.gateway_lifecycle SET status = 'resuming' WHERE guild_id = $1", [fixed.guildId]);
        await locked(client, lease);
        return { sessionId: row.session_id, resumeUrl: row.resume_url, sequence: Number(row.sequence) };
      });
    },
    async ready(lease, { sessionId, resumeUrl, sequence }) {
      validateGatewaySession(sessionId); validateGatewayUrl(resumeUrl); requireInteger(sequence);
      return inTransaction(pool, async client => {
        const row = await locked(client, lease);
        requireCondition(row.status === 'identifying' && row.session_id === null, 'GATEWAY_STATE_CONFLICT');
        await client.query(`UPDATE sophie_core.gateway_lifecycle SET session_id = $2, resume_url = $3, sequence = $4,
          status = 'synchronizing' WHERE guild_id = $1`, [fixed.guildId, sessionId, resumeUrl, sequence]);
        await locked(client, lease);
      });
    },
    async dispatch(lease, { sessionId, sequence, change, caseMessage = null, automationMessage = null }) {
      validateGatewaySession(sessionId); requireInteger(sequence); validateGatewayChange(change);
      requireCondition(caseMessage === null || caseCapture !== null, 'CASE_CAPTURE_DISABLED');
      requireCondition(automationMessage === null || automation !== null,'AUTOMATION_DISABLED');
      const normalized = structuredClone(change);
      if (normalized.kind === 'member') normalized.roleIds.sort();
      return inTransaction(pool, async client => {
        const row = await locked(client, lease);
        requireCondition(row.session_id === sessionId && ['synchronizing', 'resuming', 'current'].includes(row.status), 'GATEWAY_STATE_CONFLICT');
        if (sequence <= Number(row.sequence)) return { duplicate: true };
        if (['member', 'authority', 'role', 'channel', 'guild'].includes(normalized.kind)) await client.query(
          'UPDATE sophie_core.gateway_lifecycle SET ai_boundary_epoch=ai_boundary_epoch+1 WHERE guild_id=$1', [fixed.guildId]);
        const observedAt = clock(); requireInteger(observedAt);
        if (sequence > Number(row.sequence) + 1) await recordCaseCaptureGap(client, { guildId: fixed.guildId,
          from: row.capture_observed_at_ms === null ? null : Math.min(Number(row.capture_observed_at_ms), observedAt), to: observedAt,
          reason: 'gateway-sequence-gap', recovery: 'observed' });
        await recordCaseConversation(client, { capture: caseCapture, proof: caseMessage, guildId: fixed.guildId,
          epoch: Number(row.continuity_epoch), sequence });
        if (automationMessage !== null && row.status === 'current' && row.guild_available) await automation.record(client,
          {proof:automationMessage,epoch:Number(row.continuity_epoch),sequence});
        let available = row.guild_available;
        if (normalized.kind === 'member') {
          const member = await lockMember(client, fixed.guildId, normalized.userId);
          const stored = (await client.query(`SELECT state FROM sophie_core.gateway_members
            WHERE guild_id = $1 AND user_id = $2 AND continuity_epoch = $3`, [fixed.guildId, normalized.userId, row.continuity_epoch])).rows[0]?.state;
          const previous = stored ?? { present: member.observation?.present ?? false,
            roleIds: member.observation?.whitelist ? [fixed.whitelist] : [],
            timedOut: false, bot: false };
          const departed = previous.present && !normalized.present;
          const lost = departed || (previous.roleIds.includes(fixed.whitelist) && !normalized.roleIds.includes(fixed.whitelist));
          const access = lost || previous.roleIds.includes(fixed.muzzled) !== normalized.roleIds.includes(fixed.muzzled) || previous.timedOut !== normalized.timedOut;
          const next = invalidateMembership(member, { eligibility: lost, access, presence: departed });
          await saveMember(client, next);
          const changed = JSON.stringify([previous.present, previous.roleIds, previous.timedOut, previous.bot]) !==
            JSON.stringify([normalized.present, normalized.roleIds, normalized.timedOut, normalized.bot]);
          // Authority observations can exist before the member journal has seen this identity.
          if (changed || !normalized.present || normalized.bot) await client.query('UPDATE sophie_core.actor_authority SET capability_epoch = capability_epoch + 1 WHERE guild_id = $1 AND user_id = $2', [fixed.guildId, normalized.userId]);
          if (!normalized.present || normalized.bot) await client.query('UPDATE sophie_core.actor_authority SET presence_epoch = presence_epoch + 1 WHERE guild_id = $1 AND user_id = $2', [fixed.guildId, normalized.userId]);
          await client.query(`INSERT INTO sophie_core.gateway_members (guild_id, user_id, continuity_epoch, state) VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id, user_id) DO UPDATE SET continuity_epoch = EXCLUDED.continuity_epoch, state = EXCLUDED.state`,
          [fixed.guildId, normalized.userId, row.continuity_epoch, normalized]);
          if (!normalized.bot && normalized.userId !== fixed.botUserId) {
            const pending = await client.query(`SELECT 1 FROM sophie_core.outbox WHERE guild_id = $1 AND user_id = $2
              AND kind = 'member.reconcile' AND status IN ('ready', 'leased', 'parked') LIMIT 1`, [fixed.guildId, normalized.userId]);
            if (!pending.rowCount) await enqueue(client, { kind: 'member.reconcile', guildId: fixed.guildId, userId: normalized.userId,
              operationId: `member.${normalized.userId}.gateway.${row.continuity_epoch}.${sequence}`, actionRevision: null });
          }
          if (!normalized.present || normalized.bot) await caseInspections(client, { userId: normalized.userId, source: `event.${row.continuity_epoch}.${sequence}` });
          if (normalized.userId === fixed.botUserId) await markCaseCapturePermissions(client, fixed.guildId, { from: observedAt });
        }
        if (['authority', 'role'].includes(normalized.kind)) {
          await markCaseCapturePermissions(client, fixed.guildId, { from: observedAt });
          if (normalized.kind === 'role' && normalized.deleted) {
            if (normalized.roleId === fixed.whitelist) await invalidateAll(client, false);
            if (['crew', 'muzzled', 'whitelist', 'staff', 'leadOps'].some(key => fixed[key] === normalized.roleId)) available = false;
          }
          await client.query('UPDATE sophie_core.actor_authority SET capability_epoch = capability_epoch + 1 WHERE guild_id = $1', [fixed.guildId]);
          await caseInspections(client, { source: `event.${row.continuity_epoch}.${sequence}` });
        }
        if (normalized.kind === 'channel') {
          await markCaseCapturePermissions(client, fixed.guildId, { channelId: normalized.channelId, from: observedAt, reason: 'channel-change' });
          if (normalized.parentId !== null) await client.query(`INSERT INTO sophie_core.case_exclusions (guild_id, channel_id, parent_id)
            SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM sophie_core.case_exclusions WHERE guild_id = $1 AND channel_id = $3)
            ON CONFLICT DO NOTHING`, [fixed.guildId, normalized.channelId, normalized.parentId]);
          await caseInspections(client, { channelId: normalized.channelId, source: `event.${row.continuity_epoch}.${sequence}` });
        }
        if (normalized.kind === 'guild') {
          available = normalized.available;
          if (!available) await recordCaseCaptureGap(client, { guildId: fixed.guildId,
            from: row.capture_observed_at_ms === null ? null : Number(row.capture_observed_at_ms), reason: 'guild-unavailable' });
          if (row.guild_available && !available) {
            await invalidateAll(client, true);
            await client.query('UPDATE sophie_core.actor_authority SET capability_epoch = capability_epoch + 1, presence_epoch = presence_epoch + 1 WHERE guild_id = $1', [fixed.guildId]);
            await client.query('UPDATE sophie_core.gateway_lifecycle SET continuity_epoch = continuity_epoch + 1 WHERE guild_id = $1', [fixed.guildId]);
            await caseInspections(client, { source: `unavailable.${row.continuity_epoch}.${sequence}` });
          }
        }
        if (normalized.kind === 'resumed') requireCondition(row.status === 'resuming', 'GATEWAY_STATE_CONFLICT');
        const status = row.status === 'resuming' && normalized.kind !== 'resumed' ? 'resuming' : available ? 'current' : 'synchronizing';
        if (caseCapture !== null && status === 'current') await closeCaseCaptureGap(client, { guildId: fixed.guildId, at: observedAt,
          recovery: normalized.kind === 'resumed' ? 'resumed' : 'identified' });
        await client.query('UPDATE sophie_core.gateway_lifecycle SET capture_observed_at_ms = $2 WHERE guild_id = $1', [fixed.guildId, observedAt]);
        await advance(client, lease, sequence, status, available);
        return { duplicate: false };
      }).finally(() => {
        if (caseMessage !== null) caseCapture.discard(caseMessage);
        if (automationMessage !== null) automation.discard(automationMessage);
      });
    },
    async readContinuity(lease) {
      validateGatewayLease(lease); requireCondition(lease.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const row = (await pool.query(`SELECT continuity_epoch, sequence FROM sophie_core.gateway_lifecycle
        WHERE guild_id = $1 AND lease_owner = $2 AND fence = $3 AND mapping_hash = $4
          AND status = 'current' AND lease_until > clock_timestamp()`,
      [lease.guildId, lease.owner, lease.fence, mappingHash])).rows[0];
      return row ? `${lease.owner}.${lease.fence}.${row.continuity_epoch}.${row.sequence}` : null;
    },
    async readAiContinuity(lease) {
      validateGatewayLease(lease); requireCondition(lease.guildId === fixed.guildId, 'FOREIGN_GUILD');
      const row = (await pool.query(`SELECT continuity_epoch,ai_boundary_epoch FROM sophie_core.gateway_lifecycle
        WHERE guild_id=$1 AND lease_owner=$2 AND fence=$3 AND mapping_hash=$4 AND guild_available
          AND status='current' AND lease_until>clock_timestamp()`, [lease.guildId,lease.owner,lease.fence,mappingHash])).rows[0];
      return row ? `${lease.owner}.${lease.fence}.${row.continuity_epoch}.${row.ai_boundary_epoch}` : null;
    },
  });
}
