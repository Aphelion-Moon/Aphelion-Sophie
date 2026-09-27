import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';
import { canonicalAiConfiguration, defaultParticipation, AI_MODES } from '../../modules/assistant/participation.js';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) }), el = id => document.getElementById(id);
const personal = window.location.pathname === '/ai-preferences';
const names = { ignore: 'Ignore', addressed: 'Mentions and replies only', questions: 'Answer supported questions', reactive: 'Read and react; speak when asked', conversational: 'Join the conversation' };
let phase = 'loading', busy = false, dirty = false, pending = null, pendingRequestId = null, session = null;
let configuration = { schemaVersion: 1, enabled: false, deadlineMs: 15000, channels: [], emojis: [] }, character = structuredClone(DRAFT_PERSONALITY);
let configurationRevision = 0, personalityRevision = 0, consentRows = [], noticeRevision = 1;
const notice = text => { el('notice').textContent = text; };
function changed() { dirty = true; pending = null; pendingRequestId = null; if (el('review')) el('review').hidden = true; if (el('review-content')) el('review-content').textContent = ''; }
function clear() {
  el('workspace').hidden = true; changed(); consentRows = []; configuration.channels = []; configuration.emojis = []; character = { core: '', examples: [] };
  for (const id of ['channels', 'emojis', 'examples', 'consents']) el(id)?.replaceChildren();
  for (const id of ['character-core', 'consent-channel']) if (el(id)) el(id).value = '';
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
    for (const [key, title, min, max] of [['evaluationIntervalMs', 'Minimum seconds between proactive model turns', 15, 3600], ['replyIntervalMs', 'Minimum seconds between proactive replies', 15, 3600], ['reactionIntervalMs', 'Minimum seconds between reactions', 15, 3600], ['memberIntervalMs', 'Minimum seconds between a member’s requests', 1, 3600], ['proactiveRepliesPerHour', 'Maximum proactive replies per hour', 0, 60], ['contextMessages', 'Maximum temporary context messages', 0, 30], ['contextTtlMs', 'Temporary context lifetime, seconds', 10, 1800]]) {
      const scale = key.endsWith('Ms') ? 1000 : 1;
      field(box, title, channel.profile[key] / scale, value => { channel.profile[key] = value * scale; }, { type: 'number', min, max, step: 1 });
    }
    field(box, 'Allow approved social reactions', channel.profile.reactions, value => { channel.profile.reactions = value; }, { type: 'checkbox' });
    field(box, 'Show typing for addressed requests', channel.profile.typing, value => { channel.profile.typing = value; }, { type: 'checkbox' });
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
  for (const row of consentRows) {
    const p = document.createElement('p'); p.textContent = `Channel ${row.channelId}: ${row.enabled ? 'opted in' : 'opted out'} · revision ${row.epoch} `;
    if (row.enabled) { const button = document.createElement('button'); button.textContent = 'Opt out'; button.addEventListener('click', () => perform(async () => {
      await api.aiConsent({ channelId: row.channelId, enabled: false, expectedEpoch: row.epoch, acceptedNoticeRevision: noticeRevision }); await consents(); notice('Opted out. Pending use is invalidated.');
    })); p.append(button); } el('consents').append(p);
  }
}
async function load() {
  session = await api.session(); el('logout').hidden = false;
  if (personal) { if (!session.aiAvailable) throw Object.assign(Error(), { kind: 'denied' }); await consents(); }
  else {
    if (!session.canControlAi && !session.canEditPersonality) throw Object.assign(Error(), { kind: 'denied' });
    if (session.canControlAi) {
      const current = await api.aiPublication('configuration'); configuration = current.publication?.document ?? configuration; configurationRevision = current.publication?.revision ?? 0;
      el('participation').hidden = false; el('desired-enabled').checked = configuration.enabled; el('deadline').value = configuration.deadlineMs / 1000;
      el('active-state').textContent = `Saved participation revision ${configurationRevision}. ${current.disabled ? 'AI is disabled.' : 'Activation requires current qualification.'}`; channels(); emojis();
    }
    if (session.canEditPersonality) { const current = await api.aiPublication('personality'); character = current.publication?.document ?? structuredClone(DRAFT_PERSONALITY); personalityRevision = current.publication?.revision ?? 0;
      el('personality').hidden = false; el('character-core').value = character.core; examples(); }
  }
  pending = null; pendingRequestId = null; dirty = false; phase = 'ready'; el('workspace').hidden = false; el('review') && (el('review').hidden = true); notice('Current saved state loaded.');
}
async function review(kind) {
  const document = kind === 'configuration' ? canonicalAiConfiguration({ ...configuration, enabled: el('desired-enabled').checked, deadlineMs: Number(el('deadline').value) * 1000 }) : canonicalPersonality({ ...character, core: el('character-core').value });
  const candidate = { kind, expectedRevision: kind === 'configuration' ? configurationRevision : personalityRevision, document };
  const result = await api.aiReview(candidate); pending = { ...candidate, reviewSha256: result.reviewSha256 };
  pendingRequestId = [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join('');
  el('review-summary').textContent = `Publish ${kind} revision ${candidate.expectedRevision + 1}. Review the exact saved values below.`;
  el('review-content').textContent = JSON.stringify(document, null, 2); el('review').hidden = false;
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
  for (const kind of ['configuration', 'personality']) el(`review-${kind}`).addEventListener('click', () => perform(() => review(kind)));
  for (const id of ['character-core', 'desired-enabled', 'deadline']) el(id).addEventListener('input', () => { dirty = true; pending = null; el('review').hidden = true; });
  el('cancel-review').addEventListener('click', () => { pending = null; el('review').hidden = true; });
  el('publish').addEventListener('click', () => perform(async () => { if (!pending) return; await api.aiPublish({ ...pending, requestId: pendingRequestId, confirmed: true }); await load(); notice('Publication saved. Activation remains subject to release qualification.'); }));
  el('disable-ai').addEventListener('click', () => perform(async () => { await api.aiDisable(); await load(); notice('AI disabled. Administration continues independently.'); }));
}
const controller = { snapshot: () => ({ phase, busy, dirty, pending }), start: () => perform(load), checkAccess: () => perform(async () => {
  const fresh = await api.session(); if (personal ? !fresh.aiAvailable : (!fresh.canControlAi && !fresh.canEditPersonality) || fresh.canControlAi !== session?.canControlAi || fresh.canEditPersonality !== session?.canEditPersonality) {
    clear(); phase = 'denied'; notice('Access changed. Reload before continuing.');
  }
}) };
mountDashboardShell({ window, document, controller });
