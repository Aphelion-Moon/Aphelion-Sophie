import { requireCondition } from '../../contracts/validation.js';
import { createAiDockerSlot } from './docker.js';
import { openAiSupervisorJournal } from './journal.js';
import { createAiSupervisorSlot } from './slot.js';
import { createAiSupervisorWorkerSlot } from './worker-slot.js';
import { createAiSupervisorControlService } from './control.js';
import { installedRoleContext } from '../installation/context.js';

const base='C:\\ProgramData\\Aphelion\\Sophie';
export async function createInstalledSupervisorService({pipes,signal,onFault,openJournal=openAiSupervisorJournal,createDocker=createAiDockerSlot}) {
  const {configuration,qualified,revocationSignal,keys}=installedRoleContext(pipes,'supervisor',signal);
  let journal,docker,slot;
  try {
    const registration=configuration.registration;
    requireCondition(registration?.installationId===configuration.installationId && registration.imageId===configuration.qualification.imageId &&
      Object.entries(configuration.release).every(([key,value])=>registration.release?.[key]===value) && registration.bootRoot===`${base}\\state\\boots` &&
      registration.providerDirectory===`${base}\\provider` && registration.trustDirectory===`${base}\\worker-trust`,'AI_INSTALLATION_INVALID');
    requireCondition(await qualified(),'AI_INSTALLATION_UNQUALIFIED');
    journal=await openJournal({registration,directory:`${base}\\state\\supervisor`});
    docker=createDocker({registration});
    const durable=createAiSupervisorSlot({registration,journal,docker});
    slot=createAiSupervisorWorkerSlot({registration,slot:durable,acceptedFingerprints:configuration.acceptedFingerprints,qualified,revocationSignal,onFault});
    return createAiSupervisorControlService({installationId:configuration.installationId,keys,
      qualified:(scope,context)=>scope.installationId===configuration.installationId && ['core','egress'].includes(scope.role) && qualified(configuration.release,context),slot,revocationSignal,onFault,
      beforeStart:({identity,signal:requestSignal})=>qualified(identity,{signal:requestSignal}),createPipeServer:pipes.createServer});
  } catch(error) {
    if(slot)await slot.close().catch(()=>{});
    else {await docker?.close().catch(()=>{});await journal?.close().catch(()=>{});}
    throw error;
  } finally {Object.values(keys).forEach(key=>key.fill(0));}
}
