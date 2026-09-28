using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Sophie.WindowsPipe
{
    // Used only for fixed installed configuration/package paths, never as a wire
    // operation. No permission is changed; failed protection stops startup.
    internal sealed class ProtectedFiles : IDisposable
    {
        private readonly List<IDisposable> held=new List<IDisposable>();
        private readonly Dictionary<string,bool> directories=new Dictionary<string,bool>(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string,bool> roots=new Dictionary<string,bool>(StringComparer.OrdinalIgnoreCase);
        private readonly string writer,reader;
        internal ProtectedFiles(string writer=null,string reader=null){this.writer=writer;this.reader=reader;}
        private const string SystemSid="S-1-5-18", AdministratorsSid="S-1-5-32-544";
        private const string TrustedInstallerSid="S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
        private const uint Delete=0x00010000,WriteDacl=0x00040000,WriteOwner=0x00080000,DeleteChild=0x00000040;
        private const uint GenericAll=0x10000000,GenericWrite=0x40000000,WriteData=2,AppendData=4,WriteEa=16,WriteAttributes=256;
        private static bool Manager(string sid,bool ancestor)
        {return sid==SystemSid || sid==AdministratorsSid || ancestor && sid==TrustedInstallerSid;}

        internal static void Descriptor(byte[] bytes,bool directory,bool ancestor)
        {Descriptor(bytes,directory,ancestor,null,null);}
        private static void Descriptor(byte[] bytes,bool directory,bool ancestor,string writer,string reader)
        {
            var descriptor=new RawSecurityDescriptor(bytes,0);
            if(descriptor.Owner==null || !(Manager(descriptor.Owner.Value,ancestor) || !ancestor && descriptor.Owner.Value==writer) || descriptor.DiscretionaryAcl==null ||
                (descriptor.ControlFlags & ControlFlags.DiscretionaryAclPresent)==0 ||
                !ancestor && writer==null && (descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected)==0)
                throw new IOException("PIPE_INSTALLATION_UNPROTECTED");
            // Shared Windows ancestors may allow creating unrelated children. They
            // must not grant deletion/replacement or descriptor/owner authority.
            uint forbidden=Delete|WriteDacl|WriteOwner|DeleteChild|GenericAll|GenericWrite|WriteEa|WriteAttributes;
            if(!ancestor)forbidden|=WriteData|AppendData;
            foreach(GenericAce entry in descriptor.DiscretionaryAcl)
            {
                if((entry.AceFlags & AceFlags.InheritOnly)!=0)continue;
                var ace=entry as CommonAce;
                if(ace==null || ace.IsCallback || (ace.AceQualifier!=AceQualifier.AccessAllowed && ace.AceQualifier!=AceQualifier.AccessDenied))
                    throw new IOException("PIPE_INSTALLATION_ACL_INVALID");
                if(ace.AceQualifier==AceQualifier.AccessAllowed && !Manager(ace.SecurityIdentifier.Value,ancestor))
                {
                    string sid=ace.SecurityIdentifier.Value;
                    if((ancestor || sid!=writer) && ((uint)ace.AccessMask & forbidden)!=0)throw new IOException("PIPE_INSTALLATION_WRITABLE");
                    if(!ancestor && reader!=null && sid!=reader && sid!=writer && ((uint)ace.AccessMask & 0x90000001u)!=0)
                        throw new IOException("PIPE_INSTALLATION_READABLE");
                }
            }
        }
        private void Verify(SafeFileHandle handle,string path,bool directory,bool ancestor,string secretReader=null)
        {
            NativeFile.AttributeTag attributes;
            if(Native.GetFileType(handle)!=1 || !NativeFile.GetFileInformationByHandleEx(handle,9,out attributes,8) ||
                (attributes.Attributes & 0x400)!=0 || ((attributes.Attributes & 0x10)!=0)!=directory)
                throw new IOException("PIPE_INSTALLATION_PATH_INVALID");
            var finalPath=new StringBuilder(32768);
            uint size=NativeFile.GetFinalPathNameByHandle(handle,finalPath,(uint)finalPath.Capacity,0);
            string actual=finalPath.ToString();if(actual.StartsWith(@"\\?\",StringComparison.Ordinal))actual=actual.Substring(4);
            if(size==0 || size>=finalPath.Capacity || !String.Equals(actual.TrimEnd('\\'),path.TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))
                throw new IOException("PIPE_INSTALLATION_PATH_CHANGED");
            IntPtr owner,group,dacl,sacl,descriptor;
            uint error=Native.GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor);
            if(error!=0)throw new IOException("PIPE_INSTALLATION_ACL_UNAVAILABLE");
            try
            {
                uint length=NativeFile.GetSecurityDescriptorLength(descriptor);
                if(length==0 || length>65536)throw new IOException("PIPE_INSTALLATION_ACL_INVALID");
                var bytes=new byte[length];Marshal.Copy(descriptor,bytes,0,bytes.Length);Descriptor(bytes,directory,ancestor,writer,secretReader??reader);
            }
            finally{Native.LocalFree(descriptor);}
        }
        private void Directory(string path,bool ancestor)
        {
            bool previous;
            if(directories.TryGetValue(path,out previous))
            {
                // A shared ancestor must not silently become an owned root.
                if(previous && !ancestor)throw new IOException("PIPE_INSTALLATION_ROOT_OVERLAP");
                return;
            }
            // Shared ancestors remain rename-shareable for host management. Their
            // descriptors deny untrusted replacement; only owned roots are pinned.
            var handle=Native.CreateFile(path,0x00120080,ancestor?7u:3u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
            try
            {
                if(handle.IsInvalid)throw new IOException("PIPE_INSTALLATION_PATH_UNAVAILABLE");
                Verify(handle,path,true,ancestor);held.Add(handle);directories.Add(path,ancestor);
            }
            catch{handle.Dispose();throw;}
        }
        internal void Root(string root)
        {
            if(root==null || !System.Text.RegularExpressions.Regex.IsMatch(root,@"^[A-Z]:\\[^:]+$") || Path.GetFullPath(root)!=root || root.EndsWith("\\",StringComparison.Ordinal))
                throw new IOException("PIPE_INSTALLATION_PATH_INVALID");
            if(roots.ContainsKey(root))return;
            string drive=Path.GetPathRoot(root),current=drive;Directory(current,true);
            string[] parts=root.Substring(drive.Length).Split('\\');
            for(int index=0;index<parts.Length;index++){Member(parts[index]);current=Path.Combine(current,parts[index]);Directory(current,index<parts.Length-1);}
            roots.Add(root,true);
        }
        private static void Member(string part)
        {
            if(!System.Text.RegularExpressions.Regex.IsMatch(part,@"^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$") || part.EndsWith(".",StringComparison.Ordinal) ||
                System.Text.RegularExpressions.Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                throw new IOException("PIPE_INSTALLATION_MEMBER_INVALID");
        }
        internal FileStream Open(string root,string relative,long maximum,string secretReader=null)
        {
            if(!roots.ContainsKey(root) || maximum<1 || maximum>268435456 || relative==null || relative.Length>240 || relative.StartsWith("/",StringComparison.Ordinal) || relative.Contains("\\") || relative.Contains(":") ||
                relative.Split('/').Length>12)throw new IOException("PIPE_INSTALLATION_MEMBER_INVALID");
            foreach(string part in relative.Split('/'))Member(part);
            string path=Path.Combine(root,relative.Replace('/','\\')),parent=Path.GetDirectoryName(path);
            var ancestors=new List<string>();
            while(parent!=root){ancestors.Add(parent);parent=Path.GetDirectoryName(parent);if(parent==null)throw new IOException("PIPE_INSTALLATION_MEMBER_INVALID");}
            ancestors.Reverse();foreach(string directory in ancestors)Directory(directory,false);
            // Supervisor revocation must be able to unlink a held bootstrap.
            // Its immutable snapshot stays readable; no in-place writes are shared.
            var handle=Native.CreateFile(path,0x00120081,writer==null?1u:5u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
            FileStream file=null;
            try
            {
                if(handle.IsInvalid)throw new IOException("PIPE_INSTALLATION_FILE_UNAVAILABLE");
                Verify(handle,path,false,false,secretReader);
                file=new FileStream(handle,FileAccess.Read,4096,false);
                if(file.Length<=0 || file.Length>maximum)throw new IOException("PIPE_INSTALLATION_FILE_INVALID");
                held.Add(file);return file;
            }
            catch{if(file!=null)file.Dispose();else handle.Dispose();throw;}
        }
        internal static string ReadAscii(FileStream file,int maximum)
        {
            if(file.Length>maximum)throw new IOException("PIPE_INSTALLATION_FILE_INVALID");
            file.Position=0;
            var bytes=new byte[(int)file.Length];int offset=0;
            while(offset<bytes.Length){int count=file.Read(bytes,offset,bytes.Length-offset);if(count==0)throw new IOException("PIPE_INSTALLATION_FILE_INVALID");offset+=count;}
            foreach(byte value in bytes)if(value!=10 && (value<32 || value>126))throw new IOException("PIPE_INSTALLATION_ENCODING_INVALID");
            return Encoding.ASCII.GetString(bytes);
        }
        internal static string Hash(FileStream file)
        {
            file.Position=0;
            using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(file)).Replace("-","").ToLowerInvariant();
        }
        public void Dispose(){for(int index=held.Count-1;index>=0;index--)held[index].Dispose();held.Clear();}
    }
    internal static class NativeFile
    {
        [StructLayout(LayoutKind.Sequential)]internal struct AttributeTag{internal uint Attributes,Tag;}
        [DllImport("kernel32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetFileInformationByHandleEx(SafeFileHandle handle,uint kind,out AttributeTag information,uint size);
        [DllImport("kernel32.dll",CharSet=CharSet.Unicode,EntryPoint="GetFinalPathNameByHandleW",SetLastError=true)]
        internal static extern uint GetFinalPathNameByHandle(SafeFileHandle handle,StringBuilder path,uint size,uint flags);
        [DllImport("advapi32.dll")]internal static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    }
}
