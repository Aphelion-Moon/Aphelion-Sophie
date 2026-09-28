using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Sophie.WindowsPipe
{
    // Both native peers use this envelope. FIN acknowledgements order final bytes
    // ahead of closure without an unbounded synchronous FlushFileBuffers call.
    internal sealed class PeerStream
    {
        private readonly NativePipe pipe;
        private readonly PipeFrames frames;
        private readonly Func<byte,byte[],Task> publish;
        private readonly CancellationTokenSource lifetime;
        private readonly SemaphoreSlim credited=new SemaphoreSlim(0,1);
        private readonly object gate=new object();
        private readonly TaskCompletionSource<bool> done=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        private int credit;
        private bool writing,localEnd,remoteEnd,localAcknowledged,remoteAcknowledged,stopped,started,closeSent;
        private readonly List<Task> writes=new List<Task>();
        private long sent,received;
        internal PeerStream(NativePipe pipe,CancellationToken parent,Func<byte,byte[],Task> publish)
        {
            this.pipe=pipe;this.frames=new PipeFrames(pipe,pipe,PipeFrames.PeerSignature);this.publish=publish;
            lifetime=CancellationTokenSource.CreateLinkedTokenSource(parent);lifetime.CancelAfter(60000);
        }
        internal void Start(Task announced)
        {
            lock(gate){if(started || stopped)throw new IOException("PIPE_STREAM_STATE");started=true;}
            Observe(Run(announced));
        }
        private static async void Observe(Task task) { try { await task.ConfigureAwait(false); } catch { } }
        private bool Drained { get { return localEnd && remoteEnd && localAcknowledged && remoteAcknowledged; } }
        internal void Credit(uint amount)
        {
            lock(gate)
            {
                if(amount==0 || amount>65536)throw new IOException("PIPE_CREDIT_INVALID");
                // Credits already in the other direction can cross physical close.
                // The companion retains this stream until the parent's close receipt.
                if(stopped)return;
                if(credit>65536-amount)throw new IOException("PIPE_CREDIT_INVALID");
                credit+=(int)amount;if(credited.CurrentCount==0)credited.Release();
            }
        }
        private async Task BeforePayload(byte code,uint id,int length)
        {
            if(id!=0 || code<1 || code>4 || code==1 && length==0 || code!=1 && length!=0)throw new IOException("PIPE_PEER_FRAME_INVALID");
            lock(gate)
            {
                if(code==1 && remoteEnd || code==2 && remoteEnd || code==3 && (!localEnd || localAcknowledged))throw new IOException("PIPE_PEER_STATE_INVALID");
                if(code==4 && (!pipe.IsServer || !Drained))throw new IOException("PIPE_PEER_STATE_INVALID");
                if(code==1){received+=length;if(received>4194304)throw new IOException("PIPE_STREAM_LIMIT");}
            }
            if(code!=1)return;
            for(;;)
            {
                lock(gate){if(credit>=length){credit-=length;return;}}
                await credited.WaitAsync(lifetime.Token).ConfigureAwait(false);
            }
        }
        private async Task Run(Task announced)
        {
            bool orderly=false;
            try
            {
                await announced.ConfigureAwait(false);
                while(!lifetime.IsCancellationRequested)
                {
                    var frame=await frames.Receive(lifetime.Token,BeforePayload).ConfigureAwait(false);
                    if(frame==null)
                    {
                        lock(gate)orderly=!pipe.IsServer && closeSent && Drained;
                        if(orderly)break;throw new IOException("PIPE_PEER_LOST");
                    }
                    if(frame.Code==1)await publish(133,frame.Data).ConfigureAwait(false);
                    else if(frame.Code==2)
                    {
                        lock(gate)remoteEnd=true;
                        // Local transport serialization keeps EOF behind every preceding data frame.
                        await publish(134,new byte[0]).ConfigureAwait(false);
                        await frames.Send(3,0,new byte[0],lifetime.Token).ConfigureAwait(false);
                        lock(gate)remoteAcknowledged=true;
                    }
                    else if(frame.Code==3) { lock(gate)localAcknowledged=true; }
                    else { orderly=true;break; }
                    bool confirm;lock(gate)confirm=Drained && !pipe.IsServer && !closeSent;
                    if(confirm)
                    {
                        // The listener reads this final confirmation before closing.
                        // The client waits for EOF, so neither side discards an ACK
                        // that the other side still needs in order to finish.
                        await frames.Send(4,0,new byte[0],lifetime.Token).ConfigureAwait(false);closeSent=true;
                    }
                }
            }
            catch { orderly=false; }
            Task pending;
            lock(gate){stopped=true;pending=Task.WhenAll(writes.ToArray());}
            // Keep the local write acknowledgement ahead of CLOSED. Cancellation
            // releases an outstanding native write before its buffers/handle close.
            if(!orderly)lifetime.Cancel();
            await pending.ConfigureAwait(false);
            lifetime.Cancel();await pipe.CloseAsync().ConfigureAwait(false);
            try { await publish(135,new byte[]{orderly?(byte)0:(byte)1}).ConfigureAwait(false); } catch { }
            lifetime.Dispose();credited.Dispose();done.TrySetResult(true);
        }
        internal Task Write(byte[] bytes) { return Outbound(bytes,false); }
        internal Task End() { return Outbound(new byte[0],true); }
        private async Task Outbound(byte[] bytes,bool end)
        {
            var completed=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock(gate)
            {
                if(!started || stopped || writing || localEnd || !end && (bytes.Length==0 || bytes.Length>65536))throw new IOException("PIPE_STREAM_WRITE_INVALID");
                sent+=bytes.Length;if(sent>4194304)throw new IOException("PIPE_STREAM_LIMIT");
                writing=true;writes.Add(completed.Task);if(end)localEnd=true;
            }
            try
            {
                await frames.Send(end?(byte)2:(byte)1,0,bytes,lifetime.Token).ConfigureAwait(false);
                // The parent can see ACK before its native write continuation runs.
                // Release the write slot before publishing it, retaining completion
                // separately so CLOSED still waits for every acknowledgement.
                lock(gate)writing=false;
                var count=new byte[4];PipeFrames.Number(count,0,(uint)bytes.Length);
                await publish(136,count).ConfigureAwait(false);
            }
            catch { lifetime.Cancel();throw; }
            finally { lock(gate){writes.Remove(completed.Task);completed.TrySetResult(true);} }
        }
        internal Task Close()
        {
            lock(gate)
            {
                if(!stopped){stopped=true;lifetime.Cancel();if(!started)Observe(CloseUnstarted());}
                return done.Task;
            }
        }
        private async Task CloseUnstarted()
        {
            await pipe.CloseAsync().ConfigureAwait(false);try{await publish(135,new byte[]{1}).ConfigureAwait(false);}catch{}
            lifetime.Dispose();credited.Dispose();done.TrySetResult(true);
        }
    }
}
