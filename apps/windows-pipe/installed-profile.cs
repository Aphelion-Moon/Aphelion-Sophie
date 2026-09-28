using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text.RegularExpressions;

namespace Sophie.WindowsPipe
{
    // The independently provisioned owner record is outside the hashed package.
    // It cannot be selected through the byte protocol or supplied by a manifest.
    internal sealed class InstalledProfile : IDisposable
    {
        private readonly ProtectedFiles files=new ProtectedFiles();
        private ProtectedFiles bootFiles,providerFiles;
        internal readonly Dictionary<string,string> Values;
        internal readonly string SourceRoot,RuntimeRoot;
        internal InstalledProfile(string[] args,ParentBoundary boundary)
        {
            try
            {
                string role=args[1],trust=role=="worker"?@"C:\sophie-trust":@"C:\Aphelion\Sophie\trust";
                SourceRoot=role=="worker"?@"C:\sophie":@"C:\Aphelion\Sophie\package\source";
                RuntimeRoot=role=="worker"?@"C:\node":@"C:\Aphelion\Sophie\package\runtime";
                files.Root(trust);
                var owner=files.Open(trust,role+".profile",8192);
                if(ProtectedFiles.Hash(owner)!=args[5])throw new IOException("PIPE_OWNER_CHANGED");
                Values=Parse(ProtectedFiles.ReadAscii(owner,8192));
                if(Values["role"]!=role || Values["installation"]!=args[2] || Values["worker"]!=args[3])throw new IOException("PIPE_OWNER_MISMATCH");
                boundary.RequireIdentity(Values["userSid"],Values["serviceSid"]);
                files.Root(SourceRoot);files.Root(RuntimeRoot);
                if(!String.Equals(boundary.ImagePath,Path.Combine(RuntimeRoot,"node.exe"),StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(Process.GetCurrentProcess().MainModule.FileName,Path.Combine(SourceRoot,@"apps\windows-pipe\sophie-pipe.exe"),StringComparison.OrdinalIgnoreCase))
                    throw new IOException("PIPE_INSTALLED_IMAGE_MISMATCH");
                var manifest=files.Open(SourceRoot,"installation.manifest",262144);
                if(ProtectedFiles.Hash(manifest)!=Values["manifest"])throw new IOException("PIPE_MANIFEST_CHANGED");
                VerifyManifest(ProtectedFiles.ReadAscii(manifest,262144));
                var configuration=files.Open(trust,role+".json",65536,role=="worker"?Values["userSid"]:Values["serviceSid"]);
                if(ProtectedFiles.Hash(configuration)!=Values["configuration"])throw new IOException("PIPE_CONFIGURATION_CHANGED");
                if(role=="worker")
                {
                    if(args.Length!=8 || !Regex.IsMatch(args[7],"^[a-f0-9]{64}$") || args[4]==new string('0',64))throw new IOException("PIPE_BOOT_INVALID");
                    // Host mount custody still needs independent operational evidence.
                    // These checks additionally reject writable guest projections.
                    bootFiles=new ProtectedFiles(Values["supervisorSid"],Values["guestSid"]);
                    bootFiles.Root(@"C:\sophie-boot");
                    if(ProtectedFiles.Hash(bootFiles.Open(@"C:\sophie-boot","boot.json",8192))!=args[7])throw new IOException("PIPE_BOOT_CHANGED");
                    providerFiles=new ProtectedFiles(null,Values["guestSid"]);providerFiles.Root(@"C:\sophie-provider");
                    providerFiles.Open(@"C:\sophie-provider","api-key.txt",512);
                }
                else if(args.Length!=7 || args[4]!=Values["boot"])throw new IOException("PIPE_BOOT_INVALID");
                if(role=="supervisor")
                {
                    bootFiles=new ProtectedFiles(Values["supervisorSid"],Values["supervisorSid"]);
                    bootFiles.Root(@"C:\Aphelion\Sophie\state\boots");
                    bootFiles.Root(@"C:\Aphelion\Sophie\state\supervisor");
                }
                Current();
            }
            catch{Dispose();throw;}
        }
        internal static Dictionary<string,string> Parse(string text)
        {
            var values=new Dictionary<string,string>(StringComparer.Ordinal);
            string[] names={"version","role","installation","worker","release","profile","evidence","manifest","configuration","userSid","serviceSid","supervisorSid","coreSid","egressSid","inferenceRelaySid","egressRelaySid","projectionSid","guestSid","boot","expires"};
            if(text==null || !text.EndsWith("\n",StringComparison.Ordinal) || text.Length>8192)throw new IOException("PIPE_OWNER_INVALID");
            foreach(string line in text.TrimEnd('\n').Split('\n'))
            {
                int split=line.IndexOf('=');if(split<1 || split==line.Length-1 || values.ContainsKey(line.Substring(0,split)))throw new IOException("PIPE_OWNER_INVALID");
                values.Add(line.Substring(0,split),line.Substring(split+1));
            }
            if(values.Count!=names.Length)throw new IOException("PIPE_OWNER_INVALID");
            foreach(string name in names)if(!values.ContainsKey(name))throw new IOException("PIPE_OWNER_INVALID");
            if(values["version"]!="2" || !Regex.IsMatch(values["role"],"^(supervisor|core|egress|worker|inference-relay|egress-relay)$"))throw new IOException("PIPE_OWNER_INVALID");
            foreach(string name in new[]{"installation","worker","release","profile","evidence","manifest","configuration"})
                if(!Regex.IsMatch(values[name],"^[a-f0-9]{64}$") || values[name]==new string('0',64))throw new IOException("PIPE_OWNER_INVALID");
            foreach(string name in new[]{"userSid","supervisorSid","coreSid","egressSid","inferenceRelaySid","egressRelaySid","projectionSid","guestSid"})CanonicalSid(values[name]);
            foreach(string name in new[]{"supervisorSid","coreSid","egressSid","inferenceRelaySid","egressRelaySid"})
                if(!Regex.IsMatch(values[name],@"^S-1-5-80-(\d+-){4}\d+$"))throw new IOException("PIPE_OWNER_INVALID");
            var identities=new Dictionary<string,bool>();
            foreach(string name in new[]{"supervisorSid","coreSid","egressSid","inferenceRelaySid","egressRelaySid","projectionSid","guestSid"})
            {if(identities.ContainsKey(values[name]))throw new IOException("PIPE_OWNER_IDENTITY_OVERLAP");identities.Add(values[name],true);}
            bool relay=values["role"]=="inference-relay" || values["role"]=="egress-relay";
            if(!Regex.IsMatch(values["boot"],"^[a-f0-9]{64}$") || (relay?values["boot"]==new string('0',64):values["boot"]!=new string('0',64)))throw new IOException("PIPE_BOOT_INVALID");
            if(values["role"]=="worker")
            {if(values["serviceSid"]!="-" || values["userSid"]!=values["guestSid"])throw new IOException("PIPE_OWNER_INVALID");}
            else if(values["serviceSid"]!=values[values["role"]=="inference-relay"?"inferenceRelaySid":values["role"]=="egress-relay"?"egressRelaySid":values["role"]+"Sid"])throw new IOException("PIPE_OWNER_INVALID");
            if(relay && values["userSid"]!=values["serviceSid"])throw new IOException("PIPE_RELAY_IDENTITY_INVALID");
            long expires;if(!Int64.TryParse(values["expires"],out expires) || expires<1 || expires>253402300799000L)throw new IOException("PIPE_OWNER_INVALID");
            return values;
        }
        private static void CanonicalSid(string sid)
        {if(new SecurityIdentifier(sid).Value!=sid)throw new IOException("PIPE_OWNER_INVALID");}
        internal void Current()
        {
            long now=(long)(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds;
            long expires=Int64.Parse(Values["expires"]);
            if(expires<=now || expires-now>86400000)throw new IOException("PIPE_QUALIFICATION_EXPIRED");
        }
        private void VerifyManifest(string text)
        {
            var seen=new Dictionary<string,bool>(StringComparer.OrdinalIgnoreCase);long total=0;
            if(!text.EndsWith("\n",StringComparison.Ordinal))throw new IOException("PIPE_MANIFEST_INVALID");
            foreach(string line in text.TrimEnd('\n').Split('\n'))
            {
                if(line.Length<68 || !Regex.IsMatch(line.Substring(0,64),"^[a-f0-9]{64}$") || line[64]!=' ')throw new IOException("PIPE_MANIFEST_INVALID");
                string name=line.Substring(65);if(seen.Count>=2048 || seen.ContainsKey(name))throw new IOException("PIPE_MANIFEST_INVALID");seen.Add(name,true);
                bool runtime=name.StartsWith("runtime/",StringComparison.Ordinal),source=name.StartsWith("source/",StringComparison.Ordinal);
                if(!runtime && !source)throw new IOException("PIPE_MANIFEST_INVALID");
                var file=files.Open(runtime?RuntimeRoot:SourceRoot,name.Substring(runtime?8:7),268435456);
                total+=file.Length;if(total>536870912 || ProtectedFiles.Hash(file)!=line.Substring(0,64))throw new IOException("PIPE_PACKAGE_CHANGED");
            }
            foreach(string name in new[]{"runtime/node.exe","runtime/LICENSE","source/package.json","source/apps/windows-pipe/sophie-pipe.exe","source/apps/windows-pipe/transport.js"})
                if(!seen.ContainsKey(name))throw new IOException("PIPE_MANIFEST_INCOMPLETE");
            string role=Values["role"],entry=role=="inference-relay"?"apps/ai-relay/inference.mjs":role=="egress-relay"?"apps/ai-relay/egress.mjs":role=="worker"?"apps/knowledge-worker/main.mjs":
                "apps/"+(role=="core"?"core":"ai-"+role)+"/installed.mjs";
            if(!seen.ContainsKey("source/"+entry))throw new IOException("PIPE_MANIFEST_INCOMPLETE");
        }
        public void Dispose(){if(providerFiles!=null)providerFiles.Dispose();if(bootFiles!=null)bootFiles.Dispose();files.Dispose();}
    }
}
