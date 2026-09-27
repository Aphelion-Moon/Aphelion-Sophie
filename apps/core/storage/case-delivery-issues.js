import { loadCasePlan } from './case-audience.js';
import { requireCondition, requireFreshObservation, requireId, requireInteger } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { CASE_TYPES } from '../../../modules/tickets/index.js';
import { ORDINARY_CASE_TYPES, requireCaseIssueId, caseIssueReason } from '../../../modules/tickets/delivery-issues.js';
import { validateCasePolicy, requireCaseChannel } from '../../../modules/tickets/channel-policy.js';
import { renderCaseIntakeMessage } from '../../../modules/tickets/intake-messages.js';
import { loadCaseRecord, caseManagementScope } from './case-lookup.js';
import { registerCasePolicy } from './case-records.js';
import { ordinaryDeliveryJoins, ordinaryDeliveryScope } from './case-issue-records.js';
import { caseCandidateIds, selectedCaseChannel, chooseCaseChannel } from './case-channel-selection.js';
import { planIntakeMessages } from './case-intake-message-records.js';
import { recordReplyEvent, requireReplyIntegrity } from './case-reply-records.js';
import { createMemberOperation } from './members.js';
import { receipt, readReceipt, saveReceipt } from './receipts.js';
import { inTransaction } from './transaction.js';

const joins = `JOIN sophie_core.outbox o ON o.guild_id = i.guild_id AND o.operation_id = i.operation_id AND o.user_id = i.user_id
  ${ordinaryDeliveryJoins}`;
const scope = `${ordinaryDeliveryScope} AND i.case_id = r.id`;
const labels = { 'case.provision': 'case', 'case.intake': 'intake', 'case.reply': 'reply' };
const needsMessage = artifact => Boolean(artifact?.create_started && artifact.message_id === null);
function request(issueId, expectedRevision, action, resultId = null) {
  requireCaseIssueId(issueId); requireInteger(expectedRevision, 0, 2_147_483_644);
  requireCondition(['recheck', 'adopt_message', 'select_channel'].includes(action), 'INVALID_CASE_ISSUE_ACTION');
  if (action === 'recheck') requireCondition(resultId === null, 'INVALID_CASE_ISSUE_ACTION'); else requireId(resultId);
  return { action: `case.delivery.${action}`, issueId, expectedRevision, resultId };
}

