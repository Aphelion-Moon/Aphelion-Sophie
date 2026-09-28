import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';
import { canonicalAiConfiguration, defaultParticipation, AI_MODES } from '../../modules/assistant/participation.js';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';
import { canonicalAiBudget, DEFAULT_AI_BUDGET } from '../../modules/assistant/budget.js';
import { createPreferenceEditor } from './ai-preferences-view.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) }), el = id => document.getElementById(id);
const personal = window.location.pathname === '/ai-preferences';
const names = { ignore: 'Ignore', addressed: 'Mentions and replies only', questions: 'Answer supported questions', reactive: 'Read and react; speak when asked', conversational: 'Join the conversation' };
let phase = 'loading', busy = false, dirty = false, pending = null, pendingRequestId = null, session = null;
let configuration = { schemaVersion: 1, enabled: false, deadlineMs: 15000, channels: [], emojis: [] }, character = structuredClone(DRAFT_PERSONALITY);
let configurationRevision = 0, personalityRevision = 0, consentRows = [], noticeRevision = 1;
let budget = { ...DEFAULT_AI_BUDGET }, budgetRevision = 0;
let workerRevision=0,workerStopRequest=null;
let diagnosticTimer=null,diagnosticGeneration=0;
function clearDiagnostic(){diagnosticGeneration++;clearTimeout(diagnosticTimer);diagnosticTimer=null;if(el('diagnostic-output'))el('diagnostic-output').textContent='';}
window.addEventListener('pagehide',clearDiagnostic);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')clearDiagnostic();});
const requestId=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(value=>value.toString(16).padStart(2,'0')).join('');
const preferences = personal ? createPreferenceEditor({api,document,perform,identity:()=>session,changed,saved:()=>{dirty=false;}}) : null;
const notice = text => { el('notice').textContent = text; };
function changed() { dirty = true; pending = null; pendingRequestId = null; if (el('review')) el('review').hidden = true; if (el('review-content')) el('review-content').textContent = ''; }
function clear() {
  clearDiagnostic();el('diagnostic-channel')?.replaceChildren();
  preferences?.clear();
  el('workspace').hidden = true; changed(); consentRows = []; configuration.channels = []; configuration.emojis = []; character = { core: '', examples: [] };
  for (const id of ['channels', 'emojis', 'examples', 'consents', 'unresolved-spending','worker-release']) el(id)?.replaceChildren();
  for (const id of ['character-core', 'consent-channel']) if (el(id)) el(id).value = '';
  for (const id of ['monthly-budget', 'price-valid-until', 'hold-evidence']) if (el(id)) el(id).value = '';
  if (el('budget-state')) el('budget-state').textContent = '';
  for(const id of ['worker-state','worker-ack'])if(el(id))el(id).textContent='';workerRevision=0;workerStopRequest=null;
  if (el('accept-notice')) el('accept-notice').checked = false;
}
async function perform(work) {
  if (busy) return; busy = true; el('error').hidden = true;
  try { await work(); }
  catch (error) {
    if (error.kind === 'denied') { clear(); phase = 'denied'; }
    el('error').textContent = error.kind === 'conflict' ? 'This version changed. Reload before editing again.' : error.kind === 'denied' ? 'Your access has changed. Sign in again or contact the publisher.' : 'The operation could not be confirmed. Reload to check current state before retrying.';
    el('error').hidden = false;
  } finally { busy = false; }
}
function field(parent, label, value, change, attributes = {}) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = document.createElement(attributes.multiline ? 'textarea' : 'input');
  for (const [key, item] of Object.entries(attributes)) if (key !== 'multiline') input.setAttribute(key, String(item));
  if (attributes.type === 'checkbox') input.checked = value; else input.value = value;
  input.addEventListener('input', () => { change(attributes.type === 'checkbox' ? input.checked : attributes.type === 'number' ? Number(input.value) : input.value); changed(); });
  wrapper.append(input); parent.append(wrapper); return input;
}
function channels() {
  el('channels').replaceChildren();
  configuration.channels.forEach((channel, index) => {
    const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `Channel ${index + 1}`; box.append(legend);
    field(box, 'Channel ID', channel.channelId, value => { channel.channelId = value; }, { maxlength: 20, inputmode: 'numeric' });
    const label = document.createElement('label'); label.textContent = 'Participation mode'; const select = document.createElement('select');
    for (const mode of AI_MODES) { const option = document.createElement('option'); option.value = mode; option.textContent = names[mode]; select.append(option); }
    select.value = channel.profile.mode; select.addEventListener('change', () => { channel.profile.mode = select.value; if (select.value === 'reactive') channel.profile.reactions = true; changed(); channels(); }); label.append(select); box.append(label);
    for (const [key, title, min, max] of [['evaluationIntervalMs', 'Minimum seconds between proactive model turns', 15, 3600], ['replyIntervalMs', 'Minimum seconds between proactive replies', 15, 3600], ['reactionIntervalMs', 'Minimum seconds between reactions', 15, 3600], ['memberIntervalMs', 'Minimum seconds between a member’s requests', 1, 3600], ['proactiveRepliesPerHour', 'Maximum proactive replies per hour', 0, 60], ['contextMessages', 'Maximum temporary items, including Sophie’s replies', 0, 12], ['contextTtlMs', 'Temporary context lifetime, seconds', 10, 300]]) {
      const scale = key.endsWith('Ms') ? 1000 : 1;
      field(box, title, channel.profile[key] / scale, value => { channel.profile[key] = value * scale; }, { type: 'number', min, max, step: 1 });
    }
    field(box, 'Allow approved social reactions', channel.profile.reactions, value => { channel.profile.reactions = value; }, { type: 'checkbox' });
    field(box, 'Show brief typing when an addressed request starts', channel.profile.typing, value => { channel.profile.typing = value; }, { type: 'checkbox' });
    field(box, 'Quiet hours: wait to be addressed', channel.profile.quietHours !== null, value => { channel.profile.quietHours = value ? { startMinute: 1320, endMinute: 480, utcOffsetMinutes: 0 } : null; channels(); }, { type: 'checkbox' });
    if (channel.profile.quietHours) {
      const quiet = channel.profile.quietHours, time = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
      for (const [key, title] of [['startMinute', 'Quiet hours start'], ['endMinute', 'Quiet hours end']]) field(box, title, time(quiet[key]), value => { const [hour, minute] = value.split(':').map(Number); quiet[key] = hour * 60 + minute; }, { type: 'time', required: true });
      field(box, 'UTC offset, minutes (fixed; adjust for daylight saving)', quiet.utcOffsetMinutes, value => { quiet.utcOffsetMinutes = value; }, { type: 'number', min: -720, max: 840, step: 15 });
    }
    const remove = document.createElement('button'); remove.textContent = 'Remove channel from draft'; remove.addEventListener('click', () => { configuration.channels.splice(index, 1); changed(); channels(); }); box.append(remove); el('channels').append(box);
  });
}
function emojis() {
  el('emojis').replaceChildren();
  configuration.emojis.forEach((emoji, index) => {
    const box = document.createElement('fieldset');
    field(box, 'Reaction label (for example, friendly_wave)', emoji.key, value => { emoji.key = value; }, { maxlength: 80 });
    field(box, 'Unicode emoji or custom emoji name', emoji.name, value => { emoji.name = value; }, { maxlength: 32 });
    field(box, 'Custom emoji ID (leave empty for Unicode)', emoji.id ?? '', value => { emoji.id = value.trim() || null; }, { maxlength: 20, inputmode: 'numeric' });
    const remove = document.createElement('button'); remove.textContent = 'Remove reaction'; remove.addEventListener('click', () => { configuration.emojis.splice(index, 1); changed(); emojis(); }); box.append(remove); el('emojis').append(box);
  });
}
function examples() {
  el('examples').replaceChildren();
  character.examples.forEach((example, index) => {
    const box = document.createElement('fieldset'); field(box, 'Synthetic member message', example.member, value => { example.member = value; }, { multiline: true, maxlength: 600 });
    field(box, 'Sophie’s example reply', example.sophie, value => { example.sophie = value; }, { multiline: true, maxlength: 600 });
    const remove = document.createElement('button'); remove.textContent = 'Remove example'; remove.addEventListener('click', () => { character.examples.splice(index, 1); changed(); examples(); }); box.append(remove); el('examples').append(box);
  });
}
async function consents() {
  const current = await api.aiConsents(); consentRows = current.channels; noticeRevision = current.noticeRevision; el('consents').replaceChildren();
  el('opt-in').disabled = current.optInAvailable !== true;
  el('accept-notice').disabled = current.optInAvailable !== true;
  for (const row of consentRows) {
    const p = document.createElement('p'); p.textContent = `Channel ${row.channelId}: ${row.enabled ? 'opted in' : 'opted out'} · revision ${row.epoch} `;
    if (row.enabled) { const button = document.createElement('button'); button.textContent = 'Opt out'; button.addEventListener('click', () => perform(async () => {
      await api.aiConsent({ channelId: row.channelId, enabled: false, expectedEpoch: row.epoch, acceptedNoticeRevision: noticeRevision }); await consents(); notice('Opted out. Pending use is invalidated.');
    })); p.append(button); } el('consents').append(p);
  }
}
async function load() {
  session = await api.session(); el('logout').hidden = false;
  if (personal) { if (!session.aiAvailable) throw Object.assign(Error(), { kind: 'denied' }); await consents(); await preferences.load(); }
  else {
    if (!session.canControlAi && !session.canEditPersonality) throw Object.assign(Error(), { kind: 'denied' });
    if (session.canControlAi) {
      const current = await api.aiPublication('configuration'); configuration = current.publication?.document ?? configuration; configurationRevision = current.publication?.revision ?? 0;
      el('participation').hidden = false; el('desired-enabled').checked = configuration.enabled; el('deadline').value = configuration.deadlineMs / 1000;
      el('active-state').textContent = `Saved participation revision ${configurationRevision}. ${current.disabled ? 'AI is disabled.' : 'Activation requires current qualification.'}`; channels(); emojis();
      const savedBudget = await api.aiPublication('budget'); budget = savedBudget.publication?.document ?? { ...DEFAULT_AI_BUDGET }; budgetRevision = savedBudget.publication?.revision ?? 0;
      const spending = await api.aiBudget(); el('budget').hidden = false;
      const worker=await api.aiWorker();
      if(worker.actorId!==session.userId || worker.guildId!==session.guildId)throw Object.assign(Error(),{kind:'denied'});
      workerRevision=worker.desiredRevision;el('worker').hidden=false;el('worker-release').replaceChildren();
      for(const candidate of worker.candidates){const option=document.createElement('option');option.value=candidate.id;option.textContent=candidate.release.name;el('worker-release').append(option);}
      el('review-worker').disabled=!worker.available || worker.historyFull || worker.candidates.length===0;el('stop-worker').disabled=!worker.available;
      el('worker-state').textContent=`Desired worker revision ${worker.desiredRevision}; active revision ${worker.activeRevision??'none'}. Phase: ${worker.phase}. ${worker.disabled?'AI processing is disabled.':''} ${worker.available?'':'No lifecycle adapter is registered.'}`;
      if(worker.historyFull)el('worker-state').textContent+=' Worker request history is full. Apply is paused; stop and recovery remain available.';
      el('worker-ack').textContent=worker.acknowledged?`Last acknowledged release: ${worker.acknowledged.releaseHash}; boot: ${worker.acknowledged.bootId}. Recorded ${worker.observedAt}.`:'No worker acknowledgement is recorded.';
      clearDiagnostic();el('diagnostics').hidden=false;el('diagnostic-channel').replaceChildren();
      for(const channel of configuration.channels.filter(item=>item.profile.mode!=='ignore')){
        const option=document.createElement('option');option.value=channel.channelId;option.textContent=channel.channelId;el('diagnostic-channel').append(option);
      }
      el('read-diagnostic').disabled=el('diagnostic-channel').options.length===0;
      el('spending-hold').hidden = spending.policy?.held !== true; el('hold-evidence').value = '';
      el('monthly-budget').value = String(BigInt(budget.monthlyLimitNanos) / 1000000000n);
      el('price-valid-until').value = budget.priceValidUntil === null ? '' : new Date(budget.priceValidUntil).toISOString();
      const dollars = value => (Number(value) / 1000000000).toFixed(6);
      el('budget-state').textContent = `Budget revision ${budgetRevision}. ${spending.policy?.held ? 'Paid inference is held for accounting review.' : 'Europe/Vienna calendar; conservative peak-price accounting.'} ` +
        spending.balances.map(row => `${row.period}: $${dollars(row.settled_nanos)} settled, $${dollars(row.reserved_nanos)} reserved (including uncertainty), ${row.attempts} attempts.`).join(' ') +
        ` Unresolved across all periods: ${spending.unresolved.attempts} attempts, $${dollars(spending.unresolved.nanos)}. An unreviewed or expired price pauses paid calls.` +
        ` Resolved attempt details expire after 90 days; daily totals after 90 days and monthly totals after 400 days once unreferenced. Unresolved charges and replay receipts remain.` +
        (spending.capacityHeld ? ' Paid calls are paused at accounting storage capacity.' : '');
      el('unresolved-spending').replaceChildren();
      for (const attempt of spending.pending) {
        const row = document.createElement('fieldset'), label = document.createElement('label'), confirmation = document.createElement('input'), button = document.createElement('button');
        confirmation.type = 'checkbox'; label.append(confirmation, ` Account for the full $${dollars(attempt.nanos)} reservation. This keeps it charged against its original budget; it does not prove the provider’s actual bill.`);
        button.textContent = 'Resolve this uncertain attempt'; button.disabled = true;
        confirmation.addEventListener('change', () => { button.disabled = !confirmation.checked; });
        const requestId = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
        button.addEventListener('click', () => perform(async () => { if (!confirmation.checked) return;
          await api.aiResolveSpending({messageId:attempt.messageId,fence:attempt.fence,requestId,confirmed:true}); await load(); notice('Full reservation accounted for. No generation was replayed.'); }));
        row.append(label,button); el('unresolved-spending').append(row);
      }
    }
    if (session.canEditPersonality) { const current = await api.aiPublication('personality'); character = current.publication?.document ?? structuredClone(DRAFT_PERSONALITY); personalityRevision = current.publication?.revision ?? 0;
      el('personality').hidden = false; el('character-core').value = character.core; examples(); }
  }
  pending = null; pendingRequestId = null; dirty = false; phase = 'ready'; el('workspace').hidden = false; el('review') && (el('review').hidden = true); notice('Current saved state loaded.');
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
  el('review-summary').textContent = `Publish ${kind} revision ${candidate.expectedRevision + 1}. Review the exact saved values below.`;
  el('review-content').textContent = JSON.stringify(document, null, 2); el('review').hidden = false;
  el('publish').textContent = 'Publish this version';
}
el('retry').addEventListener('click', () => perform(load));
el('logout').addEventListener('click', () => perform(async () => { await api.logout(); clear(); phase = 'denied'; }));
if (personal) el('opt-in').addEventListener('click', () => perform(async () => {
  if (!el('accept-notice').checked) { notice('Read and accept the processing notice first.'); return; }
  const channelId = el('consent-channel').value.trim(); await api.aiConsent({ channelId, enabled: true, expectedEpoch: consentRows.find(row => row.channelId === channelId)?.epoch ?? 0, acceptedNoticeRevision: noticeRevision });
  el('accept-notice').checked = false; await consents(); notice('Your channel choice was saved. Processing still requires an active qualified channel.');
}));
else {
  el('add-channel').addEventListener('click', () => { if (configuration.channels.length < 100) { configuration.channels.push({ channelId: '', profile: defaultParticipation() }); changed(); channels(); } });
  el('add-emoji').addEventListener('click', () => { if (configuration.emojis.length < 16) { configuration.emojis.push({ key: '', id: null, name: '' }); changed(); emojis(); } });
  el('add-example').addEventListener('click', () => { if (character.examples.length < 8) { character.examples.push({ member: '', sophie: '' }); changed(); examples(); } });
  for (const kind of ['configuration', 'personality', 'budget']) el(`review-${kind}`).addEventListener('click', () => perform(() => review(kind)));
  el('worker-release').addEventListener('change',changed);
  el('diagnostic-channel').addEventListener('change',clearDiagnostic);
  el('read-diagnostic').addEventListener('click',()=>perform(async()=>{
    clearDiagnostic();const channelId=el('diagnostic-channel').value,identity=session,generation=diagnosticGeneration;
    const result=await api.aiDiagnostics(channelId);
    if(generation!==diagnosticGeneration || session!==identity || result.actorId!==session.userId || result.guildId!==session.guildId || el('diagnostic-channel').value!==channelId)return;
    const value=result.diagnostic;
    if(!value || value.expiresAt<=Date.now()){el('diagnostic-output').textContent='No current comparison is available.';return;}
    const labels={authoring:'authored policy and character',example:'dialogue example',evidence:'approved evidence',history:'temporary conversation',contract:'output contract',question:'current question',protocol:'provider protocol or boundary'};
    el('diagnostic-output').textContent=`${value.comparable?value.firstChangedBlock===null?'Prepared blocks are unchanged.':`First changed block: ${labels[value.firstChangedBlock]}.`:'No earlier eligible preparation is available for comparison.'} Preparation took ${value.preparationMilliseconds} ms. Ordered block sizes: ${value.blocks.map(block=>`${labels[block.kind]} (${block.bytes} bytes)`).join(', ')}.`;
    diagnosticTimer=setTimeout(()=>{clearDiagnostic();el('diagnostic-output').textContent='This comparison expired. Inspect again for current information.';},Math.max(1,Math.min(300000,value.expiresAt-Date.now())));
  }));
  el('review-worker').addEventListener('click',()=>perform(async()=>{
    const candidate={candidateId:el('worker-release').value,expectedRevision:workerRevision};
    const result=await api.aiReviewWorker(candidate);pending={...candidate,reviewSha256:result.reviewSha256,operation:'applyWorker'};pendingRequestId=requestId();
    el('review-summary').textContent='Stop current AI work and apply this registered worker release. Processing stays disabled. Other services continue.';
    el('review-content').textContent=JSON.stringify(result,null,2);el('review').hidden=false;el('publish').textContent='Apply AI worker';
  }));
  el('stop-worker').addEventListener('click',()=>perform(async()=>{
    workerStopRequest??=requestId();await api.aiStopWorker({requestId:workerStopRequest});workerStopRequest=null;
    await load();notice('AI stop requested. Reload to inspect the confirmed worker state.');
  }));
  el('review-spending-hold').addEventListener('click', () => perform(async () => {
    const candidate = { expectedRevision: budgetRevision, evidenceHash: el('hold-evidence').value.trim() };
    const result = await api.aiReviewSpendingHold(candidate);
    pending = { ...candidate, reviewSha256: result.reviewSha256, operation: 'clearSpendingHold' };
    pendingRequestId = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
    el('review-summary').textContent = 'Confirm that the accounting overrun was investigated and the price and reservation estimate requalified. Clear this hold without changing charges or limits.';
    el('review-content').textContent = JSON.stringify(candidate, null, 2); el('review').hidden = false;
    el('publish').textContent = 'Clear this accounting hold';
  }));
  for (const id of ['character-core', 'desired-enabled', 'deadline', 'monthly-budget', 'price-valid-until', 'hold-evidence']) el(id).addEventListener('input', changed);
  el('cancel-review').addEventListener('click', () => { pending = null; el('review').hidden = true; });
  el('publish').addEventListener('click', () => perform(async () => {
    if (!pending) return;
    const { operation, ...fields } = pending;
    const apply = operation === 'applyWorker' ? api.aiApplyWorker : operation === 'clearSpendingHold' ? api.aiClearSpendingHold : api.aiPublish;
    await apply({ ...fields, requestId: pendingRequestId, confirmed: true }); await load();
    notice(operation === 'applyWorker' ? 'Worker apply requested. Reload to inspect its acknowledgement; AI processing remains disabled.' : operation === 'clearSpendingHold' ? 'Accounting hold cleared. Existing charges and all other qualification gates remain.' : 'Publication saved. Activation remains subject to release qualification.');
  }));
  el('disable-ai').addEventListener('click', () => perform(async () => { await api.aiDisable(); await load(); notice('AI disabled. Administration continues independently.'); }));
}
const controller = { snapshot: () => ({ phase, busy, dirty, pending }), start: () => perform(load), checkAccess: () => perform(async () => {
  const fresh = await api.session(); if (fresh.userId!==session?.userId || fresh.guildId!==session?.guildId || (personal ? !fresh.aiAvailable : (!fresh.canControlAi && !fresh.canEditPersonality) || fresh.canControlAi !== session?.canControlAi || fresh.canEditPersonality !== session?.canEditPersonality)) {
    clear(); phase = 'denied'; notice('Access changed. Reload before continuing.');
  }
}) };
mountDashboardShell({ window, document, controller });
