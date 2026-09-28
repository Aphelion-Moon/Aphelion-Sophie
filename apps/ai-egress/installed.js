import { createAiControlClient } from '../ai-control/client.js';
import { createAiEgressService } from './service.js';
import { createAiEgressBridge } from './runtime.js';
import { installedRoleContext } from '../installation/context.js';

export function createInstalledEgressService({pipes,signal,onFault,createBridge=createAiEgressBridge}) {
  const {configuration,qualified,revocationSignal,keys}=installedRoleContext(pipes,'egress',signal);
  try {
    const client=createAiControlClient({installationId:configuration.installationId,role:'egress',key:keys.egress,revocationSignal,connectPipe:pipes.connect});
    return createAiEgressService({client,qualified,revocationSignal,onFault,
      createBridge:options=>createBridge({...options,createPipeServer:pipes.createServer})});
  } finally {Object.values(keys).forEach(key=>key.fill(0));}
}
