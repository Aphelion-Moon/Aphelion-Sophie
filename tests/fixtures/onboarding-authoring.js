import { randomBytes } from 'node:crypto';
import { createOnboardingAuthoringStore } from '../../apps/core/storage/onboarding-authoring.js';
import { createOnboardingAuthoringHttp } from '../../apps/core/http/onboarding-authoring.js';
import { dashboardWorkflow } from './dashboard-auth.js';
import { GUILD, OTHER, LEAD, publication } from './domain.js';

export const editorRequestId = () => randomBytes(32).toString('hex');
export const draftDocument = () => ({ helpPauses: publication.helpPauses, stages: structuredClone(publication.stages) });
export function authoringServices(f) {
  const editorStore = createOnboardingAuthoringStore({ pool: f.pool, authorize: f.dashboardAuthorization.authorize, guildId: GUILD, definitionId: publication.id });
  const editorHttp = createOnboardingAuthoringHttp({ auth: f.auth, authorization: f.dashboardAuthorization, store: editorStore });
  const editorActor = (userId = OTHER) => f.dashboardAuthorization.resolveActor(f.verified(f.payload({ member: { user: { id: userId } } })));
  const save = async (document = draftDocument(), expectedRevision = 0) => editorStore.saveOnboardingDraft({ actor: await editorActor(), requestId: editorRequestId(), document, expectedRevision });
  const review = async revision => editorStore.reviewOnboardingDraft({ actor: await editorActor(), revision });
  const publishRequest = review => ({ requestId: editorRequestId(), expectedRevision: review.draft.revision, expectedHash: review.draft.sha256,
    expectedLatestVersion: review.latest?.version ?? 0, expectedLatestStatus: review.latest?.status ?? 'none' });
  const publish = async revision => editorStore.publishOnboardingDraft({ actor: await editorActor(), ...publishRequest(await review(revision)) });
  return { ...f, editorStore, editorHttp, editorActor, save, review, publishRequest, publish };
}
export async function authoringWorkflow(cluster) {
  const f = await dashboardWorkflow(cluster); f.discord.state.members.set(OTHER, [LEAD]); return authoringServices(f);
}
