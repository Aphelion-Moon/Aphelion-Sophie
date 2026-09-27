import { ContractError, requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';

const roleKinds = Object.freeze(['whitelist.grant', 'whitelist.reconcile']);

/** One bounded job per call. Composition owns scheduling, activation and service lifetime. */
export function createRoleDispatcher(options) {
  return createOwnedRoleDispatcher(options, roleKinds);
}

export function createMembershipDispatcher(options) {
  return createOwnedRoleDispatcher(options, ['member.reconcile']);
}

function createOwnedRoleDispatcher({ outbox, store, discord, enabled }, kinds) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner);
      if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, kinds);
      if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job;
      let possiblyAttempted = false;
      try {
        requireCondition(claim.guildId === discord.guildId, 'ROLE_CONFIGURATION_INVALID');
        // Metadata reads precede the locked policy check. No cached member roles or old
        // component payload are passed to the grant policy.
        const { context, observation } = await discord.prepare(job.userId);
        await outbox.renew(claim);
        const membership = job.kind === 'member.reconcile';
        const inspect = membership ? store.inspectMemberReconciliation : job.kind === 'whitelist.grant' ? store.inspectGrant : store.inspectWhitelistReconciliation;
        const plan = await inspect({ claim, observation });
        if (!plan.deliver) return { status: 'settled', ...(plan.reason ? { code: plan.reason } : {}) };
        requireCondition(await enabled() === true, 'DELIVERY_DISABLED');
        await outbox.requireDeliveryReady(claim);
        await outbox.renew(claim);
        possiblyAttempted = true;
        const change = membership ? plan.change : job.kind === 'whitelist.grant' ? 'add_whitelist' : 'remove_whitelist';
        await discord.change(context, change);
        const after = await discord.observe(job.userId);
        const confirmed = await inspect({ claim, observation: after, ...(job.kind === 'whitelist.grant' ? { confirm: true } : {}) });
        if (confirmed.deliver) {
          if (!membership || confirmed.change === change) throw new ContractError('ROLE_NOT_CONFIRMED');
          await outbox.continue(claim);
          return { status: 'progressed' };
        }
        return { status: 'settled', ...(confirmed.reason ? { code: confirmed.reason } : {}) };
      } catch (error) {
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes: commonParkedCodes,
          noteUncertain: possiblyAttempted ? () => job.kind === 'member.reconcile' ?
            store.noteUncertainMemberChange(claim) : store.noteUncertainGrant(claim) : undefined });
      }
    },
  });
}
