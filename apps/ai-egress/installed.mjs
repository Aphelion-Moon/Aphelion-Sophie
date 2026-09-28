import { runInstalledRole } from '../installation/host.js';
import { createInstalledEgressService } from './installed.js';
await runInstalledRole('egress',createInstalledEgressService);
