import { requireCondition, requireName } from '../../../contracts/validation.js';
import { commonParkedCodes, caseParkedCodes } from '../../../contracts/delivery-errors.js';
import { settleDeliveryFailure } from './delivery-failure.js';
import { casePlanKey } from '../../../modules/tickets/channel-policy.js';

/** One case operation per call. A database lease cannot make Discord effects atomic. */
export function createCaseDispatcher({ outbox, store, roles, channels, enabled, trace = () => {} }) {
  requireCondition(typeof enabled === 'function' && typeof trace === 'function', 'DELIVERY_GATE_REQUIRED');
  const parkedCodes = [...commonParkedCodes, ...caseParkedCodes];
  async function ready(claim) {
    requireCondition(await enabled() === true, 'DELIVERY_DISABLED');
    await outbox.requireDeliveryReady(claim);
    await outbox.renew(claim);
  }
  // Reads overtaken by the Gateway (this bot's own channel and permission changes make dispatches too) are read again
  // within the claim, up to three times, before the claim is given back.
  async function observed(work) {
    for (let attempt = 1; ; attempt++) {
      try { return await work(); } catch (error) {
        if (!['OBSERVATION_INVALIDATED', 'OBSERVATION_UNAVAILABLE', 'OBSERVATION_OUT_OF_ORDER'].includes(error?.code) || attempt >= 3) throw error;
      }
    }
  }
  // Fixed diagnostic codes only: the outcome and whole milliseconds. No IDs or channel names.
  function note(result, startedAt) {
    try {
      trace(`CASE_PROVISION_${String(result.status).toUpperCase().replace(/[^A-Z]/g, '_')}_${Math.min(99_999, Math.round(performance.now() - startedAt))}MS`);
    } catch { /* Diagnostics never affect delivery. */ }
  }
  const dispatcher = Object.freeze({
    async runOnce(owner) {
      const startedAt = performance.now(), result = await dispatcher.provision(owner);
      if (!['idle', 'disabled'].includes(result.status)) note(result, startedAt);
      return result;
    },
    async provision(owner) {
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
        const current = await observed(async () => store.inspectCaseProvision({ claim, observation: await roles.observe(job.userId) }));
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
          let proof = await channels.create(preparation, plan);
          // Recording the new channel re-checks its observation; the Gateway may still be catching up with this bot's own
          // create. Re-read the same channel (never create again) rather than giving the claim back as uncertain.
          for (let attempt = 1; ; attempt++) {
            try { await store.noteCaseChannel({ claim, proof }); break; } catch (error) {
              if (!['OBSERVATION_INVALIDATED', 'OBSERVATION_UNAVAILABLE', 'OBSERVATION_OUT_OF_ORDER'].includes(error?.code) || attempt >= 3) throw error;
              proof = await channels.inspect(plan, proof.channelId);
            }
          }
          await outbox.continue(claim);
          return { status: 'progressed' };
        }
        // Retain every discovered candidate, including duplicates and late results.
        for (const proof of matches) await store.noteCaseChannel({ claim, proof });
        if (!matches.length && current.channelId === null) {
          // Shuttle cases create again once the unanswered create is old enough; anything else waits for review.
          const { restarted } = await store.restartUncertainCaseCreation({ claim, observation: await roles.observe(job.userId) });
          requireCondition(restarted, 'CASE_CREATION_UNCERTAIN');
          await outbox.continue(claim); return { status: 'progressed' };
        }
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
        const confirmed = await observed(async () => {
          const after = await channels.inspect(plan, channelId);
          const afterOthers = [];
          if (candidates.ids.length > 1) {
            const found = await channels.find(plan);
            for (const candidate of found) await store.noteCaseChannel({ claim, proof: candidate });
            for (const id of candidates.ids.filter(id => id !== channelId)) afterOthers.push(found.find(item => item.channelId === id) ?? await channels.inspect(plan, id));
          }
          return store.confirmCaseProvision({ claim, proof: after, otherProofs: afterOthers, observation: await roles.observe(job.userId) });
        });
        if (!confirmed.settled) {
          await outbox.continue(claim);
          return { status: 'progressed' };
        }
        return { status: 'settled', opened: confirmed.opened };
      } catch (error) {
        // The original failure code, on its own line: the host keeps trace codes of at most 64 characters.
        try { if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,43}$/.test(error.code)) trace(`CASE_PROVISION_CODE_${error.code}`); }
        catch { /* Diagnostics never affect delivery. */ }
        return settleDeliveryFailure({ outbox, claim, error, possiblyAttempted, parkedCodes,
          noteUncertain: accessAttempted ? () => store.noteUncertainCaseChange(claim) : undefined });
      }
    },
  });
  return dispatcher;
}
