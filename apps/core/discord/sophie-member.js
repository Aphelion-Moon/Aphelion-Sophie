import { ContractError, requireCondition } from '../../../contracts/validation.js';
import { defaultSystemText } from '../../../contracts/system-messages.js';
import { renderSophieConfirmation, renderSophieNotice, renderSophiePanel } from '../../../modules/assistant/member-panel.js';

const STALE = ['AI_NOTICE_STALE', 'AI_NOTICE_UNAPPROVED', 'AI_CONSENT_STALE', 'AI_PREFERENCE_STALE', 'AI_MEMORY_STALE'];
const DENIED = ['OPERATION_DENIED', 'UNTRUSTED_PRINCIPAL', 'MEMBER_ABSENT', 'CAPABILITY_REVOKED', 'FOREIGN_GUILD'];

/**
 * `/sophie` and its panel, in a channel (ephemeral) or in the member's DMs. Core only and no model: each click does its
 * one action through the shared member controls, then the reply shows the current state read afresh.
 */
export function createSophieMemberCommands({ authorization, member, verifier, transport, guildId, enabled, readSystemText = async () => defaultSystemText }) {
  requireCondition(typeof authorization?.resolveActor === 'function' && typeof member?.status === 'function' && typeof verifier?.takeSophieNotes === 'function' &&
    typeof transport?.createSophieDm === 'function' && typeof enabled === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const results = new WeakMap();
  async function actorFor(envelope) {
    requireCondition(envelope.guildId === guildId && typeof envelope.command === 'string' && envelope.command.startsWith('sophie.') &&
      envelope.targetId === envelope.userId, 'OPERATION_DENIED');
    return authorization.resolveActor(envelope);
  }
  async function sendToDms(actor) {
    const text = await readSystemText(), view = await member.status({ actor });
    try {
      const channel = await transport.createSophieDm(actor.userId);
      await transport.sendSophieDm(channel.id, renderSophiePanel({ ...view, direct: true }, text));
      return 'ai.reply.dm_sent';
    } catch { return 'ai.reply.dm_closed'; }
  }
  async function act(actor, envelope) {
    switch (envelope.command) {
      case 'sophie.panel': return {};
      case 'sophie.notice': return { view: 'notice' };
      case 'sophie.delete.ask': return { view: 'delete' };
      case 'sophie.forget.ask': return { view: 'forget' };
      case 'sophie.agree':
        await member.setChoice({ actor, enabled: true, noticeRevision: envelope.noticeRevision, noticeBinding: envelope.noticeBinding }); return { banner: 'ai.reply.yes' };
      case 'sophie.no': await member.setChoice({ actor, enabled: false }); return { banner: 'ai.reply.no' };
      case 'sophie.notes.save': {
        const notes = verifier.takeSophieNotes(envelope);
        try { await member.saveNotes({ actor, notes }); return { banner: 'ai.reply.saved' }; }
        catch (error) { if (error instanceof ContractError && error.code === 'AI_PREFERENCE_INVALID') return { banner: 'ai.reply.notes_invalid' }; throw error; }
      }
      case 'sophie.retain': await member.setRetainOnLeave({ actor, retainOnLeave: envelope.retainOnLeave }); return { banner: 'ai.reply.saved' };
      case 'sophie.forget': await member.forgetMemories({ actor }); return { banner: 'ai.reply.forgotten' };
      case 'sophie.delete': await member.deleteData({ actor }); return { banner: 'ai.reply.deleting' };
      case 'sophie.export': {
        const data = await member.exportData({ actor });
        return { banner: 'ai.reply.export', file: { name: 'sophie-my-data.json', content: `${JSON.stringify(data, null, 2)}\n` } };
      }
      case 'sophie.dm': return { banner: await sendToDms(actor) };
      default: requireCondition(false, 'OPERATION_DENIED');
    }
  }
  return Object.freeze({
    async execute(envelope) {
      if (await enabled() !== true) return 'disabled';
      let actor;
      try { actor = await actorFor(envelope); }
      catch (error) { return error instanceof ContractError && DENIED.includes(error.code) ? 'denied' : 'unavailable'; }
      try { results.set(envelope, { actor, ...await act(actor, envelope) }); }
      catch (error) {
        if (!(error instanceof ContractError)) return 'unavailable';
        if (DENIED.includes(error.code)) return 'denied';
        // A choice that changed meanwhile shows the current panel, never a silent retry of the old click.
        results.set(envelope, { actor, banner: STALE.includes(error.code) ? 'ai.reply.stale' : error.code === 'AI_DELETION_PENDING' ? 'ai.reply.deleting' : null });
        if (!STALE.includes(error.code) && error.code !== 'AI_DELETION_PENDING') return 'unavailable';
      }
      return 'sophie_panel';
    },
    /** The member's current notes, to fill the notes form; null when they cannot be read now. */
    async notes(envelope) {
      if (await enabled() !== true) return null;
      const actor = await actorFor(envelope), status = await member.status({ actor });
      return status.state === 'deleting' || status.state === 'unavailable' ? null : status.notes;
    },
    /** The reply body for a recorded panel command; `files` holds a member's own data export, never anything else. */
    async view(envelope) {
      const result = results.get(envelope); requireCondition(result !== undefined, 'INTERACTION_RESPONSE_INVALID');
      const text = await readSystemText();
      let status;
      try { status = { ...await member.status({ actor: result.actor }), direct: envelope.direct === true }; }
      catch { status = { state: 'unavailable', direct: envelope.direct === true }; }
      const banner = result.banner ? text(result.banner) : null;
      const body = result.view === 'notice' ? renderSophieNotice(status, text) : result.view === 'delete' || result.view === 'forget'
        ? renderSophieConfirmation(result.view, text) : renderSophiePanel(status, text, banner);
      // Replies edit the panel in place; without a new export, an earlier export's file is removed from it.
      return result.file ? { ...body, files: [result.file] } : { ...body, attachments: [] };
    },
  });
}
