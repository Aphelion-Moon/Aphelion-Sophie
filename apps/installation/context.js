import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { installationQualification } from './qualification.js';

export function installedRoleContext(pipes,role,signal) {
  requireCondition(pipes?.profile==='installed' && pipes.installation?.owner.role===role && pipes.signal instanceof AbortSignal && signal instanceof AbortSignal,
    'AI_INSTALLATION_INVALID');
  const revocationSignal=AbortSignal.any([pipes.signal,signal]),{configuration,owner}=pipes.installation;
  const qualified=installationQualification(pipes.installation,revocationSignal),keys=configuration.keys;
  requireKeys(keys,role==='supervisor'?['core','egress']:[role],'AI_INSTALLATION_INVALID');
  requireCondition(Object.values(keys).every(key=>/^[a-f0-9]{64}$/u.test(key) && key!=='0'.repeat(64)) &&
    new Set(Object.values(keys)).size===Object.keys(keys).length,'AI_INSTALLATION_INVALID');
  return {configuration,owner,revocationSignal,qualified,keys:Object.fromEntries(Object.entries(keys).map(([name,key])=>[name,Buffer.from(key,'hex')]))};
}
