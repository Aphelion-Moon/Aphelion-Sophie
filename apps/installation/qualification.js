import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../modules/assistant/worker-release.js';
import { installationHash } from '../inference-host/installation.js';

// Shorter than the Hyper-V/HCS era's twelve-item checklist: with the worker isolated by its own
// restricted OS account instead of a container, an operator now attests to three properties —
// the dedicated service account's identity, the NTFS ACL scope on its secrets/config, and the
// firewall egress scope limiting it to the provider host — instead of container/relay/HCS evidence.
export const installationChecks=Object.freeze(['service-account-identity','file-acl-scope','firewall-egress-scope']);

/** An owner-managed, source-bound operator receipt; never an automatic OS qualification. */
export function installationQualification({configuration,owner},signal,clock=Date.now) {
  const release=canonicalAiWorkerRelease(configuration.release),report=configuration.qualification;
  requireKeys(report,['installationId','releaseHash','profileHash','expiresAt','checks'],'AI_INSTALLATION_UNQUALIFIED');
  requireKeys(report.checks,installationChecks,'AI_INSTALLATION_UNQUALIFIED');
  requireCondition(owner.version==='1' && signal instanceof AbortSignal && report.installationId===owner.installation && report.releaseHash===release.releaseHash &&
    report.profileHash===release.profileHash &&
    Number.isSafeInteger(report.expiresAt) && report.expiresAt===Number(owner.expires) &&
    installationChecks.every(name=>/^[a-f0-9]{64}$/u.test(report.checks[name]) && report.checks[name]!=='0'.repeat(64)) &&
    installationHash(JSON.stringify(report))===release.evidenceHash,'AI_INSTALLATION_UNQUALIFIED');
  return async (selected=release,{signal:requestSignal}={})=>!signal.aborted && !requestSignal?.aborted && clock()<report.expiresAt &&
    ['workerId','releaseHash','profileHash','provider','domain'].every(name=>selected[name]===release[name]);
}
