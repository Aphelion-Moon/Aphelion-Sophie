import { createAiControlClient } from '../../ai-control/client.js';
import { createAiWindowsLifecycle } from './ai-lifecycle.js';
import { installedRoleContext } from '../../installation/context.js';

export function createInstalledCoreLifecycle({pipes,signal,onFault}) {
  const {configuration,qualified,revocationSignal,keys}=installedRoleContext(pipes,'core',signal);
  try {
    const client=createAiControlClient({installationId:configuration.installationId,role:'core',key:keys.core,revocationSignal,connectPipe:pipes.connect});
    return createAiWindowsLifecycle({client,release:configuration.release,qualified,revocationSignal,onFault,createPipeServer:pipes.createServer});
  } finally {Object.values(keys).forEach(key=>key.fill(0));}
}
