const labels = { 'member.mute': 'Mute members', 'member.unmute': 'Unmute members', 'shuttle.publish': 'Publish Shuttle guidance',
  'case.registry': 'Inspect case registry', 'case.forms.publish': 'Publish ticket forms', 'answers.publish': 'Publish public answers',
  'automation.publish': 'Publish static automation', 'permissions.publish': 'Configure roles and permissions' };
const caseLabels = { 'quick-help': 'Quick Help', 'admin-help': 'Admin Help', 'staff-report': 'Report a Staffer', 'tech-support': 'Tech Support',
  'database-support': 'Database Support', 'head-admin-contact': 'Head Admin contact (lead ops only)', 'shuttle': 'Shuttle assistance',
  'staff-contact': 'Staff contact', 'player-report': 'Player report' };
const deploymentBlockers = {
  'registered-case-policy-changed': 'The registered case policy differs from the running configuration.',
  'registered-capability-policy-changed': 'The registered capability policy differs from the running configuration.',
  'retained-case-policy-mismatch': 'Some retained cases are bound to a different or missing policy.',
  'created-channels-not-located': 'Some created case channels have not been located.',
  'channel-selection-unresolved': 'Some case channel selections need reconciliation.',
  'case-transitions-pending': 'Case opening or closure work is still pending.',
  'invitations-pending': 'Some invitations still need current-authority checks.',
  'deliveries-unsettled': 'Queued, in-flight or parked deliveries need review.',
};

