import { createAuthoringController } from './authoring-controller.js';

export function createPermissionsController({ api, onChange, newRequestId }) {
  let application=null, applicationReview=null, applicationPending=null, applicationError='', applicationBusy=false, polling=false;
  const applicationState=()=>({application,applicationReview,applicationPending,applicationError,applicationBusy});
  const changed=state=>{
    if(state.phase!=='ready') { application=null;applicationReview=null;applicationPending=null;applicationError=''; }
    onChange({...state,...structuredClone(applicationState())});
  };
  const { edit, ...workflow } = createAuthoringController({ onChange:changed, newRequestId,
    api: { session: () => api.session(), logout: () => api.logout(), draft: (_, revision = null) => api.permissionDraft(revision),
      history: (_, ...args) => api.permissionHistory(...args), review: (_, revision) => api.permissionReview(revision),
      publication: (_, version) => api.permissionPublication(version), save: body => api.permissionSave(body),
      publish: body => api.permissionPublish(body), withdraw: body => api.permissionWithdraw(body) },
    profile: { capability: 'canEditPermissions', emptyDraft: (_, overview) => overview.initial, pageCount: () => 1, scope: () => ({}),
      currentVersion: () => null, comparisonOf: record => record.document, draftOf: record => record.document,
      invalidMessage: 'Check role ownership and responder selections. Head Admin contact must use only lead ops. Keep a permissions-editor role you currently hold to prevent lockout.',
      mutationNotice: (kind, receipt) => kind === 'save' ? `Draft revision ${receipt.revision} was saved.` : kind === 'publish' ?
        `Settings version ${receipt.version} is approved. Review and apply it to change the running configuration.` :
        `Candidate ${receipt.version} was withdrawn. Running permissions have not changed.` },
  });
  const emit=()=>changed(workflow.snapshot());
  const blocked=()=>applicationBusy||!!applicationPending||['queued','applying','blocked'].includes(application?.state);
  const refreshApplication=async(force=true)=>{
    if(!force&&!applicationPending&&!['queued','applying'].includes(application?.state))return;
    if(polling||workflow.snapshot().phase!=='ready')return;
    polling=true;
    try { const result=await api.permissionApplication();application=result.application;
      if(application&&['applied','cancelled','blocked'].includes(application.state)){applicationPending=null;applicationReview=null;}
      applicationError='';emit();
    }catch(error){ if(error.kind==='denied'){await workflow.checkAccess();} }
    finally{polling=false;}
  };
  return Object.freeze({ ...workflow,
    snapshot:()=>({...workflow.snapshot(),...structuredClone(applicationState())}),
    async start(){await workflow.start();if(api.permissionApplication)await refreshApplication();},
    refreshApplication,
    async retryBlocked(){
      if(applicationBusy||application?.state!=='blocked')return;
      applicationBusy=true;applicationError='';emit();
      try{await api.permissionRetryApplication({requestId:application.requestId,confirm:true});await refreshApplication();}
      catch{applicationError='Recovery could not be requested. Check status before trying again.';}
      finally{applicationBusy=false;emit();}
    },
    async reviewApply(){
      const state=workflow.snapshot();if(blocked()||state.busy||state.dirty||!state.overview?.applyEnabled||state.overview.latest?.status!=='published')return;
      applicationBusy=true;applicationError='';emit();
      try{applicationReview=await api.permissionDeploymentReview(state.overview.latest.version);}
      catch{applicationError='The settings changed or could not be checked. Reload and review them again.';}
      finally{applicationBusy=false;emit();}
    },
    closeApply(){if(applicationBusy||applicationPending)return;applicationReview=null;emit();},
    async applyConfiguration(){
      if(applicationBusy||(!applicationReview&&!applicationPending))return;
      if(!applicationPending){if(applicationReview.blockers.length)return;applicationPending={requestId:newRequestId(),version:applicationReview.version,
        expectedHash:applicationReview.sha256,expectedReviewHash:applicationReview.reviewHash,confirm:true};}
      applicationBusy=true;applicationError='';emit();
      try{application=await api.permissionApply(structuredClone(applicationPending));applicationPending=null;applicationReview=null;}
      catch(error){if(['invalid','conflict','denied'].includes(error.kind)){applicationPending=null;applicationReview=null;applicationError='Apply was rejected. Reload and review the current settings.';}
        else applicationError='The apply response was interrupted. Check status or retry the same request; your settings will not be applied twice.';}
      finally{applicationBusy=false;emit();}
    },
    mapping(key, value) {
      if(blocked())return;
      if (!['crew', 'whitelist', 'muzzled', 'staff', 'leadOps', 'categoryId'].includes(key)) return;
      edit(document => { document[key] = value; if (key === 'leadOps') document.responders['head-admin-contact'] = [value]; });
    },
    roles(group, key, values) {
      if(blocked())return;
      if (!['grants', 'responders'].includes(group) || !Object.hasOwn(workflow.snapshot().document?.[group] ?? {}, key) || key === 'head-admin-contact') return;
      edit(document => { document[group][key] = [...values].sort(); });
    },
    rebase() {
      if(blocked())return;
      const initial = workflow.snapshot().overview?.initial;
      if (initial) edit(document => { document.baseHash = initial.baseHash; }, 'Rebase these selections onto the running policy? Review all changes again before approval.');
    },
  });
}
