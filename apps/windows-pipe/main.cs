using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace Sophie.WindowsPipe
{
    internal static class Program
    {
        private static int stage;
#if SOPHIE_WORKER_RUNTIME
        // The guest variant is built inside the pinned Server Core image. It is
        // never an installed host helper, even if a caller supplies a host role.
        private const string MscorlibHash="95c53c3b0b8060d7471e13916d1bc46a51d60db5e613f3658a5cd4616a278394";
        private const string SystemHash="1ca1c0608877281208dc12afd576e6040746186b476cc9dc41434682664cb98b";
        private const string ClrHash="7c2aa62de41045661a3b2a5df548e51ace7c639d8679b2c2456fdd09b5a81958";
#else
        private const string MscorlibHash="16d33d01fc92b62254e88ba14f0643c2e393de2d2cae688506b62ad11111dd61";
        private const string SystemHash="4ad3740596031471fc3300596263be6f1d067ae4a5127bde287604a5040be482";
        private const string ClrHash="551b297e9ff4d97bd11060af777a9e3cf34c2708780358c2bceecdb9e3a6aecc";
#endif
        private static void Hash(string path,string expected)
        {
            using(var file=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.Read))
            using(var hash=SHA256.Create())
                if(BitConverter.ToString(hash.ComputeHash(file)).Replace("-","").ToLowerInvariant()!=expected)throw new IOException("PIPE_RUNTIME_CHANGED");
        }
        private static void Runtime()
        {
            if(IntPtr.Size!=8)throw new IOException("PIPE_RUNTIME_CHANGED");
            Hash(typeof(object).Assembly.Location,MscorlibHash);
            Hash(typeof(Process).Assembly.Location,SystemHash);
            bool found=false;
            using(var process=Process.GetCurrentProcess())foreach(ProcessModule module in process.Modules)
                if(String.Equals(module.ModuleName,"clr.dll",StringComparison.OrdinalIgnoreCase))
                {Hash(module.FileName,ClrHash);found=true;}
            if(!found)throw new IOException("PIPE_RUNTIME_CHANGED");
        }
        private static int Main(string[] args)
        {
            try { Run(args).GetAwaiter().GetResult();return 0; }
            catch(Exception error)
            {
                string code=System.Text.RegularExpressions.Regex.IsMatch(error.Message,"^[A-Z_]{1,64}$")?error.Message:"PIPE_FAILURE";
                Console.Error.WriteLine("PIPE_START_FAILED_"+stage+":"+code);return 1;
            }
        }
        private static async Task Run(string[] args)
        {
            uint parent;
            if((args.Length!=7 && args.Length!=8) || !UInt32.TryParse(args[6],out parent) || parent==0)throw new IOException("PIPE_START_INVALID");
#if SOPHIE_WORKER_RUNTIME
            if(args[0]=="installed" && args[1]!="worker")throw new IOException("PIPE_RUNTIME_ROLE_INVALID");
#endif
            stage=1;Runtime();stage=2;
            using(var boundary=new ParentBoundary(parent))
            {
            stage=3;
            using(var input=NativePipe.Inherited(-10,boundary.Sid,1))
            {
            stage=4;
            using(var output=NativePipe.Inherited(-11,boundary.Sid,2))
            {
                stage=5;
                using(var profile=new PipeProfile(args,boundary.Sid,boundary))
                using(var authority=CancellationTokenSource.CreateLinkedTokenSource(boundary.Signal))
                {
                authority.CancelAfter(profile.LifetimeMilliseconds);
                stage=6;
                await new Companion(profile,new PipeFrames(input,output,PipeFrames.LocalSignature),authority.Token).Run().ConfigureAwait(false);
                }
            }
            }
            }
        }
    }
}
