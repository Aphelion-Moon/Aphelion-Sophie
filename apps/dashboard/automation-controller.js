import { DashboardFailure } from './api.js';
import { canonicalAutomation, previewAutomation } from '../../modules/automation/index.js';

const copy = value => structuredClone(value), same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const deliveryId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const integer = (value,min = 0) => Number.isSafeInteger(value) && value >= min && value <= 2147483646;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = () => { throw new DashboardFailure('invalid'); };
const unavailable = () => { throw new DashboardFailure('unavailable'); };
const rule = name => ({id:name,channels:[],match:{kind:'contains',text:'',caseSensitive:false},action:{kind:'message',text:''},
  priority:10,stop:true,userCooldownMs:3000,channelCooldownMs:1000});
const empty = () => ({source:'',rules:[rule('rule-1')]});
const sample = () => ({atMs:0,channelId:'',userId:'1',content:'',bot:false,webhook:false,self:false});
function canonical(value) { try { return canonicalAutomation(value); } catch { invalid(); } }
function record(row) {
  if (!row || !integer(row.revision,1) || !id(row.authorId) || !date(row.createdAt) ||
    !(row.action === 'publish' ? hash(row.sha256) : row.action === 'withdraw' && row.document === null && row.sha256 === null)) unavailable();
  if (row.action === 'publish') { try { canonicalAutomation(row.document); } catch { unavailable(); } }
  return row;
}
function issue(row, corrupt = true) {
  if (!row || !deliveryId(row.deliveryId)) unavailable();
  if (corrupt && row.integrity === 'unverified' && row.canRecheck === false && row.canRecover === false && typeof row.reason === 'string') return row;
  if (!integer(row.reviewVersion) || !integer(row.policyRevision,1) || !id(row.channelId) || !id(row.sourceMessageId) || !id(row.userId) ||
    !['message','reaction'].includes(row.kind) || !['pending','confirmed','cancelled','withdrawn'].includes(row.state) || typeof row.jobStatus !== 'string' ||
    !['possibleSend','receiptAvailable','canRecheck','canRecover'].every(key => typeof row[key] === 'boolean') ||
    (row.messageId !== null && !id(row.messageId)) || !Number.isSafeInteger(row.expiresAt) || typeof row.ruleId !== 'string' || typeof row.reason !== 'string' ||
    (row.canRecheck && row.possibleSend && !row.receiptAvailable) || (row.canRecover && (!row.possibleSend || row.receiptAvailable || row.state !== 'pending'))) unavailable();
  return row;
}

