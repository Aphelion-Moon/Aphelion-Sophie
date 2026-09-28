import { runInstalledRole } from '../installation/host.js';
import { createInstalledRelayService } from './service.js';
await runInstalledRole('egress-relay',createInstalledRelayService);
