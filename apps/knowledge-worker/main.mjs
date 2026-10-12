import { loadInstallationConfiguration, readInstallationFile } from '../installation/configuration.js';
import { installationQualification } from '../installation/qualification.js';
import { installedWorkerIdentity } from '../installation/context.js';
import { createInstalledWorker } from './installed.js';
import { requireCondition } from '../../contracts/validation.js';

// Fixed entrypoint for the dedicated restricted worker service account. No CLI-selected files, core credentials or
// shell tools; its own trust file and the provider key file are the only external input. The service runs alongside
// core and reconnects to it on its own; the service wrapper restarts it if it exits.
const lifetime=new AbortController();let worker,closing,startup,stopping=false,key;
const fault=code=>process.stderr.write(`AI_WORKER_FAULT${typeof code==='string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)?` ${code}`:''}\n`);
async function stop(code=0) {
  if(stopping)return closing;
  stopping=true;process.exitCode=code;lifetime.abort();
  const forced=setTimeout(()=>process.exit(1),3000);forced.unref();
  closing=(async()=>{await startup?.catch(()=>{});await worker?.stop();key?.fill(0);clearTimeout(forced);})();return closing;
}
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
async function start() {
  requireCondition(process.argv.length===2,'AI_WORKER_ARGUMENTS_INVALID');
  const installation=await loadInstallationConfiguration('worker'),{configuration}=installation;
  const qualified=installationQualification(installation,lifetime.signal);
  requireCondition(await qualified(),'AI_INSTALLATION_UNQUALIFIED');
  const apiKey=(await readInstallationFile(installation.paths.provider,512)).trim();
  requireCondition(/^[a-zA-Z0-9_-]{16,256}$/u.test(apiKey),'AI_INSTALLATION_INVALID');
  key=Buffer.from(configuration.keys.channel,'hex');
  worker=createInstalledWorker({identity:installedWorkerIdentity(configuration),key,apiKey,acceptedFingerprints:configuration.acceptedFingerprints,
    qualified,revocationSignal:lifetime.signal,onFault:code=>{fault(code);void stop(1);}});
  if(stopping)throw Error('AI_WORKER_UNAVAILABLE');
  await worker.start();if(stopping)throw Error('AI_WORKER_UNAVAILABLE');process.stdout.write('AI_WORKER_READY\n');
}
startup=start();
try {await startup;}catch(error) {
  const code=[error?.code,error?.message].find(value=>typeof value==='string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(value));
  process.stderr.write(`AI_WORKER_UNAVAILABLE${code?` ${code}`:''}\n`);await stop(1);
}
