using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Sophie.WindowsPipe
{
    internal sealed class Companion
    {
        private sealed class Endpoint
        {
            internal uint Id;
            internal EndpointSpec Spec;
            internal CancellationTokenSource Lifetime;
            internal NativePipe Pending;
            internal Task Listener;
            internal Task Closing;
            internal bool Removing;
            internal readonly SemaphoreSlim SlotFreed=new SemaphoreSlim(0,1);
        }
        private sealed class Connection
        {
            internal uint Id;
            internal Endpoint Endpoint;
            internal PeerStream Peer;
            internal bool Physical;
            internal readonly TaskCompletionSource<bool> Done=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        }
        private readonly PipeProfile profile;
        private readonly PipeFrames local;
        private readonly CancellationTokenSource lifetime;
        private readonly object gate=new object();
        private readonly Dictionary<uint,Endpoint> endpoints=new Dictionary<uint,Endpoint>();
        private readonly Dictionary<uint,Connection> connections=new Dictionary<uint,Connection>();
        private readonly List<Task> operations=new List<Task>();
        private uint nextAccepted=0x80000000, lastOutbound;
        private bool stopping;
        internal Companion(PipeProfile profile,PipeFrames local,CancellationToken parent)
        {
            this.profile=profile;this.local=local;lifetime=CancellationTokenSource.CreateLinkedTokenSource(parent);
        }
        private async Task Send(byte code,uint id,byte[] data)
        {
            using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token))
            {
                timeout.CancelAfter(2000);
                try { await local.Send(code,id,data,timeout.Token).ConfigureAwait(false); }
                catch { lifetime.Cancel();throw; }
            }
        }
        private Task Reply(byte code,uint id) { return Send(code,id,new byte[0]); }
        private static byte[] Number(uint number) { var data=new byte[4];PipeFrames.Number(data,0,number);return data; }
        private Task Header(byte code,uint id,int length)
        {
            bool valid=code==1 && id>=1 && id<=4 && length==65 ||
                (code==2 || code==3) && id>=1 && id<=4 && length==0 ||
                code==4 && id>0 && id<0x80000000 && length==4 ||
                code==5 && id>0 && length>0 && length<=65536 ||
                code==6 && id>0 && length==4 || (code==7 || code==8) && id>0 && length==0 ||
                code==9 && id==0 && length==0 || code==10 && id>0 && length==0;
            if(!valid)throw new IOException("PIPE_COMMAND_INVALID");
            return Task.FromResult(true);
        }
        internal async Task Run()
        {
            bool requested=false;Exception failure=null;
            try
            {
                await Send(128,0,new byte[]{1,0}).ConfigureAwait(false);
                for(;;)
                {
                    var frame=await local.Receive(lifetime.Token,Header).ConfigureAwait(false);
                    if(frame==null)break;
                    if(frame.Code==9){requested=true;break;}
                    Dispatch(frame);
                }
            }
            catch(Exception error) { failure=error; }
            {
                Endpoint[] registered;Task[] pending;
                lock(gate){stopping=true;registered=new List<Endpoint>(endpoints.Values).ToArray();pending=new List<Task>(operations).ToArray();}
                // Keep complete local frames on requested shutdown. Each publish has
                // its own bound; a broken/cancelled frame permanently poisons output.
                if(!requested)lifetime.Cancel();
                foreach(var endpoint in registered)endpoint.Lifetime.Cancel();
                var cleanup=new List<Task>();
                foreach(var endpoint in registered)cleanup.Add(Remove(endpoint));
                cleanup.AddRange(pending);
                try { await Task.WhenAll(cleanup).ConfigureAwait(false); } catch { }
                if(requested)
                    using(var timeout=new CancellationTokenSource(2000))
                        await local.Send(138,0,new byte[0],timeout.Token).ConfigureAwait(false);
                lifetime.Cancel();lifetime.Dispose();
                if(!requested)throw failure??new IOException("PIPE_PARENT_LOST");
            }
        }
        private void Track(Func<Task> action)
        {
            Task task;
            lock(gate)
            {
                if(stopping || operations.Count>=16)throw new IOException("PIPE_OPERATION_LIMIT");
                // Start outside the receive loop; data writes can wait for another
                // stream's credits without preventing the parent from granting them.
                task=Task.Run(async()=>{try{await action().ConfigureAwait(false);}catch{lifetime.Cancel();}});operations.Add(task);
            }
            Observe(task);
        }
        private async void Observe(Task task)
        {
            try { await task.ConfigureAwait(false); }
            catch { }
            finally { lock(gate)operations.Remove(task); }
        }
        private Endpoint FindEndpoint(uint id)
        {
            Endpoint endpoint;if(!endpoints.TryGetValue(id,out endpoint) || endpoint.Removing)throw new IOException("PIPE_ENDPOINT_UNKNOWN");return endpoint;
        }
        private Connection FindConnection(uint id)
        {
            Connection connection;if(!connections.TryGetValue(id,out connection))throw new IOException("PIPE_CONNECTION_UNKNOWN");return connection;
        }
        private void Dispatch(PipeFrame frame)
        {
            lock(gate)
            {
                if(stopping)throw new IOException("PIPE_STOPPED");
                if(frame.Code==1)
                {
                    if(endpoints.ContainsKey(frame.Id) || endpoints.Count>=4)throw new IOException("PIPE_ENDPOINT_LIMIT");
                    var spec=profile.Endpoint(frame.Data);
                    foreach(var value in endpoints.Values)if(value.Spec.Name==spec.Name)throw new IOException("PIPE_ENDPOINT_DUPLICATE");
                    endpoints.Add(frame.Id,new Endpoint { Id=frame.Id,Spec=spec,Lifetime=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token) });
                    Track(()=>Reply(129,frame.Id));return;
                }
                if(frame.Code==2)
                {
                    var endpoint=FindEndpoint(frame.Id);endpoint.Removing=true;endpoint.Lifetime.Cancel();
                    Track(async()=>{await Remove(endpoint).ConfigureAwait(false);await Reply(137,frame.Id).ConfigureAwait(false);});return;
                }
                if(frame.Code==3)
                {
                    var endpoint=FindEndpoint(frame.Id);
                    if(!endpoint.Spec.CanListen || endpoint.Listener!=null)throw new IOException("PIPE_LISTEN_DENIED");
                    // Reserve listener state before asynchronous startup.
                    endpoint.Listener=Task.Run(()=>Listen(endpoint));return;
                }
                if(frame.Code==4)
                {
                    var endpoint=FindEndpoint(PipeFrames.Number(frame.Data,0));
                    if(!endpoint.Spec.CanConnect || frame.Id<=lastOutbound)throw new IOException("PIPE_CONNECT_DENIED");
                    lastOutbound=frame.Id;
                    if(connections.Count>=8 || Count(endpoint)>=endpoint.Spec.Limit)throw new IOException("PIPE_CONNECTION_LIMIT");
                    var connection=new Connection { Id=frame.Id,Endpoint=endpoint };connections.Add(frame.Id,connection);
                    Track(()=>Connect(connection));return;
                }
                var current=FindConnection(frame.Id);
                if(frame.Code==10)
                {
                    if(!current.Physical)throw new IOException("PIPE_CLOSE_RECEIPT_INVALID");
                    connections.Remove(frame.Id);return;
                }
                if(current.Peer==null)throw new IOException("PIPE_CONNECTION_PENDING");
                if(frame.Code==6){current.Peer.Credit(PipeFrames.Number(frame.Data,0));return;}
                // Invoke synchronously to reserve the single outstanding write before
                // accepting another local frame. Only the bounded completion runs aside.
                Task work=frame.Code==5?current.Peer.Write(frame.Data):frame.Code==7?current.Peer.End():current.Peer.Close();
                Track(async()=>{bool failed=false;try{await work.ConfigureAwait(false);}catch{failed=true;}if(failed)await current.Peer.Close().ConfigureAwait(false);});
            }
        }
        private int Count(Endpoint endpoint)
        {
            int count=0;foreach(var connection in connections.Values)if(connection.Endpoint==endpoint && !connection.Physical)count++;return count;
        }
        private async Task Connect(Connection connection)
        {
            NativePipe pipe=null;
            try
            {
                connection.Endpoint.Lifetime.Token.ThrowIfCancellationRequested();
                pipe=NativePipe.Connect(connection.Endpoint.Spec.Name,connection.Endpoint.Spec.OwnerSid,connection.Endpoint.Spec.PeerSid);
                await Attach(connection,pipe,131).ConfigureAwait(false);pipe=null;
            }
            catch { }
            if(pipe==null && connection.Peer!=null)return;
            if(pipe!=null)await pipe.CloseAsync().ConfigureAwait(false);
            try { await Send(255,connection.Id,new byte[]{4}).ConfigureAwait(false); }
            finally { lock(gate)connections.Remove(connection.Id);connection.Done.TrySetResult(true); }
        }
        private async Task Attach(Connection connection,NativePipe pipe,byte code)
        {
            lock(gate)
            {
                if(stopping || connection.Endpoint.Removing)throw new IOException("PIPE_STOPPED");
                connection.Peer=new PeerStream(pipe,connection.Endpoint.Lifetime.Token,async(kind,data)=>{
                    if(kind==135)lock(gate)connection.Physical=true;
                    try { await Send(kind,connection.Id,data).ConfigureAwait(false); }
                    finally
                    {
                        if(kind==135)lock(gate)
                        {
                            if(connection.Endpoint.SlotFreed.CurrentCount==0)connection.Endpoint.SlotFreed.Release();
                            connection.Done.TrySetResult(true);
                        }
                    }
                });
                connection.Peer.Start(Send(code,connection.Id,Number(connection.Endpoint.Id)));
            }
            await Task.FromResult(true).ConfigureAwait(false);
        }
        private async Task Listen(Endpoint endpoint)
        {
            NativePipe accepted=null;
            try
            {
                endpoint.Pending=NativePipe.Listen(endpoint.Spec.Name,endpoint.Spec.OwnerSid,endpoint.Spec.PeerSid,endpoint.Spec.Limit+1,true);
                await Reply(130,endpoint.Id).ConfigureAwait(false);
                while(!endpoint.Lifetime.IsCancellationRequested)
                {
                    for(;;)
                    {
                        lock(gate)if(Count(endpoint)<endpoint.Spec.Limit)break;
                        await endpoint.SlotFreed.WaitAsync(endpoint.Lifetime.Token).ConfigureAwait(false);
                    }
                    await endpoint.Pending.AcceptAsync(endpoint.Lifetime.Token).ConfigureAwait(false);
                    accepted=endpoint.Pending;
                    // Keep an owned instance alive across every accept/rejection.
                    endpoint.Pending=NativePipe.Listen(endpoint.Spec.Name,endpoint.Spec.OwnerSid,endpoint.Spec.PeerSid,endpoint.Spec.Limit+1,false);
                    Connection connection=null;
                    lock(gate)
                    {
                        if(!stopping && !endpoint.Removing && connections.Count<8 && Count(endpoint)<endpoint.Spec.Limit && nextAccepted<uint.MaxValue)
                        {
                            connection=new Connection { Id=nextAccepted++,Endpoint=endpoint };connections.Add(connection.Id,connection);
                        }
                    }
                    if(connection==null)await accepted.CloseAsync().ConfigureAwait(false);
                    else await Attach(connection,accepted,132).ConfigureAwait(false);
                    accepted=null;
                }
            }
            catch { }
            if(accepted!=null)await accepted.CloseAsync().ConfigureAwait(false);
            if(endpoint.Pending!=null)await endpoint.Pending.CloseAsync().ConfigureAwait(false);
            if(!endpoint.Lifetime.IsCancellationRequested){await Send(255,endpoint.Id,new byte[]{3}).ConfigureAwait(false);lifetime.Cancel();}
        }
        private Task Remove(Endpoint endpoint)
        {
            lock(gate){if(endpoint.Closing==null)endpoint.Closing=RemoveCore(endpoint);return endpoint.Closing;}
        }
        private async Task RemoveCore(Endpoint endpoint)
        {
            Task listener;List<Task> closed=new List<Task>();
            lock(gate)
            {
                endpoint.Removing=true;endpoint.Lifetime.Cancel();listener=endpoint.Listener;
                foreach(var connection in new List<Connection>(connections.Values))
                    if(connection.Endpoint==endpoint)
                    {
                        closed.Add(connection.Done.Task);
                        if(connection.Peer!=null)closed.Add(connection.Peer.Close());
                    }
            }
            if(listener!=null)closed.Add(listener);
            try { await Task.WhenAll(closed).ConfigureAwait(false); } catch { }
            lock(gate)endpoints.Remove(endpoint.Id);
            endpoint.Lifetime.Dispose();endpoint.SlotFreed.Dispose();
        }
    }
}
