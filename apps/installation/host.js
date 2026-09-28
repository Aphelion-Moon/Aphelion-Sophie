import { createInstalledWindowsPipeTransport } from '../windows-pipe/transport.js';
import { requireCondition } from '../../contracts/validation.js';

/** Foreground service payload. SCM registration/wrapper selection is a separate operational decision. */
export async function runInstalledRole(role,compose) {
  const lifetime=new AbortController(),abort=()=>lifetime.abort();let pipes,service,failed=false,timer,polling;
  const fatal=()=>{failed=true;abort();};
  const onFault=()=>process.stderr.write('AI_INSTALLED_ROLE_FAULT\n');
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try {
    requireCondition(process.argv.length===2 || role==='core' && process.argv.length===3 && process.argv[2]==='start-installed','AI_INSTALLATION_ARGUMENTS_INVALID');
    pipes=await createInstalledWindowsPipeTransport({role});
    pipes.signal.addEventListener('abort',fatal,{once:true});
    requireCondition(!pipes.signal.aborted && !lifetime.signal.aborted,'AI_INSTALLATION_UNAVAILABLE');
    service=await compose({pipes,signal:lifetime.signal,onFault});
    await service.start();
    const poll=async()=>{try{const status=await service.status();
      if(status.failed || status.stopping || status.phase==='stopped')fatal();
    }catch{fatal();}finally{if(!lifetime.signal.aborted)timer=setTimeout(()=>{polling=poll();},1000);}};
    if(!lifetime.signal.aborted)polling=poll();
    if(!lifetime.signal.aborted)await new Promise(resolve=>lifetime.signal.addEventListener('abort',resolve,{once:true}));
    requireCondition(!failed,'AI_INSTALLATION_UNAVAILABLE');
  } catch {process.stderr.write('AI_INSTALLED_ROLE_UNAVAILABLE\n');process.exitCode=1;}
  finally {
    abort();clearTimeout(timer);await polling;
    const results=await Promise.allSettled([Promise.resolve().then(()=>service?.stop())]);
    const closed=await Promise.allSettled([Promise.resolve().then(()=>pipes?.stop())]);
    if([...results,...closed].some(result=>result.status==='rejected'))process.exitCode=1;
    process.off('SIGINT',abort);process.off('SIGTERM',abort);
  }
}
