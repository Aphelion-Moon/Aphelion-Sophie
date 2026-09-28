import { connect } from 'node:net';
import { connect as connectTls, rootCertificates, checkServerIdentity } from 'node:tls';
import { requireCondition } from '../../contracts/validation.js';
import { canonicalAiWorkerIdentity } from './ipc-contract.js';
import { aiEgressPipe, authenticateAiEgress } from './egress-channel.js';

/** Provider TLS is established in the worker over the authenticated fixed-destination pipe. No direct fallback. */
export function createDeepSeekPipeConnector({identity,key,revocationSignal,connectPipe=connect,tlsConnect=connectTls}) {
  const fixed=canonicalAiWorkerIdentity(identity), path=aiEgressPipe(fixed);
  requireCondition(Buffer.isBuffer(key) && key.length===32 && revocationSignal instanceof AbortSignal &&
    typeof connectPipe==='function' && typeof tlsConnect==='function','AI_EGRESS_CONFIGURATION_INVALID');
  const secret=Buffer.from(key), lifetime=new AbortController(), sockets=new Set(), tasks=new Set();let closing;
  const track=socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));return socket;};
  function stop() {
    if(closing)return closing;
    lifetime.abort();secret.fill(0);revocationSignal.removeEventListener('abort',revoke);
    const closed=[...sockets].filter(socket=>!socket.closed).map(socket=>new Promise(resolve=>socket.once('close',resolve)));
    for(const socket of sockets)socket.destroy();
    closing=Promise.all([...closed,...tasks]).then(()=>{});return closing;
  }
  const revoke=()=>{void stop();};revocationSignal.addEventListener('abort',revoke,{once:true});if(revocationSignal.aborted)revoke();
  return Object.freeze({
    open(signal) {
      requireCondition(signal instanceof AbortSignal && !signal.aborted && !lifetime.signal.aborted && !revocationSignal.aborted &&
        sockets.size===0 && tasks.size===0,'AI_EGRESS_UNAVAILABLE');
      const timeout=new AbortController(), combined=AbortSignal.any([signal,lifetime.signal,revocationSignal,timeout.signal]);
      const timer=setTimeout(()=>timeout.abort(),5000);let pipe,tls;
      const destroy=()=>{pipe?.destroy();tls?.destroy();};
      combined.addEventListener('abort',destroy,{once:true});
      const task=(async()=>{
        try {
          pipe=track(connectPipe(path));
          await authenticateAiEgress({stream:pipe,identity:fixed,key:secret,side:'worker',signal:combined});
          requireCondition(!combined.aborted,'AI_EGRESS_UNAVAILABLE');
          // Use bundled CA roots explicitly; neither bridge configuration nor inherited extra/system roots can replace them.
          tls=track(tlsConnect({socket:pipe,host:'api.deepseek.com',servername:'api.deepseek.com',port:443,
            rejectUnauthorized:true,checkServerIdentity,ca:rootCertificates,minVersion:'TLSv1.2',ALPNProtocols:['http/1.1']}));
          await new Promise((resolve,reject)=>{
            const fail=()=>{tls.off('secureConnect',ready);reject(Error('AI_EGRESS_UNAVAILABLE'));};
            const ready=()=>{tls.off('close',fail);resolve();};
            tls.once('secureConnect',ready);tls.once('close',fail);
            if(combined.aborted)destroy();
          });
          requireCondition(tls.authorized===true && !combined.aborted,'AI_EGRESS_UNAVAILABLE');return tls;
        } catch {destroy();throw Error('AI_EGRESS_UNAVAILABLE');}
        finally {clearTimeout(timer);combined.removeEventListener('abort',destroy);}
      })();
      // Retain a handled completion separately so stop observes failures without rejecting teardown.
      const settled=task.then(()=>{},()=>{}).finally(()=>tasks.delete(settled));tasks.add(settled);
      return task;
    },
    stop,
  });
}
