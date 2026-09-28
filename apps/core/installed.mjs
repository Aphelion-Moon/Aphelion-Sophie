import { runInstalledRole } from '../installation/host.js';
import { createInstalledCoreService } from './runtime/installed.js';
await runInstalledRole('core',createInstalledCoreService);