export function createPermissionsView({ document, controller }) {
  const get = id => document.getElementById(id), node = (tag, text = '') => { const result = document.createElement(tag); result.textContent = text; return result; };
  const button = (text, action, disabled = false) => { const result = node('button', text); result.type = 'button'; result.disabled = disabled; result.addEventListener('click', action); return result; };
  let reviewKey = null, editorKey = null, applicationKey = null;
  for (const [id, method] of [['logout','logout'], ['gate-retry','start'], ['save','save'], ['review-button','review'], ['reload','reload'],
    ['retry-change','retry'], ['close-review','closeReview'], ['approve','publish'], ['editor-button','showEditor'], ['rebase','rebase'],
    ['confirm-edit','confirmEdit'], ['cancel-edit','cancelEdit']]) get(id).addEventListener('click', () => controller[method]());
  get('history-button').addEventListener('click', () => controller.history('publications'));
  get('draft-history').addEventListener('click', () => controller.history('drafts'));
  get('confirm').addEventListener('change', () => { get('approve').disabled = !get('confirm').checked; });
  for(const [id,method] of [['review-apply','reviewApply'],['refresh-application','refreshApplication'],['apply-configuration','applyConfiguration'],['close-apply','closeApply'],['retry-application','applyConfiguration'],['resume-application','retryBlocked']])get(id).addEventListener('click',()=>controller[method]());
  get('confirm-apply').addEventListener('change',()=>render(controller.snapshot()));
  function selection(parent, id, title, selected, choices, multiple, change, disabled) {
    const label = node('label', title); label.htmlFor = id;
    const select = node('select'); select.id = id; select.multiple = multiple; select.disabled = disabled;
    if (multiple) select.size = Math.min(6, Math.max(2, choices.length));
    const values = new Set(selected), known = new Set(choices.map(row => row.id));
    for (const value of selected) if (!known.has(value)) choices = [...choices, { id: value, name: 'Unavailable selection' }];
    for (const row of choices) { const option = node('option', `${row.name} (${row.id})`); option.value = row.id; option.selected = values.has(row.id); select.append(option); }
    select.addEventListener('change', () => change(multiple ? [...select.selectedOptions].map(option => option.value) : select.value));
    parent.append(label, select);
  }
  function comparison(parent, running, candidate) {
    parent.replaceChildren(); const table = node('table'), head = node('tr');
    for (const title of ['Permission', 'Running', 'Proposed']) head.append(node('th', title));
    const thead = node('thead'); thead.append(head); table.append(thead); const body = node('tbody');
    const row = (title, before, after) => { const tr = node('tr'); tr.append(node('th', title), node('td', before), node('td', after)); body.append(tr); };
    for (const [key,title] of [['crew','Base member role (Crew)'],['whitelist','Whitelist role'],['muzzled','Restricted member role (Muzzled)'],['staff','Staff role'],['leadOps','Lead ops role']]) row(title,running.mapping[key],candidate.mapping[key]);
    row('Case category', running.casePolicy.categoryId, candidate.casePolicy.categoryId);
    for (const [key, title] of Object.entries(labels)) row(title, (running.capabilityPolicy.grants[key] ?? []).join(', ') || 'Denied', candidate.capabilityPolicy.grants[key].join(', ') || 'Denied');
    for (const [key, title] of Object.entries(caseLabels)) row(title, (running.casePolicy.responders?.[key] ?? (key === 'head-admin-contact' ? [running.mapping.leadOps] : [running.mapping.staff, running.mapping.leadOps])).join(', '), candidate.capabilityPolicy.responders[key].join(', '));
    table.append(body); parent.append(table);
  }
  function render(state) {
    const applying=state.applicationBusy||!!state.applicationPending||['queued','applying','blocked'].includes(state.application?.state);
    const ready = state.phase === 'ready', frozen = applying || state.busy || !!state.pending || state.stale || !!state.conflict || !!state.pendingEdit;
    get('workspace').hidden = !ready; get('gate').hidden = ready; get('signin').hidden = !['signed-out', 'denied'].includes(state.phase);
    get('gate-title').textContent = state.phase === 'loading' ? 'Loading your workspace…' : 'Permissions editor unavailable';
    get('logout').hidden = !state.identity; get('logout').disabled = state.busy;
    for (const id of ['notice','error']) { const value = id === 'notice' ? state.accessNotice || state.notice : state[id]; get(id).textContent = value; get(id).hidden = !value; }
    if (!ready) {
      for (const id of ['mapping-fields','grant-fields','responder-fields','comparison','deployment-review','history','selected','conflict','application-impact']) get(id).replaceChildren();
      get('application-status').textContent='';get('application-error').textContent='';get('confirm-apply').checked=false;applicationKey=null;get('application-review').hidden=true;
      get('owned-roles').textContent = ''; get('review').hidden = true; get('confirm').checked = false; reviewKey = null; editorKey = null; return;
    }
    const choices = state.overview.options, owned = state.overview.running.mapping;
    const status=state.application?.state;
    get('application-status').textContent=!state.overview.applyEnabled?'Applying configuration is not enabled on this host.':
      status==='applied'?`Settings version ${state.application.version} was applied. Reload to see the running selections.`:
      status==='cancelled'?'The reviewed configuration changed before application. Reload, review and apply again.':
      status==='blocked'?`Application paused (${state.application.summary?.code??'CONFIGURATION_UNAVAILABLE'}). Resolve the reported problem, then retry. Restrictions remain in place.`:
      ['queued','applying'].includes(status)?'Applying settings. Normal bot work may pause; this page will check for completion.':'No configuration change is in progress.';
    get('application-error').textContent=state.applicationError||'';get('application-error').hidden=!state.applicationError;
    get('review-apply').disabled=frozen||!state.overview.applyEnabled||state.overview.latest?.status!=='published'||state.dirty;
    get('application-review').hidden=!state.applicationReview;
    get('retry-application').hidden=!state.applicationPending;get('retry-application').disabled=state.applicationBusy;
    get('resume-application').hidden=status!=='blocked';get('resume-application').disabled=state.applicationBusy;
    const nextApplication=state.applicationReview?.reviewHash??null;
    if(nextApplication!==applicationKey){get('confirm-apply').checked=false;applicationKey=nextApplication;get('application-impact').replaceChildren();
      if(state.applicationReview){comparison(get('application-impact'),state.applicationReview.running,state.applicationReview.candidate);
        for(const code of state.applicationReview.blockers)get('application-impact').append(node('p',deploymentBlockers[code]??'Resolve the configuration conflict before applying.'));}}
    get('apply-configuration').disabled=state.applicationBusy||!state.applicationReview||state.applicationReview.blockers.length>0||!get('confirm-apply').checked;
    get('close-apply').disabled=state.applicationBusy||!!state.applicationPending;
    get('owned-roles').textContent = 'The base role is given to eligible members. Muzzled members remain restricted. Changing Whitelist never copies old completion into a new role grant. Roles owned by the game integration cannot be selected as membership roles.';
    get('dirty').textContent = state.dirty ? 'Unsaved changes in this tab.' : `Saved revision: ${state.overview.draft?.revision ?? 'none'}. Running capability policy: ${state.overview.running.capabilityPolicy.version}.`;
    const nextEditor = JSON.stringify([state.document, choices, frozen]);
    if (editorKey !== nextEditor) {
      const focusId = document.activeElement?.id;
      editorKey = nextEditor;
      for (const id of ['mapping-fields','grant-fields','responder-fields']) get(id).replaceChildren();
      const roles = choices.roles.filter(row => ![owned.guildId, owned.muzzled, state.document.muzzled].includes(row.id));
      for (const [key, title] of [['crew','Base member role (Crew)'], ['whitelist','Whitelist role'], ['muzzled','Restricted member role (Muzzled)'], ['staff','Staff role'], ['leadOps','Lead ops role'], ['categoryId','Case channel category']]) {
        const membership = ['crew','whitelist','muzzled'].includes(key);
        const eligible = membership ? choices.roles.filter(row => row.id !== owned.guildId && !owned.externallyOwnedRoleIds.includes(row.id)) : roles;
        selection(get('mapping-fields'), `mapping-${key}`, title, [state.document[key] ?? owned[key]], key === 'categoryId' ? choices.categories : eligible,
          false, value => controller.mapping(key, value), frozen);
      }
      for (const [group, titles, parent] of [['grants',labels,'grant-fields'], ['responders',caseLabels,'responder-fields']]) {
        for (const [key, title] of Object.entries(titles)) selection(get(parent), `${group}-${key}`, title, state.document[group][key], roles, true,
          values => controller.roles(group,key,values), frozen || key === 'head-admin-contact');
      }
      if (focusId) get(focusId)?.focus();
    }
    get('editor').hidden = state.section !== 'editor'; get('history-panel').hidden = state.section !== 'history';
    get('save').disabled = frozen || (!state.dirty && !!state.overview.draft); get('review-button').disabled = frozen || state.dirty || !state.overview.draft;
    get('reload').disabled = state.busy || !!state.pending; get('retry-change').hidden = !state.pending; get('retry-change').disabled = state.busy;
    get('rebase').hidden = state.document.baseHash === state.overview.initial.baseHash; get('rebase').disabled = frozen;
    get('pending-edit').hidden = !state.pendingEdit; get('pending-edit-text').textContent = state.pendingEdit?.message ?? '';
    get('conflict').replaceChildren();
    if (state.conflict) {
      get('conflict').append(node('p', 'Compare your selections with the latest saved draft before continuing.'));
      for (const [label, value] of [['Your selections',state.conflict.local], ['Latest saved selections',state.conflict.remote]]) { get('conflict').append(node('h3',label),node('pre',JSON.stringify(value,null,2))); }
      get('conflict').append(button('Keep my selections',()=>controller.resolveConflict('local')),button('Use latest saved draft',()=>controller.resolveConflict('remote')));
    }
    get('review').hidden = !state.review;
    get('deployment-review').replaceChildren();
    if (state.review) {
      comparison(get('comparison'), state.review.running, state.review.candidate);
      get('review-versions').textContent = `Candidate policy versions: capabilities ${state.review.candidate.capabilityPolicy.version}, cases ${state.review.candidate.casePolicy.version}.`;
      if (state.review.deployment) {
        const { inventory, blockers } = state.review.deployment, parent = get('deployment-review');
        parent.append(node('h3', 'Deployment preparation'),
          node('p', `Retained case access: ${inventory.cases.open} open, ${inventory.cases.closed} read-only, ${inventory.cases.sealed} sealed. ${inventory.channels} recorded channels.`),
          node('p', `Invitations: ${inventory.invitations.active} active, ${inventory.invitations.pending} pending. Deliveries: ${inventory.deliveries.ready} queued, ${inventory.deliveries.leased} in flight, ${inventory.deliveries.parked} parked.`),
          node('p', 'This is a snapshot of retained records. Live Discord permissions have not been checked. The Apply step checks Discord and reconciles access before resuming normal work. Sealed cases stay sealed.'));
        if (blockers.length) { const list = node('ul'); for (const code of blockers) list.append(node('li', deploymentBlockers[code] ?? 'Deployment review is required.')); parent.append(list); }
      }
      if (reviewKey !== state.review.draft.sha256) { get('confirm').checked = false; get('review-heading').focus(); reviewKey = state.review.draft.sha256; }
    } else { reviewKey = null; get('confirm').checked = false; get('comparison').replaceChildren(); }
    get('approve').disabled = frozen || !state.review || !get('confirm').checked; get('close-review').disabled = state.busy || !!state.pending;
    get('history').replaceChildren();
    for (const entry of state.history.entries) get('history').append(button(`${state.history.kind === 'drafts' ? 'Draft' : 'Candidate'} ${entry.version ?? entry.revision} · ${entry.status === 'published' ? 'approved for deployment' : entry.status ?? 'saved'} · ${entry.authorId}`,
      () => controller.inspect(state.history.kind, entry.version ?? entry.revision), state.busy || !!state.pending));
    if (state.history.nextBefore) get('history').append(button('Older entries', () => controller.history(state.history.kind, state.history.nextBefore, 'older'), state.busy));
    if (state.history.before) get('history').append(button('Latest entries', () => controller.history(state.history.kind), state.busy));
    get('selected').replaceChildren();
    if (state.selected) {
      const record = state.selected;
      get('selected').append(node('h3', `Retained ${record.kind === 'drafts' ? 'draft' : 'candidate'} ${record.version ?? record.draft?.revision}`),
        node('pre', JSON.stringify(record.candidate ?? record.draft?.document, null, 2)));
      get('selected').append(button('Use as a new draft', () => controller.useSelected(), frozen || state.dirty));
      if (record.kind === 'publications' && record.status === 'published') {
        get('selected').append(button(record.withdrawing ? 'Confirm withdrawal of this candidate' : 'Review withdrawal',
          () => record.withdrawing ? controller.withdraw() : controller.reviewWithdrawal(), frozen || state.dirty));
        if (record.withdrawing) get('selected').append(node('p','Withdrawal prevents future use of this candidate. It does not undo a deployed configuration.'));
      }
    }
  }
  return Object.freeze({ render });
}
