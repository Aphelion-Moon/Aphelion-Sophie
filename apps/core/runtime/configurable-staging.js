import { requireCondition } from '../../../contracts/validation.js';
import { createStagingRuntime } from './staging.js';
import { createConfigurationCoordinator } from './configuration-coordinator.js';
import { createConfigurationDashboard } from './configuration-dashboard.js';
import { createDiscordTransport } from '../discord/transport.js';
import { permissionDigest } from './permission-configuration.js';
import { checkRuntimeDatabaseIdentity } from './database.js';
import { validateStagingRuntime } from './configuration.js';

/** Core host composition. Owner credentials stay outside the normal runtime identity. */
export async function createConfigurableStagingRuntime({ownerPool,configuration,pool,token,clientSecret=null,fetch,connect,clock=Date.now,random=Math.random,onFault,
  runtimeFactory=createStagingRuntime}) {
  requireCondition(ownerPool&&ownerPool!==pool,'MAINTENANCE_OWNER_REQUIRED');
  validateStagingRuntime(configuration);
  requireCondition(typeof onFault==='function','TRUSTED_ADAPTERS_REQUIRED');
  let runtime=null,maintenanceDashboard=null,dashboardKey=null,timer=null,inFlight=null,started=false,stopping=false,options={};
  const transport=createDiscordTransport({guildId:configuration.mapping.guildId,token,fetch,clock,enabled:()=>started&&!stopping});
  const stopRuntime=async()=>{if(runtime){const old=runtime;runtime=null;await old.stop();}};
  const coordinator=createConfigurationCoordinator({pool:ownerPool,configuration,transport,stopRuntime,clock});
  async function closeDashboard(){if(maintenanceDashboard){await maintenanceDashboard.close();maintenanceDashboard=null;dashboardKey=null;}}
  async function startRuntime(){
    if(runtime||stopping)return;
    await closeDashboard();
    const current=await coordinator.configuration();
    runtime=await runtimeFactory({configuration:current,pool,token,clientSecret,fetch,connect,clock,random,onFault,configurationApplyEnabled:true});
    try { return await runtime.start(options); }
    catch(error) { await stopRuntime(); throw error; }
  }
  async function dashboard(request){
    if(!configuration.dashboard||runtime)return;
    const policy=(await ownerPool.query('SELECT version FROM sophie_core.capability_policies WHERE guild_id=$1 ORDER BY version DESC LIMIT 1',[configuration.mapping.guildId])).rows[0];
    const sections=policy?.version===request.candidate_configuration?.capabilityPolicy.version?request.candidate_configuration:request.base_configuration;
    if(!sections)return;
    const current={...configuration,...sections},key=permissionDigest(sections);
    if(dashboardKey===key)return;
    await closeDashboard();
    maintenanceDashboard=await createConfigurationDashboard({pool:ownerPool,configuration:current,request,transport,clientSecret,fetch,clock,
      enabled:()=>started&&!stopping,onFault});
    await maintenanceDashboard.listen(options.ephemeralPorts?0:current.dashboardPort);dashboardKey=key;
  }
  async function tick(){
    if(stopping||!started)return {state:'stopped'};
    const pending=await coordinator.pending();
    if(!pending){await startRuntime();return {state:'idle'};}
    const result=await coordinator.runOnce();
    const next=await coordinator.pending();
    if(!next)await startRuntime();else await dashboard(next);
    return result;
  }
  function runOnce(){if(inFlight)return inFlight;inFlight=tick().finally(()=>{inFlight=null;});return inFlight;}
  function schedule(){if(stopping)return;timer=setTimeout(()=>{void runOnce().catch(()=>onFault('CONFIGURATION_COORDINATOR_UNAVAILABLE')).finally(schedule);},Math.max(500,configuration.workerIntervalMs));}
  return Object.freeze({
    async start(startOptions={}) {
      requireCondition(!started&&!stopping,'RUNTIME_ALREADY_STARTED');
      await checkRuntimeDatabaseIdentity(pool);started=true;options=startOptions;
      const pending=await coordinator.pending();let addresses;
      if(pending){await runOnce();addresses={interactions:null,dashboard:null};}else addresses=await startRuntime();
      if(startOptions.automaticWorkers!==false)schedule();return addresses;
    },
    runOnce,
    runRuntimeOnce:()=>runtime?.runOnce(),
    async status(){
      if(runtime)return runtime.status();
      const pending=await coordinator.pending();return {environment:'staging',productionReady:false,started,stopping,current:false,
        gateway:{phase:pending?.state==='blocked'?'configuration-blocked':'configuration'},configurationApplication:pending?{state:pending.state,phase:pending.phase}:null};
    },
    async stop(){
      stopping=true;clearTimeout(timer);
      const pending=await Promise.allSettled([inFlight]);
      const closing=await Promise.allSettled([closeDashboard(),stopRuntime()]);
      requireCondition([...pending,...closing].every(result=>result.status==='fulfilled'),'RUNTIME_SHUTDOWN_INCOMPLETE');
    },
  });
}
