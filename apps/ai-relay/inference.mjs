import { runInstalledRole } from '../installation/host.js';
import { createInstalledRelayService } from './service.js';
await runInstalledRole('inference-relay',createInstalledRelayService);