/** Current responders can record narrow repair intent; only normal workers confirm effects. */
export function createCaseDeliveryIssueStore({ pool, clock, authorize, policy, verification, messageVerification, replyVerification = null }) {
  validateCasePolicy(policy); const fixed = structuredClone(policy), memberOperation = createMemberOperation({ pool, clock });
  const configured = guildId => { requireId(guildId); requireCondition(guildId === fixed.guildId, 'CASE_CONFIGURATION_REQUIRED'); };
  async function access(actor, row) {
    configured(row.guild_id); requireCondition(ORDINARY_CASE_TYPES.includes(row.type) &&
      await authorize('case.manage', actor, caseManagementScope(row)) === true, 'OPERATION_DENIED');
  }
  async function visible(actor, guildId) {
    configured(guildId); const base = { guildId, caseId: 'case-issues', openerId: actor?.userId };
    const visible = [];
    for (const { id } of CASE_TYPES) if (id !== 'shuttle' && await authorize('case.manage', actor, { ...base, type: id }) === true) visible.push(id);
    requireCondition(visible.length > 0, 'OPERATION_DENIED'); return visible;
  }
  async function issue(client, guildId, issueId) {
    requireCaseIssueId(issueId);
    const row = (await client.query(`SELECT r.*, p.policy_version, p.operation_token, p.presence_epoch, p.audience_version, p.chosen_channel_id, p.chosen_candidates,
      i.id AS issue_id, i.revision, i.parked_fence, i.operation_id, o.kind, o.effect->>'replyId' AS reply_id, o.status AS job_status, o.fence, o.last_error_code, o.dispatch_started
      FROM sophie_core.case_delivery_issues i ${joins} WHERE i.guild_id = $1 AND i.id = $2 AND ${scope}`, [guildId, issueId])).rows[0];
    requireCondition(row, 'CASE_ISSUE_NOT_FOUND'); return row;
  }
  async function artifact(client, row) {
    if (row.kind === 'case.reply') return (await client.query(`SELECT id, channel_id, message_id, create_started, state FROM sophie_core.case_replies
      WHERE id = $1 AND case_id = $2 AND guild_id = $3 AND user_id = $4`, [row.reply_id, row.id, row.guild_id, row.user_id])).rows[0] ?? null;
    if (row.kind !== 'case.intake') return null;
    return (await client.query(`SELECT id, ordinal, channel_id, message_id, create_started FROM sophie_core.case_intake_messages
      WHERE case_id = $1 AND guild_id = $2 AND user_id = $3 AND state = 'pending' ORDER BY ordinal LIMIT 1`, [row.id, row.guild_id, row.user_id])).rows[0] ?? null;
  }
  async function privateProof(proof, plan, channelId) {
    requireCondition(typeof verification?.channel === 'function', 'CASE_VERIFIER_REQUIRED');
    const channel = await verification.channel(proof, plan, false); requireCaseChannel(channel, plan, fixed, false);
    requireCondition(channel.id === channelId, 'CASE_CHANNEL_MISMATCH');
  }
  return Object.freeze({
    async listCaseDeliveryIssues({ actor, guildId, after = null }) {
      if (after !== null) requireCaseIssueId(after);
      return inTransaction(pool, async client => {
        const types = await visible(actor, guildId); await registerCasePolicy(client, fixed); let boundary = null;
        if (after !== null) {
          boundary = (await client.query(`SELECT i.created_at::text AS created_at, i.id FROM sophie_core.case_delivery_issues i ${joins}
            WHERE i.guild_id = $1 AND i.id = $2 AND r.type = ANY($3::text[]) AND ${scope}`, [guildId, after, types])).rows[0];
          requireCondition(boundary, 'STALE_CASE_ISSUE_QUEUE'); await access(actor, await issue(client, guildId, after));
        }
        const rows = (await client.query(`SELECT i.id FROM sophie_core.case_delivery_issues i ${joins}
          WHERE i.guild_id = $1 AND ${scope} AND r.type = ANY($2::text[]) AND o.status = 'parked' AND i.parked_fence = o.fence
          AND ($3::timestamptz IS NULL OR (i.created_at, i.id) > ($3::timestamptz, $4::text))
          ORDER BY i.created_at, i.id LIMIT 6`, [guildId, types, boundary?.created_at ?? null, boundary?.id ?? null])).rows;
        const entries = [];
        for (const item of rows.slice(0, 5)) {
          const row = await issue(client, guildId, item.id); await access(actor, row);
          const part = await artifact(client, row), ids = row.kind === 'case.provision' ? await caseCandidateIds(client, await loadCasePlan(client, row)) : [];
          const channelChoice = ids.length > 1 ? { required: selectedCaseChannel(row, ids) === null, candidates: ids.slice(0, 5), total: ids.length } : null;
          const needsMessageId = needsMessage(part);
          entries.push({ issueId: row.issue_id, userId: row.user_id, revision: row.revision, channelId: row.kind === 'case.reply' ? part?.channel_id ?? null : row.channel_id ?? part?.channel_id ?? null,
            caseState: row.state, caseType: row.type, kind: labels[row.kind], reason: caseIssueReason(row.last_error_code), attempted: row.dispatch_started,
            ...(row.kind === 'case.reply' ? { replyId: part.id } : {}),
            needsMessageId, channelChoice, recheckable: !needsMessageId && !channelChoice?.required && row.policy_version === fixed.version &&
              (row.kind === 'case.provision' || row.kind === 'case.reply' || (row.state === 'open' && row.desired_access === 'open' && row.channel_id !== null)) });
        }
        const current = await visible(actor, guildId); requireCondition(entries.every(row => current.includes(row.caseType)), 'OPERATION_DENIED');
        return { state: 'ready', guildId, entries, next: rows.length > 5 ? entries.at(-1).issueId : null };
      });
    },
    async describeCaseDeliveryIssue({ actor, guildId, issueId, interactionId, expectedRevision, action, resultId = null }) {
      const intent = request(issueId, expectedRevision, action, resultId);
      return inTransaction(pool, async client => {
        configured(guildId); const row = await issue(client, guildId, issueId); await access(actor, row);
        const previous = await readReceipt(client, guildId, operatorGrant(actor).userId, interactionId, intent);
        if (previous) { await access(actor, row); return { duplicate: true }; }
        requireCondition(row.job_status === 'parked' && row.revision === expectedRevision && row.fence === row.parked_fence, 'STALE_CASE_ISSUE');
        const part = await artifact(client, row); await access(actor, row);
        return { duplicate: false, userId: row.user_id, kind: row.kind, plan: await loadCasePlan(client, row), channelId: row.kind === 'case.reply' ? part?.channel_id ?? null : row.channel_id ?? part?.channel_id ?? null,
          recordId: part?.id ?? null, candidateIds: row.kind === 'case.provision' ? await caseCandidateIds(client, await loadCasePlan(client, row)) : [] };
      });
    },
    async changeCaseDeliveryIssue({ actor, interactionId, issueId, expectedRevision, action, resultId = null, observation, proof = null, message = null }) {
      const intent = request(issueId, expectedRevision, action, resultId);
      return memberOperation(observation, async (client, member) => {
        const found = await issue(client, member.guildId, issueId); await access(actor, found);
        requireCondition(found.user_id === member.userId, 'MEMBER_MISMATCH'); const grant = operatorGrant(actor);
        if (await receipt(client, member.guildId, grant.userId, interactionId, intent)) { await access(actor, found); return { duplicate: true }; }
        await registerCasePolicy(client, fixed);
        const job = (await client.query('SELECT * FROM sophie_core.outbox WHERE guild_id = $1 AND operation_id = $2 FOR UPDATE', [member.guildId, found.operation_id])).rows[0];
        const current = (await client.query('SELECT * FROM sophie_core.case_delivery_issues WHERE id = $1 FOR UPDATE', [issueId])).rows[0];
        requireCondition(job.status === 'parked' && current.revision === expectedRevision && job.fence === current.parked_fence, 'STALE_CASE_ISSUE');
        const row = await loadCaseRecord(client, { guildId: member.guildId, id: found.id, lock: true }), plan = await loadCasePlan(client, row);
        requireCondition(row.policy_version === fixed.version, 'CASE_POLICY_CHANGED'); let part = null, candidateIds = null;
        if (job.kind === 'case.intake') {
          requireCondition(member.observation.present && plan.presenceEpoch === member.presenceEpoch && row.state === 'open' &&
            row.desired_access === 'open' && row.channel_id !== null, 'CASE_INTAKE_UNAVAILABLE');
          await privateProof(proof, plan, row.channel_id);
          const source = await planIntakeMessages(client, plan, fixed); part = source.records.find(record => record.state === 'pending') ?? null;
          requireCondition(action !== 'select_channel', 'INVALID_CASE_ISSUE_ACTION');
          if (action === 'recheck') requireCondition(!needsMessage(part), 'CASE_ISSUE_MESSAGE_REQUIRED');
          else {
            requireCondition(part?.create_started && part.channel_id === row.channel_id, 'CASE_RECOVERY_NOT_STARTED');
            requireCondition(part.message_id === null || part.message_id === resultId, 'CASE_INTAKE_MESSAGE_COLLISION');
            requireCondition(typeof messageVerification?.candidate === 'function' && typeof messageVerification?.matches === 'function', 'CASE_INTAKE_VERIFIER_REQUIRED');
            const expected = { recordId: part.id, plan, channelId: row.channel_id,
              payload: renderCaseIntakeMessage({ id: part.id, page: source.pages[part.ordinal - 1], caseType: plan.type, policy: fixed }) };
            const observed = await messageVerification.candidate(message, expected);
            requireCondition(!observed.missing && observed.messageId === resultId, 'CASE_INTAKE_MESSAGE_MISSING');
            requireCondition(await messageVerification.matches(message, expected), 'CASE_INTAKE_MESSAGE_CHANGED');
            await client.query('UPDATE sophie_core.case_intake_messages SET message_id = $2 WHERE id = $1', [part.id, resultId]);
          }
        } else if (job.kind === 'case.reply') {
          requireCondition(action !== 'select_channel', 'INVALID_CASE_ISSUE_ACTION');
          part = (await client.query('SELECT * FROM sophie_core.case_replies WHERE id = $1 FOR UPDATE', [job.effect.replyId])).rows[0];
          requireCondition(part && part.id === found.reply_id && part.guild_id === row.guild_id && part.case_id === row.id && part.user_id === row.user_id, 'CASE_REPLY_UNTRUSTED');
          requireReplyIntegrity(part);
          if (action === 'recheck') requireCondition(!needsMessage(part), 'CASE_ISSUE_MESSAGE_REQUIRED');
          else {
            requireCondition(part.state === 'pending' && part.create_started && job.dispatch_started, 'CASE_RECOVERY_NOT_STARTED');
            requireCondition(part.message_id === null || part.message_id === resultId, 'CASE_INTAKE_MESSAGE_COLLISION');
            requireCondition(typeof replyVerification?.candidate === 'function', 'CASE_REPLY_CONFIGURATION_INVALID');
            const channel = await verification.candidate(proof, plan, false);
            requireCondition(channel.id === part.channel_id, 'CASE_CHANNEL_MISMATCH');
            const observed = await replyVerification.candidate(message, { recordId: part.id, plan, channelId: part.channel_id });
            requireCondition(!observed.missing && observed.messageId === resultId, 'CASE_INTAKE_MESSAGE_MISSING');
            // Ownership/marker is enough to retain an ID. Only the normal worker can
            // confirm exact text or withdraw it after changed content/access/authority.
            if (part.message_id === null) {
              await client.query('UPDATE sophie_core.case_replies SET message_id = $2 WHERE id = $1', [part.id, resultId]);
              part.message_id = resultId; await recordReplyEvent(client, part, 'receipt');
            }
          }
        } else {
          requireCondition(job.kind === 'case.provision' && action !== 'adopt_message', 'INVALID_CASE_ISSUE_ACTION');
          const ids = await caseCandidateIds(client, plan);
          const provision = (await client.query('SELECT * FROM sophie_core.case_provisions WHERE case_id = $1', [row.id])).rows[0];
          if (action === 'select_channel') candidateIds = await chooseCaseChannel(client, { job, bound: { row, plan }, resultId, proof, verification });
          else requireCondition(ids.length <= 1 || selectedCaseChannel(provision, ids) !== null, 'CASE_ISSUE_CHANNEL_REQUIRED');
        }
        await access(actor, row); requireFreshObservation(member.observation, clock());
        await client.query(`INSERT INTO sophie_core.case_delivery_actions
          (guild_id, interaction_id, issue_id, revision, operator_grant, parked_fence, attempts, dispatch_started, error_code, action, result_id, record_id, candidate_ids)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [member.guildId, interactionId, issueId, current.revision + 1, grant,
          job.fence, job.attempts, job.dispatch_started, job.last_error_code, action, resultId, action === 'adopt_message' ? part.id : null, candidateIds]);
        await client.query('UPDATE sophie_core.case_delivery_issues SET revision = revision + 1 WHERE id = $1', [issueId]);
        await client.query(`UPDATE sophie_core.outbox SET status = 'ready', available_at = clock_timestamp(), attempts = 0, fence = fence + 1,
          last_error_code = NULL WHERE guild_id = $1 AND operation_id = $2`, [member.guildId, found.operation_id]);
        await saveReceipt(client, member.guildId, interactionId, { issueId, revision: current.revision + 1 }); return { duplicate: false };
      });
    },
  });
}
