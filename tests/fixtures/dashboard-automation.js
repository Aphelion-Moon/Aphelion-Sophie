import { createHash } from 'node:crypto';
import { DashboardFailure } from '../../apps/dashboard/api.js';
import { canonicalAutomation, previewAutomation } from '../../modules/automation/index.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),copy=value=>structuredClone(value);
/** Synthetic browser fixture. No Discord access, database, credentials or real messages. */
export function createSyntheticAutomationApi({identity=()=>({userId:'123',guildId:'456'})}={}) {
  const state={allowed:true,signedIn:true,records:[],issues:[],receipts:new Map(),calls:[],loseResponse:false};
  const actor=()=>({actorId:identity().userId,guildId:identity().guildId});
  const access=()=>{if(!state.signedIn||!state.allowed)throw new DashboardFailure('denied',403);};
  const publicDocument=canonicalAutomation({source:'Synthetic public policy; not community rules',rules:[{id:'public-help',channels:['123'],
    match:{kind:'contains',text:'help',caseSensitive:false},action:{kind:'message',text:'Synthetic <img src=x onerror=alert(1)>\n@everyone'},priority:10,stop:true,userCooldownMs:3000,channelCooldownMs:1000}]});
  function append(document=publicDocument,action='publish') {
    const row={revision:state.records.length+1,action,document:document===null?null:canonicalAutomation(document),sha256:document===null?null:hash(canonicalAutomation(document)),authorId:identity().userId,createdAt:new Date(1700000000000+state.records.length*1000).toISOString()};
    state.records.push(row);return copy(row);
  }
  for(let i=0;i<12;i++)append();
  for(let i=12;i>=1;i--)state.issues.push({deliveryId:i.toString(16).padStart(32,'0'),reviewVersion:1,ruleId:'public-help',policyRevision:12,channelId:'123',sourceMessageId:'789',userId:'124',
    kind:i===11?'reaction':'message',state:'pending',jobStatus:'parked',possibleSend:i>=11,receiptAvailable:false,messageId:null,withdrawalReason:null,
    expiresAt:1700000000000,reason:i>=11?'The send outcome is unknown. Verify an existing effect; never repeat the send.':'Synthetic parked job',canRecheck:i<11,canRecover:i>=11});
  state.issues[2]={deliveryId:state.issues[2].deliveryId,integrity:'unverified',canRecheck:false,canRecover:false,reason:'Retained references failed verification.'};
  const page=(rows,field,before)=>{const eligible=rows.filter(row=>before===null||row[field]<before),entries=copy(eligible.slice(0,10));return {...actor(),entries,nextBefore:eligible.length>10?entries.at(-1)[field]:null};};
  const review=request=>{access();if(request.expectedRevision!==state.records.length)throw new DashboardFailure('conflict',409);
    return {...copy(request),previous:copy(state.records.at(-1)??null),reviewSha256:hash(request),preservesHistory:true,...actor()};};
  async function mutation(method,request,work) {
    access();state.calls.push({method,request:copy(request)});const key=JSON.stringify(request),prior=state.receipts.get(request.requestId);
    if(prior){if(prior.key!==key)throw new DashboardFailure('conflict',409);return {...prior.result,duplicate:true,...actor()};}
    const result=work();state.receipts.set(request.requestId,{key,result});
    if(state.loseResponse){state.loseResponse=false;throw new DashboardFailure('connection',503);}return copy(result);
  }
  const api={
    session:async()=>{if(!state.signedIn)throw new DashboardFailure('denied',403);return {...identity(),canEditAutomation:state.allowed};},
    logout:async()=>{state.signedIn=false;},
    automation:async()=>{access();return {...actor(),current:copy(state.records.at(-1)??null)};},
    automationHistory:async(before=null)=>{access();return page([...state.records].reverse(),'revision',before);},
    reviewAutomation:async request=>review(request),
    previewAutomation:async request=>{access();if(request.expectedRevision!==state.records.length)throw new DashboardFailure('conflict',409);
      return {...previewAutomation(request.document,request.events,new Set()),expectedRevision:request.expectedRevision,documentSha256:hash(request.document),deliveryEnabled:false,sampleRetained:false,mentions:'none',linkPreviews:false,...actor()};},
    changeAutomation:async request=>mutation('change',request,()=>{
      const {expectedRevision,action,document}=request,checked=review({expectedRevision,action,document});
      if(request.reviewSha256!==checked.reviewSha256||request.confirmed!==true||request.approvedPublic!==true)throw new DashboardFailure('invalid',400);
      const row=append(document,action);return {...actor(),revision:row.revision,action,duplicate:false};}),
    automationIssues:async(before=null)=>{access();return page(state.issues,'deliveryId',before);},
    automationIssue:async(deliveryId,before=null)=>{access();const entry=state.issues.find(row=>row.deliveryId===deliveryId);if(!entry||entry.integrity)throw new DashboardFailure('missing',404);
      const rows=Array.from({length:12},(_,i)=>({sequence:12-i,kind:'synthetic-event',recordedAt:new Date(1700000000000).toISOString(),operatorId:null,messageId:null})),result=page(rows,'sequence',before);
      return {...actor(),entry:copy(entry),events:result.entries,nextBefore:result.nextBefore};},
    repairAutomation:async request=>mutation('repair',request,()=>{
      const entry=state.issues.find(row=>row.deliveryId===request.deliveryId);if(!entry||entry.reviewVersion!==request.expectedVersion)throw new DashboardFailure('conflict',409);
      if(request.confirmed!==true||!(request.action==='recover'?entry.canRecover:entry.canRecheck))throw new DashboardFailure('invalid',400);
      entry.reviewVersion++;entry.canRecover=false;entry.canRecheck=false;entry.jobStatus='pending';return {...actor(),deliveryId:entry.deliveryId,action:request.action,acceptedVersion:entry.reviewVersion,recorded:true,duplicate:false};}),
  };
  return {api,state,append,publicDocument};
}
