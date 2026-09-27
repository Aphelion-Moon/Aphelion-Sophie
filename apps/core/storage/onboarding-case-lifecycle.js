import { randomBytes } from 'node:crypto';
import { cancelOnboardingGrantForClosure } from '../../../modules/onboarding/index.js';
import { enqueue } from './outbox.js';

/** Called under the case opener's member lock, in the same transaction as closure intent. */
export async function retireOnboardingForClosure(client, member, caseId, version) {
  const sessions = (await client.query(`SELECT s.state FROM sophie_core.sessions s
    JOIN sophie_core.shuttle_cases b ON b.session_id = s.id AND b.guild_id = s.guild_id AND b.user_id = s.user_id
    WHERE b.case_id = $1 AND b.guild_id = $2 AND b.user_id = $3 FOR UPDATE OF s`, [caseId, member.guildId, member.userId])).rows;
  for (const { state } of sessions) {
    const next = cancelOnboardingGrantForClosure(state, randomBytes(16).toString('hex'));
    if (next !== state) {
      // Preserve the existing current flag; closure must not revive a revoked run.
      await client.query('UPDATE sophie_core.sessions SET state = $2 WHERE id = $1', [state.id, next]);
      const jobs = (await client.query(`SELECT operation_id, dispatch_started FROM sophie_core.outbox
        WHERE guild_id = $1 AND user_id = $2 AND kind = 'whitelist.grant' AND effect->>'sessionId' = $3 FOR UPDATE`,
      [member.guildId, member.userId, state.id])).rows;
      await client.query(`UPDATE sophie_core.outbox SET status = 'cancelled', last_error_code = 'SHUTTLE_CASE_CLOSED'
        WHERE guild_id = $1 AND kind = 'whitelist.grant' AND effect->>'sessionId' = $2 AND status IN ('ready', 'parked')`, [member.guildId, state.id]);
      for (const job of jobs.filter(row => row.dispatch_started)) await enqueue(client, { kind: 'whitelist.reconcile',
        guildId: member.guildId, userId: member.userId, operationId: `${job.operation_id}.closed.${version}`,
        sourceOperation: job.operation_id, accessEpoch: member.accessEpoch, eligibilityEpoch: member.eligibilityEpoch });
    }
  }
  const screens = (await client.query(`UPDATE sophie_core.shuttle_screens v SET current = false, ready = false
    FROM sophie_core.shuttle_cases b WHERE v.session_id = b.session_id AND v.guild_id = b.guild_id AND v.user_id = b.user_id
      AND b.case_id = $1 AND v.guild_id = $2 AND v.user_id = $3 AND v.current RETURNING v.id`, [caseId, member.guildId, member.userId])).rows;
  for (const screen of screens) await enqueue(client, { kind: 'shuttle.render', operationId: `screen.closed.${screen.id}.${version}`,
    guildId: member.guildId, userId: member.userId, screenId: screen.id });
}
