import { createDashboardApi } from './api.js';
import { mountDashboardShell } from './shell.js';
import { renderWikiReview } from './wiki-review.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) }), el = id => document.getElementById(id);
let busy = false, phase = 'loading', dirty = false, pending = null, record = null;
let wikiStatus = null, wikiSnapshot = null, sourceBinding = null;
const sourceFields = ['source-url','rights','attribution','source-revision'];
const fields = ['document-id','document-title','authority','source-url','rights','attribution','source-revision','aliases'];
const notice = text => { el('notice').textContent = text; };
const randomId = () => [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2,'0')).join('');
function changed() { dirty = true; pending = null; el('review').hidden = true; el('review-content').textContent = ''; el('approved-public').checked = false; }
function clear() { changed(); record = null; sourceBinding = null; wikiStatus = null; wikiSnapshot = null; el('wiki-text').replaceChildren(); el('wiki-preview').hidden = true; fields.forEach(id => { el(id).value = ''; }); el('sections').replaceChildren(); el('catalogue').replaceChildren(); el('workspace').hidden = true; }
async function perform(work) {
  if (busy) return; busy = true; el('error').hidden = true;
  try { await work(); }
  catch (error) {
    if (error.kind === 'denied') { clear(); phase = 'denied'; }
    el('error').textContent = error.kind === 'conflict' ? 'This source changed. Reload and review it again.' : error.kind === 'denied' ? 'Your publishing access has changed. Sign in again.' : error.kind === 'invalid' ? 'Check the document fields and section limits.' : 'The operation could not be confirmed. Reload to check the saved state before retrying.';
    el('error').hidden = false;
  } finally { busy = false; }
}
function addSection(section = { heading: '', text: '' }) {
  if (el('sections').children.length >= 16) return;
  const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Source section'; box.append(legend);
  for (const [key,title,limit] of [['heading','Heading',160],['text','Approved text',4000]]) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement(key === 'text' ? 'textarea' : 'input'); input.dataset.field = key; input.value = section[key]; input.maxLength = limit;
    if (key === 'text') input.rows = 7;
    input.addEventListener('input',changed); label.append(input); box.append(label);
  }
  const remove = document.createElement('button'); remove.textContent = 'Remove section'; remove.addEventListener('click',() => { box.remove(); changed(); }); box.append(remove); el('sections').append(box);
}
function edit(value = null) {
  changed(); record = value;
  const doc = value?.document;
  sourceBinding = doc?.kind === 'mediawiki' ? { dependencyHash: doc.dependencyHash, fetchedAt: doc.fetchedAt, validUntil: doc.validUntil } : null;
  sourceFields.forEach(id => { el(id).disabled = sourceBinding !== null; });
  for (const [id,key] of [['document-id','id'],['document-title','title'],['authority','authority'],['source-url','url'],['rights','rights'],['attribution','attribution'],['source-revision','sourceRevision']]) el(id).value = doc?.[key] ?? (key === 'authority' ? 'reference' : key === 'id' ? value?.id ?? '' : '');
  el('document-id').disabled = value !== null;
  el('aliases').value = doc?.aliases.join('\n') ?? ''; el('sections').replaceChildren(); (doc?.sections ?? [{ heading: '', text: '' }]).forEach(addSection);
  el('document-state').textContent = value ? `Revision ${value.revision}. ${value.withdrawn ? 'Withdrawn; a fresh review is required to publish new text.' : value.sourceCurrent ? 'Saved publication.' : 'Source is stale and excluded from retrieval.'}${sourceBinding ? ' This publication stays bound to its wiki source. Refresh and review that source before renewing it.' : ''}` : 'New owner-reviewed public document.';
  el('request-withdraw').disabled = !value || value.withdrawn; el('editor').hidden = false; dirty = false;
}
async function loadWiki() {
  wikiStatus = await api.knowledgePoliciesStatus(); wikiSnapshot = null;
  el('wiki-text').replaceChildren(); el('wiki-preview').hidden = true; el('use-wiki').disabled = true;
  el('refresh-wiki').disabled = !wikiStatus.available; el('inspect-wiki').disabled = !wikiStatus.snapshotHash;
  el('wiki-status').textContent = !wikiStatus.available ? 'Source refresh is not configured for this installation.' :
    wikiStatus.fresh ? `Checked ${new Date(wikiStatus.checkedAt).toLocaleString()}. Ready for source review.` :
      wikiStatus.state === 'pending' ? 'Source collected; extraction is pending. It is excluded from retrieval.' : 'No fresh source is available. Refresh Policies to check it.';
}
async function inspectWiki() {
  const status = await api.knowledgePoliciesStatus();
  if (!status.snapshotHash) { await loadWiki(); return; }
  const result = await api.knowledgePoliciesSnapshot(status.snapshotHash);
  const current = await api.knowledgePoliciesStatus();
  if (current.snapshotHash !== status.snapshotHash) throw Object.assign(Error(),{ kind: 'conflict' });
  wikiStatus = current; wikiSnapshot = result;
  el('wiki-text').replaceChildren(); el('wiki-preview').hidden = false; el('wiki-preview').open = true;
  if (result.extraction) renderWikiReview(document,el('wiki-text'),result.extraction);
  else el('wiki-text').textContent = 'Extraction has not completed. Refresh the source before preparing a publication.';
  el('use-wiki').disabled = !current.fresh || !result.extraction;
}
function useWiki() {
  if (busy) return;
  if (!wikiSnapshot?.extraction || !wikiStatus?.fresh || Date.now() >= wikiStatus.validUntil) { notice('Refresh and review the source before using it.'); return; }
  if (el('editor').hidden) edit();
  const source = wikiSnapshot.snapshot;
  sourceBinding = { dependencyHash: wikiStatus.snapshotHash, fetchedAt: wikiStatus.checkedAt, validUntil: wikiStatus.checkedAt + 7 * 86400000 };
  for (const [id,value] of [['source-url',source.source.url],['rights',source.site.rights.url],['attribution','Meridian Wiki contributors; https://meridian-wiki.a13.info/index.php?title=Policies&action=history'],['source-revision',`page:878:r${source.page.revision}`]]) { el(id).value = value; el(id).disabled = true; }
  el('authority').value = 'policy';
  if (!el('document-title').value) el('document-title').value = 'Meridian Policies';
  el('document-state').textContent = 'Wiki source attached. Enter complete reviewed extracts below, including qualifications. Publishing requires a separate confirmation.';
  changed(); notice('Source attached to the editor. No text was published or automatically summarized.');
}
async function load() {
  const session = await api.session(); if (!session.canEditKnowledge) throw Object.assign(Error(),{ kind: 'denied' });
  const result = await api.knowledgeCatalogue(); el('catalogue').replaceChildren();
  await loadWiki(); sourceBinding = null;
  for (const row of result.documents) {
    const button = document.createElement('button'); button.textContent = `${row.title ?? row.id} · revision ${row.revision} · ${row.withdrawn ? 'withdrawn' : row.sourceCurrent ? 'published' : 'stale'}`;
    button.addEventListener('click',() => perform(async () => edit(await api.knowledgeDocument(row.id)))); el('catalogue').append(button);
  }
  pending = null; dirty = false; record = null; el('review').hidden = true; el('editor').hidden = true; el('workspace').hidden = false; el('logout').hidden = false; phase = 'ready'; notice('Current public knowledge loaded.');
}
async function review() {
  const sections = [...el('sections').children].map(box => ({ heading: box.querySelector('[data-field="heading"]').value, text: box.querySelector('[data-field="text"]').value }));
  const bytes = new TextEncoder().encode(JSON.stringify(sections)), dependencyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
  const document = { id: el('document-id').value, title: el('document-title').value, kind: sourceBinding ? 'mediawiki' : 'owner-publication', authority: el('authority').value,
    url: el('source-url').value, rights: el('rights').value, attribution: el('attribution').value, sourceRevision: el('source-revision').value,
    dependencyHash, fetchedAt: Date.now(), validUntil: null, ...sourceBinding, aliases: el('aliases').value.split('\n').map(value => value.trim()).filter(Boolean), sections };
  const candidate = { document, expectedEpoch: record?.epoch ?? 0 }, result = await api.knowledgeReview(candidate);
  pending = { action: 'publish', ...candidate, document: result.document, reviewHash: result.reviewHash, requestId: randomId() };
  el('review-title').textContent = 'Review publication'; el('review-summary').textContent = 'Review the complete public document and source rights. This material becomes eligible for retrieval by qualified AI contexts.';
  const reviewed = result.document;
  el('review-content').textContent = [`${reviewed.title} (${reviewed.id})`, `Authority: ${reviewed.authority}`, `Source: ${reviewed.url}`,
    `Reuse: ${reviewed.rights}`, `Attribution: ${reviewed.attribution}`, `Source revision: ${reviewed.sourceRevision}`, `Other lookup names: ${reviewed.aliases.join(', ') || 'None'}`,
    reviewed.kind === 'mediawiki' ? 'This publication remains bound to the reviewed wiki snapshot and current source checks.' : 'Owner-reviewed publication; keep this document current or withdraw it.', ...reviewed.sections.map(section => `${section.heading}\n${section.text}`)].join('\n\n');
  el('approved-public').checked = false; el('public-confirmation').hidden = false;
  el('confirm').textContent = 'Confirm publication'; el('review').hidden = false;
}
fields.forEach(id => el(id).addEventListener('input',changed));
el('add-section').addEventListener('click',() => { addSection(); changed(); });
el('refresh-wiki').addEventListener('click',() => perform(async () => {
  if (sourceBinding) changed(); notice('Checking the current Policies page and its templates…');
  await api.knowledgeRefreshPolicies(); await loadWiki(); notice('Source check completed. Review the text before preparing a publication.');
}));
el('inspect-wiki').addEventListener('click',() => perform(inspectWiki));
el('use-wiki').addEventListener('click',useWiki);
el('new-document').addEventListener('click',() => edit());
el('retry').addEventListener('click',() => perform(load));
el('logout').addEventListener('click',() => perform(async () => { await api.logout(); clear(); phase = 'denied'; }));
el('review-document').addEventListener('click',() => perform(review));
el('request-withdraw').addEventListener('click',() => {
  if (!record || record.withdrawn) return;
  pending = { action: 'withdraw', id: record.id, expectedEpoch: record.epoch };
  el('review-title').textContent = 'Withdraw publication'; el('review-summary').textContent = `Withdraw ${record.id}, revision ${record.revision}. Stored text from every revision will be removed, and pending answers using this source will be invalidated.`;
  el('review-content').textContent = ''; el('public-confirmation').hidden = true; el('confirm').textContent = 'Confirm withdrawal'; el('review').hidden = false;
});
el('cancel-review').addEventListener('click',changed);
el('confirm').addEventListener('click',() => perform(async () => {
  if (!pending) return;
  const { action, ...body } = pending;
  if (action === 'publish') {
    if (!el('approved-public').checked) { notice('Confirm the public source and reuse permission before publishing.'); return; }
    await api.knowledgePublish({ ...body, confirmed: true, approvedPublic: true });
  } else await api.knowledgeWithdraw({ ...body, confirmed: true });
  await load(); notice(action === 'publish' ? 'Public knowledge saved. AI activation is unchanged.' : 'Publication withdrawn; its stored text is removed.');
}));
mountDashboardShell({ window, document, controller: { snapshot: () => ({ phase, busy, dirty, pending }), start: () => perform(load), checkAccess: () => perform(async () => {
  if (!(await api.session()).canEditKnowledge) { clear(); phase = 'denied'; notice('Publishing access changed.'); }
}) } });
