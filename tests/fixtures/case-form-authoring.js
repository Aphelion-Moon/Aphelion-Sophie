import { randomBytes } from 'node:crypto';
import { createCaseFormAuthoringStore } from '../../apps/core/storage/case-form-authoring.js';
import { createCaseFormAuthoringHttp } from '../../apps/core/http/case-form-authoring.js';
import { dashboardServices } from './dashboard-auth.js';
import { intakeWorkflow, syntheticCaseForm } from './case-intake.js';
import { GUILD, OTHER } from './domain.js';

export const formRequestId = () => randomBytes(32).toString('hex');
export function formAuthoringServices(f) {
  const formEditor = createCaseFormAuthoringStore({ pool: f.pool, authorize: f.dashboardAuthorization.authorize, guildId: GUILD });
  const formHttp = createCaseFormAuthoringHttp({ auth: f.auth, authorization: f.dashboardAuthorization, store: formEditor });
  const formActor = (userId = OTHER) => f.dashboardAuthorization.resolveActor(f.verified(f.payload({ member: { user: { id: userId } } })));
  const saveForm = async (document = syntheticCaseForm(), expectedRevision = 0) => formEditor.saveCaseFormDraft({ actor: await formActor(),
    caseType: document.caseType, requestId: formRequestId(), expectedRevision, document });
  const reviewForm = async (revision, caseType = 'admin-help') => formEditor.reviewCaseFormDraft({ actor: await formActor(), caseType, revision });
  const publishFormRequest = review => ({ caseType: review.caseType, requestId: formRequestId(), expectedRevision: review.draft.revision, expectedHash: review.draft.sha256,
    expectedLatestVersion: review.latest?.version ?? 0, expectedLatestStatus: review.latest?.status ?? 'none' });
  const publishForm = async (revision, caseType = 'admin-help') => formEditor.publishCaseFormDraft({ actor: await formActor(), ...publishFormRequest(await reviewForm(revision, caseType)) });
  return { ...f, formEditor, formHttp, formActor, saveForm, reviewForm, publishFormRequest, publishForm };
}
export async function formAuthoringWorkflow(cluster) { return formAuthoringServices(dashboardServices(await intakeWorkflow(cluster))); }
