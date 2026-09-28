import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../modules/assistant/worker-release.js';
import { installationHash } from '../windows-pipe/installation.js';

export const installationChecks=Object.freeze(['service-identities','file-custody','pipe-access','hcs-proxy','worker-framework',
  'container-mounts','network-isolation','physical-termination','uncertain-create-disposition']);

/** An owner-managed, source-bound operator receipt; never an automatic OS qualification. */
export function installationQualification({configuration,owner},signal,clock=Date.now) {
  const release=canonicalAiWorkerRelease(configuration.release),report=configuration.qualification;
  requireKeys(report,['installationId','releaseHash','profileHash','imageId','expiresAt','checks'],'AI_INSTALLATION_UNQUALIFIED');
  requireKeys(report.checks,installationChecks,'AI_INSTALLATION_UNQUALIFIED');
  requireCondition(signal instanceof AbortSignal && report.installationId===owner.installation && report.releaseHash===release.releaseHash &&
    report.profileHash===release.profileHash && /^sha256:[a-f0-9]{64}$/u.test(report.imageId) &&
    Number.isSafeInteger(report.expiresAt) && report.expiresAt===Number(owner.expires) &&
    installationChecks.every(name=>/^[a-f0-9]{64}$/u.test(report.checks[name]) && report.checks[name]!=='0'.repeat(64)) &&
    installationHash(JSON.stringify(report))===release.evidenceHash,'AI_INSTALLATION_UNQUALIFIED');
  return async (selected=release,{signal:requestSignal}={})=>!signal.aborted && !requestSignal?.aborted && clock()<report.expiresAt &&
    ['workerId','releaseHash','profileHash','provider','domain'].every(name=>selected[name]===release[name]);
}
