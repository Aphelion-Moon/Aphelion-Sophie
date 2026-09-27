import { requireCondition } from '../../../contracts/validation.js';
import { requireConfiguredCapability } from '../../../platform/authorization/actor-policy.js';
import { createDashboardAuth } from '../security/dashboard-auth.js';
import { createDashboardAuthStore } from '../storage/dashboard-auth.js';
import { createDiscordOAuth } from '../discord/oauth.js';
import { createDiscordRoles } from '../discord/roles.js';
import { createCoreAuthorization } from '../security/authorization.js';
import { createActorAuthorityStore } from '../storage/actor-authority.js';
import { createPermissionEditor } from '../storage/permission-editor.js';
import { createPermissionOptions } from '../discord/permission-options.js';
import { createPermissionEditorHttp } from '../http/permission-editor.js';
import { createDashboardAuthHttpServer } from '../http/dashboard-auth.js';
import { createDashboardPresentation } from '../http/dashboard-assets.js';
import { requireUnquarantinedDatabase } from './recovery.js';

/** During maintenance only the applying administrator can inspect progress or retry.
 * No case API, new candidate mutation, generic owner operation or Discord write is exposed.
 */
export async function createConfigurationDashboard({pool,configuration,request,transport,clientSecret,fetch,clock,enabled,onFault}) {
  await requireUnquarantinedDatabase(pool);
  const stamp=async()=>{requireCondition(await enabled(),'MAINTENANCE_STALE');return `configuration.dashboard.${request.request_id}`;};
  const roles=createDiscordRoles({transport,mapping:configuration.mapping,clock,readContinuity:stamp});
  const auth=createDashboardAuth({configuration:configuration.dashboard,
    store:createDashboardAuthStore({pool,configuration:configuration.dashboard,clock}),
    oauth:createDiscordOAuth({configuration:configuration.dashboard,clientSecret,fetch,clock,enabled}),discord:roles,clock,enabled});
  const principals={async resolvePrincipal(proof){
    const principal=await auth.resolvePrincipal(proof);
    requireCondition(principal.userId===request.operator_grant.userId,'OPERATION_DENIED');
    requireConfiguredCapability(configuration.capabilityPolicy,'permissions.publish',await roles.observeActor(principal.userId),clock());
    return principal;
  }};
  const authorization=createCoreAuthorization({principals,discord:roles,authorityStore:createActorAuthorityStore({pool,clock}),
    policy:configuration.capabilityPolicy,clock,isAuthorityCurrent:enabled,readContinuity:stamp});
  const editor=createPermissionEditor({pool,authorize:authorization.authorize,configuration,options:createPermissionOptions({transport}),
    observeActor:roles.observeActor,clock,applyEnabled:true});
  const routes=createPermissionEditorHttp({auth,authorization,store:editor});
  const permissions={async execute(input){
    requireCondition(['/api/permissions/draft','/api/permissions/application','/api/permissions/retryApplication'].includes(input.path),'PERMISSION_APPLICATION_BUSY');
    return routes.execute(input);
  }};
  return createDashboardAuthHttpServer({configuration:configuration.dashboard,auth,authorization,permissions,
    presentation:await createDashboardPresentation(),enabled,onFault});
}
