import { defaultSystemText } from '../../../contracts/system-messages.js';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { casePlanKey, validateCasePlan } from '../../../modules/tickets/channel-policy.js';
import { ticketDirectNotice } from '../../../modules/tickets/direct-notice.js';

/** No DM history, free-form messages, recipient selection or incoming-DM subscription. */
export function createCaseDirectNotices({ transport, channels, roles, botUserId, clock, readSystemText = async () => defaultSystemText }) {
  requireId(botUserId);
  const destinations = new WeakMap(), receipts = new WeakMap();
  async function destination(proof, plan) {
    const held = destinations.get(proof);
    requireCondition(held?.key === casePlanKey(plan), 'CASE_DM_UNTRUSTED');
    requireFreshObservation(held, clock());
    requireCondition(await roles.readContinuity() === held.version, 'OBSERVATION_INVALIDATED');
    requireFreshObservation(held, clock()); return held.channelId;
  }
  return Object.freeze({
    verification: Object.freeze({ destination,
      receipt(proof, expected) {
        const held = receipts.get(proof);
        requireCondition(held && ['caseId', 'userId', 'guildId', 'dmChannelId', 'channelId', 'nonce'].every(key => held[key] === expected[key]), 'CASE_DM_UNTRUSTED');
        return held.messageId;
      },
    }),
    async prepare(plan) {
      validateCasePlan(plan); requireCondition(plan.guildId === transport.guildId, 'FOREIGN_GUILD');
      const version = await roles.readContinuity(), observedAt = clock();
      const raw = await transport.createTicketDm(plan.openerId);
      requireId(raw?.id);
      requireCondition(raw.type === 1 && raw.guild_id === undefined && raw.recipients?.length === 1 &&
        raw.recipients[0].id === plan.openerId && raw.recipients[0].bot !== true, 'CASE_DM_UNTRUSTED');
      const proof = Object.freeze({});
      destinations.set(proof, { key: casePlanKey(plan), channelId: raw.id, version, observedAt, known: true });
      await destination(proof, plan); return proof;
    },
    async send({ plan, channelId, nonce, dm, channel }) {
      const text = await readSystemText();
      const dmChannelId = await destination(dm, plan);
      const verified = await channels.verification.channel(channel, plan, false);
      requireCondition(verified.id === channelId, 'CASE_CHANNEL_MISMATCH');
      const raw = await transport.sendTicketDm(dmChannelId, channelId, nonce, text);
      requireId(raw?.id);
      requireCondition(raw.channel_id === dmChannelId && raw.author?.id === botUserId && raw.author.bot === true && raw.type === 0 &&
        raw.webhook_id === undefined && raw.content === ticketDirectNotice(plan.guildId, channelId, text).content &&
        Array.isArray(raw.attachments) && raw.attachments.length === 0 && Array.isArray(raw.embeds) && raw.embeds.length === 0 &&
        (raw.components === undefined || (Array.isArray(raw.components) && raw.components.length === 0)) &&
        raw.mention_everyone === false && Array.isArray(raw.mentions) && raw.mentions.length === 0 &&
        Array.isArray(raw.mention_roles) && raw.mention_roles.length === 0, 'CASE_DM_UNTRUSTED');
      const proof = Object.freeze({});
      receipts.set(proof, { caseId: plan.id, userId: plan.openerId, guildId: plan.guildId, dmChannelId, channelId, nonce, messageId: raw.id });
      return proof;
    },
  });
}
