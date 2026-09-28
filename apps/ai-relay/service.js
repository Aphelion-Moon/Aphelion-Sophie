import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { installationQualification } from '../installation/qualification.js';

/** One fixed boot/purpose grant. This context deliberately has no application keys. */
export function createInstalledRelayService({pipes,signal}) {
  const {owner,configuration}=pipes?.installation??{};
  requireCondition(pipes?.profile==='installed' && ['inference-relay','egress-relay'].includes(owner?.role) &&
    pipes.signal instanceof AbortSignal && signal instanceof AbortSignal && typeof pipes.startRelay==='function','AI_RELAY_CONFIGURATION_INVALID');
  requireKeys(configuration,['installationId','release','qualification'],'AI_RELAY_CONFIGURATION_INVALID');
  const revoked=AbortSignal.any([signal,pipes.signal]);
  const qualified=installationQualification(pipes.installation,revoked);
  let phase='idle',closing;
  return Object.freeze({
    async start(){
      requireCondition(phase==='idle' && await qualified(),'AI_RELAY_UNQUALIFIED');phase='starting';
      try{await pipes.startRelay();requireCondition(await qualified(),'AI_RELAY_UNQUALIFIED');phase='listening';}
      catch(error){phase='failed';await pipes.stop().catch(()=>{});throw error;}
    },
    status:()=>({phase:revoked.aborted?'stopped':phase,failed:phase==='failed'}),
    stop(){if(!closing){phase='stopped';closing=pipes.stop();}return closing;},
  });
}
