import { createServer, connect } from 'node:net';
import { requireCondition } from '../../contracts/validation.js';
import { loadInstallationConfiguration } from './installation.js';

/**
 * Loopback-only control and inference sockets for one installed role. OS-account separation,
 * NTFS ACL scope on the config/secret files and the firewall's egress scope are the qualified
 * boundaries here — there is no native pipe companion or custom ACL to hold in this process.
 */
export async function createInstalledTransport({role}) {
  requireCondition(process.platform==='win32','AI_WINDOWS_REQUIRED');
  const installation=await loadInstallationConfiguration(role);
  const controller=new AbortController();
  return Object.freeze({
    profile:'installed', installation, signal:controller.signal,
    createServer:callback=>createServer(callback),
    connect:options=>connect(options),
    status:()=>({profile:'installed',role}),
    async stop(){controller.abort();},
  });
}
