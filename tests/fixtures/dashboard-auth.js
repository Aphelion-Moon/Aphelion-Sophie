import { createDashboardAuthStore } from '../../apps/core/storage/dashboard-auth.js';
import { createDashboardAuth } from '../../apps/core/security/dashboard-auth.js';
import { createDiscordOAuth } from '../../apps/core/discord/oauth.js';
import { createCorePrincipals } from '../../apps/core/security/principals.js';
import { createCoreAuthorization } from '../../apps/core/security/authorization.js';
import { createActorAuthorityStore } from '../../apps/core/storage/actor-authority.js';
import { createCoreStore } from '../../apps/core/storage/core-store.js';
import { onboardingWorkflow } from './onboarding-workflow.js';
import { casePolicy } from './cases.js';
import { dashboardConfiguration, syntheticClientSecret, simulatedOAuth } from './oauth.js';
import { OTHER } from './domain.js';

export function dashboardServices(f, configuration = dashboardConfiguration) {
  const provider = simulatedOAuth(), clock = () => f.clock.now, enabled = () => f.clock.enabled;
  const authStore = createDashboardAuthStore({ pool: f.pool, configuration, clock });
  const oauth = createDiscordOAuth({ configuration, clientSecret: syntheticClientSecret, fetch: provider.fetch, clock, enabled });
  const auth = createDashboardAuth({ configuration, store: authStore, oauth, discord: f.discord.roles, clock, enabled });
  const principals = createCorePrincipals({ interactions: f.identities.verifier, dashboard: auth });
  const authorization = createCoreAuthorization({ principals, discord: f.discord.roles, policy: f.policy, clock, isAuthorityCurrent: enabled,
    authorityStore: createActorAuthorityStore({ pool: f.pool, clock }), readContinuity: f.discord.roles.readContinuity });
  const protectedStore = createCoreStore({ pool: f.pool, clock, authorize: authorization.authorize, authorizeRecorded: authorization.authorizeRecorded,
    resolveCaseResponder: authorization.resolveCaseResponder, resolveCaseParticipant: authorization.resolveCaseParticipant,
    authorizeCaseParticipant: authorization.authorizeCaseParticipant, casePolicy, caseVerification: f.discord.channels.verification });
  const permitLogin = () => f.admin.query("UPDATE sophie_core.dashboard_auth_limits SET not_before = '-infinity'");
  async function begin(previousBinding = null) { await permitLogin(); const result = await auth.begin(previousBinding); return { ...result, state: new URL(result.location).searchParams.get('state') }; }
  const complete = (flow, userId = OTHER, previousToken = null) => auth.complete({ state: flow.state, binding: flow.binding, code: provider.issueCode(userId), previousToken });
  const login = async (userId = OTHER, previousToken = null) => complete(await begin(), userId, previousToken);
  return { ...f, provider, authStore, oauth, auth, principals, dashboardAuthorization: authorization, protectedStore, permitLogin, begin, complete, login };
}

export async function dashboardWorkflow(cluster) { return dashboardServices(await onboardingWorkflow(cluster)); }
