import { readSystemWording } from './system-wording.js';
import { randomBytes, createHash } from 'node:crypto';
import { requireCondition, requireFreshObservation, requireId } from '../../../contracts/validation.js';
import { requireOnboardingEligibility } from '../../../modules/membership/index.js';
import { advanceOnboarding, backOnboarding, retryWhitelist, nextOnboardingScreen, previousOnboardingScreen } from '../../../modules/onboarding/index.js';
import { requireScreenId, onboardingStepMessages, renderOnboardingContent, renderOnboardingNav, renderOnboardingStatus } from '../../../modules/onboarding/screens.js';
import { createMemberOperation, lockMember } from './members.js';
import { createOnboardingCaseAccess } from './onboarding-case-access.js';
import { getDefinition, getPublication, getSession, saveSession, requestOnboardingScreen } from './onboarding-records.js';
import { receipt, saveReceipt } from './receipts.js';
import { enqueue, lockClaim, finishClaim, validateClaim } from './outbox.js';
import { inTransaction } from './transaction.js';

const digest = payload => createHash('sha256').update(JSON.stringify(payload)).digest('hex');
// Discord suppresses a repeated create nonce only "in the past few minutes". A part create whose response was lost
// is sent once more with the same nonce inside this window; after it, it parks for review like any uncertain create.
const NONCE_RETRY_MS = 60_000;
// No Shuttle work waits for Staff (owner direction, 20 October 2026). A create still unanswered this long after it
// started is given up: a step message is posted again with its step, a status card starts a new run. Rarely, a member
// may then see a duplicate message. Younger uncertain creates park and are rechecked automatically.
export const ABANDON_UNCERTAIN_MS = 120_000;
// How long after a click its card is checked: well beyond a click's retries (about 2 s) and its page render.
export const OPENING_WATCH_MS = 20_000;
// Fallback recheck for a first page waiting on its channel; opening the channel normally makes it due at once.
export const CASE_WAIT_MS = 30_000;

/**
 * Core-only metadata and deterministic controls. No case text input or generic endpoint.
 *
 * A run is shown as a message group: its anchor message is the status card, edited in place; the current step is
 * posted as plain messages followed by a navigation card (parts). A step change advances part_generation: older parts
 * are deleted from Discord, the new step is posted, and the status card is edited last.
 */
