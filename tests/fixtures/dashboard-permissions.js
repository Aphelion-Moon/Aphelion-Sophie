import { initialPermissions, canonicalPermissions, permissionCandidate, permissionDigest, permissionBase } from '../../apps/core/runtime/permission-configuration.js';
import { stagingConfiguration } from './staging.js';
import { GUILD, OTHER, STAFF } from './domain.js';
import { roleList } from './discord.js';
import { DashboardFailure } from '../../apps/dashboard/api.js';

/** Synthetic browser/controller fixture only; never imported by runtime code. */
export function createSyntheticPermissionsApi() {
  const configuration=stagingConfiguration('a'.repeat(64)); configuration.capabilityPolicy.grants['permissions.publish']=[STAFF];
  const state={allowed:true,signedIn:true,loseResponse:false,drafts:[],publications:[],receipts:new Map(),application:null,applyCalls:0};
  const overview=revision=>({initial:initialPermissions(configuration),running:permissionBase(configuration),
    draft:(revision?state.drafts.find(row=>row.revision===revision):state.drafts.at(-1))??null,latest:state.publications.at(-1)??null,
    options:{roles:roleList().filter(row=>!row.managed).map(row=>({id:row.id,name:row.id===STAFF?'Synthetic Staff <img src=x>':'Synthetic role'})),
      categories:[{id:configuration.casePolicy.categoryId,name:'Synthetic category'}]},activation:'deployment-required',applyEnabled:true});
  const conflict=()=>{throw new DashboardFailure('conflict',409);};
  function mutation(kind,body,work) {
    const previous=state.receipts.get(body.requestId); if(previous){if(previous.key!==JSON.stringify([kind,body]))conflict();return {...previous.result,duplicate:true};}
    const result=work();state.receipts.set(body.requestId,{key:JSON.stringify([kind,body]),result});
    if(state.loseResponse){state.loseResponse=false;throw new DashboardFailure('connection');}return result;
  }
  const methods={
    session:()=>({userId:OTHER,guildId:GUILD,canEditPermissions:state.allowed}),logout:()=>{state.signedIn=false;return {};},
    permissionDraft:revision=>overview(revision),
    permissionApplication:()=>({application:state.application}),
    permissionDeploymentReview:version=>{const row=state.publications.find(row=>row.version===version);if(!row)conflict();return {version,sha256:row.sha256,reviewHash:'a'.repeat(64),blockers:[],running:permissionBase(configuration),candidate:row.candidate};},
    permissionApply:body=>mutation('apply',body,()=>{state.applyCalls++;state.application={requestId:body.requestId,version:body.version,state:'queued'};return state.application;}),
    permissionRetryApplication:body=>{if(state.application?.requestId!==body.requestId||state.application.state!=='blocked')conflict();state.application.state='applying';return state.application;},
    permissionSave:body=>mutation('save',body,()=>{
      if((state.drafts.at(-1)?.revision??0)!==body.expectedRevision)conflict();
      const document=canonicalPermissions(body.document,configuration),row={revision:body.expectedRevision+1,document,sha256:permissionDigest(document),authorId:OTHER};
      state.drafts.push(row);return row;
    }),
    permissionReview:revision=>{
      const draft=state.drafts.find(row=>row.revision===revision);if(!draft)conflict();
      if(!draft.document.grants['permissions.publish'].includes(STAFF))throw new DashboardFailure('invalid',400);
      return {draft,currentRevision:state.drafts.at(-1).revision,latest:state.publications.at(-1)??null,valid:true,running:permissionBase(configuration),candidate:permissionCandidate(draft.document,configuration)};
    },
    permissionPublish:body=>mutation('publish',body,()=>{
      const draft=state.drafts.at(-1),latest=state.publications.at(-1);
      if(draft?.revision!==body.expectedRevision||draft.sha256!==body.expectedHash||(latest?.version??0)!==body.expectedLatestVersion||(latest?.status??'none')!==body.expectedLatestStatus)conflict();
      const candidate=permissionCandidate(draft.document,configuration),row={version:body.expectedLatestVersion+1,revision:draft.revision,document:draft.document,candidate,
        sha256:permissionDigest({document:draft.document,candidate}),status:'published',authorId:OTHER};state.publications.push(row);return row;
    }),
    permissionPublication:version=>state.publications.find(row=>row.version===version),
    permissionHistory:(kind,before=null)=>{const key=kind==='drafts'?'revision':'version',entries=[...state[kind]].reverse().filter(row=>before===null||row[key]<before);return {entries:entries.slice(0,10),nextBefore:entries.length>10?entries[9][key]:null};},
    permissionWithdraw:body=>mutation('withdraw',body,()=>{const row=state.publications.find(row=>row.version===body.version);if(!body.confirm||row?.sha256!==body.expectedHash||row.status!=='published')conflict();row.status='withdrawn';return {version:row.version};}),
  };
  const api=Object.fromEntries(Object.entries(methods).map(([name,work])=>[name,async(...args)=>{
    if(!state.signedIn||(!['session','logout'].includes(name)&&!state.allowed))throw new DashboardFailure('denied',403);
    return structuredClone(work(...args));
  }]));return {api,state};
}
