/** Literal public configuration and metadata only. Never render samples, role names or API values as HTML. */
export function createAutomationView({document,controller}) {
  const el=id=>document.getElementById(id),node=(tag,value='')=>{const n=document.createElement(tag);n.textContent=value;return n;};
  const text=(id,value)=>{el(id).textContent=value??'';el(id).hidden=!value;};
  const button=(label,work,disabled)=>{const n=node('button',label);n.type='button';n.disabled=disabled;n.addEventListener('click',work);return n;};
  let reviewed=false,repairing=false,sampleCount=-1,selectedIssue=null;
  for(const [id,method]of [['refresh','checkAccess'],['gate-retry','start'],['logout','logout'],['add-rule','add'],['remove-rule','remove'],
    ['cancel-removal','cancelRemoval'],['confirm-removal','confirmRemoval'],['discard','discard'],['retry-change','retry'],['cancel-review','cancelReview'],
    ['send-change','send'],['add-sample','addSample'],['preview-button','preview'],['cancel-repair','cancelRepair'],['send-repair','sendRepair']])el(id).addEventListener('click',()=>controller[method]());
  el('review-button').addEventListener('click',()=>controller.review());el('withdraw').addEventListener('click',()=>controller.review('withdraw'));
  el('source').addEventListener('input',event=>controller.editSource(event.target.value));
  const fields=['id','channels','matchKind','matchText','caseSensitive','actionKind','response','emojiId','emojiName','priority','stop','userCooldownMs','channelCooldownMs'];
  for(const field of fields)el(`rule-${field}`).addEventListener(['matchKind','actionKind','caseSensitive','stop'].includes(field)?'change':'input',event=>
    controller.editRule(field,['caseSensitive','stop'].includes(field)?event.target.checked:['priority','userCooldownMs','channelCooldownMs'].includes(field)?Number(event.target.value):event.target.value));
  el('confirm-policy').addEventListener('change',event=>controller.confirm(event.target.checked));
  el('synthetic').addEventListener('change',event=>controller.attestSamples(event.target.checked));
  el('confirm-repair').addEventListener('change',event=>controller.confirmRepair(event.target.checked));
  el('recheck').addEventListener('click',()=>controller.reviewRepair('recheck'));
  el('recover').addEventListener('click',()=>controller.reviewRepair('recover',el('message-id').value.trim()));
  el('message-id').addEventListener('input',()=>controller.cancelRepair());
  el('older-history').addEventListener('click',()=>controller.history(controller.snapshot().history.nextBefore));el('latest-history').addEventListener('click',()=>controller.history());
  el('older-issues').addEventListener('click',()=>controller.issues(controller.snapshot().issues.nextBefore));el('latest-issues').addEventListener('click',()=>controller.issues());
  el('older-events').addEventListener('click',()=>{const s=controller.snapshot();controller.openIssue(s.detail.entry.deliveryId,s.detail.nextBefore);});
  el('latest-events').addEventListener('click',()=>controller.openIssue(controller.snapshot().detail.entry.deliveryId));
  function renderDocument(parent,value) {
    parent.replaceChildren();if(!value){parent.append(node('p','No published policy.'));return;}
    parent.append(node('p',`Public source: ${value.source}`));
    for(const rule of value.rules){const article=node('article');article.append(node('h4',rule.id),node('p',`Channels: ${rule.channels.join(', ')}. Priority ${rule.priority}; stop: ${rule.stop?'yes':'no'}. User/channel cooldowns: ${rule.userCooldownMs}/${rule.channelCooldownMs} ms.`),
      node('p',`Match: ${rule.match.kind}, ${rule.match.caseSensitive?'case sensitive':'case insensitive'}`),node('pre',rule.match.text),
      node('p',rule.action.kind==='message'?'Static message (mentions and link previews suppressed)':'Reaction'),
      node('pre',rule.action.kind==='message'?rule.action.text:`${rule.action.emoji.name}${rule.action.emoji.id?` (ID ${rule.action.emoji.id})`:''}`));parent.append(article);}
  }
  function samples(state,frozen) {
    if(sampleCount!==state.samples.length){sampleCount=state.samples.length;el('samples').replaceChildren();
      for(let i=0;i<sampleCount;i++){
        const group=node('fieldset');group.append(node('legend',`Synthetic event ${i+1}`));
        for(const [field,label]of [['atMs','Time in milliseconds (0–86400000)'],['channelId','Channel ID'],['userId','Synthetic user ID'],['content','Synthetic message'],['bot','Bot event'],['webhook','Webhook event'],['self','Sophie event']]){
          const input=node(field==='content'?'textarea':'input');input.id=`sample-${i}-${field}`;
          if(field==='content'){input.rows=3;input.maxLength=4000;}
          else if(['bot','webhook','self'].includes(field))input.type='checkbox';
          else {input.type=field==='atMs'?'number':'text';if(field==='atMs'){input.min='0';input.max='86400000';input.step='1';}else input.maxLength=20;}
          const caption=node('label',label);caption.htmlFor=input.id;group.append(caption,input);
          input.addEventListener(input.type==='checkbox'?'change':'input',()=>controller.sample(i,field,input.type==='checkbox'?input.checked:field==='atMs'?Number(input.value):input.value));
        }
        const remove=button(`Remove synthetic event ${i+1}`,()=>controller.removeSample(i),false);remove.id=`sample-${i}-remove`;group.append(remove);el('samples').append(group);
      }
    }
    for(const [i,row]of state.samples.entries()){
      for(const [field,value]of Object.entries(row)){const input=el(`sample-${i}-${field}`);if(typeof value==='boolean')input.checked=value;else if(input.value!==String(value))input.value=value;input.disabled=frozen;}
      el(`sample-${i}-remove`).disabled=frozen||sampleCount===1;
    }
  }
  return {render(state){
    const ready=state.phase==='ready',frozen=state.busy||!!state.pending||state.removal!==null;
    el('workspace').hidden=!ready;el('gate').hidden=ready;el('signin').hidden=state.phase==='loading';el('logout').hidden=!state.identity;
    el('gate-title').textContent=state.phase==='loading'?'Loading your workspace…':'Automation editor unavailable';
    text('notice',state.notice);text('error',state.error);el('logout').disabled=state.busy;el('gate-retry').disabled=state.busy;
    el('retry-change').hidden=!state.pending;el('retry-change').disabled=state.busy;el('refresh').disabled=state.busy;
    if(!ready||!state.draft){for(const key of ['source','message-id',...fields.map(f=>`rule-${f}`)]){const input=el(key);if(input.type==='checkbox')input.checked=false;else input.value='';}
      for(const key of ['rule-list','previous','proposed','history','samples','preview-output','issues','detail-metadata','events','repair-summary'])el(key).replaceChildren();
      el('review').hidden=true;el('repair-review').hidden=true;el('confirm-policy').checked=false;el('confirm-repair').checked=false;el('synthetic').checked=false;
      reviewed=false;repairing=false;sampleCount=-1;selectedIssue=null;return;
    }
    text('policy-state',state.current?`Current revision ${state.current.revision}: ${state.current.action==='publish'?'published':'withdrawn'}. Editor ${state.current.authorId}. ${state.current.createdAt}`:'No policy has been published.');
    text('dirty',state.dirty?'Unsaved edits remain in this tab. They are cleared when this page is hidden.':null);
    if(el('source').value!==state.draft.source)el('source').value=state.draft.source;el('source').disabled=frozen;
    el('rule-list').replaceChildren();for(const [i,row]of state.draft.rules.entries()){const b=button(`${i+1}. ${row.id||'Untitled rule'}`,()=>controller.select(i),frozen);b.setAttribute('aria-pressed',String(i===state.index));el('rule-list').append(b);}
    const row=state.draft.rules[state.index],values={id:row.id,channels:row.channels.join(', '),matchKind:row.match.kind,matchText:row.match.text,caseSensitive:row.match.caseSensitive,
      actionKind:row.action.kind,response:row.action.text??'',emojiId:row.action.emoji?.id??'',emojiName:row.action.emoji?.name??'',priority:row.priority,stop:row.stop,userCooldownMs:row.userCooldownMs,channelCooldownMs:row.channelCooldownMs};
    for(const [field,value]of Object.entries(values)){const input=el(`rule-${field}`);if(input.type==='checkbox')input.checked=value;else if(input.value!==String(value)&&document.activeElement!==input)input.value=value;input.disabled=frozen;}
    el('message-fields').hidden=row.action.kind!=='message';el('emoji-fields').hidden=row.action.kind!=='reaction';
    el('add-rule').disabled=frozen||state.draft.rules.length>=25;el('remove-rule').disabled=frozen||state.draft.rules.length<=1;
    el('removal').hidden=state.removal===null;text('removal-text',state.removal===null?null:`Remove “${state.draft.rules[state.removal].id}” from this draft? Published history is retained.`);
    for(const key of ['confirm-removal','cancel-removal'])el(key).disabled=state.busy;
    el('review-button').disabled=frozen;el('withdraw').disabled=frozen||state.dirty||state.current?.action!=='publish';el('discard').disabled=frozen||!state.dirty;
    el('review').hidden=!state.review;el('review-heading').textContent=state.review?.action==='withdraw'?'Review withdrawal':'Review publication';
    text('review-state',state.review?`Proposed revision ${state.review.expectedRevision+1}.${state.review.changed?' Another revision was recorded while you were editing. Compare it below.':''}`:null);
    renderDocument(el('previous'),state.review?.previous?.document??null);renderDocument(el('proposed'),state.review?.document??null);
    el('proposed').hidden=state.review?.action==='withdraw';el('confirm-policy').checked=state.checked;el('confirm-policy').disabled=frozen;
    el('confirm-label').textContent=state.review?.action==='withdraw'?'I reviewed withdrawal of the current policy and preservation of its public-source history.':'I reviewed these exact rules and their approved public source. They contain no ticket or onboarding content.';
    el('send-change').textContent=state.review?.action==='withdraw'?'Confirm withdrawal':'Confirm publication';el('send-change').disabled=frozen||!state.review||!state.checked;
    el('cancel-review').disabled=state.busy||!!state.pending;
    samples(state,frozen);el('synthetic').checked=state.synthetic;el('synthetic').disabled=frozen;
    el('add-sample').disabled=frozen||state.samples.length>=20;el('preview-button').disabled=frozen||!state.synthetic;
    el('preview-output').replaceChildren();
    if(state.preview){el('preview-output').append(node('p','Dry-run only. No delivery or retained sample. Mentions and link previews are suppressed.'));
      for(const [i,result]of state.preview.results.entries()){const p=node('article');p.append(node('h3',`Event ${i+1} · ${result.atMs} ms${result.suppressed?' · suppressed':''}`));
        for(const decision of result.decisions)p.append(node('p',`${decision.ruleId}: ${decision.state}`));
        for(const action of result.actions)p.append(node('pre',`${action.ruleId}: ${action.action.kind==='message'?action.action.text:action.action.emoji.name}`));el('preview-output').append(p);}}
    el('history').replaceChildren();for(const item of state.history?.entries??[]){const article=node('details'),summary=node('summary',`Revision ${item.revision} · ${item.action} · editor ${item.authorId}`);article.append(summary,node('p',item.createdAt));
      const content=node('div');renderDocument(content,item.document);article.append(content);if(item.document)article.append(button('Use revision '+item.revision+' as draft',()=>controller.useHistory(item.revision),frozen||state.dirty));el('history').append(article);}
    el('older-history').hidden=!state.history?.nextBefore;el('latest-history').hidden=!state.before;
    el('issues').replaceChildren();for(const item of state.issues?.entries??[]){const article=node('article');article.append(node('p',`${item.deliveryId} · ${item.reason}`));
      if(item.integrity!=='unverified')article.append(button(`Inspect ${item.deliveryId}`,()=>controller.openIssue(item.deliveryId),frozen));el('issues').append(article);}
    text('no-issues',state.issues&&!state.issues.entries.length?'No parked deliveries on this page.':null);
    el('older-issues').hidden=!state.issues?.nextBefore;el('latest-issues').hidden=!state.issuesBefore;
    el('issue-detail').hidden=!state.detail;el('detail-metadata').replaceChildren();el('events').replaceChildren();
    const entry=state.detail?.entry;
    if(selectedIssue!==entry?.deliveryId){el('message-id').value='';selectedIssue=entry?.deliveryId??null;}
    if(entry){for(const [label,value]of [['Delivery',entry.deliveryId],['Rule',entry.ruleId],['Policy revision',entry.policyRevision],['Review version',entry.reviewVersion],['Channel',entry.channelId],['Source message',entry.sourceMessageId],['Action',entry.kind],['State',entry.state],['Job',entry.jobStatus],['Possible send',entry.possibleSend?'yes':'no'],['Receipt',entry.receiptAvailable?'available':'not available'],['Deadline',new Date(entry.expiresAt).toISOString()],['Withdrawal reason',entry.withdrawalReason??'none']])el('detail-metadata').append(node('dt',label),node('dd',String(value)));
      text('issue-reason',entry.reason);for(const event of state.detail.events)el('events').append(node('p',`${event.sequence} · ${event.kind} · ${event.recordedAt}${event.operatorId?` · operator ${event.operatorId}`:''}${event.messageId?` · message ${event.messageId}`:''}`));}
    el('recheck').disabled=frozen||!entry?.canRecheck;el('recover').disabled=frozen||!entry?.canRecover;
    el('message-id-field').hidden=!(entry?.canRecover&&entry.kind==='message');el('message-id').disabled=frozen;
    el('older-events').hidden=!state.detail?.nextBefore;el('latest-events').hidden=!state.eventsBefore;
    for(const key of ['older-history','latest-history','older-issues','latest-issues','older-events','latest-events'])el(key).disabled=frozen;
    el('repair-review').hidden=!state.repair;el('repair-summary').replaceChildren();
    if(state.repair)el('repair-summary').append(node('p',`Delivery ${state.repair.deliveryId}, review version ${state.repair.expectedVersion}. ${state.repair.action==='recheck'?'Release the existing job for a current-policy recheck.':'Verify the existing bot effect'+(state.repair.messageId?` at message ${state.repair.messageId}`:' on the original source message')+'.'}`));
    el('confirm-repair').checked=state.repairChecked;el('confirm-repair').disabled=frozen;el('send-repair').disabled=frozen||!state.repair||!state.repairChecked;el('cancel-repair').disabled=state.busy||!!state.pending;
    if(state.review&&!reviewed)el('review-heading').focus();reviewed=!!state.review;
    if(state.repair&&!repairing)el('repair-heading').focus();repairing=!!state.repair;
  }};
}
