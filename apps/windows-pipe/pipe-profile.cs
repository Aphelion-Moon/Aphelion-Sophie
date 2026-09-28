using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Sophie.WindowsPipe
{
    internal sealed class PipeProfile : IDisposable
    {
        internal readonly string Role, Installation, Worker, Boot, Sid;
        private readonly string testRun;
        private readonly InstalledProfile installed;
        private readonly bool relayed;
        internal bool IsRelay { get { return Role=="inference-relay" || Role=="egress-relay"; } }
        internal PipeProfile(string[] args, string sid,ParentBoundary boundary=null)
        {
            if((args.Length!=7 && !(args.Length==8 && args[0]=="installed" && args[1]=="worker")) || (args[0]!="synthetic" && args[0]!="synthetic-relay" && args[0]!="installed") || !Regex.IsMatch(args[1],"^(supervisor|core|egress|worker|inference-relay|egress-relay)$") ||
                !Hex(args[2],64) || !Hex(args[3],64) || !Hex(args[4],64) || !Hex(args[5],args[0]=="installed"?64:32))
                throw new IOException("PIPE_PROFILE_UNQUALIFIED");
            Role=args[1];Installation=args[2];Worker=args[3];Boot=args[4];testRun=args[5];Sid=sid;
            relayed=args[0]!="synthetic";
            if(IsRelay && (!relayed || Worker==new string('0',64) || Boot==new string('0',64)))throw new IOException("PIPE_RELAY_SCOPE_INVALID");
            if(args[0]=="installed")
            {
                if(boundary==null)throw new IOException("PIPE_PROFILE_UNQUALIFIED");
                installed=new InstalledProfile(args,boundary);
            }
        }
        internal int LifetimeMilliseconds { get { return installed==null?TimeoutInfinite:(int)Math.Min(86400000,Math.Max(1,Int64.Parse(installed.Values["expires"])-(DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds)); } }
        private const int TimeoutInfinite=-1;
        public void Dispose(){if(installed!=null)installed.Dispose();}
        private static bool Hex(string value,int count) { return value!=null && Regex.IsMatch(value,"^[a-f0-9]{"+count+"}$"); }
        internal EndpointSpec Endpoint(byte[] data)
        {
            if(data.Length!=65 || data[0]<1 || data[0]>4)throw new IOException("PIPE_ENDPOINT_INVALID");
            byte kind=data[0];
            string worker=BitConverter.ToString(data,1,32).Replace("-","").ToLowerInvariant();
            string boot=BitConverter.ToString(data,33,32).Replace("-","").ToLowerInvariant();
            if(installed!=null)installed.Current();
            if(kind<3 && (worker!=new string('0',64) || boot!=new string('0',64)) ||
                installed!=null && kind>=3 && worker!=Worker ||
                kind>=3 && Role=="worker" && (worker!=Worker || boot!=Boot))throw new IOException("PIPE_ENDPOINT_INVALID");
            bool listen=Role=="supervisor" && kind<3 || Role=="core" && kind==3 || Role=="egress" && kind==4;
            bool connect=Role=="core" && kind==1 || Role=="egress" && kind==2 || Role=="worker" && kind>=3;
            if(!listen && !connect)throw new IOException("PIPE_ROLE_DENIED");
            return Make(kind,worker,boot,relayed && Role=="worker",listen,connect);
        }
        internal EndpointSpec[] RelayEndpoints()
        {
            if(!IsRelay)throw new IOException("PIPE_ROLE_DENIED");
            if(installed!=null)installed.Current();
            byte kind=Role=="inference-relay"?(byte)3:(byte)4;
            return new[]{Make(kind,Worker,Boot,true,true,false),Make(kind,Worker,Boot,false,false,true)};
        }
        private EndpointSpec Make(byte kind,string worker,string boot,bool publicSide,bool listen,bool connect)
        {
            string key=Installation+":"+kind+":"+worker+":"+boot+(relayed&&kind>=3?(publicSide?":public":":private"):"");
            string name;
            string owner=Sid,peer=Sid;
            if(installed==null)
            {
                using(var hash=SHA256.Create())name=BitConverter.ToString(hash.ComputeHash(Encoding.ASCII.GetBytes(testRun+":"+key)),0,16).Replace("-","").ToLowerInvariant();
                name=@"\\.\pipe\sophie-ai-test-"+name;
            }
            else
            {
                string relay=kind==3?"inferenceRelaySid":"egressRelaySid";
                name=kind<3?@"\\.\pipe\sophie-ai-control-"+(kind==1?"core":"egress")+"-"+Installation:
                    @"\\.\pipe\sophie-ai-"+(publicSide?(Role=="worker"?"":"relay-"):"private-")+(kind==3?"inference":"egress")+"-"+worker+"-"+boot;
                owner=installed.Values[kind<3?"supervisorSid":publicSide?relay:kind==3?"coreSid":"egressSid"];
                peer=installed.Values[kind<3?(kind==1?"coreSid":"egressSid"):publicSide?"projectionSid":relay];
            }
            return new EndpointSpec { Name=name, OwnerSid=owner, PeerSid=peer, CanListen=listen, CanConnect=connect, Limit=kind==4?1:2 };
        }
    }
    internal sealed class EndpointSpec
    {
        internal string Name,OwnerSid,PeerSid;
        internal bool CanListen,CanConnect;
        internal int Limit;
    }
}
