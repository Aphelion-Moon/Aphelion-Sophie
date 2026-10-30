import { randomBytes } from 'node:crypto';
import { ContractError, requireCondition, requireName } from '../../../contracts/validation.js';
import { validateTicketLimits } from '../../../modules/tickets/index.js';

// Member reads are checked against the Gateway's continuity, which advances on every dispatch. With message events on,
// any message in the server overtakes a read in flight, including this bot's own "Opening…" edit of the clicked card.
// These, and short Discord cooldowns or a busy lane, clear in moments, so the command is tried again a few times. A
// repeat is safe: opening a run and every Shuttle change are keyed by the interaction and commit atomically.
const TRANSIENT_CODES = new Set(['OBSERVATION_INVALIDATED', 'OBSERVATION_UNAVAILABLE', 'OBSERVATION_OUT_OF_ORDER', 'MEMBERSHIP_STALE', 'DISCORD_BUSY',
  'RATE_LIMITED', 'DISCORD_UNAVAILABLE']);
const RETRY_DELAYS_MS = Object.freeze([150, 400, 1_000]);
const RETRY_WAIT_LIMIT_MS = 2_000;
const traceCode = code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,47}$/.test(code) ? code : 'UNEXPECTED';

/** Signed entry -> fresh self-service authorization -> one atomic session/case reservation. */
export function createOnboardingCommands({ authorization, discord, channels, store, enabled, definitionId, limits, trace = () => {},
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  requireName(definitionId); validateTicketLimits(limits);
  requireCondition(typeof enabled === 'function' && typeof trace === 'function' && typeof pause === 'function', 'DELIVERY_GATE_REQUIRED');
  const fixedLimits = structuredClone(limits);
  const note = code => { try { trace(code); } catch { /* Diagnostics never affect a command. */ } };
  async function attempt(envelope, seen) {
    const actor = await authorization.resolveActor(envelope);
    seen.actor = actor;
    requireCondition(envelope.guildId === discord.guildId && ['shuttle.start', 'shuttle.control'].includes(envelope.command) &&
      envelope.targetId === envelope.userId, 'OPERATION_DENIED');
    const observation = await discord.observe(envelope.userId);
    if (await enabled() !== true) return 'disabled';
    if (envelope.command === 'shuttle.control') {
      const control = { screenId: envelope.screenId, channelId: envelope.channelId, messageId: envelope.messageId, controlVersion: envelope.controlVersion };
      const { plan } = await store.describeOnboardingControl({ actor, observation, ...control });
      const proof = await channels.inspect(plan, envelope.channelId);
      if (await enabled() !== true) return 'disabled';
      await store.actOnOnboarding({ actor, interactionId: envelope.interactionId, action: envelope.action,
        observation: await discord.observe(envelope.userId), proof, ...control });
      return 'shuttle_progress_recorded';
    }
    const existing = await store.describeOnboardingEntryChannel({ actor, observation });
    if (existing !== null) {
      const proof = await channels.inspectPresence(existing.plan, existing.channelId);
      if (proof.missing) await store.recoverMissingOnboardingChannel({ actor, id: existing.id, proof,
        observation: await discord.observe(envelope.userId) });
    }
    if (await enabled() !== true) return 'disabled';
    await store.openOnboarding({ actor, interactionId: envelope.interactionId, id: `shuttle.${envelope.interactionId}`,
      caseId: `shuttle-case.${envelope.interactionId}`, nonce: randomBytes(16).toString('hex'),
      observation: await discord.observe(envelope.userId), definitionId, limits: fixedLimits });
    return 'shuttle_recorded';
  }
  // The click already showed "Opening…" on its card. It recorded nothing, so the card is put back (or a pre-upgrade
  // message is redrawn as the status card). When that cannot read Discord either, the member's own card is simply
  // queued to be drawn again. Best effort; neither grants anything.
  async function restore(envelope, actor) {
    const control = { interactionId: envelope.interactionId, action: envelope.action, screenId: envelope.screenId,
      channelId: envelope.channelId, messageId: envelope.messageId };
    try {
      if (actor !== null && await enabled() === true) {
        await store.restoreOnboardingControl({ actor, observation: await discord.observe(envelope.userId), ...control }); return;
      }
    } catch { /* Fall through to the release below. */ }
    try {
      if (await enabled() === true) await store.releaseOnboardingControl({ guildId: envelope.guildId, userId: envelope.userId, ...control });
    } catch { note('SHUTTLE_CONTROL_RESTORE_UNAVAILABLE'); }
  }
  function outcome(error, envelope) {
    const code = error instanceof ContractError ? error.code : null;
    if (code === 'SHUTTLE_PAUSED') return 'shuttle_paused';
    // No published guide at all is a setup gap, not a member's case for Staff review; say so.
    if (code === 'DEFINITION_NOT_FOUND' && envelope.command === 'shuttle.start') return 'shuttle_unpublished';
    if (['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT', 'MEMBER_MUZZLED', 'NOT_IN_GUILD', 'CAPABILITY_REVOKED',
      'FOREIGN_GUILD', 'FOREIGN_SHUTTLE_CONTROL'].includes(code)) return 'denied';
    if (['STALE_SHUTTLE_CONTROL', 'SHUTTLE_NOT_ACTIVE', 'BACK_UNAVAILABLE', 'NO_PENDING_GRANT', 'SHUTTLE_SCREEN_NOT_FOUND',
      'SHUTTLE_SCREENS_UNREAD', 'SCREEN_NAVIGATION_UNAVAILABLE'].includes(code)) return 'shuttle_stale';
    if (['MEMBER_CASE_LIMIT', 'GUILD_PROVISIONING_LIMIT', 'CASE_COOLDOWN'].includes(code)) return 'shuttle_busy';
    if (['DEFINITION_WITHDRAWN', 'DEFINITION_NOT_FOUND', 'SHUTTLE_CASE_UNAVAILABLE', 'SHUTTLE_RESTART_REQUIRED',
      'DEFINITION_MISMATCH', 'SHUTTLE_CONTENT_REQUIRED', 'CASE_CHANNEL_ACL_MISMATCH'].includes(code)) return 'shuttle_review';
    // Still overtaken or rate limited after the retries: trying again shortly will work. Anything else (Discord
    // refusing access, an unexpected state) is not fixed by a retry; its code reaches the operator's trace.
    return TRANSIENT_CODES.has(error?.code) ? 'shuttle_retry' : 'unavailable';
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      // The click has already turned its card into "Opening…". Note that first, so the card is drawn again later even if
      // this command never finishes (see noteOnboardingOpening). Database only; best effort.
      if (envelope.command === 'shuttle.control' && ['advance', 'back', 'retry'].includes(envelope.action)) {
        try {
          await store.noteOnboardingOpening({ guildId: envelope.guildId, userId: envelope.userId, interactionId: envelope.interactionId,
            action: envelope.action, screenId: envelope.screenId, channelId: envelope.channelId, messageId: envelope.messageId });
        } catch { note('SHUTTLE_CONTROL_WATCH_UNAVAILABLE'); }
      }
      const seen = { actor: null };
      for (let tries = 0; ; tries++) {
        try { return await attempt(envelope, seen); } catch (error) {
          const code = traceCode(error?.code);
          if (TRANSIENT_CODES.has(error?.code) && tries < RETRY_DELAYS_MS.length && await enabled() === true) {
            note(`SHUTTLE_COMMAND_RETRIED_${code}`);
            const after = Number.isSafeInteger(error.retryAfterMs) ? error.retryAfterMs : 0;
            await pause(Math.min(RETRY_WAIT_LIMIT_MS, Math.max(RETRY_DELAYS_MS[tries], after)));
            continue;
          }
          note(`SHUTTLE_COMMAND_FAILED_${code}`);
          if (envelope.command === 'shuttle.control') await restore(envelope, seen.actor);
          return outcome(error, envelope);
        }
      }
    },
  });
}

