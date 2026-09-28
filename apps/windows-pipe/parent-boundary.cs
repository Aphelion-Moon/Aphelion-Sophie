using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Sophie.WindowsPipe
{
    // Process lineage is checked independently of pipe handles. A retained process
    // handle and creation time avoid mistaking PID reuse for parent continuity.
    internal sealed class ParentBoundary : IDisposable
    {
        private const string NodeHash="3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237";
        private readonly SafeFileHandle parent;
        private readonly FileStream image;
        private readonly CancellationTokenSource lifetime=new CancellationTokenSource();
        private readonly Task watcher;
        private int disposed;
        internal string Sid { get; private set; }
        internal string ImagePath { get; private set; }
        internal CancellationToken Signal { get { return lifetime.Token; } }
        internal ParentBoundary(uint expectedParent)
        {
            using(var process=Process.GetCurrentProcess())
            using(var snapshot=CreateToolhelp32Snapshot(2,0))
            {
                if(snapshot.IsInvalid)throw new IOException("PARENT_UNAVAILABLE");
                var entry=new Entry { Size=(uint)Marshal.SizeOf(typeof(Entry)) };uint found=0;
                for(bool available=Process32First(snapshot,ref entry);available;available=Process32Next(snapshot,ref entry))
                    if(entry.ProcessId==(uint)process.Id){found=entry.ParentProcessId;break;}
                if(found==0 || found!=expectedParent)throw new IOException("PARENT_MISMATCH");
                parent=OpenProcess(0x00101000u,false,found);
                if(parent.IsInvalid){parent.Dispose();throw new IOException("PARENT_UNAVAILABLE");}
                try
                {
                    ulong created,exited,kernel,user,ownCreated;
                    if(!GetProcessTimes(parent.DangerousGetHandle(),out created,out exited,out kernel,out user) ||
                        !GetProcessTimes(process.Handle,out ownCreated,out exited,out kernel,out user) || created>ownCreated || WaitForSingleObject(parent,0)!=258)
                        throw new IOException("PARENT_MISMATCH");
                    using(var identity=WindowsIdentity.GetCurrent()) Sid=identity.User.Value;
                    SafeAccessTokenHandle token;
                    if(!OpenProcessToken(parent,8,out token))throw new IOException("PARENT_IDENTITY_UNAVAILABLE");
                    using(token)using(var identity=new WindowsIdentity(token.DangerousGetHandle()))
                        if(identity.User.Value!=Sid)throw new IOException("PARENT_IDENTITY_MISMATCH");
                    var path=new StringBuilder(32768);uint length=(uint)path.Capacity;
                    if(!QueryFullProcessImageName(parent,0,path,ref length))throw new IOException("PARENT_IMAGE_UNAVAILABLE");
                    ImagePath=path.ToString();
                    image=new FileStream(path.ToString(),FileMode.Open,FileAccess.Read,FileShare.Read);
                    using(var hash=SHA256.Create())
                        if(BitConverter.ToString(hash.ComputeHash(image)).Replace("-","").ToLowerInvariant()!=NodeHash)throw new IOException("PARENT_IMAGE_CHANGED");
                }
                catch { if(image!=null)image.Dispose();parent.Dispose();throw; }
            }
            watcher=Task.Run(()=>{
                while(Volatile.Read(ref disposed)==0)
                {
                    uint result=WaitForSingleObject(parent,100);
                    if(result!=258){lifetime.Cancel();return;}
                }
            });
        }
        internal void RequireIdentity(string user,string service)
        {
            SafeAccessTokenHandle token;
            // WindowsPrincipal checks enabled membership using an identification
            // token. A primary parent token needs TOKEN_DUPLICATE as well as QUERY.
            if(!OpenProcessToken(parent,service=="-"?8u:10u,out token))throw new IOException("PARENT_IDENTITY_UNAVAILABLE");
            using(token)using(var identity=new WindowsIdentity(token.DangerousGetHandle()))RequireIdentity(identity,user,service);
            using(var identity=WindowsIdentity.GetCurrent())RequireIdentity(identity,user,service);
        }
        private static void RequireIdentity(WindowsIdentity identity,string user,string service)
        {
            if(identity.User.Value!=user || service!="-" && !new WindowsPrincipal(identity).IsInRole(new SecurityIdentifier(service)))
                throw new IOException("PIPE_SERVICE_IDENTITY_MISMATCH");
        }
        public void Dispose()
        {
            if(Interlocked.Exchange(ref disposed,1)!=0)return;
            watcher.GetAwaiter().GetResult();lifetime.Cancel();lifetime.Dispose();image.Dispose();parent.Dispose();
        }
        [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] private struct Entry
        {
            internal uint Size,Usage,ProcessId;internal IntPtr Heap;internal uint ModuleId,Threads,ParentProcessId;internal int Priority;internal uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] internal string Name;
        }
        [DllImport("kernel32.dll",SetLastError=true)] private static extern SafeFileHandle CreateToolhelp32Snapshot(uint flags,uint process);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,EntryPoint="Process32FirstW",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Process32First(SafeFileHandle snapshot,ref Entry entry);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,EntryPoint="Process32NextW",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool Process32Next(SafeFileHandle snapshot,ref Entry entry);
        [DllImport("kernel32.dll",SetLastError=true)] private static extern SafeFileHandle OpenProcess(uint access,[MarshalAs(UnmanagedType.Bool)] bool inherit,uint process);
        [DllImport("kernel32.dll",SetLastError=true)] private static extern uint WaitForSingleObject(SafeFileHandle handle,uint milliseconds);
        [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(IntPtr process,out ulong created,out ulong exited,out ulong kernel,out ulong user);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,EntryPoint="QueryFullProcessImageNameW",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool QueryFullProcessImageName(SafeFileHandle process,uint flags,StringBuilder path,ref uint length);
        [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(SafeFileHandle process,uint access,out SafeAccessTokenHandle token);
    }
}