/** Memory-only authored public rules, synthetic samples and metadata recovery. No activation or message-reading route. */
export function createAutomationController({ api, onChange, newRequestId }) {
  let state = { phase:'loading',identity:null,busy:false,current:null,history:null,before:null,draft:null,baseRevision:0,dirty:false,index:0,
    removal:null,review:null,checked:false,samples:[sample()],synthetic:false,preview:null,issues:null,issuesBefore:null,detail:null,eventsBefore:null,
    repair:null,repairChecked:false,pending:null,error:'',notice:'' };
  let generation=0;
  const snapshot=()=>copy(state),emit=()=>onChange(snapshot());
  const editable=()=>state.phase==='ready'&&!!state.draft&&!state.busy&&!state.pending&&state.removal===null;
  const invalidate=()=>{state.review=null;state.checked=false;state.preview=null;state.notice='';};
  function clear(phase) {
    const uncertain=!!state.pending;
    Object.assign(state,{phase,current:null,history:null,before:null,draft:null,baseRevision:0,dirty:false,index:0,removal:null,
      review:null,checked:false,samples:[sample()],synthetic:false,preview:null,issues:null,issuesBefore:null,detail:null,eventsBefore:null,
      repair:null,repairChecked:false,pending:null});
    if(uncertain)state.notice='A submitted operation may still complete. Check current policy or delivery history before making another request.';
  }
  function bound(value) { if(value?.actorId!==state.identity?.userId||value?.guildId!==state.identity?.guildId)throw new DashboardFailure('denied');return value; }
  async function run(work) {
    if(state.busy)return;
    const token=++generation,ctx={active:()=>token===generation,stage:'read'};state.busy=true;state.error='';emit();
    try {
      const identity=await api.session();if(!ctx.active())return;
      if(state.identity&&(identity.userId!==state.identity.userId||identity.guildId!==state.identity.guildId)) {
        clear('loading');state.identity=identity;state.notice='Your account changed. Drafts, samples and recovery reviews were cleared. Reload to continue.';return;
      }
      state.identity=identity;
      if(!identity.canEditAutomation){clear('denied');state.error='Current automation-editor permission is required.';return;}
      state.phase='ready';await work(ctx);
    } catch(error) {
      if(!ctx.active())return;
      state.review=null;state.checked=false;state.repair=null;state.repairChecked=false;
      if(error.kind==='denied'){clear('denied');state.identity=null;state.error='Your sign-in or automation permission could not be verified.';}
      else if(ctx.stage==='send') {
        if(['conflict','invalid','missing'].includes(error.kind)) {
          state.pending=null;state.error='The operation was rejected or its version changed. Reload and review the current state before retrying.';
        } else state.error='The result is uncertain. Retry the same request to recover its receipt; do not create another operation.';
      } else if(['review','preview'].includes(ctx.stage)) state.error='The draft, selection or current revision could not be verified. Refresh and review again; use only approved non-case channels.';
      else {clear('unavailable');state.error='Current access or automation data could not be verified. Drafts, samples and history were cleared.';}
    } finally {if(ctx.active()){state.busy=false;emit();}}
  }
  async function current(ctx) {
    const value=await api.automation();if(!ctx.active())return;bound(value);
    state.current=value.current===null?null:record(value.current);
    if(!state.dirty&&!state.pending){state.draft=copy(state.current?.document??empty());state.baseRevision=state.current?.revision??0;state.index=0;}
  }
  async function history(ctx,before=null) {
    const value=await api.automationHistory(before);if(!ctx.active())return;bound(value);
    if(!Array.isArray(value.entries)||value.entries.length>10||!value.entries.every((row,i)=>record(row)&&row.revision<(i?value.entries[i-1].revision:before??2147483647))||
      !(value.nextBefore===null||value.entries.length===10&&value.nextBefore===value.entries.at(-1).revision))unavailable();
    state.history=value;state.before=before;
  }
  async function issues(ctx,before=null) {
    const value=await api.automationIssues(before);if(!ctx.active())return;bound(value);
    if(!Array.isArray(value.entries)||value.entries.length>10||!value.entries.every((row,i)=>issue(row)&&(!i&&!before||row.deliveryId<(i?value.entries[i-1].deliveryId:before)))||
      !(value.nextBefore===null||value.entries.length===10&&value.nextBefore===value.entries.at(-1).deliveryId))unavailable();
    state.issues=value;state.issuesBefore=before;
  }
  async function detail(ctx,value,before=null) {
    const result=await api.automationIssue(value,before);if(!ctx.active())return;bound(result);issue(result.entry,false);
    if(result.entry.deliveryId!==value||!Array.isArray(result.events)||result.events.length>10||
      !result.events.every((row,i)=>integer(row.sequence,1)&&row.sequence<(i?result.events[i-1].sequence:before??2147483647)&&typeof row.kind==='string'&&date(row.recordedAt)&&(row.operatorId===null||id(row.operatorId))&&(row.messageId===null||id(row.messageId)))||
      !(result.nextBefore===null||result.events.length===10&&result.nextBefore===result.events.at(-1).sequence))unavailable();
    state.detail=result;state.eventsBefore=before;
  }
  async function refresh(ctx) {await current(ctx);if(ctx.active())await history(ctx);if(ctx.active())await issues(ctx);}
  async function submit(ctx) {
    if(!state.pending)return;ctx.stage='send';const {kind,body}=state.pending;
    const result=await (kind==='policy'?api.changeAutomation(body):api.repairAutomation(body));if(!ctx.active())return;bound(result);
    if(typeof result.duplicate!=='boolean'||(kind==='policy'?(result.revision!==body.expectedRevision+1||result.action!==body.action):
      (result.deliveryId!==body.deliveryId||result.action!==body.action||result.acceptedVersion!==body.expectedVersion+1||result.recorded!==true)))unavailable();
    state.pending=null;state.review=null;state.checked=false;state.repair=null;state.repairChecked=false;
    state.notice=kind==='policy'?`${body.action==='publish'?'Publication':'Withdrawal'} recorded at revision ${result.revision}. Publication does not activate automation.`:
      'Recovery request recorded. This is not confirmation that delivery completed; the worker still applies current policy and deadlines.';
    if(kind==='policy'){state.dirty=false;state.samples=[sample()];state.synthetic=false;state.preview=null;}
    ctx.stage='read';await refresh(ctx);if(ctx.active()&&kind==='repair')await detail(ctx,body.deliveryId);
  }
  return Object.freeze({snapshot,
    start:()=>run(refresh),
    checkAccess:()=>run(async ctx=>{
      const revision=state.current?.revision??0,previousDetail=state.detail?.entry;await refresh(ctx);if(!ctx.active())return;
      if(revision!==(state.current?.revision??0))invalidate();
      if(state.detail){await detail(ctx,state.detail.entry.deliveryId);if(ctx.active()&&!same(previousDetail,state.detail.entry)){state.repair=null;state.repairChecked=false;}}
    }),
    editSource(value){if(editable()){state.draft.source=value;state.dirty=true;invalidate();emit();}},
    select(index){if(editable()&&integer(index)&&index<state.draft.rules.length){state.index=index;emit();}},
    editRule(field,value){if(!editable()||!state.draft)return;const row=state.draft.rules[state.index];
      if(['id','priority','stop','userCooldownMs','channelCooldownMs'].includes(field))row[field]=value;
      else if(field==='channels')row.channels=value.trim()?value.split(/[\s,]+/).filter(Boolean):[];
      else if(['matchKind','matchText','caseSensitive'].includes(field))row.match[{matchKind:'kind',matchText:'text',caseSensitive:'caseSensitive'}[field]]=value;
      else if(field==='actionKind'&&['message','reaction'].includes(value))row.action=value==='message'?{kind:'message',text:''}:{kind:'reaction',emoji:{id:null,name:''}};
      else if(field==='response'&&row.action.kind==='message')row.action.text=value;
      else if(field==='emojiName'&&row.action.kind==='reaction')row.action.emoji.name=value;
      else if(field==='emojiId'&&row.action.kind==='reaction')row.action.emoji.id=value.trim()||null;
      else return;state.dirty=true;invalidate();emit();
    },
    add(){if(!editable()||state.draft.rules.length>=25)return;let n=1;while(state.draft.rules.some(row=>row.id===`rule-${n}`))n++;
      state.draft.rules.push(rule(`rule-${n}`));state.index=state.draft.rules.length-1;state.dirty=true;invalidate();emit();},
    remove(){if(editable()&&state.draft.rules.length>1){state.removal=state.index;emit();}},
    cancelRemoval(){if(!state.busy){state.removal=null;emit();}},
    confirmRemoval(){if(state.removal!==null&&!state.busy&&!state.pending){state.draft.rules.splice(state.removal,1);state.index=Math.min(state.index,state.draft.rules.length-1);state.removal=null;state.dirty=true;invalidate();emit();}},
    discard(){if(!state.pending)return run(async ctx=>{state.dirty=false;invalidate();await current(ctx);});},
    useHistory(revision){if(!editable()||state.dirty)return;const row=state.history?.entries.find(row=>row.revision===revision&&row.action==='publish');
      if(row){state.draft=copy(row.document);state.index=0;state.dirty=true;invalidate();emit();}},
    review(action='publish') {if(!editable()||!['publish','withdraw'].includes(action)||(action==='withdraw'&&(state.dirty||state.current?.action!=='publish')))return;
      return run(async ctx=>{ctx.stage='review';invalidate();const base=state.baseRevision,document=action==='publish'?canonical(state.draft):null;
        await current(ctx);if(!ctx.active())return;const request={expectedRevision:state.current?.revision??0,action,document};
        const result=await api.reviewAutomation(request);if(!ctx.active())return;bound(result);
        if(result.expectedRevision!==request.expectedRevision||result.action!==action||!same(result.document,document)||!hash(result.reviewSha256)||result.preservesHistory!==true||
          !(request.expectedRevision===0?result.previous===null:record(result.previous)&&result.previous.revision===request.expectedRevision))unavailable();
        state.review={...request,reviewSha256:result.reviewSha256,previous:result.previous,changed:base!==request.expectedRevision};
      });
    },
    confirm(value){if(!state.busy&&state.review&&!state.pending){state.checked=value===true;emit();}},
    cancelReview(){if(!state.busy&&!state.pending){invalidate();emit();}},
    send(){if(!editable()||!state.review||!state.checked)return;return run(async ctx=>{if(!state.review)return;
      const {previous:_,changed:__,...body}=state.review;state.pending={kind:'policy',body:{...body,requestId:newRequestId(),confirmed:true,approvedPublic:true}};await submit(ctx);});},
    sample(index,field,value){if(!editable()||!state.samples[index]||!Object.hasOwn(state.samples[index],field))return;state.samples[index][field]=value;state.preview=null;state.synthetic=false;emit();},
    addSample(){if(editable()&&state.samples.length<20){state.samples.push({...sample(),atMs:state.samples.at(-1).atMs,channelId:state.samples.at(-1).channelId});state.preview=null;state.synthetic=false;emit();}},
    removeSample(index){if(editable()&&state.samples.length>1&&integer(index)&&index<state.samples.length){state.samples.splice(index,1);state.preview=null;state.synthetic=false;emit();}},
    attestSamples(value){if(editable()){state.synthetic=value===true;emit();}},
    preview(){if(!editable()||!state.synthetic)return;return run(async ctx=>{ctx.stage='preview';const document=canonical(state.draft),events=copy(state.samples);state.preview=null;
      try{previewAutomation(document,events,new Set());}catch{invalid();}
      const result=await api.previewAutomation({expectedRevision:state.baseRevision,document,events,synthetic:true});if(!ctx.active())return;bound(result);
      if(result.expectedRevision!==state.baseRevision||!hash(result.documentSha256)||result.dryRun!==true||result.deliveryEnabled!==false||result.sampleRetained!==false||result.mentions!=='none'||result.linkPreviews!==false||result.maxActionsPerMessage!==3||!Array.isArray(result.results)||result.results.length!==events.length)unavailable();
      for(const [i,row]of result.results.entries())if(row.atMs!==events[i].atMs||typeof row.suppressed!=='boolean'||!Array.isArray(row.decisions)||row.decisions.length>25||!row.decisions.every(d=>document.rules.some(r=>r.id===d.ruleId)&&['unmatched','stopped','channel','cooldown','limit','selected'].includes(d.state))||
        !Array.isArray(row.actions)||row.actions.length>3||!row.actions.every(a=>document.rules.some(r=>r.id===a.ruleId&&same(r.action,a.action))))unavailable();
      state.preview=result;
    });},
    history(before=null){if(!state.pending)return run(ctx=>history(ctx,before));},
    issues(before=null){if(!state.pending)return run(ctx=>issues(ctx,before));},
    openIssue(value,before=null){if(state.pending||!deliveryId(value))return;return run(async ctx=>{state.repair=null;state.repairChecked=false;await detail(ctx,value,before);});},
    reviewRepair(action,messageId=null){if(!editable()||!state.detail||!['recheck','recover'].includes(action))return;
      return run(async ctx=>{ctx.stage='review';state.repair=null;state.repairChecked=false;const old=state.detail.entry;
        await detail(ctx,old.deliveryId);if(!ctx.active())return;const entry=state.detail.entry;
        if(entry.reviewVersion!==old.reviewVersion)throw new DashboardFailure('conflict');
        if(action==='recheck'?!entry.canRecheck:!entry.canRecover)invalid();
        const value=action==='recover'&&entry.kind==='message'?messageId:null;if(action==='recover'&&entry.kind==='message'&&!id(value))invalid();
        state.repair={deliveryId:entry.deliveryId,expectedVersion:entry.reviewVersion,action,messageId:value};
      });
    },
    confirmRepair(value){if(!state.busy&&state.repair&&!state.pending){state.repairChecked=value===true;emit();}},
    cancelRepair(){if(!state.busy&&!state.pending){state.repair=null;state.repairChecked=false;emit();}},
    sendRepair(){if(!editable()||!state.repair||!state.repairChecked)return;return run(async ctx=>{
      state.pending={kind:'repair',body:{...state.repair,requestId:newRequestId(),confirmed:true}};await submit(ctx);
    });},
    retry(){if(state.pending)return run(submit);},
    suspend(){++generation;clear('loading');state.busy=false;state.notice||='Drafts and synthetic samples were cleared while this page was hidden.';emit();},
    async logout(){++generation;clear('signed-out');state.identity=null;state.busy=true;emit();const token=generation;
      try{await api.logout();if(token===generation)state.notice='You have signed out.';}catch{if(token===generation)state.error='Sign-out could not be confirmed. Sign in again to retry.';}
      finally{if(token===generation){state.busy=false;emit();}}
    },
  });
}
