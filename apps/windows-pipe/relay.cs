using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Sophie.WindowsPipe
{
    // The relay recognizes only the native transport envelope. Application
    // ciphertext, boot authentication and provider TLS remain opaque bytes.
    internal sealed class RelaySession
    {
        private readonly NativePipe front,back;
        private readonly object gate=new object();
        private readonly bool[] ended=new bool[2],acknowledged=new bool[2];
        private bool confirmed;
        internal RelaySession(NativePipe front,NativePipe back){this.front=front;this.back=back;}
        private async Task Pump(int direction,PipeFrames input,PipeFrames output,CancellationToken signal)
        {
            long bytes=0;int frames=0;
            for(;;)
            {
                var frame=await input.Receive(signal,(code,id,length)=>{
                    if(id!=0 || code<1 || code>4 || (code==1?length==0:length!=0) || ++frames>65536)
                        throw new IOException("PIPE_RELAY_FRAME_INVALID");
                    bytes+=length;if(bytes>4194304)throw new IOException("PIPE_RELAY_LIMIT");
                    lock(gate)
                    {
                        if(confirmed || code==1 && ended[direction] || code==2 && ended[direction] ||
                            code==3 && (!ended[1-direction] || acknowledged[direction]) ||
                            code==4 && (direction!=0 || !ended[0] || !ended[1] || !acknowledged[0] || !acknowledged[1]))
                            throw new IOException("PIPE_RELAY_STATE_INVALID");
                        if(code==2)ended[direction]=true;
                        if(code==3)acknowledged[direction]=true;
                        if(code==4)confirmed=true;
                    }
                    return Task.FromResult(true);
                }).ConfigureAwait(false);
                if(frame==null)
                {
                    lock(gate)if(direction!=1 || !confirmed)throw new IOException("PIPE_RELAY_PEER_LOST");
                    return;
                }
                await output.Send(frame.Code,frame.Id,frame.Data,signal).ConfigureAwait(false);
                if(frame.Code==4)return;
            }
        }
        internal async Task Run(CancellationToken parent)
        {
            using(var lifetime=CancellationTokenSource.CreateLinkedTokenSource(parent))
            {
                lifetime.CancelAfter(60000);
                var publicFrames=new PipeFrames(front,front,PipeFrames.PeerSignature);
                var privateFrames=new PipeFrames(back,back,PipeFrames.PeerSignature);
                var outward=Pump(0,publicFrames,privateFrames,lifetime.Token);
                var inward=Pump(1,privateFrames,publicFrames,lifetime.Token);
                Exception failure=null;
                try
                {
                    var first=await Task.WhenAny(outward,inward).ConfigureAwait(false);
                    await first.ConfigureAwait(false);
                    await Task.WhenAll(outward,inward).ConfigureAwait(false);
                }
                catch(Exception error){failure=error;}
                {
                    lifetime.Cancel();
                    try{await Task.WhenAll(outward,inward).ConfigureAwait(false);}catch{}
                    await Task.WhenAll(front.CloseAsync(),back.CloseAsync()).ConfigureAwait(false);
                }
                if(failure!=null)throw failure;
            }
        }
    }

    internal sealed class RelayCompanion
    {
        private readonly PipeProfile profile;
        private readonly PipeFrames local;
        private readonly CancellationToken parent;
        internal RelayCompanion(PipeProfile profile,PipeFrames local,CancellationToken parent)
        {this.profile=profile;this.local=local;this.parent=parent;}
        private async Task StopCommand(CancellationToken signal)
        {
            var frame=await local.Receive(signal,(code,id,length)=>{
                if(code!=9 || id!=0 || length!=0)throw new IOException("PIPE_RELAY_COMMAND_DENIED");
                return Task.FromResult(true);
            }).ConfigureAwait(false);
            if(frame==null)throw new IOException("PIPE_PARENT_LOST");
        }
        internal async Task Run()
        {
            await local.Send(128,0,new byte[]{1,0},parent).ConfigureAwait(false);
            var arm=await local.Receive(parent,(code,id,length)=>{
                if((code!=11 && code!=9) || id!=0 || length!=0)throw new IOException("PIPE_RELAY_COMMAND_DENIED");
                return Task.FromResult(true);
            }).ConfigureAwait(false);
            if(arm==null)throw new IOException("PIPE_PARENT_LOST");
            if(arm.Code==9){await local.Send(138,0,new byte[0],parent).ConfigureAwait(false);return;}
            var endpoints=profile.RelayEndpoints();var front=endpoints[0];var back=endpoints[1];
            using(var lifetime=CancellationTokenSource.CreateLinkedTokenSource(parent))
            using(var listener=NativePipe.Listen(front.Name,front.OwnerSid,front.PeerSid,1,true))
            {
                NativePipe.VerifyEndpoint(back.Name,back.OwnerSid,back.PeerSid);
                await local.Send(139,0,new byte[0],lifetime.Token).ConfigureAwait(false);
                var stop=StopCommand(lifetime.Token);var session=Serve(listener,back,lifetime.Token);
                bool requested=false;Exception failure=null;
                try
                {
                    var first=await Task.WhenAny(stop,session).ConfigureAwait(false);
                    if(first==stop){await stop.ConfigureAwait(false);requested=true;}
                    else await session.ConfigureAwait(false);
                }
                catch(Exception error){failure=error;}
                {
                    lifetime.Cancel();await listener.CloseAsync().ConfigureAwait(false);
                    try{await Task.WhenAll(stop,session).ConfigureAwait(false);}catch{}
                }
                if(failure!=null)throw failure;
                if(requested)using(var timeout=new CancellationTokenSource(2000))
                    await local.Send(138,0,new byte[0],timeout.Token).ConfigureAwait(false);
                else using(var timeout=new CancellationTokenSource(2000))
                    await local.Send(140,0,new byte[0],timeout.Token).ConfigureAwait(false);
                // One session per helper. A subsequent session needs a new grant;
                // no private reconnect or replay follows a broken connection.
            }
        }
        private static async Task Serve(NativePipe front,EndpointSpec back,CancellationToken signal)
        {
            await front.AcceptAsync(signal).ConfigureAwait(false);
            using(var target=NativePipe.Connect(back.Name,back.OwnerSid,back.PeerSid))
                await new RelaySession(front,target).Run(signal).ConfigureAwait(false);
        }
    }
}
