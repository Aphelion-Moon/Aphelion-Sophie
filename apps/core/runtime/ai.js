import { requireCondition } from '../../../contracts/validation.js';
import { createAiScheduler } from '../../knowledge-worker/scheduler.js';
import { createAiContext } from '../../knowledge-worker/context.js';
import { createAiIngress } from '../discord/ai-ingress.js';
import { createAiObservations } from '../discord/ai-observations.js';
import { createAiGateway } from '../discord/ai-gateway.js';
import { createAiTurns } from '../discord/ai-turns.js';
import { createAiMessages } from '../discord/ai-messages.js';
import { createDiscordTransport } from '../discord/transport.js';
import { createActorAuthorityStore } from '../storage/actor-authority.js';
import { createAiAdmission } from '../storage/ai-admission.js';
import { aiDigest, recordAiInvitation } from '../storage/ai-controls.js';
import { renderSophieInvitation } from '../../../modules/assistant/member-panel.js';
import { defaultSystemText } from '../../../contracts/system-messages.js';
import { createAiAccounting } from '../storage/ai-accounting.js';
import { createAiEffects } from '../storage/ai-effects.js';
import { createMeteredAiWorker } from './ai-provider.js';
import { withCodeSearch } from '../../knowledge/code-search.js';
import { runtimeScope } from './configuration.js';

