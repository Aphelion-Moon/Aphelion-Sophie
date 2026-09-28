// Original Sophie code, MIT. The installed Microsoft runtime retains its own terms.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Sophie.WindowsPipe
{
    // Internal transport primitive. Role/boot registration and the companion protocol
    // must supply these inputs; this is not a command accepting arbitrary paths/ACLs.
    internal sealed class NativePipe : IDisposable
    {
        internal const uint ClientAccess = 0x00120183;
        private const int Pending = 997, Connected = 535, Aborted = 995, Broken = 109, NoData = 232;
        private readonly SafeFileHandle handle;
        private readonly SafeFileHandle completionPort;
        private readonly int direction;
        private readonly object gate = new object();
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private Task<int> reading, writing, accepting;
        private Task closing;
        private bool connected, stopped;
        private int pendingIo;
        internal int PendingIo { get { return Volatile.Read(ref pendingIo); } }
        internal bool IsServer { get; private set; }

        private NativePipe(SafeFileHandle handle, bool connected, int direction = 3, SafeFileHandle completionPort = null)
        {
            this.handle = handle; this.connected = connected; this.direction = direction; this.completionPort=completionPort;
        }

        internal static NativePipe Inherited(int standardHandle, string ownerSid, int direction)
        {
            var handle = new SafeFileHandle(Native.GetStdHandle(standardHandle), true);
            SafeFileHandle port=null;
            try
            {
                uint flags, outbound, inbound, instances;
                if (handle.IsInvalid || Native.GetFileType(handle) != 3 ||
                    !Native.GetNamedPipeInfo(handle, out flags, out outbound, out inbound, out instances) || flags != 0 || instances != 1)
                    throw new IOException("PIPE_INHERITANCE_INVALID");
                using (var descriptor = new PipeDescriptor(ownerSid, ownerSid)) { descriptor.Apply(handle); descriptor.Verify(handle); }
                // This documented association requires an overlapped handle. A
                // synchronous or already-bound inherited handle fails before I/O.
                port=Native.CreateIoCompletionPort(handle,IntPtr.Zero,UIntPtr.Zero,1);
                if(port.IsInvalid)throw new IOException("PIPE_OVERLAPPED_REQUIRED");
                return new NativePipe(handle, true, direction, port);
            }
            catch { handle.Dispose(); if(port!=null)port.Dispose();throw; }
        }

        internal static NativePipe Listen(string name, string ownerSid, string peerSid, int maximumInstances, bool first)
        {
            RequireName(name);
            if (maximumInstances < 1 || maximumInstances > 4) throw new ArgumentException("PIPE_INSTANCE_LIMIT");
            using (var security = new PipeDescriptor(ownerSid, peerSid, ExactOwner(name)))
            {
                var attributes = new Native.SecurityAttributes { Length = Marshal.SizeOf(typeof(Native.SecurityAttributes)), Descriptor = security.Pointer };
                var handle = Native.CreateNamedPipe(name, 0x00000003u | 0x40000000u | (first ? 0x00080000u : 0u),
                    0x00000008u, (uint)maximumInstances, 65536, 65536, 2000, ref attributes);
                if (handle.IsInvalid) { var error = Failure("PIPE_CREATE"); handle.Dispose(); throw error; }
                try
                {
                    security.Verify(handle);
                    uint flags, outbound, inbound, instances;
                    // This Windows API also reports the selected remote-client rejection bit.
                    if (!Native.GetNamedPipeInfo(handle, out flags, out outbound, out inbound, out instances) || flags != (1u | 8u) || instances != maximumInstances)
                        throw new IOException("PIPE_MODE_INVALID");
                    return new NativePipe(handle, false) { IsServer=true };
                }
                catch { handle.Dispose(); throw; }
            }
        }

        internal static NativePipe Connect(string name, string ownerSid=null, string peerSid=null)
        {
            RequireName(name);
            // Explicit data rights omit FILE_CREATE_PIPE_INSTANCE. The relay needs no impersonation authority.
            var handle = Native.CreateFile(name, ClientAccess, 0, IntPtr.Zero, 3, 0x40000000u | 0x00100000u, IntPtr.Zero);
            if (handle.IsInvalid) { var error = Failure("PIPE_CONNECT"); handle.Dispose(); throw error; }
            try
            {
                if(ownerSid!=null)using(var descriptor=new PipeDescriptor(ownerSid,peerSid,ExactOwner(name)))descriptor.Verify(handle);
                return new NativePipe(handle, true);
            }
            catch { handle.Dispose();throw; }
        }

        internal static void RequireName(string name)
        {
            if (name == null || !Regex.IsMatch(name, @"^\\\\\.\\pipe\\sophie-ai-(?:test-[a-f0-9]{32}|control-(?:core|egress)-[a-f0-9]{64}|(?:(?:private|relay)-)?(?:inference|egress)-[a-f0-9]{64}-[a-f0-9]{64})$"))
                throw new ArgumentException("PIPE_NAME_INVALID");
        }

        // Supervisor control pipes retain their existing service-SID descriptor.
        // Only the new data boundary uses actual virtual-account object owners.
        private static bool ExactOwner(string name){return !name.StartsWith(@"\\.\pipe\sophie-ai-control-",StringComparison.Ordinal);}

        internal static void VerifyEndpoint(string name,string owner,string peer)
        {
            RequireName(name);
            // A metadata-only connection can be discarded by the host's bounded
            // unauthenticated listener. Recheck the actual data handle at use.
            using(var file=Native.CreateFile(name,0x00020000,0,IntPtr.Zero,3,0x40100000,IntPtr.Zero))
            {
                if(file.IsInvalid)throw Failure("PIPE_METADATA_OPEN");
                using(var descriptor=new PipeDescriptor(owner,peer,true))descriptor.Verify(file);
            }
        }

        internal async Task AcceptAsync(CancellationToken cancellation)
        {
            await Start(0, null, cancellation).ConfigureAwait(false);
            lock (gate) { if (stopped) throw new OperationCanceledException(); connected = true; }
        }
        internal Task<int> ReadAsync(byte[] buffer, CancellationToken cancellation) { return Start(1, buffer, cancellation); }
        internal Task<int> WriteAsync(byte[] buffer, CancellationToken cancellation) { return Start(2, buffer, cancellation); }

        private Task<int> Start(int operation, byte[] buffer, CancellationToken cancellation)
        {
            if (operation != 0 && (buffer == null || buffer.Length < 1 || buffer.Length > 65536)) throw new ArgumentException("PIPE_BUFFER_INVALID");
            lock (gate)
            {
                if (stopped || operation == 0 && (connected || accepting != null) || operation != 0 && !connected)
                    throw new IOException("PIPE_STATE_INVALID");
                if (operation == 1 && (direction & 1) == 0 || operation == 2 && (direction & 2) == 0) throw new IOException("PIPE_DIRECTION_INVALID");
                if (operation == 1 && reading != null || operation == 2 && writing != null) throw new IOException("PIPE_IO_BUSY");
                var task = Task.Run(() => Run(operation, buffer, cancellation));
                if (operation == 0) accepting = task; else if (operation == 1) reading = task; else writing = task;
                return task;
            }
        }

        private int Run(int operation, byte[] buffer, CancellationToken cancellation)
        {
            bool reference = false, pending = false; GCHandle pinned = default(GCHandle); IntPtr overlapped = IntPtr.Zero;
            try
            {
                handle.DangerousAddRef(ref reference);
                using (var cancelled = CancellationTokenSource.CreateLinkedTokenSource(cancellation, lifetime.Token))
                using (var completed = new ManualResetEvent(false))
                {
                    cancelled.Token.ThrowIfCancellationRequested();
                    if (buffer != null) pinned = GCHandle.Alloc(buffer, GCHandleType.Pinned);
                    overlapped = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Native.Overlapped)));
                    // The low event bit suppresses completion-port packets. We own
                    // the event/result path and retain all state until it completes.
                    Marshal.StructureToPtr(new Native.Overlapped { Event = new IntPtr(completed.SafeWaitHandle.DangerousGetHandle().ToInt64() | 1) }, overlapped, false);
                    uint transferred = 0;
                    bool immediate = operation == 0 ? Native.ConnectNamedPipe(handle, overlapped) : operation == 1
                        ? Native.ReadFile(handle, pinned.AddrOfPinnedObject(), (uint)buffer.Length, out transferred, overlapped)
                        : Native.WriteFile(handle, pinned.AddrOfPinnedObject(), (uint)buffer.Length, out transferred, overlapped);
                    int error = immediate ? 0 : Marshal.GetLastWin32Error();
                    if (!immediate && !(operation == 0 && error == Connected))
                    {
                        if (error == Broken || error == NoData) { if (operation == 1) return 0; throw new IOException("PIPE_CLOSED"); }
                        if (error != Pending) throw new Win32Exception(error, "PIPE_IO_FAILED");
                        Interlocked.Increment(ref pendingIo); pending = true;
                        // Register after issuing I/O: an already-cancelled token must cancel this operation,
                        // rather than racing a CancelIoEx call made before the operation exists.
                        using (cancelled.Token.Register(() => Native.CancelIoEx(handle, overlapped)))
                        {
                            completed.WaitOne();
                            if (!Native.GetOverlappedResult(handle, overlapped, out transferred, false))
                            {
                                error = Marshal.GetLastWin32Error();
                                if (error == Aborted) throw new OperationCanceledException();
                                if (operation == 1 && (error == Broken || error == NoData)) return 0;
                                throw new Win32Exception(error, "PIPE_IO_FAILED");
                            }
                        }
                    }
                    cancelled.Token.ThrowIfCancellationRequested();
                    return checked((int)transferred);
                }
            }
            finally
            {
                // OVERLAPPED, event and buffer stay alive through observed OS completion.
                if (pending) Interlocked.Decrement(ref pendingIo);
                if (overlapped != IntPtr.Zero) Marshal.FreeHGlobal(overlapped);
                if (pinned.IsAllocated) pinned.Free();
                if (reference) handle.DangerousRelease();
                lock (gate) { if (operation == 1) reading = null; else if (operation == 2) writing = null; }
            }
        }

        // Only a fully acknowledged relay session may reuse its server instance.
        // Keeping this handle open retains first-instance namespace ownership.
        internal void DisconnectDrained()
        {
            lock(gate)
            {
                if(stopped || !IsServer || !connected || reading!=null || writing!=null ||
                    accepting==null || !accepting.IsCompleted || PendingIo!=0)
                    throw new IOException("PIPE_DISCONNECT_BUSY");
                if(!Native.DisconnectNamedPipe(handle))throw Failure("PIPE_DISCONNECT");
                connected=false;accepting=null;
            }
        }

        internal Task CloseAsync()
        {
            lock (gate)
            {
                if (closing != null) return closing;
                stopped = true; lifetime.Cancel(); Native.CancelIoEx(handle, IntPtr.Zero);
                var tasks = new List<Task>();
                if (reading != null) tasks.Add(reading); if (writing != null) tasks.Add(writing); if (accepting != null) tasks.Add(accepting);
                closing = CloseCore(tasks.ToArray()); return closing;
            }
        }
        private async Task CloseCore(Task[] pending)
        {
            try { await Task.WhenAll(pending).ConfigureAwait(false); }
            catch { /* Operation failures do not skip owned-handle cleanup. */ }
            finally { handle.Dispose(); if(completionPort!=null)completionPort.Dispose();lifetime.Dispose(); }
        }
        public void Dispose() { CloseAsync().GetAwaiter().GetResult(); }
        private static Win32Exception Failure(string operation) { return new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    }

    internal sealed class PipeDescriptor : IDisposable
    {
        internal IntPtr Pointer { get; private set; }
        private readonly string expected;
        private readonly uint information;
        internal PipeDescriptor(string owner, string peer,bool strict=false)
        {
            owner = new SecurityIdentifier(owner).Value; peer = new SecurityIdentifier(peer).Value;
            information=strict?5u:4u;
            var descriptor = (strict?"O:"+owner+"D:P":"D:P(A;;FA;;;SY)(A;;FA;;;BA)")+"(A;;FA;;;" + owner + ")(A;;0x00120183;;;" + peer + ")";
            IntPtr value; uint size;
            if (!Native.ConvertStringSecurityDescriptorToSecurityDescriptor(descriptor, 1, out value, out size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "PIPE_DESCRIPTOR_INVALID");
            Pointer = value;
            try { expected = Canonical(value); } catch { Dispose(); throw; }
        }
        private string Canonical(IntPtr descriptor)
        {
            IntPtr text; uint size;
            if (!Native.ConvertSecurityDescriptorToStringSecurityDescriptor(descriptor, 1, information, out text, out size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "PIPE_DESCRIPTOR_UNREADABLE");
            try { return Marshal.PtrToStringUni(text); } finally { Native.LocalFree(text); }
        }
        internal void Verify(SafeFileHandle handle)
        {
            IntPtr owner, group, dacl, sacl, descriptor;
            uint error = Native.GetSecurityInfo(handle, 1, information, out owner, out group, out dacl, out sacl, out descriptor);
            if (error != 0) throw new Win32Exception((int)error, "PIPE_DESCRIPTOR_UNREADABLE");
            try
            {
                // SetSecurityInfo records AUTO_INHERITED even with no inherited ACEs.
                // Permit that bookkeeping bit only; protection and every ACE stay exact.
                string actual=Canonical(descriptor).Replace("D:PAI(","D:P(");
                if(actual!=expected)throw new IOException(actual.Replace("D:","D:P")==expected?"PIPE_DESCRIPTOR_UNPROTECTED":"PIPE_DESCRIPTOR_MISMATCH");
            }
            finally { Native.LocalFree(descriptor); }
        }
        internal void Apply(SafeFileHandle handle)
        {
            bool present, defaulted; IntPtr dacl;
            if (!Native.GetSecurityDescriptorDacl(Pointer, out present, out dacl, out defaulted) || !present || dacl == IntPtr.Zero)
                throw new IOException("PIPE_DESCRIPTOR_INVALID");
            uint result=Native.SetSecurityInfo(handle,1,0x80000004u,IntPtr.Zero,IntPtr.Zero,dacl,IntPtr.Zero);
            if(result!=0)throw new Win32Exception((int)result,"PIPE_DESCRIPTOR_REJECTED");
        }
        public void Dispose() { if (Pointer != IntPtr.Zero) { Native.LocalFree(Pointer); Pointer = IntPtr.Zero; } }
    }

    internal static class Native
    {
        [StructLayout(LayoutKind.Sequential)] internal struct SecurityAttributes { internal int Length; internal IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] internal bool Inherit; }
        [StructLayout(LayoutKind.Sequential)] internal struct Overlapped { internal IntPtr Internal, InternalHigh; internal uint Offset, OffsetHigh; internal IntPtr Event; }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateNamedPipeW")]
        internal static extern SafeFileHandle CreateNamedPipe(string name, uint access, uint mode, uint instances, uint output, uint input, uint timeout, ref SecurityAttributes security);
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateFileW")]
        internal static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool ConnectNamedPipe(SafeFileHandle handle, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool DisconnectNamedPipe(SafeFileHandle handle);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool GetNamedPipeInfo(SafeFileHandle handle, out uint flags, out uint output, out uint input, out uint instances);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool ReadFile(SafeFileHandle handle, IntPtr buffer, uint length, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool WriteFile(SafeFileHandle handle, IntPtr buffer, uint length, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool GetOverlappedResult(SafeFileHandle handle, IntPtr overlapped, out uint transferred, [MarshalAs(UnmanagedType.Bool)] bool wait);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool CancelIoEx(SafeFileHandle handle, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern IntPtr GetStdHandle(int kind);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern uint GetFileType(SafeFileHandle handle);
        [DllImport("kernel32.dll", SetLastError=true)] internal static extern SafeFileHandle CreateIoCompletionPort(SafeFileHandle file,IntPtr existing,UIntPtr key,uint concurrency);
        [DllImport("kernel32.dll")] internal static extern IntPtr LocalFree(IntPtr memory);
        [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="ConvertStringSecurityDescriptorToSecurityDescriptorW")]
        [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string value, uint revision, out IntPtr descriptor, out uint size);
        [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="ConvertSecurityDescriptorToStringSecurityDescriptorW")]
        [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr descriptor, uint revision, uint information, out IntPtr value, out uint size);
        [DllImport("advapi32.dll")] internal static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] internal static extern uint SetSecurityInfo(SafeFileHandle handle,uint type,uint information,IntPtr owner,IntPtr group,IntPtr dacl,IntPtr sacl);
        [DllImport("advapi32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] internal static extern bool GetSecurityDescriptorDacl(IntPtr descriptor,[MarshalAs(UnmanagedType.Bool)] out bool present,out IntPtr dacl,[MarshalAs(UnmanagedType.Bool)] out bool defaulted);
    }
}
