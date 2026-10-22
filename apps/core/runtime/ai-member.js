import { requireCondition, requireId } from '../../../contracts/validation.js';

/**
 * What a member does about Sophie, shared by the Discord panel and the dashboard (owner decision, 23 October 2026): one
 * Yes or No for the whole server, notes they give her, a copy of everything she keeps, deletion, forgetting her memories
 * and the keep-on-leave choice. Every operation authorizes through the AI controls, which re-read current state.
 */
export function createAiMemberControls({ controls, requestErasure, clock = Date.now }) {
  for (const name of ['ownChoice', 'memberConsent', 'ownPreferences', 'savePreferences', 'saveRetention', 'ownMemories', 'forgetAllMemories', 'exportConsents', 'prepareDeletion'])
    requireCondition(typeof controls?.[name] === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  requireCondition(typeof requestErasure === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  async function status({ actor }) {
    const choice = await controls.ownChoice({ actor });
    if (choice.deletionPending) return { state: 'deleting', optInAvailable: false, noticeRevision: null, noticeText: null, noticeBinding: null,
      notes: [], memories: { active: false, count: 0 }, retainOnLeave: false, choiceEpoch: null, preferenceEpoch: null };
    const preferences = await controls.ownPreferences({ actor }), memories = await controls.ownMemories({ actor });
    const state = choice.choice.current ? 'yes' : choice.choice.enabled ? 'renew' : choice.choice.epoch > 0 ? 'no' : 'none';
    return { state, optInAvailable: choice.optInAvailable === true, noticeRevision: choice.noticeRevision, noticeText: choice.noticeText, noticeBinding: choice.noticeBinding,
      notes: preferences.available && !preferences.quarantined ? [...(preferences.settings?.notes ?? [])] : [],
      memories: { active: memories.available === true && memories.active === true, count: memories.available ? memories.memories.length : 0 },
      retainOnLeave: preferences.retainOnLeave === true, choiceEpoch: choice.choice.epoch, preferenceEpoch: preferences.available ? preferences.epoch : null };
  }
  return Object.freeze({
    status,
    /** A Yes accepts exactly the notice the member was shown; a changed notice is refused (AI_NOTICE_STALE). */
    async setChoice({ actor, enabled, noticeRevision = null, noticeBinding = null }) {
      const current = await controls.ownChoice({ actor });
      requireCondition(!current.deletionPending, 'AI_DELETION_PENDING');
      if (enabled) requireCondition(noticeRevision === current.noticeRevision && noticeBinding === current.noticeBinding, 'AI_NOTICE_STALE');
      return controls.memberConsent({ actor, enabled, expectedEpoch: current.choice.epoch,
        acceptedNoticeRevision: enabled ? noticeRevision : current.noticeRevision, acceptedNoticeBinding: enabled ? noticeBinding : null });
    },
    /** Notes reach Sophie whenever the member's choice is Yes; the separate sharing switch is retired. */
    async saveNotes({ actor, notes }) {
      const preferences = await controls.ownPreferences({ actor });
      requireCondition(preferences.available === true, 'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
      return controls.savePreferences({ actor, expectedEpoch: preferences.epoch, confirmed: true,
        settings: { replyLength: null, language: null, notes, useWithAi: true } });
    },
    async setRetainOnLeave({ actor, retainOnLeave }) {
      requireCondition(typeof retainOnLeave === 'boolean', 'AI_PREFERENCE_INVALID');
      const preferences = await controls.ownPreferences({ actor });
      requireCondition(preferences.available === true, 'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
      return controls.saveRetention({ actor, expectedEpoch: preferences.epoch, retainOnLeave, confirmed: true });
    },
    forgetMemories: ({ actor }) => controls.forgetAllMemories({ actor, confirmed: true }),
    /** Everything Sophie keeps about the member, in one document. */
    async exportData({ actor }) {
      const choices = await controls.exportConsents({ actor }), preferences = await controls.ownPreferences({ actor }), memories = await controls.ownMemories({ actor });
      requireCondition(preferences.available === true, 'AI_PREFERENCE_JOURNAL_UNAVAILABLE');
      requireCondition(preferences.quarantined === false, 'AI_PREFERENCE_RESTORE_QUARANTINED');
      return { kind: 'sophie-member-data', version: 1, exportedAt: new Date(clock()).toISOString(), userId: actor.userId, guildId: actor.guildId,
        choice: choices.choice, earlierChannelChoices: choices.channels,
        notes: { notes: preferences.settings?.notes ?? [], expiresAt: preferences.expiresAt === null ? null : new Date(preferences.expiresAt).toISOString() },
        keepDataIfILeave: preferences.retainOnLeave === true,
        memories: memories.available ? memories.memories.map(memory => ({ id: memory.id, scope: memory.scope, text: memory.text,
          ...(memory.channelId ? { channelId: memory.channelId } : {}), ...(Number.isSafeInteger(memory.expiresAt) ? { expiresAt: new Date(memory.expiresAt).toISOString() } : {}) })) : [] };
    },
    /** The choice becomes No at once; the erasure a departure gets then removes everything else. */
    async deleteData({ actor }) {
      requireId(actor?.userId);
      await controls.prepareDeletion({ actor, confirmed: true });
      await requestErasure(actor.userId);
      return { queued: true };
    },
  });
}
