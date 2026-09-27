import { requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';
import { casePlanKey } from '../../../modules/tickets/channel-policy.js';

/** One case operation per call. A database lease cannot make Discord effects atomic. */
export function createCaseDispatcher({ outbox, store, roles, channels, enabled }) {
  requireCondition(typeof enabled === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes];
  async function ready(claim) {
    requireCondition(await enabled() === true, 'DELIVERY_DISABLED');
    await outbox.requireDeliveryReady(claim);
    await outbox.renew(claim);
  }
  return Object.freeze({
    async runOnce(owner) {
      requireName(owner);
      if (await enabled() !== true) return { status: 'disabled' };
      const job = await outbox.claim(owner, 30_000, ['case.provision']);
      if (!job) return { status: 'idle' };
      if (job.parked) return { status: 'operator_required', code: 'ATTEMPT_LIMIT' };
      const { claim } = job;
      let possiblyAttempted = false, accessAttempted = false;
      try {
        requireCondition(claim.guildId === channels.guildId && claim.guildId === roles.guildId, 'CASE_CONFIGURATION_INVALID');
        await ready(claim);
        const current = await store.inspectCaseProvision({ claim, observation: await roles.observe(job.userId) });
        if (current.settled) return { status: 'settled', code: current.reason };
        const { plan } = current;
        if (current.retiring) {
          const proof = await channels.inspectPresence(plan, current.channelId);
          const preparation = proof.missing ? null : await channels.prepare(plan);
          await ready(claim);
          const removal = await store.beginOnboardingRemoval({ claim, proof, observation: await roles.observe(job.userId) });
          if (!removal.missing) {
            requireCondition(casePlanKey(removal.plan) === casePlanKey(plan), 'CASE_AUDIENCE_CHANGED');
            await ready(claim); possiblyAttempted = true;
            await channels.removeOnboarding(preparation, proof, plan);
          }
          await ready(claim);
          await store.confirmOnboardingRemoval({ claim, observation: await roles.observe(job.userId), proof: await channels.inspectPresence(plan, current.channelId) });
          return { status: 'settled', removed: true };
        }
        const matches = await channels.find(plan);
        if (!current.createStarted) {
          requireCondition(matches.length === 0, 'CASE_CHANNEL_COLLISION');
          const preparation = await channels.prepare(plan);
          await ready(claim);
          await store.beginCaseCreation({ claim, observation: preparation.observation });
          // Intent is committed before POST. Any uncertainty after here is reconciled by
          // its non-identifying marker; a second create request is never inferred safe.
          await ready(claim);
          possiblyAttempted = true;
          const proof = await channels.create(preparation, plan);
          await store.noteCaseChannel({ claim, proof });
          await outbox.continue(claim);
          return { status: 'progressed' };
        }
        // Retain every discovered candidate, including duplicates and late results.
        for (const proof of matches) await store.noteCaseChannel({ claim, proof });
        if (!matches.length && current.channelId === null) requireCondition(false, 'CASE_CREATION_UNCERTAIN');
        const candidates = await store.inspectCaseCandidates({ claim, observation: await roles.observe(job.userId) });
        const otherProofs = [];
        // No selection grants access. Seal each other retained candidate first, one
        // mutation per call; an unresolved set is entirely bot-only before parking.
        for (const id of candidates.ids.filter(id => id !== candidates.channelId)) {
          const proof = matches.find(item => item.channelId === id) ?? await channels.inspect(plan, id);
          let sealed = false;
          try { await channels.verification.channel(proof, plan, true); sealed = true; }
          catch (error) { if (error.code !== 'CASE_CHANNEL_ACL_MISMATCH') throw error; }
          if (!sealed) {
            const preparation = await channels.prepare(plan);
            await ready(claim);
            await store.beginCaseDuplicateSeal({ claim, observation: preparation.observation, proof });
            await ready(claim); possiblyAttempted = true; accessAttempted = true;
            await channels.setAudience(preparation, proof, plan, true);
            await ready(claim);
            await store.confirmCaseDuplicateSeal({ claim, observation: await roles.observe(job.userId), proof: await channels.inspect(plan, id) });
            await outbox.continue(claim);
            return { status: 'progressed' };
          }
          otherProofs.push(proof);
        }
        requireCondition(candidates.channelId !== null, 'CASE_CHANNEL_DUPLICATE');
        const channelId = candidates.channelId;
        const preparation = await channels.prepare(plan, current.mode);
        const proof = await channels.inspect(plan, channelId);
        await store.noteCaseChannel({ claim, proof });
        await ready(claim);
        const access = await store.beginCaseAccess({ claim, observation: preparation.observation, proof, otherProofs });
        requireCondition(casePlanKey(access.plan) === casePlanKey(plan), 'CASE_AUDIENCE_CHANGED');
        let matchesPolicy = false;
        try { await channels.verification.channel(proof, plan, access.mode); matchesPolicy = true; }
        catch (error) { if (error.code !== 'CASE_CHANNEL_ACL_MISMATCH') throw error; }
        if (!matchesPolicy) {
          await ready(claim);
          possiblyAttempted = true; accessAttempted = true;
          await channels.setAudience(preparation, proof, plan, access.mode);
        }
        await ready(claim);
        const after = await channels.inspect(plan, channelId);
        const afterOthers = [];
        if (candidates.ids.length > 1) {
          const observed = await channels.find(plan);
          for (const candidate of observed) await store.noteCaseChannel({ claim, proof: candidate });
          for (const id of candidates.ids.filter(id => id !== channelId)) afterOthers.push(observed.find(item => item.channelId === id) ?? await channels.inspect(plan, id));
        }
        const confirmed = await store.confirmCaseProvision({ claim, proof: after, otherProofs: afterOthers, observation: await roles.observe(job.userId) });
        if (!confirmed.settled) {
          await outbox.continue(claim);
          return { status: 'progressed' };
        }
        return { status: 'settled', opened: confirmed.opened };
      } catch (error) {
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes,
          noteUncertain: accessAttempted ? () => store.noteUncertainCaseChange(claim) : undefined });
      }
    },
  });
}
