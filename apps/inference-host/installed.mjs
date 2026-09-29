import { runInstalledRole } from '../installation/host.js';
import { createInstalledSupervisorService } from './installed.js';
await runInstalledRole('supervisor',createInstalledSupervisorService);
