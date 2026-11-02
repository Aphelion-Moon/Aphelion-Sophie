// One evaluated AI turn (workplan P55a), assembled as core's ai-turns.js assembles it: the published character and
// channel context, the real prompt builder, the model output through the real validation, the shared reply checks
// (unbacked claims, unlisted channels and commands, incident verdicts, unsupported numbers) and the real rendering. The model
// call is injected, so the oracle and end-to-end modes share this path and tests use a fake; finishTurn replays stored outputs.
import { buildAiPrompt, aiSpeakerLabels } from '../../../apps/knowledge-worker/prompt.js';
import { validateAiOutput, renderAiReply } from '../../../modules/assistant/output.js';
import { answeredOutput, checkedReplyOutput } from '../../../modules/assistant/reply-checks.js';
import { aiCommandNames } from '../../../modules/assistant/capabilities.js';
import { defaultAiContexts, defaultParticipation, participationDecision } from '../../../modules/assistant/participation.js';
import { defaultSystemText } from '../../../contracts/system-messages.js';

// Synthetic Discord IDs; nothing here names a real member or channel.
export const speakerId = n => `10000000000000000${n}`.slice(-18);
const CHANNEL_ID = '100000000000000999';

/**
 * A case: { id, context: chat|support|staff, game?, text, history?: [{speaker, text}|{assistant}], notes?, memories?,
 * memoryOff?, proactive? }. The member asking is speaker 1.
 */
export function prepareTurn(item, sources, { guildId, character, configuration, now = Date.now() }) {
  const base = configuration?.contexts?.[item.context] ?? defaultAiContexts()[item.context];
  if (!base) throw new Error('AI_EVAL_CONTEXT_INVALID');
  const context = { name: item.context, ...base, ...(item.game !== undefined ? { game: item.game } : {}) };
  const profile = defaultParticipation(item.context === 'support' ? 'questions' : 'addressed');
  const decision = participationDecision(profile, { addressed: !item.proactive, question: true, directedToOther: false, now });
  const history = (item.history ?? []).map((row, index) => row.assistant !== undefined
    ? { kind: 'assistant', text: row.assistant, messageId: `h${index}` }
    : { kind: 'member', userId: speakerId(row.speaker ?? 1), text: row.text, messageId: `h${index}` });
  const request = { guildId, channelId: CHANNEL_ID, userId: speakerId(1), text: item.text, character, decision, context, profile,
    config: { emojis: configuration?.emojis ?? [], ...(configuration?.directory ? { directory: configuration.directory } : {}) }, deadline: now + context.deadlineMs };
  // As core does since 24 October 2026: only the requester's own member memories (and the channel's), none in staff channels.
  const memories = item.memoryOff || item.context === 'staff' ? null : (item.memories ?? [])
    .filter(row => row.scope === 'channel' || row.about.length === 1 && row.about[0] === 1).map((row, index) => ({ id: `m${index}`, scope: row.scope,
      subjects: row.about.map(speakerId), subjectEpochs: row.about.map(() => 1),
      text: row.text.replace(/Member (\d)/gu, (_, n) => `{${row.about.indexOf(Number(n)) + 1}}`) }));
  const memory = item.notes ? { replyLength: null, language: null, notes: item.notes } : null;
  const prompt = buildAiPrompt({ request, history, sources, memory, memories });
  const payload = { workerDomain: 'public', releaseHash: 'a'.repeat(64), requesterId: speakerId(1), restricted: item.context === 'staff',
    ...(item.context === 'staff' ? { staff: true } : {}), boundary: { guildId, channelId: CHANNEL_ID, continuity: 'evaluation', boundaryEpoch: 1 }, ...prompt };
  return { request, history, memories, payload };
}

/** Runs one turn with `generate(payload)` standing in for the model call; never throws, errors are recorded. */
export async function runTurn(item, sources, { guildId, character, configuration, generate, now = Date.now() }) {
  const record = { id: item.id, sources: sources.map(({ id, title, heading, url, authority, game }) => ({ id, title, heading, url, authority, ...(game ? { game } : {}) })) };
  let turn;
  try { turn = prepareTurn(item, sources, { guildId, character, configuration, now }); }
  catch (error) { return { ...record, error: error.code ?? error.message }; }
  record.requesterLabel = aiSpeakerLabels(turn.request, turn.history).get(turn.request.userId);
  let output;
  try { output = await generate(turn.payload); } catch (error) { return { ...record, error: error.code ?? error.message }; }
  return finishTurn({ ...record, raw: output }, output, turn, sources);
}

/** What core does after the model call: validation, the reply checks and rendering. Never throws; failures are recorded. */
export async function finishTurn(record, output, { request, history, memories }, sources) {
  const speakers = aiSpeakerLabels(request, history), own = speakers.get(request.userId);
  try {
    const dropped = [];
    let valid = validateAiOutput(output, { outcomes: request.decision.outcomes, answerOnly: request.decision.answerOnly, sources,
      emojiKeys: request.config.emojis.map(emoji => emoji.key), replyChars: request.context.replyChars,
      ...(memories === null ? {} : { memoryLabels: [...speakers.values()], memoryRequester: own }), onDropped: (kind, count) => dropped.push(`${kind}:${count}`) });
    record.dropped = dropped;
    if (valid.kind === 'reply') {
      const others = [...speakers.values()].filter(label => label !== own);
      const checked = await checkedReplyOutput(valid, { remembered: memories !== null && (valid.memories?.length ?? 0) > 0, own, others,
        commands: aiCommandNames(request.context), directory: request.config.directory ?? [], sources,
        said: [request.text, ...history.filter(item => item.kind !== 'assistant').map(item => item.text)].join('\n'),
        fallback: async kind => defaultSystemText(kind === 'claim' ? 'ai.reply.claim_removed' : 'ai.reply.unsupported_removed') });
      const removed = Object.entries(checked.removed).filter(([, count]) => count > 0);
      if (removed.length) record.removed = Object.fromEntries(removed);
      valid = checked.output;
    }
    const answered = await answeredOutput(valid, { addressed: request.decision.proactive === false && request.decision.outcomes.includes('reply'),
      contextName: request.context.name, wording: async name => defaultSystemText(name === 'staff' ? 'ai.reply.silent_addressed_staff' : 'ai.reply.silent_addressed') });
    if (answered.templated) record.silentAddressed = true;
    valid = answered.output;
    record.outcome = valid.kind; record.support = valid.support ?? null; record.citations = valid.citations ?? [];
    record.memoriesProposed = valid.memories ?? [];
    if (valid.kind === 'reply') {
      const rendered = renderAiReply(valid, sources, { replyChars: request.context.replyChars, channels: request.config.directory ?? [] });
      record.rendered = { content: rendered.content, embeds: (rendered.embeds ?? []).map(embed => embed.description) };
    }
  } catch (error) { record.validation = error.code ?? error.message; }
  return record;
}
