import { requireCondition } from '../../contracts/validation.js';
import { createAiServiceControl } from './service-control.js';
import { createAiWorkerSlot } from './slot.js';
import { createAiSupervisorWorkerSlot } from './worker-slot.js';
import { createAiSupervisorControlService } from './control.js';
import { installedRoleContext } from '../installation/context.js';

const base='C:\\Aphelion\\Sophie';

export async function createInstalledSupervisorService({pipes,signal,onFault,createService=createAiServiceControl}) {
  const {configuration,owner,qualified,revocationSignal,keys}=installedRoleContext(pipes,'supervisor',signal);
  let service,slot;
  try {
    requireCondition(await qualified(),'AI_INSTALLATION_UNQUALIFIED');
    const registration={installationId:owner.installation,serviceName:'SophieInference',
      bootRoot:`${base}\\state\\boots`,providerDirectory:`${base}\\provider`,trustDirectory:`${base}\\worker-trust`,release:configuration.release};
    service=createService({registration});
    const durable=createAiWorkerSlot({registration,service});
    slot=createAiSupervisorWorkerSlot({registration,slot:durable,acceptedFingerprints:configuration.acceptedFingerprints,qualified,revocationSignal,onFault});
    return createAiSupervisorControlService({installationId:registration.installationId,keys,
      qualified:(scope,context)=>scope.installationId===registration.installationId && scope.role==='core' && qualified(configuration.release,context),
      slot,revocationSignal,onFault,
      beforeStart:({identity,signal:requestSignal})=>qualified(identity,{signal:requestSignal}),createPipeServer:pipes.createServer});
  } catch(error) {
    if(slot)await slot.close().catch(()=>{});
    else await service?.close().catch(()=>{});
    throw error;
  } finally {Object.values(keys).forEach(key=>key.fill(0));}
}
