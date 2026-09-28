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
import { aiDigest } from '../storage/ai-controls.js';
import { createAiAccounting } from '../storage/ai-accounting.js';
import { createAiEffects } from '../storage/ai-effects.js';
import { createMeteredAiWorker } from './ai-provider.js';

/** Core composition only. Inference receives a fixed turn payload, never this pool or Discord transport. */
export function createAiRuntime({ configuration, corePool, controlPool, worker, knowledge, observer, token, fetch, clock, enabled, onFault,
  remoteProcessingApproved = async () => false }) {
  requireCondition(worker && typeof worker.generate === 'function' && typeof worker.current === 'function' && knowledge &&
    ['lookup','current','currentReferences'].every(name => typeof knowledge[name] === 'function'), 'AI_ADAPTERS_REQUIRED');
  const { mapping, casePolicy, capabilityPolicy } = configuration;
  const transport = createDiscordTransport({ guildId: mapping.guildId, token, fetch, clock, enabled });
  const observations = createAiObservations({ pool: corePool, transport, authorityStore: createActorAuthorityStore({ pool: corePool, clock }),
    capabilityPolicy, mapping, protectedCategoryId: casePolicy.categoryId, observer, clock });
  const ingress = createAiIngress({ guildId: mapping.guildId, botUserId: mapping.botUserId, clock });
  let recovered = false;
  requireCondition(typeof remoteProcessingApproved === 'function', 'TRUSTED_ADAPTERS_REQUIRED');
  const admission = createAiAdmission({ pool: controlPool, guildId: mapping.guildId, ingress, ...observations, clock,
    noticeRevision: worker.provider === 'deepseek' ? 2 : 1,
    inspectContext: async event => !recovered || worker.provider === 'deepseek' && await remoteProcessingApproved() !== true ? null : observations.inspectContext(event) });
  const accounting = createAiAccounting({ pool: controlPool, guildId: mapping.guildId });
  const inference = worker.provider === 'deepseek' ? createMeteredAiWorker({ worker, accounting }) : worker;
  const scheduler = createAiScheduler({ clock, execute: async (payload, context) => {
    requireCondition(await worker.current(payload) === true, 'AI_WORKER_NOT_QUALIFIED');
    return inference.generate(payload, context);
  } });
  const effects = createAiEffects({ pool: controlPool, guildId: mapping.guildId, clock });
  const messages = createAiMessages({ transport, botUserId: mapping.botUserId, revalidate: admission.revalidate, canReact: observations.canReact, effects, clock });
  const turns = createAiTurns({ admission, scheduler, context: createAiContext({ clock }), knowledge, messages, clock,
    onInvalidate: filter => { void effects.invalidate(filter).catch(() => onFault('AI_CONTROL_UNAVAILABLE')); } });
  const gateway = createAiGateway({ ingress, turns, onFault });
  let timer = null, stopped = false, fingerprint = null, refreshing = Promise.resolve();
  function invalidate() { observations.clear(); gateway.invalidate(); }
  async function refresh() {
    try {
      if (!recovered) { await effects.recover(); recovered = true; }
      const state = (await controlPool.query('SELECT epoch,disabled FROM sophie_ai.state WHERE guild_id=$1', [mapping.guildId])).rows[0];
      const qualifications = (await controlPool.query('SELECT channel_id,boundary_epoch,active,restore_ready,release_sha256,evidence_sha256 FROM sophie_ai.qualifications WHERE guild_id=$1 ORDER BY channel_id', [mapping.guildId])).rows;
      const next = aiDigest({ state: state ?? null, qualifications });
      if (state?.disabled !== false || next !== fingerprint || !await enabled()) invalidate();
      fingerprint = next; await admission.expire(); await accounting.expire();
      for (const effect of await effects.pending()) {
        let current = effect.state === 'confirmed';
        try {
          for (const source of effect.dependencies) if (current && !await admission.revalidateEffect(source)) current = false;
          if (current) current = await knowledge.currentReferences(effect.sources, { guildId: mapping.guildId, deadline: clock() + 5000 });
        } catch { current = false; }
        if (!current) try {
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
      await refresh(); schedule();
    },
    async stop() { stopped = true; clearTimeout(timer); invalidate(); await gateway.stop(); await worker.stop?.(); await refreshing; },
    status() { return { ...scheduler.status(), stopped, qualification: 'per-request-required' }; },
  });
}
