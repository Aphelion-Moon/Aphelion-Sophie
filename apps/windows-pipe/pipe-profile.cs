using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Sophie.WindowsPipe
{
    // Synthetic profiles cannot name an installed pipe or select another identity.
    // Installed profiles require separately qualified identity/protection evidence.
    internal sealed class PipeProfile
    {
        internal readonly string Role, Installation, Worker, Boot, Sid;
        private readonly string testRun;
        internal PipeProfile(string[] args, string sid)
        {
            if(args.Length!=7 || args[0]!="synthetic" || !Regex.IsMatch(args[1],"^(supervisor|core|egress|worker)$") ||
                !Hex(args[2],64) || !Hex(args[3],64) || !Hex(args[4],64) || !Hex(args[5],32))
                throw new IOException("PIPE_PROFILE_UNQUALIFIED");
            Role=args[1];Installation=args[2];Worker=args[3];Boot=args[4];testRun=args[5];Sid=sid;
        }
        private static bool Hex(string value,int count) { return value!=null && Regex.IsMatch(value,"^[a-f0-9]{"+count+"}$"); }
        internal EndpointSpec Endpoint(byte[] data)
        {
            if(data.Length!=65 || data[0]<1 || data[0]>4)throw new IOException("PIPE_ENDPOINT_INVALID");
            byte kind=data[0];
            string worker=BitConverter.ToString(data,1,32).Replace("-","").ToLowerInvariant();
            string boot=BitConverter.ToString(data,33,32).Replace("-","").ToLowerInvariant();
            if(kind<3 && (worker!=new string('0',64) || boot!=new string('0',64)) ||
                kind>=3 && Role=="worker" && (worker!=Worker || boot!=Boot))throw new IOException("PIPE_ENDPOINT_INVALID");
            bool listen=Role=="supervisor" && kind<3 || Role=="core" && kind==3 || Role=="egress" && kind==4;
            bool connect=Role=="core" && kind==1 || Role=="egress" && kind==2 || Role=="worker" && kind>=3;
            if(!listen && !connect)throw new IOException("PIPE_ROLE_DENIED");
            string key=Installation+":"+kind+":"+worker+":"+boot;
            string name;
            using(var hash=SHA256.Create())name=BitConverter.ToString(hash.ComputeHash(Encoding.ASCII.GetBytes(testRun+":"+key)),0,16).Replace("-","").ToLowerInvariant();
            return new EndpointSpec { Name=@"\\.\pipe\sophie-ai-test-"+name, CanListen=listen, CanConnect=connect, Limit=kind==4?1:2 };
        }
    }
    internal sealed class EndpointSpec
    {
        internal string Name;
        internal bool CanListen,CanConnect;
        internal int Limit;
    }
}
