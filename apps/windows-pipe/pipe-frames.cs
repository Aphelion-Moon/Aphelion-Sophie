using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Sophie.WindowsPipe
{
    internal sealed class PipeFrame
    {
        internal byte Code;
        internal uint Id;
        internal byte[] Data;
    }

    // Framing is only byte transport. It never parses application payloads, keys or JSON.
    internal sealed class PipeFrames
    {
        internal const uint LocalSignature=0x53505031, PeerSignature=0x53505431, RelayControlSignature=0x53505231;
        private readonly NativePipe input,output;
        private readonly uint signature;
        private readonly SemaphoreSlim writer=new SemaphoreSlim(1,1);
        private int reading,sending;
        private int broken;
        internal PipeFrames(NativePipe input,NativePipe output,uint signature)
        {
            this.input=input;this.output=output;this.signature=signature;
        }
        internal static uint Number(byte[] bytes,int offset)
        {
            return ((uint)bytes[offset]<<24)|((uint)bytes[offset+1]<<16)|((uint)bytes[offset+2]<<8)|bytes[offset+3];
        }
        internal static void Number(byte[] bytes,int offset,uint value)
        {
            bytes[offset]=(byte)(value>>24);bytes[offset+1]=(byte)(value>>16);bytes[offset+2]=(byte)(value>>8);bytes[offset+3]=(byte)value;
        }
        private async Task<byte[]> Read(int length,bool allowEof,CancellationToken signal)
        {
            if(length==0)return new byte[0];
            var bytes=new byte[length];int offset=0;
            while(offset<length)
            {
                var part=new byte[length-offset];int received=await input.ReadAsync(part,signal).ConfigureAwait(false);
                if(received==0){if(offset==0&&allowEof)return null;throw new IOException("PIPE_FRAME_TRUNCATED");}
                Buffer.BlockCopy(part,0,bytes,offset,received);offset+=received;
            }
            return bytes;
        }
        internal async Task<PipeFrame> Receive(CancellationToken signal,Func<byte,uint,int,Task> beforePayload=null)
        {
            if(Interlocked.Exchange(ref reading,1)!=0)throw new IOException("PIPE_READ_BUSY");
            try
            {
                var header=await Read(16,true,signal).ConfigureAwait(false);if(header==null)return null;
                if(Number(header,0)!=signature || header[5]!=0 || header[6]!=0 || header[7]!=0 || Number(header,12)>65536)
                    throw new IOException("PIPE_FRAME_INVALID");
                if(beforePayload!=null)await beforePayload(header[4],Number(header,8),(int)Number(header,12)).ConfigureAwait(false);
                return new PipeFrame { Code=header[4],Id=Number(header,8),Data=await Read((int)Number(header,12),false,signal).ConfigureAwait(false) };
            }
            finally { Volatile.Write(ref reading,0); }
        }
        private async Task Write(byte[] bytes,CancellationToken signal)
        {
            int offset=0;
            while(offset<bytes.Length)
            {
                var part=new byte[bytes.Length-offset];Buffer.BlockCopy(bytes,offset,part,0,part.Length);
                int written=await output.WriteAsync(part,signal).ConfigureAwait(false);
                if(written<=0)throw new IOException("PIPE_FRAME_WRITE_FAILED");offset+=written;
            }
        }
        internal async Task Send(byte code,uint id,byte[] bytes,CancellationToken signal)
        {
            if(bytes==null || bytes.Length>65536)throw new IOException("PIPE_FRAME_INVALID");
            if(Interlocked.Increment(ref sending)>16){Interlocked.Decrement(ref sending);throw new IOException("PIPE_WRITE_LIMIT");}
            try
            {
                await writer.WaitAsync(signal).ConfigureAwait(false);
                try
                {
                    if(Volatile.Read(ref broken)!=0)throw new IOException("PIPE_FRAME_WRITE_FAILED");
                    var header=new byte[16];Number(header,0,signature);header[4]=code;Number(header,8,id);Number(header,12,(uint)bytes.Length);
                    try { await Write(header,signal).ConfigureAwait(false);await Write(bytes,signal).ConfigureAwait(false); }
                    catch { Volatile.Write(ref broken,1);throw; }
                }
                finally { writer.Release(); }
            }
            finally { Interlocked.Decrement(ref sending); }
        }
    }
}