export function createOnboardingScreenStore({ pool, clock, authorize, policy, caseVerification, messageVerification }) {
  const { binding, verify: caseProof } = createOnboardingCaseAccess({ policy, verification: caseVerification });
  const memberOperation = createMemberOperation({ pool, clock });
  async function screenFor(client, member, id) {
    requireScreenId(id);
    const row = (await client.query(`SELECT * FROM sophie_core.shuttle_screens
      WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE`, [id, member.guildId, member.userId])).rows[0];
    requireCondition(row !== undefined, 'SHUTTLE_SCREEN_NOT_FOUND'); return row;
  }
  async function messageProof(check, proof, expected, options) {
    requireCondition(typeof messageVerification?.[check] === 'function', 'SHUTTLE_VERIFIER_REQUIRED');
    return messageVerification[check](proof, expected, options);
  }
  async function self(actor, member) {
    requireCondition(await authorize('shuttle.self', actor, { guildId: member.guildId, userId: member.userId }) === true, 'OPERATION_DENIED');
    requireOnboardingEligibility(member, clock());
  }
  async function controlState(client, member, { screenId, channelId, messageId }) {
    requireId(channelId); requireId(messageId);
    const screen = await screenFor(client, member, screenId);
    requireCondition(screen.channel_id === channelId, 'FOREIGN_SHUTTLE_CONTROL');
    // Controls live on the current navigation card. Older cards, and the buttons of a pre-upgrade single message that
    // is now this run's status card, are out of date rather than foreign. An action checks its own receipt before
    // refusing an out-of-date card, so a repeated delivery of an accepted click is still recognised.
    const part = (await client.query(`SELECT generation, kind, gone FROM sophie_core.shuttle_screen_parts
      WHERE screen_id = $1 AND message_id = $2`, [screen.id, messageId])).rows[0];
    requireCondition(part !== undefined || screen.message_id === messageId, 'FOREIGN_SHUTTLE_CONTROL');
    const card = part?.kind === 'nav' && !part.gone && part.generation === screen.part_generation;
    const session = await getSession(client, screen.session_id, member.guildId, member.userId);
    requireCondition(session.eligibilityEpoch === member.eligibilityEpoch, 'SHUTTLE_RESTART_REQUIRED');
    const definition = await getDefinition(client, session.definitionId, session.definitionVersion);
    requireCondition(definition.status === 'published', 'DEFINITION_WITHDRAWN');
    const bound = await binding(client, member, session);
    requireCondition(bound.row.state === 'open' && bound.row.channel_id === channelId && bound.plan.presenceEpoch === member.presenceEpoch, 'SHUTTLE_CASE_UNAVAILABLE');
    return { screen, session, definition, card, ...bound };
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
    const retired = !eligible;
    const status = renderOnboardingStatus({ session: screen.snapshot, publication, retired, helpRequested: screen.help_requested }, wording.text);
    // The step stays visible while Whitelist delivery is pending and once it is confirmed; only the card changes.
    const group = retired ? [] : [...onboardingStepMessages(publication, screen.snapshot.stepIndex)
      .map(message => ({ kind: 'content', payload: renderOnboardingContent(message) })),
    { kind: 'nav', payload: renderOnboardingNav({ screenId: screen.id, session: screen.snapshot, publication,
      helpRequested: screen.help_requested, controlVersion: screen.control_version }, wording.text) }];
    const parts = (await client.query(`SELECT *, floor(extract(epoch FROM clock_timestamp() - create_started_at) * 1000) AS create_age_ms
      FROM sophie_core.shuttle_screen_parts WHERE screen_id = $1 ORDER BY generation, position FOR UPDATE`, [screen.id])).rows;
    // A status card create started before migration 072 has no time; it counts as old.
    screen.create_age_ms = Number((await client.query(`SELECT coalesce(floor(extract(epoch FROM clock_timestamp() - create_started_at) * 1000),
      'Infinity'::double precision) AS age FROM sophie_core.shuttle_screens WHERE id = $1`, [screen.id])).rows[0].age);
    return { screen, session, plan, channelId, removed: row.onboarding_retirement === 'removed', retired, status, group, parts };
  }
  /** The next single Discord write toward the stored state, or null when the group is current. No side effects. */
  function nextWrite({ screen, retired, status, group, parts }) {
    if (screen.message_id === null) {
      if (retired || screen.message_gone) return null;
      if (screen.create_started && screen.create_age_ms > ABANDON_UNCERTAIN_MS) return { action: 'replace' };
      requireCondition(!screen.create_started, 'SHUTTLE_MESSAGE_UNCERTAIN');
      return { action: 'create', target: 'anchor', recordId: screen.id, kind: 'status', payload: status };
    }
    const generation = screen.part_generation;
    // Earlier steps first, then this step's surplus: each newest-first, so a navigation card goes before its step.
    const stale = parts.filter(part => !part.gone && part.message_id !== null && (retired || part.generation !== generation || part.position >= group.length))
      .sort((a, b) => a.generation - b.generation || b.position - a.position);
    if (stale.length) return { action: 'delete', target: 'part', recordId: stale[0].id, messageId: stale[0].message_id };
    for (const [position, wanted] of group.entries()) {
      const part = parts.find(row => row.generation === generation && row.position === position);
      if (part?.gone || (part && part.kind !== wanted.kind)) return { action: 'regroup' };
      if (!part) return { action: 'create', target: 'part', position, kind: wanted.kind, payload: wanted.payload };
      if (part.message_id === null) {
        if (Number(part.create_age_ms) > ABANDON_UNCERTAIN_MS) return { action: 'regroup', abandon: part.id };
        requireCondition(!part.create_retried && Number(part.create_age_ms) <= NONCE_RETRY_MS, 'SHUTTLE_MESSAGE_UNCERTAIN');
        return { action: 'create', target: 'part', retry: true, recordId: part.id, position, kind: wanted.kind, payload: wanted.payload };
      }
      const update = change(part, wanted.payload);
      if (update) return { action: update, target: 'part', recordId: part.id, messageId: part.message_id, kind: wanted.kind, payload: wanted.payload };
    }
    const update = screen.message_gone ? null : change(screen, status);
    if (update) return { action: update, target: 'anchor', recordId: screen.id, messageId: screen.message_id, kind: 'status', payload: status };
    return null;
  }
  // An unconfirmed edit to the same body may already have landed, and a re-check on entry asks the same question:
  // read the message (inspect) rather than editing it again. Otherwise edit whatever differs from the confirmed body.
  function change(row, payload) {
    const wanted = digest(payload);
    if (row.pending_sha256 === wanted) return 'inspect';
    return row.rendered_sha256 === wanted ? null : 'edit';
  }
  /** Controls are ready once this step's messages and card are all confirmed; the status card may still follow. */
  function controlsReady({ screen, retired, group, parts }) {
    return !retired && screen.message_id !== null && group.every((wanted, position) => {
      const part = parts.find(row => row.generation === screen.part_generation && row.position === position);
      return part && !part.gone && part.message_id !== null && part.rendered_sha256 === digest(wanted.payload);
    });
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
  async function claimSource(client, claim) {
    const source = (await client.query(`SELECT effect, user_id, fence, dispatch_started FROM sophie_core.outbox
      WHERE guild_id = $1 AND operation_id = $2 AND kind = 'shuttle.render'`, [claim.guildId, claim.operationId])).rows[0];
    requireCondition(source?.dispatch_started && source.fence >= claim.fence, 'SHUTTLE_MESSAGE_UNTRUSTED');
    return source;
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
      // Ask Staff is no longer offered. A button left on an older message is out of date and records nothing.
      requireCondition(action !== 'help', 'STALE_SHUTTLE_CONTROL');
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const current = await controlState(client, member, control);
        const { screen, session, definition, plan } = current;
        await caseProof(proof, plan, control.channelId, false);
        const previous = await receipt(client, member.guildId, member.userId, interactionId,
          { action: 'shuttle.control', screenId: screen.id, control: action, channelId: control.channelId, messageId: control.messageId });
        if (previous) return { duplicate: true, session };
        requireCondition(current.card && (control.controlVersion ?? 0) === screen.control_version && screen.current && screen.ready && screen.snapshot.version === session.version && screen.snapshot.nonce === session.nonce &&
          Number(screen.access_epoch) === member.accessEpoch, 'STALE_SHUTTLE_CONTROL');
        const command = { guildId: member.guildId, userId: member.userId, expectedVersion: screen.snapshot.version,
          nonce: screen.snapshot.nonce, nextNonce: randomBytes(16).toString('hex') };
        const change = { advance: advanceOnboarding, back: backOnboarding, retry: retryWhitelist,
          'next-screen': nextOnboardingScreen, 'previous-screen': previousOnboardingScreen }[action](session, member, definition, command, clock());
        await saveSession(client, change.session, member);
        for (const effect of change.effects) await enqueue(client, effect);
        await caseProof(proof, plan, control.channelId, false); requireFreshObservation(member.observation, clock());
        await saveReceipt(client, member.guildId, interactionId, { sessionId: session.id });
        return { duplicate: false, session: change.session };
      });
    },
    /**
     * A click is answered at once by disabling its card ("Opening…"). When the click then records nothing, this puts
     * the card back: it forgets the confirmed digest of that card so the next render rewrites it. It grants nothing.
     */
    async restoreOnboardingControl({ actor, observation, interactionId, action, screenId, channelId, messageId }) {
      requireId(channelId); requireId(messageId);
      const opened = ['advance', 'back', 'retry'].includes(action);
      return memberOperation(observation, async (client, member) => {
        await self(actor, member);
        const screen = await screenFor(client, member, screenId);
        requireCondition(screen.channel_id === channelId, 'FOREIGN_SHUTTLE_CONTROL');
        const part = opened ? await client.query(`UPDATE sophie_core.shuttle_screen_parts SET rendered_sha256 = NULL
          WHERE screen_id = $1 AND message_id = $2 AND kind = 'nav' AND NOT gone AND generation = $3`, [screen.id, messageId, screen.part_generation]) : { rowCount: 0 };
        // A pre-upgrade single message still showing its buttons becomes this run's status card.
        const anchor = screen.message_id === messageId ? await client.query('UPDATE sophie_core.shuttle_screens SET rendered_sha256 = NULL WHERE id = $1', [screen.id]) : { rowCount: 0 };
        if (!screen.current || !(part.rowCount || anchor.rowCount)) return { restored: false };
        await enqueue(client, { kind: 'shuttle.render', operationId: `screen.restore.${screen.id}.${interactionId}`,
          guildId: member.guildId, userId: member.userId, screenId: screen.id });
        return { restored: true };
      });
    },
    /**
     * A Continue, Back or Check click has just turned its card into "Opening…" on Discord, so the recorded body of that
     * card is no longer what Discord shows. This forgets it and queues a watch: OPENING_WATCH_MS later the card is drawn
     * again unless it has been replaced (the click recorded a change) or redrawn (the click was put back) by then. It
     * covers a click that never finishes, such as a restart in the middle. Database only; it records no progress.
     */
    async noteOnboardingOpening({ guildId, userId, interactionId, action, screenId, channelId, messageId }) {
      requireId(guildId); requireId(userId); requireId(interactionId); requireId(channelId); requireId(messageId); requireScreenId(screenId);
      if (!['advance', 'back', 'retry'].includes(action)) return { watched: false };
      return inTransaction(pool, async client => {
        const screen = (await client.query(`SELECT id, channel_id, current, part_generation FROM sophie_core.shuttle_screens
          WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE`, [screenId, guildId, userId])).rows[0];
        if (!screen?.current || screen.channel_id !== channelId) return { watched: false };
        const part = await client.query(`UPDATE sophie_core.shuttle_screen_parts SET rendered_sha256 = NULL
          WHERE screen_id = $1 AND message_id = $2 AND kind = 'nav' AND NOT gone AND generation = $3`, [screen.id, messageId, screen.part_generation]);
        if (!part.rowCount) return { watched: false };
        const operationId = `screen.opened.${screen.id}.${interactionId}`;
        await enqueue(client, { kind: 'shuttle.render', operationId, guildId, userId, screenId: screen.id,
          watch: { messageId, generation: screen.part_generation } });
        await client.query(`UPDATE sophie_core.outbox SET available_at = clock_timestamp() + $3 * interval '1 millisecond'
          WHERE guild_id = $1 AND operation_id = $2 AND status = 'ready' AND attempts = 0`, [guildId, operationId, OPENING_WATCH_MS]);
        return { watched: true };
      });
    },
    /**
     * The first page is queued with its channel. Until the channel is open there is nothing to draw, so the render steps
     * aside without reading Discord (and without holding the member's lease against the channel's own job). Opening
     * the channel makes it due at once (confirmCaseProvision); CASE_WAIT_MS is only the fallback. The reservation row is
     * locked, so an opening that commits concurrently is either seen here or wakes this job after it.
     */
    async deferOnboardingRenderUntilCase({ claim }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim);
        if (job.kind !== 'shuttle.render') return false;
        const state = (await client.query(`SELECT r.state FROM sophie_core.shuttle_screens v
          JOIN sophie_core.shuttle_cases b ON b.session_id = v.session_id AND b.guild_id = v.guild_id AND b.user_id = v.user_id
          JOIN sophie_core.case_reservations r ON r.id = b.case_id AND r.guild_id = b.guild_id AND r.user_id = b.user_id
          WHERE v.id = $1 AND v.guild_id = $2 AND v.user_id = $3 AND v.current FOR SHARE OF r`,
        [job.effect.screenId, claim.guildId, job.user_id])).rows[0]?.state;
        if (state !== 'pending') return false;
        await client.query(`UPDATE sophie_core.outbox SET status = 'ready', lease_owner = NULL, lease_until = NULL,
          available_at = clock_timestamp() + $5 * interval '1 millisecond', attempts = GREATEST(attempts - 1, 0), last_error_code = 'SHUTTLE_CASE_PENDING'
          WHERE guild_id = $1 AND operation_id = $2 AND lease_owner = $3 AND fence = $4`, [claim.guildId, claim.operationId, claim.owner, claim.fence, CASE_WAIT_MS]);
        return true;
      });
    },
    /**
     * A watch whose card was replaced or redrawn in the meantime has nothing to do: it is finished from the database
     * alone, without reading Discord. Returns false for any other render, which proceeds as usual.
     */
    async settleWatchedOnboardingRender({ claim }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const job = await lockClaim(client, claim);
        const watch = job.kind === 'shuttle.render' ? job.effect?.watch : undefined;
        if (!watch) return false;
        const row = (await client.query(`SELECT s.current, s.part_generation, p.rendered_sha256 IS NOT NULL AS drawn, coalesce(p.gone, true) AS gone
          FROM sophie_core.shuttle_screens s LEFT JOIN sophie_core.shuttle_screen_parts p ON p.screen_id = s.id AND p.message_id = $4 AND p.kind = 'nav'
          WHERE s.id = $1 AND s.guild_id = $2 AND s.user_id = $3`, [job.effect.screenId, claim.guildId, job.user_id, watch.messageId])).rows[0];
        if (row?.current && row.part_generation === watch.generation && !row.drawn && !row.gone) return false;
        await finishClaim(client, claim, 'done');
        return true;
      });
    },
    /**
     * The fallback when restoreOnboardingControl cannot read Discord (a burst of Gateway traffic or a rate limit), so a
     * card is never left showing "Opening…". The signed click names its member; this only asks for that member's own
     * current card to be drawn again. It records no progress, grants nothing and reads no Discord state: the render
     * re-checks membership, eligibility and the channel before it writes.
     */
    async releaseOnboardingControl({ guildId, userId, interactionId, action, screenId, channelId, messageId }) {
      requireId(guildId); requireId(userId); requireId(interactionId); requireId(channelId); requireId(messageId); requireScreenId(screenId);
      if (!['advance', 'back', 'retry'].includes(action)) return { restored: false };
      return inTransaction(pool, async client => {
        const screen = (await client.query(`SELECT id, channel_id, current, part_generation FROM sophie_core.shuttle_screens
          WHERE id = $1 AND guild_id = $2 AND user_id = $3 FOR UPDATE`, [screenId, guildId, userId])).rows[0];
        if (!screen?.current || screen.channel_id !== channelId) return { restored: false };
        const part = await client.query(`UPDATE sophie_core.shuttle_screen_parts SET rendered_sha256 = NULL
          WHERE screen_id = $1 AND message_id = $2 AND kind = 'nav' AND NOT gone AND generation = $3`, [screen.id, messageId, screen.part_generation]);
        if (!part.rowCount) return { restored: false };
        await enqueue(client, { kind: 'shuttle.render', operationId: `screen.restore.${screen.id}.${interactionId}`, guildId, userId, screenId: screen.id });
        return { restored: true };
      });
    },
    async inspectOnboardingRender({ claim, observation }) {
      return memberOperation(observation, async (client, member) => {
        const current = await renderState(client, member, claim);
        if (current.removed || nextWrite(current) === null) {
          await client.query('UPDATE sophie_core.shuttle_screens SET ready = $2 WHERE id = $1', [current.screen.id, controlsReady(current)]);
          await finishClaim(client, claim, 'done'); return { settled: true, current: !current.retired };
        }
        return { settled: false, screenId: current.screen.id, plan: current.plan, channelId: current.channelId, retired: current.retired };
      });
    },
    /** Commits the intent of the next write (or settles the job) and returns exactly what to send. */
    async beginOnboardingWrite({ claim, observation, proof }) {
      return memberOperation(observation, async (client, member) => {
        const current = await renderState(client, member, claim);
        requireCondition(!current.removed, 'SHUTTLE_CASE_UNAVAILABLE');
        await caseProof(proof, current.plan, current.channelId, current.retired);
        let write = nextWrite(current);
        if (write?.action === 'replace') {
          // The status card's create was never answered: start the run again with a new card at the same progress.
          await client.query('UPDATE sophie_core.shuttle_screens SET current = false, ready = false WHERE id = $1', [current.screen.id]);
          await requestOnboardingScreen(client, member, current.session, `abandoned.${current.screen.id}`);
          requireFreshObservation(member.observation, clock());
          await finishClaim(client, claim, 'done'); return { action: 'none', current: false };
        }
        if (write?.action === 'regroup') {
          // A message of this step went missing, its create was never answered, or the layout changed: post the whole
          // step again, in order.
          if (write.abandon) await client.query('UPDATE sophie_core.shuttle_screen_parts SET gone = true WHERE id = $1', [write.abandon]);
          await client.query('UPDATE sophie_core.shuttle_screens SET part_generation = part_generation + 1, ready = false WHERE id = $1', [current.screen.id]);
          current.screen.part_generation++;
          if (write.abandon) Object.assign(current.parts.find(part => part.id === write.abandon), { gone: true });
          write = nextWrite(current);
        }
        const ready = controlsReady(current);
        if (ready !== current.screen.ready) await client.query('UPDATE sophie_core.shuttle_screens SET ready = $2 WHERE id = $1', [current.screen.id, ready]);
        if (write === null) {
          requireFreshObservation(member.observation, clock());
          await finishClaim(client, claim, 'done'); return { action: 'none', current: !current.retired };
        }
        if (write.action === 'create' && write.target === 'anchor') {
          await client.query('UPDATE sophie_core.shuttle_screens SET create_started = true, create_started_at = clock_timestamp(), channel_id = $2 WHERE id = $1', [current.screen.id, current.channelId]);
        } else if (write.action === 'create' && write.retry) {
          await client.query('UPDATE sophie_core.shuttle_screen_parts SET create_retried = true WHERE id = $1', [write.recordId]);
        } else if (write.action === 'create') {
          write.recordId = randomBytes(16).toString('hex');
          await client.query(`INSERT INTO sophie_core.shuttle_screen_parts (id, screen_id, guild_id, user_id, generation, position, kind,
            create_started, create_started_at, channel_id) VALUES ($1, $2, $3, $4, $5, $6, $7, true, clock_timestamp(), $8)`,
          [write.recordId, current.screen.id, member.guildId, member.userId, current.screen.part_generation, write.position, write.kind, current.channelId]);
        } else if (write.action === 'delete') {
          await client.query('UPDATE sophie_core.shuttle_screen_parts SET delete_started = true WHERE id = $1', [write.recordId]);
        } else if (write.action === 'edit') {
          await client.query(`UPDATE sophie_core.${write.target === 'anchor' ? 'shuttle_screens' : 'shuttle_screen_parts'} SET pending_sha256 = $2
            WHERE id = $1`, [write.recordId, digest(write.payload)]);
        }
        await lockClaim(client, claim); requireFreshObservation(member.observation, clock());
        await client.query('UPDATE sophie_core.outbox SET dispatch_started = true WHERE guild_id = $1 AND operation_id = $2', [claim.guildId, claim.operationId]);
        return { ...write, screenId: current.screen.id, retired: current.retired, plan: current.plan, channelId: current.channelId };
      });
    },
    /** Retains this bot's own create result, even late or under an obsolete lease. It confirms nothing by itself. */
    async noteOnboardingMessage({ claim, proof, recordId }) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = await claimSource(client, claim);
        const member = await lockMember(client, claim.guildId, source.user_id);
        const screen = await screenFor(client, member, source.effect.screenId);
        const part = (recordId ?? screen.id) === screen.id ? null : (await client.query(`SELECT * FROM sophie_core.shuttle_screen_parts
          WHERE id = $1 AND screen_id = $2 FOR UPDATE`, [recordId, screen.id])).rows[0];
        requireCondition(part !== undefined, 'SHUTTLE_MESSAGE_UNTRUSTED');
        const target = part ?? screen;
        // Retaining a late own-message ID is not an access decision; a newer policy
        // must not erase evidence of an already attempted write under the old one.
        const { plan } = await binding(client, member, screen.snapshot, false, screen.channel_id);
        const observed = await messageProof('receipt', proof, { recordId: target.id, screenId: screen.id, plan, channelId: target.channel_id });
        requireCondition(target.create_started && !observed.missing, 'SHUTTLE_MESSAGE_UNTRUSTED');
        requireCondition(target.message_id === null || target.message_id === observed.messageId, 'SHUTTLE_MESSAGE_COLLISION');
        await client.query(`UPDATE sophie_core.${part ? 'shuttle_screen_parts' : 'shuttle_screens'} SET message_id = $2 WHERE id = $1`, [target.id, observed.messageId]);
        if (!screen.current || source.fence !== claim.fence) await enqueue(client, { kind: 'shuttle.render',
          operationId: `screen.late.${target.id}.${claim.fence}`, guildId: member.guildId, userId: member.userId, screenId: screen.id });
      });
    },
    /**
     * Confirms one write from Discord's response (fromWrite) or from a fresh read. A confirmed body records its digest;
     * a deleted part is marked gone; a message someone else deleted is reposted with its step, or replaces the run.
     */
    async confirmOnboardingWrite({ claim, observation, proof, message, write, fromWrite = true }) {
      return memberOperation(observation, async (client, member) => {
        const current = await renderState(client, member, claim);
        await caseProof(proof, current.plan, current.channelId, current.retired);
        const anchor = write.target === 'anchor';
        requireCondition(anchor ? write.recordId === current.screen.id : write.target === 'part', 'SHUTTLE_MESSAGE_UNTRUSTED');
        const target = anchor ? current.screen : current.parts.find(part => part.id === write.recordId);
        requireCondition(target !== undefined && target.channel_id !== null, 'SHUTTLE_MESSAGE_UNTRUSTED');
        const expected = { recordId: target.id, screenId: current.screen.id, plan: current.plan, channelId: target.channel_id, kind: write.kind, payload: write.payload };
        const observed = await messageProof(fromWrite ? 'written' : 'candidate', message, expected);
        requireCondition(observed.messageId === target.message_id, 'SHUTTLE_MESSAGE_OWNERSHIP');
        const table = anchor ? 'shuttle_screens' : 'shuttle_screen_parts';
        if (write.action === 'delete') {
          requireCondition(observed.missing, 'SHUTTLE_MESSAGE_UNTRUSTED');
          await client.query('UPDATE sophie_core.shuttle_screen_parts SET gone = true WHERE id = $1', [target.id]);
        } else if (observed.missing && anchor) {
          await client.query('UPDATE sophie_core.shuttle_screens SET message_gone = true, current = false, ready = false WHERE id = $1', [target.id]);
          if (!current.retired) await requestOnboardingScreen(client, member, current.session, `missing.${target.id}`);
        } else if (observed.missing) {
          await client.query('UPDATE sophie_core.shuttle_screen_parts SET gone = true WHERE id = $1', [target.id]);
          if (target.generation === current.screen.part_generation) await client.query(`UPDATE sophie_core.shuttle_screens
            SET part_generation = part_generation + 1, ready = false WHERE id = $1`, [current.screen.id]);
        } else if (await messageProof('matches', message, expected, { fromWrite })) {
          await client.query(`UPDATE sophie_core.${table} SET rendered_sha256 = $2, pending_sha256 = NULL WHERE id = $1`, [target.id, digest(write.payload)]);
        } else {
          // A read that shows another body means the earlier edit did not land: edit it next. A write whose own
          // response differs from what was sent is not retried blindly.
          requireCondition(write.action === 'inspect', 'SHUTTLE_MESSAGE_MISMATCH');
          await client.query(`UPDATE sophie_core.${table} SET rendered_sha256 = NULL, pending_sha256 = NULL WHERE id = $1`, [target.id]);
        }
        requireFreshObservation(member.observation, clock());
        return { settled: false };
      });
    },
    async noteUncertainOnboardingWrite(claim) {
      validateClaim(claim);
      return inTransaction(pool, async client => {
        const source = await claimSource(client, claim);
        await lockMember(client, claim.guildId, source.user_id);
        const suffix = createHash('sha256').update(JSON.stringify([claim.operationId, claim.fence])).digest('hex');
        await enqueue(client, { kind: 'shuttle.render', operationId: `screen.recheck.${suffix}`,
          guildId: claim.guildId, userId: source.user_id, screenId: source.effect.screenId });
      });
    },
  });
}
