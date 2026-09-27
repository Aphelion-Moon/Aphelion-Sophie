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

/** Core composition only. Inference receives a fixed turn payload, never this pool or Discord transport. */
export function createAiRuntime({ configuration, corePool, controlPool, worker, knowledge, observer, token, fetch, clock, enabled, onFault }) {
  requireCondition(worker && typeof worker.generate === 'function' && typeof worker.current === 'function' && knowledge &&
    typeof knowledge.lookup === 'function' && typeof knowledge.current === 'function', 'AI_ADAPTERS_REQUIRED');
  const { mapping, casePolicy, capabilityPolicy } = configuration;
  const transport = createDiscordTransport({ guildId: mapping.guildId, token, fetch, clock, enabled });
  const observations = createAiObservations({ pool: corePool, transport, authorityStore: createActorAuthorityStore({ pool: corePool, clock }),
    capabilityPolicy, mapping, protectedCategoryId: casePolicy.categoryId, observer, clock });
  const ingress = createAiIngress({ guildId: mapping.guildId, botUserId: mapping.botUserId, clock });
  const admission = createAiAdmission({ pool: controlPool, guildId: mapping.guildId, ingress, ...observations, clock });
  const scheduler = createAiScheduler({ clock, execute: async (payload, context) => {
    requireCondition(await worker.current(payload) === true, 'AI_WORKER_NOT_QUALIFIED');
    return worker.generate(payload, context);
  } });
  const messages = createAiMessages({ transport, botUserId: mapping.botUserId, revalidate: admission.revalidate, canReact: observations.canReact, clock });
  const turns = createAiTurns({ admission, scheduler, context: createAiContext({ clock }), knowledge, messages, clock });
  const gateway = createAiGateway({ ingress, turns, onFault });
  let timer = null, stopped = false, fingerprint = null, refreshing = Promise.resolve();
  function invalidate() { observations.clear(); gateway.invalidate(); }
  async function refresh() {
    try {
      const state = (await controlPool.query('SELECT epoch,disabled FROM sophie_ai.state WHERE guild_id=$1', [mapping.guildId])).rows[0];
      const qualifications = (await controlPool.query('SELECT channel_id,boundary_epoch,active,restore_ready,release_sha256,evidence_sha256 FROM sophie_ai.qualifications WHERE guild_id=$1 ORDER BY channel_id', [mapping.guildId])).rows;
      const next = aiDigest({ state: state ?? null, qualifications });
      if (state?.disabled !== false || next !== fingerprint || !await enabled()) invalidate();
      fingerprint = next; await admission.expire();
    } catch { invalidate(); onFault('AI_CONTROL_UNAVAILABLE'); }
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => { refreshing = refresh().finally(schedule); }, 1000);
  }
  return Object.freeze({
    ...gateway, invalidate,
    async start() { requireCondition(timer === null && !stopped, 'AI_RUNTIME_ALREADY_STARTED'); await refresh(); schedule(); },
    async stop() { stopped = true; clearTimeout(timer); invalidate(); await gateway.stop(); await refreshing; },
    status() { return { ...scheduler.status(), stopped, qualification: 'per-request-required' }; },
  });
}