/** Core composition only. Inference receives a fixed turn payload, never this pool or Discord transport. */
export function createAiRuntime({ configuration, corePool, controlPool, worker, knowledge, observer, guildState, token, fetch, clock, enabled, rateLimits, onFault,
  readNotice = async () => ({ revision: worker.provider === 'mistral' ? 2 : 1, binding: null, approved: worker.provider !== 'mistral' }), privacyCurrent = async () => false, memory = null, memories = null, readSystemText = async () => defaultSystemText,
  staffChannels = async () => false, codeSearch = null }) {
  requireCondition(worker && typeof worker.generate === 'function' && typeof worker.current === 'function' && knowledge &&
    ['lookup','current','currentReferences'].every(name => typeof knowledge[name] === 'function'), 'AI_ADAPTERS_REQUIRED');
  const { mapping, casePolicy, capabilityPolicy } = configuration;
  // Contexts with code search on also get line windows from the community's public code (owner decision, 23 October 2026).
  knowledge = withCodeSearch(knowledge, codeSearch, onFault);
  const transport = createDiscordTransport({ guildId: mapping.guildId, token, fetch, clock, enabled, scope: runtimeScope(configuration), ...(rateLimits ? { limits: rateLimits } : {}) });
  const observations = createAiObservations({ pool: corePool, transport, guildState, authorityStore: createActorAuthorityStore({ pool: corePool, clock }),
    capabilityPolicy, mapping, protectedCategoryId: casePolicy.categoryId, aiChannelExceptions: configuration.aiChannelExceptions ?? [], observer, clock, trace: onFault });
  const ingress = createAiIngress({ guildId: mapping.guildId, botUserId: mapping.botUserId, clock });
  let recovered = false;
  const admission = createAiAdmission({ pool: controlPool, guildId: mapping.guildId, ingress, ...observations, clock,
    noticeRevision: worker.provider === 'mistral' ? 2 : 1, readNotice, privacyCurrent, staffChannels, trace: reason => onFault(`AI_ADMISSION_SKIPPED_${reason}`),
    inspectContext: async event => recovered ? observations.inspectContext(event) : null,
    // Fire and forget: the invitation is a fixed core message and never delays or changes admission.
    invite: ({ channelId, userId, messageId }) => { void (async () => {
      if (await recordAiInvitation(controlPool, mapping.guildId, userId)) await transport.sendSophieInvitation(channelId, messageId, renderSophieInvitation(await readSystemText()));
    })().catch(() => onFault('AI_INVITATION_UNAVAILABLE')); } });
  const accounting = createAiAccounting({ pool: controlPool, guildId: mapping.guildId });
  const inference = worker.provider === 'mistral' ? createMeteredAiWorker({ worker, accounting }) : worker;
  // Inference is a remote API call, not local CPU work: two turns in different channels may generate at once.
  const scheduler = createAiScheduler({ clock, maxActive: 2, execute: async (payload, context) => {
    try {
      requireCondition(await worker.current(payload) === true, 'AI_WORKER_NOT_QUALIFIED');
      return await inference.generate(payload, context);
    } catch (error) {
      // The scheduler reduces every failure to a state; keep the fixed contract code for diagnosis.
      const code = error?.code ?? error?.message;
      onFault(`AI_GENERATE_FAILED_${typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/u.test(code) ? code : 'ERROR'}`);
      throw error;
    }
  } });
  const effects = createAiEffects({ pool: controlPool, guildId: mapping.guildId, clock });
  const messages = createAiMessages({ transport, botUserId: mapping.botUserId, canReact: observations.canReact, effects, clock });
  const turns = createAiTurns({ admission, scheduler, context: createAiContext({ clock }), knowledge, messages, clock, memory, memories, trace: onFault,
    // Message edits and deletes also drop cached source metadata, so a changed message is always re-read.
    onInvalidate: filter => { observations.clear(); void effects.invalidate(filter).catch(() => onFault('AI_CONTROL_UNAVAILABLE')); } });
  const gateway = createAiGateway({ ingress, turns, onFault });
  let timer = null, stopped = false, fingerprint = null, refreshing = Promise.resolve();
  function invalidate() { observations.clear(); gateway.invalidate(); }
  // Accounting expiry shares the AI advisory lock, which admission holds across its Discord observations. Waiting out
  // lock_timeout (55P03) there is contention, not a control failure: defer to the next cycle instead of invalidating the
  // in-flight admission, which otherwise refuses its own message as CONTEXT_UNAVAILABLE.
  async function expireUnlessContended(expire) {
    try { await expire(); } catch (error) { if (error?.code !== '55P03') throw error; onFault('AI_EXPIRY_DEFERRED'); }
  }
  async function refresh() {
    try {
      if (!recovered) { await effects.recover(); recovered = true; }
      const state = (await controlPool.query('SELECT epoch,disabled FROM sophie_ai.state WHERE guild_id=$1', [mapping.guildId])).rows[0];
      const qualifications = (await controlPool.query('SELECT channel_id,boundary_epoch,active,restore_ready,release_sha256,evidence_sha256 FROM sophie_ai.qualifications WHERE guild_id=$1 ORDER BY channel_id', [mapping.guildId])).rows;
      const next = aiDigest({ state: state ?? null, qualifications });
      if (state?.disabled !== false || next !== fingerprint || !await enabled()) invalidate();
      fingerprint = next; await admission.expire(); await expireUnlessContended(() => accounting.expire());
      // Delivered replies are not re-verified (owner decision, 12 October 2026). Only effects an explicit withdrawal
      // marked for cleanup (opt-out, departure, source edit or delete, uncertain sends after a restart) are removed.
      for (const effect of await effects.pending()) {
        try {
          await messages.remove({ guildId: mapping.guildId, channelId: effect.channel_id }, { messageId: effect.message_id, owner: effect.owner, id: effect.receipt_id });
        } catch { onFault('AI_EFFECT_RECONCILIATION_UNAVAILABLE'); }
      }
    } catch { invalidate(); onFault('AI_CONTROL_UNAVAILABLE'); }
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => { refreshing = refresh().finally(schedule); }, 1000);
  }
  return Object.freeze({
    ...gateway, invalidate,
    diagnostics:channelId=>stopped?null:turns.diagnostics({guildId:mapping.guildId,channelId}),
    async start() {
      requireCondition(timer === null && !stopped, 'AI_RUNTIME_ALREADY_STARTED');
      // The worker connection listens for the worker service, which connects on its own; turns that arrive before it does
      // end as unavailable without disabling AI (owner decision, 12 October 2026).
      await worker.start?.(); await refresh(); schedule();
    },
    async stop() { stopped = true; clearTimeout(timer); invalidate(); await gateway.stop(); await worker.stop?.(); await refreshing; },
    status() { return { ...scheduler.status(), stopped, qualification: 'per-request-required' }; },
    /** Live connection state for the dashboard: whether the worker is connected now, never a launch request. */
    workerStatus() {
      const inbox = worker.inboxStatus?.() ?? null;
      return { connected: !stopped && inbox?.connected === true, release: worker.release ? { name: worker.release.name, releaseHash: worker.release.releaseHash } : null,
        observedAt: Number.isSafeInteger(inbox?.connectedAt) ? new Date(inbox.connectedAt).toISOString() : null };
    },
    /** The installed release, only while the worker answers a probe with the matching identity (Go-live precondition). */
    async qualifiedRelease() {
      if (stopped || !worker.release || typeof worker.probe !== 'function') return null;
      try { await worker.probe({ signal: AbortSignal.timeout(5000) }); return stopped ? null : worker.release; } catch { return null; }
    },
  });
}
