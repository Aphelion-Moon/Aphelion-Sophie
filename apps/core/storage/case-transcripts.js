import { createHash } from 'node:crypto';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { validateTranscriptExportPolicy } from '../../../modules/tickets/transcript-export.js';
import { requireCaseToken } from '../../../modules/tickets/references.js';
import { requireContinuityStamp } from '../../../contracts/gateway.js';
import { TRANSCRIPT_PAGE_SIZE, TRANSCRIPT_GAP_PAGE_SIZE, readTranscriptCursor, transcriptCursor, renderTranscript, transcriptObservation } from '../../../modules/tickets/transcript.js';
import { createMemberOperation } from './members.js';

/** Core-only read use case. No case locks are held while calling Discord or session authorization. */
export function createCaseTranscripts({ pool, authorization, roles, childAccess, clock }) {
  const memberOperation = createMemberOperation({ pool, clock });
  async function snapshot(actor, caseToken, channelId) {
    const row = (await pool.query(`SELECT r.id, r.guild_id, r.user_id, r.type, r.version, r.state, r.desired_access,
      r.channel_id AS root_channel_id, p.operation_token, p.policy_version, p.presence_epoch, p.audience_version,
      m.state->'presenceEpoch' AS member_presence, m.state->'observation'->'present' AS member_present,
      i.version AS invitation_version, i.presence_epoch AS invitation_presence, i.status AS invitation_status,
      c.channel_id, c.root_channel_id AS captured_root, c.parent_id, c.deleted_at_ms
      FROM sophie_core.case_reservations r JOIN sophie_core.case_provisions p ON p.case_id = r.id AND p.guild_id = r.guild_id
      LEFT JOIN sophie_core.members m ON m.guild_id = r.guild_id AND m.user_id = r.user_id
      LEFT JOIN sophie_core.case_participants i ON i.guild_id = r.guild_id AND i.case_id = r.id AND i.user_id = $3 AND i.status IN ('pending', 'active')
      LEFT JOIN sophie_core.case_capture_channels c ON c.guild_id = r.guild_id AND c.case_id = r.id AND c.channel_id = COALESCE($4, r.channel_id)
      WHERE r.guild_id = $1 AND p.operation_token = $2`, [actor.guildId, caseToken, actor.userId, channelId])).rows[0];
    requireCondition(row && row.channel_id && row.root_channel_id === row.captured_root &&
      ['open', 'closed'].includes(row.state) && row.desired_access === row.state, 'CASE_ACCESS_DENIED');
    if (row.channel_id !== row.root_channel_id) requireCondition(row.deleted_at_ms === null && row.parent_id === row.root_channel_id, 'CASE_CHILD_ACCESS_DENIED');
    return row;
  }
  const authorize = async (actor, row) => {
    // Persist REST-observed departure too; a later login must not resurrect the opener binding
    // merely because the Gateway removal has not arrived yet. No Discord request holds this lock.
    if (actor.userId === row.user_id) await memberOperation(await roles.observe(actor.userId), async () => {});
    requireCondition(await authorization.authorize('case.read', actor, {
      guildId: row.guild_id, caseId: row.id, type: row.type, openerId: row.user_id,
      // Core membership starts at zero; actor-authority participant presence starts at one.
      openerEligible: row.type !== 'staff-contact' && row.member_present === true && String(row.member_presence) === row.presence_epoch,
      participant: row.invitation_status === 'active' ? { guildId: row.guild_id, userId: actor.userId, presenceEpoch: Number(row.invitation_presence) } : null,
    }) === true, 'CASE_ACCESS_DENIED');
  };
  async function read({ actor, caseToken, channelId = null, after = null, gapsAfter = null }, exportPolicy = null) {
    if (exportPolicy !== null) {
      validateTranscriptExportPolicy(exportPolicy);
      requireCondition(exportPolicy.enabled && after === null && gapsAfter === null, 'CASE_EXPORT_DISABLED');
    }
    const pageSize = exportPolicy?.maxObservations ?? TRANSCRIPT_PAGE_SIZE, gapSize = exportPolicy?.maxGaps ?? TRANSCRIPT_GAP_PAGE_SIZE;
    requireCaseToken(caseToken); if (channelId !== null) requireId(channelId);
    const startedAt = clock(), continuity = requireContinuityStamp(await roles.readContinuity());
    const row = await snapshot(actor, caseToken, channelId);
    await authorize(actor, row);
    const exportAudience = async () => {
      if (exportPolicy?.audience === 'responders') requireCondition(await authorization.authorize('case.manage', actor,
        { guildId: row.guild_id, caseId: row.id, type: row.type }) === true, 'CASE_ACCESS_DENIED');
    };
    await exportAudience();
    const scope = { guildId: row.guild_id, caseToken, rootChannelId: row.root_channel_id, channelId: row.channel_id, userId: actor.userId };
    const childProof = row.channel_id === row.root_channel_id ? null : await childAccess.inspect(scope);
    const unchanged = async () => requireCondition(JSON.stringify(await snapshot(actor, caseToken, channelId)) === JSON.stringify(row), 'CASE_ACCESS_DENIED');
    const current = async () => {
      requireCondition(requireContinuityStamp(await roles.readContinuity()) === continuity, 'OBSERVATION_INVALIDATED');
      requireFreshObservation({ known: true, observedAt: startedAt }, clock());
    };
    const position = readTranscriptCursor(after, caseToken, row.channel_id);
    const gapPosition = readTranscriptCursor(gapsAfter, caseToken, row.channel_id, true);
    await unchanged(); await current();
    // One statement gives the page, gap page and live coverage summary the same database snapshot.
    const data = (await pool.query(`WITH observations AS (
      SELECT o.*, COALESCE((SELECT jsonb_agg(jsonb_build_object('ordinal', j.ordinal, 'status', j.status, 'bytes', j.retained_bytes) ORDER BY j.ordinal)
        FROM sophie_core.case_attachment_jobs j WHERE (j.guild_id, j.continuity_epoch, j.sequence, j.message_id) =
          (o.guild_id, o.continuity_epoch, o.sequence, o.message_id)), '[]'::jsonb) AS attachments
      FROM sophie_core.case_message_observations o WHERE guild_id = $1 AND channel_id = $2
        AND ($3::bigint IS NULL OR (continuity_epoch, sequence, message_id COLLATE "C") > ($3::bigint, $4::bigint, $5::text COLLATE "C"))
      ORDER BY continuity_epoch, sequence, message_id COLLATE "C" LIMIT $6
    ), gaps AS (
      SELECT token, channel_id, started_at_ms, closed_at_ms, reasons, recovered_by FROM sophie_core.case_capture_gaps
      WHERE guild_id = $1 AND (channel_id IS NULL OR channel_id = $2) AND ($7::text IS NULL OR token COLLATE "C" > $7 COLLATE "C")
      ORDER BY token COLLATE "C" LIMIT $8
    ) SELECT
      COALESCE((SELECT jsonb_agg(to_jsonb(o) || jsonb_build_object('continuity_epoch', o.continuity_epoch::text, 'sequence', o.sequence::text, 'observed_at_ms', o.observed_at_ms::text)
        ORDER BY o.continuity_epoch, o.sequence, o.message_id COLLATE "C") FROM observations o), '[]'::jsonb) AS observations,
      COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.token COLLATE "C") FROM gaps g), '[]'::jsonb) AS gaps,
      COALESCE((SELECT capture_enabled AND status = 'current' AND lease_until > clock_timestamp()
        FROM sophie_core.gateway_lifecycle WHERE guild_id = $1), false)
        AND NOT EXISTS (SELECT 1 FROM sophie_core.case_capture_gaps WHERE guild_id = $1 AND (channel_id IS NULL OR channel_id = $2) AND closed_at_ms IS NULL)
        AS capture_available`, [row.guild_id, row.channel_id, ...(position ?? [null, null, null]), pageSize + 1,
      gapPosition?.[0] ?? null, gapSize + 1])).rows[0];
    if (exportPolicy !== null) requireCondition(data.observations.length <= pageSize && data.gaps.length <= gapSize, 'CASE_EXPORT_TOO_LARGE');
    const observations = data.observations.slice(0, pageSize), gaps = data.gaps.slice(0, gapSize);
    const last = observations.at(-1);
    const result = { caseToken, channelId: row.channel_id, completeHistory: false, captureAvailable: data.capture_available,
      html: renderTranscript({ observations, gaps, captureAvailable: data.capture_available }),
      next: data.observations.length > pageSize ? transcriptCursor(caseToken, row.channel_id, [last.continuity_epoch, last.sequence, last.message_id]) : null,
      gapsNext: data.gaps.length > gapSize ? transcriptCursor(caseToken, row.channel_id, [gaps.at(-1).token]) : null };
    await authorize(actor, row); await exportAudience(); await unchanged();
    if (childProof !== null) await childAccess.verify(childProof, scope);
    await current();
    if (exportPolicy !== null) return { ...result, caseId: row.id, observations: observations.length, gaps: gaps.length,
      authorityHash: createHash('sha256').update(JSON.stringify([actor.userId, row])).digest('hex') };
    return { ...result, page: { observations: observations.map(transcriptObservation), gaps: data.gaps.slice(0, gapSize) } };
  }
  return Object.freeze({ read: request => read(request), prepareExport: (request, policy) => read(request, policy),
    async readChannel({ actor, channelId }) {
      requireId(channelId);
      const row = (await pool.query(`SELECT p.operation_token FROM sophie_core.case_capture_channels c
        JOIN sophie_core.case_provisions p ON p.guild_id = c.guild_id AND p.case_id = c.case_id
        WHERE c.guild_id = $1 AND c.channel_id = $2`, [actor.guildId, channelId])).rows[0];
      requireCondition(row, 'CASE_ACCESS_DENIED');
      // A known channel selects a ledger only. The full reader checks current case and child authority.
      return read({ actor, caseToken: row.operation_token, channelId });
    },
  });
}