/** Explicit command union. No arbitrary operation name or dynamic plugin dispatch. */
export function createAdministrationCommands({ sophieMember = null, moderation, onboarding, onboardingClosure = null, assistance = null, deliveryIssues = null, caseLifecycle = null, caseStaff = null, caseIntake = null, caseDeliveryIssues = null, caseParticipants = null, caseContacts = null, caseReplies = null, publicAnswers = null, caseAnswers = null, knowledgeLookup = null, shuttleProgress = null, memberWatch = null }) {
  return Object.freeze({ async execute(envelope) {
    if (envelope.command === 'shuttle.progress') return shuttleProgress === null ? 'denied' : shuttleProgress.execute(envelope);
    if (envelope.command === 'member.watch') return memberWatch === null ? 'denied' : memberWatch.execute(envelope);
    if (typeof envelope.command === 'string' && envelope.command.startsWith('sophie.')) return sophieMember === null ? 'denied' : sophieMember.execute(envelope);
    if(envelope.command==='knowledge.lookup')return knowledgeLookup===null ? 'denied':knowledgeLookup.execute(envelope);
    if (['ticket.answer','ticket.answer.confirm','ticket.answer.cancel'].includes(envelope.command)) return caseAnswers === null ? 'denied' : caseAnswers.execute(envelope);
    if (['answer.list', 'answer.show'].includes(envelope.command)) return publicAnswers === null ? 'denied' : publicAnswers.execute(envelope);
    if (envelope.command === 'ticket.reply') return caseReplies === null ? 'denied' : caseReplies.execute(envelope);
    if (['ticket.contact.start', 'ticket.contact.select', 'ticket.contact.cancel', 'ticket.contact.queue', 'ticket.contact.destination'].includes(envelope.command)) return caseContacts === null ? 'denied' : caseContacts.execute(envelope);
    if (envelope.command === 'ticket.participant') return caseParticipants === null ? 'denied' : caseParticipants.execute(envelope);
    if (['ticket.issues', 'ticket.issue.recheck', 'ticket.message.recover', 'ticket.channel.choose'].includes(envelope.command)) return caseDeliveryIssues === null ? 'denied' : caseDeliveryIssues.execute(envelope);
    if (['ticket.begin', 'ticket.submit', 'ticket.destination'].includes(envelope.command)) return caseIntake === null ? 'denied' : caseIntake.execute(envelope);
    if (['ticket.queue', 'ticket.claim', 'ticket.unclaim', 'ticket.assign', 'ticket.label'].includes(envelope.command)) return caseStaff === null ? 'denied' : caseStaff.execute(envelope);
    if (['ticket.status', 'ticket.close', 'ticket.reopen'].includes(envelope.command)) return caseLifecycle === null ? 'denied' : caseLifecycle.execute(envelope);
    if (['shuttle.issues', 'shuttle.issue.recheck', 'shuttle.message.recover', 'shuttle.channel.choose'].includes(envelope.command)) return deliveryIssues === null ? 'denied' : deliveryIssues.execute(envelope);
    if (['shuttle.queue', 'shuttle.help.resolve'].includes(envelope.command)) return assistance === null ? 'denied' : assistance.execute(envelope);
    if (envelope.command === 'shuttle.close') return onboardingClosure === null ? 'denied' : onboardingClosure.execute(envelope);
    if (['shuttle.start', 'shuttle.control'].includes(envelope.command)) return onboarding.execute(envelope);
    if (['mute', 'unmute'].includes(envelope.command)) return moderation.execute(envelope);
    return 'denied';
  } });
}
