import { createServer, connect } from 'node:net';
import { requireCondition } from '../../contracts/validation.js';
import { loadInstallationConfiguration } from './configuration.js';

/**
 * Loopback sockets for one installed role. Peers authenticate with per-installation/per-boot keys;
 * the qualified boundaries are the service SIDs, NTFS ACLs and firewall scope, not the port number.
 */
export async function createInstalledTransport({role,load=loadInstallationConfiguration}) {
  requireCondition(process.platform==='win32','AI_WINDOWS_REQUIRED');
  const installation=await load(role);
  const controller=new AbortController();
  return Object.freeze({
    profile:'installed', installation, signal:controller.signal,
    createServer:callback=>createServer(callback),
    connect:options=>connect(options),
    status:()=>({profile:'installed',role}),
    async stop(){controller.abort();},
  });
}
