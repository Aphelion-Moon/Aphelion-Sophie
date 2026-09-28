using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Sophie.WindowsPipe
{
    // Private, descriptor-authenticated supervisor control. No application keys,
    // paths, process commands or destinations are accepted on this interface.
    internal sealed class RelayControlClient
    {
        private readonly NativePipe pipe;
        private readonly PipeFrames frames;
        private readonly CancellationToken parent;
        private readonly byte[] binding;
        private bool prepared,started,stopped;
        private byte[] scope;
        private int busy;
        internal RelayControlClient(EndpointSpec endpoint,byte[] binding,CancellationToken parent)
        {
            if(!endpoint.CanConnect)throw new IOException("PIPE_ROLE_DENIED");
            if(binding.Length!=160)throw new IOException("PIPE_RELAY_GRANT_INVALID");
            this.binding=(byte[])binding.Clone();this.parent=parent;pipe=NativePipe.Connect(endpoint.Name,endpoint.OwnerSid,endpoint.PeerSid);
            frames=new PipeFrames(pipe,pipe,PipeFrames.RelayControlSignature);
        }
        internal async Task Execute(byte command,byte[] grant)
        {
            if(Interlocked.Exchange(ref busy,1)!=0)throw new IOException("PIPE_RELAY_BUSY");
            try
            {
                if(stopped || command==1 && prepared || command==2 && (!prepared || started) ||
                    command==3 && !started || command==9 && !prepared)throw new IOException("PIPE_RELAY_STATE_INVALID");
                using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(parent))
                {
                    timeout.CancelAfter(2000);
                    if(command==1)
                    {
                        if(grant.Length!=48)throw new IOException("PIPE_RELAY_GRANT_INVALID");scope=new byte[208];
                        Buffer.BlockCopy(binding,0,scope,0,160);Buffer.BlockCopy(grant,0,scope,160,48);
                    }
                    await frames.Send(command,0,scope,timeout.Token).ConfigureAwait(false);
                    var reply=await frames.Receive(timeout.Token,(code,id,length)=>{
                        if(code!=command || id!=0 || length!=0)throw new IOException("PIPE_RELAY_REPLY_INVALID");
                        return Task.FromResult(true);
                    }).ConfigureAwait(false);
                    if(reply==null)throw new IOException("PIPE_RELAY_LOST");
                    if(command==1)prepared=true;
                    if(command==2)started=true;
                    if(command==9)
                    {
                        await frames.Send(4,0,new byte[0],timeout.Token).ConfigureAwait(false);
                        var end=await frames.Receive(timeout.Token,(code,id,length)=>{throw new IOException("PIPE_RELAY_REPLY_INVALID");}).ConfigureAwait(false);
                        if(end!=null)throw new IOException("PIPE_RELAY_REPLY_INVALID");
                        await pipe.CloseAsync().ConfigureAwait(false);stopped=true;
                    }
                }
            }
            finally{Interlocked.Exchange(ref busy,0);}
        }
        internal Task Close(){return pipe.CloseAsync();}
    }

    internal sealed class RelayControlServer
    {
        private readonly PipeProfile profile;
        private readonly PipeFrames local;
        private readonly CancellationToken parent;
        private readonly Dictionary<string,bool> consumed=new Dictionary<string,bool>();
        internal RelayControlServer(PipeProfile profile,PipeFrames local,CancellationToken parent)
        {this.profile=profile;this.local=local;this.parent=parent;}
        internal async Task Run()
        {
            await local.Send(128,0,new byte[]{1,0},parent).ConfigureAwait(false);
            var arm=await local.Receive(parent,(code,id,length)=>{
                if((code!=11 && code!=9) || id!=0 || length!=0)throw new IOException("PIPE_RELAY_COMMAND_DENIED");
                return Task.FromResult(true);
            }).ConfigureAwait(false);
            if(arm==null)throw new IOException("PIPE_PARENT_LOST");
            if(arm.Code==9){await local.Send(138,0,new byte[0],parent).ConfigureAwait(false);return;}
            var endpoint=profile.RelayControl(profile.Role=="inference-relay"?1u:2u);
            using(var lifetime=CancellationTokenSource.CreateLinkedTokenSource(parent))
            using(var listener=NativePipe.Listen(endpoint.Name,endpoint.OwnerSid,endpoint.PeerSid,1,true))
            {
                await local.Send(139,0,new byte[0],lifetime.Token).ConfigureAwait(false);
                var serve=Serve(listener,lifetime.Token);
                var stop=local.Receive(lifetime.Token,(code,id,length)=>{
                    if(code!=9 || id!=0 || length!=0)throw new IOException("PIPE_RELAY_COMMAND_DENIED");return Task.FromResult(true);
                });
                Exception failure=null;
                try
                {
                    if(await Task.WhenAny(stop,serve).ConfigureAwait(false)==serve)await serve.ConfigureAwait(false);
                    else if(await stop.ConfigureAwait(false)==null)throw new IOException("PIPE_PARENT_LOST");
                }
                catch(Exception error){failure=error;}
                lifetime.Cancel();await listener.CloseAsync().ConfigureAwait(false);
                try{await Task.WhenAll(stop,serve).ConfigureAwait(false);}catch{}
                if(failure!=null)throw failure;
                using(var timeout=new CancellationTokenSource(2000))await local.Send(138,0,new byte[0],timeout.Token).ConfigureAwait(false);
            }
        }
        private async Task Serve(NativePipe listener,CancellationToken signal)
        {
            for(;;)
            {
                await listener.AcceptAsync(signal).ConfigureAwait(false);
                await Boot(listener,signal).ConfigureAwait(false);
                listener.DisconnectDrained();
            }
        }
        private async Task<PipeFrame> Command(PipeFrames frames,CancellationToken signal,int milliseconds)
        {
            using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(signal))
            {
                timeout.CancelAfter(milliseconds);
                var frame=await frames.Receive(timeout.Token,(code,id,length)=>{
                    if(id!=0 || (code==4?length!=0:(code!=1 && code!=2 && code!=3 && code!=9) || length!=208))
                        throw new IOException("PIPE_RELAY_COMMAND_DENIED");
                    return Task.FromResult(true);
                }).ConfigureAwait(false);
                if(frame==null)throw new IOException("PIPE_RELAY_CONTROLLER_LOST");return frame;
            }
        }
        private static async Task Reply(PipeFrames frames,byte code,CancellationToken signal)
        {
            using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(signal))
            {timeout.CancelAfter(2000);await frames.Send(code,0,new byte[0],timeout.Token).ConfigureAwait(false);}
        }
        private async Task Boot(NativePipe control,CancellationToken parentSignal)
        {
            using(var lifetime=CancellationTokenSource.CreateLinkedTokenSource(parentSignal))
            {
                var frames=new PipeFrames(control,control,PipeFrames.RelayControlSignature);
                NativePipe front=null;Task forwarding=null;Task<PipeFrame> incoming=null;Exception failure=null;
                try
                {
                    var grant=await Command(frames,lifetime.Token,5000).ConfigureAwait(false);
                    if(grant.Code!=1)throw new IOException("PIPE_RELAY_GRANT_REQUIRED");
                    var binding=profile.RelayBinding();
                    for(int index=0;index<binding.Length;index++)if(grant.Data[index]!=binding[index])throw new IOException("PIPE_RELAY_SCOPE_CHANGED");
                    string boot=BitConverter.ToString(grant.Data,160,32).Replace("-","").ToLowerInvariant();
                    string operation=BitConverter.ToString(grant.Data,192,16).Replace("-","").ToLowerInvariant();
                    if(boot==new string('0',64) || operation==new string('0',32) || consumed.Count>=4096 || consumed.ContainsKey(boot))
                        throw new IOException("PIPE_RELAY_GRANT_REUSED");
                    consumed.Add(boot,true);
                    var endpoints=profile.RelayEndpoints(boot);
                    await Reply(frames,1,lifetime.Token).ConfigureAwait(false);
                    for(;;)
                    {
                        incoming=Command(frames,lifetime.Token,forwarding==null?5000:3000);
                        if(forwarding!=null && await Task.WhenAny(incoming,forwarding).ConfigureAwait(false)==forwarding)
                        {await forwarding.ConfigureAwait(false);throw new IOException("PIPE_RELAY_LOST");}
                        var command=await incoming.ConfigureAwait(false);
                        if(command.Data.Length!=grant.Data.Length)throw new IOException("PIPE_RELAY_GRANT_CHANGED");
                        for(int index=0;index<grant.Data.Length;index++)if(command.Data[index]!=grant.Data[index])throw new IOException("PIPE_RELAY_GRANT_CHANGED");
                        if(command.Code==2 && forwarding==null)
                        {
                            front=NativePipe.Listen(endpoints[0].Name,endpoints[0].OwnerSid,endpoints[0].PeerSid,1,true);
                            NativePipe.VerifyEndpoint(endpoints[1].Name,endpoints[1].OwnerSid,endpoints[1].PeerSid);
                            forwarding=RelayCompanion.Serve(front,endpoints[1],lifetime.Token);
                        }
                        else if(command.Code==9)
                        {
                            lifetime.Cancel();if(front!=null)await front.CloseAsync().ConfigureAwait(false);
                            if(forwarding!=null)try{await forwarding.ConfigureAwait(false);}catch{}
                            using(var finish=CancellationTokenSource.CreateLinkedTokenSource(parentSignal))
                            {
                                finish.CancelAfter(2000);await frames.Send(9,0,new byte[0],finish.Token).ConfigureAwait(false);
                                if((await Command(frames,finish.Token,2000).ConfigureAwait(false)).Code!=4)throw new IOException("PIPE_RELAY_CONFIRMATION_REQUIRED");
                            }
                            return;
                        }
                        else if(command.Code!=3 || forwarding==null)throw new IOException("PIPE_RELAY_STATE_INVALID");
                        await Reply(frames,command.Code,lifetime.Token).ConfigureAwait(false);
                    }
                }
                catch(Exception error){failure=error;}
                lifetime.Cancel();if(front!=null)await front.CloseAsync().ConfigureAwait(false);
                if(incoming!=null)try{await incoming.ConfigureAwait(false);}catch{}
                if(forwarding!=null)try{await forwarding.ConfigureAwait(false);}catch{}
                if(failure!=null)throw failure;
            }
        }
    }
}
