import { readSystemWording } from './system-wording.js';
import { randomBytes, createHash } from 'node:crypto';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { requireOnboardingEligibility } from '../../../modules/membership/index.js';
import { advanceOnboarding, backOnboarding, retryWhitelist, pauseOnboarding, nextOnboardingScreen, previousOnboardingScreen } from '../../../modules/onboarding/index.js';
import { requireScreenId, renderOnboardingScreen } from '../../../modules/onboarding/screens.js';
import { createMemberOperation, lockMember } from './members.js';
import { createOnboardingCaseAccess } from './onboarding-case-access.js';
import { getDefinition, getPublication, getSession, saveSession, requestOnboardingScreen } from './onboarding-records.js';
import { receipt, saveReceipt } from './receipts.js';
import { enqueue, lockClaim, finishClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';
import { recordOnboardingAlert } from './onboarding-alert-records.js';

/** Core-only metadata and deterministic controls. No case text input or generic endpoint. */
export function createOnboardingScreenStore({ pool, clock, authorize, policy, caseVerification, messageVerification }) {
  const { binding, verify: caseProof } = createOnboardingCaseAccess({ policy, verification: caseVerification });
  const memberOperation = createMemberOperation({ pool, clock });
  async function screenFor(client, member, id) {
    requireScreenId(id);
    const row = (await client.query(`SELECT * FROM sophie_core.shuttle_screens
      WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE`, [id, member.guildId, member.userId])).rows[0];
    requireCondition(row !== undefined, 'SHUTTLE_SCREEN_NOT_FOUND'); return row;
  }
  async function messageProof(kind, proof, current) {
    requireCondition(typeof messageVerification?.[kind] === 'function', 'SHUTTLE_VERIFIER_REQUIRED');
    return messageVerification[kind](proof, { screenId: current.screen.id, plan: current.plan,
      channelId: current.channelId, payload: current.payload });
  }
  async function self(actor, member) {
    requireCondition(await authorize('shuttle.self', actor, { guildId: member.guildId, userId: member.userId }) === true, 'OPERATION_DENIED');
    requireOnboardingEligibility(member, clock());
  }
  async function controlState(client, member, { screenId, channelId, messageId }) {
    requireId(channelId); requireId(messageId);
    const screen = await screenFor(client, member, screenId);
    requireCondition(screen.channel_id === channelId && screen.message_id === messageId, 'FOREIGN_SHUTTLE_CONTROL');
    const session = await getSession(client, screen.session_id, member.guildId, member.userId);
    requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
    const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
    requireCondition(definition.status === 'published', 'DEFINITION_WITHDRAWN');
    const bound = await binding(client, member, session);
    requireCondition(bound.row.state === 'open' && bound.row.channel_id === channelId && bound.plan.presenceEpoch === member.presenceEpoch, 'SHUTTLE_CASE_UNAVAILABLE');
    return { screen, session, definition, ...bound };
  }
  async function renderState(client, member, claim) {
    const job = await lockClaim(client, claim);
    requireCondition(job.kind === 'shuttle.render' && job.effect.guildId === member.guildId && job.effect.userId === member.userId, 'WRONG_JOB_KIND');
    const screen = await screenFor(client, member, job.effect.screenId);
    const session = await getSession(client, screen.session_id, member.guildId, member.userId);
    const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
    const publication = await getPublication(client, session);
    const { row, plan } = await binding(client, member, session, true, screen.channel_id);
    const eligible = screen.current && screen.snapshot.version === session.version && screen.snapshot.nonce === session.nonce &&
      Number(screen.access_epoch) === member.accessEpoch && session.eligibilityEpoch === member.eligibilityEpoch &&
      member.observation.present && !member.observation.muzzled && !member.muteRequested &&
      plan.presenceEpoch === member.presenceEpoch && ['pending', 'open'].includes(row.state) && definition.status === 'published' &&
      (session.status !== 'complete' || member.observation.whitelist);
    if (eligible) requireCondition(row.state === 'open', 'SHUTTLE_CASE_PENDING');
    if (!eligible && screen.current) {
      await client.query('UPDATE sophie_core.shuttle_screens SET current = false, ready = false WHERE id = $1', [screen.id]);
      screen.current = false; screen.ready = false;
    }
    const channelId = screen.channel_id ?? row.channel_id;
    requireCondition(screen.channel_id === null || row.channel_id === screen.channel_id, 'CASE_CHANNEL_MISMATCH');
    const wording = await readSystemWording(client, member.guildId, screen.wording_revision);
    if (screen.wording_revision === null) await client.query('UPDATE sophie_core.shuttle_screens SET wording_revision=$2 WHERE id=$1', [screen.id, wording.revision]);
    return { screen, session, plan, channelId, removed: row.onboarding_retirement === 'removed', retired: !eligible,
      payload: renderOnboardingScreen({ screenId: screen.id, session: screen.snapshot, publication, retired: !eligible, helpRequested: screen.help_requested, controlVersion: screen.control_version }, wording.text) };
  }
  async function destinationState(client, member) {
    const found = (await client.query(`SELECT s.state FROM sophie_core.sessions s
      JOIN sophie_core.shuttle_cases b ON b.session_id = s.id AND b.guild_id = s.guild_id AND b.user_id = s.user_id
      JOIN sophie_core.shuttle_screens v ON v.session_id = s.id AND v.guild_id = s.guild_id AND v.user_id = s.user_id AND v.current
      WHERE s.guild_id = $1 AND s.user_id = $2 AND (s.current OR s.state->>'status' = 'complete')
        AND (s.state->>'eligibilityEpoch')::bigint = $3
      FOR UPDATE OF s`, [member.guildId, member.userId, member.eligibilityEpoch])).rows[0];
    requireCondition(found !== undefined, 'SHUTTLE_CASE_UNAVAILABLE');
    const session = found.state;
    requireCondition(session.status !== 'complete' || member.observation.whitelist, 'SHUTTLE_RESTART_REQUIRED');
    const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
    requireCondition(definition.status === 'published', 'DEFINITION_WITHDRAWN');
    await getPublication(client, session);
    const bound = await binding(client, member, session);
    requireCondition(['pending', 'open'].includes(bound.row.state) && bound.plan.presenceEpoch === member.presenceEpoch, 'SHUTTLE_CASE_UNAVAILABLE');
    return { session, ...bound };
  }
  return Object.freeze({
    async describeOnboardingDestination({ actor, observation }) {
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const current = await destinationState(client, member);
        if (current.row.state === 'pending') return { state: 'preparing' };
        return { state: 'ready', sessionId: current.session.id, plan: current.plan, channelId: current.row.channel_id };
      });
    },
    async confirmOnboardingDestination({ actor, observation, sessionId, proof }) {
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const current = await destinationState(client, member);
        requireCondition(current.session.id === sessionId && current.row.state === 'open', 'SHUTTLE_CASE_UNAVAILABLE');
        await caseProof(proof, current.plan, current.row.channel_id, false);
        requireFreshObservation(member.observation, clock());
        return { state: 'ready', guildId: member.guildId, channelId: current.row.channel_id };
      });
    },
    async describeOnboardingControl({ actor, observation, ...control }) {
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const { plan } = await controlState(client, member, control);
        return { plan, channelId: control.channelId };
      });
    },
    async actOnOnboarding({ actor, observation, interactionId, action, proof, ...control }) {
      requireCondition(['advance', 'back', 'retry', 'help', 'next-screen', 'previous-screen'].includes(action), 'INVALID_SHUTTLE_ACTION');
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const current = await controlState(client, member, control);
        const { screen, session, definition, plan } = current;
        await caseProof(proof, plan, control.channelId, false);
        const previous = await receipt(client, member.guildId, member.userId, interactionId,
          { action: 'shuttle.control', screenId: screen.id, control: action, channelId: control.channelId, messageId: control.messageId });
        if (previous) return { duplicate: true, session };
        requireCondition((control.controlVersion ?? 0) === screen.control_version && screen.current && screen.ready && screen.snapshot.version === session.version && screen.snapshot.nonce === session.nonce &&
          Number(screen.access_epoch) === member.accessEpoch, 'STALE_SHUTTLE_CONTROL');
        let changed = session;
        if (action === 'help') {
          requireCondition(session.status !== 'complete', 'SHUTTLE_NOT_ACTIVE');
          const requested = (await client.query("SELECT 1 FROM sophie_core.shuttle_help_requests WHERE session_id = $1 AND status = 'open' LIMIT 1", [session.id])).rowCount > 0;
          if (!requested) {
            await client.query(`INSERT INTO sophie_core.shuttle_help_requests (guild_id, interaction_id, session_id, user_id, session_version)
              VALUES ($1, $2, $3, $4, $5)`, [member.guildId, interactionId, session.id, member.userId, session.version]);
            const alert = await recordOnboardingAlert(client, { guildId: member.guildId, userId: member.userId,
              sessionId: session.id, kind: 'help', sourceId: interactionId });
            if (alert) await enqueue(client, alert);
            const publication = await getPublication(client, session);
            if (publication.helpPauses) {
              changed = pauseOnboarding(session, member, definition, { guildId: member.guildId, userId: member.userId,
                expectedVersion: session.version, nonce: session.nonce, nextNonce: randomBytes(16).toString('hex') }, clock()).session;
              await saveSession(client, changed, member);
            } else await requestOnboardingScreen(client, member, session, interactionId, { replace: true });
          }
        } else {
          const command = { guildId: member.guildId, userId: member.userId, expectedVersion: screen.snapshot.version,
            nonce: screen.snapshot.nonce, nextNonce: randomBytes(16).toString('hex') };
          const change = { advance: advanceOnboarding, back: backOnboarding, retry: retryWhitelist,
            'next-screen': nextOnboardingScreen, 'previous-screen': previousOnboardingScreen }[action](session, member, definition, command, clock());
          changed = change.session; await saveSession(client, changed, member);
          for (const effect of change.effects) await enqueue(client, effect);
        }
        await caseProof(proof, plan, control.channelId, false); requireFreshObservation(member.observation, clock());
        await saveReceipt(client, member.guildId, interactionId, { sessionId: session.id });
        return { duplicate: false, session: changed };
      });
    },
    async inspectOnboardingRender({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const current = await renderState(client, member, claim);
        if (current.removed || (current.retired && current.screen.message_id === null)) {
          await finishClaim(client, claim, 'done'); return { settled: true };
        }
        return { settled: false, screenId: current.screen.id, plan: current.plan, channelId: current.channelId,
          retired: current.retired, payload: current.payload, createStarted: current.screen.create_started, messageId: current.screen.message_id };
      });
    },
    async beginOnboardingWrite({ claim, observation, proof, message = null }) {
      return memberOperation(observation, async (client, member) => {
        const current = await renderState(client, member, claim);
        requireCondition(!current.removed, 'SHUTTLE_CASE_UNAVAILABLE');
        await caseProof(proof, current.plan, current.channelId, current.retired);
        if (message === null) {
          requireCondition(!current.retired && !current.screen.create_started && current.screen.message_id === null, 'SHUTTLE_MESSAGE_UNCERTAIN');
          await client.query('UPDATE sophie_core.shuttle_screens SET create_started = true, channel_id = $2 WHERE id = $1', [current.screen.id, current.channelId]);
        } else {
          const observed = await messageProof('candidate', message, current);
          requireCondition(!observed.missing && observed.messageId === current.screen.message_id, 'SHUTTLE_MESSAGE_OWNERSHIP');
        }
        await lockClaim(client, claim); requireFreshObservation(member.observation, clock());
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return { payload: current.payload, retired: current.retired, screenId: current.screen.id, messageId: current.screen.message_id };
      });
    },
    async noteOnboardingMessage({ claim, proof }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = (await client.query(`SELECT effect, user_id, fence, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2 AND kind = 'shuttle.render'`, [claim.guildId, claim.operationId])).rows[0];
        requireCondition(source?.dispatch_started && source.fence >= claim.fence, 'SHUTTLE_MESSAGE_UNTRUSTED');
        const member = await lockMember(client, claim.guildId, source.user_id);
        const screen = await screenFor(client, member, source.effect.screenId);
        // Retaining a late own-message ID is not an access decision; a newer policy
        // must not erase evidence of an already attempted write under the old one.
        const { plan } = await binding(client, member, screen.snapshot, false, screen.channel_id);
        const observed = await messageProof('receipt', proof, { screen, plan, channelId: screen.channel_id });
        requireCondition(screen.create_started && !observed.missing, 'SHUTTLE_MESSAGE_UNTRUSTED');
        requireCondition(screen.message_id === null || screen.message_id === observed.messageId, 'SHUTTLE_MESSAGE_COLLISION');
        await client.query('UPDATE sophie_core.shuttle_screens SET message_id = $2 WHERE id = $1', [screen.id, observed.messageId]);
        if (!screen.current || source.fence !== claim.fence) await enqueue(client, { kind: 'shuttle.render',
          operationId: `screen.late.${screen.id}.${claim.fence}`, guildId: member.guildId, userId: member.userId, screenId: screen.id });
      });
    },
    async confirmOnboardingRender({ claim, observation, proof, message }) {
      return memberOperation(observation, async (client, member) => {
        const current = await renderState(client, member, claim);
        await caseProof(proof, current.plan, current.channelId, current.retired);
        const observed = await messageProof('candidate', message, current);
        requireCondition(observed.messageId === current.screen.message_id, 'SHUTTLE_MESSAGE_OWNERSHIP');
        if (observed.missing) {
          await client.query('UPDATE sophie_core.shuttle_screens SET current = false, ready = false WHERE id = $1', [current.screen.id]);
          if (!current.retired) await requestOnboardingScreen(client, member, current.session, `missing.${current.screen.id}`);
          await finishClaim(client, claim, 'done'); return { settled: true, replacedMissing: !current.retired };
        }
        if (!await messageProof('matches', message, current)) return { settled: false };
        await client.query('UPDATE sophie_core.shuttle_screens SET ready = $2 WHERE id = $1', [current.screen.id, !current.retired]);
        requireFreshObservation(member.observation, clock());
        await finishClaim(client, claim, 'done'); return { settled: true, current: !current.retired };
      });
    },
    async noteUncertainOnboardingWrite(claim) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = (await client.query(`SELECT effect, user_id, fence, dispatch_started FROM sophie_core.outbox
          WHERE guild_id = $1 AND operation_id = $2 AND kind = 'shuttle.render'`, [claim.guildId, claim.operationId])).rows[0];
        requireCondition(source?.dispatch_started && source.fence >= claim.fence, 'SHUTTLE_MESSAGE_UNTRUSTED');
        await lockMember(client, claim.guildId, source.user_id);
        const suffix = createHash('sha256').update(JSON.stringify([claim.operationId, claim.fence])).digest('hex');
        await enqueue(client, { kind: 'shuttle.render', operationId: `screen.recheck.${suffix}`,
          guildId: claim.guildId, userId: source.user_id, screenId: source.effect.screenId });
      });
    },
  });
}
