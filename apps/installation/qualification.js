import { requireCondition, requireKeys } from '../../contracts/validation.js';
import { canonicalAiWorkerRelease } from '../../modules/assistant/worker-release.js';
import { installationHash } from './configuration.js';

// Shorter than the Hyper-V/HCS era's twelve-item checklist: with the worker isolated by its own
// restricted OS account instead of a container, an operator now attests to three properties —
// the dedicated service account's identity, the NTFS ACL scope on its secrets/config, and the
// firewall egress scope limiting outbound ports to TCP 443 — instead of container/relay/HCS evidence.
// The application transport separately fixes the provider origin and rejects non-public IPv4 addresses.
export const installationChecks=Object.freeze(['service-account-identity','file-acl-scope','firewall-egress-scope']);

/** An owner-managed, source-bound operator receipt, bound to the release at install; never an automatic OS qualification. It does not expire. */
export function installationQualification({configuration,owner},signal) {
  const release=canonicalAiWorkerRelease(configuration.release),report=configuration.qualification;
  requireKeys(report,['installationId','releaseHash','profileHash','checks'],'AI_INSTALLATION_UNQUALIFIED');
  requireKeys(report.checks,installationChecks,'AI_INSTALLATION_UNQUALIFIED');
  requireCondition(owner.version==='2' && signal instanceof AbortSignal && report.installationId===owner.installation && report.releaseHash===release.releaseHash &&
    report.profileHash===release.profileHash &&
    installationChecks.every(name=>/^[a-f0-9]{64}$/u.test(report.checks[name]) && report.checks[name]!=='0'.repeat(64)) &&
    installationHash(JSON.stringify(report))===release.evidenceHash,'AI_INSTALLATION_UNQUALIFIED');
  return async (selected=release,{signal:requestSignal}={})=>!signal.aborted && !requestSignal?.aborted &&
    ['workerId','releaseHash','profileHash','provider','domain'].every(name=>selected[name]===release[name]);
}
