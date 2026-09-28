import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { createAiDockerSlot } from '../../apps/ai-supervisor/docker.js';
import { aiContainerProfile } from '../../apps/ai-supervisor/container-profile.js';

export const hash=()=>randomBytes(32).toString('hex');
export function inputs() {
  const release={name:'Synthetic supervisor',workerId:hash(),releaseHash:hash(),profileHash:hash(),evidenceHash:hash(),provider:'deepseek',domain:'public'};
  return {registration:{installationId:hash(),imageId:'sha256:'+hash(),bootRoot:'C:\\synthetic-boots',providerDirectory:'C:\\synthetic-provider',release},
    identity:{workerId:release.workerId,bootId:hash(),releaseHash:release.releaseHash,profileHash:release.profileHash,provider:release.provider,domain:release.domain},operationId:randomUUID()};
}
export function deferred(){let resolve;return {promise:new Promise(done=>resolve=done),resolve};}
export function inspected(body,name,id) {
  const {HostConfig,...Config}=structuredClone(body);
  return {Id:id,Name:`/${name}`,Image:body.Image,Config,HostConfig,
    Mounts:HostConfig.Mounts.map(mount=>({Type:mount.Type,Source:mount.Source,Destination:mount.Target,RW:!mount.ReadOnly})),
    State:{Running:false,Paused:false,Restarting:false,Dead:false}};
}
export async function engineFixture(t,configuration=inputs()) {
  const fixed=configuration,calls=[],transports=[],sockets=new Set(),slots=new Set(),id=hash();let container=null,hook=null;
  const server=createServer(async(req,res)=>{
    try {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):undefined;
      calls.push({method:req.method,path:req.url,body});
      if(hook && await hook(req,res,body)===true)return;
      if(req.url==='/v1.54/version')return json(res,200,{Version:'29.8.0',Os:'windows',Arch:'amd64'});
      if(req.url===`/v1.54/images/${fixed.registration.imageId}/json`)return json(res,200,{Id:fixed.registration.imageId,Os:'windows',Architecture:'amd64',Config:aiContainerProfile(fixed.registration,fixed.identity,fixed.operationId)});
      if(req.method==='GET' && req.url.startsWith('/v1.54/containers/')){
        const target=req.url.slice('/v1.54/containers/'.length,-'/json'.length),found=container && (target===container.Id || target===container.Name.slice(1));
        return json(res,found?200:404,found?container:{message:'missing'});
      }
      if(req.url.startsWith('/v1.54/containers/create?name=')){
        if(container)return json(res,409,{message:'occupied'});
        container=inspected(body,new URL(req.url,'http://localhost').searchParams.get('name'),id);return json(res,201,{Id:id,Warnings:[]});
      }
      if(req.method==='POST' && req.url.endsWith('/start')){assert.ok(container);container.State.Running=true;return json(res,204);}
      if(req.method==='DELETE'){container=null;return json(res,204);}
      json(res,404,{message:'unregistered'});
    } catch {if(!res.destroyed)res.destroy();}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  function newSlot(){const slot=createAiDockerSlot({registration:fixed.registration,requestImpl:(options,callback)=>{
    transports.push(options);assert.equal(options.socketPath,'\\\\.\\pipe\\docker_engine');assert.equal(options.host,'localhost');
    assert.equal(options.agent.maxSockets,1);const {socketPath,host,...local}=options;
    return request({...local,host:'127.0.0.1',port:server.address().port},callback);
  }});slots.add(slot);return slot;}
  const slot=newSlot();
  t.after(async()=>{for(const item of slots)await item.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
  return {...fixed,id,slot,newSlot,calls,transports,get container(){return container;},set container(value){container=value;},set hook(value){hook=value;},
    create:signal=>slot.create({...fixed,signal:signal??new AbortController().signal}),
    start:signal=>slot.start({id,signal:signal??new AbortController().signal})};
}
export function json(res,status,value) {res.writeHead(status,{'content-type':'application/json'});res.end(value===undefined?undefined:JSON.stringify(value));}
