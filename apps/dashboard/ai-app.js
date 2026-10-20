import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';
import { canonicalAiConfiguration, defaultParticipation, AI_MODES } from '../../modules/assistant/participation.js';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';
import { canonicalAiBudget, DEFAULT_AI_BUDGET } from '../../modules/assistant/budget.js';
import { createPreferenceEditor } from './ai-preferences-view.js';
import { createMemoryAudit, createMemoryList } from './ai-memories-view.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) }), el = id => document.getElementById(id);
const personal = window.location.pathname === '/ai-preferences';
const names = { ignore: 'Ignore', addressed: 'Mentions and replies only', questions: 'Answer supported questions', reactive: 'Read and react; speak when asked', conversational: 'Join the conversation' };
let phase = 'loading', busy = false, dirty = false, pending = null, pendingRequestId = null, session = null;
let configuration = { schemaVersion: 1, enabled: false, deadlineMs: 15000, channels: [], emojis: [] }, character = structuredClone(DRAFT_PERSONALITY);
let configurationRevision = 0, personalityRevision = 0, consentRows = [], consentNext = null, noticeRevision = 1, noticeBinding = null;
let budget = { ...DEFAULT_AI_BUDGET }, budgetRevision = 0;
let workerPoll=null,lastWorker=null,aiDisabled=true;
function stopWorkerPoll(){clearTimeout(workerPoll);workerPoll=null;}
let diagnosticTimer=null,diagnosticGeneration=0;
function clearDiagnostic(){diagnosticGeneration++;clearTimeout(diagnosticTimer);diagnosticTimer=null;if(el('diagnostic-output'))el('diagnostic-output').textContent='';}
window.addEventListener('pagehide',()=>{clearDiagnostic();stopWorkerPoll();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')clearDiagnostic();});
const requestId=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(value=>value.toString(16).padStart(2,'0')).join('');
const preferences = personal ? createPreferenceEditor({api,document,perform,identity:()=>session,changed,saved:()=>{dirty=false;}}) : null;
const memoryList = personal ? createMemoryList({api,document,perform,identity:()=>session}) : null;
const memoryAudit = personal ? null : createMemoryAudit({api,document,perform});
const notice = text => { el('notice').textContent = text; };
function changed() { dirty = true; pending = null; pendingRequestId = null; if (el('review')) el('review').hidden = true; if (el('review-content')) el('review-content').textContent = ''; }
function clear() {
  clearDiagnostic();stopWorkerPoll();lastWorker=null;el('diagnostic-channel')?.replaceChildren();el('setup-steps')?.replaceChildren();
  preferences?.clear();
  el('workspace').hidden = true; changed(); consentRows = []; consentNext = null; configuration.channels = []; configuration.emojis = []; character = { core: '', examples: [] };
  if (el('more-consents')) el('more-consents').hidden = true;
  for (const id of ['channels', 'emojis', 'examples', 'consents', 'unresolved-spending','budget-balances']) el(id)?.replaceChildren();
  for (const id of ['overview-ai','overview-worker','overview-spend','worker-phase','worker-revision']) if (el(id)) el(id).textContent = '';
  for (const id of ['character-core', 'consent-channel']) if (el(id)) el(id).value = '';
  for (const id of ['monthly-budget', 'price-valid-until', 'hold-evidence']) if (el(id)) el(id).value = '';
  for (const id of ['budget-state', 'budget-rates']) if (el(id)) el(id).textContent = '';
  if (el('worker-state')) el('worker-state').textContent = '';
  if (el('accept-notice')) el('accept-notice').checked = false;
}
const unapproved = 'No processing approval is installed on this server yet, so no channel can go live. Installing one is the separate provider and privacy clearance step.';
const refusals = { AI_PROCESSING_UNAPPROVED: unapproved, AI_ACTIVATION_UNAVAILABLE: unapproved,
  AI_WORKER_NOT_READY: 'The AI worker is not connected. Try again once it has connected.',
  AI_PUBLIC_CHANNEL_REQUIRED: 'This channel is not one Sophie may join: it is private, restricted or inside an excluded category.',
  AI_PRICE_STALE: 'The budget’s reviewed price date is missing or expired, or the monthly ceiling is above $20. Update the budget first.',
  AI_BUDGET_UNAVAILABLE: 'The budget is not published, or it is held for accounting review.',
  AI_CHANNEL_UNAVAILABLE: 'This channel is not in the published channel list, or “Request AI enabled” is off. Publish the channel settings first.' };
// Errors appear at the top of the section the action came from, so a refusal is never off-screen.
async function perform(work) {
  if (busy) return; busy = true; el('error').hidden = true;
  const origin = document.activeElement?.closest?.('section.panel') ?? null;
  try { await work(); }
  catch (error) {
    if (error.kind === 'denied') { clear(); phase = 'denied'; }
    el('error').textContent = refusals[error.code] ?? (error.kind === 'conflict' ? 'This version changed. Reload before editing again.' : error.kind === 'denied' ? 'Your access has changed. Sign in again or contact the publisher.'
      : error.kind === 'connection' ? 'The server did not answer in time. Check the current state before retrying.' : 'The operation could not be confirmed. Check the current state before retrying.');
    if (!personal && (error.code === 'AI_PROCESSING_UNAPPROVED' || error.code === 'AI_ACTIVATION_UNAVAILABLE')) {
      // A standing gate: the section keeps the explanation and the button stays off until the next load.
      el('activation-blocked').textContent = unapproved; el('activation-blocked').hidden = false; el('review-activation').disabled = true;
      el('activation-blocked').scrollIntoView({ block: 'nearest' }); return;
    }
    if (origin && !origin.hidden && !el('workspace').hidden) origin.querySelector('h2').after(el('error')); else el('notice').after(el('error'));
    el('error').hidden = false; el('retry').hidden = false; el('error').scrollIntoView({ block: 'nearest' });
  } finally { busy = false; }
}
function field(parent, label, value, change, attributes = {}) {
  const wrapper = document.createElement('label'), input = document.createElement(attributes.multiline ? 'textarea' : 'input');
  for (const [key, item] of Object.entries(attributes)) if (key !== 'multiline') input.setAttribute(key, String(item));
  if (attributes.type === 'checkbox') input.checked = value; else input.value = value;
  input.addEventListener('input', () => { change(attributes.type === 'checkbox' ? input.checked : attributes.type === 'number' ? Number(input.value) : input.value); changed(); });
  if (attributes.type === 'checkbox') { wrapper.className = 'check-field'; wrapper.append(input, ` ${label}`); } else wrapper.append(label, input);
  parent.append(wrapper); return input;
}
function channels() {
  el('channels').replaceChildren();
  configuration.channels.forEach((channel, index) => {
    const box = document.createElement('fieldset'), legend = document.createElement('legend'), heading = () => { legend.textContent = channel.channelId ? `Channel ${channel.channelId}` : `New channel ${index + 1}`; };
    heading(); box.className = 'ai-card'; box.append(legend);
    const basics = document.createElement('div'); basics.className = 'ai-grid'; box.append(basics);
    field(basics, 'Channel ID', channel.channelId, value => { channel.channelId = value; heading(); }, { maxlength: 20, inputmode: 'numeric' });
    const label = document.createElement('label'); label.textContent = 'Participation mode'; const select = document.createElement('select');
    for (const mode of AI_MODES) { const option = document.createElement('option'); option.value = mode; option.textContent = names[mode]; select.append(option); }
    select.value = channel.profile.mode; select.addEventListener('change', () => { channel.profile.mode = select.value; if (select.value === 'reactive') channel.profile.reactions = true; changed(); channels(); }); label.append(select); basics.append(label);
    field(box, 'Allow approved social reactions', channel.profile.reactions, value => { channel.profile.reactions = value; }, { type: 'checkbox' });
    field(box, 'Show brief typing when an addressed request starts', channel.profile.typing, value => { channel.profile.typing = value; }, { type: 'checkbox' });
    field(box, 'Quiet hours: wait to be addressed', channel.profile.quietHours !== null, value => { channel.profile.quietHours = value ? { startMinute: 1320, endMinute: 480, utcOffsetMinutes: 0 } : null; channels(); }, { type: 'checkbox' });
    if (channel.profile.quietHours) {
      const quiet = channel.profile.quietHours, time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`, hours = document.createElement('div'); hours.className = 'ai-grid'; box.append(hours);
      for (const [key, title] of [['startMinute', 'Quiet hours start'], ['endMinute', 'Quiet hours end']]) field(hours, title, time(quiet[key]), value => { const [hour, minute] = value.split(':').map(Number); quiet[key] = hour * 60 + minute; }, { type: 'time', required: true });
      field(hours, 'UTC offset, minutes (fixed; adjust for daylight saving)', quiet.utcOffsetMinutes, value => { quiet.utcOffsetMinutes = value; }, { type: 'number', min: -720, max: 840, step: 15 });
    }
    // Pacing limits keep their saved values; they are folded away only to keep each channel readable.
    const pacing = document.createElement('details'), summary = document.createElement('summary'), limits = document.createElement('div');
    summary.textContent = 'Pacing and context limits'; limits.className = 'ai-grid'; pacing.append(summary, limits); box.append(pacing);
    for (const [key, title, min, max] of [['evaluationIntervalMs', 'Minimum seconds between proactive model turns', 15, 3600], ['replyIntervalMs', 'Minimum seconds between proactive replies', 15, 3600], ['reactionIntervalMs', 'Minimum seconds between reactions', 15, 3600], ['memberIntervalMs', 'Minimum seconds between a member’s requests', 1, 3600], ['proactiveRepliesPerHour', 'Maximum proactive replies per hour', 0, 60], ['contextMessages', 'Maximum temporary items, including Sophie’s replies', 0, 12], ['contextTtlMs', 'Temporary context lifetime, seconds', 10, 300]]) {
      const scale = key.endsWith('Ms') ? 1000 : 1;
      field(limits, title, channel.profile[key] / scale, value => { channel.profile[key] = value * scale; }, { type: 'number', min, max, step: 1 });
    }
    const remove = document.createElement('button'); remove.className = 'text-button ai-remove'; remove.textContent = 'Remove channel from draft'; remove.addEventListener('click', () => { configuration.channels.splice(index, 1); changed(); channels(); }); box.append(remove); el('channels').append(box);
  });
}
function emojis() {
  el('emojis').replaceChildren();
  configuration.emojis.forEach((emoji, index) => {
    const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.className = 'visually-hidden'; legend.textContent = `Reaction ${index + 1}`; box.className = 'ai-row'; box.append(legend);
    field(box, 'Reaction label (for example, friendly_wave)', emoji.key, value => { emoji.key = value; }, { maxlength: 80 });
    field(box, 'Unicode emoji or custom emoji name', emoji.name, value => { emoji.name = value; }, { maxlength: 32 });
    field(box, 'Custom emoji ID (leave empty for Unicode)', emoji.id ?? '', value => { emoji.id = value.trim() || null; }, { maxlength: 20, inputmode: 'numeric' });
    const remove = document.createElement('button'); remove.className = 'text-button'; remove.textContent = 'Remove reaction'; remove.addEventListener('click', () => { configuration.emojis.splice(index, 1); changed(); emojis(); }); box.append(remove); el('emojis').append(box);
  });
}
function examples() {
  el('examples').replaceChildren();
  character.examples.forEach((example, index) => {
    const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `Example ${index + 1}`; box.className = 'ai-card ai-grid'; box.append(legend);
    field(box, 'Synthetic member message', example.member, value => { example.member = value; }, { multiline: true, maxlength: 600 });
    field(box, 'Sophie’s example reply', example.sophie, value => { example.sophie = value; }, { multiline: true, maxlength: 600 });
    const remove = document.createElement('button'); remove.className = 'text-button ai-remove'; remove.textContent = 'Remove example'; remove.addEventListener('click', () => { character.examples.splice(index, 1); changed(); examples(); }); box.append(remove); el('examples').append(box);
  });
}
async function consents(append = false) {
  const current = await api.aiConsents(append ? { afterChannelId: consentNext } : {});
  consentRows = append ? [...consentRows, ...current.channels] : current.channels;
  consentNext = current.nextAfterChannelId; el('more-consents').hidden = consentNext === null;
  noticeRevision = current.noticeRevision; el('consents').replaceChildren();
  noticeBinding = current.noticeBinding ?? null; el('accept-notice').checked = false;
  if(el('processing-notice'))el('processing-notice').textContent=current.noticeText??'AI processing is awaiting operator review.';
  if(el('consent-notice'))el('consent-notice').textContent=current.optInAvailable===true
    ? 'External AI processing is available only under the reviewed notice below, in an approved channel, with your current opt-in.'
    : 'External AI processing is awaiting current provider and operator approval. New opt-ins are unavailable; you can still opt out.';
  el('opt-in').disabled = current.optInAvailable !== true;
  el('accept-notice').disabled = current.optInAvailable !== true;
  if (consentRows.length === 0) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = 'You have not opted in to any channel.'; el('consents').append(empty); }
  for (const row of consentRows) {
    const item = document.createElement('li'), name = document.createElement('span'), state = document.createElement('span');
    name.textContent = `Channel ${row.channelId}`; state.className = row.enabled ? 'badge ai-on' : 'badge'; state.textContent = row.enabled ? 'Opted in' : 'Opted out'; name.append(' ', state); item.append(name);
    if (row.enabled) { const button = document.createElement('button'); button.textContent = 'Opt out'; button.addEventListener('click', () => perform(async () => {
      await api.aiConsent({ channelId: row.channelId, enabled: false, expectedEpoch: row.epoch, acceptedNoticeRevision: noticeRevision }); await consents(); notice('Opted out. Pending use is invalidated.');
    })); item.append(button); } el('consents').append(item);
  }
}
async function load() {
  stopWorkerPoll(); let workerSnapshot = null;
  session = await api.session(); el('logout').hidden = false;
  if (personal) { if (!session.aiAvailable) throw Object.assign(Error(), { kind: 'denied' }); await consents(); await preferences.load(); await memoryList.load(); }
  else {
    if (!session.canControlAi && !session.canEditPersonality) throw Object.assign(Error(), { kind: 'denied' });
    // One request for every saved part this page shows; a part the server withholds means access changed.
    const overview = await api.aiOverview();
    // Shown only to holders of ai.memory.audit; a denial just keeps the panel hidden.
    await memoryAudit.load();
    const part = value => { if (value === null || value === undefined) throw Object.assign(Error(), { kind: 'denied' }); return value; };
    if (session.canControlAi) {
      const current = part(overview.configuration); configuration = current.publication?.document ?? configuration; configurationRevision = current.publication?.revision ?? 0;
      el('participation').hidden = false; el('desired-enabled').checked = configuration.enabled; el('deadline').value = configuration.deadlineMs / 1000;
      el('active-state').textContent = `Saved revision ${configurationRevision}.`; channels(); emojis();
      aiDisabled = current.disabled; el('overview').hidden = false; el('overview-ai').textContent = current.disabled ? 'Disabled' : 'Allowed where each channel and member qualifies';
      const savedBudget = part(overview.budgetPublication); budget = savedBudget.publication?.document ?? { ...DEFAULT_AI_BUDGET }; budgetRevision = savedBudget.publication?.revision ?? 0;
      const spending = part(overview.budget); el('budget').hidden = false;
      // Core stamps the actor on the overview, not on each part; the worker check needs it on the snapshot.
      workerSnapshot={...part(overview.worker),actorId:overview.actorId,guildId:overview.guildId};
      el('activation-channel').replaceChildren();
      for(const channel of configuration.channels.filter(row=>row.profile.mode!=='ignore')){const option=document.createElement('option');option.value=channel.channelId;option.textContent=channel.channelId;el('activation-channel').append(option);}
      clearDiagnostic();el('diagnostics').hidden=false;el('diagnostic-channel').replaceChildren();
      for(const channel of configuration.channels.filter(item=>item.profile.mode!=='ignore')){
        const option=document.createElement('option');option.value=channel.channelId;option.textContent=channel.channelId;el('diagnostic-channel').append(option);
      }
      el('read-diagnostic').disabled=el('diagnostic-channel').options.length===0;
      el('spending-hold').hidden = spending.policy?.held !== true; el('hold-evidence').value = '';
      el('monthly-budget').value = String(BigInt(budget.monthlyLimitNanos) / 1000000000n);
      el('price-valid-until').value = budget.priceValidUntil === null ? '' : new Date(budget.priceValidUntil).toISOString();
      const dollars = value => (Number(value) / 1000000000).toFixed(6);
      el('budget-state').textContent = `Saved revision ${budgetRevision}. ${spending.policy?.held ? 'Paid inference is held for accounting review.' : 'Europe/Vienna calendar; conservative peak-price accounting.'}` +
        (budget.priceValidUntil === null || budget.priceValidUntil <= Date.now() ? ' The price review is missing or expired, so paid calls are paused.' : '') +
        (spending.capacityHeld ? ' Paid calls are paused at accounting storage capacity.' : '');
      // Rates come from the saved budget (nanodollars per token), so provider changes cannot leave stale copy behind.
      const perMillion = nanos => `$${(nanos / 1000).toFixed(3).replace(/0$/u, '')}`;
      el('budget-rates').textContent = `Saved rates per million tokens: ${perMillion(budget.hitNanos)} cached input, ${perMillion(budget.missNanos)} uncached input and ${perMillion(budget.outputNanos)} output.`;
      el('budget-balances').replaceChildren();
      const balance = (title, text) => { const item = document.createElement('li'), name = document.createElement('strong'); name.textContent = title; item.append(name, document.createTextNode(text)); el('budget-balances').append(item); };
      for (const row of spending.balances) balance(row.period.length === 7 ? `Month ${row.period}` : `Day ${row.period}`, `$${dollars(row.settled_nanos)} settled · $${dollars(row.reserved_nanos)} reserved (including uncertainty) · ${row.attempts} attempts`);
      balance('Unresolved, all periods', `${spending.unresolved.attempts} attempts · $${dollars(spending.unresolved.nanos)}`);
      const month = spending.balances.find(row => row.period.length === 7);
      el('overview-spend').textContent = `$${month ? (Number(BigInt(month.settled_nanos) + BigInt(month.reserved_nanos)) / 1e9).toFixed(2) : '0.00'} of $${el('monthly-budget').value}${spending.policy?.held ? ' · held' : ''}`;
      el('unresolved-spending').replaceChildren();
      for (const attempt of spending.pending) {
        const row = document.createElement('fieldset'), label = document.createElement('label'), confirmation = document.createElement('input'), button = document.createElement('button');
        confirmation.type = 'checkbox'; label.append(confirmation, ` Account for the full $${dollars(attempt.nanos)} reservation. This keeps it charged against its original budget; it does not prove the provider’s actual bill.`);
        button.textContent = 'Resolve this uncertain attempt'; button.disabled = true;
        confirmation.addEventListener('change', () => { button.disabled = !confirmation.checked; });
        const requestId = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
        button.addEventListener('click', () => perform(async () => { if (!confirmation.checked) return;
          await api.aiResolveSpending({messageId:attempt.messageId,fence:attempt.fence,requestId,confirmed:true}); await load(); notice('Full reservation accounted for. No generation was replayed.'); }));
        row.className = 'ai-card'; row.append(label,button); el('unresolved-spending').append(row);
      }
    }
    if (session.canEditPersonality) { const current = part(overview.personality); character = current.publication?.document ?? structuredClone(DRAFT_PERSONALITY); personalityRevision = current.publication?.revision ?? 0;
      el('personality').hidden = false; el('character-core').value = character.core; examples(); }
    if (workerSnapshot) { renderWorker(workerSnapshot); if (workerSnapshot.connected !== true) watchWorker(); }
  }
  pending = null; pendingRequestId = null; dirty = false; phase = 'ready'; el('workspace').hidden = false; el('retry').hidden = true; el('review') && (el('review').hidden = true); notice('Current saved state loaded.');
}
function renderSteps() {
  const steps = [['Character', 'personality', session.canEditPersonality ? personalityRevision > 0 : null],
    ['Channels', 'participation', configurationRevision > 0 && configuration.channels.some(row => row.profile.mode !== 'ignore')],
    ['Budget', 'budget', budgetRevision > 0], ['Worker running', 'worker', lastWorker?.connected === true], ['Live in a channel', 'activation', !aiDisabled]];
  const next = steps.findIndex(([, , done]) => done === false);
  el('setup-steps').replaceChildren(...steps.map(([title, target, done], index) => {
    const item = document.createElement('li'), link = document.createElement('a'), state = document.createElement('span');
    item.dataset.state = done === null || done ? 'done' : index === next ? 'current' : 'waiting';
    link.href = `#${target}`; link.textContent = title;
    state.textContent = done === null ? 'Managed by the character editor' : done ? 'Done' : index === next ? 'Next' : 'Waiting for earlier steps';
    item.append(link, state); return item;
  }));
}
// The worker panel is read-only: the service starts with Sophie, so this only reports whether it is connected.
function renderWorker(worker) {
  if (worker.actorId !== session.userId || worker.guildId !== session.guildId) throw Object.assign(Error(), { kind: 'denied' });
  lastWorker = worker; el('worker').hidden = false; el('activation').hidden = false;
  el('worker-phase').textContent = el('overview-worker').textContent = worker.connected ? 'Connected' : 'Not connected';
  el('worker-revision').textContent = worker.release?.name ?? 'None';
  el('worker-state').textContent = worker.connected ? (worker.disabled ? 'The AI worker is running and connected. Next: go live in a channel.' : 'The AI worker is running and connected.')
    : 'The AI worker is not connected. It starts together with Sophie and reconnects on its own; if this lasts more than a minute, the operator log records why.';
  const activationBlocked = !worker.connected ? 'The AI worker must be connected before going live.'
    : el('activation-channel').options.length === 0 ? 'Publish at least one channel that is not set to Ignore.' : null;
  el('activation-blocked').hidden = !activationBlocked; el('activation-blocked').textContent = activationBlocked ?? '';
  el('review-activation').disabled = Boolean(activationBlocked);
  renderSteps();
}
// Light poll while the worker is down; it stops once connected, when the page leaves the ready state, or on denied access.
function watchWorker() {
  stopWorkerPoll();
  const step = async () => {
    workerPoll = null; if (phase !== 'ready') return;
    let worker = null;
    try { worker = await api.aiWorker(); renderWorker(worker); }
    catch (error) { if (error.kind === 'denied') { clear(); phase = 'denied'; notice('Your access has changed. Sign in again.'); return; } }
    if (worker?.connected === true) { notice('The AI worker is connected. Next: go live in a channel.'); return; }
    workerPoll = setTimeout(() => { void step(); }, 5000);
  };
  workerPoll = setTimeout(() => { void step(); }, 5000);
}
// Review opens directly under the section that asked for it.
function showReview(summary, content, action, { activates = false, anchor = null, values = true } = {}) {
  if (anchor) el(anchor).after(el('review'));
  el('review-summary').textContent = summary; el('review-content').textContent = content; el('publish').textContent = action; el('review-details').open = values;
  el('review-note').hidden = activates; el('review').hidden = false; el('review-heading').focus({ preventScroll: true }); el('review').scrollIntoView({ block: 'start' });
}
async function review(kind) {
  if (kind === 'budget' && !/^[1-9][0-9]{0,3}$/.test(el('monthly-budget').value)) throw Error('AI_BUDGET_INVALID');
  if (kind === 'budget' && el('price-valid-until').value.trim() && !/(?:Z|[+-]\d{2}:\d{2})$/u.test(el('price-valid-until').value.trim())) throw Error('AI_PRICE_INVALID');
  const document = kind === 'configuration' ? canonicalAiConfiguration({ ...configuration, enabled: el('desired-enabled').checked, deadlineMs: Number(el('deadline').value) * 1000 }) :
    kind === 'budget' ? canonicalAiBudget({ ...budget, monthlyLimitNanos: (BigInt(el('monthly-budget').value) * 1000000000n).toString(),
      priceValidUntil: el('price-valid-until').value.trim() === '' ? null : Date.parse(el('price-valid-until').value) }) : canonicalPersonality({ ...character, core: el('character-core').value });
  const candidate = { kind, expectedRevision: kind === 'configuration' ? configurationRevision : kind === 'budget' ? budgetRevision : personalityRevision, document };
  const result = await api.aiReview(candidate); pending = { ...candidate, reviewSha256: result.reviewSha256 };
  pendingRequestId = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
  showReview(`Publish ${{ configuration: 'channel and reaction', budget: 'budget', personality: 'character' }[kind]} revision ${candidate.expectedRevision + 1}. Review the exact saved values below.`, JSON.stringify(document, null, 2), 'Publish this version',
    { anchor: { configuration: 'participation', budget: 'budget', personality: 'personality' }[kind] });
}
// A denied page reloads fully so an expired session reaches sign-in instead of retrying the same cookie.
el('retry').addEventListener('click', () => phase === 'denied' ? location.reload() : perform(load));
el('logout').addEventListener('click', () => perform(async () => { await api.logout(); clear(); phase = 'denied'; }));
if (personal) el('more-consents').addEventListener('click', () => perform(async () => { if (consentNext !== null) await consents(true); }));
if (personal) el('opt-in').addEventListener('click', () => perform(async () => {
  if (!el('accept-notice').checked) { notice('Read and accept the processing notice first.'); return; }
  const channelId = el('consent-channel').value.trim(), current = await api.aiConsents({ channelId });
  await api.aiConsent({ channelId, enabled: true, expectedEpoch: current.channels.find(row => row.channelId === channelId)?.epoch ?? 0, acceptedNoticeRevision: noticeRevision, acceptedNoticeBinding: noticeBinding });
  el('accept-notice').checked = false; await consents(); notice('Your channel choice was saved. Processing still requires an active qualified channel.');
}));
else {
  el('add-channel').addEventListener('click', () => { if (configuration.channels.length < 100) { configuration.channels.push({ channelId: '', profile: defaultParticipation() }); changed(); channels(); } });
  el('add-emoji').addEventListener('click', () => { if (configuration.emojis.length < 16) { configuration.emojis.push({ key: '', id: null, name: '' }); changed(); emojis(); } });
  el('add-example').addEventListener('click', () => { if (character.examples.length < 8) { character.examples.push({ member: '', sophie: '' }); changed(); examples(); } });
  for (const kind of ['configuration', 'personality', 'budget']) el(`review-${kind}`).addEventListener('click', () => perform(() => review(kind)));
  el('diagnostic-channel').addEventListener('change',clearDiagnostic);
  el('read-diagnostic').addEventListener('click',()=>perform(async()=>{
    clearDiagnostic();const channelId=el('diagnostic-channel').value,identity=session,generation=diagnosticGeneration;
    const result=await api.aiDiagnostics(channelId);
    if(generation!==diagnosticGeneration || session!==identity || result.actorId!==session.userId || result.guildId!==session.guildId || el('diagnostic-channel').value!==channelId)return;
    const value=result.diagnostic;
    if(!value || value.expiresAt<=Date.now()){el('diagnostic-output').textContent='No current comparison is available.';return;}
    const labels={authoring:'authored policy and character',example:'dialogue example',evidence:'approved evidence',history:'temporary conversation',memory:'the member’s own saved notes',contract:'output contract',question:'current question',protocol:'provider protocol or boundary'};
    el('diagnostic-output').textContent=`${value.comparable?value.firstChangedBlock===null?'Prepared blocks are unchanged.':`First changed block: ${labels[value.firstChangedBlock]}.`:'No earlier eligible preparation is available for comparison.'} Preparation took ${value.preparationMilliseconds} ms. Ordered block sizes: ${value.blocks.map(block=>`${labels[block.kind]} (${block.bytes} bytes)`).join(', ')}.`;
    diagnosticTimer=setTimeout(()=>{clearDiagnostic();el('diagnostic-output').textContent='This comparison expired. Inspect again for current information.';},Math.max(1,Math.min(300000,value.expiresAt-Date.now())));
  }));
  el('review-activation').addEventListener('click',()=>perform(async()=>{
    const channelId=el('activation-channel').value,result=await api.aiReviewActivation({channelId});
    pending={channelId,reviewSha256:result.reviewSha256,operation:'activate'};pendingRequestId=requestId();
    showReview(`Enable processing in channel ${channelId} after confirming the current approval, publications, budget, worker and audience. Each member must opt in.`,JSON.stringify(result,null,2),'Enable this channel',{activates:true,anchor:'activation',values:false});
  }));
  el('review-spending-hold').addEventListener('click', () => perform(async () => {
    const candidate = { expectedRevision: budgetRevision, evidenceHash: el('hold-evidence').value.trim() };
    const result = await api.aiReviewSpendingHold(candidate);
    pending = { ...candidate, reviewSha256: result.reviewSha256, operation: 'clearSpendingHold' };
    pendingRequestId = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
    showReview('Confirm that the accounting overrun was investigated and the price and reservation estimate requalified. Clear this hold without changing charges or limits.', JSON.stringify(candidate, null, 2), 'Clear this accounting hold', { anchor: 'budget' });
  }));
  for (const id of ['character-core', 'desired-enabled', 'deadline', 'monthly-budget', 'price-valid-until', 'hold-evidence']) el(id).addEventListener('input', changed);
  el('cancel-review').addEventListener('click', () => { pending = null; el('review').hidden = true; });
  el('publish').addEventListener('click', () => perform(async () => {
    if (!pending) return;
    const { operation, ...fields } = pending;
    const apply = operation === 'activate' ? api.aiActivate : operation === 'clearSpendingHold' ? api.aiClearSpendingHold : api.aiPublish;
    await apply({ ...fields, requestId: pendingRequestId, confirmed: true });
    await load();
    notice(operation === 'activate' ? 'Channel activation confirmed. Current approval and individual consent still govern every message.' : operation === 'clearSpendingHold' ? 'Accounting hold cleared. Existing charges and all other qualification gates remain.' : 'Saved. The setup checklist shows the next step.');
  }));
  el('disable-ai').addEventListener('click', () => perform(async () => { await api.aiDisable(); await load(); notice('AI disabled. Administration continues independently.'); }));
}
const controller = { snapshot: () => ({ phase, busy, dirty, pending }), start: () => perform(load), checkAccess: () => perform(async () => {
  const fresh = await api.session(); if (fresh.userId!==session?.userId || fresh.guildId!==session?.guildId || (personal ? !fresh.aiAvailable : (!fresh.canControlAi && !fresh.canEditPersonality) || fresh.canControlAi !== session?.canControlAi || fresh.canEditPersonality !== session?.canEditPersonality)) {
    clear(); phase = 'denied'; notice('Access changed. Reload before continuing.');
  }
}) };
mountDashboardShell({ window, document, controller });
